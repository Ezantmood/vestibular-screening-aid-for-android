// P3.5 synthetic logic checks — runs with plain node after `tsc` compile to
// /tmp (see header command). Covers: preview matrix math (identity/cover,
// mirror, inverse round-trip, no-stretch), analysis<->display mapping,
// visible-rect crop semantics, framing-state classification priority, eye
// visibility rules, and readiness-stabilizer debouncing.
//
// Run: npx tsc --ignoreConfig scripts/p35LogicCheck.ts src/camera/previewTransform.ts
//   src/eyetracking/framing.ts --outDir /tmp/p35check --module commonjs
//   --target es2020 --esModuleInterop --skipLibCheck && node /tmp/p35check/scripts/p35LogicCheck.js
import {
  analysisToDisplay,
  buildPreviewMatrix,
  buildTextureViewMatrix,
  matrixIdentity,
  postTranslate,
  displayToAnalysis,
  invertAffine,
  mapPoint,
  mirrorAnalysisX,
  postRotate,
  postScale,
  setRectToRectFill,
  visibleAnalysisRect,
} from '../src/camera/previewTransform';
import type { FramingObservation } from '../src/eyetracking/framing';
import {
  FramingStabilizer,
  classifyFramingState,
  eyesVisibleForFraming,
  framingHint,
} from '../src/eyetracking/framing';

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

function baseParams() {
  return {
    viewWidth: 1080,
    viewHeight: 1920,
    bufferWidth: 1920,
    bufferHeight: 1080,
    sensorOrientation: 270,
    displayRotation: 0 as const,
    mirrorForFront: false,
    extraRotationDeg: 0,
  };
}

function faceObs(patch: Partial<FramingObservation>): FramingObservation {
  return {
    faceFound: true,
    faceLeft: 0.3,
    faceTop: 0.3,
    faceRight: 0.7,
    faceBottom: 0.7,
    leftEyeLandmark: true,
    rightEyeLandmark: true,
    leftEyeOpenProb: 0.9,
    rightEyeOpenProb: 0.9,
    ...patch,
  };
}

// --- Matrix primitives mirror android.graphics.Matrix semantics. ---

{
  const m = setRectToRectFill(0, 0, 100, 200, 0, 0, 1080, 1920);
  const p = mapPoint(m, 50, 100);
  check(
    'setRectToRectFill maps src centre to dst centre',
    approx(p.x, 540, 1e-9) && approx(p.y, 960, 1e-9),
  );
}

{
  const m = postScale([1, 0, 0, 0, 1, 0, 0, 0, 1], -1, 1, 50, 60);
  const p = mapPoint(m, 50, 60);
  check('postScale mirror fixes pivot', approx(p.x, 50, 1e-9) && approx(p.y, 60, 1e-9));
  const q = mapPoint(m, 70, 60);
  check('postScale mirror flips x about pivot', approx(q.x, 30, 1e-9));
}

{
  const m = postRotate([1, 0, 0, 0, 1, 0, 0, 0, 1], 90, 0, 0);
  const p = mapPoint(m, 1, 0);
  check('postRotate 90 maps +x to +y', approx(p.x, 0, 1e-9) && approx(p.y, 1, 1e-9));
}

{
  const m = buildPreviewMatrix({ ...baseParams(), mirrorForFront: true });
  const inv = invertAffine(m);
  const pts = [
    [0, 0],
    [1920, 0],
    [0, 1080],
    [1920, 1080],
    [960, 540],
  ];
  const roundTrips = pts.every(([x, y]) => {
    const fwd = mapPoint(inv, x, y);
    const back = mapPoint(m, fwd.x, fwd.y);
    return approx(back.x, x, 1e-6) && approx(back.y, y, 1e-6);
  });
  check('matrix inverse round-trips analysis corners', roundTrips);
}

// --- Regression: actual TextureView content geometry, not raw buffer math. ---

{
  const translated = postTranslate(matrixIdentity(), 10, 20);
  const scaled = mapPoint(postScale(translated, 2, 3, 0, 0), 1, 1);
  check('Android postScale acts AFTER existing translation', scaled.x === 22 && scaled.y === 63);
  const rotated = mapPoint(postRotate(translated, 90, 0, 0), 1, 1);
  check(
    'Android postRotate acts AFTER existing translation',
    approx(rotated.x, -21, 1e-9) && approx(rotated.y, 11, 1e-9),
  );
  const moved = mapPoint(postTranslate(postScale(matrixIdentity(), 2, 3, 0, 0), 10, 20), 1, 1);
  check('Android postTranslate acts AFTER existing scale', moved.x === 12 && moved.y === 23);
}

{
  const texture = buildTextureViewMatrix({
    ...baseParams(),
    frontFacing: true,
    mirrorForFront: true,
  });
  check(
    'portrait matching aspect needs no extra rotation or selfie flip',
    texture.every((v, i) => approx(v, matrixIdentity()[i], 1e-9)),
  );
  const unmirrored = buildTextureViewMatrix({
    ...baseParams(),
    frontFacing: true,
    mirrorForFront: false,
  });
  const left = mapPoint(unmirrored, 100, 600);
  check(
    'disabling selfie mirror undoes the platform mirror once',
    approx(left.x, 980, 1e-9) && approx(left.y, 600, 1e-9),
  );
  const rear = buildTextureViewMatrix({
    ...baseParams(),
    sensorOrientation: 90,
    frontFacing: false,
    mirrorForFront: false,
  });
  check(
    'rear camera receives no selfie flip',
    rear.every((v, i) => approx(v, matrixIdentity()[i], 1e-9)),
  );
}

{
  // Include the actual 440-dp card shape, phones, landscape, and square views.
  const sizes = [
    [1124, 1320],
    [720, 1920],
    [1920, 1080],
    [800, 800],
    [374, 440],
  ];
  let centred = true;
  let covered = true;
  let unstretched = true;
  let selfieOnce = true;
  for (const [vw, vh] of sizes) {
    for (const displayRotation of [0, 90, 180, 270] as const) {
      for (const sensorOrientation of [0, 90, 270]) {
        for (const frontFacing of [false, true]) {
          for (const mirrorForFront of [false, true]) {
            for (const extraRotationDeg of [0, 15]) {
              const params = {
                ...baseParams(),
                viewWidth: vw,
                viewHeight: vh,
                displayRotation,
                sensorOrientation,
                frontFacing,
                mirrorForFront,
                extraRotationDeg,
              };
              const m = buildTextureViewMatrix(params);
              const centre = mapPoint(m, vw / 2, vh / 2);
              centred &&= approx(centre.x, vw / 2, 1e-6) && approx(centre.y, vh / 2, 1e-6);
              // All DISPLAY corners must sample inside the original view-sized
              // texture. This fails for the old inverse-buffer matrix even
              // though that matrix's own inverse round-trip tests pass.
              const inverse = invertAffine(m);
              for (const [x, y] of [
                [0, 0],
                [vw, 0],
                [0, vh],
                [vw, vh],
              ]) {
                const content = mapPoint(inverse, x, y);
                covered &&=
                  content.x >= -1e-6 &&
                  content.x <= vw + 1e-6 &&
                  content.y >= -1e-6 &&
                  content.y <= vh + 1e-6;
              }
              const pw = sensorOrientation % 180 === 0 ? 1920 : 1080;
              const ph = sensorOrientation % 180 === 0 ? 1080 : 1920;
              const origin = mapPoint(m, 0, 0);
              const unitX = mapPoint(m, vw / pw, 0);
              const unitY = mapPoint(m, 0, vh / ph);
              const dx = { x: unitX.x - origin.x, y: unitX.y - origin.y };
              const dy = { x: unitY.x - origin.x, y: unitY.y - origin.y };
              unstretched &&=
                approx(Math.hypot(dx.x, dx.y), Math.hypot(dy.x, dy.y), 1e-6) &&
                approx(dx.x * dy.x + dx.y * dy.y, 0, 1e-6);
              // The producer has already flipped front content. Compose that
              // orientation with the correction and check the requested flip.
              const determinant = m[0] * m[4] - m[1] * m[3];
              const totalSign = Math.sign(determinant) * (frontFacing ? -1 : 1);
              selfieOnce &&= totalSign === (mirrorForFront ? -1 : 1);
            }
          }
        }
      }
    }
  }
  check('TextureView keeps camera centred across 480 configurations', centred);
  check('TextureView covers every preview corner (no blank strips)', covered);
  check('TextureView preserves source aspect after default stretch', unstretched);
  check('TextureView applies requested selfie orientation exactly once', selfieOnce);
}

{
  const params = {
    ...baseParams(),
    viewWidth: 1124,
    viewHeight: 1320,
    frontFacing: true,
    mirrorForFront: true,
  };
  const m = buildTextureViewMatrix(params);
  const centre = mapPoint(m, 562, 660);
  check(
    '440-dp preview regression stays centred',
    approx(centre.x, 562, 1e-6) && approx(centre.y, 660, 1e-6),
  );
  check(
    '440-dp preview fills width and crops height symmetrically',
    approx(m[0], 1, 1e-9) && m[4] > 1 && approx(m[5], (1320 - m[4] * 1320) / 2, 1e-6),
  );
}

// --- Primary Redmi portrait config: no stretch, centre maps to centre. ---

{
  const plain = buildPreviewMatrix(baseParams());
  // Uniform cover scale: unit x-step and y-step map to equal buffer lengths.
  const ox = mapPoint(plain, 0, 0);
  const ux = mapPoint(plain, 1, 0);
  const uy = mapPoint(plain, 0, 1);
  const sx = Math.hypot(ux.x - ox.x, ux.y - ox.y);
  const sy = Math.hypot(uy.x - ox.x, uy.y - ox.y);
  check('portrait cover keeps aspect (no stretch)', approx(sx, sy, 1e-9), `${sx} vs ${sy}`);
  // Full-height portrait view on 1920x1080: cover = max(1080/1080, 1920/1920) = 1.
  check('matching aspect is identity scale', approx(sx, 1, 1e-9));
  const centre = analysisToDisplay(960, 540, baseParams());
  check(
    'analysis centre maps to view centre',
    approx(centre.x, 540, 1e-6) && approx(centre.y, 960, 1e-6),
    JSON.stringify(centre),
  );
}

{
  // Narrower-than-intermediate view crops top/bottom of the landscape buffer
  // (centered) but keeps the full width.
  const narrow = { ...baseParams(), viewWidth: 720, viewHeight: 1920 };
  const rect = visibleAnalysisRect(narrow);
  check(
    'narrow view keeps full analysis width',
    approx(rect.left, 0, 1e-6) && approx(rect.right, 1920, 1e-6),
    JSON.stringify(rect),
  );
  check(
    'narrow view center-crops analysis height',
    approx(rect.top, 180, 1e-6) && approx(rect.bottom, 900, 1e-6),
    JSON.stringify(rect),
  );
  const centre = analysisToDisplay(960, 540, narrow);
  check(
    'cropped view still centres analysis centre',
    approx(centre.x, 360, 1e-6) && approx(centre.y, 960, 1e-6),
  );
}

{
  // Content is rotated 90 CW: analysis top-left maps to display top-right.
  const tl = analysisToDisplay(0, 0, baseParams());
  check(
    'portrait preview uprights content (90 CW)',
    approx(tl.x, 1080, 1e-6) && approx(tl.y, 0, 1e-6),
    JSON.stringify(tl),
  );
  // Mirror flips the displayed x about the view centre, nothing else.
  const mirrored = analysisToDisplay(960, 540, { ...baseParams(), mirrorForFront: true });
  check(
    'mirror keeps centre fixed',
    approx(mirrored.x, 540, 1e-6) && approx(mirrored.y, 960, 1e-6),
  );
  const tlMirrored = analysisToDisplay(0, 0, { ...baseParams(), mirrorForFront: true });
  check(
    'mirror flips analysis-top-left to display-top-left',
    approx(tlMirrored.x, 1080 - tl.x, 1e-6) && approx(tlMirrored.y, tl.y, 1e-6),
    JSON.stringify(tlMirrored),
  );
}

{
  // displayToAnalysis is the exact inverse of analysisToDisplay.
  const params = { ...baseParams(), mirrorForFront: true };
  const back = displayToAnalysis(300, 1500, params);
  const fwd = analysisToDisplay(back.x, back.y, params);
  check(
    'display<->analysis invert each other',
    approx(fwd.x, 300, 1e-6) && approx(fwd.y, 1500, 1e-6),
  );
}

{
  check('mirrorAnalysisX flips about width', mirrorAnalysisX(0, 1920) === 1919);
  check(
    'mirrorAnalysisX is an involution',
    mirrorAnalysisX(mirrorAnalysisX(500, 1920), 1920) === 500,
  );
}

{
  let threw = false;
  try {
    buildPreviewMatrix({ ...baseParams(), viewWidth: 0 });
  } catch {
    threw = true;
  }
  check('zero view size throws (never silent NaN)', threw);
}

// --- Framing classification priority. ---

{
  check('no face', classifyFramingState(faceObs({ faceFound: false })) === 'NO_FACE');
  check('null box is NO_FACE', classifyFramingState(faceObs({ faceLeft: null })) === 'NO_FACE');
  check(
    'inverted box is NO_FACE',
    classifyFramingState(faceObs({ faceLeft: 0.7, faceRight: 0.3 })) === 'NO_FACE',
  );
  check(
    'edge-clipped is FACE_PARTIAL',
    classifyFramingState(
      faceObs({ faceLeft: 0.0, faceTop: 0.2, faceRight: 0.5, faceBottom: 0.7 }),
    ) === 'FACE_PARTIAL',
  );
  check(
    'huge face is TOO_CLOSE',
    classifyFramingState(
      faceObs({ faceLeft: 0.05, faceTop: 0.05, faceRight: 0.95, faceBottom: 0.95 }),
    ) === 'TOO_CLOSE',
  );
  check(
    'tiny face is TOO_FAR',
    classifyFramingState(
      faceObs({ faceLeft: 0.45, faceTop: 0.4, faceRight: 0.55, faceBottom: 0.5 }),
    ) === 'TOO_FAR',
  );
  check(
    'no eye landmarks is EYES_NOT_VISIBLE',
    classifyFramingState(faceObs({ leftEyeLandmark: false, rightEyeLandmark: false })) ===
      'EYES_NOT_VISIBLE',
  );
  check(
    'closed classified eye vetoes visibility',
    classifyFramingState(faceObs({ leftEyeOpenProb: 0.1 })) === 'EYES_NOT_VISIBLE',
  );
  check(
    'off-centre face is OFF_CENTER',
    classifyFramingState(
      faceObs({ faceLeft: 0.55, faceTop: 0.3, faceRight: 0.95, faceBottom: 0.7 }),
    ) === 'OFF_CENTER',
  );
  check('centred face with eyes is READY', classifyFramingState(faceObs({})) === 'READY');
  // Priority: partial beats size gates.
  check(
    'partial outranks too-close',
    classifyFramingState(
      faceObs({ faceLeft: 0.0, faceTop: 0.0, faceRight: 0.9, faceBottom: 0.9 }),
    ) === 'FACE_PARTIAL',
  );
}

{
  check('both landmarks visible', eyesVisibleForFraming(faceObs({})) === true);
  check(
    'one landmark + open prob visible',
    eyesVisibleForFraming(faceObs({ leftEyeLandmark: false, rightEyeOpenProb: 0.8 })) === true,
  );
  check(
    'no landmarks + unknown probs not visible',
    eyesVisibleForFraming(
      faceObs({
        leftEyeLandmark: false,
        rightEyeLandmark: false,
        leftEyeOpenProb: null,
        rightEyeOpenProb: null,
      }),
    ) === false,
  );
  check(
    'every state has a hint',
    (
      [
        'NO_FACE',
        'FACE_PARTIAL',
        'TOO_CLOSE',
        'TOO_FAR',
        'OFF_CENTER',
        'EYES_NOT_VISIBLE',
        'READY',
      ] as const
    ).every((s) => framingHint(s).length > 0),
  );
}

// --- Stabilizer debouncing. ---

{
  const stab = new FramingStabilizer(3);
  check('stabilizer starts NO_FACE', stab.get() === 'NO_FACE');
  stab.push('READY');
  stab.push('READY');
  check('two strays do not flip', stab.get() === 'NO_FACE');
  stab.push('READY');
  check('three consecutive flip', stab.get() === 'READY');
  stab.push('NO_FACE');
  check('single flicker held', stab.get() === 'READY');
  stab.push('NO_FACE');
  stab.push('NO_FACE');
  check('sustained change flips back', stab.get() === 'NO_FACE');
  stab.reset();
  check('reset returns to NO_FACE', stab.get() === 'NO_FACE');
  let threw = false;
  try {
    new FramingStabilizer(0);
  } catch {
    threw = true;
  }
  check('invalid stableCount throws', threw);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  throw new Error(`${failures} P3.5 logic check(s) failed.`);
} else {
  console.log('\nAll P3.5 logic checks passed.');
}
