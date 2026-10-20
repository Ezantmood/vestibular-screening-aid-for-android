import {
  antiSaccadeScore,
  meanOrNull,
  npcBreak,
  oknAsymmetry,
  protocolRows,
  separationSeries,
  signedPhaseVelocity,
  slowPhaseVelocity,
  stepAccuracy,
} from './rules';
import type { ClinicTestId, EyeTrace, MetricRow, NormGroup } from './types';

export const RECORD_MS = 10_000;

/** Ruler centimetres only. Rejects empty, negative, and implausible values. */
export function parseNpcCm(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 40) return null;
  return Math.round(parsed * 10) / 10;
}

type Step = { tMs: number; from: number; to: number };

function jumpSteps(amplitude: number): Step[] {
  const steps: Step[] = [];
  let from = 0.5;
  let to = 0.5 - amplitude;
  for (let index = 1; index <= 9; index += 1) {
    steps.push({ tMs: index * 1000, from, to });
    from = to;
    to = to < 0.5 ? 0.5 + amplitude : 0.5 - amplitude;
  }
  return steps;
}

export function verticalJumpSteps(): Step[] {
  return jumpSteps(0.28);
}

export function antiJumpSteps(): Step[] {
  return jumpSteps(0.35);
}

export const GAZE_HOLD = { startMs: 1500, endMs: 8500, x: 0.78 };
export const OKN_WINDOWS = {
  left: [800, 4500] as const,
  right: [5800, 9500] as const,
};

export function positionAt(
  testId: ClinicTestId,
  elapsedMs: number,
): { x: number; y: number; stripe: 'left' | 'right' | null; phase: number; scale: number } {
  const elapsed = Math.max(0, Math.min(elapsedMs, RECORD_MS));
  if (testId === 'vertical-saccades') {
    let y = 0.5;
    for (const step of verticalJumpSteps()) if (elapsed >= step.tMs) y = step.to;
    return { x: 0.5, y, stripe: null, phase: 0, scale: 1 };
  }
  if (testId === 'anti-saccade') {
    let x = 0.5;
    for (const step of antiJumpSteps()) if (elapsed >= step.tMs) x = step.to;
    return { x, y: 0.5, stripe: null, phase: 0, scale: 1 };
  }
  if (testId === 'gaze-nystagmus') {
    const x = elapsed >= GAZE_HOLD.startMs ? GAZE_HOLD.x : 0.5;
    return { x, y: 0.5, stripe: null, phase: 0, scale: 1 };
  }
  if (testId === 'okn') {
    const stripe = elapsed < 5000 ? 'left' : 'right';
    return { x: 0.5, y: 0.5, stripe, phase: (elapsed % 700) / 700, scale: 1 };
  }
  const scale = 0.18 + 0.75 * (elapsed / RECORD_MS);
  return { x: 0.5, y: 0.5, stripe: null, phase: 0, scale };
}

export function extendedQuality(traces: readonly EyeTrace[]): 'RECORDED' | 'INVALID' {
  const points = traces.reduce((count, trace) => count + trace.points.length, 0);
  return points >= 8 ? 'RECORDED' : 'INVALID';
}

export function extendedRows(
  testId: ClinicTestId,
  traces: readonly EyeTrace[],
  group: NormGroup,
  npc: { cm: number | null; breakMs: number | null; recoveryMs: number | null },
  aligned: boolean,
): MetricRow[] {
  if (testId === 'vertical-saccades') {
    const accuracy = aligned
      ? meanOrNull(traces.map((trace) => stepAccuracy(trace, 'y', verticalJumpSteps()).accuracy))
      : null;
    return protocolRows(testId, group, { accuracy });
  }
  if (testId === 'anti-saccade') {
    const errorRate = aligned
      ? meanOrNull(traces.map((trace) => antiSaccadeScore(trace, antiJumpSteps()).errorRate))
      : null;
    return protocolRows(testId, group, { errorRate });
  }
  if (testId === 'gaze-nystagmus') {
    const slowVelocity = meanOrNull(
      traces.map((trace) => slowPhaseVelocity(trace, GAZE_HOLD.startMs, GAZE_HOLD.endMs)),
    );
    return protocolRows(testId, group, { slowVelocity }).map((row) =>
      aligned ? row : { ...row, unit: 'eye-region/s' },
    );
  }
  if (testId === 'okn') {
    const leftVelocity = meanOrNull(
      traces.map((trace) => signedPhaseVelocity(trace, OKN_WINDOWS.left[0], OKN_WINDOWS.left[1])),
    );
    const rightVelocity = meanOrNull(
      traces.map((trace) => signedPhaseVelocity(trace, OKN_WINDOWS.right[0], OKN_WINDOWS.right[1])),
    );
    return protocolRows(testId, group, { asymmetry: oknAsymmetry(leftVelocity, rightVelocity) });
  }
  if (testId === 'npc') {
    const left = traces.find((trace) => trace.eyeSide === 'left');
    const right = traces.find((trace) => trace.eyeSide === 'right');
    const auto =
      left && right ? npcBreak(separationSeries(left, right)) : { breakMs: null, recoveryMs: null };
    return protocolRows(testId, group, {
      npcCm: npc.cm,
      breakMs: npc.breakMs ?? auto.breakMs,
      recoveryMs: npc.recoveryMs ?? auto.recoveryMs,
    });
  }
  return [];
}
