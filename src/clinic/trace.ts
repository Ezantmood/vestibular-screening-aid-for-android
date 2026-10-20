import { traceFromSamples } from './rules';
import type { EyeTrace } from './types';

/** Downsample processed pupil samples. Times are milliseconds from the first decoded PTS. */
export function tracesFromProcessed(
  eyes: readonly {
    eyeSide: 'left' | 'right';
    samples: readonly {
      raw: { decodedPtsUs: number | null };
      processedX: number | null;
      processedY: number | null;
    }[];
  }[],
): EyeTrace[] {
  return eyes.map((eye) => {
    const start =
      eye.samples.find((sample) => sample.raw.decodedPtsUs !== null)?.raw.decodedPtsUs ?? 0;
    return traceFromSamples(
      eye.eyeSide,
      eye.samples.map((sample) => ({
        tMs: ((sample.raw.decodedPtsUs ?? start) - start) / 1000,
        x: sample.processedX,
        y: sample.processedY,
      })),
    );
  });
}
