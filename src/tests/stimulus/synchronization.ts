import type { StimulusRun } from './engine';
import { targetAt } from './engine';

export interface ClockBridge {
  /** native elapsedRealtime µs minus JS performance.now µs */
  nativeMinusJsUs: number;
  roundTripUs: number;
}
export function clockBridge(beforeJsUs: number, nativeUs: number, afterJsUs: number): ClockBridge {
  if (![beforeJsUs, nativeUs, afterJsUs].every(Number.isFinite) || afterJsUs < beforeJsUs) {
    throw new Error('Invalid monotonic clock sample.');
  }
  return {
    nativeMinusJsUs: nativeUs - (beforeJsUs + afterJsUs) / 2,
    roundTripUs: afterJsUs - beforeJsUs,
  };
}
export interface FrameTimeAnchor {
  mediaPtsUs: number;
  nativeElapsedUs: number;
  source: 'measured-frame' | 'record-start-estimate';
  /** null means camera/encoder offset is unbounded, never precision zero. */
  uncertaintyUs: number | null;
}
export interface FrameStimulusMatch {
  decodedPtsUs: number | null;
  elapsedUs: number | null;
  status:
    | 'matched'
    | 'estimated'
    | 'missing-timestamp'
    | 'outside-run'
    | 'not-presented'
    | 'unsynchronized';
  planned: ReturnType<typeof import('./engine').targetAt>;
  presented: StimulusRun['presentations'][number] | null;
  uncertaintyUs: number | null;
}
/** Join on PTS, never frame index or nominal FPS. Do not interpolate display commits. */
export function matchFrame(
  run: StimulusRun,
  decodedPtsUs: number | null,
  bridge: ClockBridge | null,
  anchor: FrameTimeAnchor | null,
): FrameStimulusMatch {
  const result: FrameStimulusMatch = {
    decodedPtsUs,
    elapsedUs: null,
    status: 'unsynchronized',
    planned: null,
    presented: null,
    uncertaintyUs: null,
  };
  if (decodedPtsUs === null || !Number.isFinite(decodedPtsUs)) {
    return { ...result, status: 'missing-timestamp' };
  }
  if (bridge === null || anchor === null) return result;
  if (
    ![bridge.nativeMinusJsUs, bridge.roundTripUs, anchor.mediaPtsUs, anchor.nativeElapsedUs].every(
      Number.isFinite,
    ) ||
    bridge.roundTripUs < 0 ||
    (anchor.uncertaintyUs !== null &&
      (!Number.isFinite(anchor.uncertaintyUs) || anchor.uncertaintyUs < 0))
  )
    throw new Error('Invalid frame anchor.');
  const elapsedUs =
    anchor.nativeElapsedUs +
    decodedPtsUs -
    anchor.mediaPtsUs -
    bridge.nativeMinusJsUs -
    run.startJsUs;
  const end =
    run.endJsUs === null
      ? run.config.durationUs
      : Math.min(run.config.durationUs, run.endJsUs - run.startJsUs);
  if (elapsedUs < 0 || elapsedUs >= end) return { ...result, elapsedUs, status: 'outside-run' };
  const planned = targetAt(run.config, elapsedUs);
  // Binary search the last committed target at/before exposure time.
  let lo = 0;
  let hi = run.presentations.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (run.presentations[mid].elapsedUs <= elapsedUs) lo = mid + 1;
    else hi = mid;
  }
  const presented = lo > 0 ? run.presentations[lo - 1] : null;
  const uncertaintyUs =
    anchor.uncertaintyUs === null ? null : anchor.uncertaintyUs + bridge.roundTripUs / 2;
  return {
    ...result,
    elapsedUs,
    planned,
    presented,
    uncertaintyUs,
    status:
      presented === null
        ? 'not-presented'
        : anchor.source === 'record-start-estimate'
          ? 'estimated'
          : 'matched',
  };
}
