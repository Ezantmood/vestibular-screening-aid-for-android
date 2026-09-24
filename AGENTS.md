# AGENTS.md

Working agreement for AI/human contributors. Details live in `docs/` — don't duplicate, link.

## Stack & target

- Android-first. React Native + TypeScript + Expo SDK 57. Test device: Xiaomi Redmi Note 13 Pro 5G.
- Expo Go for bootstrap. Move to Expo Development Build + Kotlin modules only when custom native code is needed (see `docs/DECISIONS.md`).

## Commands

```bash
npm install
npm run android
npm run typecheck
npm run lint
npm run format
npm run check   # typecheck + lint (run before committing)
```

## Conventions

- Entry: `App.tsx` → `src/ui/screens/*`. Keep screens thin; logic goes in domain folders.
- Domain folders own their types: `patients/`, `tests/`, `camera/`, `eyetracking/`, `signals/`, `metrics/`, `storage/`.
- `src/camera/CameraService.ts` is the seam: UI/tests depend on the interface, never on expo-camera or native code directly.
- Strict TypeScript. No `any` without justification. Prettier style: single quotes, 100-col.
- ESLint flat config (`eslint.config.mjs`) extends `eslint-config-expo`.

## Boundaries (bootstrap)

- DO NOT implement camera, eye tracking, auth, database, or clinical algorithms yet.
- Stubs with `TODO (Phase N)` are intentional — leave them.
- Do not start Phase 1 / Camera2 work until asked. Next task is only the Camera2 capability probe (see `docs/STATUS.md`).
- Keep docs short; each doc has one job (see `docs/ARCHITECTURE.md` header). Update `docs/STATUS.md` when state changes.

## Git

- Scoped commits, no history rewrites, no force-push.
- Push only if a remote is configured; never invent one.
