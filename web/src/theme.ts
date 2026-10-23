// The interface's theme: the punk design (the redesign « Carte punk »), the only one since
// 2026-10-23 (the classique and its ?ui= choice removed; ?ui= is ignored). It follows the
// phone's light or dark setting until the sun / moon button is used, then the choice kept
// on the device (DECISIONS 2026-10-09; ?mode=clair|sombre|auto sets it too).
// Its tokens are theme/punk/tokens.css, beside its rules, one file per screen, all imported
// by theme/punk/punk.css: the map's colours are its --map-* tokens and its basemap the
// --basemap* ones, read here.
export type Mode = "light" | "dark";
export type ModeChoice = "auto" | "clair" | "sombre";

const MODE_KEY = "lacarte.mode";
const DARK = "(prefers-color-scheme: dark)";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or blocked storage: the choice holds for this page only.
  }
}
const param = (name: string) => new URLSearchParams(window.location.search).get(name);

/** The mode asked for: ?mode=clair|sombre|auto, kept on the device; auto by default. */
export function modeChoice(): ModeChoice {
  const q = param("mode");
  if (q === "clair" || q === "sombre" || q === "auto") {
    store(MODE_KEY, q);
    return q;
  }
  const s = stored(MODE_KEY);
  return s === "clair" || s === "sombre" ? s : "auto";
}

/** The mode shown: the one chosen, or the phone's. */
function resolvedMode(choice: ModeChoice): Mode {
  if (choice === "auto") return window.matchMedia(DARK).matches ? "dark" : "light";
  return choice === "sombre" ? "dark" : "light";
}

export const mode = (): Mode => (document.documentElement.dataset.mode as Mode) ?? "light";

/** Mark the page with its mode, and load the tokens and rules (and the fonts' loader), a
 * chunk of their own fetched as the code starts. The page keeps `data-ui="punk"`: every
 * rule of theme/punk/ is written under it. */
export async function initTheme(): Promise<void> {
  const root = document.documentElement;
  root.dataset.ui = "punk";
  root.dataset.mode = resolvedMode(modeChoice());
  // Safari on iOS applies :active on a tap only when a touchstart listener exists on the
  // element or an ancestor (product owner, 2026-10-07; to check on the iPhone): one,
  // passive, so that the buttons show their press (theme/punk/buttons.css).
  document.addEventListener("touchstart", () => {}, { passive: true });
  const [, fonts] = await Promise.all([import("./theme/punk/punk.css"), import("./theme/fonts")]);
  loadFonts = fonts.loadFonts;
  if (fonts.seen()) void loadFonts();
  // The tokens are in: drop the page's waiting colours set by index.html.
  root.style.removeProperty("--page");
  root.style.removeProperty("color-scheme");
  current = null;
}

let loadFonts: (() => Promise<void>) | null = null;

/** The punk fonts, once the first display is done (theme/fonts.ts). */
export function themeFonts(): void {
  void loadFonts?.();
}

const THEME_EVENT = "lacarte:theme";

let repaint: ((from: Palette) => void) | null = null;

/** Repaint in `choice`'s mode when it differs from the one painted: the CSS follows the
 * page's mode by itself; the map's repaint (followMode's `apply`), then every onTheme()
 * listener redraws what was drawn with the old colours (pictograms on canvases). */
function switchTo(choice: ModeChoice): void {
  const next = resolvedMode(choice);
  if (next === mode()) return;
  const from = palette();
  document.documentElement.dataset.mode = next;
  current = null;
  repaint?.(from);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Follow the phone's light/dark setting while the mode is on "auto". */
export function followMode(apply: (from: Palette) => void): void {
  repaint = apply;
  window.matchMedia(DARK).addEventListener("change", () => {
    if (modeChoice() === "auto") switchTo("auto");
  });
}

/** A mode chosen on the device: kept (`lacarte.mode`) and in the link (`?mode=`, which
 * otherwise would bring the old choice back on a reload), applied at once with the live
 * switch of followMode. */
export function chooseMode(choice: ModeChoice): void {
  store(MODE_KEY, choice);
  const q = new URLSearchParams(window.location.search);
  if (q.has("mode")) {
    q.set("mode", choice);
    const url = `${window.location.pathname}?${q.toString()}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  }
  switchTo(choice);
}

/** The punk sun / moon button (machine.ts): the other mode than the one shown, kept on the
 * device from then on (the phone's setting is no longer followed). */
export function toggleMode(): void {
  chooseMode(mode() === "dark" ? "clair" : "sombre");
}

/** Call `redraw` after each change of mode, while `alive()` holds (then forget it). */
export function onTheme(redraw: () => void, alive: () => boolean): void {
  const listener = () => {
    if (alive()) redraw();
    else window.removeEventListener(THEME_EVENT, listener);
  };
  window.addEventListener(THEME_EVENT, listener);
}

// --- the map's colours ----------------------------------------------------------------

export type Palette = {
  /** Communes and départements, light to dark (quantile classes). */
  area: [string, string, string, string, string];
  areaLine: string;
  /** The thin border between communes and départements. */
  areaBorder: string;
  /** The outline of the commune or département whose sheet is open. */
  areaSelected: string;
  /** The dark edge under that outline. */
  areaSelectedEdge: string;
  /** Filmed streets by the highest level reached: [detection, recognition, identification]. */
  level: [string, string, string];
  /** Portions kept by the active filters. */
  kept: string;
  focusStreet: string;
  /** The reach written on the focused camera's outlines. */
  label: string;
  field: string;
  fieldLine: string;
  /** The other fields' outline while a camera is in focus. */
  fieldDimLine: string;
  hatchView: string;
  picto: string;
  /** The other pictograms while a camera is in focus, and a proposal's ghost. */
  otherPicto: string;
  ghostPicto: string;
  streetNone: string;
  gone: string;
  halo: string;
  ink: string;
  me: string;
  proposal: string;
  /** Guide lines: the facade a move is pulled to, the aim. */
  guide: string;
  hatchNone: string;
  near: string;
  chartOther: string;
};

/** `colour` (#rrggbb) at `alpha` over `base` (#rrggbb), as an opaque colour: what a
 * pictogram at that opacity looks like on the map, without darkening where two overlap. */
export function over(colour: string, alpha: number, base: string): string {
  const rgb = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
  const [c, b] = [rgb(colour), rgb(base)];
  const mixed = c.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// The other pictograms in focus mode, and a proposal's ghost (layers.OTHER_PICTO).
const OTHER_PICTO = 0.7;
const GHOST_PICTO = 0.4;

let current: Palette | null = null;

export const token = (style: CSSStyleDeclaration, name: string): string =>
  style.getPropertyValue(`--${name}`).trim();

/** A hex colour as #rrggbb or #rrggbbaa, lower case: the build's CSS minifier shortens
 * #ffffff to #fff, and the blends above read two digits per channel. */
export function normalHex(colour: string): string {
  const c = colour.toLowerCase();
  if (/^#[0-9a-f]{3,4}$/.test(c)) return `#${[...c.slice(1)].map((d) => d + d).join("")}`;
  return c;
}

/** The map's colours from a theme's tokens: `v` reads one (its name without "--") as a
 * normalised hex colour. Pure, so that web/tests/theme.test.ts builds the palettes of both
 * modes from the CSS files exactly as the page does. */
export function paletteFrom(v: (name: string) => string): Palette {
  const picto = v("map-picto");
  const halo = v("map-halo");
  return {
    area: [v("map-area-1"), v("map-area-2"), v("map-area-3"), v("map-area-4"), v("map-area-5")],
    areaLine: v("map-area-line"),
    areaBorder: v("map-area-border"),
    areaSelected: v("map-area-selected"),
    areaSelectedEdge: v("map-area-selected-edge"),
    level: [v("map-level-1"), v("map-level-2"), v("map-level-3")],
    kept: v("map-kept"),
    focusStreet: v("map-focus-street"),
    label: v("map-label"),
    field: v("map-field"),
    fieldLine: v("map-field-line"),
    fieldDimLine: v("map-field-dim-line"),
    hatchView: v("map-hatch-view"),
    picto,
    otherPicto: over(picto, OTHER_PICTO, halo),
    ghostPicto: over(picto, GHOST_PICTO, halo),
    streetNone: v("map-street-none"),
    gone: v("map-gone"),
    halo,
    ink: v("map-ink"),
    me: v("map-me"),
    proposal: v("map-proposal"),
    guide: v("map-guide"),
    hatchNone: v("map-hatch-none"),
    near: v("map-near"),
    chartOther: v("chart-other"),
  };
}

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  return paletteFrom((name) => {
    const value = token(s, name);
    if (!value) throw new Error(`theme: --${name} is not defined`);
    if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value))
      throw new Error(`theme: --${name} is not a hex colour (${value})`);
    return normalHex(value);
  });
}

/** The communes' and départements' fill opacity where the theme sets its own
 * (--map-area-opacity: punk, opaque in light and dark), else null (layers.ts AREA_OPACITY). */
export function themeAreaOpacity(): number | null {
  const value = token(getComputedStyle(document.documentElement), "map-area-opacity");
  if (!value) return null;
  const n = Number(value);
  if (!(n > 0 && n <= 1)) throw new Error(`theme: --map-area-opacity is not an opacity (${value})`);
  return n;
}

/** The width of the halo of the map's text where the theme sets one (--map-label-halo-width:
 * punk), else null: the basemap's labels then keep their flavour's colours and halos, and
 * the reach labels their own width (layers.ts). */
export function labelHaloWidth(): number | null {
  const value = token(getComputedStyle(document.documentElement), "map-label-halo-width");
  if (!value) return null;
  const n = Number(value);
  if (!(n > 0 && n <= 4))
    throw new Error(`theme: --map-label-halo-width is not a width (${value})`);
  return n;
}

/** The basemap's water drawn again over the fields where the theme asks for it (punk:
 * --map-water-opacity, --map-water-shore, light and dark), else null (layers.ts
 * drawnBasemap). */
export function waterOverFields(): { opacity: number; shore: string } | null {
  const s = getComputedStyle(document.documentElement);
  const value = token(s, "map-water-opacity");
  if (!value) return null;
  const opacity = Number(value);
  if (!(opacity > 0 && opacity < 1))
    throw new Error(`theme: --map-water-opacity is not an opacity (${value})`);
  const shore = token(s, "map-water-shore");
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(shore))
    throw new Error(`theme: --map-water-shore is not a hex colour (${shore})`);
  return { opacity, shore: normalHex(shore) };
}

/** Every label of the map in one colour (--map-label) on the map's halo (--map-halo), and
 * the halo's width, where the theme asks for it (punk); else null (basemap.ts). */
export function labelHalo(): { colour: string; halo: string; width: number } | null {
  const width = labelHaloWidth();
  if (width === null) return null;
  const p = palette();
  return { colour: p.label, halo: p.halo, width };
}

/** The map's colours for the theme in force. */
export function palette(): Palette {
  current ??= readPalette();
  return current;
}

/** Every colour of `from` mapped to the same entry of `to` (a theme's change of mode). The
 * map's style holds colours, not token names: a colour two entries of `from` share must
 * become one colour, or `clash` is told (the first kept). web/tests/theme.test.ts holds
 * the punk theme to it in both directions, light to dark and dark to light. */
export function colourMap(
  from: Palette,
  to: Palette,
  clash = (colour: string, kept: string, other: string) =>
    console.warn(`theme: ${colour} becomes both ${kept} and ${other}; kept ${kept}`),
): Map<string, string> {
  const pairs = new Map<string, string>();
  const add = (a: string, b: string) => {
    const known = pairs.get(a);
    if (known !== undefined && known !== b) clash(a, known, b);
    else pairs.set(a, b);
  };
  for (const key of Object.keys(from) as (keyof Palette)[]) {
    const [a, b] = [from[key], to[key]];
    if (Array.isArray(a) && Array.isArray(b)) {
      for (const [i, c] of a.entries()) add(c, b[i]);
    } else add(a as string, b as string);
  }
  return pairs;
}
