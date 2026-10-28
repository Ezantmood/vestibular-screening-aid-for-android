import checks from './assert';
import {
  prepareCalibrationReplay,
  retainReplayCapture,
  savedCalibrationReplay,
} from '../src/eyetracking/calibration/replay';
import { syntheticCalibrationTakes, SYNTHETIC_CONTEXT } from '../src/tests/validation/selfChecks';

const assert = {
  ...checks,
  deepEqual(a: unknown, b: unknown) {
    checks.equal(JSON.stringify(a), JSON.stringify(b));
  },
  async rejects(fn: () => Promise<unknown>, match?: RegExp) {
    try {
      await fn();
    } catch (error) {
      if (match) checks.ok(match.test(String(error)));
      return;
    }
    throw new Error('Expected asynchronous rejection');
  },
};

async function main() {
  const artifact = {
    schemaVersion: 1,
    result: {
      id: 'original-capture',
      createdAtMs: 1000,
      context: { ...SYNTHETIC_CONTEXT, faceRotationDegrees: 270 },
    },
    takes: syntheticCalibrationTakes().map((take, i) => ({
      ...take,
      filePath: `/data/user/0/app/cache/highspeed/take-${i}.mp4`,
    })),
    patient: 'PRIVATE_PATIENT',
  };
  const source = JSON.stringify(artifact);
  let retained: string | null = null;
  let calls = 0;
  const retain = async (json: string) => {
    calls++;
    assert.ok(!json.includes('PRIVATE_PATIENT') && !json.includes('samples'));
    const data = JSON.parse(json) as typeof artifact;
    data.takes = data.takes.map((take, i) => ({
      ...take,
      filePath: `/data/user/0/app/files/eye-analysis/capture-videos/capture-test/take-${i}.mp4`,
    }));
    retained = JSON.stringify(data);
    return retained;
  };
  const deps = { readCapture: async () => retained, readEvidence: async () => source, retain };
  const first = await prepareCalibrationReplay(deps);
  assert.equal(first.createdAtMs, 1000);
  assert.equal(first.id, artifact.result.id);
  assert.equal(calls, 1);
  assert.ok(first.takes.every((take) => take.filePath.includes('/files/eye-analysis/')));
  assert.ok(first.takes.every((take) => !('samples' in take)));
  assert.equal(first.takes[0].recordStartNativeUs, artifact.takes[0].recordStartNativeUs);
  // Restart after analysis failure: retained capture works with no result pointer.
  const restarted = await prepareCalibrationReplay({ ...deps, readEvidence: async () => null });
  assert.deepEqual(restarted, first);
  // A corrupt or unreadable result cannot hide good capture metadata.
  const corrupt = await prepareCalibrationReplay({ ...deps, readEvidence: async () => '{broken' });
  assert.deepEqual(corrupt, first);
  const fallback = await prepareCalibrationReplay({
    ...deps,
    readCapture: async () => {
      throw new Error('read failure');
    },
  });
  assert.deepEqual(fallback, first);
  await assert.rejects(() =>
    prepareCalibrationReplay({
      ...deps,
      readCapture: async () => null,
      readEvidence: async () => null,
    }),
  );
  await assert.rejects(
    () =>
      prepareCalibrationReplay({
        ...deps,
        retain: async () => {
          throw new Error('Capture video is missing');
        },
      }),
    /Capture video is missing/,
  );
  assert.equal(JSON.stringify(artifact), source);
  // Retention cannot refresh capture age, clocks or target coordinates.
  for (const alter of [
    (data: typeof artifact) => {
      data.result.createdAtMs++;
    },
    (data: typeof artifact) => {
      data.takes[0].presentedJsUs++;
    },
    (data: typeof artifact) => {
      data.result.id = 'different';
    },
  ]) {
    await assert.rejects(
      () =>
        retainReplayCapture(savedCalibrationReplay(artifact), async (json) => {
          const data = JSON.parse(json) as typeof artifact;
          alter(data);
          return JSON.stringify(data);
        }),
      /Metadata video thay đổi/,
    );
  }
  console.log(
    'Calibration replay checks: PASS (retention, restart, corrupt-result recovery, missing video, privacy, immutable capture clocks)',
  );
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
