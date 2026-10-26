/** Shared by calibration and the stimulus so both use one viewport.
 * The binding limit is how far the eye rotates, which is mostly the
 * phone's width and the viewing distance. Height still uses most of the
 * window so the vertical targets are not the smaller angle. */
export function targetBoardHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight < 1) return 420;
  return Math.max(420, Math.min(860, Math.round(windowHeight * 0.85)));
}
