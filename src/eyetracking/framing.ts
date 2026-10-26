// P3.5 framing guidance — pure classification + stabilization over lightweight
// face/eye observations. Engineering UX gates only, NOT clinical thresholds.
// No pupil tracking here; the future P4 tracker must not consume these boxes.
//
// Input space: DISPLAY fractions. The native sampler reports the face box as
// fractions of the DISPLAY view (it converts whatever bitmap space ML Kit saw
// into view fractions itself), so this file never depends on bitmap pixels,
// sensor rotation, or the preview mirror. Relative fractions also make the
// gates robust to center-crop vs letterbox presentation.

/** Framing/readiness states exposed to the validation UI. */
export type FramingState =
  | 'NO_FACE'
  | 'FACE_PARTIAL'
  | 'TOO_CLOSE'
  | 'TOO_FAR'
  | 'OFF_CENTER'
  | 'EYES_NOT_VISIBLE'
  | 'READY';

/** One lightweight native framing observation (all boxes are view fractions). */
export interface FramingObservation {
  faceFound: boolean;
  /** Face box as fractions of the view: [0,1] (null when no face). */
  faceLeft: number | null;
  faceTop: number | null;
  faceRight: number | null;
  faceBottom: number | null;
  /** True when the corresponding eye landmark was detected. */
  leftEyeLandmark: boolean;
  rightEyeLandmark: boolean;
  /** ML Kit eye-open probabilities (null when unavailable). */
  leftEyeOpenProb: number | null;
  rightEyeOpenProb: number | null;
}

/**
 * Engineering UX gates (documented, tunable, non-clinical):
 * - PARTIAL_MARGIN: box within this of any view edge counts as clipped.
 * - TOO_CLOSE_FRAC: face covering more than this (either axis) is too close.
 * - TOO_FAR_FRAC: face height below this is too far.
 * - CENTER_TOL_FRAC: face-centre offset beyond this (either axis) is off-centre.
 * - EYE_OPEN_PROB: below this (when classified) counts as closed.
 */
export const FRAMING_GATES = {
  PARTIAL_MARGIN: 0.02,
  TOO_CLOSE_FRAC: 0.75,
  TOO_FAR_HEIGHT_FRAC: 0.25,
  CENTER_TOL_FRAC: 0.12,
  EYE_OPEN_PROB: 0.4,
} as const;

export type FramingGateSet = {
  [Key in keyof typeof FRAMING_GATES]: number;
};

/**
 * Classify one observation. Priority (first match wins): NO_FACE >
 * FACE_PARTIAL > TOO_CLOSE > TOO_FAR > EYES_NOT_VISIBLE > OFF_CENTER > READY.
 */
export function classifyFramingState(
  obs: FramingObservation,
  gates: FramingGateSet = FRAMING_GATES,
): FramingState {
  if (
    !obs.faceFound ||
    obs.faceLeft === null ||
    obs.faceTop === null ||
    obs.faceRight === null ||
    obs.faceBottom === null
  ) {
    return 'NO_FACE';
  }
  const { faceLeft: l, faceTop: t, faceRight: r, faceBottom: b } = obs;
  if (!(r > l && b > t)) {
    return 'NO_FACE';
  }
  const m = gates.PARTIAL_MARGIN;
  if (l <= m || t <= m || r >= 1 - m || b >= 1 - m) {
    return 'FACE_PARTIAL';
  }
  const w = r - l;
  const h = b - t;
  if (w > gates.TOO_CLOSE_FRAC || h > gates.TOO_CLOSE_FRAC) {
    return 'TOO_CLOSE';
  }
  if (h < gates.TOO_FAR_HEIGHT_FRAC) {
    return 'TOO_FAR';
  }
  const eyesVisible = eyesVisibleForFraming(obs);
  if (!eyesVisible) {
    return 'EYES_NOT_VISIBLE';
  }
  const cx = (l + r) / 2;
  const cy = (t + b) / 2;
  const tol = gates.CENTER_TOL_FRAC;
  if (Math.abs(cx - 0.5) > tol || Math.abs(cy - 0.5) > tol) {
    return 'OFF_CENTER';
  }
  return 'READY';
}

/**
 * Both eyes count as visible when both landmarks are present, OR when at
 * least one landmark plus an open-eye classification clears the gate.
 * Closed (low open-prob on a classified eye) vetoes visibility.
 */
export function eyesVisibleForFraming(obs: FramingObservation): boolean {
  const eyeClosed = (p: number | null): boolean => p !== null && p < FRAMING_GATES.EYE_OPEN_PROB;
  if (eyeClosed(obs.leftEyeOpenProb) || eyeClosed(obs.rightEyeOpenProb)) {
    return false;
  }
  if (obs.leftEyeLandmark && obs.rightEyeLandmark) {
    return true;
  }
  const open = (p: number | null): boolean => p !== null && p >= FRAMING_GATES.EYE_OPEN_PROB;
  if (
    (obs.leftEyeLandmark && open(obs.rightEyeOpenProb)) ||
    (obs.rightEyeLandmark && open(obs.leftEyeOpenProb))
  ) {
    return true;
  }
  return false;
}

/** Short operator hint per state (shown under the preview). */
export function framingHint(state: FramingState): string {
  switch (state) {
    case 'NO_FACE':
      return 'Đưa khuôn mặt vào khung và nhìn vào màn hình';
    case 'FACE_PARTIAL':
      return 'Lùi nhẹ để toàn bộ khuôn mặt nằm trong khung';
    case 'TOO_CLOSE':
      return 'Đưa điện thoại ra xa một chút';
    case 'TOO_FAR':
      return 'Đưa điện thoại lại gần một chút';
    case 'OFF_CENTER':
      return 'Đưa khuôn mặt về giữa hai đường căn';
    case 'EYES_NOT_VISIBLE':
      return 'Mở cả hai mắt và nhìn thẳng vào màn hình';
    case 'READY':
      return 'Đã sẵn sàng — có thể bắt đầu quay';
  }
}

/**
 * Debounced readiness: publishes a new state only after STABLE_COUNT
 * consecutive identical classifications; otherwise holds the previous one
 * (initial NO_FACE). Prevents UI flicker without building any tracker.
 */
export class FramingStabilizer {
  private current: FramingState = 'NO_FACE';
  private pending: FramingState | null = null;
  private pendingCount = 0;

  constructor(private readonly stableCount: number = 3) {
    if (!Number.isInteger(stableCount) || stableCount < 1) {
      throw new Error('FramingStabilizer needs a positive integer stableCount.');
    }
  }

  push(sample: FramingState): FramingState {
    if (sample === this.current) {
      this.pending = null;
      this.pendingCount = 0;
      return this.current;
    }
    if (sample === this.pending) {
      this.pendingCount += 1;
    } else {
      this.pending = sample;
      this.pendingCount = 1;
    }
    if (this.pendingCount >= this.stableCount && this.pending !== null) {
      this.current = this.pending;
      this.pending = null;
      this.pendingCount = 0;
    }
    return this.current;
  }

  get(): FramingState {
    return this.current;
  }

  reset(): void {
    this.current = 'NO_FACE';
    this.pending = null;
    this.pendingCount = 0;
  }
}
