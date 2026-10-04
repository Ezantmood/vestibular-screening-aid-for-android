import { defaultStimulus } from './stimulus/engine';

export const HORIZONTAL_SACCADES_ID = 'horizontal-saccades' as const;
export const createStimulus = () => defaultStimulus(HORIZONTAL_SACCADES_ID);
