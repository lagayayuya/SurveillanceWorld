// « Carte et drones »'s pure helpers (vues/carte-outils.ts, drones.ts): the weeks and months of
// « Heures de vol autorisées, par semaine », the sums a period, a week or a site shows, the
// tickets, the reference line, the volumes' heights and words, the outline read from the head of
// the map file, a ?mois= read. Every slot below is SYNTHETIC: the extract keeps no period of
// flight (pipeline drones.py).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Donnees } from "../src/registre/commun.ts";
import { bboxOf, centroid, tete, valeur, volumeHeight } from "../src/registre/drones.ts";
import { setMessages, t } from "../src/registre/i18n.ts";
import {
  appareils,
  type Creneau,
  cles,
  DEBUT,
  deAdresse,
  lieux,
  plage,
  versAdresse,
  type ZoneLue,
  zonesDe,
  dansPeriode,
  dateTxt,
  drones,
  genre,
  heuresTxt,
  lundi,
  mois,
  moisAxe,
  type NonDeduit,
  repere,
  semaines,
  sitesHours,
  span,
  sumHours,
  tickets,
  volLabel,
} from "../src/registre/vues/carte-outils.ts";

const catalogue: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
);
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const N = "\u00a0";
const H = 3600_000;
const DAY = 24 * H;
const at = (day: string, hour: number) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
const slot = (o: Partial<Creneau> & { t0: number; t1: number }): Creneau => ({
  heures: null,
  kind: "drone",
  service: "Police nationale",
  finalite: null,
  url: null,
  actes: ["a1"],
  sites: ["s1"],
  statut: "relu",
  ...o,
});
const nd = (o: Partial<NonDeduit>): NonDeduit => ({
  acte: "n1",
  kind: "drone",
  date: "2026-10-20",
  url: null,
  ref: null,
  page: null,
  raisons: [],
  ...o,
});

test("?mois=YYYY-MM: that month, [start, end[; anything else: no period", () => {
  assert.deepEqual(mois("2026-10"), [Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 1)]);
  assert.deepEqual(mois("2025-12"), [Date.UTC(2025, 11, 1), Date.UTC(2026, 0, 1)]);
  for (const bad of ["", "2026-13", "2026-1", "26-10", "2026-10-01"]) assert.equal(mois(bad), null);
});

test("weeks start on Monday, UTC; the chart runs from the first slot's week to today's", () => {
  // 29 October 2026 is a Thursday
  assert.equal(lundi(at("2026-10-29", 15)), Date.UTC(2026, 9, 26));
  assert.equal(lundi(Date.UTC(2026, 9, 26)), Date.UTC(2026, 9, 26));
  assert.equal(lundi(at("2026-11-01", 23)), Date.UTC(2026, 9, 26));
  const today = Date.UTC(2026, 9, 29);
  assert.deepEqual(span([], today), { A: lundi(DEBUT), B: Date.UTC(2026, 10, 2) });
  const T = [slot({ t0: at("2025-11-14", 8), t1: at("2025-11-14", 20) })];
  assert.equal(span(T, today).A, Date.UTC(2025, 10, 10));
  // a slot that ends after today stretches the chart to its week's end
  const late = [slot({ t0: at("2026-10-28", 8), t1: at("2026-11-04", 8) })];
  assert.equal(span(late, today).B, Date.UTC(2026, 10, 9));
});

test("one bar per week: its hours are the slots' share of it, so the weeks add up to the period", () => {
  const A = Date.UTC(2026, 9, 5);
  const B = Date.UTC(2026, 9, 26);
  const T = [
    slot({ t0: at("2026-10-06", 9), t1: at("2026-10-06", 17), heures: 8, actes: ["a1"] }),
    // across Sunday night: half in each week
    slot({ t0: at("2026-10-18", 12), t1: at("2026-10-19", 12), heures: 24, actes: ["a2", "a3"] }),
    slot({ t0: at("2026-10-20", 9), t1: at("2026-10-20", 10), heures: null, actes: ["a4"] }),
  ];
  const w = semaines(T, A, B);
  assert.deepEqual(
    w.map((x) => [x.heures, x.actes]),
    [
      [8, 1],
      [12, 2],
      [12, 3],
    ],
  );
  assert.equal(
    w.reduce((s, x) => s + x.heures, 0),
    sumHours(T, [A, B]),
  );
});

test("months: clipped to the chart, the year on January and on the first month when no January", () => {
  const T = [slot({ t0: at("2025-12-02", 9), t1: at("2025-12-02", 13), heures: 4 })];
  const m = moisAxe(T, Date.UTC(2025, 10, 10), Date.UTC(2026, 2, 16));
  assert.deepEqual(
    m.map((x) => x.l),
    ["nov.", "déc.", "janv. 26", "févr.", "mars"],
  );
  assert.equal(m[0].t0, Date.UTC(2025, 10, 1));
  assert.equal(m[1].heures, 4);
  assert.deepEqual(
    moisAxe([], Date.UTC(2026, 3, 6), Date.UTC(2026, 5, 2)).map((x) => x.l),
    ["avr. 26", "mai", "juin"],
  );
});

test("the reference line: the tallest week rounded up, never under it, 10 h at least", () => {
  assert.equal(repere(0), 10);
  assert.equal(repere(7), 10);
  assert.equal(repere(36), 40);
  assert.equal(repere(118), 150);
  assert.equal(repere(437), 500);
  for (const x of [11, 99, 101, 1234, 9999]) assert.ok(repere(x) >= x);
});

test("the tickets: drone acts of the period, their hours, the acts whose zone was not deduced", () => {
  const T = [
    slot({ t0: at("2026-10-06", 9), t1: at("2026-10-06", 17), heures: 8, actes: ["a1", "a2"] }),
    slot({ t0: at("2026-10-07", 9), t1: at("2026-10-07", 13), heures: 4, actes: ["a2"] }),
    slot({ t0: at("2026-10-21", 9), t1: at("2026-10-21", 15), heures: 6, actes: ["a3"], sites: [] }),
    slot({ t0: at("2026-10-21", 9), t1: at("2026-10-21", 15), heures: 6, actes: ["v1"], kind: "vsa" }),
  ];
  const ND = [nd({ acte: "n1", date: "2026-10-20" }), nd({ acte: "n2", date: "2026-09-01" })];
  T.push(slot({ t0: at("2026-10-22", 9), t1: at("2026-10-22", 15), actes: ["a4"] }));
  assert.deepEqual(tickets(T, ND, null), { actes: 6, heures: 18, sansHoraires: 1, nonDeduites: 3 });
  const oct20 = [Date.UTC(2026, 9, 19), Date.UTC(2026, 9, 26)] as [number, number];
  assert.deepEqual(tickets(T, ND, oct20), { actes: 3, heures: 6, sansHoraires: 1, nonDeduites: 2 });
  assert.equal(dansPeriode(null, oct20), true);
  assert.equal(dansPeriode("2026-10-18", oct20), false);
  // the filter « algorithmes », then both kinds (A5)
  assert.deepEqual(tickets(T, ND, null, "vsa"), { actes: 1, heures: 6, sansHoraires: 0, nonDeduites: 0 });
  assert.deepEqual(tickets(T, ND, null, null), { actes: 7, heures: 24, sansHoraires: 1, nonDeduites: 3 });
  assert.equal(genre("vsa"), "vsa");
  assert.equal(genre("drone"), "drone");
  assert.equal(genre("tout"), null);
  assert.equal(genre(null), null);
});

test("the volumes: a slot once per site, its acts once, its share of a period, no hours still a volume", () => {
  const T = [
    slot({ t0: 0, t1: 8 * H, heures: 8, actes: ["a1", "a2"], sites: ["s1", "s2"] }),
    slot({ t0: 10 * H, t1: 14 * H, heures: 4, actes: ["a1"], sites: ["s1"] }),
    slot({ t0: 20 * H, t1: 23 * H, heures: null, actes: ["a3"], sites: ["s3"] }),
  ];
  const v = sitesHours(T);
  assert.deepEqual(v, {
    s1: { heures: 12, n: 2 },
    s2: { heures: 8, n: 2 },
    s3: { heures: 0, n: 1 },
  });
  assert.equal(sitesHours(T, [4 * H, 12 * H]).s1.heures, 6);
  // a site whose hours are not stated stands at the lowest height, the same for all
  const maxH = Math.max(...Object.values(v).map((x) => x.heures));
  assert.equal(volumeHeight(v.s3.heures, maxH, 5000), 20);
  assert.ok(volumeHeight(v.s1.heures, maxH, 5000) > volumeHeight(v.s2.heures, maxH, 5000));
  assert.equal(volLabel(v.s1), "12 h · 2 arrêtés");
  assert.equal(volLabel({ heures: 6, n: 1 }), "6 h · 1 arrêté");
  assert.equal(volLabel(v.s3), "horaires non précisés · 1 arrêté");
});

test("the outline from the head of the map file: read as soon as it has come, not before", () => {
  const head = '{"insee": "69123", "bbox": [4.77, 45.70, 4.89, 45.80], "contour": [[4.8, 45.7], [4.9';
  assert.equal(tete(head), null);
  const more = `${head}, 45.8], [4.85, 45.75]], "fov": {"type": "MultiPolygon", "coordinates": [[[[`;
  assert.deepEqual(tete(more), {
    bbox: [4.77, 45.7, 4.89, 45.8],
    contour: [
      [4.8, 45.7],
      [4.9, 45.8],
      [4.85, 45.75],
    ],
  });
  assert.equal(valeur('{"bbox":[1,2,3,4]}', "bbox"), "[1,2,3,4]");
  assert.equal(valeur('{"x": 1}', "bbox"), null);
  assert.deepEqual(centroid([[[0, 0], [2, 0], [2, 2], [0, 2]]]), [1, 1]);
  assert.equal(centroid([]), null);
  assert.deepEqual(bboxOf([[[0, 1], [2, -1]], [[5, 3]]]), [0, -1, 5, 3]);
});

test("the words: dates, hours, the chart's tooltip, the tickets, the list's title", () => {
  assert.equal(dateTxt(at("2026-10-23", 19)), `23${N}oct.${N}2026`);
  assert.equal(dateTxt(at("2026-10-23", 19), true), `23${N}oct.${N}2026, 19 h 00`);
  assert.equal(dateTxt(Date.UTC(2025, 10, 1)), `1er${N}nov.${N}2025`);
  assert.equal(heuresTxt(2.5), "2,5 h");
  assert.equal(heuresTxt(1367), `1${N}367 h`);
  assert.equal(t("carte.semaine_tip", { de: "20 oct.", h: "6 h", n: 2 }), "Semaine du 20 oct. : 6 h · 2 arrêtés");
  assert.equal(t("carte.semaine_tip", { de: "20 oct.", h: "0 h", n: 0 }), "Semaine du 20 oct. : 0 h");
  assert.equal(t("carte.t_arretes", { n: 50 }), "arrêtés drones");
  assert.equal(t("carte.t_nd", { n: 1 }), "zone non déduite");
  assert.equal(t("carte.liste_t", { n: 0 }), "Aucun créneau sur la période");
  assert.equal(t("carte.liste_t", { n: 57 }), "Les créneaux de la période · 57");
  assert.equal(t("carte.horaires_non_precises_arrete"), "horaires non précisés dans l'arrêté");
  assert.equal(t("arretes.zone_non_deduite"), "zone non déduite de l'arrêté");
  assert.ok(DAY > 0);
});

test("a commune file without `drones` (an older build) has no slot and no act listed", () => {
  assert.deepEqual(drones({ f: {} } as unknown as Donnees), { creneaux: [], non_deduits: [] });
  const f = { drones: { creneaux: [slot({ t0: 0, t1: H })], non_deduits: [] } };
  assert.equal(drones({ f } as unknown as Donnees).creneaux.length, 1);
});

test("a slot's key, its zones, its places, its devices, its times (A4, A8)", () => {
  const T = [
    slot({ t0: at("2026-10-07", 9), t1: at("2026-10-07", 13), heures: 4, actes: ["a1"] }),
    slot({ t0: at("2026-10-06", 9), t1: at("2026-10-06", 17), heures: 8, actes: ["a1"] }),
    slot({ t0: at("2026-10-06", 22), t1: at("2026-10-07", 2), heures: 4, actes: ["a2"] }),
  ];
  assert.deepEqual(cles(T), ["a1~2", "a1", "a2"]);
  assert.deepEqual(versAdresse("a1~2"), { acte: "a1", creneau: "2" });
  assert.deepEqual(versAdresse("a2"), { acte: "a2", creneau: null });
  assert.equal(deAdresse("a1", "2"), "a1~2");
  assert.equal(deAdresse("a1", "1"), "a1");
  assert.equal(deAdresse("a1", "x"), "a1");
  assert.equal(deAdresse(null, "2"), null);
  const z = (o: Partial<ZoneLue>): ZoneLue => ({ acte: "a1", t0: at("2026-10-06", 9), t1: at("2026-10-06", 17), ...o });
  const zs = [
    z({ detail: "Parc de la Tête d’Or", site: "s1", cameras: 1 }),
    z({ detail: " Parc de la  Tête d’Or ", site: "s1", cameras: 2 }),
    z({ detail: "Place Bellecour", site: null }),
    z({ detail: "Ailleurs", t0: at("2026-10-07", 9), t1: at("2026-10-07", 13) }),
    z({ acte: "a2", detail: "Autre acte" }),
  ];
  const mine = zonesDe(T[1], zs);
  assert.equal(mine.length, 3);
  assert.deepEqual(lieux(mine), [
    { l: "Parc de la Tête d’Or", site: "s1" },
    { l: "Place Bellecour", site: null },
  ]);
  assert.equal(appareils(mine, 4), 2);
  assert.equal(appareils([z({ cameras: null })], 4), 4);
  assert.equal(appareils([z({ cameras: null })], null), null);
  assert.equal(plage(T[1]), `6${N}oct.${N}2026, 09 h 00 → 17 h 00`);
  assert.equal(plage(T[2]), `6${N}oct.${N}2026, 22 h 00 → 7${N}oct.${N}2026, 02 h 00`);
  assert.equal(plage(slot({ t0: at("2026-10-06", 0), t1: at("2026-10-07", 0) })), `6${N}oct.${N}2026, horaires non précisés`);
});
