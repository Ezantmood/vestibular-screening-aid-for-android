// Shared Camera2 fixed high-speed mode listing (P1 probe → P2/P3 screens).
// A mode qualifies only with an exact fixed [fps, fps] range — never a range
// maximum. Ordering is FRONT 1080p120 first (MVP eye-tracking candidate),
// then rear 1080p120, other 120fps modes, then 240fps benchmarks.

import type { Camera2ProbeResult } from './camera2ProbeTypes';

export interface FixedMode {
  cameraId: string;
  lensFacing: string;
  width: number;
  height: number;
  fpsMin: number;
  fpsMax: number;
  label: string;
}

/** P2 architecture correction: FRONT 1920×1080 @ fixed 120fps is primary. */
export function modePriority(mode: FixedMode): number {
  if (mode.lensFacing === 'FRONT' && mode.width === 1920 && mode.fpsMax === 120) {
    return 0;
  }
  if (mode.lensFacing === 'BACK' && mode.width === 1920 && mode.fpsMax === 120) {
    return 1;
  }
  if (mode.fpsMax === 120) {
    return 2;
  }
  if (mode.fpsMax === 240) {
    return 3;
  }
  return 4;
}

export function collectFixedModes(cameras: Camera2ProbeResult[]): FixedMode[] {
  const found: FixedMode[] = [];
  for (const camera of cameras) {
    if (!camera.constrainedHighSpeedVideoSupported) {
      continue;
    }
    for (const entry of camera.highSpeedVideoSizes) {
      for (const range of entry.fpsRanges) {
        if (range.min !== range.max) {
          continue;
        }
        found.push({
          cameraId: camera.cameraId,
          lensFacing: camera.lensFacing,
          width: entry.width,
          height: entry.height,
          fpsMin: range.min,
          fpsMax: range.max,
          label:
            `Cam ${camera.cameraId} ${camera.lensFacing} ` +
            `${entry.width}x${entry.height} [${range.min},${range.max}]`,
        });
      }
    }
  }
  found.sort((a, b) => modePriority(a) - modePriority(b));
  return found;
}
