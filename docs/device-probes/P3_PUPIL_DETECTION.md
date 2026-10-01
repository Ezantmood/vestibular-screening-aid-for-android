# P3 pupil detection + centroid — design, procedure, results

Device: Xiaomi `2312DRA50G` (garnet), Android 13 / API 33.
Baselines: P0.1 (`XIAOMI_2312DRA50G_ANDROID13.md`), P1 (`P1_HIGH_SPEED_VALIDATION.md`),
P2 (`P2_FRAME_DECODE_EYE_ROI.md`). P2 verdicts (`FRAME_PIPELINE_PASS`,
`EYE_ROI_PASS`) were not re-proven here; the P2 decoder + ML Kit ROI pass ran
unchanged and reproduced 75–100% face / both-eyes rates on all 7 P3 clips.

## Architecture (P2 decoder untouched)

```text
Front Camera 1080p120 → encoded MP4 → MediaExtractor / MediaCodec (P2 module,
untouched) → decoded frame → ML Kit face/eye ROI (P2 module, ROI only)
→ P3 pupil detector → PupilDetectionResult
```

- New Android-only module `modules/expo-pupil-detector` (Kotlin, autolinked,
  dependency-free: no OpenCV, no ML Kit, no ML model). One offline call,
  `analyzeVideoPupils(filePath, detectorId, saveOverlays, requestsJson)`:
  replays the P2-style decode in a single sequential pass, copies exact
  Y-plane luminance for requested frames (stride-aware, no JPEG round-trip in
  the measurement path), localizes the pupil per ROI immediately (one frame
  held at a time), and optionally saves overlay JPEGs to device-local cache
  `pupildebug/` (never git).
- TS seam: `src/camera/pupilDetector.ts` (loader + orchestration) and
  `src/eyetracking/pupil/` (`pupilTypes`, `coordinates`, `detectors`,
  `pupilReport` — pure, execution-tested on synthetic data, 37/37 checks).
  Debug UI `PupilValidationScreen` (FRONT 1080p120 default, both detectors per
  run, manual visual-audit toggle) wired into Home.
- Orchestration honesty: every sampled eye slot yields exactly one result.
  Upstream misses become TS-side `NO_FACE` / `NO_EYE_ROI` with null centroids;
  only usable ROIs reach native code. Failures always carry null centroids.

## Coordinate system

- Frame space: original decoded-frame pixels (landscape sensor space),
  origin top-left. P2 already maps its 0°/90°/270° fallback back, so the pupil
  stage is axis-aligned: `centroidInFrame = roiOrigin + centroidInRoi`.
- ROI space: pixels from the ROI top-left. Normalized space: ROI position /
  ROI size, normally in `[0,1]`. Full float precision internally.
- Eye sides (`left`/`right`) echo the upstream ML Kit landmark identity and
  are IMAGE-SPACE labels: front-camera mirroring is unresolved, never an
  anatomical claim. Statistics are reported per side.

## Algorithms evaluated

Both assume a dark pupil inside the eye ROI; the darkest pixel is never
trusted blindly — connected components are evidence-scored (darkness, area
prior ~1–12% of ROI, bbox-fill/aspect ellipse proxy, centrality, border
contact penalty, surround contrast) with a 0.35 minimum-confidence gate and
a 0.05 ambiguity margin (engineering gates, not clinical thresholds):

- **A `percentile-dark`**: light blur → 12th-percentile dark gate (clamped) →
  components → scoring. Simplest method that works.
- **B `contrast-normalized`**: percentile contrast stretch (2nd–98th → full
  range) → relative gate + 3×3 morphological open → same machinery with
  shape-heavy weights. (An earlier background-subtraction variant was dropped
  during synthetic checks: it cancels uniform dark regions larger than the
  kernel — a real flaw found before any device run.)

Failure states: `NO_FACE`, `NO_EYE_ROI`, `EYE_CLOSED_OR_OCCLUDED`,
`NO_PUPIL_CANDIDATE`, `AMBIGUOUS_CANDIDATES`, `LOW_CONFIDENCE`,
`INVALID_GEOMETRY`. No temporal smoothing, tracking, gaze, or clinical code.

## On-device procedure

Dev Build on the Redmi; Home → **Pupil detection prototype (P3)** → FRONT
1920×1080 `[120,120]` → self-service 7-condition sequence (center, left,
right, up, down, blink, head-move; ~10 s each with on-screen pose prompts).
Per condition: P2 decode + 40-frame ROI pass, then one pupil batch per
detector (≤80 eye slots). Numeric payloads to logcat; overlays stay
device-local. Logcat rotated past the live payloads, so all 7 MP4s were
re-analyzed on-device with the same code (deterministic replay verified:
duplicate center analysis bit-identical) — the numbers below are the
re-analysis, equivalent to the original run.

## Measured results — DONE on 2312DRA50G (FRONT 1080p120, 7 × ~10 s clips)

80 eye slots per condition per detector (40 frames × 2 sides), 560 per
detector total. Face detection 75–100%, both-eyes-usable 75–100% on every
clip (P2 stage reproduced, not re-verdict).

### Detection coverage (success / evaluated)

| condition | percentile-dark     | contrast-normalized |
| --------- | ------------------- | ------------------- |
| center    | 61/80 = 76.2%       | 61/80 = 76.2%       |
| left      | 68/80 = 85.0%       | 70/80 = 87.5%       |
| right     | 67/80 = 83.8%       | 69/80 = 86.2%       |
| up        | 35/80 = 43.8%       | 32/80 = 40.0%       |
| down      | 60/80 = 75.0%       | 57/80 = 71.2%       |
| blink     | 12/80 = 15.0%       | 16/80 = 20.0%       |
| head-move | 27/80 = 33.8%       | 29/80 = 36.2%       |
| **total** | **330/560 = 58.9%** | **334/560 = 59.6%** |

Per side (percentile-dark): left 167/280 = 59.6%, right 163/280 = 58.2%.
Per side (contrast-normalized): left 170/280 = 60.7%, right 164/280 = 58.6%.

### Failure breakdown (both detectors behave the same way)

- percentile-dark totals: `NO_PUPIL_CANDIDATE` 140, `LOW_CONFIDENCE` 60,
  `NO_FACE` 22, `AMBIGUOUS_CANDIDATES` 5, `NO_EYE_ROI` 3, rest geometry/edge.
- contrast-normalized totals: `NO_PUPIL_CANDIDATE` 122, `LOW_CONFIDENCE` 63,
  `NO_FACE` 22, `AMBIGUOUS_CANDIDATES` 16, `NO_EYE_ROI` 3.
- `up` fails honestly (lids cover the pupil: 37–39 `NO_PUPIL_CANDIDATE` of 80);
  `blink` fails honestly (10 `NO_FACE` per side from ML Kit during eye
  closure + closed-eye rejections); `head-move` fails honestly (motion blur →
  `LOW_CONFIDENCE` dominates: 26–28 of 80). No fabricated positions anywhere
  (every failure carries null centroids — verified structurally in code).

### Confidence (engineering signal, not clinical)

Success confidence means sit 0.48–0.73 across conditions/sides (highest on
left-gaze left eye 0.709–0.730 and right-gaze right eye 0.726–0.728; lowest on
hardly-visible pupils: up-gaze 0.478–0.566, blink residuals 0.486–0.602).
No success was accepted below the 0.35 gate.

### Candidate geometry + centroid distributions (reported, not interpreted)

- Candidate bbox medians per side/condition range ~23–73 px wide —
  plausible pupil sizes inside ~110–150 px ROIs. Elongated boxes (up to
  ~130 px tall) occur for edge-squeezed partial pupils at extreme gaze.
- Normalized centroid means shift with gaze condition (image-space): e.g.
  right-eye `normalizedX` mean 0.653 (center) → 0.521 (left) → 0.467 (right);
  up-gaze `normalizedY` drops to ~0.24–0.32 (only the lower pupil sliver
  visible). This is a feasibility signal only — NOT gaze angle, no degrees,
  no stimulus mapping.

### Visual audit (16 representative overlays inspected off-device)

Successes: the red crosshair + candidate box fall squarely on the dark pupil
in center (5), left-gaze (2, incl. corner-squeezed pupil), right-gaze (2),
down-gaze (2, crisp), up-gaze sliver (1, low confidence as appropriate).
Failures: edge-onset pupil → `LOW_CONFIDENCE` with no marker; closed eyes →
`LOW_CONFIDENCE`/`NO_PUPIL_CANDIDATE` with no marker; motion-blurred eye →
`NO_PUPIL_CANDIDATE` with no marker. Zero misplaced centroids in the audited
set; zero markers on failed frames. (Head-move norm overlays were cut off by
a truncated bulk transfer — numeric stats for that cell are complete; the
perc-side audit for head-move stands in.)

## Verdicts (engineering feasibility gates, not clinical thresholds)

```text
Device: Xiaomi 2312DRA50G
Capture: FRONT 1920x1080 [120,120], ~10 s x 7 gaze conditions
Evaluated: 560 eye slots/detector (280 left + 280 right)
percentile-dark:      330/560 = 58.9% coverage
contrast-normalized:  334/560 = 59.6% coverage
Core poses (center/left/right/down): 71-88% per condition
No fabricated positions. Visual audit passed (16/16 plausible).

PUPIL_DETECTION_PASS
```

- Gates met by both detectors: ≥20 evaluated (560), ≥8 per side (280),
  coverage ≥50% (58.9%/59.6%), all failures null-centroid, representative
  overlays visually plausible. The result is **pupil-localization
  feasibility, not validated gaze accuracy** — no objective ground truth
  exists yet (audit is visual plausibility, not measured error).
- **Chosen baseline: `percentile-dark`.** Near-identical coverage (±0.7pp)
  with the simpler gate and fewer ambiguous outcomes (5 vs 16
  `AMBIGUOUS_CANDIDATES`). `contrast-normalized` stays in the codebase as the
  documented comparison candidate behind the same detector interface.

## Go / no-go for tracking continuity (P4) — DECIDED

- Repeatable single-frame pupil candidates with honest, auditable failures →
  **GO for P4** (tracking continuity / confidence / robustness). P4 is
  technically unblocked but NOT started.

## Limitations (observed on-device)

- Eye ROIs are blurry close-ups (~110–150 px); pupils frequently sit at ROI
  edges or under lids at extreme gaze — coverage there is honestly low.
- `up`/`blink`/`head-move` coverage (15–44%) bounds single-frame feasibility;
  continuity logic (P4) must earn its keep exactly there.
- Front-camera mirroring unresolved: side labels are image-space, and the
  `normalizedX` axis meaning flips if the sensor path mirrors.
- ML Kit `UNAVAILABLE` path still unexercised (Play Services present).
- One degenerate P2 ROI (`131x1` edge-clamped box) flowed through
  `INVALID_GEOMETRY` as designed.
- Overlays/frames/crops/recordings remain on-device (app-private cache) and
  were never committed; audit copies lived outside the repo and were deleted
  after the audit.

## Consequential UI fix (kept)

All debug screens gained 160 px bottom content clearance: on this device the
system navigation bar covered low-lying buttons and made them untappable
(found while operating the P3 screen). No P0.1/P1/P2 logic touched (one pure
helper extraction: `src/camera/fixedModes.ts`, behavior-identical).
