import type { RefObject } from 'react';
import { Dimensions, type View } from 'react-native';
import {
  stableTargetViewport,
  type TargetViewport,
  type ViewportReadOptions,
} from '../../tests/stimulus/viewport';
import { CaptureCancelled } from '../../camera/recordingPreparation';

/** The target region's absolute display origin is part of calibration context. */
export async function measureTargetViewport(
  ref: RefObject<View | null>,
  options: Omit<ViewportReadOptions, 'now'> = {},
  container?: RefObject<View | null>,
) {
  let bounds: TargetViewport | null = null;
  const measure = (view: View) =>
    new Promise<TargetViewport>((resolve) => {
      view.measureInWindow((left, top, width, height) => resolve({ left, top, width, height }));
    });
  const read = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (options.cancelled?.()) throw new CaptureCancelled('Đã hủy chuẩn bị vùng target.');
    if (!ref.current || (container && !container.current))
      return { left: 0, top: 0, width: 0, height: 0 };
    const window = Dimensions.get('window');
    const [current, visible] = await Promise.all([
      measure(ref.current),
      container?.current
        ? measure(container.current)
        : Promise.resolve({ left: 0, top: 0, width: window.width, height: window.height }),
    ]);
    bounds = visible;
    return current;
  };
  return stableTargetViewport(read, { ...options, bounds: () => bounds });
}
