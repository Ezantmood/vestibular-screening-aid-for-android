import type { MvpTestId } from '../types';

/** Display fractions; no visual-angle or gaze calibration is implied. */
export interface StimulusConfig {
  testId: MvpTestId;
  durationUs: number;
  amplitude: number;
  pursuitPeriodUs: number;
  saccadeHoldUs: number;
}
export interface TargetPosition {
  x: number;
  y: number;
  segment: number;
}
export interface Presentation extends TargetPosition {
  elapsedUs: number;
  requestedElapsedUs: number;
}
export interface StimulusRun {
  config: StimulusConfig;
  startJsUs: number;
  endJsUs: number | null;
  outcome: 'running' | 'completed' | 'cancelled';
  /** React commit times, not measured photon onset times. */
  presentations: Presentation[];
}
export const defaultStimulus = (testId: MvpTestId): StimulusConfig => ({
  testId,
  durationUs: 10_000_000,
  amplitude: 0.35,
  pursuitPeriodUs: 4_000_000,
  saccadeHoldUs: 1_000_000,
});
export function validateStimulus(c: StimulusConfig): void {
  if (
    !['smooth-pursuit', 'horizontal-saccades'].includes(c.testId) ||
    !Number.isFinite(c.durationUs) ||
    c.durationUs <= 0 ||
    c.durationUs > 30_000_000 ||
    !Number.isFinite(c.amplitude) ||
    c.amplitude <= 0 ||
    c.amplitude > 0.45 ||
    !Number.isFinite(c.pursuitPeriodUs) ||
    c.pursuitPeriodUs < 100_000 ||
    !Number.isFinite(c.saccadeHoldUs) ||
    c.saccadeHoldUs < 100_000
  ) {
    throw new Error('Invalid stimulus configuration.');
  }
}
/** Absolute elapsed time prevents timer drift; half-open [0, duration) session. */
export function targetAt(c: StimulusConfig, elapsedUs: number): TargetPosition | null {
  validateStimulus(c);
  if (!Number.isFinite(elapsedUs) || elapsedUs < 0 || elapsedUs >= c.durationUs) return null;
  if (c.testId === 'smooth-pursuit') {
    return {
      x: 0.5 + c.amplitude * Math.sin((2 * Math.PI * elapsedUs) / c.pursuitPeriodUs),
      y: 0.5,
      segment: Math.floor(elapsedUs / c.pursuitPeriodUs),
    };
  }
  const segment = Math.floor(elapsedUs / c.saccadeHoldUs);
  // Center fixation first; subsequently alternate left/right without sliding.
  return {
    x: segment === 0 ? 0.5 : 0.5 + (segment % 2 === 1 ? -1 : 1) * c.amplitude,
    y: 0.5,
    segment,
  };
}
export function beginStimulus(config: StimulusConfig, startJsUs: number): StimulusRun {
  validateStimulus(config);
  if (!Number.isFinite(startJsUs) || startJsUs < 0) throw new Error('Invalid start clock.');
  return { config: { ...config }, startJsUs, endJsUs: null, outcome: 'running', presentations: [] };
}
export function recordPresentation(
  run: StimulusRun,
  target: TargetPosition,
  requestedElapsedUs: number,
  commitJsUs: number,
): void {
  const elapsedUs = commitJsUs - run.startJsUs;
  const last = run.presentations.at(-1);
  if (run.outcome !== 'running' || elapsedUs < 0 || elapsedUs >= run.config.durationUs) return;
  if (
    ![elapsedUs, requestedElapsedUs, target.x, target.y, target.segment].every(Number.isFinite) ||
    requestedElapsedUs < 0 ||
    requestedElapsedUs > elapsedUs ||
    target.x < 0 ||
    target.x > 1 ||
    target.y < 0 ||
    target.y > 1 ||
    (last !== undefined && elapsedUs <= last.elapsedUs)
  )
    throw new Error('Invalid presentation.');
  run.presentations.push({ ...target, elapsedUs, requestedElapsedUs });
}
export function finishStimulus(run: StimulusRun, nowJsUs: number, cancelled: boolean): void {
  if (run.outcome !== 'running') return;
  if (!Number.isFinite(nowJsUs) || nowJsUs < run.startJsUs) throw new Error('Invalid end clock.');
  run.endJsUs = nowJsUs;
  run.outcome = cancelled ? 'cancelled' : 'completed';
}
