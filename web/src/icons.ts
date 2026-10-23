// Camera pictograms drawn at startup. Everything surveillance-related uses ONE hue (the
// theme's, theme.ts palette()); the shape tells the camera type. The same drawing functions feed the map (addImage) and the
// filter panel samples, so both show identical pixels.
// The map and the sheets draw stickers (stickers.ts, mockup 16a), loaded at startup.

import type { ExpressionSpecification, Map as MlMap } from "maplibre-gl";
import { PAPER_EARTH } from "./basemap";
import type { ThemeInks } from "./stickers";
import { mode, palette, token } from "./theme";

export const KINDS = ["dome", "fixed", "ptz", "panorama", "alpr", "doorbell", "unknown"] as const;
export type Kind = (typeof KINDS)[number];

const RATIO = 2;
// Shapes fill ~80 % of their box: a 30 px box gives pictograms of at least 24 px.
const ICON_CSS_PX = 30;
const ICON = ICON_CSS_PX * RATIO;
const PAD = 8 * RATIO; // room for the white halo

type Draw = (c: CanvasRenderingContext2D, s: number) => void;

const shapes: Record<Kind, Draw> = {
  dome: (c, s) => {
    c.beginPath();
    c.arc(s / 2, s * 0.58, s * 0.36, Math.PI, 0);
    c.lineTo(s * 0.86, s * 0.7);
    c.lineTo(s * 0.14, s * 0.7);
    c.closePath();
  },
  fixed: (c, s) => {
    c.beginPath();
    c.rect(s * 0.12, s * 0.3, s * 0.62, s * 0.4);
    c.moveTo(s * 0.74, s * 0.38);
    c.lineTo(s * 0.9, s * 0.3);
    c.lineTo(s * 0.9, s * 0.7);
    c.lineTo(s * 0.74, s * 0.62);
    c.closePath();
  },
  ptz: (c, s) => {
    c.beginPath();
    c.moveTo(s / 2, s * 0.1);
    c.lineTo(s * 0.9, s / 2);
    c.lineTo(s / 2, s * 0.9);
    c.lineTo(s * 0.1, s / 2);
    c.closePath();
  },
  panorama: (c, s) => {
    c.beginPath();
    c.ellipse(s / 2, s / 2, s * 0.42, s * 0.24, 0, 0, 2 * Math.PI);
  },
  alpr: (c, s) => {
    c.beginPath();
    c.roundRect(s * 0.08, s * 0.28, s * 0.84, s * 0.44, s * 0.08);
  },
  doorbell: (c, s) => {
    c.beginPath();
    c.roundRect(s * 0.3, s * 0.1, s * 0.4, s * 0.8, s * 0.12);
  },
  unknown: (c, s) => {
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.36, 0, 2 * Math.PI);
  },
};

// Inner marks that keep shapes readable at a glance (plate, bell, "?").
const marks: Partial<Record<Kind, Draw>> = {
  alpr: (c, s) => c.fillRect(s * 0.2, s * 0.44, s * 0.6, s * 0.12),
  doorbell: (c, s) => {
    c.beginPath();
    c.arc(s / 2, s * 0.62, s * 0.09, 0, 2 * Math.PI);
    c.fill();
  },
  unknown: (c, s) => {
    c.font = `bold ${s * 0.46}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("?", s / 2, s * 0.53);
  },
};

function newCanvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return [el, ctx];
}

/** `#rrggbb` as rgba() at `alpha`. */
const rgba = (hex: string, alpha: number) =>
  `rgba(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(",")},${alpha})`;

// --- the punk interface's stickers (stickers.ts) -------------------------------------------
type Stickers = typeof import("./stickers");
let stickers: Stickers | null = null;

/** The stickers, fetched at startup beside the tokens, before the map asks for them
 * (main.ts). */
export async function loadStickers(): Promise<void> {
  stickers = await import("./stickers");
}

/** The punk map's other marks (lot 3.1; stickers.ts draws them): the fields' halftone, the
 * level's yellow label, the « maybe gone » ring, a proposal's tape (on its camera, and below
 * the street level on a paper disc). */
export const MARKS = {
  maybeGone: "punk-maybe-gone",
  tape: "punk-tape",
  pending: "punk-pending",
  paper: PAPER_EARTH,
  /** The fields' patterns by level, detect, recognise, identify (stickers.ts fieldPattern). */
  fields: ["punk-field-1", "punk-field-2", "punk-field-3"] as [string, string, string],
  /** The other fields while a camera is in focus (stickers.ts dimFieldPattern). */
  fieldDim: "punk-field-dim",
};
/** The level's label (17a « identification ~6 m »): its image is `punk-tag:<text>`. */
export const TAG_PREFIX = "punk-tag:";
const TAG_FONT = '400 13px "Special Elite", "Courier New", Courier, monospace';
const tags = new Set<string>();

/** The inks of the punk map's marks, from the tokens (both modes: theme/punk/tokens.css). */
function markInks() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => token(style, name);
  const p = palette();
  return {
    field: p.field,
    halo: p.halo,
    ink: p.ink,
    tag: v("map-tag"),
    tagInk: v("map-tag-ink"),
    tape: v("map-tape"),
    dots: v("map-dots"),
    paper: v("map-paper-dots"),
    earth: v("basemap-earth"),
    fields: [v("map-field-1"), v("map-field-2"), v("map-field-3")] as [string, string, string],
    fieldLine: p.fieldLine,
    fieldDim: v("map-field-dim"),
    ring: v("map-maybe-ring"),
    disc: v("map-maybe-disc"),
    mark: v("map-maybe-mark"),
  };
}

/** One level label's image, drawn (or drawn again: its width may change with the face). */
function putTag(map: MlMap, s: Stickers, id: string): void {
  const ratio = RATIO * 1.5;
  const image = s.tagLabel(ratio, markInks(), id.slice(TAG_PREFIX.length), TAG_FONT);
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, image, { pixelRatio: ratio });
  tags.add(id);
}

/** A sticker image's name on the map: `sticker-<kind>-<state>`, the selected camera's drawn
 * larger (`-big`); layers.ts asks for them by icon-image, one image per state since
 * icon-color does not apply to plain images. */
export const stickerName = (kind: string, state: "full" | "dim" | "gone", big = false) =>
  `sticker-${kind}-${state}${big ? "-big" : ""}`;

let inks: { mode: string; theme: ThemeInks } | null = null;
/** The stickers' inks in the mode in force, read from the tokens once per mode. */
function themeInks(s: Stickers): ThemeInks {
  if (inks?.mode !== mode()) {
    const style = getComputedStyle(document.documentElement);
    inks = { mode: mode(), theme: s.themeInks((name) => token(style, name)) };
  }
  return inks.theme;
}

let stickerMap: MlMap | null = null;
/** The camera layer's image for the camera in focus (layers.ts pictoColour, punk only). */
export function pictoImage(image: ExpressionSpecification): void {
  stickerMap?.setLayoutProperty("cameras", "icon-image", image);
}

/** A camera pictogram with its halo, as a canvas (device pixels, ratio 2); grey for a
 * camera verified gone. The punk interface's sticker, the map's drawing, crossed out once
 * gone. */
export function cameraCanvas(kind: Kind, colour = palette().picto): HTMLCanvasElement {
  if (stickers) {
    const variant = colour === palette().gone ? "gone" : "full";
    return stickers.stickerCanvas(
      kind,
      stickers.variantInks(themeInks(stickers), variant),
      variant,
    );
  }
  const { halo } = palette();
  const size = ICON + 2 * PAD;
  const [el, c] = newCanvas(size);
  c.translate(PAD, PAD);
  shapes[kind](c, ICON);
  c.shadowColor = rgba(halo, 0.95);
  c.shadowBlur = PAD;
  c.lineJoin = "round";
  c.lineWidth = 4 * RATIO;
  c.strokeStyle = halo;
  c.stroke();
  c.shadowBlur = 0;
  c.fillStyle = colour;
  c.fill();
  c.fillStyle = halo;
  marks[kind]?.(c, ICON);
  return el;
}

/** Filled or hatched square used as a sample for filmed areas. */
export function areaCanvas(hatched: boolean, size = 16 * RATIO): HTMLCanvasElement {
  const p = palette();
  const [el, c] = newCanvas(size);
  if (hatched) paintHatch(c, size, p.hatchView);
  else {
    c.fillStyle = `${p.field}40`;
    c.fillRect(0, 0, size, size);
  }
  c.strokeStyle = p.fieldLine;
  c.lineWidth = RATIO;
  c.strokeRect(1, 1, size - 2, size - 2);
  return el;
}

/** Sample of an observation level: the same stacking of bands as on the map, as rings;
 * on the map's `ground` colour when given (else transparent). */
export function levelCanvas(
  level: 1 | 2 | 3,
  size = 16 * RATIO,
  ground?: string,
): HTMLCanvasElement {
  // Punk: the level's pattern and outline, as the map draws its fields (one level each).
  if (stickers) return stickers.fieldSample(RATIO, markInks(), level, size / RATIO, ground);
  const [el, c] = newCanvas(size);
  if (ground) {
    c.fillStyle = ground;
    c.fillRect(0, 0, size, size);
  }
  const alpha = { 1: 0.05, 2: 0.08, 3: 0.11 };
  // Five nested bands per level, and every lower level underneath.
  for (let lv = 1; lv <= level; lv++) {
    for (let b = 4; b >= 0; b--) {
      c.globalAlpha = alpha[lv as 1 | 2 | 3];
      c.fillStyle = palette().field;
      const r = (size / 2) * (0.55 + 0.09 * b);
      c.beginPath();
      c.arc(size / 2, size / 2, r, 0, 2 * Math.PI);
      c.fill();
    }
  }
  return el;
}

function paintHatch(c: CanvasRenderingContext2D, s: number, colour: string): void {
  c.strokeStyle = colour;
  c.lineWidth = 2;
  c.beginPath();
  for (let i = -s; i <= s; i += 8) {
    c.moveTo(i, s);
    c.lineTo(i + s, 0);
  }
  c.stroke();
}

function data(el: HTMLCanvasElement): ImageData {
  const ctx = el.getContext("2d") as CanvasRenderingContext2D;
  return ctx.getImageData(0, 0, el.width, el.height);
}

// --- map pictograms as signed distance fields ---------------------------------------
// One colour per image, set by the style (icon-color), with a white outline that follows
// the shape (icon-halo-*): a lighter colour, not an opacity, keeps overlapping pictograms
// even. The inner marks (plate, bell, "?") are holes, filled by the outline as the white
// marks of the panel's pictograms are.
//
// Encoding (MapLibre's symbol shader: the edge at alpha 0.75, one eighth of alpha per halo
// pixel): alpha = 1 - (d / SDF_RADIUS + 0.25), d the signed distance to the edge in image
// pixels (negative inside). SDF_RADIUS = 8 * RATIO makes a halo width in CSS pixels.
const SDF_RADIUS = 8 * RATIO;
const SDF_CUTOFF = 0.25;
const INF = 1e20;

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher), in place on `f` along a
 * row or column of `n` values starting at `offset` with `stride`. */
function edt1d(
  f: Float64Array,
  offset: number,
  stride: number,
  n: number,
  v: Int32Array,
  z: Float64Array,
  g: Float64Array,
): void {
  for (let q = 0; q < n; q++) g[q] = f[offset + q * stride];
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s: number;
    do {
      const r = v[k];
      s = (g[q] - g[r] + q * q - r * r) / (2 * q - 2 * r);
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    f[offset + q * stride] = (q - r) * (q - r) + g[r];
  }
}

/** Squared distance to the nearest zero cell, in place, over a w x h grid. */
function edt(grid: Float64Array, w: number, h: number): void {
  const n = Math.max(w, h);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const g = new Float64Array(n);
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, v, z, g);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, v, z, g);
}

/** The pictogram's shape as a mask (coverage 0..1), marks cut out. */
function cameraMask(kind: Kind): { a: Float64Array; size: number } {
  const size = ICON + 2 * PAD;
  const [, c] = newCanvas(size);
  c.translate(PAD, PAD);
  shapes[kind](c, ICON);
  c.fillStyle = "#000";
  c.fill();
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = "#000";
  marks[kind]?.(c, ICON);
  const img = c.getImageData(0, 0, size, size).data;
  const a = new Float64Array(size * size);
  for (let i = 0; i < a.length; i++) a[i] = img[i * 4 + 3] / 255;
  return { a, size };
}

/** The pictogram as a signed distance field (white, distance in alpha). */
export function cameraSdf(kind: Kind): ImageData {
  const { a, size } = cameraMask(kind);
  const n = size * size;
  // Anti-aliased coverage places the edge inside a pixel (as tiny-sdf does).
  const outer = new Float64Array(n);
  const inner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = a[i];
    outer[i] = v === 1 ? 0 : v === 0 ? INF : Math.max(0, 0.5 - v) ** 2;
    inner[i] = v === 1 ? INF : v === 0 ? 0 : Math.max(0, v - 0.5) ** 2;
  }
  edt(outer, size, size);
  edt(inner, size, size);
  const out = new ImageData(size, size);
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
    const alpha = 255 - 255 * (d / SDF_RADIUS + SDF_CUTOFF);
    out.data[i * 4] = 255;
    out.data[i * 4 + 1] = 255;
    out.data[i * 4 + 2] = 255;
    out.data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(alpha)));
  }
  return out;
}

/** The map's pictograms and hatches; in the punk interface its stickers, drawn again in the
 * new colours on a change of mode (main.ts restyle). */
export function addImages(map: MlMap): void {
  const s = stickers;
  if (s) {
    s.addStickers(map, {
      kinds: KINDS,
      ratio: RATIO,
      inks: () => themeInks(s),
      name: stickerName,
      // A proposal's ghost: participate/proposals.ts asks for `cam-<kind>` and colours it as
      // an SDF (ghostPicto), which a plain image ignores; in the punk interface that name is
      // the ghost sticker, 20a's tape across it (lot 3.1), and no other layer asks for it
      // (layers.ts draws `sticker-*`).
      ghost: (kind) => `cam-${kind}`,
      marks: markInks,
      markNames: MARKS,
    });
    if (stickerMap !== map) {
      // The level's labels, one image per text, drawn when the map asks for one (MapLibre
      // 6's resolver: maplibre-gl.d.ts, setMissingStyleImageResolver); again once the punk
      // fonts are in (their face, their width).
      map.setMissingStyleImageResolver((id) => {
        if (id.startsWith(TAG_PREFIX)) putTag(map, s, id);
      });
      void document.fonts.ready.then(() => {
        document.fonts.addEventListener("loadingdone", () => {
          for (const id of tags) putTag(map, s, id);
        });
      });
    }
    stickerMap = map;
  } else
    for (const kind of KINDS) {
      if (map.hasImage(`cam-${kind}`)) continue;
      map.addImage(`cam-${kind}`, cameraSdf(kind), { pixelRatio: RATIO, sdf: true });
    }
  addHatches(map);
}

/** Hatch patterns: unknown direction (surveillance hue), no mapped camera (grey); drawn
 * again with the new colours when the theme's mode changes. */
export function addHatches(map: MlMap): void {
  const p = palette();
  const hatch = (name: string, colour: string) => {
    const [el, ctx] = newCanvas(16);
    paintHatch(ctx, 16, colour);
    if (map.hasImage(name)) map.updateImage(name, data(el));
    else map.addImage(name, data(el), { pixelRatio: RATIO });
  };
  hatch("hatch-view", p.hatchView);
  hatch("hatch-none", p.hatchNone);
}
