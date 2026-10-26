/** A partial/failed decoder must not masquerade as a complete calibration take. */
export function trackingDecodeFailure(report: {
  error: string | null;
  encodedSampleCount: number;
  decodedFrameCount: number;
  decodedPtsUs: readonly (number | null)[];
}): 'DECODE_FAILED' | 'FRAME_COUNT_MISMATCH' | 'INVALID_PTS' | null {
  if (report.error !== null) return 'DECODE_FAILED';
  if (
    !Number.isInteger(report.decodedFrameCount) ||
    report.decodedFrameCount <= 0 ||
    report.encodedSampleCount !== report.decodedFrameCount ||
    report.decodedPtsUs.length !== report.decodedFrameCount
  )
    return 'FRAME_COUNT_MISMATCH';
  if (
    report.decodedPtsUs.some(
      (p, i, pts) => p === null || !Number.isFinite(p) || p < 0 || (i > 0 && p <= pts[i - 1]!),
    )
  )
    return 'INVALID_PTS';
  return null;
}

/** Independent pixel decodes must agree before detections can support calibration. */
export function pupilDecodeFailure(
  first: { decodedFrameCount: number; width: number; height: number },
  pupil: {
    decodedFrameCount: number;
    frameWidth: number;
    frameHeight: number;
    error: string | null;
  } | null,
): 'DECODE_FAILED' | 'FRAME_COUNT_MISMATCH' | null {
  if (!pupil) return null; // No usable ROIs: explicit upstream misses, never observations.
  if (pupil.error !== null) return 'DECODE_FAILED';
  if (
    pupil.decodedFrameCount !== first.decodedFrameCount ||
    pupil.frameWidth !== first.width ||
    pupil.frameHeight !== first.height
  )
    return 'FRAME_COUNT_MISMATCH';
  return null;
}

export class PipelineDecodeError extends Error {
  constructor(
    code: 'DECODE_FAILED' | 'FRAME_COUNT_MISMATCH' | 'INVALID_PTS',
    readonly stage: 'frame-decode' | 'pupil-decode' | 'rescue-decode',
    readonly counts: {
      encoded: number;
      decoded: number;
      width: number;
      height: number;
      ptsCount?: number;
    },
  ) {
    super(code);
    this.name = 'PipelineDecodeError';
  }
  describe(): string {
    return `${this.stage}: ${this.message}; encoded=${this.counts.encoded}, decoded=${this.counts.decoded}, size=${this.counts.width}×${this.counts.height}, PTS=${this.counts.ptsCount ?? 'đã đối chiếu theo slot'}`;
  }
}
