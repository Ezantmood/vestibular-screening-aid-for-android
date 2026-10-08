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
