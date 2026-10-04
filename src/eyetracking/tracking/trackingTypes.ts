// P4 tracking continuity — shared result / state types.
//
// Coordinate contract (unchanged from P3): all centroids are ANALYSIS /
// image-space coordinates (decoded-frame pixels, origin top-left). The P3.5
// selfie mirror stays display-only; the tracker never mirrors and never
// swaps left/right. Eye sides are image-space labels, never anatomical.
//
// Measurement honesty: a missing P3 detection never becomes a coordinate.
// `trackedCentroid*` equals the accepted raw measurement (raw sequence
// preserved for P7); the internal motion model is exposed separately as
// `predictedCentroid*` and is never reported as a measurement.

import type { EyeSide, PupilFailureReason } from '../pupil/pupilTypes';

export type TrackingState =
  | 'UNINITIALIZED'
  | 'TRACKED'
  | 'LOW_CONFIDENCE'
  | 'TEMPORARILY_LOST'
  | 'BLINK_OR_OCCLUDED'
  | 'REACQUIRING'
  | 'LOST';

/**
 * Per-frame, per-eye tracking result. On any state other than TRACKED /
 * LOW_CONFIDENCE, `trackedCentroid*` is null (missing stays missing).
 * LOW_CONFIDENCE still carries the weak accepted measurement with reduced
 * `trackingConfidence`.
 */
export interface PupilTrackingResult {
  frameIndex: number;
  /** Authoritative time axis: decoded media PTS (µs), null when upstream had none. */
  decodedPtsUs: number | null;
  eyeSide: EyeSide;
  /** Raw P3 centroid in frame space (null on any raw failure, incl. rescued misses). */
  rawCentroidX: number | null;
  rawCentroidY: number | null;
  rawConfidence: number;
  rawFailure: PupilFailureReason | null;
  /** True when this measurement came from the hinted second-pass rescue. */
  rescued: boolean;
  trackingState: TrackingState;
  /** Engineering signal in [0,1], not a clinical confidence value. */
  trackingConfidence: number;
  /** Accepted measurement in frame space, or null when missing/weak-lost. */
  trackedCentroidX: number | null;
  trackedCentroidY: number | null;
  /** Internal motion-model prediction in frame space (never a measurement). */
  predictedCentroidX: number | null;
  predictedCentroidY: number | null;
  /** Search radius used for the temporal gate (frame px), null without a prior. */
  searchRadiusPx: number | null;
  /** True when a real raw measurement was rejected by the temporal gate. */
  gateRejected: boolean;
  /** Carried raw failure (null when a measurement was accepted). */
  failureReason: PupilFailureReason | null;
  /** Time since the last accepted measurement (µs); 0 on valid frames. */
  dropoutDurationUs: number;
  /** True when PTS was missing and nominal-interval fallback timing was used. */
  ptsEstimated: boolean;
}

/** Prior hint for the native second-pass (hinted rescue) detection. */
export interface PupilPriorHint {
  frameIndex: number;
  decodedPtsUs: number | null;
  eyeSide: EyeSide;
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  condition: string;
  priorXInRoi: number;
  priorYInRoi: number;
  searchRadiusPx: number;
}
