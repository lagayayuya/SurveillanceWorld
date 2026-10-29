// The register's commune map: the site's France basemap, tilted and turning slowly, cut to the
// commune by a mask (a layer « the world minus the commune », in the page's frame colour) above
// the basemap and the cameras, under the zones: a zone that spills over the boundary is drawn
// whole, its outside part fainter. The slab and the outline are drawn on a canvas above.
// · Cameras, filmed streets and fields of view: the commune's JSON (carteUrl).
// · Drones: one translucent volume per site (fill-extrusion), its top outline only; its height
//   is the hours authorised on the chosen period (setHeures), never an altitude. Algorithmic
//   analysis on the ground: hatched yellow and black when the tracing was reviewed, light
//   yellow and dotted when not.
// · « vitrine » (default): turns (45 s a turn), a gesture pauses the turn for 10 s, the button
//   stops it for the visit. The wheel zooms, a left drag turns, two fingers zoom and turn on a
//   phone, one finger scrolls the page. A click opens nothing: it names the zone (onZone).
// · « fixe » (L'essentiel): no gesture, no click, no control of its own (the page's pause
//   button drives it), the drone zones flat and hatched inside the commune.
// · A device that draws the turn under 20 images/s stops it by itself (median of 90 frames).
// MapLibre, its worker, its CSS, the PMTiles protocol and the basemap's layers are loaded by the
// first carte() call: importing this module (pointInCommune, the helpers) loads nothing else.
// Every word the map shows or says comes from the `t` option (keys `registre.carte.*`).
// Elements built through the DOM, styles through the CSSOM: the register runs under a strict CSP.

import type {
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import type {
  AddProtocolAction,
  CustomRenderMethodInput,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MlMap,
  StyleSpecification,
} from "maplibre-gl";

export type LonLat = [number, number];
export type Area = Polygon | MultiPolygon;
export type Translate = (key: string, params?: Record<string, string | number>) => string;
export type Theme = "light" | "dark";

/** The commune's JSON, served at carteUrl(insee). */
export type CommuneMap = {
  insee: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** The commune's outline, one ring. */
  contour: LonLat[];
  fov?: Area | null;
  rues?: LineString | MultiLineString | null;
  cams: LonLat[];
  n?: number;
  source?: string;
};

/** A drone or algorithmic-analysis site of the register: its zones cut by commune. */
export type Site = {
  id: string;
  kind: string;
  statut?: string;
  zones?: string[];
  parts?: Record<string, { in?: Area | null; out?: Area | null }>;
};

export type Unit = Site & {
  rin: LonLat[][];
  rout: LonLat[][];
  c: LonLat;
  heures: number;
  n: number;
  on: boolean;
};

export type Couches = { cams: boolean; vsa: boolean; drones: boolean };

export type CarteOptions = {
  data: CommuneMap;
  /** The register's catalogue (keys `registre.carte.*`). */
  t: Translate;
  /** The basemap's archive, default the site's (DEFAULT_FOND). */
  fond?: string;
  theme?: Theme;
  couches?: Partial<Couches>;
  sites?: Site[];
  /** The map's accessible name (MapLibre's Map.Title), default registre.carte.titre. */
  label?: string;
  fixe?: boolean;
  /** false hides the north and pause buttons (always hidden when fixe). */
  controles?: boolean;
  /** "survol": a site's label and an indicative tracing only when hovered or selected. */
  etiquettes?: "survol";
  /** false starts still. */
  play?: boolean;
  /** false keeps turning on a slow device (the bench). */
  slowStop?: boolean;
  /** true keeps the drawing buffer (screenshots). */
  capture?: boolean;
  /** The numbers' locale, default "fr". */
  locale?: string;
  onZone?: (u: Unit | null) => void;
  onHover?: (u: Unit | null) => void;
};

export type Carte = {
  map: MlMap;
  units: Unit[];
  el: HTMLElement;
  /** Hours per site for the chosen period, {siteId: {heures, n}}; the others are hidden. */
  setHeures(hs: Record<string, { heures: number; n: number }>): void;
  hover(id: string | null): void;
  select(id: string | null): void;
  setCouches(c: Partial<Couches>): void;
  /** Call it after the page's theme changed: the frame and ink tokens are read again. */
  setTheme(th: Theme): void;
  /** Centre on a unit, tilt kept; the turn waits 10 s. */
  focus(u: Unit): void;
  home(): void;
  play(): void;
  stop(byChoice?: boolean): void;
  north(): void;
  hold(): void;
  playing(): boolean;
  perf(): { frames: { dt: number; calc: number }[]; seuil_ms: number };
  resetPerf(): void;
  /** Removes the map, its listeners and its elements. */
  destroy(): void;
  seuils: { CAMS_FROM: number; FOV_FROM: number; EXAG: readonly number[] };
};

/** The site's France basemap (main.ts names it so), masked by the commune. */
export const DEFAULT_FOND = "/basemap/basemap.pmtiles";
/** Where the register serves a commune's cameras, filmed streets and fields of view. */
export const carteUrl = (insee: string): string =>
  `/data/registre/carte/${encodeURIComponent(insee)}.json`;

// The map's own drawing colours (a map palette, like the site's basemap tokens). The frame
// and the ink are the page's (--bg-2, --fg; palette()); these are their fallbacks.
const PINK = "#ff48b0";
const YEL = "#ffe800";
const BLUE = "#7fd4ff";
export type Palette = {
  earth: string;
  bld: string;
  bldLine: string;
  road: string;
  casing: string;
  park: string;
  water: string;
  rail: string;
  frame: string;
  edge: string;
  line: string;
  dot: string;
  ring: string;
  text: string;
  halo: string;
  vsa: string;
  vsaLine: string;
  drone: string;
  droneLine: string;
};
export const PAL: Record<Theme, Palette> = {
  light: {
    earth: "#f2efe6",
    bld: "#dcd6c6",
    bldLine: "#c4bda9",
    road: "#ffffff",
    casing: "#e2dccd",
    park: "#cfe0b8",
    water: "#d3e1e4",
    rail: "#c4bda9",
    frame: "#ffffff",
    edge: "#111111",
    line: "#111111",
    dot: "#111111",
    ring: "#f2efe6",
    text: "#111111",
    halo: "#f2efe6",
    vsa: "#b38f00",
    vsaLine: "#7a6200",
    drone: "#0060a0",
    droneLine: "#0060a0",
  },
  dark: {
    earth: "#262626",
    bld: "#3a3832",
    bldLine: "#4a463e",
    road: "#55534d",
    casing: "#2e2d2a",
    park: "#2a3a22",
    water: "#1f2a2d",
    rail: "#4a463e",
    frame: "#1e1e1e",
    edge: "#000000",
    line: "#f2efe6",
    dot: "#f2efe6",
    ring: "#111111",
    text: "#f2efe6",
    halo: "#141414",
    vsa: "#ffe800",
    vsaLine: YEL,
    drone: "#7fd4ff",
    droneLine: BLUE,
  },
};

/** The theme's map palette with the page's frame (--bg-2) and ink (--fg), as `read` gives
 * them (a custom property's computed value, "" when unset: the palette's own then). */
export function palette(th: Theme, read: (name: string) => string): Palette {
  const p = PAL[th];
  const ink = read("--fg").trim() || p.line;
  return { ...p, frame: read("--bg-2").trim() || p.frame, line: ink, dot: ink, text: ink };
}

export const TURN_MS = 45000; // one turn in about 45 s
export const RESUME_MS = 10000; // the turn resumes 10 s after the last gesture
export const PITCH = 50; // tilt, degrees
export const SLAB = 9; // thickness of the slab under the outline, CSS px
export const SLOW_MS = 50; // median frame interval above which the turn stops (under 20 images/s)
export const CAMS_FROM = 14; // (11th pass: the cameras show at every zoom; kept for the legend)
export const FOV_FROM = 15; // the fields of view appear from this zoom
const NONE: FilterSpecification = ["==", ["get", "kind"], "-"]; // keeps nothing ([==, 1, 0] is refused silently)

// The height exaggeration at the scale of a whole commune: [zoom, factor] stops, linear in between.
export const EXAG: readonly number[] = [10, 8, 12, 5, 14, 2.5, 16, 1];
export function exag(z: number): number {
  for (let i = 0; i < EXAG.length - 2; i += 2) {
    if (z <= EXAG[i + 2]) {
      const k = Math.max(0, (z - EXAG[i]) / (EXAG[i + 2] - EXAG[i]));
      return EXAG[i + 1] + k * (EXAG[i + 3] - EXAG[i + 1]);
    }
  }
  return 1;
}

// A commune's cameras in its whole view (lot R1b, Paris: 5,653 ringed points covered the commune):
// up to CAMS_POINTS, the ringed point; beyond, a plain point of 3 px; beyond CAMS_RUES, the filmed
// streets alone and the cameras as a light density. Closer than the whole view by OVERVIEW_DZ, the
// ringed points come back.
export const CAMS_POINTS = 300;
export const CAMS_RUES = 2000;
export const OVERVIEW_DZ = 1.5;
export type Densite = "cercles" | "points" | "rues";
export const densite = (n: number): Densite =>
  n > CAMS_RUES ? "rues" : n > CAMS_POINTS ? "points" : "cercles";

/** The cameras' layers for a drawing (densite) whose whole view ends at zoom `split`. */
export function camLayers(
  mode: Densite,
  split: number,
  dot: string,
  ring: string,
): LayerSpecification[] {
  const near = mode === "cercles" ? {} : { minzoom: split };
  const layers: LayerSpecification[] = [
    // a dark point, a light ring, a dark outer ring (the mockups' « caméra placée »)
    {
      id: "cams-o",
      type: "circle",
      source: "cams",
      ...near,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.2, 13, 4.6, 14, 6, 16, 8],
        "circle-color": dot,
      },
    },
    {
      id: "cams",
      type: "circle",
      source: "cams",
      ...near,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.4, 13, 2.2, 14, 3.2, 16, 4.6],
        "circle-color": dot,
        "circle-stroke-color": ring,
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 13, 1.4, 16, 2.2],
      },
    },
  ];
  if (mode === "points")
    layers.push({
      id: "cams-p",
      type: "circle",
      source: "cams",
      maxzoom: split,
      paint: { "circle-radius": 1.5, "circle-color": dot },
    });
  return layers;
}

/** Beyond CAMS_RUES, the cameras' light density in the whole view, under the filmed streets. */
export function densityLayers(mode: Densite, split: number, dot: string): LayerSpecification[] {
  if (mode !== "rues") return [];
  return [
    {
      id: "cams-h",
      type: "heatmap",
      source: "cams",
      maxzoom: split,
      paint: {
        "heatmap-radius": 6,
        "heatmap-intensity": 0.25,
        "heatmap-opacity": 0.3,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0, 0, 0, 0)",
          1,
          dot,
        ],
      },
    },
  ];
}

/** Every catalogue key the map uses (the register's fr.json carries them). */
export const KEYS = [
  "registre.carte.titre",
  "registre.carte.nord",
  "registre.carte.arreter",
  "registre.carte.reprendre",
  "registre.carte.lent",
  "registre.carte.heures",
  "registre.carte.heuresAutorisations",
  "registre.carte.horairesNonPrecises",
  "registre.carte.analyse",
  "registre.carte.gestesMobile",
  "registre.carte.gestesWindows",
  "registre.carte.gestesMac",
  "registre.carte.zoomer",
  "registre.carte.dezoomer",
] as const;

/** MapLibre's own strings, from the catalogue. */
export function mapLocale(t: Translate, label?: string): Record<string, string> {
  return {
    "Map.Title": label || t("registre.carte.titre"),
    "CooperativeGesturesHandler.MobileHelpText": t("registre.carte.gestesMobile"),
    "CooperativeGesturesHandler.WindowsHelpText": t("registre.carte.gestesWindows"),
    "CooperativeGesturesHandler.MacHelpText": t("registre.carte.gestesMac"),
    "NavigationControl.ZoomIn": t("registre.carte.zoomer"),
    "NavigationControl.ZoomOut": t("registre.carte.dezoomer"),
    "NavigationControl.ResetBearing": t("registre.carte.nord"),
  };
}

/** A volume's label: its hours on the period (one decimal under 10 h), and how many
 * authorisations when more than one; « horaires non précisés » without hours. */
export function hoursLabel(u: { heures: number; n: number }, t: Translate, locale = "fr"): string {
  if (!u.heures) return t("registre.carte.horairesNonPrecises");
  const heures = new Intl.NumberFormat(locale, {
    maximumFractionDigits: u.heures < 10 ? 1 : 0,
  }).format(u.heures);
  return u.n > 1
    ? t("registre.carte.heuresAutorisations", { heures, n: String(u.n) })
    : t("registre.carte.heures", { heures });
}

const KEEP = "carte-pause"; // the pause button is a choice kept for the visit (sessionStorage)
function kept(): boolean {
  try {
    return sessionStorage.getItem(KEEP) === "1";
  } catch {
    return false;
  }
}
function keep(v: boolean): void {
  try {
    if (v) sessionStorage.setItem(KEEP, "1");
    else sessionStorage.removeItem(KEEP);
  } catch {
    // private mode: not kept
  }
}

/** The basemap's layers (Protomaps' grayscale flavour, `all`) without labels, boundaries or
 * 3D buildings, in the map palette. */
export function baseLayers(p: Palette, all: LayerSpecification[]): LayerSpecification[] {
  const colour = (id: string): string | null =>
    /^(background|earth)$/.test(id)
      ? p.earth
      : /park|urban_green|wood|scrub/.test(id)
        ? p.park
        : /^water/.test(id)
          ? p.water
          : id === "buildings"
            ? p.bld
            : /rail/.test(id)
              ? p.rail
              : /casing/.test(id)
                ? p.casing
                : /^roads/.test(id)
                  ? p.road
                  : /^landuse/.test(id)
                    ? p.earth
                    : null;
  return all
    .filter((l) => l.type !== "symbol" && l.type !== "fill-extrusion" && !/^boundaries/.test(l.id))
    .map((l) => {
      const c = colour(l.id);
      const paint: Record<string, unknown> = { ...(("paint" in l && l.paint) || {}) };
      if (c && l.type === "fill") {
        paint["fill-color"] = c;
        if (l.id === "buildings") {
          paint["fill-opacity"] = 1;
          paint["fill-outline-color"] = p.bldLine;
        }
      }
      if (c && l.type === "line") paint["line-color"] = c;
      if (c && l.type === "background") paint["background-color"] = c;
      return { ...l, paint } as LayerSpecification;
    });
}

export type Pixels = { width: number; height: number; data: Uint8Array };
/** The flat drone zone of L'essentiel: thin diagonals in the drone blue, transparent between. */
export function hatchBlue(th: Theme): Pixels {
  const n = 16;
  const d = new Uint8Array(n * n * 4);
  const c = th === "dark" ? [127, 212, 255, 255] : [0, 96, 160, 255];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) d.set((x + y) % 8 < 2 ? c : [0, 0, 0, 0], (y * n + x) * 4);
  return { width: n, height: n, data: d };
}
/** A reviewed algorithmic-analysis zone: yellow and black diagonals. */
export function hatch(): Pixels {
  const n = 16;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      d.set((x + y) % n < 7 ? [17, 17, 17, 255] : [255, 232, 0, 255], (y * n + x) * 4);
  return { width: n, height: n, data: d };
}

/** The outer rings of a polygon or multipolygon (holes left out); none for anything else. */
export function rings(g: Geometry | null | undefined): LonLat[][] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates[0] as LonLat[]];
  if (g.type === "MultiPolygon") return g.coordinates.map((p) => p[0] as LonLat[]);
  return [];
}
/** The mean of the rings' vertices ([0, 0] for none). */
export function centroid(rs: Position[][]): LonLat {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const r of rs)
    for (const p of r) {
      x += p[0];
      y += p[1];
      n++;
    }
  return n ? [x / n, y / n] : [0, 0];
}
/** Even-odd ray casting: is the point inside the ring? */
export function inside(pt: Position, ring: Position[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export const pointInCommune = (data: Pick<CommuneMap, "contour">, lonlat: Position): boolean =>
  inside(lonlat, data.contour);

/** The mask: the world minus the commune (its outline reversed as the hole). */
export function maskFeature(contour: LonLat[]): GeoJSON.Feature<Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-180, -85],
          [180, -85],
          [180, 85],
          [-180, 85],
          [-180, -85],
        ],
        contour.slice().reverse(),
      ],
    },
  };
}

/** The zoom correction (log2 of the scale) that makes the commune fill the frame at every
 * bearing: `views` are the outline's projected points at each bearing tried. */
export function fitZoom(
  views: Position[][],
  width: number,
  height: number,
  margin = 16,
  slab = SLAB,
): number {
  let fit = Number.POSITIVE_INFINITY;
  for (const pts of views) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const sx = (width - 2 * margin) / (Math.max(...xs) - Math.min(...xs));
    const sy = (height - 2 * margin - slab) / (Math.max(...ys) - Math.min(...ys));
    fit = Math.min(fit, sx, sy);
  }
  return Math.log2(fit);
}

/** A mercator point (x, y, z) through a column-major 4×4 clip matrix to CSS pixels. */
export function clipToScreen(
  mat: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): LonLat {
  const cx = mat[0] * x + mat[4] * y + mat[8] * z + mat[12];
  const cy = mat[1] * x + mat[5] * y + mat[9] * z + mat[13];
  const cw = mat[3] * x + mat[7] * y + mat[11] * z + mat[15];
  return [((cx / cw + 1) / 2) * width, ((1 - cy / cw) / 2) * height];
}

/** The bbox's diagonal in metres (equirectangular, at its mean latitude). */
export function diagMetres(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  return Math.hypot((e - w) * 111320 * Math.cos((((s + n) / 2) * Math.PI) / 180), (n - s) * 111320);
}
/** A volume's visual height (m): proportional to its hours, the highest at 18 % of the
 * commune's diagonal (250 m at least), 20 m for none. */
export const volumeHeight = (heures: number, maxH: number, diagM: number): number =>
  20 + (heures / maxH) * Math.max(250, diagM * 0.18);

// --- MapLibre and the basemap's layers, loaded by the first map ------------------------------
type Runtime = { ml: typeof import("maplibre-gl"); base: LayerSpecification[] };
let runtime: Promise<Runtime> | null = null;
function loadRuntime(): Promise<Runtime> {
  runtime ??= (async () => {
    const [ml, pm, worker, pb] = await Promise.all([
      import("maplibre-gl"),
      import("pmtiles"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
      import("@protomaps/basemaps"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]);
    ml.setWorkerUrl(worker.default);
    const protocol = new pm.Protocol();
    const tile: AddProtocolAction = (params, abortController) =>
      protocol.tilev4(params, abortController) as ReturnType<AddProtocolAction>;
    ml.addProtocol("pmtiles", tile);
    const base = pb.layers("protomaps", pb.namedFlavor("grayscale"), {
      lang: "fr",
    }) as LayerSpecification[];
    return { ml, base };
  })();
  return runtime;
}

const SVG = "http://www.w3.org/2000/svg";
function icon(
  size: number,
  attrs: Record<string, string>,
  parts: [string, Record<string, string>][],
) {
  const s = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    ...attrs,
  }))
    s.setAttribute(k, v);
  for (const [tag, a] of parts) {
    const p = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(a)) p.setAttribute(k, v);
    s.append(p);
  }
  return s;
}
function button(c3: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ctl";
  b.dataset.c3 = c3;
  return b;
}

type Fc = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): Fc => ({ type: "FeatureCollection", features });
type Hit = { u: Unit; x0: number; x1: number; y0: number; y1: number };
const ZONE_LAYERS = ["zin-dr", "zin-dr-i", "zout-dr", "zout-dr-i", "zin-vsa", "zin-vsa-i"];

export async function carte(el: HTMLElement, o: CarteOptions): Promise<Carte> {
  const { ml, base } = await loadRuntime();
  const t = o.t;
  const locale = o.locale ?? "fr";
  let theme: Theme = o.theme ?? "light";
  let couches: Couches = { cams: true, vsa: true, drones: true, ...(o.couches ?? {}) };
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = reducedQuery.matches;
  const d = o.data;
  const [w, s, e, n] = d.bbox;
  const insee = d.insee;
  const read = (name: string) => getComputedStyle(el).getPropertyValue(name);
  let P = palette(theme, read);
  const mode = densite(d.cams.length);
  // the whole view's last zoom, known once the frame is fitted (homeZoom): until then all of it
  let split = 24;
  const units: Unit[] = (o.sites ?? []).map((u) => {
    const p = u.parts?.[insee] ?? {};
    return {
      ...u,
      rin: rings(p.in),
      rout: rings(p.out),
      c: centroid([...rings(p.in), ...rings(p.out)]),
      heures: 0,
      n: 0,
      on: false,
    };
  });
  let sel: string | null = null;
  let hov: string | null = null;
  let maxH = 1;
  const diagM = diagMetres(d.bbox);
  const hVis = (u: Unit) => volumeHeight(u.heures, maxH, diagM);

  // the elements, built through the DOM (no markup string)
  el.classList.add("c3");
  const box = document.createElement("div");
  box.className = "c3-map";
  const over = document.createElement("canvas");
  over.className = "c3-over";
  over.setAttribute("aria-hidden", "true");
  over.style.pointerEvents = "none";
  const ctl = document.createElement("div");
  ctl.className = "c3-ctl";
  ctl.hidden = !!o.fixe || o.controles === false;
  const northBtn = button("north");
  northBtn.setAttribute("aria-label", t("registre.carte.nord"));
  northBtn.append(
    icon(20, { fill: "none", stroke: "currentColor", "stroke-width": "2.2" }, [
      ["path", { d: "M12 3 6 20l6-4 6 4z" }],
    ]),
  );
  const toggleBtn = button("toggle");
  toggleBtn.setAttribute("aria-pressed", "false");
  const pauseIcon = icon(18, { fill: "currentColor" }, [
    ["rect", { x: "5", y: "4", width: "5", height: "16" }],
    ["rect", { x: "14", y: "4", width: "5", height: "16" }],
  ]);
  const resumeIcon = icon(18, { fill: "none", stroke: "currentColor", "stroke-width": "2.4" }, [
    ["path", { d: "M20 12a8 8 0 1 1-2.3-5.6" }],
    ["path", { d: "M20 4v5h-5" }],
  ]);
  ctl.append(northBtn, toggleBtn);
  const msg = document.createElement("p");
  msg.className = "c3-msg sr-only";
  msg.setAttribute("aria-live", "polite");
  el.replaceChildren(box, over, ctl, msg);

  const unitFeats = (side: "in" | "out"): Fc =>
    fc(
      units
        .filter((u) => u.on)
        .flatMap((u) => {
          const g = u.parts?.[insee]?.[side];
          return g
            ? [
                {
                  type: "Feature" as const,
                  geometry: g,
                  properties: {
                    id: u.id,
                    kind: u.kind,
                    statut: u.statut,
                    h: hVis(u),
                    sel: sel === u.id,
                  },
                },
              ]
            : [];
        }),
    );
  const fond = new URL(o.fond ?? DEFAULT_FOND, location.href).href;
  const H = ["get", "h"]; // the hours, already scaled (hVis)
  const style = (): StyleSpecification => ({
    version: 8,
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${fond}` },
      fov: {
        type: "geojson",
        data: d.fov ? { type: "Feature", geometry: d.fov, properties: {} } : fc([]),
      },
      // simplified at 2 px per zoom (default 0.375): the filmed streets cost the turn in software
      // rendering (12th pass, Lyon 22 → 35 images/s, Paris 18 → 32, SwiftShader, CPU 4×);
      // geojson-vt simplifies at every zoom, so the lines stay within 2 px of their course
      rues: {
        type: "geojson",
        tolerance: 2,
        data: d.rues ? { type: "Feature", geometry: d.rues, properties: {} } : fc([]),
      },
      cams: {
        type: "geojson",
        data: fc(
          d.cams.map((c) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: c },
            properties: {},
          })),
        ),
      },
      mask: { type: "geojson", data: maskFeature(d.contour) },
      zin: { type: "geojson", data: unitFeats("in") },
      zout: { type: "geojson", data: unitFeats("out") },
    },
    layers: [
      ...baseLayers(P, base),
      {
        id: "fov",
        type: "fill",
        source: "fov",
        minzoom: FOV_FROM,
        paint: { "fill-color": PINK, "fill-opacity": 0.3 },
      },
      {
        id: "fov-l",
        type: "line",
        source: "fov",
        minzoom: FOV_FROM,
        paint: { "line-color": PINK, "line-width": 1.2 },
      },
      ...densityLayers(mode, split, P.dot),
      {
        id: "rues",
        type: "line",
        source: "rues",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": PINK,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 12, 4.5, 14, 5.5, 16, 8],
        },
      },
      ...camLayers(mode, split, P.dot, P.ring),
      {
        id: "mask",
        type: "fill",
        source: "mask",
        paint: { "fill-color": P.frame, "fill-antialias": false },
      },
      // flat drone zones (L'essentiel): only the part inside the commune, hatched, outlined
      {
        id: "zin-drf",
        type: "fill",
        source: "zin",
        filter: NONE,
        paint: { "fill-pattern": "c3-hatchb" },
      },
      {
        id: "zin-drl",
        type: "line",
        source: "zin",
        filter: NONE,
        paint: { "line-color": P.droneLine, "line-width": 1.6 },
      },
      // algorithmic analysis: on the ground; drones: volumes
      ...(["zin", "zout"] as const).flatMap((src): LayerSpecification[] => {
        const i = src === "zin";
        return [
          {
            id: `${src}-vsa`,
            type: "fill",
            source: src,
            filter: NONE,
            paint: { "fill-pattern": "c3-hatch", "fill-opacity": i ? 0.85 : 0.35 },
          },
          {
            id: `${src}-vsa-i`,
            type: "fill",
            source: src,
            filter: NONE,
            paint: { "fill-color": YEL, "fill-opacity": i ? 0.35 : 0.15 },
          },
          {
            id: `${src}-vsa-l`,
            type: "line",
            source: src,
            filter: NONE,
            paint: { "line-color": P.vsaLine, "line-width": 2, "line-dasharray": [1, 2] },
          },
          {
            id: `${src}-dr`,
            type: "fill-extrusion",
            source: src,
            filter: NONE,
            paint: {
              "fill-extrusion-color": BLUE,
              "fill-extrusion-height": H,
              "fill-extrusion-opacity": i ? 0.5 : 0.16,
              "fill-extrusion-vertical-gradient": false,
            },
          },
          {
            id: `${src}-dr-i`,
            type: "fill-extrusion",
            source: src,
            filter: NONE,
            paint: {
              "fill-extrusion-color": BLUE,
              "fill-extrusion-height": H,
              "fill-extrusion-opacity": i ? 0.22 : 0.1,
              "fill-extrusion-vertical-gradient": false,
            },
          },
        ] as LayerSpecification[];
      }),
    ] as LayerSpecification[],
  });

  let mat: ArrayLike<number> | null = null;
  const map = new ml.Map({
    container: box,
    style: style(),
    attributionControl: false,
    interactive: true,
    locale: mapLocale(t, o.label),
    pitch: PITCH,
    bearing: 25,
    maxPitch: 70,
    bounds: [
      [w, s],
      [e, n],
    ],
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: !!o.capture },
  });
  map.on("error", (ev) => console.error("carte:", ev.error?.message || ev));
  const images = () => {
    if (map.hasImage("c3-hatch")) map.updateImage("c3-hatch", hatch());
    else map.addImage("c3-hatch", hatch(), { pixelRatio: 2 });
    if (map.hasImage("c3-hatchb")) map.updateImage("c3-hatchb", hatchBlue(theme));
    else map.addImage("c3-hatchb", hatchBlue(theme), { pixelRatio: 2 });
  };
  map.on("styleimagemissing", (ev) => {
    if (ev.id === "c3-hatch" && !map.hasImage("c3-hatch"))
      map.addImage("c3-hatch", hatch(), { pixelRatio: 2 });
    if (ev.id === "c3-hatchb" && !map.hasImage("c3-hatchb"))
      map.addImage("c3-hatchb", hatchBlue(theme), { pixelRatio: 2 });
  });
  // the projection matrix, caught at each frame by an empty 3D layer (the volumes' outlines)
  const grab = () => {
    if (!map.getLayer("c3-grab"))
      map.addLayer({
        id: "c3-grab",
        type: "custom",
        renderingMode: "3d",
        render: (_gl: WebGL2RenderingContext, a: CustomRenderMethodInput) => {
          mat = a.defaultProjectionData?.mainMatrix ?? a.modelViewProjectionMatrix;
        },
      });
  };
  await new Promise<void>((r) => map.once("load", () => r()));
  images();
  grab();

  // the commune fills the frame whatever the bearing: projected extents measured at 12 bearings
  const handlers = [
    map.scrollZoom,
    map.boxZoom,
    map.dragRotate,
    map.dragPan,
    map.keyboard,
    map.doubleClickZoom,
    map.touchZoomRotate,
    map.touchPitch,
  ];
  const interact = (on: boolean) => {
    for (const h of handlers) {
      if (on) h.enable();
      else h.disable();
    }
  };
  const views = () => {
    const out: Position[][] = [];
    for (let b = 0; b < 360; b += 30) {
      map.setBearing(b);
      out.push(
        d.contour.map((ll) => {
          const p = map.project(ll);
          return [p.x, p.y];
        }),
      );
    }
    return out;
  };
  /** The cameras' layers to the whole view's zooms (camLayers), once `split` is known. */
  function zoomRanges(): void {
    if (mode === "cercles") return;
    for (const id of ["cams-o", "cams"]) map.setLayerZoomRange(id, split, 24);
    const far = mode === "points" ? "cams-p" : "cams-h";
    if (map.getLayer(far)) map.setLayerZoomRange(far, 0, split);
  }
  function frame(): number {
    map.jumpTo({ center: [(w + e) / 2, (s + n) / 2], zoom: 12, pitch: PITCH, bearing: 0 });
    const W = box.clientWidth;
    const Hh = box.clientHeight;
    map.jumpTo({ zoom: 12 + fitZoom(views(), W, Hh), bearing: 0 });
    // the projection is not linear in the zoom (perspective): one correction pass
    map.jumpTo({ zoom: map.getZoom() + fitZoom(views(), W, Hh), bearing: 25 });
    return map.getZoom();
  }
  const homeZoom = frame();
  split = homeZoom + OVERVIEW_DZ;
  zoomRanges();
  map.setMinZoom(homeZoom - 3);
  map.setMaxZoom(18);

  const proj = (ll: LonLat, alt = 0): LonLat => {
    if (!mat || !alt) {
      const p = map.project(ll);
      return [p.x, p.y];
    }
    const m = ml.MercatorCoordinate.fromLngLat(ll, alt);
    return clipToScreen(mat, m.x, m.y, m.z, box.clientWidth, box.clientHeight);
  };
  const shown = (u: Unit) =>
    u.on && ((u.kind === "vsa" && couches.vsa) || (u.kind === "drone" && couches.drones));
  function filters(): void {
    const ids = units.filter(shown).map((u) => u.id);
    // « survol »: an indicative tracing (not reviewed) shows only when pointed at or selected
    const idsI = o.etiquettes === "survol" ? ids.filter((id) => id === sel || id === hov) : ids;
    const only = (kind: string, relu: boolean): FilterSpecification => [
      "all",
      ["in", ["get", "id"], ["literal", relu ? ids : idsI]],
      ["==", ["get", "kind"], kind],
      relu ? ["==", ["get", "statut"], "relu"] : ["!=", ["get", "statut"], "relu"],
    ];
    for (const src of ["zin", "zout"]) {
      map.setFilter(`${src}-vsa`, only("vsa", true));
      map.setFilter(`${src}-vsa-i`, only("vsa", false));
      map.setFilter(`${src}-vsa-l`, only("vsa", false));
      map.setFilter(`${src}-dr`, o.fixe ? NONE : only("drone", true));
      map.setFilter(`${src}-dr-i`, o.fixe ? NONE : only("drone", false));
    }
    // fixed (L'essentiel): the drone zones flat inside the commune, every tracing, no volume
    const flat: FilterSpecification = o.fixe
      ? ["all", ["in", ["get", "id"], ["literal", ids]], ["==", ["get", "kind"], "drone"]]
      : NONE;
    map.setFilter("zin-drf", flat);
    map.setFilter("zin-drl", flat);
    for (const id of ["fov", "fov-l", "rues", "cams", "cams-o", "cams-p", "cams-h"])
      if (map.getLayer(id))
        map.setLayoutProperty(id, "visibility", couches.cams ? "visible" : "none");
    map.triggerRepaint();
  }

  // the turn's state, before the first frame is drawn
  let playing = !reduced && o.play !== false && !kept();
  let visible = true;
  let raf = 0;
  let last = 0;
  let slowChecked = false;
  let resume = 0;
  let frames: { dt: number; calc: number }[] = [];
  const spinning = () => playing && visible;

  let hits: Hit[] = [];
  let tSum = 0;
  function draw(): void {
    const t0 = performance.now();
    const W = box.clientWidth;
    const Hh = box.clientHeight;
    const dpr = devicePixelRatio || 1;
    if (over.width !== Math.round(W * dpr) || over.height !== Math.round(Hh * dpr)) {
      over.width = Math.round(W * dpr);
      over.height = Math.round(Hh * dpr);
    }
    const g = over.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, Hh);
    g.lineJoin = "round";
    const pts = d.contour.map((ll) => proj(ll));
    const path = (ps: LonLat[], dy = 0) => {
      g.beginPath();
      ps.forEach((p, i) => {
        if (i) g.lineTo(p[0], p[1] + dy);
        else g.moveTo(p[0], p[1] + dy);
      });
      g.closePath();
    };
    // the slab: the outline lowered, minus the commune itself
    g.save();
    path(pts, SLAB);
    g.fillStyle = P.edge;
    g.fill();
    g.globalCompositeOperation = "destination-out";
    path(pts);
    g.fill();
    g.restore();
    g.setLineDash([]);
    g.strokeStyle = P.line;
    g.lineWidth = 2.5;
    path(pts);
    g.stroke();
    hits = [];
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const label = (u: Unit, x: number, y: number, col: string, text: string) => {
      if (o.fixe || (o.etiquettes === "survol" && u.id !== sel && u.id !== hov)) return;
      g.font = "800 12px Archivo, ArchivoCorps, sans-serif";
      const tw = g.measureText(text).width;
      const tx = Math.min(Math.max(x, tw / 2 + 6), W - tw / 2 - 6);
      const b = { x0: tx - tw / 2 - 4, x1: tx + tw / 2 + 4, y0: y - 34, y1: y - 18 };
      if (boxes.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0)) return;
      boxes.push(b);
      g.strokeStyle = col;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - 14);
      g.stroke();
      g.fillStyle = col;
      g.strokeStyle = P.halo;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y - 14, 4, 0, 7);
      g.fill();
      g.stroke();
      g.textAlign = "center";
      g.lineWidth = 4;
      g.strokeStyle = P.halo;
      g.fillStyle = P.text;
      g.strokeText(text, tx, y - 23);
      g.fillText(text, tx, y - 23);
      hits.push({ u, ...b, y1: y + 2 });
    };
    // the tallest first, so that their labels win the place
    for (const u of units.filter(shown).sort((a, b) => b.heures - a.heures)) {
      const ind = u.statut !== "relu";
      const txt = hoursLabel(u, t, locale);
      if (u.kind === "vsa") {
        const [x, y] = proj(u.c);
        label(u, x, y, P.vsa, t("registre.carte.analyse", { texte: txt }));
        continue;
      }
      if (o.fixe) continue; // L'essentiel: the zone is flat (a layer), no volume outline
      const h = hVis(u);
      const on = sel === u.id;
      if (o.etiquettes === "survol" && ind && !on && u.id !== hov) continue; // quiet until pointed at
      // the top outline of the volume (its walls have none); the selected one thicker, in ink
      g.setLineDash(ind ? [3, 3] : []);
      g.strokeStyle = on ? P.line : BLUE;
      g.lineWidth = on ? 3 : 2;
      for (const r of [...u.rin, ...u.rout]) {
        path(r.map((ll) => proj(ll, h)));
        g.stroke();
      }
      const [x, y] = proj(u.c, h);
      label(u, x, y, on ? P.line : P.drone, txt);
      hits.push({ u, x0: x - 18, x1: x + 18, y0: y - 16, y1: y + 6 });
    }
    tSum = performance.now() - t0;
  }
  let lastRender = 0;
  map.on("render", () => {
    const now = performance.now();
    if (spinning() && lastRender) frames.push({ dt: now - lastRender, calc: tSum });
    lastRender = now;
    draw();
  });
  const unitAt = (point: { x: number; y: number }): Unit | null => {
    const h = hits.find(
      (b) => point.x >= b.x0 && point.x <= b.x1 && point.y >= b.y0 && point.y <= b.y1,
    );
    if (h) return h.u;
    const f = map.queryRenderedFeatures([point.x, point.y], {
      layers: ZONE_LAYERS.filter((l) => map.getLayer(l)),
    })[0];
    return (f && units.find((q) => q.id === f.properties.id)) || null;
  };
  if (!o.fixe) {
    map.on("mousemove", (ev) => {
      const u = unitAt(ev.point);
      const id = u ? u.id : null;
      if (id !== hov) {
        hov = id;
        map.getCanvas().style.cursor = id ? "pointer" : "";
        filters();
        o.onHover?.(u);
      }
    });
    map.on("click", (ev) => {
      const ll: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      const u =
        unitAt(ev.point) ??
        units.find((q) => shown(q) && [...q.rin, ...q.rout].some((r) => inside(ll, r))) ??
        null;
      o.onZone?.(u);
    });
  }

  // the turn: stops at the first gesture, resumes 10 s later from where it was left
  const setLabel = () => {
    toggleBtn.setAttribute(
      "aria-label",
      t(playing ? "registre.carte.arreter" : "registre.carte.reprendre"),
    );
    toggleBtn.setAttribute("aria-pressed", String(!playing));
    toggleBtn.replaceChildren(playing ? pauseIcon : resumeIcon);
  };
  function tick(now: number): void {
    raf = 0;
    if (!spinning()) return;
    if (last) map.setBearing((map.getBearing() + ((now - last) * 360) / TURN_MS) % 360);
    last = now;
    if (!slowChecked && o.slowStop !== false && frames.length >= 90) {
      slowChecked = true;
      const med = frames.map((f) => f.dt).sort((a, b) => a - b)[45];
      if (med > SLOW_MS) {
        stop(false);
        msg.textContent = t("registre.carte.lent");
      }
    }
    raf = requestAnimationFrame(tick);
  }
  const run = () => {
    if (!raf && spinning()) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };
  const halt = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  // a gesture pauses for 10 s; the button stops for the visit
  function hold(): void {
    if (!playing || reduced) return;
    halt();
    clearTimeout(resume);
    resume = window.setTimeout(run, RESUME_MS);
  }
  function stop(byChoice = false): void {
    playing = false;
    halt();
    clearTimeout(resume);
    if (byChoice) keep(true);
    setLabel();
  }
  function play(): void {
    if (reduced) return;
    playing = true;
    keep(false);
    setLabel();
    run();
  }
  function north(): void {
    hold();
    map.easeTo({ bearing: 0, duration: reduced ? 0 : 400 });
  }
  setLabel();
  toggleBtn.addEventListener("click", () => (playing ? stop(true) : play()));
  northBtn.addEventListener("click", north);

  // no window opens: the map is oriented and zoomed in place. Wheel zooms towards the pointer,
  // a left drag (mouse) turns it, two fingers zoom and turn it on a phone, one finger scrolls.
  if (o.fixe) interact(false);
  else {
    interact(true);
    map.dragPan.disable();
    map.touchPitch.disable();
  }
  let drag: { x: number; b: number } | null = null;
  const onDown = (ev: PointerEvent) => {
    if (ev.pointerType !== "mouse" || ev.button !== 0) return;
    drag = { x: ev.clientX, b: map.getBearing() };
    hold();
  };
  const onMove = (ev: PointerEvent) => {
    if (drag) map.setBearing(drag.b - (ev.clientX - drag.x) * 0.4);
  };
  const onUp = () => {
    drag = null;
  };
  if (!o.fixe) box.addEventListener("pointerdown", onDown);
  addEventListener("pointermove", onMove);
  addEventListener("pointerup", onUp);
  map.on("movestart", (x) => {
    if (x.originalEvent) hold();
  });
  const io = new IntersectionObserver((es) => {
    visible = es[0].isIntersecting;
    if (visible) run();
    else halt();
  });
  io.observe(el);
  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) run();
    else halt();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onReduced = (m: MediaQueryListEvent) => {
    if (m.matches) stop(false);
  };
  reducedQuery.addEventListener("change", onReduced);
  filters();
  run();
  await new Promise<void>((r) => map.once("idle", () => r()));

  const zones = () => {
    (map.getSource("zin") as GeoJSONSource | undefined)?.setData(unitFeats("in"));
    (map.getSource("zout") as GeoJSONSource | undefined)?.setData(unitFeats("out"));
  };
  return {
    map,
    units,
    el,
    setHeures(hs) {
      for (const u of units) {
        const x = hs[u.id];
        u.on = !!x;
        u.heures = x ? x.heures : 0;
        u.n = x ? x.n : 0;
      }
      maxH = Math.max(1, ...units.filter((u) => u.on).map((u) => u.heures));
      zones();
      filters();
    },
    hover(id) {
      if (hov === id) return;
      hov = id;
      filters();
    },
    select(id) {
      sel = id;
      filters();
      zones();
      map.triggerRepaint();
    },
    setCouches(c) {
      couches = { ...couches, ...c };
      filters();
    },
    setTheme(th) {
      if (th === theme) return;
      theme = th;
      P = palette(th, read);
      map.once("styledata", () => {
        images();
        grab();
        filters();
      });
      map.setStyle(style());
    },
    focus(u) {
      const xs = [...u.rin, ...u.rout].flat();
      if (!xs.length) return;
      const lons = xs.map((p) => p[0]);
      const lats = xs.map((p) => p[1]);
      hold();
      const cam = map.cameraForBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 60 },
      );
      if (cam)
        map.easeTo({
          center: cam.center,
          zoom: Math.min(16, cam.zoom ?? 16),
          pitch: PITCH,
          bearing: map.getBearing(),
          duration: reduced ? 0 : 600,
        });
    },
    home() {
      map.easeTo({
        zoom: homeZoom,
        center: [(w + e) / 2, (s + n) / 2],
        pitch: PITCH,
        duration: reduced ? 0 : 500,
      });
    },
    play,
    stop,
    north,
    hold,
    playing: () => playing,
    perf: () => ({ frames: frames.slice(), seuil_ms: SLOW_MS }),
    resetPerf() {
      frames = [];
      slowChecked = true;
    },
    destroy() {
      halt();
      clearTimeout(resume);
      io.disconnect();
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      document.removeEventListener("visibilitychange", onVisibility);
      reducedQuery.removeEventListener("change", onReduced);
      map.remove();
      el.replaceChildren();
      el.classList.remove("c3");
    },
    seuils: { CAMS_FROM, FOV_FROM, EXAG },
  };
}
