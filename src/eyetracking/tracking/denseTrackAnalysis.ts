// P4 dense offline analysis: full-rate pupil track from one MP4.
// P2 decode + ML Kit keyframes → ROI propagation to every decoded frame →
// dense P3 batch (no overlays) → hinted rescue (no overlays) → final
// temporal track → targeted overlay batch for representative audit frames
// only. No camera, no gaze, no clinical logic. Shared by the manual P4
// validation screen and headless harnesses.
import { analyzeVideoFile } from '../../camera/framePipeline';
import type { PupilDetectionResult, PupilDetectorId } from '../pupil/pupilTypes';
import { runDensePupilBatch, runHintedPupilBatch } from '../../camera/pupilDetector';
import type { PupilTrackingResult } from './trackingTypes';
import { buildRescueHints, finalTrack, mergeRescuedResults } from './twoPassTracking';
import { propagateRois } from './roiPropagation';

export interface ReplayRunResult {
  condition: string;
  filePath: string;
  decodedFrames: number;
  keyframes: number;
  propagatedSlots: number;
  faceRate: string;
  bothEyesRate: string;
  rawResults: PupilDetectionResult[];
  tracked: PupilTrackingResult[];
  hintCount: number;
  rescuedCount: number;
  rescueFailures: Record<string, number>;
  auditOverlays: string[];
  /** Decoded frame indices that were real ML Kit keyframes (either eye). */
  keyframeFrames: number[];
}

/** Representative frame indices for the visual audit (capped, deduped). */
export function pickAuditFrames(tracked: PupilTrackingResult[]): number[] {
  const picks: number[] = [];
  for (const eyeSide of ['left', 'right'] as const) {
    const seq = tracked.filter((t) => t.eyeSide === eyeSide);
    const valid = seq.filter((t) => t.trackedCentroidX !== null);
    if (valid.length > 0) {
      picks.push(valid[Math.floor(valid.length / 2)].frameIndex);
    }
    let bestIdx = -1;
    let bestD = 0;
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1];
      const b = seq[i];
      if (a.trackedCentroidX !== null && b.trackedCentroidX !== null) {
        const d = Math.hypot(
          b.trackedCentroidX - a.trackedCentroidX,
          (b.trackedCentroidY ?? 0) - (a.trackedCentroidY ?? 0),
        );
        if (d > bestD) {
          bestD = d;
          bestIdx = b.frameIndex;
        }
      }
    }
    if (bestIdx >= 0) {
      picks.push(bestIdx);
    }
    for (const wanted of [
      'BLINK_OR_OCCLUDED',
      'TEMPORARILY_LOST',
      'REACQUIRING',
      'LOST',
    ] as const) {
      const hit = seq.find((t) => t.trackingState === wanted);
      if (hit) {
        picks.push(hit.frameIndex);
      }
    }
    let missing = false;
    for (const t of seq) {
      if (t.trackedCentroidX === null) {
        missing = true;
      } else if (missing) {
        picks.push(t.frameIndex);
        break;
      }
    }
  }
  return [...new Set(picks)].sort((a, b) => a - b).slice(0, 20);
}

function overlayName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

/**
 * Headless diagnostics for gate calibration: keyframe vs interpolated
 * raw-valid rates, consecutive-valid displacement percentiles, and the
 * displacement distribution of gate-rejected vs rescued fixes. Informs
 * whether the temporal gate rejects wild false locks (correct) or real
 * pupil jitter (over-strict). Reported, never interpreted clinically.
 */
export function computeGateDiagnostics(args: {
  raw: PupilDetectionResult[];
  tracked: PupilTrackingResult[];
  keyframeFrames: Set<number>;
}): string {
  const { raw, tracked, keyframeFrames } = args;
  const lines: string[] = [];
  for (const eyeSide of ['left', 'right'] as const) {
    const r = raw.filter((x) => x.eyeSide === eyeSide);
    const key = r.filter((x) => keyframeFrames.has(x.frameIndex));
    const interp = r.filter((x) => !keyframeFrames.has(x.frameIndex));
    const rate = (xs: PupilDetectionResult[]): string => {
      const ok = xs.filter((x) => x.failureReason === null && x.centroidXInFrame !== null).length;
      return xs.length > 0 ? `${ok}/${xs.length}=${((ok / xs.length) * 100).toFixed(1)}%` : 'n/a';
    };
    const t = tracked.filter((x) => x.eyeSide === eyeSide);
    const consec: number[] = [];
    let prev: PupilDetectionResult | null = null;
    const ordered = [...r].sort((a, b) => a.frameIndex - b.frameIndex);
    for (const x of ordered) {
      if (x.failureReason === null && x.normalizedX !== null && x.normalizedY !== null) {
        if (
          prev !== null &&
          prev.normalizedX !== null &&
          prev.normalizedY !== null &&
          x.frameIndex === prev.frameIndex + 1
        ) {
          consec.push(
            Math.hypot(x.normalizedX - prev.normalizedX, x.normalizedY - prev.normalizedY),
          );
        }
        prev = x;
      }
    }
    const q = (arr: number[], p: number): string => {
      if (arr.length === 0) {
        return '?';
      }
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3);
    };
    const rejected = t.filter((x) => x.gateRejected);
    const rejDisp: number[] = [];
    for (const x of rejected) {
      if (x.rawCentroidX !== null && x.predictedCentroidX !== null && x.searchRadiusPx !== null) {
        rejDisp.push(
          Math.hypot(
            x.rawCentroidX - x.predictedCentroidX,
            (x.rawCentroidY ?? 0) - (x.predictedCentroidY ?? 0),
          ) / x.searchRadiusPx,
        );
      }
    }
    lines.push(
      `${eyeSide}: keyValid=${rate(key)} interpValid=${rate(interp)} ` +
        `consecDisp(p50/p95/n)=${q(consec, 0.5)}/${q(consec, 0.95)}/${consec.length} ` +
        `rejBeyondRadius(med/max/n)=${q(rejDisp, 0.5)}/${q(rejDisp, 1)}/${rejDisp.length}`,
    );
  }
  return lines.join('\n');
}

/**
 * Representative overlay audit index: stable / movement / blink / loss /
 * reacquire frames with device-local overlay file names. The auditor opens
 * these JPEGs in `pupildebug/` and confirms accepted centroids sit on
 * pupils while missing frames carry no fabricated marker.
 */
export function buildAuditIndex(tracked: PupilTrackingResult[], overlayPaths: string[]): string {
  const bySlot = new Map<string, string>();
  for (const p of overlayPaths) {
    const m = overlayName(p).match(/_(left|right)_f(\d+)\.jpg$/);
    if (m) {
      bySlot.set(`${m[2]}:${m[1]}`, overlayName(p));
    }
  }
  const lines: string[] = [];
  for (const eyeSide of ['left', 'right'] as const) {
    const seq = tracked.filter((t) => t.eyeSide === eyeSide);
    const valid = seq.filter((t) => t.trackedCentroidX !== null);
    if (valid.length > 0) {
      const mid = valid[Math.floor(valid.length / 2)];
      lines.push(
        `stable ${eyeSide} f${mid.frameIndex} ${mid.trackingState} -> ${bySlot.get(`${mid.frameIndex}:${eyeSide}`) ?? '(no overlay)'}`,
      );
    }
    let bestD = 0;
    let bestFrame = -1;
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1];
      const b = seq[i];
      if (a.trackedCentroidX !== null && b.trackedCentroidX !== null) {
        const d = Math.hypot(
          b.trackedCentroidX - a.trackedCentroidX,
          (b.trackedCentroidY ?? 0) - (a.trackedCentroidY ?? 0),
        );
        if (d > bestD) {
          bestD = d;
          bestFrame = b.frameIndex;
        }
      }
    }
    if (bestFrame >= 0) {
      lines.push(
        `move ${eyeSide} f${bestFrame} d=${bestD.toFixed(1)}px -> ${bySlot.get(`${bestFrame}:${eyeSide}`) ?? '(no overlay)'}`,
      );
    }
    for (const wanted of [
      'BLINK_OR_OCCLUDED',
      'TEMPORARILY_LOST',
      'REACQUIRING',
      'LOST',
    ] as const) {
      const hit = seq.find((t) => t.trackingState === wanted);
      if (hit) {
        lines.push(
          `${wanted.toLowerCase()} ${eyeSide} f${hit.frameIndex} dropout=${(hit.dropoutDurationUs / 1000).toFixed(1)}ms tracked=${hit.trackedCentroidX === null ? 'null-ok' : 'FABRICATED'} -> ${bySlot.get(`${hit.frameIndex}:${eyeSide}`) ?? '(no overlay)'}`,
        );
      }
    }
    let missing = false;
    for (const t of seq) {
      if (t.trackedCentroidX === null) {
        missing = true;
      } else if (missing) {
        lines.push(
          `reacquired ${eyeSide} f${t.frameIndex} ${t.trackingState}${t.rescued ? ' rescued' : ''} -> ${bySlot.get(`${t.frameIndex}:${eyeSide}`) ?? '(no overlay)'}`,
        );
        break;
      }
    }
    const rescuedHere = seq.filter((t) => t.rescued && t.trackedCentroidX !== null);
    if (rescuedHere.length > 0) {
      const first = rescuedHere[0];
      lines.push(
        `rescued ${eyeSide} n=${rescuedHere.length} first=f${first.frameIndex} ${first.trackingState} -> ${bySlot.get(`${first.frameIndex}:${eyeSide}`) ?? '(no overlay)'}`,
      );
    }
  }
  return lines.length > 0 ? lines.join('\n') : '(no representative frames)';
}

export async function analyzeFileForTracking(args: {
  filePath: string;
  condition: string;
  faceSampleCount: number;
  detectorId: PupilDetectorId;
  expectedFps: number;
}): Promise<ReplayRunResult> {
  const analysis = await analyzeVideoFile({
    filePath: args.filePath,
    expectedFps: args.expectedFps,
    faceSampleCount: args.faceSampleCount,
    saveDebugFrames: false,
  });
  const rois = propagateRois({
    faceSamples: analysis.faceSamples,
    decodedPtsUsList: analysis.decodedPtsUs,
    frameCount: analysis.decodedFrameCount,
  });
  const roisWithCondition = rois.map((r) => ({ ...r, condition: args.condition }));
  const { results: standard } = await runDensePupilBatch({
    filePath: args.filePath,
    detectorId: args.detectorId,
    saveOverlays: false,
    rois: roisWithCondition,
  });
  const hints = buildRescueHints(standard);
  let rescued: PupilDetectionResult[] = [];
  const rescueFailures: Record<string, number> = {};
  if (hints.length > 0) {
    const out = await runHintedPupilBatch({
      filePath: args.filePath,
      detectorId: args.detectorId,
      saveOverlays: false,
      hints,
    });
    rescued = out.results;
    for (const r of rescued) {
      const k = r.failureReason ?? 'RESCUED_OK';
      rescueFailures[k] = (rescueFailures[k] ?? 0) + 1;
    }
  }
  const merged = mergeRescuedResults(standard, rescued);
  const { left, right } = finalTrack(merged);
  const tracked = [...left, ...right];
  const rescuedCount = merged.filter((r) => r.rescued === true).length;
  // Targeted overlays for audit frames only (never the full dense set).
  // Rescued frames are re-analyzed through the hinted entry with overlays
  // on so every rescue is visually auditable (deterministic replay).
  const auditFrames = new Set(pickAuditFrames(tracked));
  for (const t of tracked) {
    if (t.rescued && t.trackedCentroidX !== null) {
      auditFrames.add(t.frameIndex);
    }
  }
  const auditRois = roisWithCondition.filter(
    (r) => auditFrames.has(r.frameIndex) && r.missingReason === null,
  );
  let auditOverlays: string[] = [];
  if (auditRois.length > 0) {
    const overlayBatch = await runDensePupilBatch({
      filePath: args.filePath,
      detectorId: args.detectorId,
      saveOverlays: true,
      rois: auditRois,
    });
    auditOverlays = overlayBatch.report?.overlayPaths ?? [];
  }
  const auditHints = hints.filter((h) => auditFrames.has(h.frameIndex));
  if (auditHints.length > 0) {
    const rescueOverlayBatch = await runHintedPupilBatch({
      filePath: args.filePath,
      detectorId: args.detectorId,
      saveOverlays: true,
      hints: auditHints,
    });
    auditOverlays = [...auditOverlays, ...(rescueOverlayBatch.report?.overlayPaths ?? [])];
  }
  return {
    condition: args.condition,
    filePath: args.filePath,
    decodedFrames: analysis.decodedFrameCount,
    keyframes: analysis.faceSamples.length,
    propagatedSlots: rois.length,
    faceRate: String(analysis.faceDetectionRate ?? '?'),
    bothEyesRate: String(analysis.bothEyesUsableRate ?? '?'),
    rawResults: standard,
    tracked,
    hintCount: hints.length,
    rescuedCount,
    rescueFailures,
    auditOverlays,
    keyframeFrames: [...new Set(rois.filter((r) => r.keyframe).map((r) => r.frameIndex))],
  };
}
