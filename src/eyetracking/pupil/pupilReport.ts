// P3 pupil statistics + verdict — pure aggregation over single-frame
// `PupilDetectionResult` values. No gaze math, no degrees, no clinical
// metrics: coverage / confidence / candidate geometry / failure reasons only.
//
// Engineering feasibility gates for PUPIL_DETECTION_PASS (NOT clinical
// thresholds; see docs/DECISIONS.md):
// - at least 20 evaluated eye ROIs overall,
// - each evaluated side has at least 8 evaluated ROIs,
// - detection coverage (success / evaluated) is at least 50% overall,
// - every failure carries null centroids (no fabricated positions),
// - visual audit of representative overlays passed (human flag, not computed).

import type {
  EyeSide,
  PupilDetectionResult,
  PupilDetectionVerdict,
  PupilDetectorId,
  PupilFailureReason,
} from './pupilTypes';
import { isPupilSuccess } from './pupilTypes';

export const PUPIL_MIN_EVALUATED_TOTAL = 20;
export const PUPIL_MIN_EVALUATED_PER_SIDE = 8;
export const PUPIL_MIN_COVERAGE = 0.5;

export interface PupilSideStats {
  eyeSide: EyeSide;
  evaluated: number;
  successes: number;
  failures: number;
  coverage: number | null;
  confidenceMean: number | null;
  confidenceMedian: number | null;
  confidenceMin: number | null;
  confidenceMax: number | null;
  candidateWidthMedian: number | null;
  candidateHeightMedian: number | null;
  normalizedXMean: number | null;
  normalizedYMean: number | null;
  failureReasons: Record<string, number>;
}

export interface PupilConditionStats {
  condition: string;
  evaluated: number;
  successes: number;
  coverage: number | null;
}

export interface PupilAggregateStats {
  detectorId: PupilDetectorId | 'mixed';
  evaluated: number;
  successes: number;
  failures: number;
  coverage: number | null;
  sides: PupilSideStats[];
  conditions: PupilConditionStats[];
  /** True when every failure has null centroids (never fabricated). */
  noFabricatedPositions: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.length % 2 === 1
    ? ordered[(ordered.length - 1) / 2]
    : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function sideStats(eyeSide: EyeSide, results: PupilDetectionResult[]): PupilSideStats {
  const successes = results.filter(isPupilSuccess);
  const confidences = successes.map((r) => r.confidence);
  const widths = successes.map((r) => r.candidateWidth).filter((v): v is number => v !== null);
  const heights = successes.map((r) => r.candidateHeight).filter((v): v is number => v !== null);
  const xs = successes.map((r) => r.normalizedX).filter((v): v is number => v !== null);
  const ys = successes.map((r) => r.normalizedY).filter((v): v is number => v !== null);
  const failureReasons: Record<string, number> = {};
  for (const r of results) {
    if (r.failureReason !== null) {
      failureReasons[r.failureReason] = (failureReasons[r.failureReason] ?? 0) + 1;
    }
  }
  return {
    eyeSide,
    evaluated: results.length,
    successes: successes.length,
    failures: results.length - successes.length,
    coverage: results.length > 0 ? successes.length / results.length : null,
    confidenceMean: mean(confidences),
    confidenceMedian: median(confidences),
    confidenceMin: confidences.length > 0 ? Math.min(...confidences) : null,
    confidenceMax: confidences.length > 0 ? Math.max(...confidences) : null,
    candidateWidthMedian: median(widths),
    candidateHeightMedian: median(heights),
    normalizedXMean: mean(xs),
    normalizedYMean: mean(ys),
    failureReasons,
  };
}

/** Aggregate results; `conditions` echoes per-run labels from orchestration. */
export function aggregatePupilStats(
  results: PupilDetectionResult[],
  conditionsByKey?: Map<string, string>,
): PupilAggregateStats {
  const detectorIds = new Set(results.map((r) => r.detectorId));
  const detectorId: PupilAggregateStats['detectorId'] =
    detectorIds.size === 1 ? [...detectorIds][0] : 'mixed';
  const successes = results.filter(isPupilSuccess);
  const noFabricatedPositions = results.every((r) =>
    r.failureReason === null
      ? r.centroidXInRoi !== null &&
        r.centroidYInRoi !== null &&
        r.centroidXInFrame !== null &&
        r.centroidYInFrame !== null &&
        r.normalizedX !== null &&
        r.normalizedY !== null
      : r.centroidXInRoi === null &&
        r.centroidYInRoi === null &&
        r.centroidXInFrame === null &&
        r.centroidYInFrame === null &&
        r.normalizedX === null &&
        r.normalizedY === null,
  );
  const byCondition = new Map<string, PupilDetectionResult[]>();
  for (const r of results) {
    const key = conditionsByKey?.get(`${r.frameIndex}:${r.eyeSide}`) ?? 'unspecified';
    const list = byCondition.get(key) ?? [];
    list.push(r);
    byCondition.set(key, list);
  }
  const conditions: PupilConditionStats[] = [...byCondition.entries()].map(([condition, list]) => {
    const ok = list.filter(isPupilSuccess).length;
    return {
      condition,
      evaluated: list.length,
      successes: ok,
      coverage: list.length > 0 ? ok / list.length : null,
    };
  });
  return {
    detectorId,
    evaluated: results.length,
    successes: successes.length,
    failures: results.length - successes.length,
    coverage: results.length > 0 ? successes.length / results.length : null,
    sides: [
      sideStats(
        'left',
        results.filter((r) => r.eyeSide === 'left'),
      ),
      sideStats(
        'right',
        results.filter((r) => r.eyeSide === 'right'),
      ),
    ],
    conditions,
    noFabricatedPositions,
  };
}

export function pupilDetectionVerdict(args: {
  stats: PupilAggregateStats;
  /** Human confirmation that centroids visibly fall on pupils in overlays. */
  visualAuditPassed: boolean;
}): PupilDetectionVerdict {
  const { stats } = args;
  if (stats.evaluated === 0) {
    return 'PUPIL_DETECTION_UNKNOWN';
  }
  if (!stats.noFabricatedPositions) {
    return 'PUPIL_DETECTION_FAIL';
  }
  const perSideOk = stats.sides.every((s) => s.evaluated >= PUPIL_MIN_EVALUATED_PER_SIDE);
  const pass =
    stats.evaluated >= PUPIL_MIN_EVALUATED_TOTAL &&
    perSideOk &&
    (stats.coverage ?? 0) >= PUPIL_MIN_COVERAGE &&
    args.visualAuditPassed;
  return pass ? 'PUPIL_DETECTION_PASS' : 'PUPIL_DETECTION_FAIL';
}

function pct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '?' : `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? '?' : value.toFixed(digits);
}

/** Copyable P3 technical report (single detector or mixed comparison). */
export function formatPupilReport(args: {
  stats: PupilAggregateStats;
  verdict: PupilDetectionVerdict;
  captureLabel: string;
}): string {
  const { stats, verdict } = args;
  const lines = [
    `P3 pupil detection — ${args.captureLabel}`,
    `Detector: ${stats.detectorId}`,
    ``,
    `Evaluated eye ROIs: ${stats.evaluated}`,
    `Successful pupil detections: ${stats.successes}`,
    `Failures: ${stats.failures}`,
    `Detection coverage: ${pct(stats.coverage)}`,
    `No fabricated positions: ${stats.noFabricatedPositions ? 'yes' : 'NO — FAIL'}`,
    ``,
  ];
  for (const side of stats.sides) {
    lines.push(
      `${side.eyeSide} eye: evaluated=${side.evaluated} success=${side.successes} ` +
        `coverage=${pct(side.coverage)} conf(mean/med/min/max)=${num(side.confidenceMean, 2)}/` +
        `${num(side.confidenceMedian, 2)}/${num(side.confidenceMin, 2)}/${num(side.confidenceMax, 2)} ` +
        `candWH(med)=${num(side.candidateWidthMedian, 1)}x${num(side.candidateHeightMedian, 1)} ` +
        `normXY(mean)=${num(side.normalizedXMean)}/${num(side.normalizedYMean)}`,
    );
    const reasons = Object.entries(side.failureReasons)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(' ');
    lines.push(`  failures: ${reasons === '' ? '(none)' : reasons}`);
  }
  if (stats.conditions.length > 0) {
    lines.push(``);
    for (const c of stats.conditions) {
      lines.push(
        `condition ${c.condition}: evaluated=${c.evaluated} success=${c.successes} coverage=${pct(c.coverage)}`,
      );
    }
  }
  lines.push(``, `Verdict:`, `${verdict}`);
  return lines.join('\n');
}

export type { PupilFailureReason };
