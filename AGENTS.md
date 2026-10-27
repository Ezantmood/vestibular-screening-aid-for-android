# AGENTS.md

Working agreement for AI/human contributors. Details live in `docs/` — don't duplicate, link.

## Stack & target

- Android-first. React Native + TypeScript + Expo SDK 57. Test device: Xiaomi Redmi Note 13 Pro 5G.
- Expo Development Build + existing Kotlin modules; see `docs/DEVELOPMENT_BUILD.md`.

## Commands

```bash
npm install
npm start            # Metro LAN + dev-client QR; owner opens on phone
npm run build:dev    # local Development APK; no device install/launch
npm run build:batch3  # local APK build; JDK 21, no phone connection
npm run build:clinic  # one-install clinician APK; keeps INTERNET; no phone connection
npm run typecheck
npm run lint
npm run format
npm test
npm run check   # typecheck + lint (run before committing)
```

## Conventions

- Entry: `App.tsx` → `src/ui/screens/*`. Keep screens thin; logic goes in domain folders.
- Domain folders own their types: `patients/`, `tests/`, `camera/`, `eyetracking/`, `signals/`, `metrics/`, `storage/`.
- `src/camera/CameraService.ts` is the seam: UI/tests depend on the interface, never on expo-camera or native code directly.
- Strict TypeScript. No `any` without justification. Prettier style: single quotes, 100-col.
- ESLint flat config (`eslint.config.mjs`) extends `eslint-config-expo`.

## Current boundaries

- Current work is Batch 3: calibration plus the existing Smooth Pursuit and
  Horizontal Saccade pipeline. Do not start Batch 4 without a new request.
- No Wireless Debugging, ADB or remote phone inspection/control. Owner-operated
  Metro LAN + QR is authorized; never invoke CLI device launch/install.
  Build/check on the computer. See [development workflow](docs/DEVELOPMENT_BUILD.md)
  and [standalone physical verification](docs/BATCH3_VALIDATION.md).
- The clinician product (accounts, patients, the eye-test battery, on-device
  report, and PDF) is in scope. Do not upload patient records, invent a
  diagnosis, or describe the front camera as 240 fps.
- Never lower quality gates or fabricate measurements to obtain VALID. Distinguish
  computer simulations, saved-data replay and pending physical results.
- Keep docs short; each doc has one job. Update `docs/STATUS.md` when state changes.

## Git

- Scoped commits, no history rewrites, no force-push.
- Push only if a remote is configured; never invent one.
- After each completed task, commit and push the changes and publish a GitHub
  Release with downloadable APKs for owner testing. The owner authorizes this
  routine delivery; do not stop at local/LAN artifacts or ask again to push/release.
  Follow [release packaging](docs/RELEASING.md), including clean-source builds,
  checksums and explicit pending physical results. Keep private evidence out of Git
  and release assets.
