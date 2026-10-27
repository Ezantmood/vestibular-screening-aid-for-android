// App.tsx selects the authenticated clinician flow or the offline engineering tools.
// TODO (Phase 1): adopt expo-router or React Navigation with routes:
//   / (home) -> /patients -> /tests/:testId -> /results/:sessionId
export type AppRoute = 'home' | 'patients' | 'test-runner' | 'results';
export {};
