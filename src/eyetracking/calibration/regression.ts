import type { GazeModelFamily, GazeRegression } from './types';

export interface RegressionPoint {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}
export interface RegressionCandidate {
  family: GazeModelFamily;
  lambda: number;
}
export interface FeatureBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export const REGRESSION_CANDIDATES: readonly RegressionCandidate[] = [
  { family: 'affine', lambda: 0 },
  ...(['affine-ridge', 'quadratic-ridge'] as const).flatMap((family) =>
    [0.001, 0.01, 0.1, 1].map((lambda) => ({ family, lambda })),
  ),
];
const terms = (family: GazeModelFamily, x: number, y: number) =>
  family === 'quadratic-ridge' ? [1, x, y, x * x, x * y, y * y] : [1, x, y];

/** Householder QR on augmented ridge rows. Avoid squaring the condition number
 * through normal equations. Intercept is never penalized. */
function leastSquares(rows: number[][], values: number[], lambda: number): number[] | null {
  const n = rows[0].length;
  const a = rows.map((r, i) => [...r, values[i]]);
  if (lambda > 0)
    for (let i = 1; i < n; i++)
      a.push([...Array.from({ length: n }, (_, j) => (i === j ? Math.sqrt(lambda) : 0)), 0]);
  for (let k = 0; k < n; k++) {
    const norm = Math.hypot(...a.slice(k).map((r) => r[k]));
    if (!Number.isFinite(norm) || norm < 1e-10) return null;
    const v = a.slice(k).map((r) => r[k]);
    v[0] += v[0] >= 0 ? norm : -norm;
    const vNorm = Math.hypot(...v);
    if (!(vNorm > 0)) return null;
    for (let i = 0; i < v.length; i++) v[i] /= vNorm;
    for (let j = k; j <= n; j++) {
      const dot = v.reduce((s, value, i) => s + value * a[k + i][j], 0);
      for (let i = 0; i < v.length; i++) a[k + i][j] -= 2 * v[i] * dot;
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let rhs = a[i][n];
    for (let j = i + 1; j < n; j++) rhs -= a[i][j] * solution[j];
    solution[i] = rhs / a[i][i];
  }
  return solution.every(Number.isFinite) ? solution : null;
}

export function evaluateRegression(model: GazeRegression, x: number, y: number) {
  const row = terms(
    model.family,
    (x - model.featureCenter.x) / model.featureScale.x,
    (y - model.featureCenter.y) / model.featureScale.y,
  );
  return {
    x: row.reduce((s, v, i) => s + v * model.coefficientsX[i], 0),
    y: row.reduce((s, v, i) => s + v * model.coefficientsY[i], 0),
  };
}

export function validRegression(value: GazeRegression): boolean {
  try {
    const size = value.family === 'quadratic-ridge' ? 6 : 3;
    return (
      REGRESSION_CANDIDATES.some((c) => c.family === value.family && c.lambda === value.lambda) &&
      [
        value.featureCenter.x,
        value.featureCenter.y,
        value.featureScale.x,
        value.featureScale.y,
      ].every(Number.isFinite) &&
      value.featureScale.x > 0 &&
      value.featureScale.y > 0 &&
      value.coefficientsX.length === size &&
      value.coefficientsY.length === size &&
      [...value.coefficientsX, ...value.coefficientsY].every(Number.isFinite)
    );
  } catch {
    return false;
  }
}

export function fitRegression(
  points: readonly RegressionPoint[],
  candidate: RegressionCandidate,
): GazeRegression | null {
  if (
    points.length < 3 ||
    !REGRESSION_CANDIDATES.some(
      (c) => c.family === candidate.family && c.lambda === candidate.lambda,
    ) ||
    points.some((p) => ![p.x, p.y, p.targetX, p.targetY].every(Number.isFinite))
  )
    return null;
  const mean = (axis: 'x' | 'y') => points.reduce((s, p) => s + p[axis], 0) / points.length;
  const featureCenter = { x: mean('x'), y: mean('y') };
  const sd = (axis: 'x' | 'y') =>
    Math.sqrt(points.reduce((s, p) => s + (p[axis] - featureCenter[axis]) ** 2, 0) / points.length);
  const featureScale = { x: sd('x'), y: sd('y') };
  if (featureScale.x <= Number.EPSILON || featureScale.y <= Number.EPSILON) return null;
  const rows = points.map((p) =>
    terms(
      candidate.family,
      (p.x - featureCenter.x) / featureScale.x,
      (p.y - featureCenter.y) / featureScale.y,
    ),
  );
  const coefficientsX = leastSquares(
    rows,
    points.map((p) => p.targetX),
    candidate.lambda,
  );
  const coefficientsY = leastSquares(
    rows,
    points.map((p) => p.targetY),
    candidate.lambda,
  );
  return coefficientsX && coefficientsY
    ? { ...candidate, featureCenter, featureScale, coefficientsX, coefficientsY }
    : null;
}
export const regressionRmse = (model: GazeRegression, points: readonly RegressionPoint[]) =>
  Math.sqrt(
    points.reduce((s, p) => {
      const prediction = evaluateRegression(model, p.x, p.y);
      return s + (prediction.x - p.targetX) ** 2 + (prediction.y - p.targetY) ** 2;
    }, 0) / points.length,
  );
export const regressionBounds = (points: readonly { x: number; y: number }[]): FeatureBounds => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxY: Math.max(...points.map((p) => p.y)),
});

/** The quadratic Jacobian determinant is quadratic. Evaluate ALL rectangle
 * extrema (corners, edge stationary points and an interior critical point),
 * rather than hoping that a sparse test grid detects a fold. */
export function regressionGeometrySafe(model: GazeRegression, bounds: FeatureBounds): boolean {
  if (!validRegression(model)) return false;
  const a = model.coefficientsX,
    b = model.coefficientsY;
  const determinant = (x: number, y: number) => {
    if (model.family !== 'quadratic-ridge') return a[1] * b[2] - a[2] * b[1];
    return (
      (a[1] + 2 * a[3] * x + a[4] * y) * (b[2] + b[4] * x + 2 * b[5] * y) -
      (a[2] + a[4] * x + 2 * a[5] * y) * (b[1] + 2 * b[3] * x + b[4] * y)
    );
  };
  const x0 = (bounds.minX - model.featureCenter.x) / model.featureScale.x;
  const x1 = (bounds.maxX - model.featureCenter.x) / model.featureScale.x;
  const y0 = (bounds.minY - model.featureCenter.y) / model.featureScale.y;
  const y1 = (bounds.maxY - model.featureCenter.y) / model.featureScale.y;
  if (![x0, x1, y0, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return false;
  const c = determinant(0, 0);
  const dx = (determinant(1, 0) - determinant(-1, 0)) / 2;
  const dy = (determinant(0, 1) - determinant(0, -1)) / 2;
  const xx = (determinant(1, 0) + determinant(-1, 0)) / 2 - c;
  const yy = (determinant(0, 1) + determinant(0, -1)) / 2 - c;
  const xy = determinant(1, 1) - c - dx - dy - xx - yy;
  const values: number[] = [];
  const add = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y) && x >= x0 && x <= x1 && y >= y0 && y <= y1)
      values.push(determinant(x, y));
  };
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) add(x, y);
    if (yy !== 0) add(x, -(dy + xy * x) / (2 * yy));
  }
  for (const y of [y0, y1]) if (xx !== 0) add(-(dx + xy * y) / (2 * xx), y);
  const hessian = 4 * xx * yy - xy * xy;
  if (hessian !== 0) add((xy * dy - 2 * yy * dx) / hessian, (xy * dx - 2 * xx * dy) / hessian);
  if (!values.length || !values.every(Number.isFinite)) return false;
  return Math.min(...values) > 1e-8 || Math.max(...values) < -1e-8;
}

/** Selection sees fit targets ONLY. All normalization and regularization are
 * refit within each leave-one-target-out fold. Never split neighboring frames. */
export function selectRegression(points: readonly RegressionPoint[]) {
  const bounds = regressionBounds(points);
  const candidates = REGRESSION_CANDIDATES.flatMap((candidate) => {
    const regression = fitRegression(points, candidate);
    if (!regression) return [];
    const errors: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const fold = fitRegression(
        points.filter((_, j) => i !== j),
        candidate,
      );
      if (!fold) return [];
      const p = evaluateRegression(fold, points[i].x, points[i].y);
      errors.push((p.x - points[i].targetX) ** 2 + (p.y - points[i].targetY) ** 2);
    }
    const fitCvRmse = Math.sqrt(errors.reduce((s, e) => s + e, 0) / errors.length);
    const fitRmse = regressionRmse(regression, points);
    if (![fitCvRmse, fitRmse].every(Number.isFinite)) return [];
    return [
      { regression, fitCvRmse, fitRmse, geometrySafe: regressionGeometrySafe(regression, bounds) },
    ];
  });
  const eligible = candidates.filter((c) => c.geometrySafe);
  const best = eligible.reduce<(typeof eligible)[number] | null>(
    (best, c) => (!best || c.fitCvRmse < best.fitCvRmse - 1e-10 ? c : best),
    null,
  );
  const affine = eligible.find((c) => c.regression.family === 'affine');
  // Prefer the baseline unless a more complex model improves CV by ≥10%.
  const selected =
    best && affine && best !== affine && best.fitCvRmse > affine.fitCvRmse * 0.9 ? affine : best;
  return { selected, candidates };
}
