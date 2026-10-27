import { CALIBRATION_TARGETS } from './protocol';
import {
  CALIBRATION_COORDINATE_VERSION,
  type CalibrationContext,
  type CalibrationTake,
} from './types';

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Re-decode original pixels. Never reuse old pupil coordinates or refresh capture age. */
export function savedCalibrationReplay(value: unknown) {
  const artifact = record(value),
    result = record(artifact.result),
    c = record(result.context);
  if (
    artifact.schemaVersion !== 1 ||
    !['eye-contour-pupil-v8', CALIBRATION_COORDINATE_VERSION].includes(
      String(c.coordinateVersion),
    ) ||
    !finite(result.createdAtMs) ||
    result.createdAtMs <= 0 ||
    typeof result.id !== 'string' ||
    typeof c.cameraId !== 'string' ||
    c.detectorId !== 'percentile-dark' ||
    !finite(c.faceRotationDegrees) ||
    ![0, 90, 180, 270].includes(c.faceRotationDegrees) ||
    !Array.isArray(artifact.takes) ||
    artifact.takes.length !== CALIBRATION_TARGETS.length
  )
    throw new Error('Lần lưu không có đủ metadata video để phân tích lại. Cần hiệu chỉnh mới.');
  const dimensions = ['width', 'height', 'fps', 'viewportWidth', 'viewportHeight'] as const;
  const offsets = ['viewportLeft', 'viewportTop'] as const;
  for (const key of [...dimensions, ...offsets])
    if (
      !finite(c[key]) ||
      c[key] < 0 ||
      (dimensions.includes(key as (typeof dimensions)[number]) && c[key] === 0)
    )
      throw new Error('Thông số video/vùng chấm đã lưu không hợp lệ.');
  const context: CalibrationContext = {
    cameraId: c.cameraId,
    width: c.width as number,
    height: c.height as number,
    fps: c.fps as number,
    faceRotationDegrees: c.faceRotationDegrees as number,
    viewportWidth: c.viewportWidth as number,
    viewportHeight: c.viewportHeight as number,
    viewportLeft: c.viewportLeft as number,
    viewportTop: c.viewportTop as number,
    detectorId: 'percentile-dark',
    coordinateVersion: CALIBRATION_COORDINATE_VERSION,
  };
  const takes: Omit<CalibrationTake, 'samples'>[] = artifact.takes.map((raw, i) => {
    const t = record(raw),
      target = record(t.target),
      bridge = record(t.bridge);
    const expected = CALIBRATION_TARGETS[i];
    if (
      t.completed !== true ||
      target.id !== expected.id ||
      target.role !== expected.role ||
      target.x !== expected.x ||
      target.y !== expected.y ||
      typeof t.filePath !== 'string' ||
      !/^(?:file:\/\/)?\//.test(t.filePath) ||
      !finite(t.presentedJsUs) ||
      !finite(t.releasedJsUs) ||
      !finite(t.recordStartNativeUs) ||
      !finite(t.recordEndNativeUs) ||
      t.releasedJsUs <= t.presentedJsUs ||
      t.recordEndNativeUs <= t.recordStartNativeUs ||
      !finite(bridge.nativeMinusJsUs) ||
      !finite(bridge.roundTripUs) ||
      bridge.roundTripUs < 0
    )
      throw new Error(
        'Video đã lưu thiếu hoặc sai thứ tự/thời gian nhìn chấm. Cần hiệu chỉnh mới.',
      );
    return {
      target: { ...expected },
      filePath: t.filePath,
      completed: true,
      presentedJsUs: t.presentedJsUs,
      releasedJsUs: t.releasedJsUs,
      recordStartNativeUs: t.recordStartNativeUs,
      recordEndNativeUs: t.recordEndNativeUs,
      bridge: { nativeMinusJsUs: bridge.nativeMinusJsUs, roundTripUs: bridge.roundTripUs },
    };
  });
  return {
    id: result.id,
    createdAtMs: result.createdAtMs,
    context,
    takes,
    sourceMeasurementVersion: String(c.coordinateVersion),
  };
}
