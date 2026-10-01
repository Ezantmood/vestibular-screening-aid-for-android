// P3 synthetic logic checks — runs with plain node after `tsc` compile to
// /tmp (see header command). Covers: centroid calculation, coordinate
// transforms, ROI-to-frame mapping, normalized coords, candidate scoring,
// failure handling, rotation mapping, both detectors, report/verdict gates.
//
// Run: npx tsc <files> --outDir /tmp/p3check ... && node /tmp/p3check/check.js
import {
  binaryOpen,
  boxBlur,
  connectedComponents,
  contrastNormalizedDetector,
  getPupilDetector,
  percentileDarkDetector,
  percentileValue,
  scoreCandidate,
  type GrayImage,
} from '../src/eyetracking/pupil/detectors';
import {
  buildSuccessResult,
  frameToRoi,
  isValidRoiBox,
  mapBoxFromRotatedToOriginal,
  mapPointFromRotatedToOriginal,
  normalizeInRoi,
  roiToFrame,
} from '../src/eyetracking/pupil/coordinates';
import type { PupilDetectionResult } from '../src/eyetracking/pupil/pupilTypes';
import {
  aggregatePupilStats,
  formatPupilReport,
  pupilDetectionVerdict,
} from '../src/eyetracking/pupil/pupilReport';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL - ${name} ${detail}`);
  }
}
function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

/** Synthetic eye ROI: bright bg with a dark disk pupil + lighter iris ring. */
function syntheticEye(w: number, h: number, cx: number, cy: number, r: number): GrayImage {
  const data = new Float64Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      let v = 190; // sclera-ish bright
      if (d < r * 1.9) {
        v = 110; // iris ring
      }
      if (d < r) {
        v = 25; // pupil dark
      }
      data[y * w + x] = v;
    }
  }
  return { width: w, height: h, data };
}

// 1. Centroid calculation — both detectors find the synthetic pupil center.
for (const det of [percentileDarkDetector, contrastNormalizedDetector]) {
  const out = det.detect(syntheticEye(120, 120, 60, 62, 16));
  check(
    `${det.id} finds centered pupil`,
    out.success &&
      out.centroidXInRoi !== null &&
      approx(out.centroidXInRoi, 60, 3) &&
      out.centroidYInRoi !== null &&
      approx(out.centroidYInRoi, 62, 3),
    JSON.stringify(out),
  );
}
// Off-center pupil.
{
  const out = percentileDarkDetector.detect(syntheticEye(140, 100, 95, 30, 14));
  check(
    'percentile-dark finds off-center pupil',
    out.success &&
      out.centroidXInRoi !== null &&
      approx(out.centroidXInRoi, 95, 3) &&
      out.centroidYInRoi !== null &&
      approx(out.centroidYInRoi, 30, 3),
    JSON.stringify(out),
  );
}

// 2. Coordinate transforms.
{
  const box = { roiX: 800, roiY: 400, roiWidth: 150, roiHeight: 140 };
  const f = roiToFrame(box, 30.5, 70.25);
  check('roiToFrame translates', f.x === 830.5 && f.y === 470.25, JSON.stringify(f));
  const n = normalizeInRoi(box, 75, 70);
  check('normalizeInRoi centers', approx(n.x, 0.5, 1e-9) && approx(n.y, 0.5, 1e-9));
  const back = frameToRoi(box, f.x, f.y);
  check('frameToRoi round-trips', approx(back.x, 30.5, 1e-9) && approx(back.y, 70.25, 1e-9));
  check('valid ROI accepted', isValidRoiBox(box, 1920, 1080));
  check(
    'zero-size ROI rejected',
    !isValidRoiBox({ roiX: 0, roiY: 0, roiWidth: 0, roiHeight: 10 }, 1920, 1080),
  );
  check(
    'out-of-frame ROI rejected',
    !isValidRoiBox({ roiX: 1900, roiY: 0, roiWidth: 100, roiHeight: 100 }, 1920, 1080),
  );
}

// 3. ROI-to-frame mapping + normalized coords in a success result.
{
  const r = buildSuccessResult({
    frameIndex: 7,
    decodedPtsUs: 58331,
    eyeSide: 'left',
    detectorId: 'percentile-dark',
    box: { roiX: 800, roiY: 400, roiWidth: 150, roiHeight: 140 },
    centroid: {
      centroidXInRoi: 75,
      centroidYInRoi: 70,
      candidateWidth: 32,
      candidateHeight: 30,
      confidence: 0.8,
    },
  });
  check(
    'buildSuccessResult frame mapping',
    r.centroidXInFrame === 875 && r.centroidYInFrame === 470,
  );
  check(
    'buildSuccessResult normalized',
    approx(r.normalizedX ?? -1, 0.5, 1e-9) && approx(r.normalizedY ?? -1, 0.5, 1e-9),
  );
  check('success has null failureReason', r.failureReason === null);
}

// 4. Candidate scoring — circle beats elongated bar.
{
  const w = 60;
  const h = 60;
  const circle = {
    area: 300,
    minX: 20,
    minY: 20,
    maxX: 39,
    maxY: 39,
    sumX: 20 * 300,
    sumY: 20 * 300,
    wSumX: 0,
    wSumY: 0,
    wTotal: 0,
    meanIntensity: 20,
    touchesBorder: false,
  };
  const bar = {
    area: 300,
    minX: 5,
    minY: 28,
    maxX: 54,
    maxY: 33,
    sumX: 5 * 300,
    sumY: 28 * 300,
    wSumX: 0,
    wSumY: 0,
    wTotal: 0,
    meanIntensity: 20,
    touchesBorder: false,
  };
  const weights = { darkness: 2, area: 2, shape: 2, center: 1, contrast: 1 };
  const sCircle = scoreCandidate(circle, {
    roiMean: 150,
    roiWidth: w,
    roiHeight: h,
    surroundMean: 170,
    weights,
  });
  const sBar = scoreCandidate(bar, {
    roiMean: 150,
    roiWidth: w,
    roiHeight: h,
    surroundMean: 170,
    weights,
  });
  check('circle outscores bar', sCircle.score > sBar.score, `${sCircle.score} vs ${sBar.score}`);
  const border = scoreCandidate(
    { ...circle, touchesBorder: true },
    { roiMean: 150, roiWidth: w, roiHeight: h, surroundMean: 170, weights },
  );
  check('border contact penalized', border.score < sCircle.score);
}

// 5. Failure handling.
{
  // Uniform bright ROI (open eye, no dark blob) → NO_PUPIL_CANDIDATE.
  const flat = { width: 100, height: 100, data: new Float64Array(100 * 100).fill(180) };
  const flatOut = percentileDarkDetector.detect(flat);
  check(
    'flat ROI has no candidate',
    !flatOut.success && flatOut.failureReason === 'NO_PUPIL_CANDIDATE',
    JSON.stringify(flatOut),
  );
  check(
    'failure centroids are null',
    flatOut.centroidXInRoi === null && flatOut.centroidYInRoi === null,
  );
  // Tiny ROI → INVALID_GEOMETRY.
  const tiny = percentileDarkDetector.detect({
    width: 10,
    height: 10,
    data: new Float64Array(100).fill(30),
  });
  check('tiny ROI invalid geometry', !tiny.success && tiny.failureReason === 'INVALID_GEOMETRY');
  // Two identical dark disks with identical surroundings → AMBIGUOUS.
  const paintDisk = (img: GrayImage, cx: number, cy: number, r: number): void => {
    const pixels = img.data as Float64Array;
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (d < r * 1.9) {
          pixels[y * img.width + x] = 110;
        }
        if (d < r) {
          pixels[y * img.width + x] = 25;
        }
      }
    }
  };
  const twoData = new Float64Array(160 * 80).fill(190);
  const two: GrayImage = { width: 160, height: 80, data: twoData };
  paintDisk(two, 40, 40, 14);
  paintDisk(two, 120, 40, 14);
  const twoOut = percentileDarkDetector.detect(two);
  check(
    'twin pupils ambiguous',
    !twoOut.success && twoOut.failureReason === 'AMBIGUOUS_CANDIDATES',
    JSON.stringify(twoOut),
  );
  // Mostly dark ROI (closed eye) → EYE_CLOSED_OR_OCCLUDED.
  const dark = { width: 80, height: 80, data: new Float64Array(80 * 80).fill(35) };
  const darkOut = percentileDarkDetector.detect(dark);
  check(
    'dark ROI closed/occluded',
    !darkOut.success && darkOut.failureReason === 'EYE_CLOSED_OR_OCCLUDED',
    JSON.stringify(darkOut),
  );
  // Unknown detector id throws.
  let threw = false;
  try {
    getPupilDetector('nonexistent' as never);
  } catch {
    threw = true;
  }
  check('unknown detector throws', threw);
}

// 6. Rotation mapping mirrors P2 native math.
{
  const p90 = mapPointFromRotatedToOriginal(10, 20, 90, 1920, 1080);
  check('rot90 point maps', p90.x === 20 && p90.y === 1080 - 1 - 10, JSON.stringify(p90));
  const p270 = mapPointFromRotatedToOriginal(10, 20, 270, 1920, 1080);
  check('rot270 point maps', p270.x === 1920 - 1 - 20 && p270.y === 10, JSON.stringify(p270));
  const b90 = mapBoxFromRotatedToOriginal(10, 20, 30, 40, 90, 1920, 1080);
  check(
    'rot90 box maps',
    b90.left === 20 &&
      b90.right === 40 &&
      b90.top === 1080 - 1 - 30 &&
      b90.bottom === 1080 - 1 - 10,
    JSON.stringify(b90),
  );
  const ident = mapPointFromRotatedToOriginal(5, 6, 0, 1920, 1080);
  check('rot0 identity', ident.x === 5 && ident.y === 6);
}

// 7. Primitives: blur smooths, percentile + CC + open behave.
{
  const img = new Float64Array([0, 0, 0, 0, 255, 0, 0, 0, 0]);
  const blurred = boxBlur(img, 3, 3, 1);
  check('boxBlur spreads impulse', blurred[4] < 255 && blurred[4] > 0, `${blurred[4]}`);
  check(
    'percentile p0/p100',
    percentileValue([3, 1, 2], 0) === 1 && percentileValue([3, 1, 2], 1) === 3,
  );
  const mask = new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0, 1]);
  const comps = connectedComponents(mask, 3, 3);
  check(
    'CC finds two components',
    comps.length === 2 && comps.reduce((a, c) => a + c.area, 0) === 3,
  );
  const noisy = new Uint8Array(25);
  noisy[12] = 1; // isolated pixel
  const opened = binaryOpen(noisy, 5, 5);
  check(
    'binaryOpen removes speckle',
    opened.every((v) => v === 0),
  );
}

// 8. Report aggregation + verdict gates.
{
  const mk = (i: number, side: 'left' | 'right', ok: boolean): PupilDetectionResult => ({
    frameIndex: i,
    decodedPtsUs: i * 8333,
    eyeSide: side,
    detectorId: 'percentile-dark',
    roiX: 0,
    roiY: 0,
    roiWidth: 100,
    roiHeight: 100,
    centroidXInRoi: ok ? 50 : null,
    centroidYInRoi: ok ? 52 : null,
    centroidXInFrame: ok ? 50 : null,
    centroidYInFrame: ok ? 52 : null,
    normalizedX: ok ? 0.5 : null,
    normalizedY: ok ? 0.52 : null,
    candidateWidth: ok ? 30 : null,
    candidateHeight: ok ? 28 : null,
    confidence: ok ? 0.7 : 0.1,
    failureReason: ok ? null : 'NO_PUPIL_CANDIDATE',
  });
  const results: PupilDetectionResult[] = [];
  for (let i = 0; i < 14; i += 1) {
    results.push(mk(i, 'left', i < 10));
    results.push(mk(i, 'right', i < 9));
  }
  const stats = aggregatePupilStats(results);
  check(
    'aggregate counts',
    stats.evaluated === 28 && stats.successes === 19,
    `${stats.evaluated}/${stats.successes}`,
  );
  check('coverage computed', stats.coverage !== null && Math.abs(stats.coverage - 19 / 28) < 1e-9);
  check('no fabrication holds', stats.noFabricatedPositions);
  const verdict = pupilDetectionVerdict({ stats, visualAuditPassed: true });
  check('verdict PASS with gates met', verdict === 'PUPIL_DETECTION_PASS', verdict);
  check(
    'verdict FAIL without visual audit',
    pupilDetectionVerdict({ stats, visualAuditPassed: false }) === 'PUPIL_DETECTION_FAIL',
  );
  check(
    'verdict UNKNOWN when empty',
    pupilDetectionVerdict({ stats: aggregatePupilStats([]), visualAuditPassed: true }) ===
      'PUPIL_DETECTION_UNKNOWN',
  );
  // Fabricated position forces FAIL.
  const bad = [...results];
  bad[0] = { ...bad[0], failureReason: 'LOW_CONFIDENCE', centroidXInRoi: 1 };
  check(
    'fabrication forces FAIL',
    pupilDetectionVerdict({ stats: aggregatePupilStats(bad), visualAuditPassed: true }) ===
      'PUPIL_DETECTION_FAIL',
  );
  const text = formatPupilReport({ stats, verdict, captureLabel: 'synthetic' });
  check('report text renders', text.includes('PUPIL_DETECTION_PASS') && text.includes('left eye:'));
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  throw new Error(`${failures} P3 logic check(s) failed.`);
} else {
  console.log('\nAll P3 logic checks passed.');
}
