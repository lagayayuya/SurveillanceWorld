// The shortest move that brings a point of the map into the part the panels leave free
// (main.ts freePadding): a tapped camera's pictogram, the focused camera's marker below the
// street level. Pure, so that it is tested without a map.

/** Space the panels take on each side of the map, in CSS px (MapLibre's PaddingOptions). */
export type Padding = { top: number; bottom: number; left: number; right: number };

/** How far the point `at` (CSS px in a map of `width` x `height`) must move on the screen
 * for a disc of radius `r` around it to lie wholly in the free part `pad` leaves: [dx, dy],
 * or null when it already does, when the point is off the screen (the user moved away from
 * it), or when the free part is smaller than the disc. The map's content moves by it
 * (MapLibre's panBy takes its opposite). */
export function nudge(
  at: { x: number; y: number },
  width: number,
  height: number,
  pad: Padding,
  r: number,
): [number, number] | null {
  if (at.x < 0 || at.y < 0 || at.x > width || at.y > height) return null;
  const [left, right] = [pad.left + r, width - pad.right - r];
  const [top, bottom] = [pad.top + r, height - pad.bottom - r];
  if (left > right || top > bottom) return null;
  const dx = at.x < left ? left - at.x : at.x > right ? right - at.x : 0;
  const dy = at.y < top ? top - at.y : at.y > bottom ? bottom - at.y : 0;
  return dx || dy ? [dx, dy] : null;
}
