// The punk camera sheet's rows (src/chips.ts, src/theme/punk/chips.css and sheet.css; lot
// 3.2, mockup 17a): every row says where its value comes from in a tag and how certain it
// is in 17a's language — the value alone (identified), « ~ » before it (estimated), in the
// « Supposé » box (default), its « ? » only where « Compléter » can answer — never by colour alone, the word
// said in hidden text (bench/smoke-chips.mjs checks it in the browser); tags carry the
// month, never the day; rows are not buttons; the sheet's text stands 4.5:1 and its
// graphics 3:1 on what is painted under them, light and dark, read from the CSS (the
// pairs its rules actually declare), as tests/theme.test.ts reads the tokens.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { factText, shortMonth, type Source, sourceOf, upMetre } from "../src/chips.ts";

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const FR = JSON.parse(src("locales/fr.json")) as Record<string, string>;
/** i18n.ts's t() without plurals (none of the rows' strings has one). */
const t = (key: string, params: Record<string, string | number> = {}) => {
  assert.ok(key in FR, `fr.json has no ${key}`);
  return FR[key].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));
};

const SOURCES: Source[] = ["site", "answer", "contrib", "osm", "assumed", "pending"];
const CERTS = [2, 1, 0];

// --- the words ------------------------------------------------------------------------

test("each source and each certainty has its own word", () => {
  const tags = SOURCES.map((s) => t(`chip.source.${s}`));
  assert.equal(new Set(tags).size, tags.length, `tags ${tags}`);
  const words = CERTS.map((c) => t(`cert.${c}`));
  assert.equal(new Set(words).size, words.length, `certainties ${words}`);
  // Exactly these sources in the catalogue, none forgotten.
  const keys = Object.keys(FR)
    .filter((k) => k.startsWith("chip.source."))
    .map((k) => k.slice(12))
    .sort();
  assert.deepEqual(keys, [...SOURCES].sort());
});

test("what the review has not validated says so; a tag carries the month, never the day", () => {
  assert.equal(t("chip.source.pending"), "en attente de revue");
  assert.equal(t("chip.source.site"), "sur place");
  for (const s of SOURCES) assert.ok(!/\d/.test(t(`chip.source.${s}`)), s);
  // 17a's « sur place · 03/26 »: the month and the year, from a contribution's month.
  assert.equal(shortMonth("2026-03"), "03/26");
  assert.equal(shortMonth("2026-10"), "10/26");
});

test("a row's source: the one given, else a default value is an assumption, else OSM", () => {
  assert.equal(sourceOf({ cert: 0 }), "assumed");
  assert.equal(sourceOf({ cert: 1 }), "osm");
  assert.equal(sourceOf({ cert: 2 }), "osm");
  assert.equal(sourceOf({ cert: 2, source: "site" }), "site");
  assert.equal(sourceOf({ cert: 0, source: "answer" }), "answer");
  // A name or a date has no certainty: no source unless given.
  assert.equal(sourceOf({}), undefined);
  assert.equal(sourceOf({ source: "osm" }), "osm");
});

// --- the certainty in 17a's language ----------------------------------------------------

// DECISIONS 2026-10-08, « The punk sheet's « ~ »… »: « ~ » on an estimated number only.
test("an estimated category has no « ~ », an estimated number has", () => {
  for (const key of ["type", "status", "direction", "operator", "tilt", "night", undefined]) {
    const x = factText({ key, label: "x", value: "fixe", cert: 1 }, t);
    assert.equal(x.approx, false, String(key));
    assert.equal(x.certainty, t("cert.1"), String(key));
  }
  for (const key of ["height", "fov", "zoom"])
    assert.equal(factText({ key, label: "x", value: "3 m", cert: 1 }, t).approx, true, key);
});

test("distances are rounded up to the metre, everywhere alike", () => {
  assert.equal(upMetre(5.6), 6);
  assert.equal(upMetre(5), 5);
  assert.equal(upMetre(5.01), 6);
  assert.equal(upMetre(17), 17);
  assert.equal(upMetre(0.2), 1);
});

test("identified: the value alone; estimated: « ~ »; default: the box; the word always said", () => {
  for (const source of [...SOURCES, undefined])
    for (const cert of [...CERTS, undefined]) {
      const f = {
        key: "height",
        label: "Hauteur",
        value: "4 m, d'après une réponse (octobre 2026)",
        bare: "4 m",
      };
      const x = factText({ ...f, cert, source }, t);
      const what = JSON.stringify({ cert, source });
      // The value without what its tag says.
      assert.equal(x.value, "4 m", what);
      // Shapes, not colours: « ~ » for an estimate, the box (and its « ? ») for a default.
      assert.equal(x.approx, cert === 1, what);
      assert.equal(x.box, cert === 0, what);
      // The certainty's word, said whenever there is one, never dropped.
      assert.equal(x.certainty, cert === undefined ? "" : t(`cert.${cert}`), what);
      // A row with a certainty says where it comes from: its tag, or the box's title.
      if (cert !== undefined) assert.ok(x.tag || (x.box && sourceOf({ cert, source }) === "assumed"), what);
      // In the box, « supposé » is the box's title, not a tag; a contribution keeps its tag.
      if (cert === 0 && (source ?? "assumed") === "assumed") assert.equal(x.tag, "", what);
      if (source && source !== "assumed") assert.equal(x.tag, t(`chip.source.${source}`), what);
    }
});

// --- the CSS: no button, no state, contrast --------------------------------------------

const CLASSIC = src("theme/classic.css");
const PUNK_FILES = [...src("theme/punk/punk.css").matchAll(/@import\s+"\.\/([\w-]+\.css)";/g)].map(
  (m) => m[1],
);
const PUNK = PUNK_FILES.map((f) => src(`theme/punk/${f}`)).join("\n");
assert.ok(PUNK_FILES.includes("chips.css") && PUNK_FILES.includes("sheet.css"));

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
const classic = block(CLASSIC, ":root");
const light = new Map([...classic, ...block(PUNK, ':root[data-ui="punk"]')]);
const dark = new Map([...light, ...block(PUNK, ':root[data-ui="punk"][data-mode="dark"]')]);

/** A file's rules: selector (its punk prefix removed) -> property -> value; the rules inside
 * a media query count as the others (the phone's restate the same tokens). */
function rules(file: string) {
  const out = new Map<string, Map<string, string>>();
  for (const m of src(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = [...m[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]);
    // Commas between selectors, not those inside :is() or :not().
    for (const sel of m[1].split(/,(?![^()]*\))/)) {
      const s = sel.trim().replace(/\s+/g, " ").replace(/^:root\[data-ui="punk"\] /, "");
      out.set(s, new Map([...(out.get(s) ?? []), ...(decls as [string, string][])]));
    }
  }
  return out;
}
const CHIPS = rules("theme/punk/chips.css");
const SHEET = rules("theme/punk/sheet.css");
const ALL = new Map([...SHEET, ...CHIPS]);

test("chips.css: the rows, every selector the punk sheet's; a tag rule per source", () => {
  for (const sel of CHIPS.keys()) assert.ok(sel.startsWith("#sheet "), `${sel}: not the sheet's`);
  const tags = [...CHIPS.keys()].filter((k) => k.startsWith("#sheet .chip-tag."));
  assert.deepEqual(tags.sort(), SOURCES.map((s) => `#sheet .chip-tag.${s}`).sort());
});

test("rows are not buttons: no touch target, no state, no pointer, nothing that moves", () => {
  for (const [sel, decls] of CHIPS) {
    assert.ok(!/:(hover|active|focus)/.test(sel), `${sel}: a state`);
    assert.ok(!decls.has("min-height") || decls.get("min-height") !== "44px", `${sel}: 44 px`);
    assert.ok(decls.get("cursor") !== "pointer", `${sel}: a pointer`);
    for (const p of ["transition", "animation"]) assert.ok(!decls.has(p), `${sel}: ${p}`);
  }
  // The rows are a definition list, 17a's: chips.ts draws dl > div > dt + dd.
  const code = src("chips.ts");
  assert.match(code, /el\("dt"/);
  assert.match(code, /el\("dd"/);
  assert.ok(!/factRow[\s\S]{0,400}"button"/.test(code), "a row drawn as a button");
});

const isColour = (v = "") => /^#[0-9a-f]{3,8}$|^rgba?\(/i.test(v);
/** The colour token a rule's property reads (a border's colour, not its width). */
const tokenOf = (sel: string, prop: string, tokens: Map<string, string>): string => {
  const v = ALL.get(sel)?.get(prop);
  assert.ok(v, `no ${prop} in ${sel}`);
  const vars = [...v.matchAll(/var\((--[\w-]+)\)/g)]
    .map((m) => m[1])
    .filter((k) => isColour(tokens.get(k)));
  // A background of layers (the box's grid over its paper): its last layer, the colour.
  if (prop === "background" && vars.length > 1) return vars[vars.length - 1];
  assert.equal(vars.length, 1, `${sel} ${prop}: ${v}, one colour token`);
  return vars[0];
};

function rgb(colour: string): [number, number, number, number] {
  const m = colour.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[ ,]+/).filter(Boolean).map(Number);
    return [r, g, b, a];
  }
  let h = colour.slice(1);
  if (h.length <= 4) h = [...h].map((d) => d + d).join("");
  const a = h.length === 8 ? Number.parseInt(h.slice(6), 16) / 255 : 1;
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).concat(a) as [
    number,
    number,
    number,
    number,
  ];
}
/** `top` over `under` (opaque), as `blend` (normal or multiply) paints it. */
function over(top: string, under: string, blend = "normal"): [number, number, number] {
  const [r, g, b, a] = rgb(top);
  const [R, G, B] = rgb(under);
  const mix = (c: number, C: number) => (blend === "multiply" ? (c * C) / 255 : c);
  return [
    a * mix(r, R) + (1 - a) * R,
    a * mix(g, G) + (1 - a) * G,
    a * mix(b, B) + (1 - a) * B,
  ];
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const TEXT = 4.5;
const LARGE = 3; // 18.66 px bold and up (the title's letters), and graphics
for (const [name, tokens] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`punk ${name}: the sheet's text 4.5:1 and its graphics 3:1, from the CSS`, (t) => {
    const solid = (token: string) => {
      const v = tokens.get(token);
      assert.ok(v && isColour(v), `${token} ${v}: a colour`);
      return over(v, "#ffffff");
    };
    const of = (sel: string, prop: string) => tokenOf(sel, prop, tokens);
    const paper = "--bg"; // .sheet-paper's background
    const pairs: [string, string, [number, number, number], number][] = [];
    const on = (what: string, fg: string, bg: string, min: number) =>
      pairs.push([what, fg, solid(bg), min]);
    on("paper's text", of("#sheet .sheet-paper", "color"), of("#sheet .sheet-paper", "background"), TEXT);
    // Rows on the paper and in the box.
    for (const bg of [paper, of("#sheet .sheet-assumed", "background")]) {
      on(`label on ${bg}`, of("#sheet .fact dt", "color"), bg, TEXT);
      on(`value on ${bg}`, of("#sheet .fact dd", "color"), bg, TEXT);
      on(`leader on ${bg}`, of("#sheet .fact::after", "border-bottom"), bg, LARGE);
    }
    for (const s of SOURCES)
      on(`tag ${s}`, of(`#sheet .chip-tag.${s}`, "color"), of(`#sheet .chip-tag.${s}`, "background"), TEXT);
    on("the « ? »", of("#sheet .fact .q", "color"), of("#sheet .fact .q", "background"), TEXT);
    on("the box's title", of("#sheet .sheet-assumed h3", "color"), of("#sheet .sheet-assumed h3", "background"), TEXT);
    // The title's letters (large text) on their tiles, the last on the paper.
    for (const c of [0, 1, 2, 3])
      on(`letter c${c}`, of(`#sheet .cut.c${c}`, "color"), of(`#sheet .cut.c${c}`, "background"), LARGE);
    on("letter c4", of("#sheet .cut.c4", "color"), paper, LARGE);
    on("dates", of("#sheet .sheet-dates", "color"), paper, TEXT);
    on("stamp's text", of("#sheet .sheet-stamp", "color"), paper, TEXT);
    on("stamp's border", of("#sheet .sheet-stamp", "border"), paper, LARGE);
    on("gone stamp's border", of("#sheet .sheet-stamp.gone", "border"), paper, LARGE);
    on("ticket", of("#sheet .ticket", "color"), of("#sheet .ticket", "background"), TEXT);
    on("pink ticket", of("#sheet .ticket.on", "color"), of("#sheet .ticket.on", "background"), TEXT);
    on("ticket's edge", of("#sheet .ticket", "border"), paper, LARGE);
    on("band", of("#sheet .sheet-band .band", "color"), of("#sheet .sheet-band .band", "background"), TEXT);
    on("band's tag", of("#sheet .sheet-band .chip-tag", "color"), of("#sheet .sheet-band .chip-tag", "background"), TEXT);
    on("review conflict", of("#sheet .sheet-paper .part-conflict", "color"), of("#sheet .sheet-paper .part-conflict", "background"), TEXT);
    on("close", of("#sheet .sheet-head .close", "color"), of("#sheet .sheet-head .close", "background"), LARGE);
    const complete = "#sheet .participate > .part-answers:not(.stack) > #part-complete";
    on("Compléter", of(complete, "color"), of(complete, "background"), LARGE);
    on("its « ? »", of("#sheet #part-complete::after", "color"), of("#sheet #part-complete::after", "background"), TEXT);
    const still =
      "#sheet .participate > .part-answers:not(.stack) > .part-verify";
    on("Toujours là ?", of(still, "color"), of(still, "background"), LARGE);
    on("links", of("#sheet .sheet-paper .sheet-link", "color"), paper, TEXT);
    const measured = pairs.map(([what, fg, bg, min]) => ({
      what,
      ratio: contrast(solid(fg), bg),
      min,
    }));
    // The tape: half-clear yellow over the paper (multiplied in light), its ink on it.
    const tape = over(tokens.get("--sheet-tape") as string, tokens.get(paper) as string, tokens.get("--sheet-tape-blend"));
    const tapeInk = of("#sheet .sheet-band.tape .band", "color");
    measured.push({ what: "tape", ratio: contrast(solid(tapeInk), tape), min: TEXT });
    t.diagnostic(measured.map((m) => `${m.what} ${m.ratio.toFixed(2)}`).join("; "));
    assert.deepEqual(
      measured.filter((m) => m.ratio < m.min).map((m) => `${m.what}: ${m.ratio.toFixed(2)} < ${m.min}`),
      [],
    );
  });
}
