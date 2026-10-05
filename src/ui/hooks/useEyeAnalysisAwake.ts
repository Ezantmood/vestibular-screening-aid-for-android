import { useEffect } from 'react';
import { AppState } from 'react-native';
import { setEyeAnalysisKeepAwake } from '../../camera/eyeAnalysisStorage';

/** Keep long analysis visible; release on background, completion and unmount. */
export function useEyeAnalysisAwake(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const update = async (enabled: boolean) => {
      try {
        await setEyeAnalysisKeepAwake(enabled);
        if (enabled && disposed) await setEyeAnalysisKeepAwake(false);
      } catch (e) {
        console.warn('Eye analysis screen-awake unavailable', String(e));
      }
    };
    void update(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      void update(state === 'active');
    });
    return () => {
      disposed = true;
      subscription.remove();
      void update(false);
    };
  }, [active]);
}
