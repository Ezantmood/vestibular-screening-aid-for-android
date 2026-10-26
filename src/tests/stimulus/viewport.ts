import { CaptureCancelled } from '../../camera/recordingPreparation';

export interface TargetViewport {
  width: number;
  height: number;
  left: number;
  top: number;
}

export interface ViewportReadOptions {
  ready?: () => boolean;
  cancelled?: () => boolean;
  timeoutMs?: number;
  now?: () => number;
  /** Actual visible native container, including the space reserved for controls. */
  bounds?: () => TargetViewport | null;
}

export function targetViewportVisible(current: TargetViewport, bounds: TargetViewport): boolean {
  return (
    [current, bounds].every(
      (v) =>
        [v.left, v.top, v.width, v.height].every(Number.isFinite) &&
        v.left >= 0 &&
        v.top >= 0 &&
        v.width > 0 &&
        v.height > 0,
    ) &&
    current.width >= 128 &&
    current.height >= 128 &&
    current.left >= bounds.left &&
    current.top >= bounds.top &&
    current.left + current.width <= bounds.left + bounds.width + 0.5 &&
    current.top + current.height <= bounds.top + bounds.height + 0.5
  );
}

/** Require consecutive stable, visible measurements AFTER the scroll settles.
 * A queued scrollTo is not proof that the native viewport has already moved. */
async function readStableViewport(
  read: () => Promise<TargetViewport>,
  options: ViewportReadOptions = {},
): Promise<TargetViewport> {
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? 2000;
  const deadline = now() + timeoutMs;
  let previous: TargetViewport | null = null;
  while (now() <= deadline) {
    if (options.cancelled?.()) throw new CaptureCancelled('Đã hủy chuẩn bị vùng target.');
    const current = await read();
    const bounds = options.bounds?.();
    if (options.cancelled?.()) throw new CaptureCancelled('Đã hủy chuẩn bị vùng target.');
    if (now() > deadline) break;
    if (
      options.ready?.() === false ||
      (options.bounds !== undefined && (!bounds || !targetViewportVisible(current, bounds))) ||
      ![current.left, current.top, current.width, current.height].every(Number.isFinite) ||
      current.left < 0 ||
      current.top < 0 ||
      current.width <= 0 ||
      current.height <= 0
    ) {
      previous = null;
      continue;
    }
    if (
      previous &&
      previous.left === current.left &&
      previous.top === current.top &&
      previous.width === current.width &&
      previous.height === current.height
    )
      return { ...current };
    previous = { ...current };
  }
  throw new Error('Vùng target chưa ổn định hoặc bị khuất. Hãy mở lại bài đo.');
}

export async function stableTargetViewport(
  read: () => Promise<TargetViewport>,
  options: ViewportReadOptions = {},
): Promise<TargetViewport> {
  const timeoutMs = options.timeoutMs ?? 2000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid viewport timeout.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readStableViewport(read, options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              options.cancelled?.()
                ? new CaptureCancelled('Đã hủy chuẩn bị vùng target.')
                : new Error('Không đo được vùng target ổn định. Hãy thử lại.'),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
