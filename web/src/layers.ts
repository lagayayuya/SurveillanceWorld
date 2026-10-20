// Surveillance layers, one hue. Reading levels with 0.5-zoom cross-fades:
//   city     z5–12.5   départements (z5–8.5), then communes or municipal arrondissements
//                      (z8–12.5), quantile colour scales
//   streets  z12+      what is filmed, in the colour of the level reached (merged at
//                      z12-14, portions from z15); segments grey from z14; sidewalks,
//                      crossings and paths beside a road from z16
//   street   z15+      observation levels (DORI) for the chosen reach estimate, pictos
//   focus    a clicked camera: everything else at DIM opacity; its chosen estimate as
//            outlines with their reach written on them, and the street it films
// Everything that depends on the reach estimate is suffixed with its index in the tiles
// (0 certain, 1 probable, 2 cautious).

import { layers as flavourLayers, namedFlavor } from "@protomaps/basemaps";
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
} from "maplibre-gl";
import { locale, t } from "./i18n";
import { MARKS, pictoImage, TAG_PREFIX } from "./icons";
import { PUNK_PORTION_WIDTH, streetWidth } from "./streetwidth";
import { labelHaloWidth, palette, themeAreaOpacity, ui, waterOverFields } from "./theme";

export const CITY_FADE: [number, number] = [12, 12.5];
export const STREET_FADE: [number, number] = [12, 12.5];
/** Départements fade into communes over this range (both are in the z8 tiles). */
export const AREA_FADE: [number, number] = [8, 8.5];
/** Communes from here (tiles.DEPS_MAX + 1); the legend and counts switch here. */
export const COMMUNES_MIN = AREA_FADE[0];
export const DETAIL_FADE: [number, number] = [15, 15.5];
export const DETAIL_MIN = DETAIL_FADE[0];
/** A camera's tap target around its pictogram, in CSS px (`camera-hit`); main.ts keeps a
 * tapped camera's whole target in the part of the map the panels leave free. */
export const CAMERA_HIT_RADIUS = 20;
export const COUNT_MAX = 15; // communes stay loaded (invisible) up to here to count cameras

// Colours come from the theme's tokens (theme.ts palette(), --map-* in theme/*.css), read
// each time a layer or a paint value is built. The other cameras' pictograms stay visible
// and tappable in focus mode (palette().otherPicto): only their fields and streets are
// dimmed to DIM.
// Communes and départements: light enough for the basemap under them to stay readable
// (labels are drawn above every surface) [TO ADJUST]; a theme may set its own
// (--map-area-opacity: punk draws them opaque, so that the legend's colours are the map's).
const AREA_OPACITY = 0.5;
const areaAlpha = () => themeAreaOpacity() ?? AREA_OPACITY;

export type Mode = { publicOnly: boolean; est: number };
/** Communes and départements are coloured by the high end of their "between X % and Y %"
 * (`hi`), whatever the estimate chosen (tiles._area_features). */
export const areaKey = (m: Mode) => (m.publicOnly ? "hi_pub" : "hi");
export const areaCountKey = (m: Mode) => (m.publicOnly ? "n_pub" : "n");

export function sources(base: string): Record<string, SourceSpecification> {
  const src = (file: string): SourceSpecification => ({
    type: "vector",
    url: `pmtiles://${base}/tiles/${file}.pmtiles`,
  });
  return {
    admin: { ...src("admin"), attribution: t("attribution.ign") } as SourceSpecification,
    streets: src("streets"),
    detail: src("detail"),
    "focus-points": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  };
}

/** `step` stops must strictly increase. */
const increasing = (breaks: number[]) => breaks.filter((b, i) => i === 0 || b > breaks[i - 1]);

/** Commune or département colour: quantile classes (breaks in % from meta.json). */
export function areaColour(key: string, breaks: number[]): ExpressionSpecification {
  const { area } = palette();
  const steps: (number | string)[] = [];
  increasing(breaks).forEach((b, i) => {
    steps.push(b, area[i + 1]);
  });
  return ["step", ["get", key], area[0], ...steps] as unknown as ExpressionSpecification;
}

/** Filmed portion colour, at every zoom: highest level reached (1 detection,
 * 2 recognition, 3 identification). z12-14: the filmed intervals of the axes, merged;
 * from z15: the portions with their cameras (pipeline: tiles.merged_portions,
 * exposure.street_portions). Nothing else is coloured: a segment is never coloured
 * beyond what is filmed on it. */
export function levelColour(): ExpressionSpecification {
  const { level } = palette();
  return ["match", ["get", "lv"], 3, level[2], 2, level[1], level[0]];
}
export const portionFilter = (est: number): FilterSpecification => ["==", ["get", "b"], est];

/** A portion kept by the active filters (streetfilter.ts marks it). */
const KEPT: ExpressionSpecification = ["boolean", ["feature-state", "sel"], false];
// What the filters exclude is hidden, not faded: a faded street read as filmed (author's
// decision, phase "tronçons"; was 0.15).
const FILTERED_OUT = 0;
const FILTERED_FROM = 15; // portions carry their cameras from this zoom (tiles.PORTIONS_MIN)

/** A merged portion (z12-14) with at least one bit of `bits` set in `key` (fb):
 * expressions have no bitwise operators, so each bit is floor(v / 2^b) % 2. */
export function anyBit(key: string, bits: number[]): ExpressionSpecification {
  const v: ExpressionSpecification = ["coalesce", ["get", key], 0];
  return [
    "any",
    ...bits.map((b) => ["==", ["%", ["floor", ["/", v, 2 ** b]], 2], 1]),
  ] as ExpressionSpecification;
}

/** A merged portion of the z12-14 tiles (the only ones with filter bits `fb`), still drawn
 * past z15 while the z15 tiles load. It has no id, hence no mark: its bits decide, as below
 * z15. (Not ["==", ["id"], null]: a tile feature without an id has an undefined one.) */
const MERGED: ExpressionSpecification = ["has", "fb"];

/** Portion colour while filters are active: kept portions in one shade, from the filter
 * bits at z12-14 (`lowKept`; null: nothing to test there) and from feature-state marks
 * from z15 (when `marked`; merged portions still drawn there keep their bits). */
export function filteredPortionColour(
  lowKept: ExpressionSpecification | null,
  marked: boolean,
): ExpressionSpecification {
  const { low, high } = portionColours(lowKept, marked);
  return [
    "step",
    ["zoom"],
    low,
    FILTERED_FROM,
    ["case", MERGED, low, high],
  ] as unknown as ExpressionSpecification;
}

function portionColours(lowKept: ExpressionSpecification | null, marked: boolean) {
  const { kept } = palette();
  const level = levelColour();
  const low = lowKept ? ["case", lowKept, kept, level] : level;
  const high = marked ? ["case", KEPT, kept, level] : level;
  return { low, high };
}

/** Punk, a camera in focus: every portion in one opaque dimmed colour where the fields are
 * drawn, as the other fields (fieldPaint; DECISIONS 2026-10-08, « The palette of the second
 * round is validated »: no transparency that adds up), the focused camera's own drawn again
 * above (focus-streets); below, the colours of filteredPortionColour. One zoom curve per
 * expression: a merged portion (z12-14) takes its bits' colour by its `fb`, not by the zoom.
 * Still a curve on the zoom over feature data, as the portions' colour always is (see
 * portionColour). */
export function focusedPortionColour(
  lowKept: ExpressionSpecification | null,
  marked: boolean,
): ExpressionSpecification {
  const { low, high } = portionColours(lowKept, marked);
  const [a, b] = DETAIL_FADE;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    a,
    ["case", MERGED, low, high],
    b,
    palette().fieldDimLine,
  ] as unknown as ExpressionSpecification;
}

/** The portions' colour, filters or not, always as a step on the zoom: MapLibre keeps a
 * bucket's paint binder while a paint property changes kind, and a "source" colour set
 * over a composite one (or the reverse) broke feature-state updates ("interpolationFactor
 * is not a function", maplibre-gl CompositeExpressionBinder.setUniform). */
export const portionColour = (): ExpressionSpecification => filteredPortionColour(null, false);

/** Portions fade in with the street level; while filters are active, those they do not
 * keep are hidden (FILTERED_OUT; bits at z12-14, marks from z15). Past z15 a merged
 * portion keeps its bits: it has no id, hence no mark, and was hidden while the z14 tiles
 * loaded (the streets vanished around z14 on an iPhone while zooming, when z14 had marks). */
export function portionOpacity(
  lowKept: ExpressionSpecification | null = null,
  marked = false,
): ExpressionSpecification {
  const low = lowKept ? ["case", lowKept, 1, FILTERED_OUT] : 1;
  const high = ["case", MERGED, low, marked ? ["case", KEPT, 1, FILTERED_OUT] : 1];
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    STREET_FADE[0],
    0,
    STREET_FADE[1],
    low,
    FILTERED_FROM - 0.01,
    low,
    FILTERED_FROM,
    high,
  ] as unknown as ExpressionSpecification;
}

/** "Maybe gone" (fixme): bit 2 of `fl`. Shown by a badge, not by paleness. */
export const MAYBE_GONE: ExpressionSpecification = [
  "==",
  ["%", ["floor", ["/", ["get", "fl"], 4]], 2],
  1,
];

/** Pictograms are opaque, one colour each (SDF images): a lighter colour, never an
 * opacity, so that overlapping pictograms do not darken. In focus mode the others take
 * the pictogram colour at 0.7 over the halo's (theme.ts otherPicto). The punk stickers
 * carry their own colours: filters.ts asks for this colour at every change of focus, and
 * the camera layer's image follows (stickerImage). */
export function pictoColour(focus: number | null): ExpressionSpecification {
  if (stickers()) pictoImage(stickerImage(focus));
  const { picto, otherPicto, gone } = palette();
  const own: ExpressionSpecification | string =
    focus === null ? picto : ["case", ["==", ["id"], focus], picto, otherPicto];
  return ["case", VERIFIED_GONE, gone, own] as ExpressionSpecification;
}

/** Verified gone (a validated "introuvable", tiles `gm`): a grey pictogram, drawn only
 * while the advanced filter "Disparue (vérifiée sur place)" is on. */
export const VERIFIED_GONE: ExpressionSpecification = ["has", "gm"];
const STANDING: FilterSpecification = ["!", ["has", "gm"]];

// --- the punk interface's stickers (stickers.ts, registered by icons.ts) -----------------
// Plain images in several colours (mockup 16a): icon-color and icon-halo do not apply to
// them, so each state is an image of its own, chosen by icon-image (icons.ts stickerName:
// `sticker-<kind>-<state>`, the selected camera's drawn larger, `-big`). The current
// interface keeps its one-colour SDF pictograms, `cam-<kind>`.
const stickers = () => ui() === "punk";
const CAM_IMAGE: ExpressionSpecification = ["concat", "cam-", ["get", "k"]];
const sticker = (state: ExpressionSpecification | string): ExpressionSpecification => [
  "concat",
  "sticker-",
  ["get", "k"],
  state,
];

/** The punk camera layer's image for the camera in `focus` (null: none), as pictoColour
 * colours it: verified gone, the camera in focus, the others dimmed (16a's « version
 * atténuée »: an image, not an opacity, so that overlapping ones do not darken). */
export function stickerImage(focus: number | null): ExpressionSpecification {
  const state: ExpressionSpecification | string =
    focus === null ? "-full" : ["case", ["==", ["id"], focus], "-full", "-dim"];
  return sticker(["case", VERIFIED_GONE, "-gone", state] as ExpressionSpecification);
}

// The outline that follows each pictogram's shape (and fills its inner marks).
const pictoHalo = () => ({
  "icon-halo-color": palette().halo,
  "icon-halo-width": 2,
  "icon-halo-blur": 1,
});

export const areasMapped = (key: string): FilterSpecification => [">", ["get", key], 0];
export const areasEmpty = (key: string): FilterSpecification => ["==", ["get", key], 0];

function fadeIn([a, b]: [number, number], max = 1): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], a, 0, b, max];
}

// --- opacities, and their dimming in focus mode ------------------------------------------
export const DIM = 0.15;
type Value = ExpressionSpecification | number;

/** `expr` times `factor`. ["zoom"] must stay the input of the top-level curve, so the
 * factor goes into each output of an interpolate or step. */
export function scaled(expr: Value, factor: Value): Value {
  if (factor === 1) return expr;
  if (Array.isArray(expr) && (expr[0] === "interpolate" || expr[0] === "step")) {
    const out: unknown[] = [...expr];
    const first = expr[0] === "interpolate" ? 4 : 2;
    for (let i = first; i < out.length; i += 2) out[i] = ["*", out[i], factor];
    return out as ExpressionSpecification;
  }
  return ["*", expr, factor] as ExpressionSpecification;
}

const STREETS_OPACITY = fadeIn([14, 14.5], 0.8);
// ["zoom"] must be the input of a top-level interpolate: the per-level opacity is its
// output at the end of the fade.
const BANDS_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  DETAIL_FADE[0],
  0,
  DETAIL_FADE[1],
  ["match", ["get", "lv"], 1, 0.05, 2, 0.08, 3, 0.11, 0.05],
];
const UNKNOWN_DIRECTION_OPACITY = fadeIn(DETAIL_FADE, 0.55);
// Punk: each level opaque (the overlaps of one level draw the same pixels), fading in with
// the street level.
const FIELD_OPACITY = fadeIn(DETAIL_FADE, 1);

/** `expr`, a linear curve on the zoom whose stops all lie below the street level, times
 * `factor` only where the fields are drawn: unchanged up to DETAIL_FADE[0], then dimmed
 * over DETAIL_FADE as the fields fade in. */
export function dimmedWithFields(expr: Value, factor: number): ExpressionSpecification {
  const [a, b] = DETAIL_FADE;
  if (!Array.isArray(expr)) return ["interpolate", ["linear"], ["zoom"], a, expr, b, expr * factor];
  const stops = expr.slice(3);
  if (expr[0] !== "interpolate" || Number(stops[stops.length - 2]) >= a)
    throw new Error("dimmedWithFields: a linear zoom curve below the street level");
  const last = stops[stops.length - 1];
  return [...expr, a, last, b, ["*", last, factor]] as unknown as ExpressionSpecification;
}

/** Opacity of every dimmable layer; `focus` is the focused camera's feature id (null: no
 * focus), `portions` the filmed portions' opacity when filters apply (null: none).
 * `whereFields`: the streets and portions are dimmed only where the fields are drawn
 * (from the street level), so that zooming out of a focused camera shows the map as it
 * is (the punk interface); otherwise at every zoom. */
type OpacityProp = "line-opacity" | "fill-opacity" | "icon-opacity";
export const FIELD_LEVELS = [1, 2, 3] as const;
export type Level = (typeof FIELD_LEVELS)[number];
export function opacities(
  focus: number | null,
  portions: ExpressionSpecification | null = null,
  whereFields = false,
): [string, OpacityProp, Value][] {
  const onCamera = (key: ExpressionSpecification): Value =>
    focus === null ? 1 : ["case", ["==", key, focus], 1, DIM];
  const band = onCamera(["get", "i"]);
  const rest = focus === null ? 1 : DIM;
  const dim = (expr: Value): Value =>
    whereFields && focus !== null ? dimmedWithFields(expr, DIM) : scaled(expr, rest);
  // Punk: the portions stay opaque in focus, in a dimmed colour (focusedPortionColour).
  const portionsDim = stickers() ? (expr: Value) => expr : dim;
  const street: [string, OpacityProp, Value][] = [
    ["streets", "line-opacity", dim(STREETS_OPACITY)],
    ["portions", "line-opacity", portionsDim(portions ?? portionOpacity())],
  ];
  if (!stickers())
    return [
      ...street,
      ["bands", "fill-opacity", scaled(BANDS_OPACITY, band)],
      ["bands-unknown-direction", "fill-opacity", scaled(UNKNOWN_DIRECTION_OPACITY, band)],
    ];
  // Punk: the fields stay opaque in focus; the others take a dimmed colour instead
  // (fieldPaint), the focused camera's own are drawn again above them (focus-zone-*).
  return street;
}

/** Punk: the paint of the levels' layers, every camera's field: in focus one opaque dimmed
 * colour for all of them, outline included (DECISIONS 2026-10-08, « The more vivid… »: no
 * transparency that adds up where fields overlap), the focused camera's own drawn again
 * above (focus-zone-*); otherwise each level's pattern and outline. */
export function fieldPaint(
  focus: number | null,
): [string, "fill-pattern" | "line-color", string][] {
  const p = palette();
  return FIELD_LEVELS.flatMap((lv) => [
    [`field-${lv}`, "fill-pattern", focus === null ? MARKS.fields[lv - 1] : MARKS.fieldDim],
    [`field-${lv}-line`, "line-color", focus === null ? p.fieldLine : p.fieldDimLine],
  ]) as [string, "fill-pattern" | "line-color", string][];
}

/** "identification ~6 m" on a band outline: the catalogue template, its {level} and {m}
 * placeholders replaced by feature properties (lv, r). Punk: « identification 6 m », the
 * reach rounded up to the metre as the sheet's tickets (chips.ts upMetre; DECISIONS
 * 2026-10-08, « The punk sheet's « ~ »… »). */
export function reachLabel(): ExpressionSpecification {
  const punk = stickers();
  const template = t(punk ? "focus.punk.label" : "focus.label", { level: "{level}", m: "{m}" });
  const level = [
    "match",
    ["get", "lv"],
    1,
    t("focus.level.1"),
    2,
    t("focus.level.2"),
    t("focus.level.3"),
  ];
  const parts = template
    .split(/(\{level\}|\{m\})/)
    .filter(Boolean)
    .map((p) =>
      p === "{level}"
        ? level
        : p === "{m}"
          ? punk
            ? ["number-format", ["ceil", ["-", ["get", "r"], 1e-9]], { locale }]
            : ["number-format", ["get", "r"], { locale, "max-fraction-digits": 1 }]
          : p,
    );
  return ["concat", ...parts] as ExpressionSpecification;
}

/** Opacity of one level of areas: départements fade out over AREA_FADE, communes fade in
 * there and out into the streets over CITY_FADE. */
function areaOpacity(deps: boolean, max: number): ExpressionSpecification {
  const [a, b] = AREA_FADE;
  return deps
    ? ["interpolate", ["linear"], ["zoom"], a, max, b, 0]
    : ["interpolate", ["linear"], ["zoom"], a, 0, b, max, CITY_FADE[0], max, CITY_FADE[1], 0];
}

/** The communes' and départements' fill opacity for the theme in force, by layer id: a
 * change of mode may change it (main.ts restyle, which otherwise swaps colours only). */
export function areaFillOpacities(): Record<string, ExpressionSpecification> {
  const alpha = areaAlpha();
  return { deps: areaOpacity(true, alpha), communes: areaOpacity(false, alpha) };
}

/** The fill, "no camera" hatching, outline and selection outline of one level of areas
 * (source-layer `departements` or `communes`). */
function areaLayers(
  layer: "departements" | "communes",
  breaks: number[],
  mode: Mode,
): LayerSpecification[] {
  const deps = layer === "departements";
  const id = deps ? "deps" : "communes";
  const base = {
    source: "admin",
    "source-layer": layer,
    ...(deps ? { maxzoom: AREA_FADE[1] } : { minzoom: AREA_FADE[0], maxzoom: CITY_FADE[1] }),
  };
  return [
    {
      ...base,
      id: `${id}-none`,
      type: "fill",
      filter: areasEmpty(areaCountKey(mode)),
      paint: { "fill-pattern": "hatch-none", "fill-opacity": areaOpacity(deps, 0.6) },
    },
    {
      ...base,
      id,
      type: "fill",
      filter: areasMapped(areaCountKey(mode)),
      paint: {
        "fill-color": areaColour(areaKey(mode), breaks),
        "fill-opacity": areaOpacity(deps, areaAlpha()),
      },
    },
    {
      ...base,
      id: `${id}-line`,
      type: "line",
      // Punk: a thin light-blue border, opaque, so that two neighbours of one class read
      // apart (DECISIONS 2026-10-08, « The more vivid… »), about 0.75 px at every zoom
      // (DECISIONS 2026-10-09, « Punk map after the iPhone test »: 1.5 px read heavy).
      paint: stickers()
        ? {
            "line-color": palette().areaBorder,
            "line-opacity": areaOpacity(deps, 1),
            "line-width": AREA_BORDER,
          }
        : {
            "line-color": palette().areaLine,
            "line-opacity": areaOpacity(deps, deps ? 0.55 : 0.35),
            "line-width": deps ? 1.2 : ["interpolate", ["linear"], ["zoom"], 8, 0.4, 12, 1],
          },
    },
    // Punk: the open area's outline on a dark edge, 1 px of it each side, so that the light
    // blue stands out on the vivid classes (DECISIONS 2026-10-09).
    ...(stickers()
      ? [
          {
            ...base,
            id: `${id}-selected-edge`,
            type: "line",
            filter: ["==", ["get", "c"], ""],
            layout: { "line-join": "round" },
            paint: {
              "line-color": palette().areaSelectedEdge,
              "line-width": AREA_SELECTED + 2,
              "line-opacity": areaOpacity(deps, 1),
            },
          },
        ]
      : []),
    {
      // The area whose sheet is open (filter set by main.ts).
      ...base,
      id: `${id}-selected`,
      type: "line",
      filter: ["==", ["get", "c"], ""],
      layout: { "line-join": "round" },
      paint: {
        "line-color": palette().areaSelected,
        "line-width": stickers() ? AREA_SELECTED : 2.5,
        "line-opacity": areaOpacity(deps, 1),
      },
    },
  ] as LayerSpecification[];
}

/** Punk: the areas' border and the open area's outline, in CSS px. */
const AREA_BORDER = 0.75;
const AREA_SELECTED = 3;
/** The layers outlining the open area (main.ts selectArea sets their filter; the edges are
 * punk's only). */
export const AREA_SELECTED_LAYERS = [
  "communes-selected-edge",
  "communes-selected",
  "deps-selected-edge",
  "deps-selected",
];

/** Our layers drawn above the basemap's labels: the pictograms, their click target and
 * the reach labels. Every surface and line goes under the labels. */
export const ABOVE_LABELS = new Set([
  "focus-labels",
  "camera-hit",
  "cameras",
  "camera-gone",
  "camera-selected",
  "focus-marker-edge",
  "focus-marker-ring",
  "focus-marker",
]);

// --- the focused camera below the street level (punk interface) -------------------------
// Below DETAIL_MIN the detail tiles, hence the camera and its field, are not drawn: a
// marker stands in its place, its own pictogram on a paper disc ringed with the field's
// outline colour and edged in ink (the ring alone was 2.4:1 on the most filmed communes in
// light), until the selected pictogram (camera-selected) takes over.
export const FOCUS_CAMERA = "focus-camera";
export const FOCUS_MARKER_RING = "focus-marker-ring";
const MARKER_DISC = 19;
const MARKER_RING = 3;
const MARKER_EDGE = 4.5;
/** The marker's outer radius in CSS px, its ink edge included (main.ts keeps it in view). */
export const FOCUS_MARKER_RADIUS = MARKER_DISC + MARKER_EDGE;

export function focusMarkerSource(): Record<string, SourceSpecification> {
  return { [FOCUS_CAMERA]: { type: "geojson", data: { type: "FeatureCollection", features: [] } } };
}

export function focusMarkerLayers(): LayerSpecification[] {
  const p = palette();
  return [
    {
      // The ink edge: 1.5 px outside the ring (MapLibre draws a circle's stroke outside its
      // radius: 19 + 3 for the ring, 19 + 4.5 here), 3:1 on the earth and on every class
      // of communes in both modes (web/tests/theme.test.ts).
      id: "focus-marker-edge",
      type: "circle",
      source: FOCUS_CAMERA,
      maxzoom: DETAIL_MIN,
      paint: {
        "circle-radius": MARKER_DISC,
        "circle-color": p.ink,
        "circle-stroke-width": MARKER_EDGE,
        "circle-stroke-color": p.ink,
      },
    },
    {
      id: FOCUS_MARKER_RING,
      type: "circle",
      source: FOCUS_CAMERA,
      maxzoom: DETAIL_MIN,
      paint: {
        "circle-radius": MARKER_DISC,
        "circle-color": p.halo,
        "circle-stroke-width": MARKER_RING,
        "circle-stroke-color": p.fieldLine,
      },
    },
    {
      id: "focus-marker",
      type: "symbol",
      source: FOCUS_CAMERA,
      maxzoom: DETAIL_MIN,
      layout: {
        "icon-image": stickers() ? sticker("-full") : CAM_IMAGE,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": 1,
      },
      paint: { "icon-color": p.picto },
    },
  ] as LayerSpecification[];
}

/** The basemap's buildings, drawn above the punk fields (DECISIONS 2026-10-08, « The more
 * vivid… »: one sees them inside a field), just under the streets. */
const ABOVE_FIELDS = new Set(["buildings"]);

/** A basemap layer as the punk map draws it: the buildings, lifted above the communes too,
 * appear only as the communes fade out (CITY_FADE), at the flavour's own opacity (they
 * stood as pale specks on the opaque communes). Every other layer, and the classique's,
 * as it is. */
function basemapLayer(l: LayerSpecification): LayerSpecification {
  if (!stickers() || !ABOVE_FIELDS.has(l.id) || l.type !== "fill") return l;
  const opacity = l.paint?.["fill-opacity"] ?? 1;
  return {
    ...l,
    paint: {
      ...l.paint,
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], CITY_FADE[0], 0, CITY_FADE[1], opacity],
    },
  } as LayerSpecification;
}

/** Punk: the basemap's roads, paths, pedestrian ways, piers, ramps and bridges (every line
 * of the flavour's `roads` but the tunnels, under the ground, the railways and the
 * airfields), drawn again above the fields from the street level (product owner,
 * 2026-10-15: footpaths and quays vanished under the halftone, « Prudent » most), in their
 * own style, under our streets and every label. Their copies are named `<id>-lifted`; the
 * flavour's layer stops where its copy starts, so that nothing changes below it. The
 * paths' lines (footways, sidewalks, cycle tracks: the flavour's `other`) are lifted from
 * z16 only, where the portions of the sidewalks, crossings and paths beside a road start
 * (pipeline tiles.NON_AXIS_MIN): lifted at z15 they showed white in a field that colours
 * them only from z16 (2026-10-15, cause (b) of the white ways).
 * A copy is in the tiles of the PARENT_ZOOMS zooms below its own as well, invisible there
 * (opacity 0 up to where it starts): while a zoom's tiles load, MapLibre draws their
 * loaded parent tile, whose buckets hold only the layers of its own zoom range. With the
 * copy starting at z15 and the flavour's layer stopping there, a parent drew neither, and
 * every road vanished for the load's time, on a dark map a black screen with pink lines
 * (lot P, 2026-10-17: 0.6 to 1.5 s at Châtelet on a phone over 4G, z14 to z15). */
export const LIFTED = "-lifted";
const PATHS_MIN = 16;
const PARENT_ZOOMS = 2;
/** `value` from zoom `z`, 0 below; null when `value` is itself a curve on the zoom (it
 * cannot be nested). */
const shownFrom = (value: unknown, z: number): ExpressionSpecification | null =>
  typeof value === "number" ? (["step", ["zoom"], 0, z, value] as ExpressionSpecification) : null;
const liftedFrom = (l: LayerSpecification) =>
  /^roads_(bridges_)?other(_casing)?$/.test(l.id) ? PATHS_MIN : DETAIL_MIN;
const lifts = (l: LayerSpecification) =>
  l.type === "line" &&
  l["source-layer"] === "roads" &&
  !/^roads_(tunnels_|rail|runway|taxiway)/.test(l.id) &&
  // Drawn past the street level (the flavour's `_casing_early` stop at z12).
  (l.maxzoom ?? Number.POSITIVE_INFINITY) > DETAIL_MIN;

/** Punk: the basemap's water drawn again over the fields from the street level, where the
 * fields are (product owner, 2026-10-15: the halftone hid the Seine and the canals), see
 * through (the theme's --map-water-opacity: the halftone guessable under it), then its
 * shore, 1 px a little darker (--map-water-shore). The fields' outlines go under it with
 * their fills: each camera's outline is hidden inside the field by its level's fill drawn
 * just above it, so nothing can go between them (outlines above the water would need each
 * level's union outline from the pipeline); the focused camera's zone, drawn over the
 * water, keeps its outline clear (stacked). Not cut: the fields keep their extent, only
 * the drawing changes. The flavour's water stays under them at every zoom: the copy over
 * it is the same colour, so that nothing changes where there is no field. The rivers' and
 * streams' centre lines stay under the fields (over the water polygon a see-through line
 * would darken a band of it). */
export const WATER_OVER = "water-over-fields";
export const WATER_SHORE = "water-shore";
function waterOver(basemap: LayerSpecification[]): LayerSpecification[] {
  const water = basemap.find(
    (l): l is FillLayerSpecification => l.id === "water" && l.type === "fill",
  );
  const w = waterOverFields();
  if (!water || !w) return [];
  return [
    // In the parents' tiles too, invisible below the street level (as the lifted roads).
    {
      ...water,
      id: WATER_OVER,
      minzoom: DETAIL_MIN - PARENT_ZOOMS,
      paint: { ...water.paint, "fill-opacity": shownFrom(w.opacity, DETAIL_MIN) },
    } as LayerSpecification,
    {
      id: WATER_SHORE,
      type: "line",
      source: water.source,
      "source-layer": water["source-layer"],
      filter: water.filter,
      // FIELD_OPACITY is 0 below the street level.
      minzoom: DETAIL_MIN - PARENT_ZOOMS,
      paint: { "line-color": w.shore, "line-width": 1, "line-opacity": FIELD_OPACITY },
    } as LayerSpecification,
  ];
}

/** The basemap's layers as the theme draws them, by id (main.ts restyle swaps them so on a
 * change of mode): punk, the buildings faded in with the streets (basemapLayer), each road
 * line split at the street level, its copy drawn above the fields after the buildings, in
 * the flavour's order, and the water drawn again over the fields (waterOver); the
 * classique's as they are. */
export function drawnBasemap(basemap: LayerSpecification[]): LayerSpecification[] {
  if (!stickers()) return basemap;
  const copies = basemap.filter(lifts).map((l) => {
    const from = liftedFrom(l);
    const paint = (l.paint ?? {}) as Record<string, unknown>;
    const opacity = shownFrom(paint["line-opacity"] ?? 1, from);
    return {
      ...l,
      id: `${l.id}${LIFTED}`,
      minzoom: Math.max(l.minzoom ?? 0, opacity ? from - PARENT_ZOOMS : from),
      ...(opacity ? { paint: { ...paint, "line-opacity": opacity } } : {}),
    } as LayerSpecification;
  });
  return [
    ...basemap.map((l) => (lifts(l) ? { ...l, maxzoom: liftedFrom(l) } : basemapLayer(l))),
    ...waterOver(basemap),
    ...copies,
  ];
}

/** The whole style's layers: basemap surfaces and lines, ours, basemap labels, then our
 * symbols; punk: the water over every camera's fields, under the focused camera's zone
 * (punkFields), then the buildings and the basemap's roads (drawnBasemap) between our
 * fields (fill and outline: each level's outline lies under its own fill, there is no place
 * between them) and our streets. */
export function stacked(
  basemap: LayerSpecification[],
  ours: LayerSpecification[],
): LayerSpecification[] {
  const drawn = drawnBasemap(basemap);
  const labels = drawn.filter((l) => l.type === "symbol");
  const water = drawn.filter((l) => l.id === WATER_OVER || l.id === WATER_SHORE);
  const lifted = stickers()
    ? drawn.filter((l) => ABOVE_FIELDS.has(l.id) || l.id.endsWith(LIFTED))
    : [];
  const ground = drawn.filter(
    (l) => l.type !== "symbol" && !lifted.includes(l) && !water.includes(l),
  );
  let below = ours.filter((l) => !ABOVE_LABELS.has(l.id));
  const zone = water.length ? below.findIndex((l) => l.id === `${FOCUS_ZONE}-1-line`) : -1;
  if (zone >= 0) below = [...below.slice(0, zone), ...water, ...below.slice(zone)];
  const at = lifted.length ? below.findIndex((l) => l.id === "streets") : -1;
  return [
    ...ground,
    ...(at < 0 ? below : [...below.slice(0, at), ...lifted, ...below.slice(at)]),
    ...labels,
    ...ours.filter((l) => ABOVE_LABELS.has(l.id)),
  ];
}

export type Breaks = { communes: number[]; departements: number[] };

export function surveillanceLayers(breaks: Breaks, mode: Mode): LayerSpecification[] {
  const p = palette();
  return [
    // Punk: 20a's dot screen is the basemap earth's own fill (basemap.ts PAPER_EARTH).
    // --- city ------------------------------------------------------------------------
    ...areaLayers("departements", breaks.departements, mode),
    ...areaLayers("communes", breaks.communes, mode),
    {
      // Invisible: keeps the communes loaded down to the street level for the panel's
      // camera counts.
      id: "communes-count",
      type: "fill",
      source: "admin",
      "source-layer": "communes",
      minzoom: AREA_FADE[0],
      maxzoom: COUNT_MAX,
      paint: { "fill-opacity": 0 },
    },
    // --- streets -----------------------------------------------------------------------
    ...(stickers()
      ? [...punkFields(mode), ...streetLayers(mode), ...focusStreets(mode)]
      : [...streetLayers(mode), ...classicFields(mode), ...focusStreets(mode), ...fanLayers()]),
    // --- focus: the clicked camera's reach written on its outlines ---------------------
    {
      // Points set by focus.ts at each band's farthest vertex, where its reach is reached.
      id: "focus-labels",
      type: "symbol",
      source: "focus-points",
      minzoom: DETAIL_MIN,
      // Wide screens: identification only, every level while the field is hovered; phones:
      // none (the sheet's ruler says it). Set by FilterPanel.apply.
      filter: ["==", ["get", "lv"], 3],
      layout: stickers()
        ? {
            // Punk: 17a's yellow tag cut as an arrow, its tip on the band's farthest vertex,
            // tilted -4°, its text in the typewriter face: an image per text (icons.ts
            // putTag). Beside the selected camera's sticker (the classique's label moves
            // around its point to avoid it; a tag points one way, so it stays put).
            visibility: "none",
            "icon-image": ["concat", TAG_PREFIX, reachLabel()],
            "icon-anchor": "left",
            "icon-rotate": TAG_ROTATE,
            "icon-rotation-alignment": "viewport",
            "icon-allow-overlap": true,
          }
        : {
            visibility: "none",
            "text-field": reachLabel(),
            "text-font": ["Noto Sans Medium"],
            "text-size": 12,
            "text-variable-anchor": ["left", "right", "top", "bottom"],
            "text-radial-offset": 0.5,
          },
      // The theme's label halo where it sets one (punk: the basemap's labels' too).
      paint: stickers()
        ? {}
        : {
            "text-color": p.label,
            "text-halo-color": p.halo,
            "text-halo-width": labelHaloWidth() ?? 1.6,
          },
    },
    // --- cameras -----------------------------------------------------------------------
    {
      // Invisible, larger target for clicks, and the hover highlight.
      id: "camera-hit",
      type: "circle",
      source: "detail",
      "source-layer": "cameras",
      minzoom: DETAIL_MIN,
      filter: STANDING,
      paint: {
        "circle-radius": CAMERA_HIT_RADIUS,
        "circle-color": p.picto,
        "circle-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.18, 0],
        "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0],
        "circle-stroke-color": p.picto,
      },
    },
    {
      id: "cameras",
      type: "symbol",
      source: "detail",
      "source-layer": "cameras",
      minzoom: DETAIL_MIN,
      layout: {
        "icon-image": stickers() ? stickerImage(null) : CAM_IMAGE,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 1, 20, 1.25],
      },
      filter: STANDING,
      paint: { "icon-color": pictoColour(null), ...pictoHalo() },
    },
    stickers()
      ? {
          // Punk: 20a's « peut-être disparue » without its hatching (DECISIONS 2026-10-06,
          // « Hatching keeps one meaning… »): a dashed ring around the sticker, a « ? »
          // hooked at its top right (stickers.ts maybeGone).
          id: "camera-gone",
          type: "symbol",
          source: "detail",
          "source-layer": "cameras",
          minzoom: DETAIL_MIN,
          filter: MAYBE_GONE as unknown as FilterSpecification,
          layout: {
            "icon-image": MARKS.maybeGone,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-offset": [1, -1],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 1, 20, 1.25],
          },
        }
      : {
          // "Maybe gone": a small grey badge at the pictogram's top right.
          id: "camera-gone",
          type: "circle",
          source: "detail",
          "source-layer": "cameras",
          minzoom: DETAIL_MIN,
          filter: MAYBE_GONE as unknown as FilterSpecification,
          paint: {
            "circle-radius": 4,
            "circle-color": p.gone,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": p.halo,
            "circle-translate": [11, -10],
          },
        },
    // --- focus: the selected camera above everything, 1.5 times larger, its white outline
    // a little softer. It takes part in symbol placement, so the reach labels (placed after
    // it) avoid it.
    {
      id: "camera-selected",
      type: "symbol",
      source: "detail",
      "source-layer": "cameras",
      minzoom: DETAIL_MIN,
      filter: selectedFilter(NO_CAMERA),
      layout: {
        "icon-image": stickers()
          ? sticker(["case", VERIFIED_GONE, "-gone-big", "-full-big"] as ExpressionSpecification)
          : CAM_IMAGE,
        "icon-allow-overlap": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 1.5, 20, 1.875],
      },
      paint: {
        "icon-color": pictoColour(null),
        "icon-halo-color": p.halo,
        "icon-halo-width": 2,
        "icon-halo-blur": 0.5,
      },
    },
  ] as LayerSpecification[];
}

/** Every street segment, grey, and what is filmed on it (the portions; punk: one pink stroke
 * whose intensity follows the level, without a casing). */
function streetLayers(mode: Mode): LayerSpecification[] {
  const p = palette();
  return [
    {
      // Every segment, grey, under what is filmed: axes from z14, sidewalks, crossings and
      // paths beside a road from z16 (tiles._edge_features).
      id: "streets",
      type: "line",
      source: "streets",
      "source-layer": "edges",
      minzoom: 14,
      paint: {
        "line-color": p.streetNone,
        "line-width": stickers() ? punkStreetWidth() : STREET_WIDTH,
        "line-opacity": STREETS_OPACITY,
      },
    },
    {
      // What is filmed, per hypothesis, in the colour of the highest level reached: the
      // filmed intervals of the axes at z12-14, the portions from z15.
      id: "portions",
      type: "line",
      source: "streets",
      "source-layer": "portions",
      minzoom: STREET_FADE[0],
      filter: portionFilter(mode.est),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": portionColour(),
        "line-width": stickers() ? punkStreetWidth() : PORTION_WIDTH,
        "line-opacity": portionOpacity(),
      },
    },
  ] as LayerSpecification[];
}

const STREET_WIDTH = [
  "interpolate",
  ["exponential", 1.6],
  ["zoom"],
  ...[14, 1, 16, 2.5, 19, 6],
] as ExpressionSpecification;

// The portions' width: thin from z16, where the fields are drawn (they must not double
// them). Punk: one stroke as wide as the first round's casing, the focused camera's streets
// alike (focusStreets); past z17 it widens with the map, as the street does (the author's
// Denfert capture at z18 – z19 in dark: a 4.5 px stroke of the dots' own pink, barely wider
// than the identify halftone's 2.8 px pitch, read as one more row of dots). Up to z17, as it
// was.
const PORTION_WIDTH = [
  "interpolate",
  ["linear"],
  ["zoom"],
  ...[12, 1.6, 14, 2.5, 15, 4, 16, 2, 19, 2.5],
] as ExpressionSpecification;
// Punk: PUNK_PORTION_WIDTH (streetwidth.ts), the floor of the width below.
// Punk since rules 3.1: the filmed, unfilmed and focused streets as wide as the basemap's
// road of their class, never narrower than the stroke above (streetwidth.ts; product
// owner, 2026-10-16: the unfilmed street no longer thinner). Built once.
let punkWidth: ExpressionSpecification | null = null;
const punkStreetWidth = () =>
  (punkWidth ??= streetWidth(flavourLayers("protomaps", namedFlavor("light")), PUNK_PORTION_WIDTH));

/** The classique's fields: nested bands of one hue at a low opacity, and the hatching of a
 * camera without a surveyed direction. */
function classicFields(mode: Mode): LayerSpecification[] {
  const p = palette();
  return [
    // --- street level: observation levels (DORI) x certainty ------------------------------
    // One hue. Bands are nested and stacked with a low opacity: the more levels and the
    // more certain bands cover a point, the darker it gets. Edges fade out by steps where
    // the reach is uncertain.
    {
      id: "bands",
      type: "fill",
      source: "detail",
      "source-layer": "bands",
      minzoom: DETAIL_MIN,
      filter: detailFilters(mode.est).bands as FilterSpecification,
      paint: {
        "fill-color": p.field,
        "fill-opacity": BANDS_OPACITY,
      },
    },
    // Hatching is reserved for "direction unknown", on the chosen estimate's band (the
    // classique; punk leaves no trace of it on the map: a camera without a surveyed
    // direction is drawn as a full circle like the others, DECISIONS 2026-10-08, « Unknown
    // direction leaves no trace… »).
    ...[
      {
        id: "bands-unknown-direction",
        type: "fill",
        source: "detail",
        "source-layer": "bands",
        minzoom: DETAIL_MIN,
        filter: detailFilters(mode.est)["bands-unknown-direction"] as FilterSpecification,
        paint: { "fill-pattern": "hatch-view", "fill-opacity": UNKNOWN_DIRECTION_OPACITY },
      } as LayerSpecification,
    ],
  ] as LayerSpecification[];
}

/** The focused camera's streets (z15+), above the portions. Punk: the portions' own stroke
 * (DECISIONS 2026-10-08, « The more vivid… »: filmed streets in one style, in focus or not),
 * whole while the rest is dimmed. */
function focusStreets(mode: Mode): LayerSpecification[] {
  const p = palette();
  if (stickers())
    return [
      {
        id: "focus-streets",
        type: "line",
        source: "streets",
        "source-layer": "portions",
        minzoom: DETAIL_MIN,
        filter: focusPortionFilter(NO_CAMERA, mode.est),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": levelColour(), "line-width": punkStreetWidth() },
      } as LayerSpecification,
    ];
  return [
    // Focus: the filmed portions (z15+) listing the clicked camera, for the chosen
    // estimate. A style filter on its id: it holds for every tile, also those loaded after
    // the map moved (the fit to the field).
    {
      id: "focus-streets-casing",
      type: "line",
      source: "streets",
      "source-layer": "portions",
      minzoom: DETAIL_MIN,
      filter: focusPortionFilter(NO_CAMERA, mode.est),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": p.halo,
        "line-width": ["interpolate", ["linear"], ["zoom"], 15, 5, 19, 6],
      },
    },
    {
      id: "focus-streets",
      type: "line",
      source: "streets",
      "source-layer": "portions",
      minzoom: DETAIL_MIN,
      filter: focusPortionFilter(NO_CAMERA, mode.est),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": p.focusStreet,
        "line-width": ["interpolate", ["linear"], ["zoom"], 15, 3, 19, 4],
      },
    },
  ] as LayerSpecification[];
}

/** The classique's outlines of the focused camera, every level of its chosen estimate. */
function fanLayers(): LayerSpecification[] {
  const p = palette();
  return [
    // The clicked camera's outlines for the chosen estimate only (its levels), marked;
    // the sheet's ruler gives the other estimate.
    {
      id: "bands-fan",
      type: "line",
      source: "detail",
      "source-layer": "bands",
      minzoom: DETAIL_MIN,
      filter: fanFilter(NO_CAMERA, 1),
      paint: {
        "line-color": p.fieldLine,
        "line-width": ["match", ["get", "lv"], 3, 2.6, 2, 2, 1.6],
      },
    },
  ] as LayerSpecification[];
}

/** Punk fields (DECISIONS 2026-10-08, « One palette… » and « The more vivid… »): each level
 * an opaque layer of its own pattern (stickers.ts fieldPattern, aligned on the map), drawn
 * détecte, reconnaît, identifie, so that the overlaps of one level give the same image and a
 * higher level covers a lower one: each point shows the highest level reached, never a sum
 * of cameras. Each level's outline (dotted, dashed, solid) under its own fill: only the
 * union's edge shows, its outer half (each camera's outline is hidden inside the union by
 * the fill above it: nothing can go between them). Above the three levels the water, see
 * through (stacked, waterOver): the outlines under it too. In focus those take one dimmed
 * colour (fieldPaint); above them and the water the focused camera's whole zone, its three
 * levels drawn the same way (`focus-zone-*`), then its chosen level on top, its outline
 * thicker (`bands-fan`, `focus-field`; filters and dash set by filters.ts). Under them
 * `bands`, never drawn: the fields of the chosen estimate for a query or a hover, as in the
 * classique (main.ts, the smoke tests). Buildings go above all of them (stacked). */
function punkFields(mode: Mode): LayerSpecification[] {
  const level = (lv: Level): FilterSpecification => [
    "all",
    ["==", ["get", "lv"], lv],
    ["==", ["get", "b"], mode.est],
  ];
  const none = focusFieldFilter(NO_CAMERA, mode.est, DEFAULT_LEVEL);
  return [
    {
      id: "bands",
      type: "fill",
      source: "detail",
      "source-layer": "bands",
      minzoom: DETAIL_MIN,
      filter: detailFilters(mode.est).bands as FilterSpecification,
      paint: { "fill-opacity": 0 },
    } as LayerSpecification,
    ...FIELD_LEVELS.flatMap((lv) => [
      fieldLine(lv, `field-${lv}-line`, level(lv)),
      fieldFill(lv, `field-${lv}`, level(lv)),
    ]),
    ...FIELD_LEVELS.flatMap((lv) => {
      const zone = focusFieldFilter(NO_CAMERA, mode.est, lv);
      return [
        fieldLine(lv, `${FOCUS_ZONE}-${lv}-line`, zone),
        fieldFill(lv, `${FOCUS_ZONE}-${lv}`, zone),
      ];
    }),
    fieldLine(DEFAULT_LEVEL, "bands-fan", none, CHOSEN_LINE),
    fieldFill(DEFAULT_LEVEL, FOCUS_FIELD, none),
  ];
}

/** A level's outline: a line centred on the edge, its inner half under the fill. */
function fieldLine(
  lv: Level,
  id: string,
  filter: FilterSpecification,
  width: ExpressionSpecification = FIELD_LINE,
): LayerSpecification {
  const dash = FIELD_DASH[lv];
  return {
    id,
    type: "line",
    source: "detail",
    "source-layer": "bands",
    minzoom: DETAIL_MIN,
    filter,
    layout: { "line-join": "round", "line-cap": dash?.[0] === 0 ? "round" : "butt" },
    paint: {
      "line-color": palette().fieldLine,
      "line-width": width,
      "line-opacity": FIELD_OPACITY,
      ...(dash ? { "line-dasharray": ["literal", dash] } : {}),
    },
  } as LayerSpecification;
}

/** A level's fill: its opaque pattern. */
function fieldFill(lv: Level, id: string, filter: FilterSpecification): LayerSpecification {
  return {
    id,
    type: "fill",
    source: "detail",
    "source-layer": "bands",
    minzoom: DETAIL_MIN,
    filter,
    paint: { "fill-pattern": MARKS.fields[lv - 1], "fill-opacity": FIELD_OPACITY },
  } as LayerSpecification;
}

/** The outline's width: twice what shows (its inner half lies under the fill). */
const FIELD_LINE: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 15, 3, 19, 4];
/** The chosen level's outline in focus: half as wide again as the others'. */
const CHOSEN_LINE: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 15, 5, 19, 6];
/** The outline's dash per level, in line widths: dotted (round caps), dashed, solid
 * (stickers.ts FIELD_DASH draws the legend's samples the same; tests/stickers.test.ts). */
export const FIELD_DASH: Record<Level, number[] | null> = { 1: [0, 2], 2: [3, 2], 3: null };
/** The level the focus shows first: identifie (DECISIONS 2026-10-08, « Punk focus… »). */
export const DEFAULT_LEVEL: Level = 3;
export const FOCUS_FIELD = "focus-field";
/** The focused camera's whole zone, one layer per level and its outline (punk):
 * `focus-zone-<lv>` and `focus-zone-<lv>-line`. */
export const FOCUS_ZONE = "focus-zone";
/** The focused camera's chosen level, for estimate `est` (punk). */
export const focusFieldFilter = (cameraId: number, est: number, lv: Level): FilterSpecification => [
  "all",
  ["==", ["get", "i"], cameraId],
  ["==", ["get", "b"], est],
  ["==", ["get", "lv"], lv],
];

/** Layers whose features are filtered by operator and type at the street level, with their
 * own base filter for the chosen estimate; cameras verified gone only with `showGone`. */
export function detailFilters(
  est: number,
  showGone = false,
): Record<string, FilterSpecification | null> {
  const cameras = showGone ? null : STANDING;
  return {
    bands: ["==", ["get", "b"], est],
    // Punk: each level's fill and outline; the classique: the hatching of an unknown
    // direction.
    ...(stickers()
      ? Object.fromEntries(
          FIELD_LEVELS.flatMap((lv) => {
            const f = ["all", ["==", ["get", "lv"], lv], ["==", ["get", "b"], est]];
            return [
              [`field-${lv}`, f],
              [`field-${lv}-line`, f],
            ];
          }),
        )
      : {
          "bands-unknown-direction": [
            "all",
            ["==", ["get", "c"], 0],
            ["==", ["get", "lv"], 1],
            ["==", ["get", "b"], est],
          ],
        }),
    "camera-hit": cameras,
    cameras,
    "camera-gone": ["all", MAYBE_GONE, STANDING] as unknown as FilterSpecification,
  } as Record<string, FilterSpecification | null>;
}

// --- the punk map's other marks (lot 3.1) -----------------------------------------------
/** 17a's level label, tilted -4°. */
const TAG_ROTATE = -4;

/** A proposal's tape (20a « correction en attente ») on its camera, in place of the
 * participation's badge (participate/proposals.ts draws it; main.ts hides it and the dot in
 * the punk interface). From the stickers' zoom only, never before (DECISIONS 2026-10-09,
 * « Pending proposals… »): a tape alone on a commune said nothing of what it corrects. An
 * add's ghost carries its tape in its image (stickers.ts). */
export const PROPOSAL_TAPE = "proposal-tape";
export function proposalTapeLayers(): LayerSpecification[] {
  return [
    {
      id: PROPOSAL_TAPE,
      type: "symbol",
      source: "proposals",
      minzoom: DETAIL_MIN,
      filter: ["!=", ["get", "k"], "add"],
      layout: {
        "icon-image": MARKS.tape,
        "icon-rotate": -28,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 1, 20, 1.25],
      },
    },
  ] as LayerSpecification[];
}

/** The proposals' tap targets and hover rings (punk), as the cameras' `camera-hit`: a pending
 * add's ghost from the street level (participate/proposals.ts `proposal-ghost`, its `a`).
 * Without it a pending add had no hover and a target as small as its image (the iPhone
 * test's « caméra anormale », 2026-10-09). main.ts adds it and answers it. */
export const PROPOSAL_HIT = "proposal-hit";
export function proposalHitLayers(): LayerSpecification[] {
  const p = palette();
  const ring = (radius: number) => ({
    "circle-radius": radius,
    "circle-color": p.picto,
    ...proposalHover(null),
    "circle-stroke-color": p.picto,
  });
  return [
    {
      id: PROPOSAL_HIT,
      type: "circle",
      source: "proposal-moves",
      minzoom: DETAIL_MIN,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "a"], 1]],
      paint: ring(22), // 44 px: what a finger touches
    },
  ] as LayerSpecification[];
}
/** The hover ring of the proposal whose camera id is `c` (null: none), as camera-hit's;
 * always an expression on the feature, so that a hover never changes the property's kind
 * (the sources are a few points: the change re-lays them out at once). */
export function proposalHover(c: string | null): Record<string, ExpressionSpecification> {
  const on: ExpressionSpecification = ["==", ["get", "c"], c ?? ""];
  return {
    "circle-opacity": ["case", on, 0.18, 0],
    "circle-stroke-width": ["case", on, 2, 0],
  };
}

/** A pending move's line (participate/proposals.ts `proposal-link`, from the camera to its
 * proposed place), punk: thicker, on a halo of the map's paper, so that it reads above the
 * fields it crosses (product owner, 2026-10-08). main.ts restyles the link and puts the halo
 * under it. */
export const PROPOSAL_LINK_HALO = "proposal-link-halo";
export const PROPOSAL_LINK_WIDTH = 3;
export const PROPOSAL_LINK_DASH = [1.5, 1.2];
export function proposalLinkHalo(): LayerSpecification {
  return {
    id: PROPOSAL_LINK_HALO,
    type: "line",
    source: "proposal-moves",
    minzoom: DETAIL_MIN,
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": palette().halo, "line-width": PROPOSAL_LINK_WIDTH + 4 },
  } as LayerSpecification;
}

export const NO_CAMERA = -1;
/** The camera in focus, by feature id (NO_CAMERA: none). */
export const selectedFilter = (cameraId: number): FilterSpecification => ["==", ["id"], cameraId];
export const fanFilter = (cameraId: number, b: number): FilterSpecification => [
  "all",
  ["==", ["get", "i"], cameraId],
  ["==", ["get", "b"], b],
];

/** Street segments filmed by a camera (its compact number `n`) with an estimate at least
 * as certain as `est` (bands are nested): `cs` lists ";t;" for each camera filming the
 * segment, t = base 36 of n * 3 + band. */
export function focusStreetFilter(cameraN: number, est: number): FilterSpecification {
  const cs: ExpressionSpecification = ["coalesce", ["get", "cs"], ""];
  const any = Array.from({ length: est + 1 }, (_, b) => [
    "in",
    `;${(cameraN * 3 + b).toString(36)};`,
    cs,
  ]);
  return ["any", ...any] as FilterSpecification;
}

/** Focus: the clicked camera's filmed portions for estimate `est`. */
export const focusPortionFilter = (cameraN: number, est: number): FilterSpecification =>
  ["all", ["==", ["get", "b"], est], focusStreetFilter(cameraN, est)] as FilterSpecification;
