import { CALIBRATION_TARGETS } from './protocol';
import {
  classifyFramingState,
  framingHint,
  type FramingObservation,
  type FramingState,
} from '../framing';

/**
 * The 0.08 viewport gate is independent of preview framing guidance.
 * The optical model below is a simulation aid, not a
 * measured camera calibration or proof that a detected face shape is fixed.
 *
 * On the Redmi front camera the recorded frame is 1920×1080 and the sensor
 * sits at 270°, so chin-to-forehead lies on the 1920px axis. The old preview
 * was a near-square cover crop of that frame, and the lamp called the face
 * ready at about 40% of the crop. That is roughly 0.25 of the recorded axis.
 * Across a phone-width board the pupil then moves only a few pixels. One
 * pixel of target-dependent detector error, times the affine gain, is more
 * than 0.08 of the screen. The old "too close" rule told the operator to
 * move back at the only distance where the gate can pass.
 *
 * Bounds below are engineering limits, not a measured focal length and not
 * a clinical cutoff. The narrow 70° diagonal is the harder case: a wider
 * lens passes at a smaller face. The board size is smaller than the phone
 * screen, so a real full-width board has more travel than this model.
 */
export const CALIBRATION_GEOMETRY = {
  frameLongPx: 1920,
  frameShortPx: 1080,
  sensorWidthMm: 4.656,
  narrowDiagonalFovDeg: 70,
  rotationRadiusMm: 10,
  faceHeightMm: 200,
  faceWidthMm: 150,
  boardWidthMm: 64,
  boardHeightMm: 90,
  residualPx: 1,
} as const;

/** Upright recorded frame. A preview with this aspect does not cover-crop. */
export const CALIBRATION_PREVIEW_ASPECT =
  CALIBRATION_GEOMETRY.frameShortPx / CALIBRATION_GEOMETRY.frameLongPx;

/**
 * DISPLAY fractions of the upright preview. Height OR width can establish
 * sufficient occupancy for capture. A height-only 0.60 floor is unreachable
 * for near-square face boxes in a 9:16 preview: width exceeds 0.94 first.
 * Width 0.80 preserves the old floor for the model's assumed 150:200 face,
 * while allowing wider detector boxes. These are UX checks; only the actual
 * recorded measurements can pass calibration's independent quality gates.
 */
export const CALIBRATION_FRAMING_GATES = {
  PARTIAL_MARGIN: 0.02,
  TOO_CLOSE_FRAC: 0.94,
  TOO_FAR_HEIGHT_FRAC: 0.6,
  TOO_FAR_WIDTH_FRAC: 0.8,
  CENTER_TOL_FRAC: 0.12,
  EYE_OPEN_PROB: 0.4,
} as const;

function focalLengthPx(): number {
  const { sensorWidthMm, frameLongPx, narrowDiagonalFovDeg } = CALIBRATION_GEOMETRY;
  const sensorHeightMm = (sensorWidthMm * 9) / 16;
  const diagonalMm = Math.hypot(sensorWidthMm, sensorHeightMm);
  const focalMm = diagonalMm / 2 / Math.tan((narrowDiagonalFovDeg * Math.PI) / 180 / 2);
  return focalMm / (sensorWidthMm / frameLongPx);
}

function targetSpan(axis: 'x' | 'y'): number {
  const fit = CALIBRATION_TARGETS.filter((target) => target.role === 'fit');
  const values = fit.map((target) => target[axis]);
  return Math.max(...values) - Math.min(...values);
}

/** Distance at which a face of this recorded-frame height fills the model. */
export function analysisDistanceMm(faceHeightFraction: number): number {
  const facePx = faceHeightFraction * CALIBRATION_GEOMETRY.frameLongPx;
  return (focalLengthPx() * CALIBRATION_GEOMETRY.faceHeightMm) / facePx;
}

/** Pupil-plane shift from the primary position, in recorded-frame pixels. */
export function pupilPlaneOffsetPx(
  faceHeightFraction: number,
  targetX: number,
  targetY: number,
): { x: number; y: number } {
  const { rotationRadiusMm, faceHeightMm, boardWidthMm, boardHeightMm, frameLongPx } =
    CALIBRATION_GEOMETRY;
  const distanceMm = analysisDistanceMm(faceHeightFraction);
  const pxPerMm = (faceHeightFraction * frameLongPx) / faceHeightMm;
  const shift = (boardMm: number, unit: number) =>
    rotationRadiusMm * Math.sin(Math.atan(((unit - 0.5) * boardMm) / distanceMm));
  return {
    x: shift(boardWidthMm, targetX) * pxPerMm,
    y: shift(boardHeightMm, targetY) * pxPerMm,
  };
}

/**
 * Viewport fraction for a one-pixel target-dependent residual. The affine
 * gain is the target span divided by the pupil's pixel span, so the face
 * width cancels. This is the corner error, before RMSE averages it down.
 */
export function modeledViewportError(faceHeightFraction: number): { x: number; y: number } {
  const spanX = targetSpan('x');
  const spanY = targetSpan('y');
  const travel = (axis: 'x' | 'y', span: number) => {
    const from = pupilPlaneOffsetPx(
      faceHeightFraction,
      axis === 'x' ? 0.5 - span / 2 : 0.5,
      axis === 'y' ? 0.5 - span / 2 : 0.5,
    );
    const to = pupilPlaneOffsetPx(
      faceHeightFraction,
      axis === 'x' ? 0.5 + span / 2 : 0.5,
      axis === 'y' ? 0.5 + span / 2 : 0.5,
    );
    return Math.hypot(to.x - from.x, to.y - from.y);
  };
  const pixelX = travel('x', spanX);
  const pixelY = travel('y', spanY);
  const { residualPx } = CALIBRATION_GEOMETRY;
  return {
    x: pixelX > 0 ? (residualPx / pixelX) * spanX : Number.POSITIVE_INFINITY,
    y: pixelY > 0 ? (residualPx / pixelY) * spanY : Number.POSITIVE_INFINITY,
  };
}

export function classifyCalibrationFraming(obs: FramingObservation): FramingState {
  return classifyFramingState(obs, CALIBRATION_FRAMING_GATES);
}

export function calibrationFramingHint(state: FramingState): string {
  switch (state) {
    case 'TOO_FAR':
      return 'Đưa điện thoại lại gần chậm một chút, giữ đủ cả mặt và hai mắt trong khung. Khi hiện “Giữ nguyên vị trí”, dừng di chuyển để đèn xác nhận.';
    case 'TOO_CLOSE':
      return 'Lùi nhẹ, giữ mặt ở giữa và chừa khoảng trống hai bên; không cần cố làm mặt cao hết khung.';
    case 'FACE_PARTIAL':
      return 'Căn mặt vào giữa để đủ cả mặt và hai mắt; nếu mặt vẫn chạm mép khung, lùi nhẹ.';
    case 'READY':
      return 'Đã căn khung ổn định, có thể bắt đầu. Giữ đầu và điện thoại yên; chất lượng hiệu chỉnh sẽ được kiểm tra sau khi ghi.';
    default:
      return framingHint(state);
  }
}
