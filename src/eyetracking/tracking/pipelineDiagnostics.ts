import type { FramePipelineReport } from '../../../modules/expo-frame-pipeline/src/ExpoFramePipeline.types';

/** Fixed numerical metadata only. MAD describes motion/noise, never proof of frozen eyes. */
export function trackingPipelineDiagnostics(report: FramePipelineReport) {
  const poses = report.faceSamples.flatMap((s) => (s.headPose ? [s.headPose] : []));
  const range = (values: number[]) => {
    const finite = values.filter(Number.isFinite);
    return finite.length ? Math.max(...finite) - Math.min(...finite) : null;
  };
  return {
    frameWidth: report.width,
    frameHeight: report.height,
    encodedFrames: report.encodedSampleCount,
    decodedFrames: report.decodedFrameCount,
    effectiveFps: report.effectiveFps,
    medianIntervalUs: report.medianIntervalUs,
    maxIntervalUs: report.maxIntervalUs,
    nonMonotonicPts: report.nonMonotonicPtsCount,
    duplicatePts: report.duplicatePtsCount,
    largeGaps: report.largeGapCount,
    missingImageComparisons: report.frameMad.filter((v) => v < 0).length,
    madMedian: report.madMedian,
    faceSamples: report.faceSamples.length,
    faceDetected: report.faceSamples.filter((s) => s.faceDetected).length,
    measuredEyePairs: report.faceSamples.filter(
      (s) =>
        s.leftEye?.usable && !s.leftEye.estimated && s.rightEye?.usable && !s.rightEye.estimated,
    ).length,
    rotation0: report.faceSamples.filter((s) => s.rotationApplied === 0).length,
    rotation90: report.faceSamples.filter((s) => s.rotationApplied === 90).length,
    rotation270: report.faceSamples.filter((s) => s.rotationApplied === 270).length,
    poseSamples: poses.length,
    pitchRangeDeg: range(poses.map((p) => p.pitch)),
    yawRangeDeg: range(poses.map((p) => p.yaw)),
    rollRangeDeg: range(poses.map((p) => p.roll)),
  };
}
export type TrackingPipelineDiagnostics = ReturnType<typeof trackingPipelineDiagnostics>;
