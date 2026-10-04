import { defaultStimulus } from './stimulus/engine';

export const SMOOTH_PURSUIT_ID = 'smooth-pursuit' as const;
export const createStimulus = () => defaultStimulus(SMOOTH_PURSUIT_ID);
