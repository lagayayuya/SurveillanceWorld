// « Carte et drones »'s pure helpers (vues/carte-outils.ts): the frieze (its span, its bars in lanes,
// its months), the sums a period or a slot shows, the map's volumes, the credits, a ?mois= read.
// Every slot below is SYNTHETIC: the extract keeps no period of flight (pipeline drones.py).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { volumeHeight } from "../src/registre/carte3d.ts";
import type { Donnees } from "../src/registre/commun.ts";
import { setMessages, t } from "../src/registre/i18n.ts";
import {
  attribution,
  bars,
  type Creneau,
  DEBUT,
  dateTxt,
  drones,
  heuresTxt,
  months,
  mois,
  span,
  sitesHours,
  sumHours,
  W,
  xOf,
} from "../src/registre/vues/carte-outils.ts";

const catalogue: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
);
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const N = " ";
const H = 3600_000;
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

test("?mois=YYYY-MM: that month, [start, end[; anything else: no period", () => {
  assert.deepEqual(mois("2026-10"), [Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 1)]);
  assert.deepEqual(mois("2025-12"), [Date.UTC(2025, 11, 1), Date.UTC(2026, 0, 1)]);
  for (const bad of ["", "2026-13", "2026-1", "26-10", "2026-10-01"]) assert.equal(mois(bad), null);
});

test("the frieze runs from the first slot's month to today; without a slot, from the first acts", () => {
  const today = Date.UTC(2026, 9, 29);
  assert.deepEqual(span([], today), { A: DEBUT, B: today });
  const T = [slot({ t0: at("2025-11-14", 8), t1: at("2025-11-14", 20) })];
  assert.deepEqual(span(T, today), { A: Date.UTC(2025, 10, 1), B: today });
  // a slot that ends after today stretches the frieze to its end
  const late = [slot({ t0: at("2026-10-28", 8), t1: at("2026-11-02", 8) })];
  assert.equal(span(late, today).B, at("2026-11-02", 8));
});

test("one bar per slot at its date, 4 px at least, a second lane when two would touch", () => {
  const A = Date.UTC(2025, 10, 1);
  const B = Date.UTC(2026, 10, 1);
  const T = [
    slot({ t0: at("2026-03-14", 9), t1: at("2026-03-14", 21) }),
    slot({ t0: at("2026-03-14", 10), t1: at("2026-03-14", 12) }),
    slot({ t0: at("2026-06-01", 9), t1: at("2026-06-01", 10) }),
  ];
  const b = bars(T, A, B);
  assert.equal(b[0].x, xOf(T[0].t0, A, B));
  assert.ok(b.every((x) => x.w >= 4));
  assert.deepEqual(
    b.map((x) => x.y),
    [112, 97, 112],
  );
  assert.equal(xOf(A, A, B), 4);
  assert.equal(xOf(B, A, B), 4 + W);
});

test("months: the year on January, and on the first month when no January is shown", () => {
  const l = months(Date.UTC(2025, 10, 1), Date.UTC(2026, 2, 15)).map((m) => m.l);
  assert.deepEqual(l, ["nov.", "déc.", "janv. 2026", "févr.", "mars"]);
  const m = months(Date.UTC(2026, 3, 1), Date.UTC(2026, 5, 2)).map((x) => x.l);
  assert.deepEqual(m, ["avr. 2026", "mai", "juin"]);
});

test("the hours shown: those the acts state; a slot without them counts none; a period takes its share", () => {
  const T = [
    slot({ t0: at("2026-10-11", 9), t1: at("2026-10-11", 17), heures: 8 }),
    slot({ t0: at("2026-10-12", 9), t1: at("2026-10-12", 17), heures: null }),
  ];
  assert.equal(sumHours(T, null), 8);
  // half of the first slot inside the chosen period
  assert.equal(sumHours(T, [at("2026-10-11", 13), at("2026-10-13", 0)]), 4);
  assert.equal(sumHours(T, [at("2026-10-20", 0), at("2026-10-21", 0)]), 0);
});

test("the map's volumes: a slot once per site, its acts counted once, no hours still a volume", () => {
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
  // carte3d draws s3, its hours not stated, at the lowest height, the same for all
  const maxH = Math.max(...Object.values(v).map((x) => x.heures));
  assert.equal(volumeHeight(v.s3.heures, maxH, 5000), 20);
  assert.ok(volumeHeight(v.s1.heures, maxH, 5000) > volumeHeight(v.s2.heures, maxH, 5000));
});

test("the words: dates with the hour, hours, the list's title, the panel's line without hours", () => {
  assert.equal(dateTxt(at("2026-10-23", 19)), `23${N}oct.${N}2026`);
  assert.equal(dateTxt(at("2026-10-23", 19), true), `23${N}oct.${N}2026, 19 h 00`);
  assert.equal(heuresTxt(2.5), "2,5 h");
  assert.equal(heuresTxt(1367), `1${N}367 h`);
  assert.equal(t("carte.liste_tout", { n: 0 }), "Aucun créneau");
  assert.equal(t("carte.liste_tout", { n: 1 }), "Le créneau");
  assert.equal(t("carte.liste_tout", { n: 61 }), "Les 61 créneaux");
  assert.equal(t("carte.creneaux", { n: 1 }), "1 créneau");
  assert.equal(t("carte.horaires_non_precises_arrete"), "horaires non précisés dans l'arrêté");
  assert.equal(t("arretes.zone_non_deduite"), "zone non déduite de l'arrêté");
});

test("the credits: the cameras' source, then the basemap's, OpenStreetMap linked", () => {
  const a = attribution("© contributeurs OpenStreetMap (ODbL) : caméras");
  assert.equal(a[0], "© contributeurs OpenStreetMap (ODbL) : caméras. ");
  assert.equal(a[1], "Fond de carte : ");
  assert.deepEqual(a[2], {
    a: {
      href: "https://www.openstreetmap.org/copyright",
      text: "données © les contributeurs d'OpenStreetMap",
    },
  });
  assert.equal(a[3], ", licence ODbL · construit avec Protomaps.");
  assert.equal(attribution("").length, 3);
});

test("a commune file without `drones` (an older build) has no slot and no act listed", () => {
  assert.deepEqual(drones({ f: {} } as unknown as Donnees), { creneaux: [], non_deduits: [] });
  const f = { drones: { creneaux: [slot({ t0: 0, t1: H })], non_deduits: [] } };
  assert.equal(drones({ f } as unknown as Donnees).creneaux.length, 1);
});
