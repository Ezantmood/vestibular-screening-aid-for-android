// P3.5 preview geometry has TWO distinct transforms:
// - buildTextureViewMatrix: CONTENT -> DISPLAY, applied to the already
//   sensor-oriented, view-sized TextureView content. Android also mirrors
//   front preview surfaces automatically. Never pass raw buffer coordinates
//   or an inverse sampling matrix to TextureView.setTransform().
// - buildPreviewMatrix: DISPLAY -> decoded ANALYSIS pixels for the Redmi P2
//   90-CW frame convention. This audit mapping is NOT a TextureView transform;
//   anatomical eye-side correspondence remains unresolved (P3 rule).
// Framing uses getBitmap() DISPLAY fractions, with no second rotation/mirror.
// Native buildTextureViewMatrix and the pure TS version stay in lockstep.

/** Row-major 3x3 matrix in android.graphics.Matrix layout. */
export type Matrix3 = [number, number, number, number, number, number, number, number, number];

export function matrixIdentity(): Matrix3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
  return [
    a0 * b0 + a1 * b3 + a2 * b6,
    a0 * b1 + a1 * b4 + a2 * b7,
    a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6,
    a3 * b1 + a4 * b4 + a5 * b7,
    a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6,
    a6 * b1 + a7 * b4 + a8 * b7,
    a6 * b2 + a7 * b5 + a8 * b8,
  ];
}

/** Android `Matrix.postTranslate`: M' = T(dx, dy) * M. */
export function postTranslate(m: Matrix3, dx: number, dy: number): Matrix3 {
  return multiply([1, 0, dx, 0, 1, dy, 0, 0, 1], m);
}

/** Android `Matrix.postScale(sx, sy, px, py)`: M' = T(p) * S * T(-p) * M. */
export function postScale(m: Matrix3, sx: number, sy: number, px: number, py: number): Matrix3 {
  const s: Matrix3 = [sx, 0, px * (1 - sx), 0, sy, py * (1 - sy), 0, 0, 1];
  return multiply(s, m);
}

/** Android `Matrix.postRotate(deg, px, py)`: M' = T(p) * R * T(-p) * M. */
export function postRotate(m: Matrix3, deg: number, px: number, py: number): Matrix3 {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const r: Matrix3 = [
    cos,
    -sin,
    px * (1 - cos) + py * sin,
    sin,
    cos,
    py * (1 - cos) - px * sin,
    0,
    0,
    1,
  ];
  return multiply(r, m);
}

/** Android setRectToRect(FILL): maps src to dst, allowing unequal scales. */
export function setRectToRectFill(
  srcLeft: number,
  srcTop: number,
  srcRight: number,
  srcBottom: number,
  dstLeft: number,
  dstTop: number,
  dstRight: number,
  dstBottom: number,
): Matrix3 {
  const srcW = srcRight - srcLeft;
  const srcH = srcBottom - srcTop;
  const dstW = dstRight - dstLeft;
  const dstH = dstBottom - dstTop;
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    throw new Error('setRectToRectFill needs positive src/dst sizes.');
  }
  const sx = dstW / srcW;
  const sy = dstH / srcH;
  return [sx, 0, dstLeft - srcLeft * sx, 0, sy, dstTop - srcTop * sy, 0, 0, 1];
}

/** Invert an affine 3x3 (last row must be [0,0,1]); throws when singular. */
export function invertAffine(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  if (!Number.isFinite(det) || det === 0) {
    throw new Error('Cannot invert singular preview matrix.');
  }
  const invDet = 1 / det;
  const na = e * invDet;
  const nb = -b * invDet;
  const nd = -d * invDet;
  const ne = a * invDet;
  return [na, nb, -(na * c + nb * f), nd, ne, -(nd * c + ne * f), 0, 0, 1];
}

export function mapPoint(m: Matrix3, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = m;
  return { x: a * x + b * y + c, y: d * x + e * y + f };
}

export type DisplayRotation = 0 | 90 | 180 | 270;

export interface PreviewMatrixParams {
  /** View size; RN audit units and buffer units may differ. */
  viewWidth: number;
  viewHeight: number;
  bufferWidth: number;
  bufferHeight: number;
  /** Live CameraCharacteristics.SENSOR_ORIENTATION. */
  sensorOrientation: number;
  /** Degrees, not Android Surface.ROTATION_* enum values. */
  displayRotation: DisplayRotation;
  /** Desired selfie mirror, display-only. */
  mirrorForFront: boolean;
  extraRotationDeg: number;
}

export interface TextureViewMatrixParams extends PreviewMatrixParams {
  /** Camera2 automatically mirrors FRONT preview surfaces (not recordings). */
  frontFacing: boolean;
}

function validateSizes(p: PreviewMatrixParams): void {
  const { viewWidth: vw, viewHeight: vh, bufferWidth: bw, bufferHeight: bh } = p;
  if (![vw, vh, bw, bh].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error(`Preview matrix needs positive sizes (view ${vw}x${vh}, buffer ${bw}x${bh}).`);
  }
}

/** Uniform cover scale, including inverse-rotated view corners. */
function coverScale(vw: number, vh: number, bw: number, bh: number, degrees: number): number {
  const radians = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(radians));
  const s = Math.abs(Math.sin(radians));
  return Math.max((c * vw + s * vh) / bw, (s * vw + c * vh) / bh);
}

/**
 * CONTENT -> DISPLAY correction for TextureView.setTransform(). Android has
 * already sensor-oriented/mirrored the camera image and stretched it to the
 * view. Undo that stretch, apply uniform cover, then compensate display
 * rotation about the view centre. Front selfie mode needs NO extra mirror.
 */
export function buildTextureViewMatrix(p: TextureViewMatrixParams): Matrix3 {
  validateSizes(p);
  const { viewWidth: vw, viewHeight: vh, bufferWidth: bw, bufferHeight: bh } = p;
  const swapped = p.sensorOrientation % 180 !== 0;
  const orientedW = swapped ? bh : bw;
  const orientedH = swapped ? bw : bh;
  const angle = -p.displayRotation + p.extraRotationDeg;
  const scale = coverScale(vw, vh, orientedW, orientedH, angle);
  let m = postScale(
    matrixIdentity(),
    (scale * orientedW) / vw,
    (scale * orientedH) / vh,
    vw / 2,
    vh / 2,
  );
  m = postRotate(m, angle, vw / 2, vh / 2);
  if (p.frontFacing !== p.mirrorForFront) {
    m = postScale(m, -1, 1, vw / 2, vh / 2);
  }
  return m;
}

/**
 * DISPLAY -> decoded ANALYSIS audit mapping. P2 found that the Redmi front
 * recording needs 90 CW in portrait; TextureView already handles its own
 * sensor orientation, so this inverse must NEVER be applied to that view.
 * Mirror changes display coordinates only; recorded pixels stay untouched.
 */
export function buildPreviewMatrix(p: PreviewMatrixParams): Matrix3 {
  validateSizes(p);
  const { viewWidth: vw, viewHeight: vh, bufferWidth: bw, bufferHeight: bh } = p;
  const angle = 90 - p.displayRotation + p.extraRotationDeg;
  const scale = coverScale(vw, vh, bw, bh, angle);
  let bufferToDisplay = postTranslate(matrixIdentity(), -bw / 2, -bh / 2);
  bufferToDisplay = postScale(bufferToDisplay, scale, scale, 0, 0);
  bufferToDisplay = postRotate(bufferToDisplay, angle, 0, 0);
  bufferToDisplay = postTranslate(bufferToDisplay, vw / 2, vh / 2);
  if (p.mirrorForFront) {
    bufferToDisplay = postScale(bufferToDisplay, -1, 1, vw / 2, vh / 2);
  }
  return invertAffine(bufferToDisplay);
}

/** ANALYSIS point (1920x1080 stream px) -> DISPLAY view px. */
export function analysisToDisplay(
  xInAnalysis: number,
  yInAnalysis: number,
  params: PreviewMatrixParams,
): { x: number; y: number } {
  const displayToDecodedFrame = buildPreviewMatrix(params);
  return mapPoint(invertAffine(displayToDecodedFrame), xInAnalysis, yInAnalysis);
}

/** DISPLAY view px -> ANALYSIS stream px (inverse; for audit, not tracking). */
export function displayToAnalysis(
  xInDisplay: number,
  yInDisplay: number,
  params: PreviewMatrixParams,
): { x: number; y: number } {
  return mapPoint(buildPreviewMatrix(params), xInDisplay, yInDisplay);
}

/**
 * Visible ANALYSIS rect for the current view (center-crop region). Pixels
 * outside this rect are cropped from the DISPLAY preview but remain in the
 * recorded file and in analysis coordinates.
 */
export function visibleAnalysisRect(params: PreviewMatrixParams): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const corners = [
    displayToAnalysis(0, 0, params),
    displayToAnalysis(params.viewWidth, 0, params),
    displayToAnalysis(0, params.viewHeight, params),
    displayToAnalysis(params.viewWidth, params.viewHeight, params),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/**
 * Horizontal mirror of an ANALYSIS x-coordinate (display selfie-mirror
 * counterpart). Pure helper for reasoning about mirrored overlays; never
 * applied to stored P3 coordinates.
 */
export function mirrorAnalysisX(xInAnalysis: number, analysisWidth: number): number {
  return analysisWidth - 1 - xInAnalysis;
}
