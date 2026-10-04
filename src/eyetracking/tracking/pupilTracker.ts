// P4 temporal tracker — pure per-eye state machine over single-frame P3
// `PupilDetectionResult` values. No native calls, no gaze math, no clinical
// logic, no smoothing-as-output (P7 owns filtering; the raw measured
// sequence is preserved: `tracked == raw` whenever accepted).
//
// Time axis: `decodedPtsUs` exclusively. Frame counts are never converted
// to time except through the nominal fallback when PTS is null (flagged via
// `ptsEstimated`). All timeouts therefore tolerate irregular encoder timing
// (the P3.5 25/25/42 ms gaps must not break the tracker).
//
// Temporal assistance (candidate gating, not clinical saccade logic):
// - predicted position = last valid + capped velocity * dt (internal only),
// - acceptance radius grows with elapsed PTS time,
// - high-confidence raw detections bypass the gate (real rapid eye movement
//   must not be rejected),
// - long gaps bypass the gate and re-seed (reacquisition, not rejection),
// - candidate size consistency only scales confidence, never rejects alone.

import type { EyeSide, PupilDetectionResult, PupilFailureReason } from '../pupil/pupilTypes';
import type { PupilTrackingResult, TrackingState } from './trackingTypes';

/** Nominal 120 fps interval (µs) — fallback ONLY when PTS is missing. */
export const NOMINAL_FRAME_INTERVAL_US = 1_000_000 / 120;
/** Missing longer than this enters REACQUIRING (engineering gate, not clinical). */
export const REACQUIRE_AFTER_US = 500_000;
/** Missing longer than this enters LOST (engineering gate, not clinical). */
export const LOST_AFTER_US = 2_000_000;
/** Raw confidence at/above this bypasses the motion gate (rapid movement). */
export const HIGH_CONFIDENCE_BYPASS = 0.65;
/** Raw confidence below this yields LOW_CONFIDENCE even when gated in. */
export const WEAK_CONFIDENCE_CUTOFF = 0.5;
/** Rescued (hinted, relaxed-gate) measurements are capped at this confidence. */
export const RESCUED_CONFIDENCE_CAP = 0.55;
/** Gate base radius in ROI-normalized units. */
export const GATE_BASE_RADIUS_NORM = 0.25;
/** Gate growth per second of elapsed PTS time (normalized units). */
export const GATE_GROWTH_NORM_PER_S = 2.0;
/** Gate radius cap (normalized units). */
export const GATE_MAX_RADIUS_NORM = 1.2;
/** Gap beyond which the gate is bypassed and the track re-seeds. */
export const GATE_RESEED_AFTER_US = 500_000;
/** Velocity cap for the internal predictor (frame px/s). */
export const MAX_VELOCITY_PX_S = 5000;
/** Recent size history kept for the consistency signal. */
export const SIZE_HISTORY = 5;

interface ValidFix {
  x: number;
  y: number;
  ptsUs: number | null;
  frameIndex: number;
  confidence: number;
  width: number | null;
  height: number | null;
}

function effectivePts(view: { decodedPtsUs: number | null; frameIndex: number }): {
  ptsUs: number;
  estimated: boolean;
} {
  if (view.decodedPtsUs !== null) {
    return { ptsUs: view.decodedPtsUs, estimated: false };
  }
  return { ptsUs: Math.round(view.frameIndex * NOMINAL_FRAME_INTERVAL_US), estimated: true };
}

function missingStateFor(failure: PupilFailureReason | null): TrackingState {
  if (failure === 'EYE_CLOSED_OR_OCCLUDED') {
    return 'BLINK_OR_OCCLUDED';
  }
  return 'TEMPORARILY_LOST';
}

/** Single-eye tracker; feed P3 results in time order (sorted by PTS). */
export class EyeTracker {
  private last: ValidFix | null = null;
  private prev: ValidFix | null = null;
  private sizes: { w: number; h: number }[] = [];
  private state: TrackingState = 'UNINITIALIZED';
  private roi: { x: number; y: number; width: number; height: number } | null = null;
  private lastStepUs: number | null = null;
  private eyeSide: EyeSide | null = null;

  get currentState(): TrackingState {
    return this.state;
  }

  reset(): void {
    this.last = null;
    this.prev = null;
    this.sizes = [];
    this.roi = null;
    this.lastStepUs = null;
    this.eyeSide = null;
    this.state = 'UNINITIALIZED';
  }

  /** Internal prediction (frame space) from the motion model, or null. */
  predictAt(nowPtsUs: number): { x: number; y: number } | null {
    if (this.last === null || this.last.ptsUs === null) {
      return null;
    }
    const dtS = Math.max(0, (nowPtsUs - this.last.ptsUs) / 1_000_000);
    if (dtS > GATE_RESEED_AFTER_US / 1_000_000) return null;
    let vx = 0;
    let vy = 0;
    if (this.prev !== null && this.prev.ptsUs !== null && this.last.ptsUs > this.prev.ptsUs) {
      const pdtS = (this.last.ptsUs - this.prev.ptsUs) / 1_000_000;
      if (pdtS > 0) {
        vx = (this.last.x - this.prev.x) / pdtS;
        vy = (this.last.y - this.prev.y) / pdtS;
        const speed = Math.hypot(vx, vy);
        if (speed > MAX_VELOCITY_PX_S) {
          vx = (vx / speed) * MAX_VELOCITY_PX_S;
          vy = (vy / speed) * MAX_VELOCITY_PX_S;
        }
      }
    }
    return { x: this.last.x + vx * dtS, y: this.last.y + vy * dtS };
  }

  /** Gate radius in ROI-normalized units for the elapsed gap. */
  gateRadiusNorm(dtUs: number): number {
    return Math.min(
      GATE_MAX_RADIUS_NORM,
      GATE_BASE_RADIUS_NORM + (Math.max(0, dtUs) / 1_000_000) * GATE_GROWTH_NORM_PER_S,
    );
  }

  step(input: PupilDetectionResult & { rescued?: boolean }): PupilTrackingResult {
    if (this.eyeSide !== null && this.eyeSide !== input.eyeSide)
      throw new Error('EyeTracker cannot mix eye sides.');
    this.eyeSide = input.eyeSide;
    const now = effectivePts(input);
    if (
      !Number.isFinite(now.ptsUs) ||
      now.ptsUs < 0 ||
      (this.lastStepUs !== null && now.ptsUs <= this.lastStepUs)
    ) {
      throw new Error('Tracking requires finite, nonnegative, strictly increasing timestamps.');
    }
    this.lastStepUs = now.ptsUs;
    // Move internal priors with the current measured/propagated eye ROI.
    // This affects gating only; accepted output remains the raw centroid.
    const usableRoi =
      [input.roiX, input.roiY, input.roiWidth, input.roiHeight].every(Number.isFinite) &&
      input.roiWidth > 0 &&
      input.roiHeight > 0;
    if (usableRoi) {
      if (this.roi !== null) {
        const old = this.roi;
        for (const fix of [this.last, this.prev]) {
          if (fix !== null) {
            fix.x = input.roiX + ((fix.x - old.x) / old.width) * input.roiWidth;
            fix.y = input.roiY + ((fix.y - old.y) / old.height) * input.roiHeight;
          }
        }
      }
      this.roi = { x: input.roiX, y: input.roiY, width: input.roiWidth, height: input.roiHeight };
    }
    const hasRaw =
      usableRoi &&
      input.failureReason === null &&
      input.centroidXInFrame !== null &&
      input.centroidYInFrame !== null &&
      Number.isFinite(input.centroidXInFrame) &&
      Number.isFinite(input.centroidYInFrame) &&
      Number.isFinite(input.confidence) &&
      input.confidence >= 0 &&
      input.confidence <= 1;
    const rescued = input.rescued === true;

    const prediction = this.predictAt(now.ptsUs);
    let searchRadiusPx: number | null = null;
    let dtSinceLastUs: number | null = null;
    if (this.last !== null && this.last.ptsUs !== null) {
      dtSinceLastUs = Math.max(0, now.ptsUs - this.last.ptsUs);
      const roiScale = Math.max(1, input.roiWidth, input.roiHeight);
      searchRadiusPx = this.gateRadiusNorm(dtSinceLastUs) * roiScale;
    }

    if (hasRaw) {
      return this.accept(
        input,
        now.ptsUs,
        now.estimated,
        prediction,
        searchRadiusPx,
        dtSinceLastUs,
        rescued,
      );
    }
    return this.miss(
      input.failureReason === null ? { ...input, failureReason: 'INVALID_GEOMETRY' } : input,
      now.ptsUs,
      now.estimated,
      prediction,
      searchRadiusPx,
      dtSinceLastUs,
    );
  }

  private accept(
    input: PupilDetectionResult,
    nowPtsUs: number,
    estimated: boolean,
    prediction: { x: number; y: number } | null,
    searchRadiusPx: number | null,
    dtSinceLastUs: number | null,
    rescued: boolean,
  ): PupilTrackingResult {
    const cx = input.centroidXInFrame as number;
    const cy = input.centroidYInFrame as number;
    const roiScale = Math.max(1, input.roiWidth, input.roiHeight);
    let gateRejected = false;
    let gateMarginal = false;
    let bypassedGate = false;
    if (prediction !== null && searchRadiusPx !== null && dtSinceLastUs !== null) {
      const reseed = dtSinceLastUs > GATE_RESEED_AFTER_US;
      const bypass = (input.confidence ?? 0) >= HIGH_CONFIDENCE_BYPASS;
      if (!reseed && !bypass) {
        const distPx = Math.hypot(cx - prediction.x, cy - prediction.y);
        const radiusNorm = this.gateRadiusNorm(dtSinceLastUs);
        const distNorm = distPx / roiScale;
        if (distNorm > radiusNorm) {
          gateRejected = true;
        } else if (distNorm > 0.7 * radiusNorm) {
          gateMarginal = true;
        }
      } else {
        bypassedGate = true;
      }
    }
    if (gateRejected) {
      return this.miss(input, nowPtsUs, estimated, prediction, searchRadiusPx, dtSinceLastUs, true);
    }
    let trackingConfidence = input.confidence;
    if (rescued) {
      trackingConfidence = Math.min(trackingConfidence, RESCUED_CONFIDENCE_CAP);
    }
    if (gateMarginal) {
      trackingConfidence = Math.max(0, trackingConfidence - 0.15);
    }
    if (this.sizeInconsistent(input)) {
      trackingConfidence = Math.max(0, trackingConfidence - 0.2);
    }
    const weak = trackingConfidence < WEAK_CONFIDENCE_CUTOFF;
    // A bypass/reseed acceptance far from the prediction is a real jump or a
    // fresh start: re-seed velocity instead of extrapolating the discontinuity.
    let jumped = false;
    if (bypassedGate && prediction !== null && dtSinceLastUs !== null) {
      const distNorm = Math.hypot(cx - prediction.x, cy - prediction.y) / roiScale;
      jumped = distNorm > this.gateRadiusNorm(dtSinceLastUs);
    }
    const recovered = dtSinceLastUs !== null && dtSinceLastUs >= GATE_RESEED_AFTER_US;
    this.prev = jumped || recovered ? null : this.last;
    if (recovered) this.sizes = [];
    this.last = {
      x: cx,
      y: cy,
      ptsUs: nowPtsUs,
      frameIndex: input.frameIndex,
      confidence: trackingConfidence,
      width: input.candidateWidth,
      height: input.candidateHeight,
    };
    if (input.candidateWidth !== null && input.candidateHeight !== null) {
      this.sizes.push({ w: input.candidateWidth, h: input.candidateHeight });
      if (this.sizes.length > SIZE_HISTORY) {
        this.sizes.shift();
      }
    }
    this.state = weak ? 'LOW_CONFIDENCE' : 'TRACKED';
    return {
      frameIndex: input.frameIndex,
      decodedPtsUs: input.decodedPtsUs,
      eyeSide: input.eyeSide,
      rawCentroidX: cx,
      rawCentroidY: cy,
      rawConfidence: input.confidence,
      rawFailure: null,
      rescued,
      trackingState: this.state,
      trackingConfidence,
      trackedCentroidX: cx,
      trackedCentroidY: cy,
      predictedCentroidX: prediction?.x ?? null,
      predictedCentroidY: prediction?.y ?? null,
      searchRadiusPx,
      gateRejected: false,
      failureReason: null,
      dropoutDurationUs: 0,
      ptsEstimated: estimated,
    };
  }

  private miss(
    input: PupilDetectionResult,
    nowPtsUs: number,
    estimated: boolean,
    prediction: { x: number; y: number } | null,
    searchRadiusPx: number | null,
    dtSinceLastUs: number | null,
    gateRejected = false,
  ): PupilTrackingResult {
    let dropoutUs = 0;
    if (this.last !== null && this.last.ptsUs !== null) {
      dropoutUs = Math.max(0, nowPtsUs - this.last.ptsUs);
    } else if (this.state !== 'UNINITIALIZED') {
      dropoutUs = 0;
    }
    if (this.last === null) {
      this.state = 'UNINITIALIZED';
    } else if (dropoutUs > LOST_AFTER_US) {
      this.state = 'LOST';
    } else if (dropoutUs > REACQUIRE_AFTER_US) {
      this.state = 'REACQUIRING';
    } else {
      this.state = missingStateFor(input.failureReason);
    }
    const lastConf = this.last?.confidence ?? 0;
    const trackingConfidence =
      this.last === null ? 0 : Math.max(0, lastConf - (dropoutUs / 1_000_000) * 0.5);
    return {
      frameIndex: input.frameIndex,
      decodedPtsUs: input.decodedPtsUs,
      eyeSide: input.eyeSide,
      rawCentroidX: input.centroidXInFrame,
      rawCentroidY: input.centroidYInFrame,
      rawConfidence: input.confidence,
      rawFailure: input.failureReason,
      rescued: false,
      trackingState: this.state,
      trackingConfidence,
      trackedCentroidX: null,
      trackedCentroidY: null,
      predictedCentroidX: prediction?.x ?? null,
      predictedCentroidY: prediction?.y ?? null,
      searchRadiusPx,
      gateRejected,
      failureReason: input.failureReason,
      dropoutDurationUs: dropoutUs,
      ptsEstimated: estimated,
    };
  }

  private sizeInconsistent(input: PupilDetectionResult): boolean {
    if (input.candidateWidth === null || input.candidateHeight === null) {
      return false;
    }
    if (this.sizes.length < 2) {
      return false;
    }
    const mw = this.sizes.reduce((a, s) => a + s.w, 0) / this.sizes.length;
    const mh = this.sizes.reduce((a, s) => a + s.h, 0) / this.sizes.length;
    if (mw <= 0 || mh <= 0) {
      return false;
    }
    const rw = input.candidateWidth / mw;
    const rh = input.candidateHeight / mh;
    return rw < 0.5 || rw > 2.0 || rh < 0.5 || rh > 2.0;
  }
}

/**
 * Track one eye's P3 sequence in time order. The input is copied and sorted
 * by (decodedPtsUs ?? frame-derived fallback, frameIndex); per-eye state is
 * independent (left/right never share priors).
 */
export function trackEyeResults(
  inputs: (PupilDetectionResult & { rescued?: boolean })[],
): PupilTrackingResult[] {
  const ordered = [...inputs].sort((a, b) => {
    const pa = a.decodedPtsUs ?? a.frameIndex * NOMINAL_FRAME_INTERVAL_US;
    const pb = b.decodedPtsUs ?? b.frameIndex * NOMINAL_FRAME_INTERVAL_US;
    return pa !== pb ? pa - pb : a.frameIndex - b.frameIndex;
  });
  const tracker = new EyeTracker();
  return ordered.map((r) => tracker.step(r));
}

/** Track both eyes independently; returns per-side sequences in time order. */
export function trackBothEyes(inputs: (PupilDetectionResult & { rescued?: boolean })[]): {
  left: PupilTrackingResult[];
  right: PupilTrackingResult[];
} {
  return {
    left: trackEyeResults(inputs.filter((r) => r.eyeSide === 'left')),
    right: trackEyeResults(inputs.filter((r) => r.eyeSide === 'right')),
  };
}
