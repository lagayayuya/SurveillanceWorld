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
export const COUCHES = {
  commune: `${P}-commune`,
  communeAdmin: `${P}-commune-admin`,
  entiere: `${P}-entiere`,
  entierePlein: `${P}-entiere-plein`,
  vsa: `${P}-vsa`,
  vsaPlein: `${P}-vsa-plein`,
  vol: `${P}-vol`,
  arete: `${P}-arete`,
  sol: `${P}-sol`,
  bord: `${P}-bord`,
  lab: `${P}-lab`,
} as const;
/** The layers the pointer finds a zone in (the label is not one: it never catches the pointer; a
 * zone over the whole commune is not one either: the pointer would find it everywhere in the
 * commune, and the list chooses it). */
const CIBLES = [COUCHES.vol, COUCHES.vsa];

/** The colours the zones are drawn in: the theme's ink (--fg: the selection, v2.1 A1), its ground
 * (--bg: the label's halo, the zones set back) and the documents' colour (--type-document: an act
 * draws them, drones flat, algorithms hatched). Never the territories' yellow. */
export type Teintes = { encre: string; fond: string; doc: string };
/** The light theme's values (theme/punk/tokens.css), until the page's are read. */
export const TEINTES: Teintes = { encre: "#111111", fond: "#f2efe6", doc: "#7fd4ff" };
const HACHURE = `${P}-hachure`;

/** A zone that covers this share of the commune's area or more is the whole commune (v2.1 B1): its
 * act says « le territoire de la commune », or the commune but for a few blocks; drawn as a volume
 * it would hold every other zone. 0.8: Lyon's whole-commune zone covers 99.9 % of it, its largest
 * localised one 10.2 %; a zone over four fifths of a commune no longer says where in it. */
export const TOUTE_LA_COMMUNE = 0.8;

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
/** The sites over the whole commune, or nearly (TOUTE_LA_COMMUNE of its area), given its outline:
 * their part inside the commune against the outline's area. None without an outline. */
export function entieres(sites: Site[], insee: string, contour: LonLat[] | null): Set<string> {
  const out = new Set<string>();
  const tout = contour ? aire([contour]) : 0;
  if (!tout) return out;
  for (const s of sites)
    if (aire(rings(s.parts?.[insee]?.in)) >= TOUTE_LA_COMMUNE * tout) out.add(s.id);
  return out;
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
/** A volume's height (m): proportional to its hours, the highest at 18 % of the commune's diagonal
 * (250 m at least), 20 m for none (R1a's tilted map's, DECISIONS 2026-10-29). */
export const volumeHeight = (heures: number, maxH: number, diagM: number): number =>
  20 + (heures / Math.max(maxH, 1e-9)) * Math.max(250, diagM * 0.18);

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
  /** A site's box (« Voir sur la carte »), null for a site not drawn. */
  boite(id: string): BBox | null;
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
};

/** A feature state read in a paint expression (false when unset). */
const fs = (k: "survol" | "choix" | "retrait"): ExpressionSpecification => [
  "boolean",
  ["feature-state", k],
  false,
];

const isDrone: ExpressionSpecification = ["==", ["get", "kind"], "drone"];
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
    // drones: flat volumes in the documents' colour, the others set back when one is chosen
    {
      id: COUCHES.vol,
      type: "fill-extrusion",
      source: SRC,
      filter: ["all", isArea, isLocal, isDrone],
      paint: {
        "fill-extrusion-color": ["case", fs("retrait"), recul, t.doc],
        "fill-extrusion-height": ["get", "h"],
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
        "line-color": t.encre,
        "line-width": ["case", fs("choix"), 4, fs("survol"), 1.5, 0],
      },
    },
    // the words of the zone chosen: shown by its state, never by a new datum
    {
      id: COUCHES.lab,
      type: "symbol",
      source: SRC,
      filter: isLab,
      layout: {
        "text-field": ["get", "lab"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 13,
        "text-anchor": "bottom",
        "text-offset": [0, -0.6],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": t.encre,
        "text-halo-color": t.fond,
        "text-halo-width": 3,
        "text-opacity": ["case", fs("choix"), 1, 0],
      },
    },
  );
  return out;
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
  let entiere = new Set<string>();
  let hs: Record<string, Volume> = {};
  let tint = o.teintes;
  // the states as the map holds them: the pointer's zone, the list's, the chosen ones
  let pointe: string | null = null;
  let liste: string[] = [];
  let survoles = new Set<string>();
  let choisis = new Set<string>();
  let curseur = false;

  const box = (): BBox | null => outline?.bbox ?? bboxOf([...geo.values()].flatMap((g) => g.rs));
  const diag = () => {
    const b = box();
    return b ? diagMetres(b) : 5000;
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
    const dM = diag();
    const out: Feature[] = [];
    for (const [id, g] of geo) {
      const v = hs[id];
      const geometry = g.p.in;
      if (!v || !geometry) continue;
      out.push({
        type: "Feature",
        geometry: geometry as GeoJSON.Geometry,
        properties: {
          id,
          kind: g.s.kind,
          h: volumeHeight(v.heures, maxH, dM),
          a: g.a,
          e: entiere.has(id),
        },
      });
      if (g.c && v.mots)
        out.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: g.c },
          properties: { id, kind: g.s.kind, lab: v.mots },
        });
    }
    return fc(out);
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

  map.addSource(SRC, { type: "geojson", data: zonesData(), promoteId: "id" });
  map.addSource(SRC_COM, { type: "geojson", data: communeData() });
  if (!map.hasImage(HACHURE)) map.addImage(HACHURE, hachures(trait(tint)));
  // the site's own commune shape until the outline has come (a commune without a map file keeps
  // it): its tiles hold the communes up to z11, overzoomed after
  for (const l of couches(insee, tint, !!map.getSource("admin")))
    if (!map.getLayer(l.id)) map.addLayer(l);

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
  const move = (e: MapMouseEvent) => pointer(sous(e));
  const out = () => pointer(null);
  const click = (e: MapMouseEvent) => {
    const id = sous(e);
    if (id) o.onChoix?.(id);
  };
  map.on("mousemove", move);
  map.on("mouseout", out);
  map.on("click", click);

  return {
    heures(x) {
      hs = x;
      set(SRC, zonesData());
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
    },
    contour(c) {
      outline = c;
      entiere = entieres(sites, insee, c.contour);
      set(SRC_COM, communeData());
      if (map.getLayer(COUCHES.communeAdmin)) map.removeLayer(COUCHES.communeAdmin);
      set(SRC, zonesData());
    },
    encre(t) {
      tint = t;
      // the site's restyle swaps the colours of every layer by its palette's pairs (main.ts) and
      // sets a new sprite: the theme's ink, ground and documents' colour again, and the hatching
      if (map.hasImage(HACHURE)) map.removeImage(HACHURE);
      map.addImage(HACHURE, hachures(trait(t)));
      for (const l of couches(insee, t, true)) {
        if (!map.getLayer(l.id) || !("paint" in l) || !l.paint) continue;
        for (const [k, v] of Object.entries(l.paint))
          (map.setPaintProperty as (l: string, k: string, v: unknown) => void)(l.id, k, v);
      }
    },
    cadre: box,
    boite(id) {
      const g = geo.get(id);
      return g ? bboxOf(g.rs) : null;
    },
    retirer() {
      map.off("mousemove", move);
      map.off("mouseout", out);
      map.off("click", click);
      canvas.style.removeProperty("cursor");
      for (const l of Object.values(COUCHES)) if (map.getLayer(l)) map.removeLayer(l);
      for (const s of [SRC, SRC_COM]) if (map.getSource(s)) map.removeSource(s);
      if (map.hasImage(HACHURE)) map.removeImage(HACHURE);
    },
  };
}
