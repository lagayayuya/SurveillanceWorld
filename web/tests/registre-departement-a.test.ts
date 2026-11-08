// A département's fiche in theme A (board Departement-Rhone-A, lot 3): what it computes from the
// département's file, listes.json and the outlines. SYNTHETIC figures, no source's data, but the
// Lambert-93 projection checked on a known point.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boite,
  cadrer,
  classe,
  csv,
  facteurDrones,
  fraction,
  lambert93,
  plusEquipees,
  projection,
  quiPaie,
  rangDep,
  recadrer,
  SEUILS,
  tete,
  valeur,
} from "../src/registre/vues/departement-a.ts";

test("Lambert-93: Paris's Notre-Dame where the IGN's grid puts it, to the metre's order", () => {
  const [x, y] = lambert93(2.3522, 48.8566);
  assert.ok(Math.abs(x - 652469) < 50, String(x));
  assert.ok(Math.abs(y - 6862035) < 50, String(y));
  // the projection's origin: 3° E, 46.5° N
  const [x0, y0] = lambert93(3, 46.5);
  assert.ok(Math.abs(x0 - 700000) < 1e-3 && Math.abs(y0 - 6600000) < 1e-3);
});

test("a town hall's point on the drawing: Lyon's inside the Rhône's outline box", () => {
  // France's and the Rhône's boxes on the drawing of the build of 2026-11-08 (660 × 640, margin 8)
  const f = projection([8.4, 20.4, 652, 617.7]);
  const [lx, ly] = f([4.835, 45.768]);
  assert.ok(lx > 400.9 && lx < 440.9 && ly > 319.4 && ly < 372.4, `${lx} ${ly}`);
});

test("an outline fitted into the map: its box, its scale, its path redrawn", () => {
  const d = "M10 10L30 10L30 50L10 50ZM12 12L14 12L14 14Z";
  assert.deepEqual(boite(d), [10, 10, 30, 50]);
  const c = cadrer(boite(d), 200, 200, 10);
  // the height fills: 180 / 40
  assert.equal(c.z, 4.5);
  assert.equal(c.W, 110);
  assert.equal(c.H, 200);
  assert.deepEqual(c.f([10, 10]), [10, 10]);
  assert.equal(recadrer(d, c.f).split("M").length, 3);
  assert.match(recadrer(d, c.f), /^M10\.0 10\.0L100\.0 10\.0L100\.0 190\.0/);
});

test("the map's classes: the board's breaks for the cameras, none for an unknown value", () => {
  assert.equal(classe(0, SEUILS.cameras), 0);
  assert.equal(classe(0.49, SEUILS.cameras), 0);
  assert.equal(classe(0.5, SEUILS.cameras), 1);
  assert.equal(classe(4.1, SEUILS.cameras), 3);
  assert.equal(classe(7.3, SEUILS.cameras), 4);
  assert.equal(classe(null, SEUILS.cameras), null);
  assert.equal(classe(0, SEUILS.aut), 0);
  assert.equal(classe(2, SEUILS.aut), 1);
  assert.equal(classe(447, SEUILS.aut), 4);
  const c = { pop: 2000, carte: 3, montant: 10000, cam: 4, dr: 1 };
  assert.equal(valeur("cameras", c), 1.5);
  assert.equal(valeur("eph", c), 5);
  assert.equal(valeur("aut", c), 4);
  assert.equal(valeur("dr", c), 1);
  assert.equal(valeur("cameras", { ...c, pop: 0 }), null);
  assert.equal(valeur("cameras", { ...c, carte: null }), null);
});

test("a rank among the départements: ties share the better rank, none under five ranked", () => {
  const v = { a: 50, b: 40, c: 40, d: 10, e: 5, f: 0 };
  const U = Object.keys(v);
  assert.deepEqual(rangDep("c", v, U), { r: 2, n: 6, tete: "a", devant: ["a"] });
  assert.deepEqual(rangDep("d", v, U)?.devant, ["a", "b", "c"]);
  assert.equal(rangDep("z", v, U), null);
  assert.equal(rangDep("a", v, ["a", "b", "c"]), null);
  // the board's « 16e … » card: the first five, a gap, the département
  const t = tete("f", v, U);
  assert.deepEqual(
    t.map((x) => [x.k, x.r, x.me, !!x.gap]),
    [
      ["a", 1, false, false],
      ["b", 2, false, false],
      ["c", 2, false, false],
      ["d", 4, false, false],
      ["e", 5, false, false],
      ["", 0, false, true],
      ["f", 6, true, false],
    ],
  );
  assert.equal(tete("b", v, U).length, 5);
});

test("who pays: the buyers' amounts by the board's classes, « autres » last, shares in percents", () => {
  const cat: Record<string, string> = {
    v1: "commune",
    v2: "commune",
    t: "transports",
    s: "sante",
    m: "metropole",
    e: "etat",
  };
  const p = quiPaie(
    [
      { siren: "v1", montant: 60 },
      { siren: "v2", montant: 16 },
      { siren: "t", montant: 14 },
      { siren: "s", montant: 4 },
      { siren: "m", montant: 2 },
      { siren: "e", montant: 4 },
      { siren: "x", montant: 0 },
    ],
    (s) => cat[s],
  );
  assert.deepEqual(
    p.map((x) => [x.k, x.montant, x.pct]),
    [
      ["commune", 76, 76],
      ["transports", 14, 14],
      ["etat", 4, 4],
      ["autres", 6, 6],
    ],
  );
  assert.equal(fraction(0.76), "trois_quarts");
  assert.equal(fraction(0.293), "pres_tiers");
  assert.equal(fraction(0.1), null);
});

test("the best equipped communes: 10 000 inhabitants or more, all of them when fewer than five", () => {
  const big = [
    { pop: 42982, cams: 314 },
    { pop: 11208, cams: 65 },
    { pop: 519127, cams: 2113 },
    { pop: 53069, cams: 230 },
    { pop: 30000, cams: 30 },
  ];
  const r = plusEquipees([...big, { pop: 900, cams: 40 }, { pop: 20000, cams: null }]);
  assert.equal(r.seuil, 10000);
  assert.deepEqual(
    r.rows.map((x) => x.cams),
    [314, 65, 230, 2113, 30],
  );
  const small = plusEquipees([{ pop: 900, cams: 4 }, { pop: 3000, cams: 3 }, { pop: 500, cams: 0 }]);
  assert.equal(small.seuil, 0);
  assert.deepEqual(
    small.rows.map((x) => x.cams),
    [4, 3],
  );
});

test("the drone bars' factor, the CSV's cells", () => {
  assert.equal(facteurDrones(1075, 67), 8);
  assert.equal(facteurDrones(100, 90), 1);
  assert.equal(facteurDrones(0, 0), 1);
  assert.equal(
    csv(["Commune", "Montant"], [["=Lyon", 1.234], ['Saint "X"', -5]]),
    '﻿"Commune","Montant"\r\n"\'=Lyon","1.23"\r\n"Saint ""X""","-5"\r\n',
  );
});
