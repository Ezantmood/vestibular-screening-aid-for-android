// P3 pupil detectors — two lightweight image-processing candidates behind one
// interface. Both operate on a grayscale (luminance 0–255) eye ROI and assume
// a dark pupil inside the ROI. No ML model, no OpenCV: plain thresholding +
// connected components + evidence scoring.
//
// Shared pipeline per detector:
//  1. light smoothing (box blur) to suppress sensor noise,
//  2. thresholding (strategy-specific) → binary dark mask,
//  3. connected components (4-connectivity union-find),
//  4. geometric pre-filters (area / size / aspect),
//  5. evidence scoring (darkness, area, shape, centrality, border contact,
//     surround contrast) → confidence in [0,1],
//  6. best-candidate selection with explicit failure states.
//
// The darkest pixel is never blindly trusted: every candidate is scored and
// obviously invalid components are rejected. Detection may fail — failures
// carry null centroids, never fabricated positions.

import type { PupilDetectorId, PupilFailureReason } from './pupilTypes';

/** Grayscale eye ROI, luminance 0–255 in row-major order. */
export interface GrayImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface DetectorOutcome {
  success: boolean;
  centroidXInRoi: number | null;
  centroidYInRoi: number | null;
  candidateWidth: number | null;
  candidateHeight: number | null;
  confidence: number;
  failureReason: PupilFailureReason | null;
}

export interface PupilDetector {
  id: PupilDetectorId;
  detect(gray: GrayImage): DetectorOutcome;
}

/** Engineering feasibility gates (NOT clinical thresholds). */
export const MIN_PUPIL_CONFIDENCE = 0.35;
/** Position is not evidence that a blob is a pupil. Production weights keep this at 0. */
export const ACCEPTANCE_CENTER_WEIGHT = 0;
export const AMBIGUITY_SCORE_MARGIN = 0.05;
/** Ideal bbox fill ratio of a circle (pi/4); shape scoring anchor. */
const CIRCLE_FILL_RATIO = Math.PI / 4;

interface ComponentStats {
  /** Exact support: the bbox can contain unrelated dark blobs. */
  pixelIndices: number[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  /** Intensity-weighted sums for a sub-pixel centroid (weight = t − v). */
  wSumX: number;
  wSumY: number;
  wTotal: number;
  meanIntensity: number;
  touchesBorder: boolean;
}

interface ScoredCandidate extends ComponentStats {
  score: number;
  darkness: number;
  centrality: number;
  shape: number;
  areaPrior: number;
  borderPenalty: number;
  contrast: number;
}

function mean(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
  }
  return values.length > 0 ? sum / values.length : 0;
}

/** Separable-ish 3×3 (radius 1) or 7×7 (radius 3) box blur, clamped edges. */
export function boxBlur(
  src: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
): Float64Array {
  const tmp = new Float64Array(width * height);
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        sum += src[y * width + xx];
        count += 1;
      }
      tmp[y * width + x] = sum / count;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        sum += tmp[yy * width + x];
        count += 1;
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

/** Value at quantile q (0–1) over a luminance buffer. */
export function percentileValue(values: ArrayLike<number>, q: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const clampedQ = Math.min(1, Math.max(0, q));
  return sorted[Math.min(sorted.length - 1, Math.floor(clampedQ * sorted.length))];
}

/** 4-connectivity connected components over a binary mask (union-find). */
export function connectedComponents(
  mask: ArrayLike<number>,
  width: number,
  height: number,
): ComponentStats[] {
  const labels = new Int32Array(width * height);
  const parent: number[] = [0];
  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) {
      root = parent[root];
    }
    return root;
  };
  let nextLabel = 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!mask[idx]) {
        continue;
      }
      const left = x > 0 && mask[idx - 1] ? labels[idx - 1] : 0;
      const up = y > 0 && mask[idx - width] ? labels[idx - width] : 0;
      if (left === 0 && up === 0) {
        parent[nextLabel] = nextLabel;
        labels[idx] = nextLabel;
        nextLabel += 1;
      } else if (left !== 0 && up === 0) {
        labels[idx] = find(left);
      } else if (left === 0 && up !== 0) {
        labels[idx] = find(up);
      } else {
        const rl = find(left);
        const ru = find(up);
        labels[idx] = rl;
        if (rl !== ru) {
          parent[ru] = rl;
        }
      }
    }
  }
  const byRoot = new Map<number, ComponentStats>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!mask[idx]) {
        continue;
      }
      const root = find(labels[idx]);
      let entry = byRoot.get(root);
      if (!entry) {
        entry = {
          pixelIndices: [],
          area: 0,
          minX: x,
          minY: y,
          maxX: x,
          maxY: y,
          sumX: 0,
          sumY: 0,
          wSumX: 0,
          wSumY: 0,
          wTotal: 0,
          meanIntensity: 0,
          touchesBorder: false,
        };
        byRoot.set(root, entry);
      }
      entry.pixelIndices.push(idx);
      entry.area += 1;
      entry.minX = Math.min(entry.minX, x);
      entry.minY = Math.min(entry.minY, y);
      entry.maxX = Math.max(entry.maxX, x);
      entry.maxY = Math.max(entry.maxY, y);
      entry.sumX += x;
      entry.sumY += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        entry.touchesBorder = true;
      }
    }
  }
  return [...byRoot.values()];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Score one dark component. Evidence terms:
 * - darkness: how much darker than the ROI mean,
 * - areaPrior: prefers pupils covering ~1–12% of the ROI,
 * - shape: bbox fill ratio near pi/4 with an aspect-ratio penalty
 *   (ellipse plausibility proxy without a full ellipse fit),
 * - centrality is computed for diagnostics only. It is not part of the
 *   acceptance score: an off-center pupil is the gaze signal, not a worse pupil.
 * - borderPenalty: components touching the ROI border are suspect
 *   (clipped pupils have biased centroids; eyelashes and shadows too),
 * - contrast: candidate mean vs. surrounding ring brightness.
 */
export function scoreCandidate(
  comp: ComponentStats,
  args: {
    roiMean: number;
    roiWidth: number;
    roiHeight: number;
    surroundMean: number | null;
    weights: { darkness: number; area: number; shape: number; center: number; contrast: number };
  },
): ScoredCandidate {
  const roiArea = args.roiWidth * args.roiHeight;
  const boxW = comp.maxX - comp.minX + 1;
  const boxH = comp.maxY - comp.minY + 1;
  const compMean = comp.area > 0 ? comp.meanIntensity : args.roiMean;
  const darkness = clamp01((args.roiMean - compMean) / 128);
  const areaFrac = comp.area / Math.max(1, roiArea);
  const areaPrior =
    areaFrac <= 0 ? 0 : clamp01(1 - Math.abs(Math.log(areaFrac / 0.04)) / Math.log(20));
  const fillRatio = comp.area / Math.max(1, boxW * boxH);
  const aspect = Math.max(boxW, boxH) / Math.max(1, Math.min(boxW, boxH));
  const fillScore = clamp01(1 - Math.abs(fillRatio - CIRCLE_FILL_RATIO) / CIRCLE_FILL_RATIO);
  const aspectScore = clamp01(1 - (aspect - 1) / 1.5);
  const shape = 0.6 * fillScore + 0.4 * aspectScore;
  const cx = comp.sumX / Math.max(1, comp.area);
  const cy = comp.sumY / Math.max(1, comp.area);
  const dx = (cx - args.roiWidth / 2) / (args.roiWidth / 2);
  const dy = (cy - args.roiHeight / 2) / (args.roiHeight / 2);
  const centrality = clamp01(1 - Math.sqrt(dx * dx + dy * dy) / Math.SQRT2);
  const borderPenalty = comp.touchesBorder ? 0.35 : 0;
  const contrast = args.surroundMean === null ? 0.5 : clamp01((args.surroundMean - compMean) / 100);
  const w = args.weights;
  const wSum = w.darkness + w.area + w.shape + w.center + w.contrast;
  const score =
    (w.darkness * darkness +
      w.area * areaPrior +
      w.shape * shape +
      w.center * centrality +
      w.contrast * contrast) /
      Math.max(1e-9, wSum) -
    borderPenalty;
  return {
    ...comp,
    score: clamp01(score),
    darkness,
    centrality,
    shape,
    areaPrior,
    borderPenalty,
    contrast,
  };
}

/** Mean luminance in a dilated ring around the component bbox (surround). */
export function surroundMean(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  comp: ComponentStats,
  pad: number,
): number | null {
  const x0 = Math.max(0, comp.minX - pad);
  const y0 = Math.max(0, comp.minY - pad);
  const x1 = Math.min(width - 1, comp.maxX + pad);
  const y1 = Math.min(height - 1, comp.maxY + pad);
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const inside = x >= comp.minX && x <= comp.maxX && y >= comp.minY && y <= comp.maxY;
      if (inside) {
        continue;
      }
      sum += gray[y * width + x];
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

function finalizeNoCandidate(gray: GrayImage, maskFraction: number): DetectorOutcome {
  const roiMean = mean(gray.data);
  if (maskFraction > 0.4 || roiMean < 60) {
    // No isolated dark blob separated from the background: either a huge
    // dark fraction (heavy occlusion/shadow) or a uniformly dark ROI
    // (typically a closed eye showing eyelashes/eyelid). Heuristic,
    // documented as such — never a fabricated centroid.
    return {
      success: false,
      centroidXInRoi: null,
      centroidYInRoi: null,
      candidateWidth: null,
      candidateHeight: null,
      confidence: 0,
      failureReason: 'EYE_CLOSED_OR_OCCLUDED',
    };
  }
  return {
    success: false,
    centroidXInRoi: null,
    centroidYInRoi: null,
    candidateWidth: null,
    candidateHeight: null,
    confidence: 0,
    failureReason: 'NO_PUPIL_CANDIDATE',
  };
}

function selectBest(
  scored: ScoredCandidate[],
  gray: GrayImage,
  threshold: number,
  maskFraction: number,
): DetectorOutcome {
  if (scored.length === 0) {
    return finalizeNoCandidate(gray, maskFraction);
  }
  const ordered = [...scored].sort((a, b) => b.score - a.score);
  const best = ordered[0];
  const runnerUp = ordered.length > 1 ? ordered[1] : null;
  if (
    runnerUp !== null &&
    best.score - runnerUp.score < AMBIGUITY_SCORE_MARGIN &&
    runnerUp.score >= threshold
  ) {
    return {
      success: false,
      centroidXInRoi: null,
      centroidYInRoi: null,
      candidateWidth: null,
      candidateHeight: null,
      confidence: best.score,
      failureReason: 'AMBIGUOUS_CANDIDATES',
    };
  }
  if (best.score < threshold) {
    return {
      success: false,
      centroidXInRoi: null,
      centroidYInRoi: null,
      candidateWidth: null,
      candidateHeight: null,
      confidence: best.score,
      failureReason: 'LOW_CONFIDENCE',
    };
  }
  const cx = best.wTotal > 0 ? best.wSumX / best.wTotal : best.sumX / Math.max(1, best.area);
  const cy = best.wTotal > 0 ? best.wSumY / best.wTotal : best.sumY / Math.max(1, best.area);
  return {
    success: true,
    centroidXInRoi: cx,
    centroidYInRoi: cy,
    candidateWidth: best.maxX - best.minX + 1,
    candidateHeight: best.maxY - best.minY + 1,
    confidence: best.score,
    failureReason: null,
  };
}

function prepareComponents(
  gray: GrayImage,
  smoothed: ArrayLike<number>,
  threshold: number,
): { comps: ComponentStats[]; maskFraction: number } {
  const n = gray.width * gray.height;
  const mask = new Uint8Array(n);
  let dark = 0;
  for (let i = 0; i < n; i += 1) {
    // Keep pixels on the quantized cutoff; otherwise a pupil plateau can vanish.
    if (smoothed[i] <= threshold) {
      mask[i] = 1;
      dark += 1;
    }
  }
  const raw = connectedComponents(mask, gray.width, gray.height);
  const roiArea = Math.max(1, n);
  const comps: ComponentStats[] = [];
  for (const c of raw) {
    const areaFrac = c.area / roiArea;
    if (areaFrac < 0.003 || areaFrac > 0.28) {
      continue;
    }
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    if (bw < 6 || bh < 6) {
      continue;
    }
    if (Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) > 2.5) {
      continue;
    }
    // Accumulate raw intensities + intensity weights for centroiding.
    let sum = 0;
    let wTotal = 0;
    let wSumX = 0;
    let wSumY = 0;
    for (const idx of c.pixelIndices) {
      const v = gray.data[idx];
      sum += v;
      const w = Math.max(0, threshold - v);
      wTotal += w;
      wSumX += (idx % gray.width) * w;
      wSumY += Math.floor(idx / gray.width) * w;
    }
    c.meanIntensity = c.area > 0 ? sum / c.area : threshold;
    c.wSumX = wSumX;
    c.wSumY = wSumY;
    c.wTotal = wTotal;
    comps.push(c);
  }
  return { comps, maskFraction: dark / roiArea };
}

function scoreAll(
  gray: GrayImage,
  smoothed: ArrayLike<number>,
  comps: ComponentStats[],
  weights: { darkness: number; area: number; shape: number; center: number; contrast: number },
): ScoredCandidate[] {
  const roiMean = mean(smoothed);
  return comps.map((c) =>
    scoreCandidate(c, {
      roiMean,
      roiWidth: gray.width,
      roiHeight: gray.height,
      surroundMean: surroundMean(gray.data, gray.width, gray.height, c, 6),
      weights,
    }),
  );
}

function invalidGeometry(): DetectorOutcome {
  return {
    success: false,
    centroidXInRoi: null,
    centroidYInRoi: null,
    candidateWidth: null,
    candidateHeight: null,
    confidence: 0,
    failureReason: 'INVALID_GEOMETRY',
  };
}

function checkGeometry(gray: GrayImage): boolean {
  if (!Number.isFinite(gray.width) || !Number.isFinite(gray.height)) {
    return false;
  }
  if (gray.width < 24 || gray.height < 24) {
    return false;
  }
  if (gray.data.length < gray.width * gray.height) {
    return false;
  }
  return true;
}

/**
 * Candidate A — percentile-dark. The gate is the darkest 4% of the smoothed
 * eye crop, not 12%. On the Redmi front camera a 12% gate joined the pupil to
 * the eyelid (a tall blob that the aspect filter then discarded), so a
 * fixation produced no pupil sample. 4% stays on the darker pupil core.
 */
export const percentileDarkDetector: PupilDetector = {
  id: 'percentile-dark',
  detect(gray: GrayImage): DetectorOutcome {
    if (!checkGeometry(gray)) {
      return invalidGeometry();
    }
    const smoothed = boxBlur(gray.data, gray.width, gray.height, 1);
    const rawThreshold = percentileValue(smoothed, 0.04);
    const threshold = Math.min(110, Math.max(25, rawThreshold));
    const { comps, maskFraction } = prepareComponents(gray, smoothed, threshold);
    const scored = scoreAll(gray, smoothed, comps, {
      darkness: 2,
      area: 2,
      shape: 2,
      center: ACCEPTANCE_CENTER_WEIGHT,
      contrast: 1,
    });
    return selectBest(scored, gray, MIN_PUPIL_CONFIDENCE, maskFraction);
  },
};

/** 3×3 binary morphological opening (erode then dilate) on a mask. */
export function binaryOpen(mask: Uint8Array, width: number, height: number): Uint8Array {
  const eroded = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let all = true;
      for (let ky = -1; ky <= 1 && all; ky += 1) {
        for (let kx = -1; kx <= 1 && all; kx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + kx));
          const yy = Math.min(height - 1, Math.max(0, y + ky));
          if (!mask[yy * width + xx]) {
            all = false;
          }
        }
      }
      eroded[y * width + x] = all ? 1 : 0;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let any = false;
      for (let ky = -1; ky <= 1 && !any; ky += 1) {
        for (let kx = -1; kx <= 1 && !any; kx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + kx));
          const yy = Math.min(height - 1, Math.max(0, y + ky));
          if (eroded[yy * width + xx]) {
            any = true;
          }
        }
      }
      out[y * width + x] = any ? 1 : 0;
    }
  }
  return out;
}

/**
 * Candidate B — contrast-normalized: stretch the smoothed ROI so its 2nd–98th
 * percentile spans the full 0–255 range (removes global illumination / soft
 * shading differences between recordings), then apply the same relative
 * percentile gate on the stretched image with a morphological open to cut
 * eyelash-thin noise. Weights shape evidence higher (ellipse plausibility
 * matters more once contrast is normalized). ROIs with almost no contrast
 * range are rejected outright instead of guessing.
 */
export const contrastNormalizedDetector: PupilDetector = {
  id: 'contrast-normalized',
  detect(gray: GrayImage): DetectorOutcome {
    if (!checkGeometry(gray)) {
      return invalidGeometry();
    }
    const smoothed = boxBlur(gray.data, gray.width, gray.height, 1);
    const lo = percentileValue(smoothed, 0.02);
    const hi = percentileValue(smoothed, 0.98);
    if (hi - lo < 8) {
      return {
        success: false,
        centroidXInRoi: null,
        centroidYInRoi: null,
        candidateWidth: null,
        candidateHeight: null,
        confidence: 0,
        failureReason: 'NO_PUPIL_CANDIDATE',
      };
    }
    const n = gray.width * gray.height;
    const stretched = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const v = ((smoothed[i] - lo) / (hi - lo)) * 255;
      stretched[i] = Math.min(255, Math.max(0, v));
    }
    const absCut = Math.min(110, Math.max(25, percentileValue(stretched, 0.12)));
    const mask = new Uint8Array(n);
    let dark = 0;
    for (let i = 0; i < n; i += 1) {
      if (stretched[i] <= absCut) {
        mask[i] = 1;
        dark += 1;
      }
    }
    const opened = binaryOpen(mask, gray.width, gray.height);
    const raw = connectedComponents(opened, gray.width, gray.height);
    const roiArea = Math.max(1, n);
    const comps: ComponentStats[] = [];
    for (const c of raw) {
      const areaFrac = c.area / roiArea;
      if (areaFrac < 0.003 || areaFrac > 0.28) {
        continue;
      }
      const bw = c.maxX - c.minX + 1;
      const bh = c.maxY - c.minY + 1;
      if (bw < 6 || bh < 6) {
        continue;
      }
      if (Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) > 2.5) {
        continue;
      }
      let sum = 0;
      let wTotal = 0;
      let wSumX = 0;
      let wSumY = 0;
      for (const idx of c.pixelIndices) {
        const v = gray.data[idx];
        sum += v;
        const w = Math.max(0, absCut - stretched[idx]);
        wTotal += w;
        wSumX += (idx % gray.width) * w;
        wSumY += Math.floor(idx / gray.width) * w;
      }
      c.meanIntensity = c.area > 0 ? sum / c.area : absCut;
      c.wSumX = wSumX;
      c.wSumY = wSumY;
      c.wTotal = wTotal;
      comps.push(c);
    }
    const scored = scoreAll(gray, smoothed, comps, {
      darkness: 1,
      area: 2,
      shape: 3,
      center: ACCEPTANCE_CENTER_WEIGHT,
      contrast: 2,
    });
    return selectBest(scored, gray, MIN_PUPIL_CONFIDENCE, dark / roiArea);
  },
};

export const PUPIL_DETECTORS: PupilDetector[] = [
  percentileDarkDetector,
  contrastNormalizedDetector,
];

export function getPupilDetector(id: PupilDetectorId): PupilDetector {
  const found = PUPIL_DETECTORS.find((d) => d.id === id);
  if (!found) {
    throw new Error(`Unknown pupil detector: ${id}.`);
  }
  return found;
}
