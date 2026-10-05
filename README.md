# Vestibular Screening Aid

Smartphone-based **central vestibular screening** via eye-movement tracking.
**Screening aid, not a diagnostic device.**

- Stack: React Native + TypeScript + Expo (Android-first)
- Dev/test device: Xiaomi Redmi Note 13 Pro 5G
- MVP clinical tests: Smooth Pursuit + Horizontal Saccades
- Run: Expo Go now; Expo Development Build + Kotlin native modules later for Camera2/high-speed camera

## Quickstart

```bash
npm install
npm run android   # Expo Development Build (custom native Camera2 probe); or: npm start, then Expo Go (probe shows Dev-Build hint)
npm run typecheck
npm run lint
```

Requires Node 18+ (tested here on Node 25 + Expo SDK 57).

## Scripts

| Command             | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `npm start`         | Run in Expo Go (no native probe)          |
| `npm run android`   | Dev Build on Android (`expo run:android`) |
| `npm run typecheck` | `tsc --noEmit`                            |
| `npm run lint`      | ESLint (`eslint-config-expo`)             |
| `npm run format`    | Prettier check                            |
| `npm run check`     | typecheck + lint                          |

## Structure

```
App.tsx               # entry -> HomeScreen only
src/ui/               # screens, components, navigation (stub)
src/patients/         # patient management (types only)
src/tests/            # test engine: registry + smooth-pursuit / saccades stubs
src/camera/           # camera abstraction (no impl in bootstrap)
src/eyetracking/      # gaze types (stub)
src/signals/          # PTS-based filtering, segments, confidence and velocity
src/metrics/          # clinical metrics (stub)
src/storage/          # persistence/reporting (stub)
src/config/ utils/    # constants, helpers
docs/                 # spec, architecture, roadmap, decisions, status
eas.json              # Dev Build profiles (for later, not used yet)
```

Camera, eye tracking, auth, database, and clinical algorithms are **intentionally not implemented** in bootstrap.

## Docs

- `docs/PROJECT_SPEC.md` — scope, MVP, constraints
- `docs/ARCHITECTURE.md` — layers and dependency rules
- `docs/ROADMAP.md` — phase order; current state is in `docs/STATUS.md`
- `docs/CALIBRATION_SIGNALS.md` — calibration acceptance, persistence and signal contracts
- `docs/DECISIONS.md` — recorded architectural decisions
- `docs/STATUS.md` — current state
- `AGENTS.md` — working agreement for AI agents
