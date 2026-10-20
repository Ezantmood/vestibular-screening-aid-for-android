/** Shared by calibration and the stimulus so both use one viewport.
 * A 180dp board moves the eye by only a few camera pixels, which is inside
 * the localization noise, so the 0.08 error gate cannot pass. */
export function targetBoardHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight < 1) return 420;
  return Math.max(420, Math.min(760, Math.round(windowHeight * 0.62)));
}
