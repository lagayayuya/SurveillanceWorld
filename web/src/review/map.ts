// The camera view's small map (/revue, lot 1): the basemap, the camera where the map has
// it (a ring), each proposed position (a filled disc, joined to the ring by a dotted line
// for a move), the field the map draws (dashed outline) and the proposed one (filled), the
// cameras nearby (diamonds) and, for a conflict, the position OpenStreetMap has now (a
// square). Shapes say what each mark is; the legend names the shapes, never a colour.
// One map for the page, its container moved from view to view.
import { type GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { basemap, basemapLayers } from "../basemap";
import { t } from "../i18n";
import { palette } from "../theme";
import type { CameraAnswer, Row } from "./rows";

const ICON_PX = 18;

/** A diamond or a square, drawn on a canvas for the map (no image file: the page's CSP
 * allows images from itself, data: and blob: only, and nothing is fetched here). */
function icon(shape: "diamond" | "square", fill: string, line: string): ImageData {
  const ratio = 2;
  const size = ICON_PX * ratio;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.lineWidth = 2 * ratio;
  g.fillStyle = fill;
  g.strokeStyle = line;
  g.beginPath();
  if (shape === "diamond") {
    const m = size / 2;
    const r = size / 2 - 2 * ratio;
    g.moveTo(m, m - r);
    g.lineTo(m + r, m);
    g.lineTo(m, m + r);
    g.lineTo(m - r, m);
    g.closePath();
  } else {
    const p = 4 * ratio;
    g.rect(p, p, size - 2 * p, size - 2 * p);
  }
  g.fill();
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

export class ReviewMap {
  readonly box: HTMLElement;
  readonly legend: HTMLParagraphElement;
  private container: HTMLElement;
  private map: MlMap | null = null;

  constructor() {
    this.box = document.createElement("div");
    this.box.className = "review-map";
    this.container = document.createElement("div");
    this.container.id = "review-map";
    this.container.setAttribute("role", "img");
    this.legend = document.createElement("p");
    this.legend.className = "review-legend";
    this.legend.id = "review-legend";
    this.container.setAttribute("aria-labelledby", "review-legend");
    this.box.append(this.container, this.legend);
  }

  private ensure(): MlMap {
    if (this.map) return this.map;
    const base = window.location.origin;
    const theme = basemap();
    const p = palette();
    const map = new MlMap({
      container: this.container,
      center: [2.35, 48.86],
      zoom: 17,
      maxZoom: 21,
      attributionControl: { compact: true },
      style: {
        version: 8,
        glyphs: `${base}/basemap/fonts/{fontstack}/{range}.pbf`,
        sprite: `${base}/basemap/sprites/${theme.sprite}`,
        sources: {
          protomaps: { type: "vector", url: `pmtiles://${base}/basemap/basemap.pmtiles` },
          sel: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          ...basemapLayers(theme),
          {
            id: "sel-band",
            type: "fill",
            source: "sel",
            filter: ["all", ["==", ["get", "role"], "proposed"], ["==", ["get", "b"], 1]],
            paint: {
              "fill-color": p.field,
              "fill-opacity": ["match", ["get", "lv"], 1, 0.3, 2, 0.4, 3, 0.5, 0.3],
            },
          },
          {
            id: "sel-old-band",
            type: "line",
            source: "sel",
            filter: [
              "all",
              ["==", ["get", "role"], "now"],
              ["==", ["get", "b"], 1],
              ["==", ["get", "lv"], 1],
            ],
            paint: { "line-color": p.ink, "line-width": 2, "line-dasharray": [2, 2] },
          },
          {
            id: "sel-line",
            type: "line",
            source: "sel",
            filter: ["==", ["get", "role"], "path"],
            paint: { "line-color": p.ink, "line-width": 1.5, "line-dasharray": [1, 2] },
          },
          {
            id: "sel-point",
            type: "circle",
            source: "sel",
            filter: ["in", ["get", "role"], ["literal", ["served", "new"]]],
            paint: {
              "circle-radius": 7,
              "circle-color": ["match", ["get", "role"], "served", p.halo, p.field],
              "circle-stroke-color": p.ink,
              "circle-stroke-width": 2,
            },
          },
          {
            id: "sel-icon",
            type: "symbol",
            source: "sel",
            filter: ["in", ["get", "role"], ["literal", ["near", "osm"]]],
            layout: {
              "icon-image": ["match", ["get", "role"], "near", "review-diamond", "review-square"],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
          },
        ],
      },
    });
    // An image the basemap's punk layers name and only the map's page adds (its paper's
    // dots): nothing here.
    map.on("styleimagemissing", (e: { id: string }) => {
      if (!e.id.startsWith("review-") && !map.hasImage(e.id))
        map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    map.on("load", () => {
      map.addImage("review-diamond", icon("diamond", p.halo, p.ink), { pixelRatio: 2 });
      map.addImage("review-square", icon("square", p.guide, p.ink), { pixelRatio: 2 });
    });
    // The smoke tests read what the map draws.
    (window as unknown as { __reviewMap: MlMap }).__reviewMap = map;
    new ResizeObserver(() => map.resize()).observe(this.container);
    this.map = map;
    return map;
  }

  /** Draw a camera: its served position and field, what `open` proposes (the rows the
   * view decides first; the others too when none), its neighbours, a conflict's OSM
   * position. */
  draw(w: CameraAnswer, open: Row[]): void {
    const map = this.ensure();
    const pt = (c: [number, number], role: string): GeoJSON.Feature => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: c },
      properties: { role },
    });
    const feats: GeoJSON.Feature[] = w.field.map((f) => ({
      ...f,
      properties: { ...f.properties, role: "now" },
    }));
    const add = w.contributions.find((r) => r.kind === "add");
    const at: [number, number] = w.served
      ? [w.served.lon, w.served.lat]
      : add
        ? [add.lon, add.lat]
        : [2.35, 48.86];
    if (w.served) feats.push(pt(at, "served"));
    for (const n of w.near) feats.push(pt(n.at, "near"));
    for (const r of open) {
      const to = r.payload.position ?? (r.kind === "add" ? [r.lon, r.lat] : null);
      if (r.kind === "move" && to) {
        feats.push(pt(to as [number, number], "new"), {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [at, to] },
          properties: { role: "path" },
        });
      } else if (r.kind === "add" && to) feats.push(pt(to as [number, number], "new"));
      const osm = r.apply_detail?.now;
      if (r.status === "conflict" && osm) feats.push(pt([osm.lon, osm.lat], "osm"));
    }
    // The proposed field: an unbuilt add's (its open answers), a send's (its pieces
    // together), else the latest stored one.
    const latest = [...open]
      .sort((a, b) => b.day.localeCompare(a.day))
      .find((r) => r.payload.bands?.features?.length || (r.batch && w.batches?.[r.batch]));
    const sent = latest?.batch ? w.batches?.[latest.batch]?.bands : undefined;
    const proposed =
      (add && !w.served ? w.proposed?.features : undefined) ??
      sent?.features ??
      latest?.payload.bands?.features ??
      [];
    for (const f of proposed)
      feats.push({ ...f, properties: { ...f.properties, role: "proposed" } });
    this.legend.textContent = legendOf(feats);
    const set = () => {
      (map.getSource("sel") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: feats,
      });
      fit(map, feats);
    };
    if (map.isStyleLoaded() && map.getSource("sel")) set();
    else map.once("load", set);
  }
}

/** The legend: one phrase per kind of mark drawn, by its shape. */
function legendOf(feats: GeoJSON.Feature[]): string {
  const roles = new Set(feats.map((f) => f.properties?.role));
  return ["new", "served", "proposed", "now", "near", "osm"]
    .filter((r) => roles.has(r))
    .map((r) => t(`review.legend.${r}`))
    .join(" · ");
}

function fit(map: MlMap, feats: GeoJSON.Feature[]): void {
  const xs = feats.flatMap((f) => coords(f.geometry));
  if (!xs.length) return;
  const lons = xs.map((c) => c[0]);
  const lats = xs.map((c) => c[1]);
  map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
    padding: 30,
    maxZoom: 19,
    duration: 0,
  });
}
function coords(g: GeoJSON.Geometry): number[][] {
  if (g.type === "Point") return [g.coordinates];
  if (g.type === "LineString") return g.coordinates;
  if (g.type === "Polygon") return g.coordinates.flat();
  if (g.type === "MultiPolygon") return g.coordinates.flat(2);
  return [];
}
