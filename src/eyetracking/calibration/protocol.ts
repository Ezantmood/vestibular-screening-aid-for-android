import type { CalibrationTarget } from './types';

/** Engineering fixation sequence: nine fit points, four independent checks,
 * and a repeated center check for drift. Never a clinical test protocol. */
export const CALIBRATION_TARGETS: readonly CalibrationTarget[] = [
  ...[0.18, 0.5, 0.82].flatMap((y, row) =>
    [0.18, 0.5, 0.82].map((x, col) => ({ id: `fit-${row}-${col}`, x, y, role: 'fit' as const })),
  ),
  ...[0.32, 0.68].flatMap((y, row) =>
    [0.32, 0.68].map((x, col) => ({
      id: `check-${row}-${col}`,
      x,
      y,
      role: 'validation' as const,
    })),
  ),
  { id: 'check-center', x: 0.5, y: 0.5, role: 'validation' },
];
export const CALIBRATION_TAKE_SECONDS = 1.5;
