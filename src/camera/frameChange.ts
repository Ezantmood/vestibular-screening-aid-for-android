// P2 frame-change check — pure classification over downsampled-luminance MAD.
// Scale is 0–255 (mean absolute Y difference on a fixed 96×54 grid, native).
// A negative MAD is a sentinel for "comparison skipped" (decoder gave no CPU
// Image for that frame) and is always excluded from statistics.

/** MAD <= this → exact/near-exact duplicate CANDIDATE (not proof). */
export const NEAR_DUPLICATE_MAD_THRESHOLD = 1.5;
/** MAD <= this (above near-dup) → low-motion frame, explicitly NOT duplicate. */
export const LOW_MOTION_MAD_THRESHOLD = 5.0;

export type FrameMotionClass = 'near-duplicate-candidate' | 'low-motion' | 'changing' | 'skipped';

export function classifyFrameMad(mad: number): FrameMotionClass {
  if (!Number.isFinite(mad) || mad < 0) {
    return 'skipped';
  }
  if (mad <= NEAR_DUPLICATE_MAD_THRESHOLD) {
    return 'near-duplicate-candidate';
  }
  if (mad <= LOW_MOTION_MAD_THRESHOLD) {
    return 'low-motion';
  }
  return 'changing';
}

export interface FrameChangeStats {
  /** Consecutive-pair comparisons attempted (decodedFrames − 1). */
  totalComparisons: number;
  /** Comparisons with a real MAD value (sentinels excluded). */
  validComparisons: number;
  nearDuplicateCount: number;
  nearDuplicatePct: number;
  longestDuplicateRun: number;
  lowMotionCount: number;
  madMean: number | null;
  madMedian: number | null;
  madMin: number | null;
  madMax: number | null;
}

export function computeFrameChangeStats(mads: number[]): FrameChangeStats {
  const valid = mads.filter((m) => Number.isFinite(m) && m >= 0);
  let nearDuplicateCount = 0;
  let lowMotionCount = 0;
  let run = 0;
  let longestDuplicateRun = 0;
  for (const m of mads) {
    if (!Number.isFinite(m) || m < 0) {
      run = 0;
      continue;
    }
    if (m <= NEAR_DUPLICATE_MAD_THRESHOLD) {
      nearDuplicateCount += 1;
      run += 1;
      longestDuplicateRun = Math.max(longestDuplicateRun, run);
    } else {
      run = 0;
      if (m <= LOW_MOTION_MAD_THRESHOLD) {
        lowMotionCount += 1;
      }
    }
  }
  if (valid.length === 0) {
    return {
      totalComparisons: mads.length,
      validComparisons: 0,
      nearDuplicateCount: 0,
      nearDuplicatePct: 0,
      longestDuplicateRun: 0,
      lowMotionCount: 0,
      madMean: null,
      madMedian: null,
      madMin: null,
      madMax: null,
    };
  }
  const ordered = [...valid].sort((a, b) => a - b);
  const median =
    ordered.length % 2 === 1
      ? ordered[(ordered.length - 1) / 2]
      : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2;
  return {
    totalComparisons: mads.length,
    validComparisons: valid.length,
    nearDuplicateCount,
    nearDuplicatePct: (nearDuplicateCount / valid.length) * 100,
    longestDuplicateRun,
    lowMotionCount,
    madMean: valid.reduce((acc, m) => acc + m, 0) / valid.length,
    madMedian: median,
    madMin: ordered[0],
    madMax: ordered[ordered.length - 1],
  };
}
