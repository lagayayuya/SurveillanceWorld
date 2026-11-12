// Ju, 10/11: « des communes sans hachures alors qu'elles ont des arrêtés de drones » (Pantin: 6 acts,
// a black outline, no hatching). Two causes, both tested here: a commune without a map file of its
// own (`carte.decoupee` false: 134 of the 142 communes with drone acts on 10/11) has no outline, so
// the whole commune was never hatched; and the rule « sans jour choisi, une hachure légère ; le jour
// choisi, ou survolé, hachuré en plein ». Acts SYNTHETIC (example.org), shaped as Pantin's are.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CarteMin,
  COUCHES,
  calque,
  HACHURE_LEGERE,
  HACHURE_PLEINE,
  TEINTES,
} from "../src/registre/drones.ts";
import { readFileSync } from "node:fs";
import { setMessages } from "../src/registre/i18n.ts";
import {
  type Creneau,
  type NonDeduit,
  periodeHachuree,
  plageVol,
} from "../src/registre/vues/carte-outils.ts";

const DAY = 86_400_000;
const d = (s: string) => Date.parse(`${s}T00:00:00Z`);

/** A fake map that keeps each layer's filter and paint, with the site's admin tiles' source. */
function carte() {
  const layers = new Map<string, { filter?: unknown; paint: Record<string, unknown> }>();
  const sources = new Map<string, { data: unknown; setData(x: unknown): void }>();
  const map = {
    addSource(id: string, s: { data?: unknown }) {
      const src = {
        data: s.data,
        setData(x: unknown) {
          src.data = x;
        },
      };
      sources.set(id, src);
    },
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    addLayer(l: { id: string; filter?: unknown; paint?: Record<string, unknown> }) {
      layers.set(l.id, { filter: l.filter, paint: { ...(l.paint ?? {}) } });
    },
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    removeLayer: (id: string) => layers.delete(id),
    setPaintProperty(id: string, k: string, v: unknown) {
      const l = layers.get(id);
      if (l) l.paint[k] = v;
    },
    setFilter(id: string, f: unknown) {
      const l = layers.get(id);
      if (l) l.filter = f;
    },
    addImage() {},
    hasImage: () => false,
    removeImage() {},
    setFeatureState() {},
    queryRenderedFeatures: () => [],
    getCanvas: () => ({ style: { setProperty() {}, removeProperty() {} } }),
    project: (c: [number, number]) => ({ x: c[0], y: c[1] }),
    getZoom: () => 13,
    getPitch: () => 50,
    getStyle: () => ({ layers: [] }),
    on() {},
    off() {},
  };
  // the site's map holds its admin tiles before the view lays its layers
  map.addSource("admin", {});
  const codes = (id: string) => (layers.get(id)?.filter as [string, unknown, [string, string[]]])[2][1];
  const features = (id: string) =>
    (sources.get(id)?.data as { features: unknown[] } | undefined)?.features.length ?? 0;
  return { map: map as unknown as CarteMin, layers, codes, features };
}

const contour = {
  contour: [
    [2.39, 48.88],
    [2.42, 48.88],
    [2.42, 48.9],
    [2.39, 48.9],
  ] as [number, number][],
  bbox: [2.39, 48.88, 2.42, 48.9] as [number, number, number, number],
};

test("a commune without an outline is hatched from the site's commune shape (Pantin, 10/11)", () => {
  const f = carte();
  const L = calque(f.map, { insee: "93055", sites: [], teintes: TEINTES });
  assert.ok(f.layers.has(COUCHES.nonLueAdmin));
  assert.deepEqual(f.codes(COUCHES.nonLueAdmin), []);
  L.nonLue(true);
  // no outline: the admin tiles' shape of the commune, its code alone
  assert.deepEqual(f.codes(COUCHES.nonLueAdmin), ["93055"]);
  assert.equal(f.features("rg-cd-non-lue"), 0);
  L.nonLue(false);
  assert.deepEqual(f.codes(COUCHES.nonLueAdmin), []);
  // an outline that comes: its polygon hatched, the tiles' shape no more (never both)
  L.nonLue(true);
  L.contour(contour);
  assert.deepEqual(f.codes(COUCHES.nonLueAdmin), []);
  assert.equal(f.features("rg-cd-non-lue"), 1);
});

test("the hatchings light over the period, full for a day; a theme change keeps it (Ju, 10/11)", () => {
  const f = carte();
  const L = calque(f.map, { insee: "93055", sites: [], teintes: TEINTES });
  const ids = [COUCHES.secteur, COUCHES.nonLue, COUCHES.nonLueAdmin, COUCHES.arrondissement];
  const op = () => ids.map((id) => f.layers.get(id)?.paint["fill-opacity"]);
  assert.deepEqual(op(), ids.map(() => HACHURE_LEGERE));
  L.plein(true);
  assert.deepEqual(op(), ids.map(() => HACHURE_PLEINE));
  // the theme's colours again: every paint property is set anew, the full hatching stays
  L.encre(TEINTES);
  assert.deepEqual(op(), ids.map(() => HACHURE_PLEINE));
  L.plein(false);
  L.encre(TEINTES);
  assert.deepEqual(op(), ids.map(() => HACHURE_LEGERE));
  assert.ok(HACHURE_LEGERE < HACHURE_PLEINE);
});

test("the period hatched light, the day chosen or hovered full, an empty hovered day the period's", () => {
  // Pantin's acts as served on 10/11: one day each, no place drawn
  const acte = (id: string, jour: string, extra: Partial<NonDeduit> = {}): NonDeduit => ({
    acte: id,
    kind: "drone",
    date: jour,
    url: "https://example.org/recueil.pdf",
    page: null,
    raisons: ["zone_non_deduite"],
    zone: "plan_annexe",
    jours: [jour],
    ...extra,
  });
  const ND = [
    acte("a", "2026-10-05", { secteur_niveau: "commune", secteur_insee: ["93001", "93055"] }),
    acte("b", "2025-10-24"),
    acte("c", "2025-10-23", { secteur_niveau: "non_lu" }),
  ];
  const h = (r: [number, number] | null, survol: number | null) =>
    periodeHachuree([], ND, r, survol, null, "93055", {});
  // no day: the period, light
  assert.deepEqual(h(null, null), { r: null, plein: false });
  const an: [number, number] = [d("2025-11-10"), d("2026-11-11")];
  assert.deepEqual(h(an, null), { r: an, plein: false });
  // a day chosen: full
  const j: [number, number] = [d("2026-10-05"), d("2026-10-05") + DAY];
  assert.deepEqual(h(j, null), { r: j, plein: true });
  // a day hovered with an act: that day, full
  assert.deepEqual(h(null, d("2025-10-24")), { r: [d("2025-10-24"), d("2025-10-25")], plein: true });
  // a day hovered without any act: the period's light hatching stays (no blink)
  assert.deepEqual(h(null, d("2026-10-06")), { r: null, plein: false });
  // the kind shown: an act of the other kind hatches nothing that day
  assert.deepEqual(periodeHachuree([], ND, null, d("2026-10-05"), "vsa", "93055", {}), {
    r: null,
    plein: false,
  });
  // a drawn place that day counts as hatched
  const formes = { f1: { geometry: {} } };
  const lieu = acte("d", "2026-09-01", { lieux: [{ texte: "parc", genre: "lieu", forme: "f1" }] });
  assert.equal(periodeHachuree([], [lieu], null, d("2026-09-01"), null, "93055", formes).plein, true);
});

test("a slot's title says it is a flight, over one day or several, with hours or without (Ju, 10/11)", () => {
  const catalogue: Record<string, string> = JSON.parse(
    readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
  );
  setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
  const N = "\u00a0";
  const ms = (s: string) => Date.parse(`${s}Z`);
  const c = (t0: string, t1: string, heures: number | null): Creneau =>
    ({ t0: ms(t0), t1: ms(t1), heures, kind: "drone", actes: ["x"], sites: [], statut: "" }) as unknown as Creneau;
  // hours within a day
  assert.match(plageVol(c("2026-11-04T07:30", "2026-11-04T15:30", 8)), /^Vol le 4\u00a0nov\.\u00a02026/);
  // hours over two days: from … to …
  assert.match(plageVol(c("2026-10-23T19:00", "2026-10-25T07:00", 36)), /^Vol du 23\u00a0oct\.\u00a02026.* au 25\u00a0oct\.\u00a02026/);
  // without hours over four days, stored from Paris's midnight (Rhône, 10/11): its four days, no hour
  assert.equal(plageVol(c("2025-12-04T23:00", "2025-12-08T22:59", null)), `Vol du 5${N}déc.${N}2025 au 8${N}déc.${N}2025`);
  // the same from 00 h (as the hours are stored): the same days
  assert.equal(plageVol(c("2025-12-05T00:00", "2025-12-09T00:00", null)), `Vol du 5${N}déc.${N}2025 au 8${N}déc.${N}2025`);
  // one whole day, either way: that day
  assert.match(plageVol(c("2025-11-18T23:00", "2025-11-19T22:59", null)), /^Vol le 19\u00a0nov\.\u00a02025, horaires non précisés$/);
  assert.match(plageVol(c("2025-11-19T00:00", "2025-11-20T00:00", null)), /^Vol le 19\u00a0nov\.\u00a02025, horaires non précisés$/);
});
