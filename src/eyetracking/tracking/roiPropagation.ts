// P4 ROI propagation — dense per-frame eye boxes from sparse ML Kit
// keyframes. Pure; no native calls, no detection, no clinical logic.
//
// Honesty rules:
// - Keyframes are P2 `faceSamples` (real ML Kit boxes, real PTS).
// - A frame gets an interpolated box ONLY when it sits strictly between two
//   ADJACENT keyframes whose same-side eye box is usable. Any invalid sample
//   (NO_FACE / unusable eye) breaks interpolation: every frame past the last
//   valid keyframe becomes an explicit upstream failure until the next valid
//   keyframe. Blinks, occlusions, and ROI loss are never interpolated
//   across — the tracker measures those dropouts instead.
// - Interpolation is linear in PTS fraction (correct under irregular encoder
//   timing); each slot carries the decoder's TRUE `decodedPtsUs` (never
//   synthesized), so the tracker time axis stays authoritative.

import type { FramePipelineFaceSample } from '../../../modules/expo-frame-pipeline/src/ExpoFramePipeline.types';
import type { EyeSide, PupilFailureReason } from '../pupil/pupilTypes';

export interface PropagatedRoi {
  frameIndex: number;
  decodedPtsUs: number | null;
  eyeSide: EyeSide;
  /** True when this box is a real ML Kit keyframe (not interpolated). */
  keyframe: boolean;
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  /** Set when no box exists: explicit upstream failure (never fabricated). */
  missingReason: PupilFailureReason | null;
}

interface EyeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function usableEye(sample: FramePipelineFaceSample, eyeSide: EyeSide): EyeBox | null {
  if (!sample.faceDetected) {
    return null;
  }
  const eye = eyeSide === 'left' ? sample.leftEye : sample.rightEye;
  if (eye === null || eye.usable !== true) {
    return null;
  }
  return { x: eye.x, y: eye.y, width: eye.width, height: eye.height };
}

function missingKind(sample: FramePipelineFaceSample | undefined): PupilFailureReason {
  if (sample === undefined || !sample.faceDetected) {
    return 'NO_FACE';
  }
  return 'NO_EYE_ROI';
}

/**
 * Build one propagated ROI per decoded frame per eye. `decodedPtsUsList`
 * is the P2 full-rate PTS array (index = frameIndex); `frameCount` caps
 * the output range. Keyframe boxes keep exact integer pixels;
 * interpolated boxes round to integer pixels (native parity with P3).
 */
export function propagateRois(args: {
  faceSamples: FramePipelineFaceSample[];
  decodedPtsUsList: (number | null)[];
  frameCount: number;
}): PropagatedRoi[] {
  const { faceSamples, decodedPtsUsList, frameCount } = args;
  const ordered = [...faceSamples].sort((a, b) => a.frameIndex - b.frameIndex);
  const out: PropagatedRoi[] = [];
  for (const eyeSide of ['left', 'right'] as const) {
    // Valid keyframes for this eye, in frame order.
    const keys: { frameIndex: number; ptsUs: number | null; box: EyeBox }[] = [];
    for (const s of ordered) {
      const box = usableEye(s, eyeSide);
      if (box !== null) {
        keys.push({ frameIndex: s.frameIndex, ptsUs: s.ptsUs, box });
      }
    }
    // Invalid sample indices break interpolation between keyframes.
    const keyByFrame = new Map<number, (typeof keys)[number]>();
    for (const k of keys) {
      keyByFrame.set(k.frameIndex, k);
    }
    for (let f = 0; f < frameCount; f++) {
      const pts = f < decodedPtsUsList.length ? decodedPtsUsList[f] : null;
      const exact = keyByFrame.get(f);
      if (exact !== undefined) {
        out.push({
          frameIndex: f,
          decodedPtsUs: pts,
          eyeSide,
          keyframe: true,
          roiX: exact.box.x,
          roiY: exact.box.y,
          roiWidth: exact.box.width,
          roiHeight: exact.box.height,
          missingReason: null,
        });
        continue;
      }
      // Strict bracketing: adjacent valid keyframes with no invalid
      // sample strictly between them.
      let lo: (typeof keys)[number] | null = null;
      let hi: (typeof keys)[number] | null = null;
      for (const k of keys) {
        if (k.frameIndex < f) {
          lo = k;
        } else if (k.frameIndex > f) {
          hi = k;
          break;
        }
      }
      let clean = lo !== null && hi !== null;
      if (clean && lo !== null && hi !== null) {
        const loFrame: number = lo.frameIndex;
        const hiFrame: number = hi.frameIndex;
        for (const s of ordered) {
          if (s.frameIndex > loFrame && s.frameIndex < hiFrame) {
            clean = false;
            break;
          }
        }
      }
      if (!clean || lo === null || hi === null) {
        // Nearest sample decides the honest failure label.
        let nearest: FramePipelineFaceSample | undefined;
        let nearestDist = Number.POSITIVE_INFINITY;
        for (const s of ordered) {
          const d = Math.abs(s.frameIndex - f);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = s;
          }
        }
        out.push({
          frameIndex: f,
          decodedPtsUs: pts,
          eyeSide,
          keyframe: false,
          roiX: 0,
          roiY: 0,
          roiWidth: 0,
          roiHeight: 0,
          missingReason: missingKind(nearest),
        });
        continue;
      }
      const span = hi.frameIndex - lo.frameIndex;
      // Use real media time under irregular frame spacing. Missing PTS cannot
      // support time interpolation; fall back explicitly to frame fraction.
      const timed = pts !== null && lo.ptsUs !== null && hi.ptsUs !== null && hi.ptsUs > lo.ptsUs;
      const alpha = timed
        ? Math.max(0, Math.min(1, (pts! - lo.ptsUs!) / (hi.ptsUs! - lo.ptsUs!)))
        : span > 0
          ? (f - lo.frameIndex) / span
          : 0;
      out.push({
        frameIndex: f,
        decodedPtsUs: pts,
        eyeSide,
        keyframe: false,
        roiX: Math.round(lo.box.x + (hi.box.x - lo.box.x) * alpha),
        roiY: Math.round(lo.box.y + (hi.box.y - lo.box.y) * alpha),
        roiWidth: Math.round(lo.box.width + (hi.box.width - lo.box.width) * alpha),
        roiHeight: Math.round(lo.box.height + (hi.box.height - lo.box.height) * alpha),
        missingReason: null,
      });
    }
  }
  return out;
}
