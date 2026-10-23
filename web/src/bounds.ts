// Zoomed out, the region stays whole and in the middle (user decision 2026-10-23): the map's
// lowest zoom fits the region (meta.json `bounds`: on a phone, France fills the screen's
// width), and a view taken outside the region, give or take a margin, comes back once the
// gesture is over, never during it (no fight with the finger: MapLibre's maxBounds would
// clamp every frame of the drag). Pure: main.ts wires it to the map's `moveend`.

/** [west, south, east, north], degrees. */
export type Bounds = [number, number, number, number];
export type LngLat = [number, number];

/** MapLibre draws the world over 512 CSS px at zoom 0. */
const WORLD_PX = 512;
/** The lowest zoom never goes above today's (5): a small region (a test extract) keeps it. */
export const LOWEST_ZOOM_CAP = 5;
/** How far beyond the region the view's centre may stay, as a share of the screen: at
 * least this much of the screen keeps showing the region. */
export const MARGIN = 0.25;
/** Within this much of the lowest zoom, the region is centred, not only kept in view. */
export const CENTRED_BELOW = 0.25;
/** A centre this close (CSS px) to where it belongs is left alone. */
const SLACK_PX = 1;

const mx = (lon: number) => (lon + 180) / 360;
const my = (lat: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const lonOf = (x: number) => x * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** The zoom at which the region just fits a width × height screen (CSS px). */
export function fitZoom(b: Bounds, width: number, height: number): number {
  const dx = mx(b[2]) - mx(b[0]);
  const dy = my(b[1]) - my(b[3]);
  return Math.log2(Math.min(width / (WORLD_PX * dx), height / (WORLD_PX * dy)));
}

/** The map's lowest zoom: the region whole on the screen, at most LOWEST_ZOOM_CAP. */
export function lowestZoom(b: Bounds, width: number, height: number): number {
  return Math.min(LOWEST_ZOOM_CAP, fitZoom(b, width, height));
}

/** Where the view's centre goes back to once a gesture is over, or null when it may stay:
 * near the lowest zoom, the region's middle; elsewhere, the nearest point that keeps the
 * centre within the region widened by MARGIN of the screen. */
export function recentre(
  center: LngLat,
  zoom: number,
  b: Bounds,
  width: number,
  height: number,
): LngLat | null {
  const scale = WORLD_PX * 2 ** zoom; // CSS px per world unit
  const [x, y] = [mx(center[0]), my(center[1])];
  const [x0, x1, y0, y1] = [mx(b[0]), mx(b[2]), my(b[3]), my(b[1])];
  let tx: number;
  let ty: number;
  if (zoom <= lowestZoom(b, width, height) + CENTRED_BELOW) {
    [tx, ty] = [(x0 + x1) / 2, (y0 + y1) / 2];
  } else {
    const [mX, mY] = [(MARGIN * width) / scale, (MARGIN * height) / scale];
    tx = Math.min(Math.max(x, x0 - mX), x1 + mX);
    ty = Math.min(Math.max(y, y0 - mY), y1 + mY);
  }
  if (Math.hypot((tx - x) * scale, (ty - y) * scale) <= SLACK_PX) return null;
  return [lonOf(tx), latOf(ty)];
}
