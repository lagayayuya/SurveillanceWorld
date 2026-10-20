// Where a camera is, in words, for the add / « Modifier » sheet's Position ticket (DECISIONS
// 2026-10-08, « The add / « Modifier » sheet… »: « the nearest street and its commune from
// the tiles already loaded »): the basemap's named roads and our communes, read from the
// map's loaded tiles, never from a third-party service. Pure on GeoJSON, so that
// web/tests can check it without a map.

type Position = [number, number];
type Feature = { geometry: GeoJSON.Geometry; properties: Record<string, unknown> | null };

/** A street farther than this from the camera is not named (a courtyard, a park). */
export const STREET_M = 50;

/** Metres east and north of `origin`, equirectangular: exact enough over 50 m. */
function local(origin: Position, p: Position): [number, number] {
  const k = Math.cos((origin[1] * Math.PI) / 180);
  return [(p[0] - origin[0]) * 111_320 * k, (p[1] - origin[1]) * 111_320];
}

/** Distance (m) from `at` to the segment a–b. */
function toSegment(at: Position, a: Position, b: Position): number {
  const [ax, ay] = local(at, a);
  const [bx, by] = local(at, b);
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const u = len > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + u * dx, ay + u * dy);
}

function lines(g: GeoJSON.Geometry): Position[][] {
  if (g.type === "LineString") return [g.coordinates as Position[]];
  if (g.type === "MultiLineString") return g.coordinates as Position[][];
  return [];
}

/** The basemap's road kinds one can stand in (its `roads` layer also holds railways,
 * tramways and metro lines: kind `rail`). */
const STREET_KINDS = new Set(["highway", "major_road", "minor_road", "path", "other"]);

/** The name the basemap writes on a street: French when it has one. */
function roadName(p: Record<string, unknown> | null): string | undefined {
  if (!STREET_KINDS.has(String(p?.kind))) return undefined;
  const name = p?.["name:fr"] ?? p?.name;
  return typeof name === "string" && name.trim() ? name : undefined;
}

/** The nearest named road within `maxM` of `at` (the basemap's `roads` features). */
export function nearestStreet(roads: Feature[], at: Position, maxM = STREET_M): string | undefined {
  let best: { name: string; m: number } | undefined;
  for (const f of roads) {
    const name = roadName(f.properties);
    if (!name) continue;
    for (const line of lines(f.geometry))
      for (let i = 1; i < line.length; i++) {
        const m = toSegment(at, line[i - 1], line[i]);
        if (m <= maxM && (!best || m < best.m)) best = { name, m };
      }
  }
  return best?.name;
}

/** Inside a ring (even–odd, lon / lat as a plane: tiles' polygons are small). */
function inRing(at: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > at[1] !== yj > at[1] && at[0] < ((xj - xi) * (at[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function polygons(g: GeoJSON.Geometry): Position[][][] {
  if (g.type === "Polygon") return [g.coordinates as Position[][]];
  if (g.type === "MultiPolygon") return g.coordinates as Position[][][];
  return [];
}

/** The name (`nm`) of the commune holding `at` (our admin tiles' `communes` features). */
export function communeAt(communes: Feature[], at: Position): string | undefined {
  for (const f of communes)
    for (const [outer, ...holes] of polygons(f.geometry))
      if (inRing(at, outer) && !holes.some((h) => inRing(at, h))) {
        const nm = f.properties?.nm;
        if (typeof nm === "string" && nm) return nm;
      }
  return undefined;
}
