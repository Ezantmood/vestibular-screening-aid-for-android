import type { EyeTestResult } from '../tests/metrics/types';
import {
  DAY_MS,
  SOFT_DELETE_MS,
  type ClinicProfile,
  type ClinicTestId,
  type EyeTrace,
  type ExamSession,
  type Flag,
  type MetricRow,
  type NormGroup,
  type Patient,
  type Role,
  type TracePoint,
} from './types';

/**
 * Screening bands for comparable units only. They are not a diagnosis and they
 * are not a deg/s normative table. Pursuit gain and saccade accuracy are ratios.
 * Latency is milliseconds. Viewport velocity is never compared with deg/s ranges.
 */
const BANDS: Record<
  NormGroup,
  {
    gainGreen: number;
    gainYellow: number;
    latencyGreen: number;
    latencyYellow: number;
    accuracyIn: number;
    accuracyEdge: number;
    errorGreen: number;
    errorYellow: number;
    asymGreen: number;
    asymYellow: number;
  }
> = {
  adult: {
    gainGreen: 0.8,
    gainYellow: 0.6,
    latencyGreen: 300,
    latencyYellow: 400,
    accuracyIn: 0.15,
    accuracyEdge: 0.25,
    errorGreen: 0.3,
    errorYellow: 0.5,
    asymGreen: 0.25,
    asymYellow: 0.5,
  },
  'older-adult': {
    gainGreen: 0.7,
    gainYellow: 0.5,
    latencyGreen: 350,
    latencyYellow: 450,
    accuracyIn: 0.2,
    accuracyEdge: 0.3,
    errorGreen: 0.4,
    errorYellow: 0.6,
    asymGreen: 0.3,
    asymYellow: 0.55,
  },
};

export function flagAtLeast(value: number | null, green: number, yellow: number): Flag {
  if (value === null || !Number.isFinite(value)) return 'unscored';
  if (value >= green) return 'green';
  if (value >= yellow) return 'yellow';
  return 'red';
}

export function flagAtMost(value: number | null, green: number, yellow: number): Flag {
  if (value === null || !Number.isFinite(value)) return 'unscored';
  if (value <= green) return 'green';
  if (value <= yellow) return 'yellow';
  return 'red';
}

export function flagRatio(value: number | null, inside: number, edge: number): Flag {
  if (value === null || !Number.isFinite(value)) return 'unscored';
  const delta = Math.abs(value - 1);
  if (delta <= inside) return 'green';
  if (delta <= edge) return 'yellow';
  return 'red';
}

export function worstFlag(flags: Flag[]): Flag {
  if (flags.includes('red')) return 'red';
  if (flags.includes('yellow')) return 'yellow';
  if (flags.includes('green')) return 'green';
  return 'unscored';
}

const num = (value: number | null, digits = 2) =>
  value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);

function row(id: string, label: string, value: string, unit: string, flag: Flag): MetricRow {
  return { id, label, value, unit, flag };
}

export function rowsFromEyeTest(result: EyeTestResult, group: NormGroup): MetricRow[] {
  const band = BANDS[group];
  const rows: MetricRow[] = [];
  for (const eye of result.pursuit) {
    rows.push(
      row(
        `gain-${eye.eyeSide}`,
        `Pursuit gain (${eye.eyeSide})`,
        num(eye.pursuitGain),
        'ratio',
        flagAtLeast(eye.pursuitGain, band.gainGreen, band.gainYellow),
      ),
    );
    rows.push(
      row(
        `catch-${eye.eyeSide}`,
        `Catch-up candidates (${eye.eyeSide})`,
        eye.catchUpCandidateCount === null ? '—' : String(eye.catchUpCandidateCount),
        'count',
        'unscored',
      ),
    );
  }
  for (const eye of result.saccades) {
    rows.push(
      row(
        `lat-${eye.eyeSide}`,
        `Latency (${eye.eyeSide})`,
        num(eye.medianLatencyMs, 0),
        'ms',
        flagAtMost(eye.medianLatencyMs, band.latencyGreen, band.latencyYellow),
      ),
    );
    rows.push(
      row(
        `acc-${eye.eyeSide}`,
        `Accuracy (${eye.eyeSide})`,
        num(eye.medianAccuracy),
        'ratio',
        flagRatio(eye.medianAccuracy, band.accuracyIn, band.accuracyEdge),
      ),
    );
    rows.push(
      row(
        `vel-${eye.eyeSide}`,
        `Peak velocity (${eye.eyeSide})`,
        num(eye.medianPeakVelocityPerSecond),
        'viewport/s',
        'unscored',
      ),
    );
  }
  return rows;
}

export function downsample<T>(items: readonly T[], maxPoints: number): T[] {
  if (maxPoints < 2 || items.length <= maxPoints) return [...items];
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round((i * (items.length - 1)) / (maxPoints - 1));
    const item = items[index];
    if (item !== undefined) out.push(item);
  }
  return out;
}

export function traceFromSamples(
  eyeSide: 'left' | 'right',
  samples: readonly { tMs: number; x: number | null; y: number | null }[],
  maxPoints = 80,
): EyeTrace {
  const present = samples.filter((sample) => sample.x !== null || sample.y !== null);
  return { eyeSide, points: downsample(present, maxPoints) };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? null);
}

function series(trace: EyeTrace, axis: 'x' | 'y'): TracePoint[] {
  return trace.points.filter((point) => point[axis] !== null);
}

export function stepAccuracy(
  trace: EyeTrace,
  axis: 'x' | 'y',
  steps: readonly { tMs: number; from: number; to: number }[],
): { accuracy: number | null; counted: number } {
  const points = series(trace, axis);
  const ratios: number[] = [];
  for (const step of steps) {
    const before = points.filter((point) => point.tMs >= step.tMs - 200 && point.tMs < step.tMs);
    const after = points.filter(
      (point) => point.tMs >= step.tMs + 120 && point.tMs <= step.tMs + 500,
    );
    const base = median(before.map((point) => point[axis] as number));
    const next = median(after.map((point) => point[axis] as number));
    const target = step.to - step.from;
    if (base === null || next === null || Math.abs(target) < 0.02) continue;
    ratios.push((next - base) / target);
  }
  return { accuracy: median(ratios), counted: ratios.length };
}

export function antiSaccadeScore(
  trace: EyeTrace,
  steps: readonly { tMs: number; from: number; to: number }[],
): { errorRate: number | null; trials: number; correct: number } {
  const points = series(trace, 'x');
  let trials = 0;
  let correct = 0;
  for (const step of steps) {
    const direction = Math.sign(step.to - step.from);
    if (direction === 0) continue;
    const basePoints = points.filter(
      (point) => point.tMs >= step.tMs - 200 && point.tMs < step.tMs,
    );
    const base = median(basePoints.map((point) => point.x as number));
    if (base === null) continue;
    const moved = points.find(
      (point) =>
        point.tMs >= step.tMs &&
        point.tMs <= step.tMs + 700 &&
        Math.abs((point.x as number) - base) >= 0.06,
    );
    if (!moved) continue;
    trials += 1;
    if (Math.sign((moved.x as number) - base) === -direction) correct += 1;
  }
  return { errorRate: trials === 0 ? null : (trials - correct) / trials, trials, correct };
}

export function signedPhaseVelocity(
  trace: EyeTrace,
  holdStartMs: number,
  holdEndMs: number,
): number | null {
  const points = series(trace, 'x').filter(
    (point) => point.tMs >= holdStartMs && point.tMs <= holdEndMs,
  );
  const velocities: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (!previous || !current || previous.x === null || current.x === null) continue;
    const dt = (current.tMs - previous.tMs) / 1000;
    if (dt <= 0 || dt > 0.08) continue;
    const velocity = (current.x - previous.x) / dt;
    if (Math.abs(velocity) <= 1.5) velocities.push(velocity);
  }
  return median(velocities);
}

export function slowPhaseVelocity(
  trace: EyeTrace,
  holdStartMs: number,
  holdEndMs: number,
): number | null {
  const value = signedPhaseVelocity(trace, holdStartMs, holdEndMs);
  return value === null ? null : Math.abs(value);
}

export function separationSeries(left: EyeTrace, right: EyeTrace): { tMs: number; gap: number }[] {
  const out: { tMs: number; gap: number }[] = [];
  for (const point of left.points) {
    if (point.x === null) continue;
    const other = right.points.find(
      (candidate) => candidate.x !== null && Math.abs(candidate.tMs - point.tMs) < 25,
    );
    if (!other || other.x === null) continue;
    out.push({ tMs: point.tMs, gap: Math.abs(other.x - point.x) });
  }
  return out;
}

export function oknAsymmetry(
  leftVelocity: number | null,
  rightVelocity: number | null,
): number | null {
  if (leftVelocity === null || rightVelocity === null) return null;
  const denom = Math.abs(leftVelocity) + Math.abs(rightVelocity);
  if (denom < 0.02) return null;
  return (leftVelocity - rightVelocity) / denom;
}

export function npcBreak(separation: readonly { tMs: number; gap: number }[]): {
  breakMs: number | null;
  recoveryMs: number | null;
} {
  if (separation.length < 4) return { breakMs: null, recoveryMs: null };
  const gaps = separation.map((sample) => sample.gap);
  const min = Math.min(...gaps);
  const broke = separation.find((sample) => sample.gap > min + 0.04);
  if (!broke) return { breakMs: null, recoveryMs: null };
  const recovered = separation.find((sample) => sample.tMs > broke.tMs && sample.gap < min + 0.02);
  return { breakMs: broke.tMs, recoveryMs: recovered?.tMs ?? null };
}

export function protocolRows(
  testId: ClinicTestId,
  group: NormGroup,
  input: {
    accuracy?: number | null;
    errorRate?: number | null;
    slowVelocity?: number | null;
    asymmetry?: number | null;
    npcCm?: number | null;
    breakMs?: number | null;
    recoveryMs?: number | null;
  },
): MetricRow[] {
  const band = BANDS[group];
  if (testId === 'vertical-saccades') {
    return [
      row(
        'acc-v',
        'Vertical accuracy',
        num(input.accuracy ?? null),
        'ratio',
        flagRatio(input.accuracy ?? null, band.accuracyIn, band.accuracyEdge),
      ),
    ];
  }
  if (testId === 'anti-saccade') {
    return [
      row(
        'err',
        'Error rate',
        num(input.errorRate ?? null),
        'ratio',
        flagAtMost(input.errorRate ?? null, band.errorGreen, band.errorYellow),
      ),
    ];
  }
  if (testId === 'gaze-nystagmus') {
    return [
      row('spv', 'Slow-phase velocity', num(input.slowVelocity ?? null), 'viewport/s', 'unscored'),
    ];
  }
  if (testId === 'okn') {
    return [
      row(
        'asym',
        'OKN asymmetry',
        num(input.asymmetry ?? null),
        'ratio',
        flagAtMost(
          input.asymmetry === null || input.asymmetry === undefined
            ? null
            : Math.abs(input.asymmetry),
          band.asymGreen,
          band.asymYellow,
        ),
      ),
    ];
  }
  if (testId === 'npc') {
    return [
      row('npc', 'NPC distance', num(input.npcCm ?? null, 1), 'cm', 'unscored'),
      row('break', 'Break', num(input.breakMs ?? null, 0), 'ms', 'unscored'),
      row('recovery', 'Recovery', num(input.recoveryMs ?? null, 0), 'ms', 'unscored'),
    ];
  }
  return [];
}

export function searchPatients(
  patients: readonly Patient[],
  query: string,
  nowMs: number,
): Patient[] {
  const needle = query.trim().toLowerCase();
  return patients
    .filter((patient) => !isPurged(patient, nowMs))
    .filter((patient) => patient.deletedAt === null)
    .filter((patient) => {
      if (!needle) return true;
      return (
        patient.name.toLowerCase().includes(needle) ||
        patient.externalId.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function visiblePatients(
  patients: readonly Patient[],
  role: Role,
  uid: string,
  nowMs: number,
): Patient[] {
  const owned =
    role === 'admin' ? patients : patients.filter((patient) => patient.ownerUid === uid);
  return searchPatients(owned, '', nowMs);
}

export function isPurged(patient: Patient, nowMs: number): boolean {
  if (patient.deletedAt === null) return false;
  const deleted = Date.parse(patient.deletedAt);
  return Number.isFinite(deleted) && nowMs - deleted >= SOFT_DELETE_MS;
}

export function purgePatients(patients: readonly Patient[], nowMs: number): Patient[] {
  return patients.filter((patient) => !isPurged(patient, nowMs));
}

export function deletedPatients(patients: readonly Patient[], nowMs: number): Patient[] {
  return patients.filter((patient) => patient.deletedAt !== null && !isPurged(patient, nowMs));
}

export function daysLeft(patient: Patient, nowMs: number): number {
  if (patient.deletedAt === null) return 30;
  const deleted = Date.parse(patient.deletedAt);
  return Math.max(0, Math.ceil((SOFT_DELETE_MS - (nowMs - deleted)) / DAY_MS));
}

export function ensureProfile(
  profiles: readonly ClinicProfile[],
  uid: string,
  email: string,
): ClinicProfile[] {
  if (profiles.some((profile) => profile.uid === uid)) return [...profiles];
  const role: Role = profiles.some((profile) => profile.role === 'admin') ? 'clinician' : 'admin';
  return [...profiles, { uid, email, name: '', specialty: '', workplace: '', role }];
}

export function sessionsFor(
  sessions: readonly ExamSession[],
  patientId: string | null,
): ExamSession[] {
  return sessions
    .filter((session) => session.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function primaryNumber(session: ExamSession): number | null {
  const raw = session.rows[0]?.value;
  if (!raw || raw === '—') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function qualityRank(session: Pick<ExamSession, 'quality'>): Flag {
  if (session.quality === 'GOOD_DATA') return 'green';
  if (session.quality === 'POOR_DATA' || session.quality === 'RECORDED') return 'yellow';
  return 'red';
}

export function meanOrNull(values: readonly (number | null | undefined)[]): number | null {
  const finite = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function ownedPatients(patients: readonly Patient[], role: Role, uid: string): Patient[] {
  return role === 'admin' ? [...patients] : patients.filter((patient) => patient.ownerUid === uid);
}

export function visibleSessions(
  sessions: readonly ExamSession[],
  role: Role,
  uid: string,
): ExamSession[] {
  const rows = role === 'admin' ? sessions : sessions.filter((session) => session.ownerUid === uid);
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function patientFieldError(
  input: { name: string; birthDate: string },
  nowMs: number,
): 'name' | 'birthDate' | null {
  if (!input.name.trim()) return 'name';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.birthDate.trim());
  if (!match) return 'birthDate';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return 'birthDate';
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    utc > nowMs
  ) {
    return 'birthDate';
  }
  return null;
}

export function setRole(
  profiles: readonly ClinicProfile[],
  uid: string,
  role: Role,
): ClinicProfile[] {
  const admins = profiles.filter((profile) => profile.role === 'admin').length;
  return profiles.map((profile) => {
    if (profile.uid !== uid) return profile;
    if (profile.role === 'admin' && role === 'clinician' && admins <= 1) return profile;
    return { ...profile, role };
  });
}

export function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export const TEST_ORDER: ClinicTestId[] = [
  'smooth-pursuit',
  'horizontal-saccades',
  'vertical-saccades',
  'anti-saccade',
  'gaze-nystagmus',
  'okn',
  'npc',
];
