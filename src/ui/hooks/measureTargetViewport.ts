import type { RefObject } from 'react';
import type { View } from 'react-native';
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
) {
  const read = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (options.cancelled?.()) throw new CaptureCancelled('Đã hủy chuẩn bị vùng target.');
    return new Promise<TargetViewport>((resolve, reject) => {
      if (!ref.current) {
        reject(new Error('Vùng target chưa sẵn sàng.'));
        return;
      }
      ref.current.measureInWindow((left, top, width, height) => {
        resolve({ left, top, width, height });
      });
    });
  };
  return stableTargetViewport(read, options);
}
