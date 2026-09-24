// P0.1 Camera2 capability probe — loader behind the camera seam.
// Android-only native module; resolves to null in Expo Go / on iOS / web,
// in which case callers get a "Development Build required" error (no crash).

import { requireOptionalNativeModule } from 'expo';

import type { Camera2ProbeResult, FpsRange, HighSpeedTarget } from './camera2ProbeTypes';

interface ExpoCamera2ProbeNativeModule {
  getCameraCapabilities(): Promise<Camera2ProbeResult[]>;
}

const nativeModule = requireOptionalNativeModule<ExpoCamera2ProbeNativeModule>('ExpoCamera2Probe');

export function isCamera2ProbeAvailable(): boolean {
  return nativeModule !== null && typeof nativeModule?.getCameraCapabilities === 'function';
}

/**
 * Query real Camera2 capabilities for every camera in CameraManager.cameraIdList.
 * Throws a human-readable Error when the native module is missing (Expo Go)
 * or when Camera2 access fails on-device (see Kotlin CodedException codes).
 */
export async function getCamera2Capabilities(): Promise<Camera2ProbeResult[]> {
  if (!isCamera2ProbeAvailable()) {
    throw new Error(
      'Camera2 probe needs an Expo Development Build on Android (not available in Expo Go). ' +
        'Build with the development profile and run on-device.',
    );
  }
  try {
    return await (nativeModule as ExpoCamera2ProbeNativeModule).getCameraCapabilities();
  } catch (e) {
    throw new Error(`Camera2 probe failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Strict verdict for one (size, fps) target, derived only from the exact
 * high-speed configurations advertised by Camera2 for that size.
 *
 * A target fps merely falling inside some `[min, max]` range is NOT support:
 * constrained high-speed sessions only accept ranges from
 * `getHighSpeedVideoFpsRangesFor(size)`, and exact-rate capture needs the
 * fixed `[fps, fps]` range. When fps only matches a range *maximum*
 * (e.g. `[30, 120]` for a 120fps target), that is reported distinctly as
 * `UPPER_BOUND` — whether a session then captures exactly at fps depends on
 * session/AE behavior, so the raw advertised ranges stay authoritative.
 */
export type HighSpeedTargetVerdictKind = 'FIXED' | 'UPPER_BOUND' | 'NOT_ADVERTISED';

export interface HighSpeedTargetVerdict {
  target: HighSpeedTarget;
  /** The size appears in `getHighSpeedVideoSizes()`. */
  sizeAdvertised: boolean;
  /** A fixed `[fps, fps]` range is advertised for this size. */
  fixedRangeExists: boolean;
  /** `fps` equals the upper bound of at least one advertised range. */
  upperBoundAdvertised: boolean;
  /** Advertised ranges for this size whose upper bound equals `fps`. */
  matchingRanges: FpsRange[];
  kind: HighSpeedTargetVerdictKind;
}

export function getHighSpeedTargetVerdict(
  camera: Camera2ProbeResult,
  target: HighSpeedTarget,
): HighSpeedTargetVerdict {
  const none = (sizeAdvertised: boolean): HighSpeedTargetVerdict => ({
    target,
    sizeAdvertised,
    fixedRangeExists: false,
    upperBoundAdvertised: false,
    matchingRanges: [],
    kind: 'NOT_ADVERTISED',
  });

  const entry = camera.highSpeedVideoSizes.find(
    (e) => e.width === target.width && e.height === target.height,
  );
  if (!entry) {
    return none(false);
  }
  const matchingRanges = entry.fpsRanges.filter((range) => range.max === target.fps);
  if (matchingRanges.length === 0) {
    return none(true);
  }
  const fixedRangeExists = matchingRanges.some((range) => range.min === target.fps);
  return {
    target,
    sizeAdvertised: true,
    fixedRangeExists,
    upperBoundAdvertised: true,
    matchingRanges,
    kind: fixedRangeExists ? 'FIXED' : 'UPPER_BOUND',
  };
}

export type { Camera2ProbeResult, HighSpeedTarget };
