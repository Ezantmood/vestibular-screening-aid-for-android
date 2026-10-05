import { useEffect } from 'react';
import { AppState } from 'react-native';
import { setEyeAnalysisKeepAwake } from '../../camera/eyeAnalysisStorage';
import { createScreenAwakeCoordinator } from '../../camera/screenAwake';

const coordinator = createScreenAwakeCoordinator(setEyeAnalysisKeepAwake, (error) => {
  console.warn('Eye analysis screen-awake unavailable', String(error));
});

/** Keep long analysis visible; release on background, completion and unmount. */
export function useEyeAnalysisAwake(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const owner = coordinator.createOwner(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      owner.setActive(state === 'active');
    });
    return () => {
      subscription.remove();
      owner.release();
    };
  }, [active]);
}
