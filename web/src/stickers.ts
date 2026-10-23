// The punk interface's camera stickers (redesign "Carte punk", mockup 16a, the product
// owner's drawing): one silhouette per camera type in the body's ink, cut out of the map's
// paper by a thick outline, with an offset shadow and an eye whose iris is the field's pink.
// Several colours, so plain images, not signed distance fields: one set per mode, drawn
// again when the mode changes. Loaded by the punk interface only (icons.loadStickers). No
// runtime import: icons.ts hands over what the map needs (names, inks), so that this chunk
// moves no shared module (Vite would split them off), and web/tests/stickers.test.ts reads
// it in node.
import type { Map as MlMap } from "maplibre-gl";
import type { Kind } from "./icons";

/** full: the map's camera; dim: the others while one is in focus (16a's « version
 * atténuée »); gone: verified gone (no pink, crossed eyes); ghost: a proposal's camera. */
export type Variant = "full" | "dim" | "gone" | "ghost";
export type Inks = {
  body: string;
  outline: string;
  shadow: string;
  /** The eye's iris and the other pink marks (LEDs, bell, « ? »). */
  iris: string;
  /** The eye's white and its ring and pupil. */
  eye: string;
  pupil: string;
};
/** The theme's inks: a full sticker's, and the grey of a camera verified gone. */
export type ThemeInks = Inks & { gone: string };

// --- colours -----------------------------------------------------------------------------

/** A hex colour as #rrggbb, lower case (the build's minifier writes #111111 as #111). */
export function hex(colour: string): string {
  const c = colour.trim().toLowerCase();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(c))
    throw new Error(`stickers: not a colour (${colour})`);
  return c.length === 4 ? `#${[...c.slice(1)].map((d) => d + d).join("")}` : c;
}

const rgb = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));

/** `a` blended toward `b` by `t` (0: a, 1: b), opaque. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v * (1 - t) + y[i] * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Relative luminance (WCAG 2.x). */
export function luminance(colour: string): number {
  const [r, g, b] = rgb(colour).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The colour of a CSS shadow ("2px 2px 0 #7fd4ff"): its last hex colour. */
function shadowColour(shadow: string): string {
  const found = shadow.match(/#[0-9a-f]{3,6}\b/gi);
  if (!found) throw new Error(`stickers: no colour in the shadow (${shadow})`);
  return hex(found[found.length - 1]);
}

/** The inks from the theme's tokens, `v` reading one by name (without "--") as the CSS
 * writes it: the body is the map's pictogram colour (--map-picto: ink in light, cream in
 * dark), the outline the map's paper (--map-halo), the offset shadow the theme's own
 * (--shadow-small: sky in light, pink in dark), the iris the field's pink (--map-field),
 * a camera verified gone in --map-gone. The eye is printed in the lighter and the darker of
 * body and outline (16a: white and black in both modes; cream and ink here). */
export function themeInks(v: (name: string) => string): ThemeInks {
  const body = hex(v("map-picto"));
  const outline = hex(v("map-halo"));
  const [eye, pupil] = luminance(body) > luminance(outline) ? [body, outline] : [outline, body];
  return {
    body,
    outline,
    shadow: shadowColour(v("shadow-small")),
    iris: hex(v("map-field")),
    eye,
    pupil,
    gone: hex(v("map-gone")),
  };
}

// 16a's « version atténuée »: the body half-way to the outline, shadow and iris a little
// less. A proposal's ghost keeps today's 0.4 (theme.ts GHOST_PICTO): every ink at 40 % over
// the outline.
const DIM_BODY = 0.5;
const DIM_MARKS = 0.45;
const GHOST = 0.4;
const GONE_SHADOW = 0.6;

/** The inks of one variant. */
export function variantInks(t: ThemeInks, variant: Variant): Inks {
  const { body, outline, shadow, iris, eye, pupil } = t;
  switch (variant) {
    case "full":
      return { body, outline, shadow, iris, eye, pupil };
    case "dim":
      return {
        body: mix(body, outline, DIM_BODY),
        outline,
        shadow: mix(shadow, outline, DIM_MARKS),
        iris: mix(iris, outline, DIM_MARKS),
        eye,
        pupil,
      };
    case "ghost": {
      const pale = (c: string) => mix(c, outline, 1 - GHOST);
      return {
        body: pale(body),
        outline,
        shadow: pale(shadow),
        iris: pale(iris),
        eye: pale(eye),
        pupil: pale(pupil),
      };
    }
    case "gone":
      // No pink left: the marks take the eye's white, the eyes are crossed out (drawn).
      return {
        body: t.gone,
        outline,
        shadow: mix(shadow, outline, GONE_SHADOW),
        iris: eye,
        eye,
        pupil,
      };
  }
}

// --- drawings ----------------------------------------------------------------------------
// In units of a 60-unit box (30 CSS px on the map, icons.ts ICON_CSS_PX, 2 device pixels a
// unit) with 16 units of margin: the canvas of icons.ts cameraCanvas, 92 units square.

export const ICON = 60;
export const PAD = 16;
export const BOX = ICON + 2 * PAD;
/** The outline's width (half of it outside the silhouette) and the shadow's offset. */
const OUTLINE = 7;
const SHADOW = 3;

type Ctx = CanvasRenderingContext2D;
type Sticker = {
  /** The silhouette, as one path of several shapes (filled nonzero). */
  body: (c: Ctx) => void;
  /** The eye: centre and radius. */
  eye?: [number, number, number];
  /** Half-closed: a lid of the body's ink over its upper half (dome, multi-dome). */
  lid?: boolean;
  /** Smaller eyes beside the main one, open (the multi-dome's other domes). */
  more?: [number, number, number][];
  /** The globe's equator (PTZ). */
  band?: boolean;
  plate?: boolean;
  bell?: boolean;
  leds?: boolean;
  /** A big « ? » instead of an eye (type unknown). */
  question?: boolean;
};

const TAU = 2 * Math.PI;
const FIXED_TILT = 0.32;
const FIXED_AT: [number, number] = [27, 25];

function star(c: Ctx, cx: number, cy: number, n: number, outer: number, inner: number, a0: number) {
  c.beginPath();
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 ? inner : outer;
    const a = a0 + (i * Math.PI) / n;
    c.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  c.closePath();
}

/** A tube on its side with its sun visor, from `y` (ALPR). */
function tube(c: Ctx, y: number) {
  c.roundRect(6, y, 38, 20, 5);
  c.roundRect(42, y - 3, 12, 26, 3);
}

const STICKERS: Record<Kind, Sticker> = {
  // An eleven-point star, a big « ? » on it.
  unknown: { body: (c) => star(c, 30, 30, 11, 23, 16.5, -0.2), question: true },
  // A flat half-disc under its ceiling plate, the eye half-closed.
  dome: {
    body: (c) => {
      c.beginPath();
      c.roundRect(4, 9, 52, 9, 3);
      c.moveTo(51, 18);
      c.arc(30, 18, 21, 0, Math.PI);
      c.closePath();
    },
    eye: [30, 28, 9],
    lid: true,
  },
  // The multi-dome (DECISIONS 2026-10-23, no board: a new category): the dome's vocabulary
  // three times, a bigger dome between two small ones under one housing bar, hung from the
  // ceiling plate by a short rod; the middle eye half-closed as the dome's, the small domes'
  // eyes open and looking down.
  multidome: {
    body: (c) => {
      c.beginPath();
      c.roundRect(20, 5, 20, 6, 3);
      c.rect(27, 10, 6, 8);
      c.roundRect(5, 17, 50, 8, 3);
      // Each dome a half-disc under the bar, apart from the next (the outline's notch
      // between them still shows at the map's size).
      for (const [x, y, r] of [
        [12, 25, 8.5],
        [30, 25, 11.5],
        [48, 25, 8.5],
      ]) {
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, Math.PI);
      }
    },
    eye: [30, 30, 7.5],
    lid: true,
    more: [
      [12, 29, 4.5],
      [48, 29, 4.5],
    ],
  },
  // The box tilted down on its wall arm, its visor above, the eye at the lens.
  fixed: {
    body: (c) => {
      c.beginPath();
      c.roundRect(2, 20, 7, 26, 2);
      c.roundRect(8, 34, 14, 6, 2);
      c.save();
      c.translate(...FIXED_AT);
      c.rotate(FIXED_TILT);
      c.roundRect(-17, -9, 34, 19, 4);
      c.roundRect(-19, -15, 44, 7, 2);
      c.restore();
    },
    eye: [
      FIXED_AT[0] + 16 * Math.cos(FIXED_TILT) - Math.sin(FIXED_TILT),
      FIXED_AT[1] + 16 * Math.sin(FIXED_TILT) + Math.cos(FIXED_TILT),
      7.5,
    ],
  },
  // A full globe hanging from a short rod under its plate (a ball at the end of a pipe,
  // DECISIONS 2026-10-05; 16a shows no wall arm).
  ptz: {
    body: (c) => {
      c.beginPath();
      c.roundRect(17, 1, 26, 7, 3);
      c.rect(26.5, 7, 7, 10);
      c.moveTo(48, 36);
      c.arc(30, 36, 18, 0, TAU);
    },
    eye: [24, 38, 8.5],
    band: true,
  },
  // The earlier stickers (mockup 2a), in the same style.
  panorama: {
    body: (c) => {
      c.beginPath();
      c.arc(30, 30, 22, 0, TAU);
    },
    eye: [30, 30, 14],
    leds: true,
  },
  alpr: {
    body: (c) => {
      c.beginPath();
      tube(c, 8);
      c.roundRect(12, 35, 36, 16, 3);
    },
    eye: [25, 18, 7.5],
    plate: true,
  },
  doorbell: {
    body: (c) => {
      c.beginPath();
      c.roundRect(18, 4, 24, 52, 10);
    },
    eye: [30, 18, 7.5],
    bell: true,
  },
};

function disc(c: Ctx, x: number, y: number, r: number, fill: string) {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = fill;
  c.fill();
}

/** The eye: its white ringed in ink, the pink iris and the pupil looking down-right, a
 * highlight; crossed out for a camera verified gone. */
function eye(c: Ctx, [x, y, r]: [number, number, number], ink: Inks, crossed: boolean) {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = ink.eye;
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = ink.pupil;
  c.stroke();
  if (crossed) {
    const d = r * 0.42;
    c.beginPath();
    c.moveTo(x - d, y - d);
    c.lineTo(x + d, y + d);
    c.moveTo(x + d, y - d);
    c.lineTo(x - d, y + d);
    c.lineWidth = Math.max(2, r * 0.3);
    c.stroke();
    return;
  }
  disc(c, x + r * 0.15, y + r * 0.12, r * 0.6, ink.iris);
  disc(c, x + r * 0.2, y + r * 0.17, r * 0.3, ink.pupil);
  disc(c, x - r * 0.12, y - r * 0.22, r * 0.17, ink.eye);
}

/** A mark drawn in the outline's colour first, then in its own: it stands on any body. */
function ringed(
  c: Ctx,
  path: () => void,
  width: number,
  ring: number,
  ink: string,
  outline: string,
) {
  path();
  c.lineWidth = width + 2 * ring;
  c.strokeStyle = outline;
  c.stroke();
  path();
  c.lineWidth = width;
  c.strokeStyle = ink;
  c.stroke();
}

/** The big « ? » of a camera of unknown type, a little tilted, as a path (no font: the punk
 * fonts load after the first display, theme/fonts.ts); a big « × » once verified gone. */
function question(c: Ctx, ink: Inks, crossed: boolean) {
  c.save();
  c.translate(30, 31);
  c.rotate(0.12);
  if (crossed) {
    ringed(
      c,
      () => {
        c.beginPath();
        c.moveTo(-8, -8);
        c.lineTo(8, 8);
        c.moveTo(8, -8);
        c.lineTo(-8, 8);
      },
      6,
      2.5,
      ink.iris,
      ink.outline,
    );
    c.restore();
    return;
  }
  const hook = () => {
    c.beginPath();
    c.arc(0, -6.5, 6.5, Math.PI * 0.92, Math.PI * 2.4);
    c.lineTo(0, 3.5);
  };
  ringed(c, hook, 6.5, 2.5, ink.iris, ink.outline);
  disc(c, 0, 11.5, 3.5 + 2.5, ink.outline);
  disc(c, 0, 11.5, 3.5, ink.iris);
  c.restore();
}

/** 20a's piece of tape (« correction en attente »): a 68 x 20 unit strip, its ends torn
 * (the mockup's clip-path), centred on the origin, turned by `angle` (radians). */
export function paintTape(c: Ctx, colour: string, angle: number, w = 68, h = 20): void {
  c.save();
  c.rotate(angle);
  c.translate(-w / 2, -h / 2);
  c.beginPath();
  c.moveTo(0.04 * w, 0);
  c.lineTo(0.96 * w, 0.1 * h);
  c.lineTo(w, 0.9 * h);
  c.lineTo(0, h);
  c.lineTo(0.02 * w, 0.45 * h);
  c.closePath();
  c.globalAlpha = 0.88;
  c.fillStyle = colour;
  c.fill();
  c.globalAlpha = 0.08;
  c.lineWidth = 2;
  c.strokeStyle = "#000000";
  c.stroke();
  c.restore();
}

/** Draw one sticker into `c`, its 60-unit box at the origin; a proposal's ghost carries
 * 20a's tape across it (`tape`: its colour). */
export function paintSticker(c: Ctx, kind: Kind, ink: Inks, variant: Variant, tape?: string): void {
  paintBody(c, kind, ink, variant);
  if (variant === "ghost" && tape) {
    c.save();
    c.translate(30, 30);
    paintTape(c, tape, -0.47);
    c.restore();
  }
}

function paintBody(c: Ctx, kind: Kind, ink: Inks, variant: Variant): void {
  const s = STICKERS[kind];
  const crossed = variant === "gone";
  c.lineJoin = "round";
  c.lineCap = "round";
  // The shadow: the same silhouette, offset down-right.
  c.save();
  c.translate(SHADOW, SHADOW);
  s.body(c);
  c.lineWidth = OUTLINE;
  c.strokeStyle = ink.shadow;
  c.stroke();
  c.fillStyle = ink.shadow;
  c.fill();
  c.restore();
  // The silhouette cut out of the paper.
  s.body(c);
  c.lineWidth = OUTLINE;
  c.strokeStyle = ink.outline;
  c.stroke();
  c.fillStyle = ink.body;
  c.fill();
  if (s.plate) {
    c.beginPath();
    c.roundRect(15, 38, 30, 10, 2);
    c.fillStyle = ink.eye;
    c.fill();
    c.fillStyle = ink.pupil;
    for (const [x, w] of [
      [18, 4],
      [24, 4],
      [30, 4],
      [36, 6],
    ])
      c.fillRect(x, 41, w, 4);
  }
  if (s.bell) {
    c.beginPath();
    c.arc(30, 41, 6, 0, TAU);
    c.fillStyle = ink.iris;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = ink.outline;
    c.stroke();
  }
  if (s.leds)
    for (const a of [0.25, 0.75, 1.25, 1.75])
      disc(c, 30 + 18 * Math.cos(a * Math.PI), 30 + 18 * Math.sin(a * Math.PI), 1.8, ink.iris);
  if (s.band) {
    c.beginPath();
    c.arc(30, 36, 18, 0.15 * Math.PI, 0.85 * Math.PI);
    c.lineWidth = 2;
    c.strokeStyle = ink.outline;
    c.stroke();
  }
  for (const small of s.more ?? []) eye(c, small, ink, crossed);
  if (s.eye) eye(c, s.eye, ink, crossed);
  if (s.lid && s.eye && !crossed) {
    const [x, y, r] = s.eye;
    // A little wider than the eye's ring (r + 1), or its anti-aliased edge shows above.
    c.beginPath();
    c.arc(x, y, r + 2, Math.PI, 0);
    c.closePath();
    c.fillStyle = ink.body;
    c.fill();
    // The lash line, in the outline's colour across the lid's edge.
    c.beginPath();
    c.moveTo(x - r - 2, y + 0.5);
    c.lineTo(x + r + 2, y - 1.5);
    c.lineWidth = 2.5;
    c.strokeStyle = ink.outline;
    c.stroke();
  }
  if (s.question) question(c, ink, crossed);
}

/** A sticker on a canvas of BOX units at `scale` device pixels a unit (2 device pixels a
 * CSS pixel at scale 1, as icons.ts cameraCanvas). */
export function stickerCanvas(
  kind: Kind,
  ink: Inks,
  variant: Variant,
  scale = 1,
  tape?: string,
): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.width = el.height = Math.round(BOX * scale);
  const c = el.getContext("2d");
  if (!c) throw new Error("no 2d context");
  c.scale(scale, scale);
  c.translate(PAD, PAD);
  paintSticker(c, kind, ink, variant, tape);
  return el;
}

// --- the punk map's other marks (lot 3.1) ------------------------------------------------
// Drawn in CSS pixels times `ratio` (icons.ts RATIO), from the tokens icons.ts reads.

/** The inks of the map's marks: the fields' pink (--map-field), the level's label
 * (--map-tag, --map-tag-ink), the tape (--map-tape), the « maybe gone » ring and its
 * « ? » (--map-maybe-*), the map's paper (--map-halo). */
export type MarkInks = {
  field: string;
  /** The fields' halftone (--map-dots) and the map paper's dot screen (--map-paper-dots). */
  dots: string;
  paper: string;
  /** The basemap's earth (--basemap-earth), under the paper's dots. */
  earth: string;
  /** The fields' grounds, detect, recognise, identify (--map-field-1..3), and their
   * outline (--map-field-line). */
  fields: [string, string, string];
  fieldLine: string;
  /** The other fields while a camera is in focus: one opaque dimmed colour (--map-field-dim). */
  fieldDim: string;
  tag: string;
  tagInk: string;
  tape: string;
  ring: string;
  disc: string;
  mark: string;
  halo: string;
};

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const el = document.createElement("canvas");
  el.width = Math.round(w);
  el.height = Math.round(h);
  const c = el.getContext("2d");
  if (!c) throw new Error("no 2d context");
  return [el, c];
}

const pixels = (el: HTMLCanvasElement) =>
  (el.getContext("2d") as Ctx).getImageData(0, 0, el.width, el.height);

// --- the fields by level (DECISIONS 2026-10-08, « One palette… ») ------------------------
// Each level an opaque pattern, aligned on the map (MapLibre places a fill-pattern by the
// tile's position in the world: maplibre-gl src/webgl/program/pattern.ts, u_pixel_coord_*),
// so that two fields of one level overlapping draw the very same pixels, and a higher
// level, drawn after, covers a lower one: what shows at each point is the highest level
// reached, never a sum. The levels differ by shape too: the halftone's density (the
// densest identifies) and the outline (layers.ts: dotted, dashed, solid).
/** The pattern's tile in CSS px: a power of two (the style specification: « for seamless
 * patterns, image width and height must be a factor of two »). */
export const FIELD_TILE = 8;
/** The dots of one tile per level, [x, y, radius] in CSS px: 20a's fine, close halftone (a
 * dot of about 2 CSS px every 5) rather than big sparse dots (« tissu à pois », product
 * owner, 2026-10-08), closer from detect to identify: two dots a tile on a diagonal (5.7 px
 * apart), four on a square (4 px), eight in quincunx (2.8 px). */
const FIELD_DOTS: Record<1 | 2 | 3, [number, number, number][]> = {
  1: [
    [2, 2, 0.85],
    [6, 6, 0.85],
  ],
  2: [
    [2, 2, 0.95],
    [6, 2, 0.95],
    [2, 6, 0.95],
    [6, 6, 0.95],
  ],
  3: [
    [1, 1, 0.95],
    [5, 1, 0.95],
    [3, 3, 0.95],
    [7, 3, 0.95],
    [1, 5, 0.95],
    [5, 5, 0.95],
    [3, 7, 0.95],
    [7, 7, 0.95],
  ],
};

function paintField(c: Ctx, lv: 1 | 2 | 3, ratio: number, ink: MarkInks, w: number, h: number) {
  c.fillStyle = ink.fields[lv - 1];
  c.fillRect(0, 0, w, h);
  const tile = FIELD_TILE * ratio;
  for (let y = 0; y < h; y += tile)
    for (let x = 0; x < w; x += tile)
      for (const [dx, dy, r] of FIELD_DOTS[lv])
        disc(c, x + dx * ratio, y + dy * ratio, r * ratio, ink.dots);
}

/** A level's pattern: its ground, opaque, and its dots. */
export function fieldPattern(ratio: number, ink: MarkInks, lv: 1 | 2 | 3): ImageData {
  const [el, c] = canvas(FIELD_TILE * ratio, FIELD_TILE * ratio);
  paintField(c, lv, ratio, ink, el.width, el.height);
  return pixels(el);
}

/** The other fields' pattern while a camera is in focus: one opaque dimmed colour, the same
 * for every level (no transparency that adds up where fields overlap). */
export function dimFieldPattern(ratio: number, ink: MarkInks): ImageData {
  const [el, c] = canvas(FIELD_TILE * ratio, FIELD_TILE * ratio);
  c.fillStyle = ink.fieldDim;
  c.fillRect(0, 0, el.width, el.height);
  return pixels(el);
}

/** The outline's dash per level, in line widths (layers.ts line-dasharray): dotted with
 * round caps, dashed, solid. */
export const FIELD_DASH: Record<1 | 2 | 3, number[] | null> = { 1: [0, 2], 2: [3, 2], 3: null };

/** The legend's sample of a level, as the map draws it: a disc of its pattern edged by its
 * outline (CSS `size` px, drawn at `ratio`), on `ground` when given. */
export function fieldSample(
  ratio: number,
  ink: MarkInks,
  lv: 1 | 2 | 3,
  size: number,
  ground?: string,
): HTMLCanvasElement {
  const s = size * ratio;
  const [el, c] = canvas(s, s);
  if (ground) {
    c.fillStyle = ground;
    c.fillRect(0, 0, s, s);
  }
  const line = 1.5 * ratio;
  const r = s / 2 - line - ratio;
  c.save();
  c.beginPath();
  c.arc(s / 2, s / 2, r, 0, TAU);
  c.clip();
  paintField(c, lv, ratio, ink, s, s);
  c.restore();
  c.beginPath();
  c.arc(s / 2, s / 2, r + line / 2, 0, TAU);
  c.strokeStyle = ink.fieldLine;
  c.lineWidth = line;
  const dash = FIELD_DASH[lv];
  c.lineCap = dash && dash[0] === 0 ? "round" : "butt";
  c.setLineDash(dash ? dash.map((d) => d * line + (d === 0 ? 0.01 : 0)) : []);
  c.stroke();
  return el;
}

/** 20a's dot screen on the map's earth (its paper): a light blue dot (1 CSS px, its edge
 * faded to 1.5) per 5 CSS px tile, as the machine's paper draws it in CSS. */
export function paperDots(ratio: number, ink: MarkInks): ImageData {
  const [el, c] = canvas(5 * ratio, 5 * ratio);
  // Opaque: the earth's own colour under the dot (the pattern fills the basemap's earth).
  c.fillStyle = ink.earth;
  c.fillRect(0, 0, 5 * ratio, 5 * ratio);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 1.5 * ratio);
  g.addColorStop(0, ink.paper);
  g.addColorStop(2 / 3, ink.paper);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  c.fillStyle = g;
  // At the tile's centre, as a CSS radial gradient puts it.
  c.translate(2.5 * ratio, 2.5 * ratio);
  c.fillRect(-1.5 * ratio, -1.5 * ratio, 3 * ratio, 3 * ratio);
  return pixels(el);
}

/** A « ? » as a path (the punk fonts load after the first display), `h` tall. */
function qmark(c: Ctx, x: number, y: number, h: number, colour: string) {
  const r = h * 0.22;
  c.save();
  c.translate(x, y);
  c.beginPath();
  c.arc(0, -h * 0.22, r, Math.PI * 0.95, Math.PI * 2.35);
  c.lineTo(0, h * 0.12);
  c.lineWidth = h * 0.17;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.strokeStyle = colour;
  c.stroke();
  disc(c, 0, h * 0.36, h * 0.1, colour);
  c.restore();
}

/** 20a's « peut-être disparue », without its hatching (DECISIONS 2026-10-06, « Hatching keeps
 * one meaning… »): a dashed ring around the camera's sticker, edged with the map's paper,
 * and a « ? » on a disc hooked at its top right, as the count labels hang. 44 CSS px. */
export function maybeGone(ratio: number, ink: MarkInks): ImageData {
  const s = 44;
  const [el, c] = canvas(s * ratio, s * ratio);
  c.scale(ratio, ratio);
  const [cx, cy, r] = [21, 23, 16];
  c.beginPath();
  c.arc(cx, cy, r, 0, TAU);
  c.lineWidth = 4;
  c.strokeStyle = ink.halo;
  c.stroke();
  c.setLineDash([4.2, 3.2]);
  c.lineWidth = 2;
  c.strokeStyle = ink.ring;
  c.stroke();
  c.setLineDash([]);
  disc(c, 35, 9, 8.5, ink.halo);
  disc(c, 35, 9, 7.5, ink.disc);
  qmark(c, 35, 9.5, 11, ink.mark);
  return pixels(el);
}

/** The tape alone, laid across a proposed camera's sticker (20a): 40 x 14 CSS px, turned
 * by the layer. */
export function tape(ratio: number, ink: MarkInks): ImageData {
  const [el, c] = canvas(40 * ratio, 14 * ratio);
  c.scale(ratio, ratio);
  c.translate(20, 7);
  paintTape(c, ink.tape, 0, 34, 10);
  return pixels(el);
}

/** A proposal below the street level, where no sticker is drawn: 20a's legend sample, a
 * paper disc ringed in ink with the tape across it. 28 CSS px. */
export function pendingMark(ratio: number, ink: MarkInks, inkLine: string): ImageData {
  const s = 28;
  const [el, c] = canvas(s * ratio, s * ratio);
  c.scale(ratio, ratio);
  disc(c, 14, 14, 9.5, inkLine);
  disc(c, 14, 14, 7.5, ink.halo);
  c.translate(14, 15);
  paintTape(c, ink.tape, -0.52, 26, 8);
  return pixels(el);
}

/** 17a's level label (« identification ~6 m »): a yellow tag cut as an arrow on its left
 * (9 CSS px), its text in the typewriter face (13 px on 17 px lines; its fallback until the
 * punk fonts arrive, then drawn again), padded 3 / 10 / 2 / 16 px as 17a pads it. One image
 * per text (icons.ts draws it when the map asks for it). */
export function tagLabel(ratio: number, ink: MarkInks, text: string, font: string): ImageData {
  const probe = canvas(1, 1)[1];
  probe.font = font;
  const [cut, left, right, top, bottom, line] = [9, 16, 10, 3, 2, 17];
  const w = Math.ceil(left + probe.measureText(text).width + right);
  const h = top + line + bottom;
  const [el, c] = canvas(w * ratio, h * ratio);
  c.scale(ratio, ratio);
  c.beginPath();
  c.moveTo(cut, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(cut, h);
  c.lineTo(0, h / 2);
  c.closePath();
  c.fillStyle = ink.tag;
  c.fill();
  c.font = font;
  c.textBaseline = "middle";
  c.fillStyle = ink.tagInk;
  c.fillText(text, left, top + line / 2 + 0.5);
  return pixels(el);
}

// --- on the map --------------------------------------------------------------------------

/** What the map's stickers need from the page (icons.ts). */
export type MapWiring = {
  kinds: readonly Kind[];
  /** Device pixels a CSS pixel at scale 1 (icons.ts RATIO). */
  ratio: number;
  /** The inks in the mode in force. */
  inks: () => ThemeInks;
  /** A sticker image's name (icons.ts stickerName, the one layers.ts asks for). */
  name: (kind: Kind, state: "full" | "dim" | "gone", big?: boolean) => string;
  /** The name a proposal's ghost answers to (participate/proposals.ts: `cam-<kind>`). */
  ghost: (kind: Kind) => string;
  /** The inks of the map's other marks (lot 3.1), and the map's ink. */
  marks: () => MarkInks & { ink: string };
  /** Their names (icons.ts MARKS, the ones layers.ts asks for). */
  markNames: Record<"maybeGone" | "tape" | "pending" | "paper" | "fieldDim", string> & {
    fields: [string, string, string];
  };
};

// Plain images do not scale as cleanly as SDF ones: the map's stickers are drawn at 3 device
// pixels a CSS pixel (a phone's screen at icon-size 1), the selected camera's (1.5 to 1.875
// times larger) at 5; their footprint stays 30 CSS px (icons.ts ICON_CSS_PX).
const MAP_SCALE = 1.5;
const FIELD_RATIO = 4;
const BIG_SCALE = 2.5;

/** Every sticker of the map, added, or drawn again in the mode's colours (main.ts restyle:
 * same names, same sizes). */
export function addStickers(map: MlMap, w: MapWiring): void {
  const theme = w.inks();
  const marks = w.marks();
  const put = (name: string, kind: Kind, variant: Variant, scale: number) => {
    const el = stickerCanvas(kind, variantInks(theme, variant), variant, scale, marks.tape);
    const c = el.getContext("2d") as CanvasRenderingContext2D;
    const image = c.getImageData(0, 0, el.width, el.height);
    if (map.hasImage(name)) map.updateImage(name, image);
    else map.addImage(name, image, { pixelRatio: w.ratio * scale });
  };
  for (const kind of w.kinds) {
    for (const state of ["full", "dim", "gone"] as const)
      put(w.name(kind, state), kind, state, MAP_SCALE);
    for (const state of ["full", "gone"] as const)
      put(w.name(kind, state, true), kind, state, BIG_SCALE);
    put(w.ghost(kind), kind, "ghost", MAP_SCALE);
  }
  // The map's other marks, at the stickers' scale (3 device pixels a CSS pixel).
  const ratio = w.ratio * MAP_SCALE;
  const image = (name: string, data: ImageData, options: object = {}) => {
    if (map.hasImage(name)) map.updateImage(name, data);
    else map.addImage(name, data, { pixelRatio: ratio, ...options });
  };
  const names = w.markNames;
  image(names.maybeGone, maybeGone(ratio, marks));
  image(names.tape, tape(ratio, marks));
  image(names.pending, pendingMark(ratio, marks, marks.ink));
  image(names.paper, paperDots(ratio, marks));
  // The fields' patterns at 4 device pixels a CSS pixel: a tile of 8 CSS px is then 32 px,
  // a power of two in both.
  const pattern = (name: string, data: ImageData) => {
    if (map.hasImage(name)) map.updateImage(name, data);
    else map.addImage(name, data, { pixelRatio: FIELD_RATIO });
  };
  for (const lv of [1, 2, 3] as const)
    pattern(names.fields[lv - 1], fieldPattern(FIELD_RATIO, marks, lv));
  pattern(names.fieldDim, dimFieldPattern(FIELD_RATIO, marks));
}
