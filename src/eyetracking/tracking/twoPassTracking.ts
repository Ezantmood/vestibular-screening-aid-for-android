// P4 two-pass tracking orchestration: standard P3 batch → hinted rescue of
// failed slots → final temporal track. Pure orchestration (no native calls
// here; the caller runs the batches via `src/camera/pupilDetector.ts`).
//
// Rescue eligibility (all required):
// - the slot failed in the standard pass but carries a usable eye ROI box
//   (upstream NO_FACE / NO_EYE_ROI slots have no box — never rescuable),
// - a previous valid raw measurement for the same eye exists within
//   RESCUE_WINDOW_US of elapsed PTS time,
// - the prior is recent enough that the motion model still constrains the
//   search (same window that keeps the TS gate from re-seeding).
//
// Hints carry the last valid centroid mapped into the CURRENT ROI box plus
// a PTS-scaled search radius. The native hinted path only accepts
// candidates near the prior, so a wrong prior yields NO_PUPIL_CANDIDATE —
// never a far-field false lock.

import type { HintedPupilRequest } from '../../camera/pupilDetector';
import type { PupilDetectionResult } from '../pupil/pupilTypes';
import { isPupilSuccess } from '../pupil/pupilTypes';
import {
  EyeTracker,
  GATE_BASE_RADIUS_NORM,
  GATE_GROWTH_NORM_PER_S,
  GATE_MAX_RADIUS_NORM,
  NOMINAL_FRAME_INTERVAL_US,
  trackEyeResults,
} from './pupilTracker';
import type { PupilTrackingResult } from './trackingTypes';

export type RescuableResult = PupilDetectionResult & { rescued?: boolean };

/** Elapsed PTS time beyond which a prior is too stale to rescue. */
export const RESCUE_WINDOW_US = 500_000;
/** Minimum hinted search radius (ROI px) so tight priors stay usable. */
export const MIN_RESCUE_RADIUS_PX = 12;

function ptsOf(r: PupilDetectionResult): number | null {
  return r.decodedPtsUs;
}

function orderByTime<T extends PupilDetectionResult>(inputs: T[]): T[] {
  return [...inputs].sort((a, b) => {
    const pa = a.decodedPtsUs ?? a.frameIndex * NOMINAL_FRAME_INTERVAL_US;
    const pb = b.decodedPtsUs ?? b.frameIndex * NOMINAL_FRAME_INTERVAL_US;
    return pa !== pb ? pa - pb : a.frameIndex - b.frameIndex;
  });
}

function roiUsable(r: PupilDetectionResult): boolean {
  return (
    r.roiWidth >= 24 &&
    r.roiHeight >= 24 &&
    r.roiX >= 0 &&
    r.roiY >= 0 &&
    Number.isFinite(r.roiX) &&
    Number.isFinite(r.roiY)
  );
}

/**
 * Build hinted-rescue requests from a standard-pass result list. Pure: no
 * I/O, deterministic. One hint per failed usable-ROI slot with a fresh
 * same-eye prior.
 */
function canRescue(r: PupilDetectionResult): boolean {
  return r.failureReason === 'LOW_CONFIDENCE' || r.failureReason === 'NO_PUPIL_CANDIDATE';
}

export function buildRescueHints(inputs: PupilDetectionResult[]): HintedPupilRequest[] {
  const hints: HintedPupilRequest[] = [];
  for (const eyeSide of ['left', 'right'] as const) {
    const ordered = orderByTime(inputs.filter((r) => r.eyeSide === eyeSide));
    let lastValid: PupilDetectionResult | null = null;
    for (const r of ordered) {
      if (isPupilSuccess(r)) {
        lastValid = r;
        continue;
      }
      if (!canRescue(r) || lastValid === null || !roiUsable(r) || !roiUsable(lastValid)) {
        continue;
      }
      const a = ptsOf(lastValid);
      const b = ptsOf(r);
      let dtUs: number | null = null;
      if (a !== null && b !== null) {
        dtUs = b - a;
      } else {
        dtUs = Math.round((r.frameIndex - lastValid.frameIndex) * NOMINAL_FRAME_INTERVAL_US);
      }
      if (dtUs === null || dtUs <= 0 || dtUs > RESCUE_WINDOW_US) {
        continue;
      }
      // Prior centroid (frame space) mapped into the current ROI box.
      const pxFrame = lastValid.centroidXInFrame;
      const pyFrame = lastValid.centroidYInFrame;
      if (pxFrame === null || pyFrame === null) {
        continue;
      }
      const priorXInRoi = ((pxFrame - lastValid.roiX) / lastValid.roiWidth) * r.roiWidth;
      const priorYInRoi = ((pyFrame - lastValid.roiY) / lastValid.roiHeight) * r.roiHeight;
      const radiusNorm = Math.min(
        GATE_MAX_RADIUS_NORM,
        GATE_BASE_RADIUS_NORM + (dtUs / 1_000_000) * GATE_GROWTH_NORM_PER_S,
      );
      const searchRadiusPx = Math.max(
        MIN_RESCUE_RADIUS_PX,
        radiusNorm * Math.max(r.roiWidth, r.roiHeight),
      );
      hints.push({
        frameIndex: r.frameIndex,
        decodedPtsUs: r.decodedPtsUs,
        eyeSide: r.eyeSide,
        roiX: r.roiX,
        roiY: r.roiY,
        roiWidth: r.roiWidth,
        roiHeight: r.roiHeight,
        condition: (r as { condition?: string }).condition ?? 'unspecified',
        priorXInRoi,
        priorYInRoi,
        searchRadiusPx,
      });
    }
  }
  return hints;
}

/**
 * Merge a hinted rescue batch into the standard-pass list. Only successful
 * rescues replace failures (tagged `rescued: true`); everything else keeps
 * the honest standard-pass outcome. At most one rescue per slot wins.
 */
export function mergeRescuedResults(
  standard: PupilDetectionResult[],
  rescued: PupilDetectionResult[],
): RescuableResult[] {
  const won = new Map<string, PupilDetectionResult>();
  for (const r of rescued) {
    if (!isPupilSuccess(r)) {
      continue;
    }
    const key = `${r.frameIndex}:${r.eyeSide}`;
    if (!won.has(key)) {
      won.set(key, r);
    }
  }
  return standard.map((r) => {
    if (isPupilSuccess(r)) {
      return r;
    }
    const hit = won.get(`${r.frameIndex}:${r.eyeSide}`);
    return hit !== undefined &&
      canRescue(r) &&
      hit.decodedPtsUs === r.decodedPtsUs &&
      hit.roiX === r.roiX &&
      hit.roiY === r.roiY &&
      hit.roiWidth === r.roiWidth &&
      hit.roiHeight === r.roiHeight
      ? { ...hit, rescued: true }
      : r;
  });
}

/**
 * First-pass track used only to size rescue hints identically to the final
 * track (shared gate math). Exposed for logic checks.
 */
export function firstPassTrack(inputs: PupilDetectionResult[]): {
  left: PupilTrackingResult[];
  right: PupilTrackingResult[];
} {
  const trackerL = new EyeTracker();
  const trackerR = new EyeTracker();
  const left: PupilTrackingResult[] = [];
  const right: PupilTrackingResult[] = [];
  for (const r of orderByTime(inputs.filter((x) => x.eyeSide === 'left'))) {
    left.push(trackerL.step(r));
  }
  for (const r of orderByTime(inputs.filter((x) => x.eyeSide === 'right'))) {
    right.push(trackerR.step(r));
  }
  return { left, right };
}

/** Final track over merged (standard + rescued) results, per eye. */
export function finalTrack(merged: RescuableResult[]): {
  left: PupilTrackingResult[];
  right: PupilTrackingResult[];
} {
  return {
    left: trackEyeResults(merged.filter((r) => r.eyeSide === 'left')),
    right: trackEyeResults(merged.filter((r) => r.eyeSide === 'right')),
  };
}
