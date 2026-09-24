# Project Spec

## Purpose

Smartphone-based **central vestibular screening** through eye-movement tracking.
Screening aid — supports triage/referral decisions. **Not a diagnostic device.**

## Target

- Android-first; dev/test device: Xiaomi Redmi Note 13 Pro 5G.
- Runs in Expo Go during bootstrap (no custom native code).

## MVP clinical scope

- Initial tests: **Smooth Pursuit** and **Horizontal Saccades** (see `src/tests/registry.ts`).
- Other oculomotor tests are out of scope for MVP.

## Technical constraints

- React Native + TypeScript + Expo. Strict TS, Prettier (single quotes, 100-col).
- Camera2 / high-speed capture planned via **Expo Development Build + Kotlin native module** — later, not bootstrap.
- No camera, eye-tracking, auth, database, or clinical-algorithm implementation in bootstrap (stubs only).

## Out of scope (bootstrap)

Clinical validation, diagnosis claims, backend/cloud, iOS tuning, performance optimization.

See `docs/DECISIONS.md` for stack choices, `docs/ROADMAP.md` for phases.
