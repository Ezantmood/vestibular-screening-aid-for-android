export class CaptureCancelled extends Error {}

/** Recheck cancellation after asynchronous setup, before starting the recorder. */
export async function prepareRecording(
  cancelled: () => boolean,
  prepare?: (cancelled: () => boolean) => void | Promise<void>,
): Promise<void> {
  if (cancelled()) throw new CaptureCancelled('Đã hủy ghi hình.');
  await prepare?.(cancelled);
  if (cancelled()) throw new CaptureCancelled('Đã hủy ghi hình.');
}
