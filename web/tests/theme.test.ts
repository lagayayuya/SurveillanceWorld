// The theme tokens (src/theme/punk/tokens.css): every variable the styles read is defined,
// the punk theme's files are all imported by its entry (tokens first), every colour is
// defined in light and in dark, its text and graphics
// meet WCAG 2.x
// contrast (RGAA 3.2 and 3.3: 4.5:1 for text, 3:1 for large text, controls and graphics)
// on their backgrounds, the three IEC 62676-4 levels of the streets differ by luminance
// (so that they read without colour vision), the darker means the more filmed in light and
// in dark (street levels, communes and départements as drawn), every label is the ink on the
// map's halo, and the switch of the map between light and dark (theme.colourMap) maps each
// colour to one colour, both ways.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { LineLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { edgeCasings, edged, PATH_EDGE, ROAD_NAME_FONT, ROAD_NAME_MIN } from "../src/roadedge.ts";
import { colourMap, normalHex, over, paletteFrom } from "../src/theme.ts";

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
// The punk theme as the page gets it: its entry (theme.ts imports it) inlines its files in
// the order of its @import lines, one stylesheet.
const PUNK_DIR = "theme/punk";
const PUNK_ENTRY = src(`${PUNK_DIR}/punk.css`);
const PUNK_FILES = [...PUNK_ENTRY.matchAll(/@import\s+"\.\/([\w-]+\.css)";/g)].map((m) => m[1]);
const PUNK = PUNK_FILES.map((f) => src(`${PUNK_DIR}/${f}`)).join("\n");

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

const punkLight = block(PUNK, ':root[data-ui="punk"]');
const punkDark = block(PUNK, ':root[data-ui="punk"][data-mode="dark"]');
const light = punkLight;
const dark = new Map([...light, ...punkDark]);

// The opacities layers.ts draws with (read from its source: it needs a browser to run);
// a theme may set the areas' own (--map-area-opacity: punk, 1 in light and dark).
const LAYERS = src("layers.ts");
const AREA_OPACITY = Number(LAYERS.match(/const AREA_OPACITY = ([\d.]+);/)?.[1]);
assert.ok(AREA_OPACITY > 0 && AREA_OPACITY <= 1, "layers.ts AREA_OPACITY");
const areaAlpha = (tokens: Map<string, string>) =>
  Number(tokens.get("--map-area-opacity") ?? AREA_OPACITY);
/** The five classes of communes and départements as drawn over the basemap's earth. */
const areasDrawn = (tokens: Map<string, string>) =>
  [1, 2, 3, 4, 5].map((i) =>
    over(
      tokens.get(`--map-area-${i}`) as string,
      areaAlpha(tokens),
      tokens.get("--basemap-earth") as string,
    ),
  );
const STREETS_OPACITY = Number(LAYERS.match(/const STREETS_OPACITY = fadeIn\(\[[^\]]+\], ([\d.]+)\)/)?.[1]);
assert.ok(STREETS_OPACITY > 0 && STREETS_OPACITY <= 1, "layers.ts STREETS_OPACITY");

const isColour = (v: string) => /^(#[0-9a-f]{3,8}|rgba?\()/i.test(v);
/** The flavour's fills a street is drawn with (Protomaps 5.7 keys). */
const ROADS = [
  ...["highway", "major", "link", "minor_a", "minor_b", "minor_service", "other", "pedestrian"],
  ...["highway", "major", "link", "minor", "other"].flatMap((k) => [`bridges_${k}`, `tunnel_${k}`]),
];

function rgb(colour: string): [number, number, number] {
  let h = colour.slice(1);
  if (h.length <= 4) h = [...h].map((d) => d + d).join("");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(colour: string): number {
  const [r, g, b] = rgb(colour).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test("the punk entry imports every file of its folder once, tokens first, and nothing else", () => {
  const files = readdirSync(new URL(`../src/${PUNK_DIR}`, import.meta.url))
    .filter((f) => f.endsWith(".css") && f !== "punk.css")
    .sort();
  assert.deepEqual([...PUNK_FILES].sort(), files, "imported files against the folder");
  assert.equal(new Set(PUNK_FILES).size, PUNK_FILES.length, "a file imported twice");
  assert.equal(PUNK_FILES[0], "tokens.css");
  const rest = PUNK_ENTRY.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import\s+"[^"]+";/g, "");
  assert.equal(rest.trim(), "", "the entry holds only comments and @import lines");
});

const varsRead = (css: string) => new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
// Set by the code at run time (main.ts, bottomsheet.ts, review/camera.ts, machine.ts), with a
// fallback.
const RUNTIME = new Set(["--attrib-h", "--sheet-covered", "--foot-h", "--machine-top", "--ticket-bottom", "--digit"]);

// The only tokens are the punk theme's (the classique's theme/classic.css removed on
// 2026-10-23): every variable the shared styles (style.css, /revue's) and the punk rules
// read exists in light, and in dark too when it holds a colour (a dark page would otherwise
// show the light one).
test("every variable the styles read is defined by the punk tokens, in light and dark", () => {
  const used = new Set([
    ...varsRead(src("style.css")),
    ...varsRead(src("review/review.css")),
    ...varsRead(PUNK),
  ]);
  const missing = [...used].filter((v) => !punkLight.has(v) && !RUNTIME.has(v));
  assert.deepEqual(missing, []);
  const hasColour = (v: string) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(v);
  const lightOnly = [...used].filter(
    (v) => punkLight.has(v) && hasColour(punkLight.get(v) as string) && !punkDark.has(v),
  );
  assert.deepEqual(lightOnly, [], "colours read but not redefined in dark");
  assert.ok(punkLight.has("--focus") && punkDark.has("--focus"));
});

// The punk light blue (#7fd4ff) is 1.4:1 on the paper: in light it decorates (offset
// shadows, the grid; mockup 17a), never a text, a line or a fill that tells something on
// the paper. Every token whose light value holds it is read by the styles in a shadow or a
// background only, but --on-accent-2: the primary button's text on its ink (17a
// « Compléter », 11.5:1, in PAIRS below; product owner, 2026-10-07), read only by a rule
// that also sets that ink as its background. (The map's water, --basemap-water, is read by
// basemap.ts, not by a style.)
test("punk light: the light blue only decorates, or writes on the primary button's ink", () => {
  const blue = /#7fd4ff|rgba?\(\s*127,\s*212,\s*255\b/i;
  assert.match(punkLight.get("--on-accent-2") ?? "", blue, "17a writes « Compléter » in blue");
  const deco = new Set(
    [...punkLight]
      .filter(([k, v]) => blue.test(v) && k !== "--on-accent-2")
      .map(([k]) => k),
  );
  for (const r of styleRules(PUNK))
    if (/var\(--on-accent-2\)/.test(r.body))
      assert.match(r.body, /background(-color)?\s*:\s*var\(--accent-2-fill\)/, r.selector);
  assert.ok(deco.has("--shadow-ticket-off") && deco.has("--grid-line"), "decoration tokens");
  const allowed = /^(box-shadow|text-shadow|filter|background|background-image)$/;
  const misused: string[] = [];
  for (const [file, css] of [
    ["style.css", src("style.css")],
    ["review/review.css", src("review/review.css")],
    [PUNK_DIR, PUNK],
  ]) {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of bare.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g))
      for (const v of varsRead(m[2]))
        if (deco.has(v) && !allowed.test(m[1])) misused.push(`${file}: ${m[1]}: ${m[2].trim()}`);
  }
  assert.deepEqual(misused, []);
});

// [foreground, background, minimum]: text 4.5:1; controls, graphics and large text 3:1.
const TEXT = 4.5;
const GRAPHIC = 3;
const PAIRS: [string, string, number][] = [
  ["--fg", "--bg", TEXT],
  ["--fg", "--bg-2", TEXT],
  ["--fg", "--page", TEXT],
  ["--muted", "--bg", TEXT],
  ["--muted", "--bg-2", TEXT],
  ["--accent", "--bg", TEXT],
  ["--accent", "--bg-2", TEXT],
  ["--accent", "--accent-press", TEXT],
  ["--on-accent", "--accent-fill", TEXT],
  ["--warn", "--bg", TEXT],
  ["--on-warn", "--warn-fill", TEXT],
  ["--fg", "--warn-bg", TEXT],
  ["--fg", "--conflict-bg", TEXT],
  ["--fg", "--cnil-bg", TEXT],
  ["--blue", "--bg", TEXT],
  ["--fg", "--proposal-bg", TEXT],
  ["--ok", "--bg", TEXT],
  ["--bad", "--bg", TEXT],
  ["--fg", "--pick-bg", TEXT],
  ["--fg", "--tag-bg", TEXT],
  ["--debug-fg", "--debug-bg", TEXT],
  ["--line", "--bg", GRAPHIC],
  ["--focus", "--bg", GRAPHIC],
  ["--focus", "--basemap-earth", GRAPHIC],
  ["--accent-fill", "--bg", 1],
  // One palette (DECISIONS 2026-10-08, « One palette… », « The more vivid… »): the fills go
  // from pale to vivid, 3:1 comes from the outline (--map-field-line), the edge of the
  // fields and of the open area: on the earth, and a higher level's outline over a lower
  // level's ground (stickers.ts fieldPattern, layers.ts punkFields).
  ["--map-field-line", "--basemap-earth", GRAPHIC],
  ["--map-field-line", "--map-field-1", GRAPHIC],
  ["--map-field-line", "--map-field-2", GRAPHIC],
  ["--map-area-line", "--basemap-earth", GRAPHIC],
  ["--map-picto", "--basemap-earth", GRAPHIC],
  ["--map-picto", "--map-halo", GRAPHIC],
  ["--map-me", "--basemap-earth", GRAPHIC],
  ["--map-proposal", "--basemap-earth", GRAPHIC],
  ["--map-gone", "--basemap-earth", GRAPHIC],
  // (The unfilmed street is no longer 3:1 on the earth: it lies close to the roads, so that
  // « détecter » stands apart from it; see « a filmed street apart from the unfilmed grey ».)
  ["--map-label", "--map-halo", TEXT],
  ["--basemap-city_label", "--basemap-city_label_halo", TEXT],
  ["--basemap-subplace_label", "--basemap-earth", TEXT],
  ["--basemap-roads_label_minor", "--basemap-minor_a", TEXT],
  ["--basemap-roads_label_major", "--basemap-major", TEXT],
  // The second accent (punk only, mockup 17a): the primary button's text on it, its edge on
  // the surfaces, and the links' underline (what tells a link). Its decorations (offsets,
  // tickets' shadows, the grid) carry nothing: see the light blue's test below.
  ["--on-accent-2", "--accent-2-fill", TEXT],
  ["--accent-2-fill", "--bg", GRAPHIC],
  ["--accent-2-fill", "--bg-2", GRAPHIC],
  ["--link-line", "--bg", GRAPHIC],
  ["--link-line", "--bg-2", GRAPHIC],
  // The map's screen (lot 3.1, mockups 20a, 18a, 17a): the machine's paper and its keys,
  // the cut-out title's pieces, the counter and its drums, the yellow tags (count labels,
  // « Tout réafficher », « Zoomer ici »), « BOUM ! »; on the map, the level's label and the
  // « maybe gone » marker (its dashed ring on the ground, its « ? » on its disc).
  ["--fg", "--machine-paper", TEXT],
  ["--line", "--machine-paper", GRAPHIC],
  ["--fg", "--key-off", TEXT],
  ["--line", "--key-off", GRAPHIC],
  ["--machine-paper", "--line", TEXT],
  ["--on-tag", "--paper-blue", TEXT],
  ["--accent", "--machine-paper", TEXT],
  ["--on-tag", "--tag", TEXT],
  ["--boom-ink", "--boom-bg", TEXT],
  ["--map-tag-ink", "--map-tag", TEXT],
  ["--map-maybe-ring", "--basemap-earth", GRAPHIC],
  ["--map-maybe-mark", "--map-maybe-disc", GRAPHIC],
  ["--map-maybe-disc", "--basemap-earth", GRAPHIC],
  // The register (lot R1a): each document badge's ink on its fill, the drones' blue as a
  // graphic on the surfaces, text on the soft fill of a selected or striped row. The gold
  // and the green are fills only (2.67:1 and 4.39:1 on the paper): never a text colour.
  ["--ao-ink", "--ao", TEXT],
  ["--aut-ink", "--aut", TEXT],
  ["--sub-ink", "--sub", TEXT],
  ["--drone", "--bg", GRAPHIC],
  ["--drone", "--bg-2", GRAPHIC],
  ["--fg", "--soft", TEXT],
  ["--muted", "--soft", TEXT],
];

for (const [name, tokens] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`punk ${name}: contrast of text and graphics`, () => {
    const opaque = (v: string) =>
      v.startsWith("rgba") ? `#${v.match(/\d+/g)?.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : v;
    const failures = PAIRS.map(([fg, bg, min]) => {
      const [a, b] = [tokens.get(fg), tokens.get(bg)];
      assert.ok(a && b, `${fg} or ${bg} undefined`);
      const ratio = contrast(opaque(a), opaque(b));
      return ratio >= min ? null : `${fg} ${a} on ${bg} ${b}: ${ratio.toFixed(2)} < ${min}`;
    }).filter(Boolean);
    assert.deepEqual(failures, []);
  });

  // 20a's tape (« correction en attente », lot 3.1) is the mockup's yellow without an edge:
  // it lies across a sticker, so one of its neighbours at least gives it 3:1 (WCAG 1.4.11),
  // the sticker's ink in light (the ground is pale), the ground in dark (the sticker cream).
  test(`punk ${name}: the pending tape stands out from the sticker or the ground`, () => {
    const tape = tokens.get("--map-tape") as string;
    const best = Math.max(
      contrast(tape, tokens.get("--map-picto") as string),
      contrast(tape, tokens.get("--basemap-earth") as string),
    );
    assert.ok(best >= GRAPHIC, `tape ${tape}: ${best.toFixed(2)}`);
  });

  test(`punk ${name}: the street levels differ by luminance`, () => {
    const lv = ["--map-level-1", "--map-level-2", "--map-level-3"].map(
      (k) => tokens.get(k) as string,
    );
    // Detection, recognition and identification: 1.5:1 between neighbours (a step of
    // lightness that holds for every colour vision) [threshold chosen for the theme].
    assert.ok(contrast(lv[0], lv[1]) >= 1.5, `levels 1-2: ${contrast(lv[0], lv[1])}`);
    assert.ok(contrast(lv[1], lv[2]) >= 1.5, `levels 2-3: ${contrast(lv[1], lv[2])}`);
  });

  // A filmed street is one pink stroke of its level, without a casing (DECISIONS 2026-10-08,
  // « The more vivid… »: « plus de rue blanche avec un liseré rose »): the identify stroke
  // stands 3:1 on the earth and on whatever road the basemap draws there, bridges and
  // tunnels included (the theme's flavour as basemap.ts builds it, its --basemap-<key> over
  // the named flavour), the recognise one on the earth and every road above ground (light:
  // 2.6:1 on the darker tunnels); the detect stroke, the palest, cannot without darkening
  // the whole ramp: every ratio is printed (2.1:1 at least, to be judged on the palette
  // board), and a filmed street differs from the grey unfilmed one by its hue and width.
  test(`punk ${name}: the filmed streets 3:1 on the earth and every road under them`, (t) => {
    const flavour = { ...namedFlavor(tokens.get("--basemap") as string) } as Record<
      string,
      unknown
    >;
    for (const k of Object.keys(flavour)) {
      const o = tokens.get(`--basemap-${k}`);
      if (o && typeof flavour[k] === "string") flavour[k] = o;
    }
    const missing = ROADS.filter((k) => typeof flavour[k] !== "string");
    assert.deepEqual(missing, [], "road keys the flavour no longer has");
    const grounds = ["earth", ...ROADS].map((k) => [k, normalHex(flavour[k] as string)]);
    const failures = [2, 3].flatMap((i) => {
      const level = tokens.get(`--map-level-${i}`) as string;
      return grounds
        .filter(([k]) => i === 3 || !k.startsWith("tunnel"))
        .map(([k, c]) => [k, contrast(level, c)] as const)
        .filter(([, r]) => r < GRAPHIC)
        .map(([k, r]) => `level ${i} ${level} on ${k}: ${r.toFixed(2)}`);
    });
    assert.deepEqual(failures, []);
    const measured = [1, 2, 3].map((i) => {
      const level = tokens.get(`--map-level-${i}`) as string;
      const low = grounds
        .map(([k, c]) => [k, contrast(level, c)] as const)
        .reduce((a, b) => (b[1] < a[1] ? b : a));
      return `level ${i} ${level}: lowest ${low[1].toFixed(2)} on ${low[0]}`;
    });
    t.diagnostic(measured.join("; "));
  });

  // An unfilmed street is grey, drawn at layers.ts STREETS_OPACITY over its road, close to
  // it (DECISIONS 2026-10-08, « The palette of the second round is validated »: lighter, so
  // that « détecter » differs from it by luminance, not by hue alone). The decision asks for
  // 3:1; the palette left as it is cannot give it: the detect stroke itself stands only
  // 2.5:1 (light) and 2.1:1 (dark) on the main roads, and an unfilmed street drawn as the
  // road (or, in dark, black: 2.99:1) would stay under 3:1. The grey holds « détecter »
  // 2:1 from it on every road a street lies on [the floor the palette allows; printed beside
  // « détecter » on the road itself], and the identify stroke 1.5:1 as before.
  test(`punk ${name}: a filmed street apart from the unfilmed grey as drawn`, (t) => {
    const get = (k: string) => tokens.get(k) as string;
    const measured: string[] = [];
    for (const road of ["--basemap-major", "--basemap-minor_a", "--basemap-other"]) {
      const grey = over(get("--map-street-none"), STREETS_OPACITY, get(road));
      const at = `on ${road.slice(10)} ${grey}`;
      const detect = contrast(get("--map-level-1"), grey);
      assert.ok(detect >= 2, `level 1 / grey ${at}: ${detect.toFixed(2)}`);
      const identify = contrast(get("--map-level-3"), grey);
      assert.ok(identify >= 1.5, `level 3 / grey ${at}: ${identify.toFixed(2)}`);
      for (const i of [1, 2, 3]) {
        const level = get(`--map-level-${i}`);
        measured.push(`level ${i} / grey ${at}: ${contrast(level, grey).toFixed(2)}`);
      }
      measured.push(`level 1 on ${road.slice(10)} itself: ${contrast(get("--map-level-1"), get(road)).toFixed(2)}`);
    }
    t.diagnostic(measured.join("; "));
  });

  // One palette, from pale to vivid (DECISIONS 2026-10-08, « One palette… »; supersedes for
  // punk « the darker, the more filmed » of 2026-10-06): the more filmed, the more vivid
  // (chroma, max − min of the channels, strictly rising) for the communes and départements
  // as drawn (opaque) and the street levels; in light the vivid end is darker, in dark it is
  // lighter; never pushed towards black: the most filmed is the vivid pink (chroma 0.7 at
  // least). Neighbouring classes 1.4:1 apart, spread evenly (product owner, 2026-10-08:
  // « écarte les classes pour que deux voisines se distinguent »; the first round held
  // 1.3). The street levels are the ramp's classes 3, 4, 5; the fields' grounds pale pinks
  // (light: never white) rising with the level, under the halftone.
  const AREA_STEP = 1.4;
  const chroma = (c: string) => {
    const v = [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16) / 255);
    return Math.max(...v) - Math.min(...v);
  };
  // The fields' levels differ by shape (DECISIONS 2026-10-08): the halftone's density, so
  // its dots must show on each level's ground, 1.5:1 at least [threshold chosen for the
  // theme: the dots are 2.2 to 2.7 px, a texture, not a sign]; and the outline's dash.
  test(`punk ${name}: the halftone's dots show on each field's ground`, (t) => {
    const dots = tokens.get("--map-dots") as string;
    const measured = [1, 2, 3].map((i) => {
      const ground = tokens.get(`--map-field-${i}`) as string;
      const r = contrast(dots, ground);
      assert.ok(r >= 1.5, `dots ${dots} on field ${i} ${ground}: ${r.toFixed(2)}`);
      return `field ${i} ${ground}: ${r.toFixed(2)}`;
    });
    t.diagnostic(measured.join("; "));
  });

  test(`punk ${name}: from pale to vivid, the more filmed (areas as drawn, street levels)`, () => {
    const get = (k: string) => tokens.get(k) as string;
    const area = areasDrawn(tokens);
    const levels = [1, 2, 3].map((i) => get(`--map-level-${i}`));
    const fields = [1, 2, 3].map((i) => get(`--map-field-${i}`));
    for (const ramp of [area, levels, fields])
      for (let i = 1; i < ramp.length; i++)
        assert.ok(chroma(ramp[i]) > chroma(ramp[i - 1]), `${ramp[i - 1]} then ${ramp[i]}: not more vivid`);
    assert.ok(chroma(area[4]) >= 0.7, `the most filmed ${area[4]} is not vivid`);
    const darker = name === "light";
    for (let i = 1; i < area.length; i++) {
      const [a, b] = [area[i - 1], area[i]];
      assert.ok(
        darker ? luminance(b) < luminance(a) : luminance(b) > luminance(a),
        `areas ${i} ${a} and ${i + 1} ${b} out of order`,
      );
      assert.ok(contrast(a, b) >= AREA_STEP, `areas ${i}-${i + 1}: ${contrast(a, b).toFixed(3)} < ${AREA_STEP}`);
    }
    // One palette: the street levels are the classes 3, 4, 5.
    assert.deepEqual(levels, [area[2], area[3], area[4]]);
    // Light: no field ground is white (the earth's paper reads through it otherwise).
    if (darker) for (const f of fields) assert.ok(chroma(f) >= 0.12, `field ground ${f} reads white`);
    // Kept portions and the focused camera's street take the levels' places.
    assert.equal(get("--map-kept"), get("--map-level-2"));
    assert.equal(get("--map-focus-street"), get("--map-level-3"));
  });

  // Communes and départements are cut apart by a thin light-blue border, 17a's sky #7fd4ff
  // in both modes (DECISIONS 2026-10-08, « The more vivid… »); in dark one step off it, which
  // is --map-me there (theme.colourMap, one for one). Its contrast on each class is printed.
  test(`punk ${name}: the areas' thin border is 17a's sky`, (t) => {
    const border = tokens.get("--map-area-border") as string;
    const off = [1, 3, 5].map(
      (i) => Number.parseInt(border.slice(i, i + 2), 16) - Number.parseInt("7fd4ff".slice(i - 1, i + 1), 16),
    );
    assert.ok(off.every((d) => Math.abs(d) <= 1), `${border} is not #7fd4ff`);
    t.diagnostic(areasDrawn(tokens).map((c, i) => `class ${i + 1}: ${contrast(border, c).toFixed(2)}`).join(", "));
  });

  // In focus the other fields take one opaque dimmed colour (layers.ts fieldPaint): duller
  // than the palest ground, its outline duller than the fields' outline.
  test(`punk ${name}: the dimmed fields are duller than every ground`, () => {
    const get = (k: string) => tokens.get(k) as string;
    const dim = get("--map-field-dim");
    assert.match(dim, /^#[0-9a-f]{6}$/, "opaque");
    for (const i of [1, 2, 3]) assert.ok(chroma(dim) < chroma(get(`--map-field-${i}`)), `dim / field ${i}`);
    assert.ok(chroma(get("--map-field-dim-line")) < chroma(get("--map-field-line")), "dim outline");
  });
}

// Communes and départements opaque in punk, light and dark (product owner, 2026-10-06: no
// more mixing with the basemap; the legend's swatches, palette().area, are then the map's
// colours).
test("punk draws the areas opaque in light and dark", () => {
  assert.equal(areaAlpha(light), 1);
  assert.equal(areaAlpha(dark), 1);
});

// The "no camera" communes keep their hatching (--map-hatch-none stripes, 2 px every 8 px,
// at layers.ts's 0.6 over the earth), apart from the darkest class, the most filmed: the
// stripes stand 2:1 from it at least [threshold chosen for the theme], blue against
// magenta, the pattern doing the rest; the mean of a hatched commune (the stripes cover
// about 35 % of it: 2 px wide, 8 / sqrt 2 px apart) is printed (opaque dark classes tile
// the land down to a deep wine, close to the night's earth in luminance).
for (const [name, tokens] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`punk ${name}: the "no camera" hatching apart from the darkest class`, (t) => {
    const earth = tokens.get("--basemap-earth") as string;
    // The most filmed class (the most vivid, DECISIONS 2026-10-08), the one a hatched
    // commune must never be taken for.
    const darkest = areasDrawn(tokens)[4];
    const hatch = tokens.get("--map-hatch-none") as string;
    const alpha = hatch.length > 7 ? Number.parseInt(hatch.slice(7), 16) / 255 : 1;
    const stripe = over(hatch.slice(0, 7), alpha * 0.6, earth);
    const mean = over(stripe, 0.35, earth);
    const [toMean, toStripe] = [contrast(darkest, mean), contrast(darkest, stripe)];
    t.diagnostic(
      `darkest ${darkest}: against the hatching's mean ${mean} ${toMean.toFixed(2)}, its ` +
        `stripe ${stripe} ${toStripe.toFixed(2)}`,
    );
    assert.ok(toStripe >= 2, `darkest ${darkest} against the stripe ${stripe}: ${toStripe}`);
  });
}

// The focused camera's marker below the street level (layers.ts focusMarkerLayers), a disc
// of the map's halo edged in --map-ink, sits on the earth or on any class of communes as
// drawn: its edge or its disc stands 3:1 on each (dark: the cream edge on the darker
// classes, the dark disc on the lighter ones).
for (const [name, tokens] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`punk ${name}: the focus marker reads on the earth and every area class`, () => {
    const get = (k: string) => tokens.get(k) as string;
    const [ink, halo, earth] = [get("--map-ink"), get("--map-halo"), get("--basemap-earth")];
    const grounds = [earth, ...areasDrawn(tokens)];
    const failures = grounds
      .map((g) => [g, Math.max(contrast(ink, g), contrast(halo, g))] as const)
      .filter(([, ratio]) => ratio < GRAPHIC)
      .map(([g, ratio]) => `marker on ${g}: ${ratio.toFixed(2)}`);
    assert.deepEqual(failures, []);
  });
}

// Names, one colour everywhere (product owner, 2026-10-06): every label of the basemap
// (basemap.ts applies --map-label on --map-halo to each text layer) and the reach labels
// (--map-label) in the ink, on an opaque halo of the map's paper. The glyph sits on its
// halo: the ink against the halo is what is read, 4.5:1, whatever lies under the label;
// against the communes and filmed streets without a halo it is printed, for information.
const LABEL_KEYS = Object.keys(namedFlavor("light")).filter((k) => /_label(_minor|_major)?$/.test(k));
const HALO_KEYS = Object.keys(namedFlavor("light")).filter((k) =>
  /_label(_minor|_major)?_halo$/.test(k),
);
for (const [name, tokens] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`punk ${name}: every label in the ink, on the map's halo at 4.5:1`, (t) => {
    const get = (k: string) => tokens.get(k) as string;
    const [ink, halo] = [get("--map-ink"), get("--map-halo")];
    assert.equal(get("--map-label"), ink, "the reach labels' colour is the ink");
    assert.ok(LABEL_KEYS.length >= 8 && HALO_KEYS.length >= 6, "the flavour's label keys");
    const off = [
      ...LABEL_KEYS.filter((k) => tokens.get(`--basemap-${k}`) !== ink),
      ...HALO_KEYS.filter((k) => tokens.get(`--basemap-${k}`) !== halo),
    ];
    assert.deepEqual(off, [], "label tokens other than the ink on the halo");
    // At least twice the flavour's 1 px, at most what MapLibre draws around the smallest
    // label (a quarter of the size: 8 px quarter names at z11; style spec, text-halo-width).
    const width = Number(get("--map-label-halo-width"));
    assert.ok(width >= 2 && width <= 8 / 4, `--map-label-halo-width ${width}`);
    assert.ok(contrast(ink, halo) >= TEXT, `ink on halo ${contrast(ink, halo).toFixed(2)}`);
    const bare = [
      ...[1, 2, 3, 4, 5].map((i) => [`area ${i}`, areasDrawn(tokens)[i - 1]]),
      ...[1, 2, 3].map((i) => [`level ${i}`, get(`--map-level-${i}`)]),
    ];
    t.diagnostic(
      `ink ${ink} on halo ${halo} ${contrast(ink, halo).toFixed(2)}; without halo: ` +
        bare.map(([k, c]) => `${k} ${c} ${contrast(ink, c).toFixed(2)}`).join(", "),
    );
  });
}
// The roads read on the earth (lot U2, the owner's « B », 2026-10-19): every casing above
// ground and the paths' own in one edge colour, 3:1 (WCAG 1.4.11) on the earth, every park,
// wood and scrub, and the palest field (the roads are lifted above the fields from z15).
// The white roads stood 1.02 to 1.38:1 on what they cross.
for (const [name, tokens] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`punk ${name}: the roads' edge 3:1 on the earth, the parks and the palest field`, (t) => {
    const edge = tokens.get("--map-road-edge") as string;
    assert.ok(edge && isColour(edge), "--map-road-edge");
    const grounds = [
      ...["earth", "park_a", "park_b", "wood_a", "wood_b", "scrub_a", "scrub_b"].map(
        (k) => [k, tokens.get(`--basemap-${k}`) as string],
      ),
      ["field 1", tokens.get("--map-field-1") as string],
    ];
    const measured = grounds.map(([k, c]) => [k, contrast(edge, c)] as const);
    assert.deepEqual(
      measured.filter(([, r]) => r < GRAPHIC).map(([k, r]) => `${k}: ${r.toFixed(2)}`),
      [],
    );
    t.diagnostic(measured.map(([k, r]) => `${k} ${r.toFixed(2)}`).join(", "));
  });
}
// The map's dot screen lighter than the machine's paper (lot U2, the owner's « A2 »): the
// same light blue at 0.08 (light) and 0.05 (dark) of its 0.22 and 0.12 there.
test("punk: the map's dot screen lighter than the machine's paper, in light and dark", () => {
  const alpha = (v: string) => Number(v.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1]);
  for (const tokens of [light, dark]) {
    const [map, paper] = ["--map-paper-dots", "--paper-dots"].map((k) => tokens.get(k) as string);
    assert.equal(map.replace(/[\d.]+\)$/, ""), paper.replace(/[\d.]+\)$/, ""), "one blue");
    assert.ok(alpha(map) > 0 && alpha(map) <= 0.08 && alpha(map) < alpha(paper), map);
  }
});
test("the roads' edge: every casing above ground, a path's just under its line, the names in Medium", () => {
  for (const mode of ["light", "dark"]) {
    const flavour = { ...namedFlavor(mode) } as unknown as Record<string, unknown>;
    edgeCasings(flavour, "#6b6b6b");
    const casings = Object.keys(flavour).filter((k) => /_casing/.test(k));
    assert.ok(casings.length >= 12, "the flavour's casing keys");
    for (const k of casings)
      assert.equal(flavour[k] === "#6b6b6b", !k.startsWith("tunnel_"), `${mode} ${k}`);
    const plain = layers("protomaps", namedFlavor(mode), { lang: "fr" });
    const all = edged(plain, "#6b6b6b");
    const ids = all.map((l) => l.id);
    const at = ids.indexOf("roads_other");
    assert.equal(ids[at - 1], "roads_other_casing");
    assert.equal(ids.length, plain.length + 1);
    const casing = all[at - 1] as LineLayerSpecification;
    const path = all[at] as LineLayerSpecification;
    assert.equal(casing.paint?.["line-color"], "#6b6b6b");
    assert.equal(casing.paint?.["line-width"], PATH_EDGE);
    assert.deepEqual(casing.paint?.["line-gap-width"], path.paint?.["line-width"]);
    assert.deepEqual([casing.filter, casing.minzoom], [path.filter, path.minzoom]);
    for (const id of ["roads_labels_minor", "roads_labels_major"]) {
      const l = all.find((x) => x.id === id) as SymbolLayerSpecification;
      assert.deepEqual(l.layout?.["text-font"], [ROAD_NAME_FONT], id);
      assert.ok((l.minzoom ?? 0) <= ROAD_NAME_MIN, `${id} from z${l.minzoom}`);
    }
  }
});
/** Every style rule of `css` with the at-rules it sits in (comments dropped). */
function styleRules(css: string): { at: string[]; selector: string; body: string }[] {
  const out: { at: string[]; selector: string; body: string }[] = [];
  const stack: string[] = [];
  let text = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      stack.push(text.trim());
      text = "";
    } else if (ch === "}") {
      const head = stack.pop() ?? "";
      if (!head.startsWith("@"))
        out.push({ at: stack.filter((h) => h.startsWith("@")), selector: head, body: text });
      text = "";
    } else if (ch === ";" && stack.length === 0) text = "";
    else text += ch;
  }
  return out;
}

// The punk buttons' motion (theme/punk/buttons.css; DECISIONS 2026-10-06, animations): no
// !important, transitions of listed properties (never all), every duration token 400 ms at
// most, every hover where a pointer hovers and motion is welcome, every move (translate,
// rotate, scale) and transition only where motion is welcome, the press a move like the
// others (a press under less motion only changes a shadow).
// Fixed decorations of the punk theme: a transform that never changes (no state, no
// transition), allowed outside the motion query.
const FIXED_DECOR = new Set([
  ':root[data-ui="punk"] #sheet .chip-tag',
  // The camera sheet after 17a (lot 3.2, theme/punk/sheet.css and chips.css): the sheet
  // tilted 1° on a wide screen (straight on a phone), its two tapes, the stamps, the
  // « Supposé » box, the « ? » of a default value and of « Compléter ».
  ':root[data-ui="punk"] #sheet:has(> .sheet-frame)',
  ':root[data-ui="punk"] #sheet:has(> .sheet-frame)::before',
  ':root[data-ui="punk"] #sheet:has(> .sheet-frame)::after',
  ':root[data-ui="punk"] #sheet .sheet-stamp',
  ':root[data-ui="punk"] #sheet .sheet-stamp.gone',
  ':root[data-ui="punk"] #sheet .sheet-assumed',
  ':root[data-ui="punk"] #sheet .fact .q',
  ':root[data-ui="punk"] #sheet #part-complete::after',
  // Adding and « Modifier » (lot 3.4, theme/punk/participate.css): 3a's paper tilted 0.8°
  // (straight on a phone), its tapes, ← and ×, the source tags, the « Corrigé » stamp, the
  // bearing's tag, the « ? » of its button, 4a's position ticket, the shape tiles' tilts,
  // the pin's sticker, the ← or × over the map on a phone.
  ':root[data-ui="punk"] #modify-panel',
  ':root[data-ui="punk"] #modify-panel .modify-tape.left',
  ':root[data-ui="punk"] #modify-panel .modify-tape.right',
  ':root[data-ui="punk"]\n    #modify-panel:is([data-view="aim"], [data-view="position"], [data-view="done"])\n    .modify-tape.left',
  ':root[data-ui="punk"] #modify-panel .modify-position',
  ':root[data-ui="punk"] #modify-panel .modify-tile',
  ':root[data-ui="punk"] #modify-panel .modify-tile:nth-child(2)',
  ':root[data-ui="punk"] #modify-panel .modify-tile:nth-child(3)',
  ':root[data-ui="punk"] #modify-panel .modify-tile:nth-child(4)',
  ':root[data-ui="punk"] #modify-panel .modify-tile:nth-child(5)',
  ':root[data-ui="punk"] #edit-pin .edit-pin-picto',
  ':root[data-ui="punk"] #edit-float',
  ':root[data-ui="punk"] #modify-panel .modify-back',
  ':root[data-ui="punk"] #modify-panel .modify-close',
  ':root[data-ui="punk"] #modify-panel .chip-tag',
  ':root[data-ui="punk"] #modify-panel .modify-stamp',
  ':root[data-ui="punk"] #modify-panel .modify-bearing',
  ':root[data-ui="punk"] #sheet #part-modify.asks::after',
]);

test("punk buttons: hover, press and motion as the norm says", () => {
  assert.equal((PUNK.match(/!important/g) ?? []).length, 0, "!important in the punk theme");
  const seconds = (v: string) =>
    v.endsWith("ms") ? Number.parseFloat(v) / 1000 : Number.parseFloat(v);
  for (const name of ["--dur-sheet", "--dur-button", "--dur-press"]) {
    const v = punkLight.get(name);
    assert.ok(v && seconds(v) > 0 && seconds(v) <= 0.4, `${name} ${v}`);
  }
  const rules = styleRules(PUNK);
  const hovering = (r: { at: string[] }) => r.at.some((a) => /\(hover:\s*hover\)/.test(a));
  const moving = (r: { at: string[] }) =>
    r.at.some((a) => /\(prefers-reduced-motion:\s*no-preference\)/.test(a));
  const failures: string[] = [];
  for (const r of rules) {
    const props = [...r.body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2]]);
    if (r.selector.includes(":hover") && !(hovering(r) && moving(r)))
      failures.push(`hover outside (hover: hover) and no-preference: ${r.selector}`);
    // Anything that moves or animates does so only when motion is welcome, but for the
    // fixed decorations named here, which have no state and never move (17a's tilted source
    // tag, the leader's offset): a state can come from a pseudo-class, an attribute or a
    // class, so every other rule is held to the query.
    for (const [p, v] of props) {
      if (/^(transition|animation)[\w-]*$/.test(p) && !moving(r))
        failures.push(`${p} outside no-preference: ${r.selector}`);
      if (/^(translate|rotate|scale|transform)$/.test(p) && !moving(r) && !FIXED_DECOR.has(r.selector))
        failures.push(`${p} outside no-preference: ${r.selector}`);
      if (/^transition(-property)?$/.test(p) && /\ball\b/.test(v))
        failures.push(`transition of all: ${r.selector}`);
      // A disabled button never moves: every hover or press that moves excludes it.
      if (/^(translate|rotate|scale)$/.test(p) && /:(hover|active)/.test(r.selector) && !/:not\([^)]*:disabled/.test(r.selector))
        failures.push(`${p} on a disabled button: ${r.selector}`);
    }
  }
  assert.deepEqual(failures, []);
  // The norm reaches the buttons of the map, the sheets and the panels.
  const buttons = rules.find((r) => moving(r) && /:active$/.test(r.selector))?.selector ?? "";
  for (const b of ["#estimate button", ".fab", "#sheet .close", ".part-btn", "button.panel-head"])
    assert.ok(buttons.includes(b), `${b} not pressed like the others`);
});

test("punk hides the same basemap layers in light and dark (a change of mode keeps them)", () => {
  const ids = (t: Map<string, string>) => (t.get("--basemap-hide") ?? "").split(/\s+/).sort();
  assert.deepEqual(ids(dark), ids(light));
  assert.ok(ids(light).includes("roads_shields"), "road shields drawn by punk");
});

// A change of mode swaps every colour of the map's style for the same token's colour in the
// new mode (main.ts restyle, theme.colourMap): the style holds colours, not token names,
// so each colour of one mode must become exactly one colour of the other, both ways (light
// to dark on the evening switch, dark to light on the morning one), the blends theme.ts
// derives (otherPicto, ghostPicto) included. The palettes are built by theme.paletteFrom,
// as the page builds them.
const paletteOf = (tokens: Map<string, string>) =>
  paletteFrom((name) => {
    const value = tokens.get(`--${name}`);
    assert.ok(value, `--${name} undefined`);
    return normalHex(value);
  });
for (const [what, from, to] of [
  ["light to dark", light, dark],
  ["dark to light", dark, light],
] as const) {
  test(`the map's colours switch ${what} one for one`, () => {
    const [a, b] = [paletteOf(from), paletteOf(to)];
    const clashes: string[] = [];
    const pairs = colourMap(a, b, (colour, kept, other) =>
      clashes.push(`${colour} becomes both ${kept} and ${other}`),
    );
    assert.deepEqual(clashes, []);
    // Hence every entry of the palette lands on its own entry in the other mode.
    const swapped = Object.entries(a).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.map((c) => pairs.get(c)) : pairs.get(v),
    ]);
    assert.deepEqual(Object.fromEntries(swapped), b);
  });
}
