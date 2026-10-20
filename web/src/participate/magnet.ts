// The facade magnet on the phone, frame by frame: a port of buildings.magnet and
// buildings.snap_origin (pipeline/lacarte/buildings.py), which stay the reference. Same
// plane as the server: metres (EPSG:2154) relative to the camera, polygons from
// /api/facades, lon/lat converted by the affine frame it sends. Frozen cases shared with
// pytest: tests/fixtures/magnet-cases.json (web/tests/magnet.test.ts). No DOM, no import.

export type XY = [number, number];
/** Rings of [x, y]: the exterior first, then the holes; closed (last = first). */
export type Poly = XY[][];
export type Frame = { lon0: number; lat0: number; to_m: number[][]; to_ll: number[][] };
export type Pulled = { x: number; y: number; pulled: boolean; facade: [XY, XY] | null };

const SNAP_OFFSET_M = 0.5;
const MAX_SNAP_M = 10;
const ON_OUTLINE_M = 1e-3;
const TIE_TOLERANCE_M = 1e-3;
const RING = Array.from(
  { length: 72 },
  (_, k): XY => [Math.cos((2 * Math.PI * k) / 72), Math.sin((2 * Math.PI * k) / 72)],
);

export function toLocal(f: Frame, lon: number, lat: number): XY {
  const a = lon - f.lon0;
  const b = lat - f.lat0;
  return [f.to_m[0][0] * a + f.to_m[0][1] * b, f.to_m[1][0] * a + f.to_m[1][1] * b];
}

export function toLonLat(f: Frame, x: number, y: number): XY {
  return [
    f.lon0 + f.to_ll[0][0] * x + f.to_ll[0][1] * y,
    f.lat0 + f.to_ll[1][0] * x + f.to_ll[1][1] * y,
  ];
}

/** Nearest point of segment ab to p, and its distance. */
function onSegment(p: XY, a: XY, b: XY): [XY, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q: XY = [a[0] + t * dx, a[1] + t * dy];
  return [q, Math.hypot(p[0] - q[0], p[1] - q[1])];
}

/** Nearest point of the polygon's outline (every ring) to p, and its distance. */
function nearestOnOutline(poly: Poly, p: XY): [XY, number] {
  let best: [XY, number] = [p, Number.POSITIVE_INFINITY];
  for (const ring of poly) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const r = onSegment(p, ring[i], ring[i + 1]);
      if (r[1] < best[1]) best = r;
    }
  }
  return best;
}

/** Strictly inside (holes excluded, the outline itself is not inside), as GEOS contains. */
function contains(poly: Poly, p: XY): boolean {
  if (nearestOnOutline(poly, p)[1] === 0) return false;
  let inside = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
  }
  return inside;
}

/** Distance to the nearest polygon, negative when inside one (buildings._clearance). */
function clearance(p: XY, polys: Poly[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const poly of polys) {
    const d = nearestOnOutline(poly, p)[1];
    best = Math.min(best, contains(poly, p) ? -d : d);
  }
  return best;
}

/** The polygon whose outline is nearest (the first one on a tie, as Python's min). */
function host(polys: Poly[], p: XY): [Poly, number] {
  let best: [Poly, number] = [polys[0], Number.POSITIVE_INFINITY];
  for (const poly of polys) {
    const d = nearestOnOutline(poly, p)[1];
    if (d < best[1]) best = [poly, d];
  }
  return best;
}

/** buildings.snap_origin: out of (or away from) the nearest building, `offset` metres. */
export function snapOrigin(
  x: number,
  y: number,
  near: Poly[],
  offset = SNAP_OFFSET_M,
): [number, number, boolean] {
  if (!near.length) return [x, y, false];
  const p: XY = [x, y];
  const [h, d] = host(near, p);
  const inside = contains(h, p);
  if (!inside && d >= offset) return [x, y, false];
  if (inside && d > MAX_SNAP_M) return [x, y, false];
  const [[nx, ny]] = nearestOnOutline(h, p);
  const vx = inside ? nx - x : x - nx;
  const vy = inside ? ny - y : y - ny;
  const norm = Math.hypot(vx, vy);
  if (norm >= ON_OUTLINE_M) {
    const c: XY = [nx + (vx / norm) * offset, ny + (vy / norm) * offset];
    if (clearance(c, near) >= offset * 0.99) return [c[0], c[1], true];
  }
  // On the outline or at a corner: the mean of the near-best escape directions.
  const clear = RING.map(([ux, uy]) => clearance([nx + ux * offset, ny + uy * offset], near));
  const best = Math.max(...clear);
  const good = RING.filter((_, i) => clear[i] >= best - TIE_TOLERANCE_M);
  const mx = good.reduce((s, g) => s + g[0], 0);
  const my = good.reduce((s, g) => s + g[1], 0);
  const n = Math.hypot(mx, my);
  const [ux, uy] = n > 1e-9 ? [mx / n, my / n] : good[0];
  return [nx + ux * offset, ny + uy * offset, true];
}

/** Outline segment of `polys` nearest to p (buildings.nearest_edge). */
function nearestEdge(polys: Poly[], p: XY): [XY, XY] {
  let best: [XY, XY] = [p, p];
  let bestD = Number.POSITIVE_INFINITY;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const d = onSegment(p, ring[i], ring[i + 1])[1];
        if (d < bestD) {
          bestD = d;
          best = [ring[i], ring[i + 1]];
        }
      }
    }
  }
  return best;
}

/** buildings.magnet: a point inside a building, or within `capture` of the nearest
 * facade, ends SNAP_OFFSET_M outside that facade; farther away it stays. */
export function magnet(x: number, y: number, near: Poly[], capture: number): Pulled {
  const stay: Pulled = { x, y, pulled: false, facade: null };
  if (!near.length) return stay;
  let p: XY = [x, y];
  const [h, d] = host(near, p);
  if (!contains(h, p)) {
    if (d > capture) return stay;
    if (d >= ON_OUTLINE_M) {
      const [[nx, ny]] = nearestOnOutline(h, p);
      const k = SNAP_OFFSET_M / 2 / d;
      p = [nx + (x - nx) * k, ny + (y - ny) * k];
    }
  }
  const [sx, sy, snapped] = snapOrigin(p[0], p[1], near);
  if (!snapped) return stay;
  return { x: sx, y: sy, pulled: true, facade: nearestEdge(near, [sx, sy]) };
}
