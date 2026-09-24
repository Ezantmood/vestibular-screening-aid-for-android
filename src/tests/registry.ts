import type { ClinicalTestMeta } from './types';

// Test registry: single source of truth for which tests exist and their phase.
// MVP = Smooth Pursuit + Horizontal Saccades. No test logic here yet.
export const TEST_REGISTRY: ClinicalTestMeta[] = [
  { id: 'smooth-pursuit', label: 'Smooth Pursuit', status: 'mvp' },
  { id: 'horizontal-saccades', label: 'Horizontal Saccades', status: 'mvp' },
];
