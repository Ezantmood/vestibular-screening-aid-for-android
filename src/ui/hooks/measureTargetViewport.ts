import type { RefObject } from 'react';
import type { View } from 'react-native';

/** The target region's absolute display origin is part of calibration context. */
export async function measureTargetViewport(ref: RefObject<View | null>) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return new Promise<{ width: number; height: number; left: number; top: number }>(
    (resolve, reject) => {
      if (!ref.current) {
        reject(new Error('Vùng target chưa sẵn sàng.'));
        return;
      }
      ref.current.measureInWindow((left, top, width, height) => {
        if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
          reject(new Error('Vùng target chưa sẵn sàng.'));
        else resolve({ left, top, width, height });
      });
    },
  );
}
