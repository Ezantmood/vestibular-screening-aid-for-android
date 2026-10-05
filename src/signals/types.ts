export interface SignalInputSample {
  frameIndex: number;
  decodedPtsUs: number | null;
  x: number | null;
  y: number | null;
  confidence: number;
  eyeSide?: 'left' | 'right';
  missingReason?: 'blink-or-occluded' | 'tracking-dropout' | 'calibration-invalid';
  rescued?: boolean;
  estimated?: boolean;
}
export interface SignalOptions {
  coordinateSpace: 'frame-px' | 'eye-roi-normalized' | 'screen-normalized';
  minConfidence: number;
  maxGapUs: number;
  halfWindowUs: number;
  /** Coordinate units; isolated weak spikes only, never a clinical speed gate. */
  outlierDistance: number;
  neighborDistance: number;
  preserveMotionDistance: number;
}
export type SignalReason =
  | 'missing'
  | 'blink-or-occluded'
  | 'tracking-dropout'
  | 'calibration-invalid'
  | 'invalid-timestamp'
  | 'nonmonotonic-timestamp'
  | 'estimated-timestamp'
  | 'invalid-coordinate'
  | 'low-confidence'
  | 'isolated-outlier'
  | 'gap-before'
  | 'segment-start'
  | 'smoothed'
  | 'motion-preserved'
  | 'rescued';
export interface ProcessedSignalSample {
  raw: SignalInputSample;
  processedX: number | null;
  processedY: number | null;
  confidence: number;
  usable: boolean;
  velocityUsable: boolean;
  velocityConfidence: number;
  velocityXPerSecond: number | null;
  velocityYPerSecond: number | null;
  speedPerSecond: number | null;
  velocityDtUs: number | null;
  segmentId: number | null;
  reasons: SignalReason[];
}
export interface SignalQuality {
  total: number;
  usable: number;
  coverage: number;
  medianConfidence: number | null;
  /** Time-weighted triplet residual: noise proxy that includes real curvature. */
  tripletResidualMedian: number | null;
  triplets: number;
}
export interface SignalProcessingResult {
  schemaVersion: 1;
  options: SignalOptions;
  units: string;
  velocityUnits: string;
  raw: SignalInputSample[];
  samples: ProcessedSignalSample[];
  qualityBefore: SignalQuality;
  qualityRawOnProcessedSupport: SignalQuality;
  qualityAfter: SignalQuality;
  segments: number;
  outliers: number;
  smoothed: number;
  velocitySamples: number;
  reasonCounts: Partial<Record<SignalReason, number>>;
  gaps: {
    startPtsUs: number | null;
    endPtsUs: number | null;
    durationUs: number | null;
    missingSamples: number;
    kind: 'missing' | 'timestamp-gap';
  }[];
  interpolatedSamples: 0;
}
