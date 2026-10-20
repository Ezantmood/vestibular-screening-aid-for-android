import assert from './assert';
import { decryptJson, encryptJson, newVaultKey } from '../src/clinic/crypto';
import { readingFor, t } from '../src/clinic/copy';
import {
  extendedQuality,
  extendedRows,
  parseNpcCm,
  positionAt,
  verticalJumpSteps,
} from '../src/clinic/protocols';
import { reportHtml } from '../src/clinic/reportHtml';
import {
  daysLeft,
  deletedPatients,
  downsample,
  ensureProfile,
  flagAtLeast,
  flagAtMost,
  flagRatio,
  isPurged,
  meanOrNull,
  npcBreak,
  oknAsymmetry,
  ownedPatients,
  patientFieldError,
  purgePatients,
  qualityRank,
  rowsFromEyeTest,
  searchPatients,
  separationSeries,
  setRole,
  slowPhaseVelocity,
  stepAccuracy,
  traceFromSamples,
  visiblePatients,
} from '../src/clinic/rules';
import { tracesFromProcessed } from '../src/clinic/trace';
import { DAY_MS, type EyeTrace, type Patient } from '../src/clinic/types';
import type { EyeTestResult } from '../src/tests/metrics/types';

const now = Date.UTC(2026, 9, 20);

function patient(partial: Partial<Patient> & Pick<Patient, 'id' | 'name'>): Patient {
  return {
    ownerUid: 'clinician-1',
    birthDate: '1990-01-02',
    sex: 'female',
    externalId: '',
    notes: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

function trace(points: EyeTrace['points'], eyeSide: 'left' | 'right' = 'left'): EyeTrace {
  return { eyeSide, points };
}

function checks() {
  const key = newVaultKey();
  const text = '{"name":"Nguyễn Văn A"}';
  const sealed = encryptJson(key, text);
  const again = encryptJson(key, text);
  assert.notEqual(sealed, again);
  assert.equal(decryptJson(key, sealed), text);
  assert.throws(() => decryptJson(key, sealed.slice(0, -4) + 'xxxx'));
  assert.throws(() => decryptJson(newVaultKey(), sealed));

  assert.equal(flagAtLeast(0.8, 0.8, 0.6), 'green');
  assert.equal(flagAtLeast(0.6, 0.8, 0.6), 'yellow');
  assert.equal(flagAtLeast(0.59, 0.8, 0.6), 'red');
  assert.equal(flagAtLeast(null, 0.8, 0.6), 'unscored');
  assert.equal(flagAtMost(300, 300, 400), 'green');
  assert.equal(flagAtMost(401, 300, 400), 'red');
  assert.equal(flagRatio(1.1, 0.15, 0.25), 'green');
  assert.equal(flagRatio(1.2, 0.15, 0.25), 'yellow');
  assert.equal(flagRatio(1.4, 0.15, 0.25), 'red');

  const rows = rowsFromEyeTest(
    {
      pursuit: [{ eyeSide: 'left', pursuitGain: 0.9, catchUpCandidateCount: 2 }],
      saccades: [
        {
          eyeSide: 'left',
          medianLatencyMs: 500,
          medianAccuracy: 1.02,
          medianPeakVelocityPerSecond: 2,
        },
      ],
    } as EyeTestResult,
    'adult',
  );
  assert.equal(rows.find((row) => row.id === 'gain-left')?.flag, 'green');
  assert.equal(rows.find((row) => row.id === 'lat-left')?.flag, 'red');
  assert.equal(rows.find((row) => row.id === 'vel-left')?.flag, 'unscored');
  assert.equal(rows.find((row) => row.id === 'vel-left')?.unit, 'viewport/s');

  const sampled = downsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3);
  assert.equal(sampled[0], 0);
  assert.equal(sampled[sampled.length - 1], 9);
  const down = traceFromSamples('right', [
    { tMs: 0, x: null, y: null },
    { tMs: 10, x: 0.2, y: 0.4 },
  ]);
  assert.equal(down.points.length, 1);
  assert.equal(down.eyeSide, 'right');

  const processed = tracesFromProcessed([
    {
      eyeSide: 'left',
      samples: [
        { raw: { decodedPtsUs: 1_000_000 }, processedX: 0.1, processedY: 0.2 },
        { raw: { decodedPtsUs: 1_050_000 }, processedX: 0.3, processedY: null },
      ],
    },
  ]);
  assert.equal(processed[0]?.points[1]?.tMs, 50);
  assert.equal(processed[0]?.points[1]?.x, 0.3);

  const vertical = trace([
    { tMs: 900, x: 0.5, y: 0.5 },
    { tMs: 1300, x: 0.5, y: 0.22 },
  ]);
  const step = verticalJumpSteps()[0];
  assert.ok(step);
  const accuracy = stepAccuracy(vertical, 'y', [step]).accuracy;
  assert.ok(accuracy !== null && Math.abs(accuracy - 1) < 1e-6);

  const anti = trace([
    { tMs: 900, x: 0.5, y: 0.5 },
    { tMs: 1200, x: 0.62, y: 0.5 },
  ]);
  const aligned = extendedRows(
    'anti-saccade',
    [anti],
    'adult',
    { cm: null, breakMs: null, recoveryMs: null },
    true,
  );
  assert.equal(aligned[0]?.value, '0.00');
  const hidden = extendedRows(
    'vertical-saccades',
    [vertical],
    'adult',
    { cm: null, breakMs: null, recoveryMs: null },
    false,
  );
  assert.equal(hidden[0]?.flag, 'unscored');
  assert.equal(hidden[0]?.value, '—');

  const drift = trace(
    Array.from({ length: 20 }, (_, index) => ({
      tMs: 1500 + index * 50,
      x: 0.4 + index * 0.001,
      y: 0.5,
    })),
  );
  const slow = slowPhaseVelocity(drift, 1500, 8500);
  assert.ok(slow !== null && slow < 1.5);
  const gaze = extendedRows(
    'gaze-nystagmus',
    [drift],
    'adult',
    { cm: null, breakMs: null, recoveryMs: null },
    false,
  );
  assert.equal(gaze[0]?.unit, 'eye-region/s');
  assert.equal(gaze[0]?.flag, 'unscored');

  assert.equal(oknAsymmetry(0.2, 0.1)?.toFixed(2), '0.33');
  assert.equal(oknAsymmetry(0.001, 0.001), null);
  const broke = npcBreak([
    { tMs: 0, gap: 0.2 },
    { tMs: 100, gap: 0.2 },
    { tMs: 200, gap: 0.21 },
    { tMs: 400, gap: 0.3 },
  ]);
  assert.equal(broke.breakMs, 400);
  assert.equal(broke.recoveryMs, null);
  const gaps = separationSeries(
    trace([
      { tMs: 10, x: 0.2, y: 0.5 },
      { tMs: 200, x: 0.25, y: 0.5 },
    ]),
    trace(
      [
        { tMs: 20, x: 0.4, y: 0.5 },
        { tMs: 400, x: 0.5, y: 0.5 },
      ],
      'right',
    ),
  );
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.gap, 0.2);

  assert.equal(parseNpcCm(''), null);
  assert.equal(parseNpcCm('0'), 0);
  assert.equal(parseNpcCm('12,5'), 12.5);
  assert.equal(parseNpcCm('-1'), null);
  assert.equal(parseNpcCm('80'), null);
  assert.equal(positionAt('vertical-saccades', 0).y, 0.5);
  assert.equal(positionAt('vertical-saccades', 1000).y.toFixed(2), '0.22');
  assert.equal(positionAt('anti-saccade', 1000).x.toFixed(2), '0.15');
  assert.equal(positionAt('gaze-nystagmus', 2000).x, 0.78);
  assert.equal(positionAt('okn', 1000).stripe, 'left');
  assert.equal(positionAt('okn', 6000).stripe, 'right');
  assert.equal(
    extendedQuality([
      trace(Array.from({ length: 8 }, (_, index) => ({ tMs: index, x: 0.1, y: 0.1 }))),
    ]),
    'RECORDED',
  );
  assert.equal(extendedQuality([trace([{ tMs: 0, x: 0.1, y: 0.1 }])]), 'INVALID');
  assert.equal(meanOrNull([null, 2, 4]), 3);

  const recent = patient({
    id: 'recent',
    name: 'Nguyễn',
    externalId: 'A-1',
    deletedAt: new Date(now - 10 * DAY_MS).toISOString(),
  });
  const expired = patient({
    id: 'old',
    name: 'Cũ',
    deletedAt: new Date(now - 31 * DAY_MS).toISOString(),
  });
  const live = patient({ id: 'live', name: 'Trần', ownerUid: 'other' });
  assert.equal(isPurged(expired, now), true);
  assert.equal(isPurged(recent, now), false);
  assert.equal(daysLeft(recent, now), 20);
  assert.equal(purgePatients([recent, expired, live], now).length, 2);
  assert.equal(deletedPatients([recent, expired], now).length, 1);
  assert.equal(searchPatients([recent, live], 'nguy', now).length, 0);
  assert.equal(
    searchPatients([live, patient({ id: 'n', name: 'Nguyễn An' })], 'nguy', now)[0]?.id,
    'n',
  );
  assert.equal(
    searchPatients([patient({ id: 'id', name: 'An', externalId: 'ZX9' })], 'zx', now).length,
    1,
  );
  assert.equal(
    ownedPatients([live, patient({ id: 'mine', name: 'Mine' })], 'clinician', 'clinician-1').length,
    1,
  );
  assert.equal(visiblePatients([live, expired], 'admin', 'clinician-1', now).length, 1);

  const first = ensureProfile([], 'u1', 'a@clinic.org');
  assert.equal(first[0]?.role, 'admin');
  const second = ensureProfile(first, 'u2', 'b@clinic.org');
  assert.equal(second[1]?.role, 'clinician');
  assert.equal(ensureProfile(second, 'u1', 'a@clinic.org').length, 2);
  assert.equal(setRole(second, 'u1', 'clinician')[0]?.role, 'admin');
  assert.equal(setRole(second, 'u2', 'admin')[1]?.role, 'admin');

  assert.equal(patientFieldError({ name: ' ', birthDate: '1990-01-02' }, now), 'name');
  assert.equal(patientFieldError({ name: 'An', birthDate: '1990-02-31' }, now), 'birthDate');
  assert.equal(patientFieldError({ name: 'An', birthDate: '1990-01-02' }, now), null);
  assert.equal(qualityRank({ quality: 'RECORDED' }), 'yellow');
  assert.equal(qualityRank({ quality: 'INVALID' }), 'red');

  const html = reportHtml({
    profile: null,
    patient: patient({ id: 'p', name: '<b>Nguyễn</b>' }),
    session: {
      id: 's',
      patientId: 'p',
      ownerUid: 'clinician-1',
      testId: 'smooth-pursuit',
      createdAt: '2026-10-20T01:02:03.000Z',
      quality: 'GOOD_DATA',
      rows,
      trace: [
        trace([
          { tMs: 0, x: 0.2, y: 0.5 },
          { tMs: 100, x: 0.8, y: 0.5 },
        ]),
      ],
      clinicianNote: 'ổn',
      deviceModel: 'phone',
      durationMs: 10000,
      fps: 120,
      npcCm: null,
    },
    disclaimer: 'not a diagnosis',
  });
  assert.ok(html.includes('&lt;b&gt;Nguyễn&lt;/b&gt;'));
  assert.ok(!html.includes('<b>Nguyễn'));
  assert.ok(html.includes('not a diagnosis'));
  assert.ok(html.includes('stroke="#087E8B"'));
  assert.notEqual(t('vi', 'patients'), t('en', 'patients'));
  assert.ok(readingFor('en', 'red').includes('not a diagnosis'));
  assert.ok(t('vi', 'patientName').includes('bệnh'));

  console.log('clinic logic: PASS');
}

checks();
