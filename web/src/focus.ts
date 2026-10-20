// Focus mode: where each level's reach is written on the focused camera's outlines.
import type { FeatureCollection, Point } from "geojson";
import { LngLatBounds, type Map as MlMap } from "maplibre-gl";

/** The focused camera: feature id, compact number, position, and what the filters test. */
export type Focus = {
  id: number;
  n: number;
  lngLat: [number, number];
  props: { o: string; k: string; fl: number; op?: number };
};
export const NO_POINTS: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };

// Among vertices as far as the farthest one (full circles), labels go to this bearing
// (degrees clockwise from north) so that they line up like a ruler.
const LABEL_BEARING = 135;
const TIE_M = 0.5;

/** A box in the map's CSS pixels. */
export type Box = { left: number; top: number; right: number; bottom: number };
/** Where a level's label may go (punk): the part of the map the panels leave free, minus the
 * floating buttons over it, and the size of a level's label in CSS px. */
export type LabelRoom = Box & {
  obstacles: Box[];
  size: (lv: number, r: number) => [number, number];
};
/** The label's tilt (layers.ts TAG_ROTATE, -4°) lifts or lowers its far end by this share of
 * its width; a margin around it. */
const TILT = Math.sin((4 * Math.PI) / 180);
const MARGIN = 4;

/** How much of the label at `at` (its tip, anchored left) lies outside `room` or over one of
 * its obstacles, in square CSS px: 0 when it is wholly in view. */
function overflow(at: { x: number; y: number }, [w, h]: [number, number], room: LabelRoom): number {
  const half = h / 2 + (w * TILT) / 2 + MARGIN;
  const box = {
    left: at.x - MARGIN,
    right: at.x + w + MARGIN,
    top: at.y - half,
    bottom: at.y + half,
  };
  const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
  const meet = (a: Box, b: Box): Box => ({
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom),
  });
  return (
    area(box) -
    area(meet(box, room)) +
    room.obstacles.reduce((sum, o) => sum + area(meet(box, o)), 0)
  );
}

/** One point per displayed level of the focused camera's band for estimate `est`: the
 * band vertex farthest from the camera, i.e. where its reach `r` (computed by the pipeline
 * from the drawn band) is reached. Labels are placed there. With a `room` (punk), the
 * farthest vertex whose label lies wholly in the visible map, never under a panel or a
 * floating button (product owner, 2026-10-08); when none does, the one whose label overflows
 * least. */
export function reachLabelPoints(
  map: MlMap,
  f: Focus,
  est: number,
  room?: LabelRoom,
): FeatureCollection<Point> {
  const [lon0, lat0] = f.lngLat;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  type Vertex = { lon: number; lat: number; d: number; off: number };
  const byLevel = new Map<number, { r: number; vertices: Vertex[] }>();
  const bands = map.querySourceFeatures("detail", {
    sourceLayer: "bands",
    filter: ["all", ["==", ["get", "i"], f.id], ["==", ["get", "b"], est]],
  });
  for (const band of bands) {
    const lv = Number(band.properties.lv);
    const entry = byLevel.get(lv) ?? { r: Number(band.properties.r), vertices: [] };
    const g = band.geometry;
    const rings =
      g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        const dx = (lon - lon0) * kx;
        const dy = (lat - lat0) * ky;
        const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
        const off = Math.abs(((bearing - LABEL_BEARING + 540) % 360) - 180);
        entry.vertices.push({ lon, lat, d: Math.hypot(dx, dy), off });
      }
    }
    byLevel.set(lv, entry);
  }
  const features: FeatureCollection<Point>["features"] = [];
  for (const [lv, { r, vertices }] of byLevel) {
    if (!vertices.length) continue;
    const far = Math.max(...vertices.map((v) => v.d));
    const ruler = (vs: Vertex[]) => vs.reduce((a, b) => (b.off < a.off ? b : a));
    let best = ruler(vertices.filter((v) => v.d >= far - TIE_M));
    if (room) {
      const size = room.size(lv, r);
      const scored = vertices.map((v) => ({
        v,
        out: overflow(map.project([v.lon, v.lat]), size, room),
      }));
      const least = Math.min(...scored.map((s) => s.out));
      const fitting = scored.filter((s) => s.out <= least).map((s) => s.v);
      const reach = Math.max(...fitting.map((v) => v.d));
      best = ruler(fitting.filter((v) => v.d >= reach - TIE_M));
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [best.lon, best.lat] },
      properties: { lv, r },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Bounds of the focused camera's drawn field for estimate `est`, and the camera itself:
 * from the camera's `x<est>` ("west,south,east,north" metres around it, computed by the
 * pipeline from the whole band, tiles.field_extents). Without it (an older build), the
 * loaded pieces of its display-floor band. */
export function fieldBounds(
  map: MlMap,
  f: Focus,
  est: number,
  extent?: string | number | null,
): LngLatBounds {
  const bounds = new LngLatBounds(f.lngLat, f.lngLat);
  const box = String(extent ?? "")
    .split(",")
    .map(Number);
  if (box.length === 4 && box.every(Number.isFinite)) {
    const [lng, lat] = f.lngLat;
    const mLat = 1 / 111_320;
    const mLng = mLat / Math.cos((lat * Math.PI) / 180);
    const [w, s0, e, n] = box;
    return bounds
      .extend([lng + w * mLng, lat + s0 * mLat])
      .extend([lng + e * mLng, lat + n * mLat]);
  }
  const bands = map.querySourceFeatures("detail", {
    sourceLayer: "bands",
    filter: [
      "all",
      ["==", ["get", "i"], f.id],
      ["==", ["get", "b"], est],
      ["==", ["get", "lv"], 1],
    ],
  });
  for (const band of bands) {
    const g = band.geometry;
    const rings =
      g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
    for (const ring of rings) for (const [lng, lat] of ring) bounds.extend([lng, lat]);
  }
  return bounds;
}

/** The camera's reach per estimate and displayed level, read from its loaded bands (`r`,
 * the farthest drawn point): reach[est][lv - 1], NaN when the band is absent. */
export function cameraReaches(map: MlMap, id: number, estimates: number): number[][] {
  const out = Array.from({ length: estimates }, () => [Number.NaN, Number.NaN, Number.NaN]);
  for (const band of map.querySourceFeatures("detail", {
    sourceLayer: "bands",
    filter: ["==", ["get", "i"], id],
  })) {
    const b = Number(band.properties.b);
    const lv = Number(band.properties.lv);
    if (out[b] && lv >= 1 && lv <= 3) out[b][lv - 1] = Number(band.properties.r);
  }
  return out;
}
