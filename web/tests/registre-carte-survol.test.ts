// « Drones et algorithmes »: the hover on the site's map (drones.ts calque, v2.1 A1). A fake map
// counts every call the calque makes: once it is laid, the pointer moving over one zone changes one
// feature state and nothing else — no layer, no filter, no paint, no data, no camera.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CarteMin,
  calque,
  entieres,
  hachures,
  melange,
  type Site,
  TEINTES,
  TOUTE_LA_COMMUNE,
} from "../src/registre/drones.ts";

type Handler = (e: unknown) => void;
type Ft = { properties: Record<string, unknown> };

function fausseCarte() {
  const n: Record<string, number> = {};
  const count = (k: string) => {
    n[k] = (n[k] ?? 0) + 1;
  };
  const layers = new Set<string>();
  const sources = new Map<string, { setData(d: unknown): void }>();
  const handlers = new Map<string, Handler[]>();
  const states: { id: string | number | undefined; s: Record<string, unknown> }[] = [];
  let under: Ft[] = [];
  const style = new Map<string, string>();
  const images = new Set<string>();
  const map = {
    addSource(id: string) {
      count("addSource");
      sources.set(id, { setData: () => count("setData") });
    },
    getSource: (id: string) => sources.get(id),
    removeSource(id: string) {
      sources.delete(id);
    },
    addLayer(l: { id: string }) {
      count("addLayer");
      layers.add(l.id);
    },
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    removeLayer(id: string) {
      count("removeLayer");
      layers.delete(id);
    },
    setPaintProperty: () => count("setPaintProperty"),
    addImage(id: string) {
      count("addImage");
      images.add(id);
    },
    hasImage: (id: string) => images.has(id),
    removeImage(id: string) {
      images.delete(id);
    },
    setFilter: () => count("setFilter"),
    setLayoutProperty: () => count("setLayoutProperty"),
    setFeatureState(f: { id?: string | number }, s: Record<string, unknown>) {
      count("setFeatureState");
      states.push({ id: f.id, s });
    },
    queryRenderedFeatures: () => under,
    getCanvas: () => ({
      style: {
        setProperty: (k: string, v: string) => {
          count("cursor");
          style.set(k, v);
        },
        removeProperty: (k: string) => {
          count("cursor");
          style.delete(k);
        },
      },
    }),
    on(type: string, a: unknown, b?: unknown) {
      const f = (typeof a === "function" ? a : b) as Handler;
      handlers.set(type, [...(handlers.get(type) ?? []), f]);
    },
    off(type: string, a: unknown, b?: unknown) {
      const f = typeof a === "function" ? a : b;
      handlers.set(
        type,
        (handlers.get(type) ?? []).filter((h) => h !== f),
      );
    },
    // the camera: never moved by a hover
    easeTo: () => count("camera"),
    flyTo: () => count("camera"),
    jumpTo: () => count("camera"),
    fitBounds: () => count("camera"),
  };
  const fire = (type: string, e: unknown = { point: { x: 10, y: 10 } }) => {
    for (const h of handlers.get(type) ?? []) h(e);
  };
  return {
    map: map as unknown as CarteMin,
    n,
    states,
    style,
    fire,
    point(fts: Ft[]) {
      under = fts;
    },
    handlers,
  };
}

const carre = (x: number, y: number, d: number) => ({
  type: "Polygon" as const,
  coordinates: [
    [
      [x, y],
      [x + d, y],
      [x + d, y + d],
      [x, y + d],
      [x, y],
    ] as [number, number][],
  ],
});
const SITES: Site[] = [
  { id: "s1", kind: "drone", parts: { "69123": { in: carre(4.8, 45.7, 0.01) } } },
  { id: "s2", kind: "drone", parts: { "69123": { in: carre(4.8, 45.7, 0.05) } } },
  { id: "v1", kind: "vsa", parts: { "69123": { in: carre(4.9, 45.8, 0.01) } } },
];

function pose() {
  const f = fausseCarte();
  const vus: (string | null)[] = [];
  const L = calque(f.map, { insee: "69123", sites: SITES, teintes: TEINTES, onSurvol: (id) => vus.push(id) });
  L.heures({ s1: { heures: 4, n: 1, mots: "4 h · 1 arrêté" }, s2: { heures: 8, n: 2 }, v1: { heures: 2, n: 1 } });
  // from here on, only what the pointer causes is counted
  for (const k of Object.keys(f.n)) delete f.n[k];
  return { ...f, L, vus };
}

test("50 moves of the pointer over one zone: one change of state, nothing else touched", () => {
  const f = pose();
  f.point([{ properties: { id: "s1", a: 1 } }]);
  for (let i = 0; i < 50; i++) f.fire("mousemove", { point: { x: 10 + (i % 3), y: 10 } });
  assert.deepEqual(f.n, { setFeatureState: 1, cursor: 1 });
  assert.deepEqual(f.states, [{ id: "s1", s: { survol: true } }]);
  assert.deepEqual(f.vus, ["s1"]);
  assert.equal(f.style.get("cursor"), "pointer");
});

test("another zone: the old one let go and the new one hovered; leaving the map clears it", () => {
  const f = pose();
  f.point([{ properties: { id: "s1", a: 1 } }]);
  f.fire("mousemove");
  f.point([{ properties: { id: "v1", a: 1 } }]);
  for (let i = 0; i < 10; i++) f.fire("mousemove");
  assert.equal(f.n.setFeatureState, 3);
  f.point([]);
  for (let i = 0; i < 10; i++) f.fire("mousemove");
  assert.equal(f.n.setFeatureState, 4);
  assert.deepEqual(f.vus, ["s1", "v1", null]);
  assert.equal(f.style.has("cursor"), false);
  for (const k of ["setData", "setPaintProperty", "setFilter", "setLayoutProperty", "addLayer", "removeLayer", "camera"])
    assert.equal(f.n[k] ?? 0, 0, k);
});

test("overlapping zones under the pointer: always the smallest, whatever their order", () => {
  const f = pose();
  for (let i = 0; i < 20; i++) {
    const a = { properties: { id: "s2", a: 25 } };
    const b = { properties: { id: "s1", a: 1 } };
    f.point(i % 2 ? [a, b] : [b, a]);
    f.fire("mousemove");
  }
  assert.equal(f.n.setFeatureState, 1);
  assert.deepEqual(f.vus, ["s1"]);
});

test("the list's hover and the choice are states too, set once each, the others set back", () => {
  const f = pose();
  f.L.survoler(["s1"]);
  f.L.survoler(["s1"]);
  assert.equal(f.n.setFeatureState, 1);
  // the pointer on the same zone the list hovers: no second state
  f.point([{ properties: { id: "s1", a: 1 } }]);
  f.fire("mousemove");
  assert.equal(f.n.setFeatureState, 1);
  f.L.choisir(["s1"]);
  f.L.choisir(["s1"]);
  // s1 chosen, s2 and v1 set back
  assert.equal(f.n.setFeatureState, 4);
  f.L.choisir([]);
  assert.equal(f.n.setFeatureState, 7);
  assert.equal(f.n.setData ?? 0, 0);
  assert.equal(f.n.setPaintProperty ?? 0, 0);
});

test("leaving takes every listener away", () => {
  const f = pose();
  f.L.retirer();
  for (const k of ["mousemove", "mouseout", "click"]) assert.equal(f.handlers.get(k)?.length ?? 0, 0, k);
});

test("the colours: algorithms hatched in raw pixels, a zone set back towards the ground", () => {
  const h = hachures("#7fd4ff", 8);
  assert.equal(h.data.length, 8 * 8 * 4);
  const lit = (x: number, y: number) => h.data[(y * 8 + x) * 4 + 3] === 255;
  // two pixels of every row, on the rising diagonal, nothing else
  for (let y = 0; y < 8; y++) assert.equal([0, 1, 2, 3, 4, 5, 6, 7].filter((x) => lit(x, y)).length, 2);
  assert.ok(lit(0, 0) && lit(7, 1) && !lit(4, 0));
  assert.deepEqual([...h.data.slice(0, 4)], [0x7f, 0xd4, 0xff, 255]);
  assert.equal(melange("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(melange("#7fd4ff", "#f2efe6", 0), "#7fd4ff");
});

test("a zone over four fifths of the commune or more is the whole commune, not a volume (B1)", () => {
  const commune = carre(4.8, 45.7, 0.1).coordinates[0];
  const zone = (id: string, d: number): Site => ({
    id,
    kind: "drone",
    parts: { "69123": { in: carre(4.8, 45.7, d) } },
  });
  // shares of 100 %, 81 %, 64 % and 1 % of the commune's area
  const sites = [zone("tout", 0.1), zone("presque", 0.09), zone("grand", 0.08), zone("petit", 0.01)];
  assert.equal(TOUTE_LA_COMMUNE, 0.8);
  assert.deepEqual([...entieres(sites, "69123", commune)], ["tout", "presque"]);
  // no outline, no way to tell: every zone stays a volume
  assert.equal(entieres(sites, "69123", null).size, 0);
  // drawn: the whole one carries `e`, the volumes' layer leaves it out
  const f = fausseCarte();
  const data: unknown[] = [];
  const m = f.map as unknown as Record<string, unknown>;
  m.getSource = () => ({ setData: (x: unknown) => data.push(x) });
  const L = calque(f.map, { insee: "69123", sites, teintes: TEINTES });
  L.contour({ bbox: [4.8, 45.7, 4.9, 45.8], contour: commune });
  L.heures({ tout: { heures: 6, n: 1 }, petit: { heures: 2, n: 1 } });
  const last = data.at(-1) as { features: { properties: Record<string, unknown> }[] };
  const e = Object.fromEntries(last.features.map((x) => [x.properties.id, x.properties.e]));
  assert.deepEqual(e, { tout: true, petit: false });
  // the localised zone is the tallest: the whole one no longer sets the scale
  const h = Object.fromEntries(last.features.map((x) => [x.properties.id, x.properties.h as number]));
  assert.ok(h.petit > 250);
});
