import type { ClinicalTestMeta } from './types';

// Test registry: single source of truth for which tests exist and their phase.
// Engineering tests only; their results carry quality gates and no diagnosis.
export const TEST_REGISTRY: ClinicalTestMeta[] = [
  { id: 'smooth-pursuit', label: 'Smooth Pursuit', status: 'mvp' },
  { id: 'horizontal-saccades', label: 'Horizontal Saccades', status: 'mvp' },
];
