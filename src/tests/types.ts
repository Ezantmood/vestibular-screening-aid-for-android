export type MvpTestId = 'smooth-pursuit' | 'horizontal-saccades';

export interface ClinicalTestMeta {
  id: MvpTestId;
  label: string;
  status: 'planned' | 'mvp' | 'future';
}

export interface TestSession {
  id: string;
  testId: MvpTestId;
  patientId: string;
  startedAt: string;
}
