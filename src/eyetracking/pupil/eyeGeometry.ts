/** ML Kit eyelid contour in original decoded pixels. These are anatomical
 * boundaries, not the eye-center landmark that may follow the pupil. */
export interface EyePoint {
  x: number;
  y: number;
}
export type EyeContour = readonly EyePoint[];

/** Longest contour chord locates the two canthi without relying on a face box,
 * crop center, or an undocumented contour index. Orient it in upright image X.
 * An aperture that is too small/closed cannot supply a gaze reference. */
export function eyeCoordinateFrame(contour: EyeContour | null | undefined, rotation = 0) {
  if (
    !Array.isArray(contour) ||
    contour.length !== 16 ||
    ![0, 90, 180, 270].includes(rotation) ||
    contour.some((p) => !p || ![p.x, p.y].every(Number.isFinite))
  )
    return null;
  let a = contour[0],
    b = contour[0],
    lengthSquared = 0;
  let twiceArea = 0;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i],
      q = contour[(i + 1) % contour.length];
    twiceArea += p.x * q.y - q.x * p.y;
    for (let j = i + 1; j < contour.length; j++) {
      const distance = (p.x - contour[j].x) ** 2 + (p.y - contour[j].y) ** 2;
      if (distance > lengthSquared) {
        a = p;
        b = contour[j];
        lengthSquared = distance;
      }
    }
  }
  const width = Math.sqrt(lengthSquared);
  const area = Math.abs(twiceArea) / 2;
  if (width < 12 || area < 24 || area / lengthSquared < 0.06) return null;
  const uprightX = (p: EyePoint) =>
    rotation === 90 ? -p.y : rotation === 180 ? -p.x : rotation === 270 ? p.y : p.x;
  if (uprightX(a) > uprightX(b)) [a, b] = [b, a];
  const ux = (b.x - a.x) / width,
    uy = (b.y - a.y) / width;
  return { a, b, width, ux, uy };
}

export function pupilInEyeFrame(pupil: EyePoint, contour: EyeContour, rotation = 0) {
  const frame = eyeCoordinateFrame(contour, rotation);
  if (!frame || ![pupil.x, pupil.y].every(Number.isFinite)) return null;
  const dx = pupil.x - frame.a.x,
    dy = pupil.y - frame.a.y;
  return {
    x: (dx * frame.ux + dy * frame.uy) / frame.width,
    y: 0.5 + (-dx * frame.uy + dy * frame.ux) / frame.width,
    unitPx: frame.width,
  };
}

/** The mask actually measured must be identical to the requested mask. */
export function sameEyeContour(
  a: EyeContour | null | undefined,
  b: EyeContour | null | undefined,
): boolean {
  if (a == null || b == null) return a == null && b == null;
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === 16 &&
    b.length === 16 &&
    a.every(
      (p, i) =>
        !!p &&
        !!b[i] &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.x === b[i].x &&
        p.y === b[i].y,
    )
  );
}
