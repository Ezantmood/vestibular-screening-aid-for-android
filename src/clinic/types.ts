export type Lang = 'vi' | 'en';
export type Role = 'admin' | 'clinician';
export type Sex = 'female' | 'male' | 'other' | 'unspecified';
export type NormGroup = 'adult' | 'older-adult';
export type Flag = 'green' | 'yellow' | 'red' | 'unscored';
export type ClinicTestId =
  | 'smooth-pursuit'
  | 'horizontal-saccades'
  | 'vertical-saccades'
  | 'anti-saccade'
  | 'gaze-nystagmus'
  | 'okn'
  | 'npc';

export const BATTERY: ClinicTestId[] = [
  'smooth-pursuit',
  'horizontal-saccades',
  'vertical-saccades',
  'anti-saccade',
  'gaze-nystagmus',
  'okn',
];

export type ClinicProfile = {
  uid: string;
  email: string;
  name: string;
  specialty: string;
  workplace: string;
  role: Role;
};

export type Patient = {
  id: string;
  ownerUid: string;
  name: string;
  birthDate: string;
  sex: Sex;
  externalId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TracePoint = { tMs: number; x: number | null; y: number | null };
export type EyeTrace = { eyeSide: 'left' | 'right'; points: TracePoint[] };

export type MetricRow = {
  id: string;
  label: string;
  value: string;
  unit: string;
  flag: Flag;
};

export type ExamSession = {
  id: string;
  patientId: string | null;
  ownerUid: string;
  testId: ClinicTestId;
  createdAt: string;
  quality: 'GOOD_DATA' | 'POOR_DATA' | 'INVALID' | 'RECORDED';
  rows: MetricRow[];
  trace: EyeTrace[];
  clinicianNote: string;
  deviceModel: string;
  durationMs: number | null;
  fps: number | null;
  npcCm: number | null;
};

export type AuditEvent = {
  at: string;
  uid: string;
  action:
    | 'login'
    | 'logout'
    | 'patient-create'
    | 'patient-edit'
    | 'patient-delete'
    | 'patient-restore'
    | 'test'
    | 'pdf'
    | 'wipe';
  detail: string;
};

export type ClinicSettings = {
  language: Lang;
  normGroup: NormGroup;
  demoMode: boolean;
  wipeOnLogout: boolean;
  cloudBackup: boolean;
  tutorialSeen: boolean;
};

export type VaultData = {
  version: 1;
  profiles: ClinicProfile[];
  patients: Patient[];
  sessions: ExamSession[];
  audit: AuditEvent[];
  settingsByUid: Record<string, ClinicSettings>;
};

export const DAY_MS = 24 * 60 * 60 * 1000;
export const SOFT_DELETE_MS = 30 * DAY_MS;

export function defaultSettings(): ClinicSettings {
  return {
    language: 'vi',
    normGroup: 'adult',
    demoMode: false,
    wipeOnLogout: false,
    cloudBackup: false,
    tutorialSeen: false,
  };
}

export function emptyVault(): VaultData {
  return { version: 1, profiles: [], patients: [], sessions: [], audit: [], settingsByUid: {} };
}
