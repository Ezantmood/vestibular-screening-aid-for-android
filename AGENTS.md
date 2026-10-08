# AGENTS.md

Working agreement for AI/human contributors. Details live in `docs/` — don't duplicate, link.

## Stack & target

- Android-first. React Native + TypeScript + Expo SDK 57. Test device: Xiaomi Redmi Note 13 Pro 5G.
- Expo Go for bootstrap. Move to Expo Development Build + Kotlin modules only when custom native code is needed (see `docs/DECISIONS.md`).

## Commands

```bash
npm install
npm run build:batch3  # local APK build; JDK 21, no phone connection
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
- No Wireless Debugging, ADB, phone connections or remote phone access/control.
  Build/check on the computer; physical verification is owner-run in the
  standalone APK. See [workflow](docs/BATCH3_VALIDATION.md).
- No expanded patient/session storage, clinical reports, PDF, other eye tests,
  or diagnosis. Preserve intentional stubs outside this scope.
- Never lower quality gates or fabricate measurements to obtain VALID. Distinguish
  computer simulations, saved-data replay and pending physical results.
- Keep docs short; each doc has one job. Update `docs/STATUS.md` when state changes.

## Git

- Scoped commits, no history rewrites, no force-push.
- Push only if a remote is configured; never invent one.
