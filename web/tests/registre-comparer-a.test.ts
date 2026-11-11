// Comparer in theme A (boards Comparer-communes and Comparer-entreprises, lot 4): what it computes
// from listes.json's rows. SYNTHETIC rows, no source's data (figures shaped like the boards').
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barres,
  classement,
  csvComparaison,
  depsCommuns,
  couvertureActes,
  etatActes,
  figuresCommune,
  horsCommune,
  formeActes,
  lecture,
  figuresEntreprise,
  hauts,
  idsDe,
} from "../src/registre/vues/comparer-a.ts";

test("the address's ids: order kept, unknown and repeated ones dropped, four at most", () => {
  const connu = (id: string) => /^\d{5}$/.test(id);
  assert.deepEqual(idsDe("69123,69029,69266", connu), ["69123", "69029", "69266"]);
  assert.deepEqual(idsDe(" 69029 ,x,69029,,69123", connu), ["69029", "69123"]);
  assert.deepEqual(idsDe("00001,00002,00003,00004,00005", connu), [
    "00001",
    "00002",
    "00003",
    "00004",
  ]);
  assert.deepEqual(idsDe(undefined, connu), []);
});

test("a row's yellow: every maximum, none under two figures or at 0", () => {
  assert.deepEqual(hauts([2113, 314, 651]), [true, false, false]);
  assert.deepEqual(hauts([7, 7, 3]), [true, true, false]);
  assert.deepEqual(hauts([null, 5, 2]), [false, true, false]);
  assert.deepEqual(hauts([12]), [false]);
  assert.deepEqual(hauts([null, 4]), [false, false]);
  assert.deepEqual(hauts([0, 0]), [false, false]);
});

test("a row's bars in % of its maximum, a small figure kept visible, none without a figure", () => {
  assert.deepEqual(barres([2113, 314, 651]), [100, 15, 31]);
  assert.deepEqual(barres([2_000_000, 3, 0]), [100, 1, 0]);
  assert.deepEqual(barres([null, 0]), [null, 0]);
});

test("the lead's order: highest first, no figure left out, ties in the address's order", () => {
  assert.deepEqual(classement([4.1, 7.3, 4.0]), [1, 0, 2]);
  assert.deepEqual(classement([null, 2, 2]), [1, 2]);
});

test("a commune's figures from its row: per 1 000 inhabitants, per inhabitant, unread decrees", () => {
  const row = { docs: 95, con: 7, cam: 57, dr: 14, carte: 651, amt: 812000, jv: 26 };
  const lus = { cam: true, dr: true };
  const f = figuresCommune(row, 163684, lus);
  assert.equal(f.p1000?.toFixed(1), "4.0");
  assert.equal(Math.round(f.eph ?? 0), 5);
  assert.deepEqual([f.carte, f.cam, f.amt, f.con, f.dr, f.docs], [651, 57, 812000, 7, 14, 95]);
  // decrees not read in its département: « non lu », never 0
  const g = figuresCommune(row, 163684, { cam: false, dr: false });
  assert.deepEqual([g.cam, g.dr], [null, null]);
  // one kind read, the other not: each its own
  const p = figuresCommune(row, 163684, { cam: false, dr: true });
  assert.deepEqual([p.cam, p.dr], [null, 14]);
  // no contract in its name: 0 €, no amount per inhabitant; no population: nothing per head
  const h = figuresCommune({ ...row, amt: 0 }, 0, lus);
  assert.deepEqual([h.amt, h.eph, h.p1000], [0, null, null]);
});

test("which decrees are read: « non lu » wherever the coverage is not, never 0 (Ju 09/11, recette 01-02)", () => {
  // the build's rule (rule:registre_couverture@1:actes_commune)
  assert.equal(etatActes(false, 0), "non_lu");
  assert.equal(etatActes(true, 222), "non_rattache");
  assert.equal(etatActes(true, 0), "lu");
  // the département's acts placed in no commune: its count less its acts placed, each once
  assert.deepEqual(horsCommune({ cam: 222, dr: 782 }, { cam: 0, dr: 642 }), { cam: 222, dr: 140 });
  assert.equal(horsCommune(undefined, { cam: 1 }), undefined);
  const X = {
    lignes: {
      communes: {
        // Paris-like: no camera act placed, drone acts placed and others not
        "75056": { cam: 0, dr: 642 },
        // a commune the build already reads (served from 580f7cf on)
        "13011": { cam: 6, dr: 0, couverture_actes: { cam: "non_rattache", dr: "lu" } },
        "82121": { cam: 3, dr: 0 },
      },
      departements: {
        "75": { cam: 222, dr: 782 },
        "13": { cam: 3082, dr: 349 },
        "82": { cam: 40, dr: 0 },
        "03": { cam: 34, dr: 12, couverture_actes_communes: { cam: "non_rattache", dr: "non_lu" } },
      },
    },
    dico: { communes: {} },
  } as never;
  const c = (insee: string, dep: string, etat = "collecte") =>
    couvertureActes({ insee, dep, etat, X });
  // not served: every count a minimum where the département has acts of the family
  assert.deepEqual(c("75056", "75"), { cam: "non_rattache", dr: "non_rattache" });
  assert.deepEqual(lecture(c("75056", "75")), { cam: true, dr: true });
  // a 0 read where the département has no act of the family at all
  assert.deepEqual(c("82121", "82"), { cam: "non_rattache", dr: "lu" });
  // served: the build's reading wins
  assert.deepEqual(c("13011", "13"), { cam: "non_rattache", dr: "lu" });
  // a commune without a row: its département's row says what it shows
  assert.deepEqual(c("03310", "03"), { cam: "non_rattache", dr: "non_lu" });
  // a département not collected: nothing read, whatever the counts
  assert.deepEqual(c("75056", "75", "non_collecte"), { cam: "non_lu", dr: "non_lu" });
  // without listes.json nor the département's count: a minimum
  const seul = couvertureActes({
    insee: "75056",
    dep: "75",
    etat: "collecte",
    X: null,
    propre: { cam: 0, dr: 642 },
  });
  assert.deepEqual(seul, { cam: "non_rattache", dr: "non_rattache" });
});

test("a company's figures from its row, the départements where they all have a client", () => {
  const a = { n: 388, clientes: 249, amt: 222.2e6, y0: "2018", deps: { "69": 3, "13": 1, "2A": 1, "07": 2, "971": 1 } };
  const b = { n: 190, clientes: 140, amt: 144.5e6, y0: "2018", deps: { "13": 2, "07": 1, "971": 4, "2A": 1, "33": 1 } };
  const f = figuresEntreprise(a);
  assert.deepEqual([f.amt, f.n, f.clientes, f.deps], [222.2e6, 388, 249, 5]);
  assert.equal(Math.round(f.moy ?? 0), 572680);
  assert.equal(figuresEntreprise({ ...a, amt: 0 }).moy, null);
  assert.deepEqual(depsCommuns([a.deps, b.deps]), ["07", "13", "2A", "971"]);
  assert.deepEqual(depsCommuns([a.deps, b.deps, { "13": 1 }]), ["13"]);
  assert.deepEqual(depsCommuns([a.deps]), []);
});

test("the CSV: quoted, a formula escaped, an unread figure empty, its mark and CRLF", () => {
  const s = csvComparaison(["id", "nom", "montant"], [
    ["69123", "Lyon", 31661950.454],
    ["x", "=SOMME(A1)", null],
  ]);
  assert.equal(
    s,
    '﻿"id","nom","montant"\r\n"69123","Lyon","31661950.45"\r\n"x","\'=SOMME(A1)",""\r\n',
  );
});

test("a family's count as served (Ju 11/11): the number, a minimum, none attached, not read", () => {
  assert.equal(formeActes("lu", 12), "n");
  assert.equal(formeActes("lu", 0), "n");
  assert.equal(formeActes("non_rattache", 12), "au_moins");
  // never « au moins 0 »
  assert.equal(formeActes("non_rattache", 0), "aucun_rattache");
  assert.equal(formeActes("non_lu", 3), "non_lu");
  // a minimum still has its number (sorted at it); « non_lu » has none
  assert.deepEqual(lecture({ cam: "non_rattache", dr: "non_lu" }), { cam: true, dr: false });
});
