// The punk interface's camera stickers (src/stickers.ts, mockup 16a), from the punk tokens
// in light and dark as the page reads them: the body stands 3:1 from its outline (WCAG
// 1.4.11, RGAA 3.3) for the map's camera, the others in focus mode and a camera verified
// gone; each of these reads on the basemap's earth, roads and filmed streets by its outline
// or its body (the "edge or disc" rule of the focus marker, theme.test.ts); a proposal's
// ghost is pale on purpose (its badge and dotted link mark it) and is printed. Every state
// keeps a cue that is not colour alone: crossed eyes once gone, checked on the drawing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { namedFlavor } from "@protomaps/basemaps";
import {
  hex,
  luminance,
  mix,
  paintSticker,
  type ThemeInks,
  themeInks,
  type Variant,
  variantInks,
} from "../src/stickers.ts";

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

/** The custom properties of the top-level rule whose selector is exactly `selector`. */
function block(css: string, selector: string): Map<string, string> {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule ${selector}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const props = new Map<string, string>();
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    props.set(m[1], m[2].trim());
  return props;
}

const classic = block(src("theme/classic.css"), ":root");
// The punk tokens, light then dark (theme/punk/punk.css imports them first).
const PUNK = src("theme/punk/tokens.css");
const light = new Map([...classic, ...block(PUNK, ':root[data-ui="punk"]')]);
const dark = new Map([...light, ...block(PUNK, ':root[data-ui="punk"][data-mode="dark"]')]);

const contrast = (a: string, b: string) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const GRAPHIC = 3;
/** The variants held to 3:1; the ghost is measured only. */
const HELD: Variant[] = ["full", "dim", "gone"];
/** The flavour's fills a camera stands on at the street level (Protomaps 5.7 keys); water
 * (a camera on a quay or a bridge) is measured only: in light, the dimmed sticker (16a's
 * half-way body) is 2.4:1 on the sky-blue water. */
const MEASURED = ["water"];
const GROUNDS = [
  "earth",
  "buildings",
  "park_a",
  "water",
  ...["highway", "major", "link", "minor_a", "minor_b", "minor_service", "other", "pedestrian"],
];

/** The basemap as basemap.ts draws it: the theme's named flavour, its --basemap-<key> over. */
function basemap(tokens: Map<string, string>): Record<string, string> {
  const flavour = { ...namedFlavor(tokens.get("--basemap") as string) } as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of GROUNDS) {
    const v = tokens.get(`--basemap-${k}`) ?? flavour[k];
    assert.equal(typeof v, "string", `basemap key ${k}`);
    out[k] = hex(v as string);
  }
  return out;
}

const modes = [
  ["light", light],
  ["dark", dark],
] as const;

for (const [name, tokens] of modes) {
  const t: ThemeInks = themeInks((n) => tokens.get(`--${n}`) ?? "");

  test(`punk ${name}: the stickers' inks come from the theme (16a)`, () => {
    // Ink body on paper in light, cream on the dark paper in dark; the eye in the lighter
    // and darker of the two; the iris the field's pink; the shadow the panels' own.
    assert.equal(t.body, hex(tokens.get("--map-picto") as string));
    assert.equal(t.outline, hex(tokens.get("--map-halo") as string));
    assert.equal(t.iris, hex(tokens.get("--map-field") as string));
    assert.ok(luminance(t.eye) >= luminance(t.pupil));
    assert.deepEqual(new Set([t.eye, t.pupil]), new Set([t.body, t.outline]));
    assert.equal(t.shadow, hex((tokens.get("--shadow-small") as string).split(/\s+/).pop() as string));
    // 16a's colours: ink #111111 / cream #f2efe6, sky #7fd4ff in light, pink #ff48b0 in dark.
    const want = name === "light" ? ["#111111", "#7fd4ff"] : ["#f2efe6", "#ff48b0"];
    assert.deepEqual([t.body, t.shadow], want);
  });

  test(`punk ${name}: each sticker's body 3:1 from its outline`, (t2) => {
    const measured: string[] = [];
    const failures: string[] = [];
    for (const v of [...HELD, "ghost"] as Variant[]) {
      const ink = variantInks(t, v);
      const r = contrast(ink.body, ink.outline);
      measured.push(`${v} ${ink.body} on ${ink.outline}: ${r.toFixed(2)}`);
      if (HELD.includes(v) && r < GRAPHIC) failures.push(measured[measured.length - 1]);
    }
    t2.diagnostic(measured.join("; "));
    assert.deepEqual(failures, []);
  });

  // The sticker sits on whatever the street level draws under it: the basemap's earth,
  // buildings, parks and roads, the filmed streets' three levels and the fields' three
  // grounds (DECISIONS 2026-10-08, « One palette… »: opaque, under every sticker). Its
  // outline or its body stands 3:1 on each (light: the ink body; dark: the cream body, the
  // dark outline on the pale levels); the lowest ratio per variant, water included, is
  // printed. The dimmed sticker (the others, while one camera is in focus) is held on the
  // light mid classes only where it can be: in focus the other streets are drawn at 15 %
  // and the other fields in one dimmed colour (layers.ts opacities, fieldPaint), so on a
  // recognise street or a recognise or identify ground at full strength it never is but in
  // the focused camera's own zone: there it is printed, not held (to be seen on the palette
  // board). The filmed streets are one vivid stroke since 2026-10-08 (« The more vivid… »,
  // no casing): a detect street, 4.5 px across a 30 px sticker, is printed, not held, for
  // the dimmed and the gone stickers (2.2 and 2.55:1 in light, 2.65:1 in dark): the sticker's
  // outline keeps 3:1 on the ground on either side of the stroke.
  test(`punk ${name}: each sticker reads on the basemap and the filmed streets`, (t2) => {
    const grounds = Object.entries(basemap(tokens));
    for (const i of [1, 2, 3]) grounds.push([`level ${i}`, hex(tokens.get(`--map-level-${i}`) as string)]);
    for (const i of [1, 2, 3]) grounds.push([`field ${i}`, hex(tokens.get(`--map-field-${i}`) as string)]);
    const printedOnly = (v: Variant, g: string) =>
      MEASURED.includes(g) ||
      (v === "dim" && ["level 2", "field 2", "field 3"].includes(g)) ||
      ((v === "dim" || v === "gone") && g === "level 1");
    const failures: string[] = [];
    const lowest: string[] = [];
    for (const v of [...HELD, "ghost"] as Variant[]) {
      const ink = variantInks(t, v);
      const ratios = grounds.map(
        ([g, c]) => [g, Math.max(contrast(ink.body, c), contrast(ink.outline, c))] as const,
      );
      const low = ratios.reduce((a, b) => (b[1] < a[1] ? b : a));
      lowest.push(`${v}: lowest ${low[1].toFixed(2)} on ${low[0]}`);
      if (HELD.includes(v))
        for (const [g, r] of ratios)
          if (r < GRAPHIC && !printedOnly(v, g)) failures.push(`${v} on ${g}: ${r.toFixed(2)}`);
    }
    t2.diagnostic(lowest.join("; "));
    assert.deepEqual(failures, []);
  });

  test(`punk ${name}: the variants differ from the full sticker`, () => {
    const full = variantInks(t, "full");
    const dim = variantInks(t, "dim");
    const gone = variantInks(t, "gone");
    const ghost = variantInks(t, "ghost");
    // 16a: half-way to the outline for the body, 45 % for the shadow and the iris.
    assert.equal(dim.body, mix(full.body, full.outline, 0.5));
    assert.equal(dim.iris, mix(full.iris, full.outline, 0.45));
    // The dimmed body stands apart from the full one, the ghost paler still.
    assert.ok(contrast(dim.body, full.body) >= 1.5, `dim ${dim.body} / full ${full.body}`);
    assert.ok(contrast(ghost.body, full.outline) < contrast(dim.body, full.outline));
    // Gone: the theme's grey, no pink left.
    assert.equal(gone.body, hex(tokens.get("--map-gone") as string));
    assert.notEqual(gone.iris, full.iris);
    for (const ink of [full, dim, gone, ghost]) assert.equal(ink.outline, full.outline);
  });
}

// Crossed eyes, not colour alone, tell a camera verified gone: the drawing, recorded on a
// stand-in for the canvas (node has none).
type Op = { op: string; args: unknown[]; fill: string; stroke: string };
function recorder(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  const state = { fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "", lineCap: "" };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key as keyof typeof target];
      return (...args: unknown[]) =>
        ops.push({ op: key, args, fill: state.fillStyle, stroke: state.strokeStyle });
    },
    set(target, key: string, value) {
      (target as Record<string, unknown>)[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

const KINDS = ["dome", "fixed", "ptz", "panorama", "alpr", "doorbell", "unknown"] as const;
for (const [name, tokens] of modes) {
  test(`punk ${name}: once gone, no pink and crossed eyes (or a « × » for no type)`, () => {
    const t = themeInks((n) => tokens.get(`--${n}`) ?? "");
    for (const kind of KINDS) {
      const full = recorder();
      paintSticker(full.ctx, kind, variantInks(t, "full"), "full");
      const gone = recorder();
      paintSticker(gone.ctx, kind, variantInks(t, "gone"), "gone");
      const inks = (ops: Op[]) =>
        new Set(ops.filter((o) => o.op === "fill" || o.op === "stroke").map((o) => (o.op === "fill" ? o.fill : o.stroke)));
      assert.ok(inks(full.ops).has(t.iris), `${kind}: the full sticker shows its pink`);
      assert.ok(!inks(gone.ops).has(t.iris), `${kind}: no pink once gone`);
      // The cross: two strokes from moveTo to lineTo, after the eye (or on the star).
      const crosses = gone.ops.filter((o, i) => o.op === "moveTo" && gone.ops[i + 1]?.op === "lineTo");
      assert.ok(crosses.length >= 2, `${kind}: crossed out once gone`);
      const fullCrosses = full.ops.filter((o, i) => o.op === "moveTo" && full.ops[i + 1]?.op === "lineTo");
      assert.ok(crosses.length > fullCrosses.length, `${kind}: the cross is the gone one's own`);
    }
  });
}

// The legend's samples draw the fields' outlines as the map does: the same dash per level
// in stickers.ts (fieldSample) and layers.ts (fieldLine), read from both sources.
test("the fields' outline dashes are the same on the map and in the legend", () => {
  const dash = (file: string) =>
    /FIELD_DASH[^=]*=\s*(\{[^}]*\})/.exec(src(file))?.[1].replace(/\s+/g, "");
  assert.ok(dash("stickers.ts"), "stickers.ts FIELD_DASH");
  assert.equal(dash("layers.ts"), dash("stickers.ts"));
});
