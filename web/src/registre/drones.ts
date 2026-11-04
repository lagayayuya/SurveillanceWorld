// « Drones et algorithmes » on the site's map (design/registre/v2, V2-CarteDrones): the register
// draws on the map behind it (hote.ts carteDuSite), never a map of its own. What it adds, and takes
// away when it leaves:
// · the commune's outline: its ring from the register's map file (carte/<insee>.json, read up to
//   its `contour` and no further: the rest, the cameras, the filmed streets and the fields, the site's
//   map already shows from its own tiles), else the site's own commune shape (admin tiles);
// · the drone zones as volumes (fill-extrusion), their part inside the commune (the part over a
//   neighbour is that commune's): a site's height is the hours its slots authorise on the period
//   chosen, never an altitude, in the documents' colour; an algorithmic-analysis site flat and
//   hatched in the same colour; the selection in the theme's ink, never yellow (v2.1 A1); a zone
//   over the whole commune, or nearly (TOUTE_LA_COMMUNE), is no volume: a hatched outline on the
//   ground (v2.1 B1), so that it never hides the localised ones;
// · nothing for the cameras: they are the fields the map shows at its usual zoom.
// Hover and choice are feature states (v2.1, A1): the pointer moving over the map changes no layer,
// no filter, no paint and no data, and a state only when the zone under it changes; the camera
// never moves on a hover. The slots and their hours are the build's (drones.py); this module only
// draws them.
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  MapMouseEvent,
  Map as MlMap,
} from "maplibre-gl";

export type LonLat = [number, number];
export type BBox = [number, number, number, number];
type Ring = LonLat[];
type Area =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };

/** A drone or algorithmic-analysis site of the commune file (zones.sites): its zones cut by commune. */
export type Site = {
  id: string;
  kind: string;
  statut?: string;
  parts?: Record<string, { in?: Area | null; out?: Area | null }>;
  /** over the whole commune, or nearly: the build's (rules/registre_drones.yaml, lot R3) */
  commune_entiere?: boolean;
};

/** The commune's outline and its box, as the register's map file gives them. */
export type Contour = { bbox: BBox; contour: LonLat[] };

/** Where the register serves a commune's map file (its outline first, ODbL). */
export const carteUrl = (insee: string): string =>
  `/data/registre/carte/${encodeURIComponent(insee)}.json`;

// The ids of what this module adds to the site's map: one prefix, removed whole on leaving.
const P = "rg-cd";
export const SRC = `${P}-zones`;
const SRC_COM = `${P}-commune`;
/** The chosen zones' labels: one per place on the screen (v2.3) */
const SRC_LAB = `${P}-labels`;
/** Lot R4.2 (board B): the cited sectors' shapes, their labels, and the commune's edge dotted when
 * acts without a drawn zone are shown. */
const SRC_SEC = `${P}-secteurs`;
const SRC_SEC_LAB = `${P}-secteurs-lab`;
const SRC_NL = `${P}-non-lue`;
/** The chosen zone's outline (v2.3, Ju's drones-zone-choisie): the frame's pink, in both modes. */
const ROSE = "#ff48b0";
export const COUCHES = {
  commune: `${P}-commune`,
  communeAdmin: `${P}-commune-admin`,
  entiere: `${P}-entiere`,
  entierePlein: `${P}-entiere-plein`,
  vsa: `${P}-vsa`,
  vsaPlein: `${P}-vsa-plein`,
  recul: `${P}-recul`,
  vol: `${P}-vol`,
  arete: `${P}-arete`,
  sol: `${P}-sol`,
  bord: `${P}-bord`,
  lab: `${P}-lab`,
  secteur: `${P}-secteur`,
  secteurBord: `${P}-secteur-bord`,
  nonLue: `${P}-non-lue`,
  secteurLab: `${P}-secteur-lab`,
} as const;
/** The site's layers of the cameras (layers.ts: their fields, the filmed streets, the pictograms):
 * the sectors and the dotted edge go under the first of them, so that the cameras stay seen. */
const CAMERAS = /^(field-|focus-zone|focus-field|bands$|streets$|portions$|focus-streets$|camera)/;
/** The filmed streets and the pictograms only. */
const RUES = /^(streets$|portions$|focus-streets$|camera)/;
/** The layers the pointer finds a zone in (the label is not one: it never catches the pointer; a
 * zone over the whole commune is not one either: the pointer would find it everywhere in the
 * commune, and the list chooses it). */
const CIBLES = [COUCHES.vol, COUCHES.vsa];

/** The colours the zones are drawn in: the theme's ink (--fg: the selection, v2.1 A1), its ground
 * (--bg: the label's halo, the zones set back) and the documents' colour (--type-document: an act
 * draws them, drones flat, algorithms hatched). Never the territories' yellow. */
export type Teintes = { encre: string; fond: string; doc: string; bleu?: string };
/** The light theme's values (theme/punk/tokens.css), until the page's are read; `bleu` is
 * --drone-trait, the cited sectors' and the zones not read (board B). */
export const TEINTES: Teintes = {
  encre: "#111111",
  fond: "#f2efe6",
  doc: "#7fd4ff",
  bleu: "#2c6f9e",
};
const HACHURE = `${P}-hachure`;
const HACHURE_SEC = `${P}-hachure-secteur`;
const PAVE_SEC = `${P}-pave-secteur`;
/** The label's ground stretched by its middle only: its edges stay sharp (not blurred). */
const PAVE_ETIRE = {
  stretchX: [[2, 6]] as [number, number][],
  stretchY: [[2, 6]] as [number, number][],
  content: [2, 2, 6, 6] as [number, number, number, number],
};
const bleuDe = (t: Teintes): string => t.bleu ?? TEINTES.bleu ?? "#2c6f9e";

// --- the pure part (tested) ------------------------------------------------------------------

/** The outer rings of a polygon or multipolygon (holes left out); none for anything else. */
export function rings(g: Area | null | undefined): Ring[] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates[0]];
  if (g.type === "MultiPolygon") return g.coordinates.map((p) => p[0]);
  return [];
}
/** The mean of the rings' vertices (null for none): where a volume's words stand. */
export function centroid(rs: Ring[]): LonLat | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const r of rs)
    for (const p of r) {
      x += p[0];
      y += p[1];
      n++;
    }
  return n ? [x / n, y / n] : null;
}
/** The box of some rings, null for none. */
export function bboxOf(rs: Ring[]): BBox | null {
  const pts = rs.flat();
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
/** The box's diagonal in metres (equirectangular, at its mean latitude). */
export function diagMetres(bbox: BBox): number {
  const [w, s, e, n] = bbox;
  return Math.hypot((e - w) * 111320 * Math.cos((((s + n) / 2) * Math.PI) / 180), (n - s) * 111320);
}
/** The area of some outer rings in m² (shoelace, equirectangular at each ring's mean latitude). */
export function aire(rs: Ring[]): number {
  let total = 0;
  for (const r of rs) {
    if (r.length < 3) continue;
    const lat = r.reduce((s, p) => s + p[1], 0) / r.length;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const [x1, y1] = r[i];
      const [x2, y2] = r[(i + 1) % r.length];
      a += x1 * kx * y2 * 111320 - x2 * kx * y1 * 111320;
    }
    total += Math.abs(a) / 2;
  }
  return total;
}
/** The sites over the whole commune, or nearly (v2.1 B1): the build decides it (`commune_entiere`,
 * four fifths of the commune's area or more, rules/registre_drones.yaml), the page reads it. */
export function entieres(sites: Site[]): Set<string> {
  return new Set(sites.filter((s) => s.commune_entiere).map((s) => s.id));
}
/** A light colour (#rrggbb): its luminance over a half. */
export const clair = (h: string): boolean => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) || 0);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 127.5;
};
/** The colour of the zones' own lines (a localised zone's outline, the whole commune's band, the
 * algorithms' hatching): the documents' colour darkened on a light ground (the map's ground inside
 * a commune is near the documents' blue), the colour itself on a dark one; never the ink. */
export const trait = (t: Teintes): string =>
  clair(t.fond) ? melange(t.doc, t.encre, 0.45) : t.doc;
/** `a` and `b` (#rrggbb) mixed, `k` of `b`: a zone set back is its colour towards the ground. */
export function melange(a: string, b: string, k: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) || 0);
  const x = rgb(a);
  const y = rgb(b);
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i] - v) * k)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
/** The hatching of an algorithmic-analysis zone (v2.1 A1): diagonal lines of `couleur` on nothing,
 * `n` px square, its lines 2 px wide, raw pixels (no canvas: the tests run without one). */
export function hachures(
  couleur: string,
  n = 8,
): { width: number; height: number; data: Uint8Array } {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(couleur.slice(i, i + 2), 16) || 0);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // the lines rise from left to right and tile across the square's edges
      if ((x + y) % n >= 2) continue;
      const i = (y * n + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: n, height: n, data };
}
/** A cited sector's hatching (board B's pattern « scb »: 7 px, lines of 2 px at 45° in the drones'
 * blue over its light blue at 22 %), drawn at twice the pixels (14 px, pixelRatio 2): the cameras
 * under it stay seen. */
export function hachuresSecteur(
  bleu: string,
  n = 14,
): { width: number; height: number; data: Uint8Array } {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(bleu.slice(i, i + 2), 16) || 0);
  // the board's light blue, rgba(124, 192, 234, .22)
  const fond = [124, 192, 234, Math.round(0.22 * 255)];
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const ligne = (x + y) % n < 5;
      data[i] = ligne ? r : fond[0];
      data[i + 1] = ligne ? g : fond[1];
      data[i + 2] = ligne ? b : fond[2];
      data[i + 3] = ligne ? 255 : fond[3];
    }
  return { width: n, height: n, data };
}
/** A plain square of `couleur` (the sector's label's ground, stretched to its words). */
export function pave(couleur: string, n = 4): { width: number; height: number; data: Uint8Array } {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(couleur.slice(i, i + 2), 16) || 0);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) data.set([r, g, b, 255], i * 4);
  return { width: n, height: n, data };
}
/** Where the label « zone non lue · … » stands on the commune's edge (board B: on the boundary,
 * along it, never in the middle of the map): of the outline's points on the screen (`pts`, px),
 * those inside the free part of the map, the one kept last time while it still is (the label does
 * not jump as the map moves), else the leftmost (the board's: on the western edge); its angle the
 * edge's there, turned to read from left to right. Null when no point of the edge is free. */
export function poseBord(
  pts: [number, number][],
  cadre: { x0: number; y0: number; x1: number; y1: number },
  avant: number | null,
): { i: number; x: number; y: number; angle: number } | null {
  const dedans = (p: [number, number]) =>
    p[0] >= cadre.x0 && p[0] <= cadre.x1 && p[1] >= cadre.y0 && p[1] <= cadre.y1;
  let i = avant != null && pts[avant] && dedans(pts[avant]) ? avant : -1;
  if (i < 0)
    for (let k = 0; k < pts.length; k++)
      if (dedans(pts[k]) && (i < 0 || pts[k][0] < pts[i][0])) i = k;
  if (i < 0) return null;
  const n = pts.length;
  const k = Math.max(1, Math.min(3, Math.floor(n / 4)));
  const a = pts[(i - k + n) % n];
  const b = pts[(i + k) % n];
  let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return { i, x: pts[i][0], y: pts[i][1], angle };
}
/** A volume's height (m): proportional to its hours, the highest at `plafondM` (plafondVolumes),
 * 20 m for none (R1a's tilted map's, DECISIONS 2026-10-29). */
export const volumeHeight = (heures: number, maxH: number, plafondM: number): number =>
  20 + (heures / Math.max(maxH, 1e-9)) * plafondM;
/** The share of the commune's height on the screen the tallest volume stands to (v2.4: at 18 % of
 * the commune's diagonal, Lyon's volumes stood over half of it, stacked over the names). */
const PART_VOLUME = 0.12;
/** The tallest volume's height (m) for a commune's box seen at `pitch`: a height h stands
 * h · sin(pitch) on the screen and the commune's north–south depth d · cos(pitch), whatever the
 * zoom; so h = PART_VOLUME · d · cos / sin keeps the tallest volume at that share of the commune on
 * the screen, on a phone (35°) as on a wide screen (50°). 60 m at least. */
export function plafondVolumes(box: BBox, pitch: number): number {
  const d = (box[3] - box[1]) * 111_320;
  const t = (Math.max(pitch, 20) * Math.PI) / 180;
  return Math.max(60, (PART_VOLUME * d * Math.cos(t)) / Math.sin(t));
}

/** The first `[...]` value after `"key":` in a JSON text still arriving, or null while it is
 * incomplete. Brackets inside strings do not occur in the numbers of a bbox or an outline. */
export function valeur(s: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(s);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}
/** The outline and the box from the head of a map file, once both have arrived. */
export function tete(s: string): Contour | null {
  const b = valeur(s, "bbox");
  const c = valeur(s, "contour");
  if (!b || !c) return null;
  try {
    return { bbox: JSON.parse(b) as BBox, contour: JSON.parse(c) as LonLat[] };
  } catch {
    return null;
  }
}

/** The commune's outline from its map file, read until the outline has come and then cancelled:
 * the file's first keys are its insee, its box and its outline (pipeline, registre carte), the
 * megabytes after them are what the site's map draws itself. Null: no file for the commune. */
export async function lireContour(insee: string, signal?: AbortSignal): Promise<Contour | null> {
  const r = await fetch(carteUrl(insee), { signal });
  // the dev server answers a missing file with the page (HTML), the site with a 404
  if (!r.ok || !/json/.test(r.headers.get("content-type") ?? "") || !r.body) return null;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let s = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) s += dec.decode(value, { stream: true });
    const got = tete(s);
    if (got) {
      void reader.cancel().catch(() => {});
      return got;
    }
    if (done) return null;
  }
}

/** A site's hours over the period, its number of acts, and the words of its label. */
export type Volume = { heures: number; n: number; mots?: string };
type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;
const fc = (features: Feature[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

// --- the layers on the site's map ------------------------------------------------------------

/** The part of the map the calque needs: what it draws with and listens to (a fake in the tests). */
export type CarteMin = Pick<
  MlMap,
  | "addSource"
  | "getSource"
  | "removeSource"
  | "addLayer"
  | "getLayer"
  | "removeLayer"
  | "setPaintProperty"
  | "setFeatureState"
  | "addImage"
  | "hasImage"
  | "removeImage"
  | "queryRenderedFeatures"
  | "getCanvas"
  | "project"
  | "getZoom"
  | "getPitch"
  | "getStyle"
  | "on"
  | "off"
>;

export type Calque = {
  /** Hours per site over the period ({siteId: {heures, n, mots}}); a site not named is not drawn. */
  heures(hs: Record<string, Volume>): void;
  /** The sites a hovered row of the list flies over (a thin outline); the pointer's own zone is
   * the calque's. */
  survoler(ids: string[]): void;
  /** The sites chosen: full, their label shown, the others set back. */
  choisir(ids: string[]): void;
  /** The commune's outline from its map file, when it has come (it says which zones are the whole
   * commune). */
  contour(c: Contour): void;
  /** The theme's colours again (its ink, its ground, the documents' colour). */
  encre(t: Teintes): void;
  /** The box to fit: the outline's, else the drawn zones'. */
  cadre(): BBox | null;
  /** The tallest volume drawn (m): the camera stays well above it. */
  plusHaut(): number;
  /** A site's box (« Voir sur la carte »), null for a site not drawn. */
  boite(id: string): BBox | null;
  /** The cited sectors shown (ids of `formes`, hatched), and the labels of some of them. */
  secteurs(ids: string[], labels?: { id: string; mots: string }[]): void;
  /** The commune's edge dotted (acts without a drawn zone are shown), or not. */
  nonLue(on: boolean): void;
  /** The commune's outline (its file's), for the label set on it. */
  bordure(): LonLat[] | null;
  /** Removes every source, layer and listener it added. */
  retirer(): void;
};

export type CalqueOptions = {
  insee: string;
  sites: Site[];
  /** The theme's ink, ground and documents' colour. */
  teintes: Teintes;
  /** The zone under the pointer changed (null: none). Called once per change, never per move. */
  onSurvol?: (id: string | null) => void;
  /** A zone clicked. */
  onChoix?: (id: string) => void;
  /** The words of a label that stands for several chosen zones at one place (« 3 zones »). */
  groupe?: (n: number) => string;
  /** The commune's box (its file's): the volumes' heights are measured on it. */
  boite?: BBox;
  /** The view's tilt (degrees): the volumes' heights are measured for it. */
  inclinaison?: number;
  /** The cited sectors' shapes (the commune file's drones.formes). */
  formes?: Record<string, { geometry: unknown }>;
  /** The dotted edge clicked. */
  onNonLue?: () => void;
};

/** A feature state read in a paint expression (false when unset). */
const fs = (k: "survol" | "choix" | "retrait"): ExpressionSpecification => [
  "boolean",
  ["feature-state", k],
  false,
];

const isDrone: ExpressionSpecification = ["==", ["get", "kind"], "drone"];
/** A label's size (px): its lift above a volume is counted in its ems. */
const LAB_PX = 13;
/** The screen's pixels per metre on the ground at a zoom and a latitude (the map's 512 px world). */
export const pxParMetre = (zoom: number, lat: number): number =>
  (512 * 2 ** zoom) / (40075016.686 * Math.cos((lat * Math.PI) / 180));
/** Where a point of the ground lands on the screen (px, from the map's centre: right, down), the
 * map centred on `c` at `zoom`, tilted by `pitch` and turned by `bearing` (degrees), over a canvas
 * `H` px high: MapLibre's camera (maplibre-gl src/geo/transform_helper.ts: a field of view of
 * 0.6435 rad, the camera 0.5 / tan(fov / 2) × H = 1.5 H from the centre; a padding moves the
 * centre on the screen, not the perspective). */
export function ecran(
  p: LonLat,
  c: LonLat,
  zoom: number,
  pitch: number,
  bearing: number,
  H: number,
): [number, number] {
  const world = 512 * 2 ** zoom;
  const mx = (lng: number) => (lng + 180) / 360;
  const my = (lat: number) =>
    (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
  const E = (mx(p[0]) - mx(c[0])) * world;
  const N = -(my(p[1]) - my(c[1])) * world;
  const b = (bearing * Math.PI) / 180;
  const t = (pitch * Math.PI) / 180;
  const right = E * Math.cos(b) - N * Math.sin(b);
  const ahead = E * Math.sin(b) + N * Math.cos(b);
  const d = 1.5 * H;
  const depth = d + ahead * Math.sin(t);
  if (depth < d * 0.05) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  return [(right * d) / depth, (-ahead * Math.cos(t) * d) / depth];
}
/** The zoom, from `z0` down, at which a box (centred on `c`), tilted, holds within `hw` × `hh` px
 * on each side of the centre: MapLibre's cameraForBounds fits it flat, and at 50° its near edge
 * spills out on both sides (v2.4: by 50 to 170 px on a wide screen). */
export function zoomIncline(
  box: BBox,
  c: LonLat,
  z0: number,
  pitch: number,
  bearing: number,
  H: number,
  hw: number,
  hh: number,
): number {
  // flat first (exact: the screen scales with the zoom), then tilted from there: a point that
  // would be behind the camera counts as far out
  const tenir = (z: number, t: number) => {
    let k = 0;
    for (const p of [
      [box[0], box[1]],
      [box[2], box[1]],
      [box[2], box[3]],
      [box[0], box[3]],
    ] as LonLat[]) {
      const [x, y] = ecran(p, c, z, t, bearing, H);
      k = Math.max(k, Math.abs(x) / Math.max(1, hw), Math.abs(y) / Math.max(1, hh));
    }
    return Number.isFinite(k) ? k : 4;
  };
  let z = Math.min(z0, z0 - Math.log2(tenir(z0, 0)));
  for (let i = 0; i < 8; i++) {
    const k = tenir(z, pitch);
    if (k <= 1.005) break;
    z -= Math.log2(Math.min(k, 4));
  }
  return z;
}
/** The highest zoom at which the camera, tilted by `pitch` over a canvas `H` px high (MapLibre's,
 * 1.5 H from the centre: see `ecran`), stays at twice `metres` above the ground at latitude `lat`:
 * a volume is never entered, nor seen from right under its top. */
export function zoomAuDessus(metres: number, pitch: number, H: number, lat: number): number {
  if (metres <= 0) return 22;
  const px = (1.5 * H * Math.cos((pitch * Math.PI) / 180)) / (2 * metres);
  return Math.log2((px * 40075016.686 * Math.cos((lat * Math.PI) / 180)) / 512);
}
/** Labels nearer than this on the screen (px) are one place: one label for them. */
const MEME_PLACE = 40;
const isLab: ExpressionSpecification = ["has", "lab"];
const isArea: ExpressionSpecification = ["!", isLab];
const isWhole: ExpressionSpecification = ["==", ["get", "e"], true];
const isLocal: ExpressionSpecification = ["!=", ["get", "e"], true];

/** The layers, bottom to top, in the theme's colours (`admin`: the site's commune shape too).
 * Every change of look on a hover or a choice is a feature state read here: survol (a thin ink
 * outline), choix (full, a thick ink outline, its label), retrait (the others set back). */
function couches(insee: string, t: Teintes, admin: boolean): LayerSpecification[] {
  const recul = melange(t.doc, t.fond, 0.6);
  // a localised volume's own outline and the whole commune's band: the documents' colour darkened
  // on a light ground (the map's ground inside a commune is near the documents' blue), the colour
  // itself on a dark one; never the ink (the ink is the selection's)
  const arete = trait(t);
  const out: LayerSpecification[] = [];
  if (admin)
    out.push({
      id: COUCHES.communeAdmin,
      type: "line",
      source: "admin",
      "source-layer": "communes",
      filter: ["==", ["get", "c"], insee],
      layout: { "line-join": "round" },
      paint: { "line-color": t.encre, "line-width": 3 },
    });
  out.push(
    // a zone over the whole commune: full only when chosen, else a hatched band along its outline
    // (strokes across it), under the commune's own line
    {
      id: COUCHES.entierePlein,
      type: "fill",
      source: SRC,
      filter: ["all", isArea, isWhole],
      paint: { "fill-color": t.doc, "fill-opacity": ["case", fs("choix"), 0.45, 0] },
    },
    {
      id: COUCHES.entiere,
      type: "line",
      source: SRC,
      filter: ["all", isArea, isWhole],
      layout: { "line-join": "bevel" },
      // short strokes across the line, as wide as long: a hatched band
      paint: {
        "line-color": arete,
        "line-width": 8,
        "line-dasharray": [0.4, 0.4],
        "line-opacity": ["case", fs("retrait"), 0.45, 1],
      },
    },
    {
      id: COUCHES.commune,
      type: "line",
      source: SRC_COM,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": t.encre, "line-width": 3 },
    },
    // algorithms: hatched in the documents' colour, full when chosen
    {
      id: COUCHES.vsa,
      type: "fill",
      source: SRC,
      filter: ["all", isArea, isLocal, ["!", isDrone]],
      paint: {
        "fill-pattern": HACHURE,
        "fill-opacity": ["case", fs("retrait"), 0.35, 1],
      },
    },
    {
      id: COUCHES.vsaPlein,
      type: "fill",
      source: SRC,
      filter: ["all", isArea, isLocal, ["!", isDrone]],
      paint: { "fill-color": t.doc, "fill-opacity": ["case", fs("choix"), 0.85, 0] },
    },
    // v2.3: a drone zone set back (another one chosen) is flat, at 15 % (an extrusion's opacity is
    // one for its whole layer: the set-back zones are a flat layer of their own, their volume none)
    {
      id: COUCHES.recul,
      type: "fill",
      source: SRC,
      filter: ["all", isArea, isLocal, isDrone],
      paint: { "fill-color": t.doc, "fill-opacity": ["case", fs("retrait"), 0.15, 0] },
    },
    // drones: volumes in the documents' colour; set back, flat
    {
      id: COUCHES.vol,
      type: "fill-extrusion",
      source: SRC,
      filter: ["all", isArea, isLocal, isDrone],
      paint: {
        "fill-extrusion-color": ["case", fs("retrait"), recul, t.doc],
        "fill-extrusion-height": ["case", fs("retrait"), 0, ["get", "h"]],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.8,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    // each localised zone's outline on the ground (B1: « avec un contour »)
    {
      id: COUCHES.arete,
      type: "line",
      source: SRC,
      filter: ["all", isArea, isLocal],
      layout: { "line-join": "round" },
      paint: {
        "line-color": arete,
        "line-width": 1,
        "line-opacity": ["case", fs("retrait"), 0.4, 1],
      },
    },
    // the zones overlap (a site over the whole commune holds the smaller ones): the chosen one's
    // footprint and the ink outlines are drawn over every volume (flat layers after them, which
    // their depth does not hide), so that a taller zone around it never hides it
    {
      id: COUCHES.sol,
      type: "fill",
      source: SRC,
      filter: ["all", isArea, isLocal, isDrone],
      paint: { "fill-color": t.doc, "fill-opacity": ["case", fs("choix"), 0.95, 0] },
    },
    {
      id: COUCHES.bord,
      type: "line",
      source: SRC,
      filter: isArea,
      layout: { "line-join": "round" },
      paint: {
        "line-color": ["case", fs("choix"), ROSE, t.encre],
        "line-width": ["case", fs("choix"), 4, fs("survol"), 1.5, 0],
      },
    },
    // the words of the zones chosen (v2.3): one label per place, set above its volume's top (`off`,
    // in ems, as the map tilts and zooms), several zones at one place one label (« 3 zones »), a
    // label that would cover another hidden (the map's own collisions); a symbol is drawn over
    // the volumes, never behind one
    {
      id: COUCHES.lab,
      type: "symbol",
      source: SRC_LAB,
      layout: {
        "text-field": ["get", "lab"],
        "text-font": ["Noto Sans Medium"],
        "text-size": LAB_PX,
        "text-anchor": "bottom",
        "text-offset": ["get", "off"],
        "text-padding": 4,
      },
      paint: {
        "text-color": t.encre,
        "text-halo-color": t.fond,
        "text-halo-width": 3,
      },
    },
  );
  return out;
}

/** Board B's two other ways of saying where (lot R4.2), in the drones' blue, under the cameras: a
 * cited sector hatched over a very light fill, its outline; the commune's edge dotted (the board:
 * 7 px, round dots, at 80 %) when acts without a drawn zone are shown. */
function couchesSous(t: Teintes): LayerSpecification[] {
  const bleu = bleuDe(t);
  return [
    {
      id: COUCHES.secteur,
      type: "fill",
      source: SRC_SEC,
      paint: { "fill-pattern": HACHURE_SEC },
    },
    {
      id: COUCHES.secteurBord,
      type: "line",
      source: SRC_SEC,
      layout: { "line-join": "round" },
      paint: { "line-color": bleu, "line-width": 2.5 },
    },
    {
      id: COUCHES.nonLue,
      type: "line",
      source: SRC_NL,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": bleu,
        "line-width": 7,
        "line-opacity": 0.8,
        "line-dasharray": [0.1, 1.6],
      },
    },
  ];
}
/** The cited sectors' labels (board B's « secteur cité · 14e »: white words on the blue), over all. */
function couchesLab(t: Teintes): LayerSpecification[] {
  return [
    {
      id: COUCHES.secteurLab,
      type: "symbol",
      source: SRC_SEC_LAB,
      layout: {
        "text-field": ["get", "lab"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 12,
        "text-transform": "uppercase",
        "icon-image": PAVE_SEC,
        "icon-text-fit": "both",
        "icon-text-fit-padding": [3, 7, 3, 7],
        "text-padding": 6,
        "text-max-width": 24,
      },
      paint: { "text-color": clair(bleuDe(t)) ? "#111111" : "#ffffff" },
    },
  ];
}

/** Draws the commune's drone zones on the site's map; `retirer()` takes everything away. */
export function calque(map: CarteMin, o: CalqueOptions): Calque {
  const insee = o.insee;
  const sites = o.sites.filter((s) => s.parts?.[insee]);
  const geo = new Map(
    sites.map((s) => {
      const p = s.parts?.[insee] ?? {};
      const rs = rings(p.in);
      return [s.id, { s, p, rs, c: centroid(rs), a: aire(rs) }] as const;
    }),
  );
  let outline: Contour | null = null;
  const entiere = entieres(sites);
  let hs: Record<string, Volume> = {};
  let tint = o.teintes;
  // the states as the map holds them: the pointer's zone, the list's, the chosen ones
  let pointe: string | null = null;
  let liste: string[] = [];
  let survoles = new Set<string>();
  let choisis = new Set<string>();
  let curseur = false;
  /** each drawn zone's height (m), for its label's lift */
  const hauteurs = new Map<string, number>();

  const box = (): BBox | null => outline?.bbox ?? bboxOf([...geo.values()].flatMap((g) => g.rs));
  /** the tallest volume's height (m): the commune's box (its file's), else the outline's or the
   * zones', at the view's tilt */
  const plafond = () => {
    const b = o.boite ?? box();
    return b ? plafondVolumes(b, o.inclinaison ?? 50) : 300;
  };

  // one source: each site's polygon and the point of its label share the site's id, so that one
  // feature state covers both
  const zonesData = (): GeoJSON.FeatureCollection => {
    // the heights are the localised zones': a zone over the whole commune is no volume
    const maxH = Math.max(
      1,
      ...Object.entries(hs)
        .filter(([id]) => !entiere.has(id))
        .map(([, v]) => v.heures),
    );
    const top = plafond();
    const out: Feature[] = [];
    hauteurs.clear();
    for (const [id, g] of geo) {
      const v = hs[id];
      const geometry = g.p.in;
      if (!v || !geometry) continue;
      const h = volumeHeight(v.heures, maxH, top);
      hauteurs.set(id, entiere.has(id) || g.s.kind !== "drone" ? 0 : h);
      out.push({
        type: "Feature",
        geometry: geometry as GeoJSON.Geometry,
        properties: { id, kind: g.s.kind, h, a: g.a, e: entiere.has(id) },
      });
    }
    return fc(out);
  };
  /** The chosen zones' labels where the map shows them now: the zones whose labels fall at one
   * place are one label (« 3 zones »), lifted above the tallest one's top. */
  const labelsData = (): GeoJSON.FeatureCollection => {
    if (!choisis.size) return fc([]);
    const lift = Math.sin((map.getPitch() * Math.PI) / 180);
    const z = map.getZoom();
    const pts = [...choisis].flatMap((id) => {
      const g = geo.get(id);
      const mots = hs[id]?.mots;
      if (!g?.c || !mots) return [];
      const p = map.project(g.c as [number, number]);
      return [{ c: g.c, x: p.x, y: p.y, h: hauteurs.get(id) ?? 0, mots }];
    });
    const groupes: (typeof pts)[] = [];
    for (const p of pts) {
      const gr = groupes.find((g) => Math.hypot(g[0].x - p.x, g[0].y - p.y) < MEME_PLACE);
      if (gr) gr.push(p);
      else groupes.push([p]);
    }
    return fc(
      groupes.map((g) => {
        const top = Math.max(...g.map((p) => p.h));
        const ems = (top * pxParMetre(z, g[0].c[1]) * lift) / LAB_PX;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: g[0].c },
          properties: {
            lab: g.length > 1 ? (o.groupe?.(g.length) ?? String(g.length)) : g[0].mots,
            off: [0, -(ems + 0.6)],
          },
        };
      }),
    );
  };
  const communeData = (): GeoJSON.FeatureCollection =>
    fc(
      outline
        ? [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [...outline.contour, outline.contour[0]],
              },
              properties: {},
            },
          ]
        : [],
    );

  // board B: the sectors shown, their labels, the dotted edge
  let secIds: string[] = [];
  let secLabs: { id: string; mots: string }[] = [];
  let nonLueOn = false;
  const formeDe = (id: string) => o.formes?.[id]?.geometry as Area | undefined;
  const secteursData = (): GeoJSON.FeatureCollection =>
    fc(
      secIds.flatMap((id) => {
        const g = formeDe(id);
        return g ? [{ type: "Feature", geometry: g as GeoJSON.Geometry, properties: { id } }] : [];
      }) as Feature[],
    );
  const secLabsData = (): GeoJSON.FeatureCollection =>
    fc(
      secLabs.flatMap((l) => {
        const c = centroid(rings(formeDe(l.id)));
        return c
          ? [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: c },
                properties: { lab: l.mots },
              },
            ]
          : [];
      }) as Feature[],
    );
  const nonLueData = (): GeoJSON.FeatureCollection => (nonLueOn ? communeData() : fc([]));
  const encreData = (): GeoJSON.FeatureCollection => (nonLueOn ? fc([]) : communeData());

  map.addSource(SRC, { type: "geojson", data: zonesData(), promoteId: "id" });
  map.addSource(SRC_COM, { type: "geojson", data: communeData() });
  map.addSource(SRC_LAB, { type: "geojson", data: fc([]) });
  map.addSource(SRC_SEC, { type: "geojson", data: fc([]) });
  map.addSource(SRC_SEC_LAB, { type: "geojson", data: fc([]) });
  map.addSource(SRC_NL, { type: "geojson", data: fc([]) });
  if (!map.hasImage(HACHURE)) map.addImage(HACHURE, hachures(trait(tint)));
  if (!map.hasImage(HACHURE_SEC))
    map.addImage(HACHURE_SEC, hachuresSecteur(bleuDe(tint)), { pixelRatio: 2 });
  if (!map.hasImage(PAVE_SEC)) map.addImage(PAVE_SEC, pave(bleuDe(tint), 8), PAVE_ETIRE);
  // the site's own commune shape until the outline has come (a commune without a map file keeps
  // it): its tiles hold the communes up to z11, overzoomed after
  // under the site's names (the commune's, the streets'), its labels over all (v2.4: the volumes
  // stood over the names): before the site's first symbol layer, but the zones' own labels
  const noms = map
    .getStyle?.()
    ?.layers?.find((l) => l.type === "symbol" && !l.id.startsWith(P))?.id;
  for (const l of couches(insee, tint, !!map.getSource("admin")))
    if (!map.getLayer(l.id)) map.addLayer(l, l.type === "symbol" ? undefined : noms);
  // under the cameras, else under the names: the hatching under their fields, the lines (the
  // sector's outline, the dotted edge) under the filmed streets and the pictograms but over the
  // basemap's roads, which the street level draws over the fields (layers.ts stacked)
  const premiere = (re: RegExp) =>
    map.getStyle?.()?.layers?.find((l) => !l.id.startsWith(P) && re.test(l.id))?.id ?? noms;
  const sousChamps = premiere(CAMERAS);
  const sousRues = premiere(RUES);
  for (const l of couchesSous(tint))
    if (!map.getLayer(l.id)) map.addLayer(l, l.type === "fill" ? sousChamps : sousRues);
  for (const l of couchesLab(tint)) if (!map.getLayer(l.id)) map.addLayer(l);

  const set = (id: string, data: GeoJSON.FeatureCollection) =>
    (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  const etat = (id: string, s: Record<string, boolean>) =>
    map.setFeatureState({ source: SRC, id }, s);
  /** The hovered set is the pointer's zone and the list's: only the zones that change are told. */
  const appliquerSurvol = () => {
    const next = new Set(liste);
    if (pointe) next.add(pointe);
    for (const id of survoles) if (!next.has(id)) etat(id, { survol: false });
    for (const id of next) if (!survoles.has(id)) etat(id, { survol: true });
    survoles = next;
  };
  /** The zone under the pointer: of those there (the volumes overlap, more so tilted), the
   * smallest, so that the same point always gives the same zone. */
  const sous = (e: MapMouseEvent): string | null => {
    const layers = CIBLES.filter((l) => map.getLayer(l));
    if (!layers.length) return null;
    let best: { id: string; a: number } | null = null;
    for (const f of map.queryRenderedFeatures(e.point, { layers })) {
      const id = f.properties?.id as string | undefined;
      const a = Number(f.properties?.a ?? Number.POSITIVE_INFINITY);
      if (id && (!best || a < best.a)) best = { id, a };
    }
    return best?.id ?? null;
  };
  const canvas = map.getCanvas();
  const pointer = (id: string | null) => {
    if (id === pointe) return;
    pointe = id;
    appliquerSurvol();
    if (!!id !== curseur) {
      curseur = !!id;
      if (id) canvas.style.setProperty("cursor", "pointer");
      else canvas.style.removeProperty("cursor");
    }
    o.onSurvol?.(id);
  };
  /** The dotted edge within a few pixels of the pointer (it is thin: 7 px). */
  const surBord = (e: MapMouseEvent): boolean => {
    if (!nonLueOn || !map.getLayer(COUCHES.nonLue)) return false;
    const { x, y } = e.point;
    return (
      map.queryRenderedFeatures(
        [
          [x - 6, y - 6],
          [x + 6, y + 6],
        ],
        { layers: [COUCHES.nonLue] },
      ).length > 0
    );
  };
  let bordSous = false;
  const move = (e: MapMouseEvent) => {
    const id = sous(e);
    pointer(id);
    const b = !id && surBord(e);
    if (b !== bordSous) {
      bordSous = b;
      if (b) canvas.style.setProperty("cursor", "pointer");
      else if (!curseur) canvas.style.removeProperty("cursor");
    }
  };
  const out = () => pointer(null);
  const click = (e: MapMouseEvent) => {
    const id = sous(e);
    if (id) o.onChoix?.(id);
    else if (surBord(e)) o.onNonLue?.();
  };
  // the labels follow the camera (their place on the screen, their lift), once a frame at most
  let image = 0;
  const bouge = () => {
    if (!choisis.size || image) return;
    image = requestAnimationFrame(() => {
      image = 0;
      set(SRC_LAB, labelsData());
    });
  };
  map.on("mousemove", move);
  map.on("mouseout", out);
  map.on("click", click);
  map.on("move", bouge);

  return {
    heures(x) {
      hs = x;
      set(SRC, zonesData());
      if (choisis.size) set(SRC_LAB, labelsData());
    },
    survoler(ids) {
      if (ids.length === liste.length && ids.every((id, i) => id === liste[i])) return;
      liste = [...ids];
      appliquerSurvol();
    },
    choisir(ids) {
      const next = new Set(ids);
      if (next.size === choisis.size && ids.every((id) => choisis.has(id))) return;
      for (const id of geo.keys()) {
        const was = choisis.has(id);
        const is = next.has(id);
        const back = next.size > 0 && !is;
        const wasBack = choisis.size > 0 && !was;
        if (was !== is || back !== wasBack) etat(id, { choix: is, retrait: back });
      }
      choisis = next;
      set(SRC_LAB, labelsData());
    },
    secteurs(ids, labels = []) {
      const same = (a: string[], b: string[]) =>
        a.length === b.length && a.every((x, i) => x === b[i]);
      if (
        same(ids, secIds) &&
        same(
          labels.map((l) => `${l.id}\u0000${l.mots}`),
          secLabs.map((l) => `${l.id}\u0000${l.mots}`),
        )
      )
        return;
      secIds = [...ids];
      secLabs = [...labels];
      set(SRC_SEC, secteursData());
      set(SRC_SEC_LAB, secLabsData());
    },
    nonLue(on) {
      if (on === nonLueOn) return;
      nonLueOn = on;
      set(SRC_NL, nonLueData());
      // board B: the dotted edge in place of the commune's ink line, not under it
      set(SRC_COM, encreData());
    },
    bordure: () => outline?.contour ?? null,
    contour(c) {
      outline = c;
      set(SRC_COM, encreData());
      set(SRC_NL, nonLueData());
      if (map.getLayer(COUCHES.communeAdmin)) map.removeLayer(COUCHES.communeAdmin);
      set(SRC, zonesData());
    },
    encre(t) {
      tint = t;
      // the site's restyle swaps the colours of every layer by its palette's pairs (main.ts) and
      // sets a new sprite: the theme's ink, ground and documents' colour again, and the hatching
      if (map.hasImage(HACHURE)) map.removeImage(HACHURE);
      map.addImage(HACHURE, hachures(trait(t)));
      if (map.hasImage(HACHURE_SEC)) map.removeImage(HACHURE_SEC);
      map.addImage(HACHURE_SEC, hachuresSecteur(bleuDe(t)), { pixelRatio: 2 });
      if (map.hasImage(PAVE_SEC)) map.removeImage(PAVE_SEC);
      map.addImage(PAVE_SEC, pave(bleuDe(t), 8), PAVE_ETIRE);
      for (const l of [...couches(insee, t, true), ...couchesSous(t), ...couchesLab(t)]) {
        if (!map.getLayer(l.id) || !("paint" in l) || !l.paint) continue;
        for (const [k, v] of Object.entries(l.paint))
          (map.setPaintProperty as (l: string, k: string, v: unknown) => void)(l.id, k, v);
      }
    },
    cadre: box,
    plusHaut: () => Math.max(0, ...hauteurs.values()),
    boite(id) {
      const g = geo.get(id);
      return g ? bboxOf(g.rs) : null;
    },
    retirer() {
      map.off("mousemove", move);
      map.off("mouseout", out);
      map.off("click", click);
      map.off("move", bouge);
      if (image) cancelAnimationFrame(image);
      canvas.style.removeProperty("cursor");
      for (const l of Object.values(COUCHES)) if (map.getLayer(l)) map.removeLayer(l);
      for (const s of [SRC, SRC_COM, SRC_LAB, SRC_SEC, SRC_SEC_LAB, SRC_NL])
        if (map.getSource(s)) map.removeSource(s);
      for (const i of [HACHURE, HACHURE_SEC, PAVE_SEC]) if (map.hasImage(i)) map.removeImage(i);
    },
  };
}
