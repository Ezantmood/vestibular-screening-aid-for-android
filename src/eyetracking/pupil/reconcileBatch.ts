import type { PupilDetectionResult, PupilDetectorId, PupilRoiRequest } from './pupilTypes';

const key = (slot: Pick<PupilRoiRequest, 'frameIndex' | 'eyeSide'>) =>
  `${slot.frameIndex}:${slot.eyeSide}`;

function failure(
  request: PupilRoiRequest,
  detectorId: PupilDetectorId,
  reason: PupilDetectionResult['failureReason'],
): PupilDetectionResult {
  return {
    frameIndex: request.frameIndex,
    decodedPtsUs: request.decodedPtsUs,
    eyeSide: request.eyeSide,
    detectorId,
    roiX: Math.trunc(request.roiX),
    roiY: Math.trunc(request.roiY),
    roiWidth: Math.trunc(request.roiWidth),
    roiHeight: Math.trunc(request.roiHeight),
    centroidXInRoi: null,
    centroidYInRoi: null,
    centroidXInFrame: null,
    centroidYInFrame: null,
    normalizedX: null,
    normalizedY: null,
    candidateWidth: null,
    candidateHeight: null,
    confidence: 0,
    failureReason: reason,
  };
}

/** Exactly one result per requested eye slot, including truncated native batches.
 * Reject ambiguous identity/time/ROI matches; never pick a duplicate winner. */
export function reconcilePupilBatch(
  requests: readonly PupilRoiRequest[],
  returned: readonly PupilDetectionResult[],
  detectorId: PupilDetectorId,
): PupilDetectionResult[] {
  const bySlot = new Map<string, PupilDetectionResult | null>();
  for (const result of returned) {
    const slot = key(result);
    bySlot.set(slot, bySlot.has(slot) ? null : result);
  }
  return requests.map((request) => {
    const result = bySlot.get(key(request));
    if (result === undefined) return failure(request, detectorId, 'NATIVE_RESULT_MISSING');
    if (
      result === null ||
      result.detectorId !== detectorId ||
      result.decodedPtsUs !== request.decodedPtsUs ||
      result.roiX !== Math.trunc(request.roiX) ||
      result.roiY !== Math.trunc(request.roiY) ||
      result.roiWidth !== Math.trunc(request.roiWidth) ||
      result.roiHeight !== Math.trunc(request.roiHeight)
    )
      return failure(request, detectorId, 'INVALID_GEOMETRY');
    // Native failure confidence/candidate size are still real diagnostic evidence.
    // Clear any contradictory positions without replacing those measurements.
    if (result.failureReason !== null)
      return {
        ...result,
        centroidXInRoi: null,
        centroidYInRoi: null,
        centroidXInFrame: null,
        centroidYInFrame: null,
        normalizedX: null,
        normalizedY: null,
      };
    return { ...result };
  });
}
