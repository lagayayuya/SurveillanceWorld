// Comparer in theme A (boards Comparer-communes and Comparer-entreprises, lot 4): what it computes
// from listes.json's rows. SYNTHETIC rows, no source's data (figures shaped like the boards').
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barres,
  classement,
  csvComparaison,
  depsCommuns,
  figuresCommune,
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
  const f = figuresCommune(row, 163684, true);
  assert.equal(f.p1000?.toFixed(1), "4.0");
  assert.equal(Math.round(f.eph ?? 0), 5);
  assert.deepEqual([f.carte, f.cam, f.amt, f.con, f.dr, f.docs], [651, 57, 812000, 7, 14, 95]);
  // decrees not read in its département: « non lu », never 0
  const g = figuresCommune(row, 163684, false);
  assert.deepEqual([g.cam, g.dr], [null, null]);
  // no contract in its name: 0 €, no amount per inhabitant; no population: nothing per head
  const h = figuresCommune({ ...row, amt: 0 }, 0, true);
  assert.deepEqual([h.amt, h.eph, h.p1000], [0, null, null]);
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
