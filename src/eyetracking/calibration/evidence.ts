import { CALIBRATION_TARGETS } from './protocol';
import { CALIBRATION_COORDINATE_VERSION, currentPupilMeasurement } from './types';
import { BATCH3_BUILD, calibrationTechnicalSummary } from '../../tests/validation/technicalReport';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const box = (value: unknown) => {
  const v = object(value);
  return value == null
    ? null
    : { x: number(v.x), y: number(v.y), width: number(v.width), height: number(v.height) };
};

/** Explicit local export: numeric calibration evidence only. Never serialize
 * arbitrary saved fields, account/patient data, file paths, images or videos. */
export function calibrationEvidence(value: unknown) {
  const artifact = object(value),
    result = object(artifact.result),
    context = object(result.context);
  const originalTakes = artifact.takes;
  if (!Array.isArray(originalTakes) || originalTakes.length !== CALIBRATION_TARGETS.length)
    throw new Error('Không có đủ dữ liệu hiệu chỉnh đã lưu để xuất.');
  const takes = CALIBRATION_TARGETS.map((target) => {
    const matches = originalTakes.map(object).filter((t) => object(t.target).id === target.id);
    const take = matches[0];
    if (matches.length !== 1 || !Array.isArray(take.samples) || take.samples.length > 40_000)
      throw new Error('Dữ liệu từng chấm không hợp lệ để xuất.');
    const storedTarget = object(take.target);
    const x = number(storedTarget.x),
      y = number(storedTarget.y);
    if (
      x === null ||
      y === null ||
      x < 0 ||
      x > 1 ||
      y < 0 ||
      y > 1 ||
      storedTarget.role !== target.role
    )
      throw new Error('Tọa độ chấm đã lưu không hợp lệ để xuất.');
    const bridge = object(take.bridge);
    return {
      target: { id: target.id, x, y, role: target.role },
      presentedJsUs: number(take.presentedJsUs),
      releasedJsUs: number(take.releasedJsUs),
      recordStartNativeUs: number(take.recordStartNativeUs),
      recordEndNativeUs: number(take.recordEndNativeUs),
      bridge: {
        nativeMinusJsUs: number(bridge.nativeMinusJsUs),
        roundTripUs: number(bridge.roundTripUs),
      },
      completed: take.completed === true,
      samples: take.samples.map((raw: unknown) => {
        const s = object(raw);
        return {
          frameIndex: number(s.frameIndex),
          decodedPtsUs: number(s.decodedPtsUs),
          eyeSide: s.eyeSide === 'left' ? 'left' : s.eyeSide === 'right' ? 'right' : null,
          x: number(s.x),
          y: number(s.y),
          confidence: number(s.confidence),
          roi: box(s.roi),
          face: box(s.face),
          faceRotation: number(s.faceRotation),
          eyeContour:
            Array.isArray(s.eyeContour) && s.eyeContour.length === 16
              ? s.eyeContour.map((p: unknown) => ({
                  x: number(object(p).x),
                  y: number(object(p).y),
                }))
              : null,
          estimated: s.estimated === true,
        };
      }),
    };
  });
  const version = context.coordinateVersion;
  return {
    schemaVersion: 1,
    kind: 'calibration-numeric-evidence',
    exportBuild: BATCH3_BUILD,
    // Only a recognized literal may cross the export boundary. Do not leak
    // arbitrary saved strings, even if they resemble a build tag.
    analysisBuild: artifact.analysisBuild === BATCH3_BUILD ? BATCH3_BUILD : null,
    analysisSource:
      artifact.reanalysisOf === null
        ? 'fresh-capture'
        : ['eye-contour-pupil-v8', 'eye-contour-pupil-v9', CALIBRATION_COORDINATE_VERSION].includes(
              String(object(artifact.reanalysisOf).measurementVersion),
            )
          ? 'saved-video-replay'
          : 'unknown',
    coordinateVersion:
      typeof version === 'string' &&
      /^(?:decoded-roi|face-pupil|eye-contour-pupil)-v\d{1,2}$/.test(version)
        ? version
        : null,
    context: Object.fromEntries(
      [
        'width',
        'height',
        'fps',
        'faceRotationDegrees',
        'viewportWidth',
        'viewportHeight',
        'viewportLeft',
        'viewportTop',
      ].map((key) => [key, number(context[key])]),
    ),
    // Never reinterpret legacy features/target geometry with the current rubric.
    technical: currentPupilMeasurement(version) ? calibrationTechnicalSummary(artifact) : null,
    storedModelErrors: (['left', 'right'] as const).map((eye) => {
      const model = object(object(result.models)[eye]);
      return {
        eye,
        fitRmse: number(model.fitRmse),
        fitCvRmse: number(model.fitCvRmse),
        validationRmse: number(model.validationRmse),
        validationMaxError: number(model.validationMaxError),
        validationFrameRmse: number(model.validationFrameRmse),
        validationFrameP95Error: number(model.validationFrameP95Error),
      };
    }),
    takes,
  };
}
