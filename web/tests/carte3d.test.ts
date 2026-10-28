// The register's tilted commune map (src/registre/carte3d.ts): its pure parts (rings, inside,
// the hatches, the exaggeration curve, the frame fit, the labels' words), its catalogue keys,
// and the rules its source keeps (no markup string, MapLibre loaded by the first map only).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { LayerSpecification } from "maplibre-gl";
import {
  baseLayers,
  carteUrl,
  centroid,
  clipToScreen,
  DEFAULT_FOND,
  diagMetres,
  exag,
  fitZoom,
  hatch,
  hatchBlue,
  hoursLabel,
  inside,
  KEYS,
  type LonLat,
  mapLocale,
  maskFeature,
  PAL,
  palette,
  pointInCommune,
  rings,
  type Translate,
  volumeHeight,
} from "../src/registre/carte3d.ts";

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const FR = JSON.parse(src("locales/fr.json")) as Record<string, string>;
const SOURCE = src("registre/carte3d.ts");
// the catalogue's {name} placeholders, enough for these keys (no plural among them)
const t: Translate = (key, params = {}) => {
  assert.ok(key in FR, `fr.json has no ${key}`);
  return FR[key].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));
};
const square: LonLat[] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
  [0, 0],
];

test("rings: the outer ring of a polygon, of each part of a multipolygon, none otherwise", () => {
  const hole: LonLat[] = [
    [0.5, 0.5],
    [1, 0.5],
    [1, 1],
    [0.5, 0.5],
  ];
  assert.deepEqual(rings({ type: "Polygon", coordinates: [square, hole] }), [square]);
  assert.deepEqual(rings({ type: "MultiPolygon", coordinates: [[square, hole], [hole]] }), [
    square,
    hole,
  ]);
  assert.deepEqual(rings(undefined), []);
  assert.deepEqual(rings(null), []);
  assert.deepEqual(rings({ type: "Point", coordinates: [1, 1] }), []);
});

test("centroid: the mean of the vertices, [0, 0] for none", () => {
  assert.deepEqual(
    centroid([
      [
        [0, 0],
        [4, 0],
        [4, 2],
        [0, 2],
      ],
    ]),
    [2, 1],
  );
  assert.deepEqual(centroid([]), [0, 0]);
});

test("inside: even-odd, a concave ring's notch is outside", () => {
  assert.equal(inside([1, 1], square), true);
  assert.equal(inside([3, 1], square), false);
  assert.equal(inside([1, -0.1], square), false);
  // a U: the notch between its arms is outside
  const u: LonLat[] = [
    [0, 0],
    [3, 0],
    [3, 3],
    [2, 3],
    [2, 1],
    [1, 1],
    [1, 3],
    [0, 3],
    [0, 0],
  ];
  assert.equal(inside([0.5, 2], u), true);
  assert.equal(inside([1.5, 2], u), false);
  assert.equal(inside([1.5, 0.5], u), true);
});

test("pointInCommune reads the commune's outline", () => {
  assert.equal(pointInCommune({ contour: square }, [1.9, 0.1]), true);
  assert.equal(pointInCommune({ contour: square }, [2.1, 0.1]), false);
});

test("exag: 8 up to zoom 10, 5 at 12, 2.5 at 14, 1 from 16, linear in between", () => {
  assert.equal(exag(5), 8);
  assert.equal(exag(10), 8);
  assert.equal(exag(11), 6.5);
  assert.equal(exag(12), 5);
  assert.equal(exag(13), 3.75);
  assert.equal(exag(14), 2.5);
  assert.equal(exag(16), 1);
  assert.equal(exag(19), 1);
});

const pixel = (img: { width: number; data: Uint8Array }, x: number, y: number) => [
  ...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
];
test("hatch: 16 px, black then yellow diagonals", () => {
  const h = hatch();
  assert.equal(h.width, 16);
  assert.equal(h.height, 16);
  assert.equal(h.data.length, 16 * 16 * 4);
  assert.deepEqual(pixel(h, 0, 0), [17, 17, 17, 255]);
  assert.deepEqual(pixel(h, 3, 3), [17, 17, 17, 255]);
  assert.deepEqual(pixel(h, 4, 3), [255, 232, 0, 255]);
  assert.deepEqual(pixel(h, 15, 1), [17, 17, 17, 255]); // (15 + 1) % 16 = 0
});

test("hatchBlue: thin drone-blue diagonals on transparent, per theme", () => {
  const l = hatchBlue("light");
  const d = hatchBlue("dark");
  assert.deepEqual(pixel(l, 0, 0), [0, 96, 160, 255]);
  assert.deepEqual(pixel(l, 1, 0), [0, 96, 160, 255]);
  assert.deepEqual(pixel(l, 2, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(l, 4, 4), [0, 96, 160, 255]); // (4 + 4) % 8 = 0
  assert.deepEqual(pixel(d, 0, 0), [127, 212, 255, 255]);
});

test("fitZoom: the smallest scale of every bearing, the slab and the margins left", () => {
  const box = (sx: number, sy: number): [number, number][] => [
    [0, 0],
    [sx, 0],
    [sx, sy],
    [0, sy],
  ];
  // 232 × 241: (232 − 32) / 100 = 2, (241 − 32 − 9) / 100 = 2
  assert.equal(fitZoom([box(100, 100)], 232, 241), 1);
  // a second bearing twice as wide wins
  assert.equal(fitZoom([box(100, 100), box(200, 100)], 232, 241), 0);
  // no slab, no margin: 400 / 100
  assert.equal(fitZoom([box(100, 50)], 400, 400, 0, 0), 2);
});

test("clipToScreen: clip space to CSS pixels, y down", () => {
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.deepEqual(clipToScreen(id, 0, 0, 0, 200, 100), [100, 50]);
  assert.deepEqual(clipToScreen(id, 1, 1, 0, 200, 100), [200, 0]);
  assert.deepEqual(clipToScreen(id, -1, -1, 0, 200, 100), [0, 100]);
  // the perspective divide (w = 2)
  const half = [...id];
  half[15] = 2;
  assert.deepEqual(clipToScreen(half, 1, 1, 0, 200, 100), [150, 25]);
});

test("volumes: 20 m without hours, the highest at 18 % of the diagonal, 250 m at least", () => {
  assert.equal(Math.round(diagMetres([0, 0, 1, 0])), 111320);
  assert.equal(Math.round(diagMetres([0, 60, 1, 60])), 55660);
  assert.equal(volumeHeight(0, 10, 10000), 20);
  assert.equal(volumeHeight(10, 10, 10000), 20 + 1800);
  assert.equal(volumeHeight(5, 10, 10000), 20 + 900);
  assert.equal(volumeHeight(10, 10, 100), 20 + 250);
});

test("hoursLabel: one decimal under 10 h, the authorisations when more than one", () => {
  assert.equal(hoursLabel({ heures: 0, n: 2 }, t), "HORAIRES NON PRÉCISÉS");
  assert.equal(hoursLabel({ heures: 2.5, n: 1 }, t), "2,5 H");
  assert.equal(hoursLabel({ heures: 12.4, n: 3 }, t), "12 H · 3 AUTORISATIONS");
  assert.equal(hoursLabel({ heures: 1234, n: 1 }, t), "1 234 H");
  assert.equal(t("registre.carte.analyse", { texte: "4 H" }), "ANALYSE · 4 H");
});

test("mapLocale: MapLibre's strings from the catalogue, the title from the page if given", () => {
  const l = mapLocale(t);
  assert.equal(l["Map.Title"], "Carte");
  assert.equal(l["NavigationControl.ResetBearing"], "Remettre le nord en haut");
  for (const v of Object.values(l)) assert.ok(v && !v.startsWith("registre."));
  assert.equal(mapLocale(t, "Carte de Vaulx-en-Velin")["Map.Title"], "Carte de Vaulx-en-Velin");
});

test("palette: the page's frame (--bg-2) and ink (--fg), the map's own otherwise", () => {
  const tokens: Record<string, string> = { "--bg-2": " #26232a", "--fg": "#f2efe6 " };
  const p = palette("dark", (k) => tokens[k] ?? "");
  assert.equal(p.frame, "#26232a");
  assert.equal(p.line, "#f2efe6");
  assert.equal(p.dot, "#f2efe6");
  assert.equal(p.text, "#f2efe6");
  assert.equal(p.earth, PAL.dark.earth);
  assert.deepEqual(
    palette("light", () => ""),
    PAL.light,
  );
});

test("maskFeature: the world with the commune as its hole", () => {
  const m = maskFeature(square);
  const [outer, hole] = m.geometry.coordinates;
  assert.deepEqual(outer[0], outer[outer.length - 1]);
  assert.deepEqual(hole, square.slice().reverse());
  assert.deepEqual(square[1], [2, 0]); // the outline itself is left as it was
});

test("baseLayers: no label, boundary or 3D building, the map palette's colours", () => {
  const all = layers("protomaps", namedFlavor("grayscale"), { lang: "fr" }) as LayerSpecification[];
  const ls = baseLayers(PAL.light, all);
  assert.ok(ls.length > 10);
  for (const l of ls) {
    assert.notEqual(l.type, "symbol");
    assert.notEqual(l.type, "fill-extrusion");
    assert.ok(!l.id.startsWith("boundaries"), l.id);
  }
  const by = Object.fromEntries(ls.map((l) => [l.id, l]));
  const paint = (id: string) => (by[id] as { paint: Record<string, unknown> }).paint;
  assert.equal(paint("earth")["fill-color"], PAL.light.earth);
  assert.equal(paint("water")["fill-color"], PAL.light.water);
  assert.equal(paint("buildings")["fill-color"], PAL.light.bld);
  assert.equal(paint("buildings")["fill-opacity"], 1);
});

test("the site's paths: its France basemap, the register's commune JSON", () => {
  assert.equal(DEFAULT_FOND, "/basemap/basemap.pmtiles");
  assert.equal(carteUrl("69283"), "/data/registre/carte/69283.json");
});

test("every key the map uses is in fr.json, and listed in KEYS", () => {
  for (const k of KEYS) assert.ok(k in FR, `fr.json has no ${k}`);
  const used = new Set([...SOURCE.matchAll(/"(registre\.carte\.[A-Za-z]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), [...KEYS].sort());
});

test("the source: no markup string, no inline style attribute, no eval", () => {
  assert.doesNotMatch(SOURCE, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(SOURCE, /setAttribute\(\s*"style"/);
  assert.doesNotMatch(SOURCE, /\beval\(|new Function\(/);
});

test("the source: MapLibre, its CSS and the basemap's layers are loaded by the first map only", () => {
  const statics = [...SOURCE.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(statics, []);
  assert.doesNotMatch(SOURCE, /^import\s+"/m);
  assert.match(SOURCE, /import\("maplibre-gl"\)/);
  assert.match(SOURCE, /import\("@protomaps\/basemaps"\)/);
  assert.match(SOURCE, /import\("maplibre-gl\/dist\/maplibre-gl-worker\.mjs\?worker&url"\)/);
  assert.match(SOURCE, /import\("maplibre-gl\/dist\/maplibre-gl\.css"\)/);
});
