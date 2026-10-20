// Punk: how wide our streets are drawn, filmed or not. Each segment carries its width class
// `c` (pipeline rules/streets.yaml tile_class: the basemap's road class for its type), the
// name of the basemap's line layer `roads_<c>`: from z15 that layer is drawn above the
// fields (layers.ts drawnBasemap), and our stroke takes its fill width, so that no white is
// left on the sides of a filmed boulevard or motorway (product owner, 2026-10-16: 1 to 2 px
// on each side). Never narrower than the pink stroke was (the floor, PUNK_PORTION_WIDTH in
// layers.ts): a path, 1.6 px wide in the basemap at z16, keeps its 3.5 px.
//
// One expression for the filmed, the unfilmed and the focused streets, built from the
// flavour's own layers (the widths are the same in light and dark). MapLibre takes the zoom
// only as the input of a top-level curve: so one exponential curve (base 1.6, the
// basemap's) whose stops hold a `match` on the class. At the union of the classes' stops
// it is the basemap's curve exactly (an exponential curve cut at one of its points is the
// same two curves), stops where a road and the floor cross, and stops every quarter zoom
// follow the floor where it wins (linear: within 0.05 px). A segment without a class takes
// the floor: the class `other` (written as none, roads_other being never wider than the
// floor), the z12-14 merged portions, a build before rules 3.1.
import type { ExpressionSpecification } from "maplibre-gl";

type Curve = { base: number; stops: [number, number][] };
type Layer = { id: string; type: string; paint?: Record<string, unknown> };

/** The pink stroke before rules 3.1, now the floor (layers.ts PORTION_WIDTH's comment). */
export const PUNK_PORTION_WIDTH = [
  "interpolate",
  ["linear"],
  ["zoom"],
  ...[12, 2.4, 14, 3.5, 15, 4.5, 16, 3.5, 17, 3.5 + 1 / 3, 18, 6, 19, 10, 20, 16],
] as ExpressionSpecification;

export const CLASSES = ["other", "minor", "minor_service", "major", "link", "highway"] as const;
const BASE = 1.6;
const FROM = 12; // our streets' first zoom (tiles.STREETS_MIN)
const TO = 20;
const STEP = 0.25;

/** A zoom curve `["interpolate", [linear | exponential b], ["zoom"], z, v, …]`. */
export function curve(expr: unknown): Curve | null {
  if (!Array.isArray(expr) || expr[0] !== "interpolate") return null;
  const kind = expr[1] as unknown[];
  const base = kind[0] === "linear" ? 1 : kind[0] === "exponential" ? Number(kind[1]) : NaN;
  if (Number.isNaN(base)) return null;
  const stops: [number, number][] = [];
  for (let i = 3; i + 1 < expr.length; i += 2) {
    if (typeof expr[i + 1] !== "number") return null;
    stops.push([Number(expr[i]), Number(expr[i + 1])]);
  }
  return { base, stops };
}

/** Its value at `z`, as MapLibre computes it (clamped at both ends). */
export function at(c: Curve, z: number): number {
  const s = c.stops;
  if (z <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    const [z1, v1] = s[i];
    if (z > z1) continue;
    const [z0, v0] = s[i - 1];
    const d = z1 - z0;
    const t = c.base === 1 ? (z - z0) / d : (c.base ** (z - z0) - 1) / (c.base ** d - 1);
    return v0 + (v1 - v0) * t;
  }
  return s[s.length - 1][1];
}

/** The width expression of our streets over the basemap's `layers` (the flavour's), never
 * under `floor`. Without the basemap's road layers (another basemap): the floor alone. */
export function streetWidth(
  layers: Layer[],
  floor: ExpressionSpecification,
): ExpressionSpecification {
  const low = curve(floor);
  if (!low) return floor;
  const roads = new Map<string, Curve>();
  for (const name of CLASSES) {
    const l = layers.find((x) => x.id === `roads_${name}` && x.type === "line");
    const c = l && curve(l.paint?.["line-width"]);
    if (c && c.base === BASE) roads.set(name, c);
  }
  if (!roads.size) return floor;
  const zooms = new Set<number>();
  for (let z = FROM; z <= TO; z += STEP) zooms.add(z);
  for (const c of [low, ...roads.values()])
    for (const [z] of c.stops) if (z >= FROM && z <= TO) zooms.add(z);
  // Where a road and the floor cross, a stop of its own: between two stops one curve wins.
  const grid = [...zooms].sort((a, b) => a - b);
  for (const c of roads.values())
    for (let i = 1; i < grid.length; i++) {
      const gap = (z: number) => at(c, z) - at(low, z);
      let [a, b] = [grid[i - 1], grid[i]];
      if (gap(a) * gap(b) >= 0) continue;
      for (let k = 0; k < 40; k++) {
        const m = (a + b) / 2;
        if (gap(a) * gap(m) <= 0) b = m;
        else a = m;
      }
      zooms.add(round(a));
    }
  const stops: (number | ExpressionSpecification)[] = [];
  for (const z of [...zooms].sort((a, b) => a - b)) {
    const f = round(at(low, z));
    const arms = [...roads].flatMap(([name, c]) => [name, round(Math.max(at(c, z), f))]);
    stops.push(z, ["match", ["get", "c"], ...arms, f] as unknown as ExpressionSpecification);
  }
  return ["interpolate", ["exponential", BASE], ["zoom"], ...stops] as ExpressionSpecification;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
