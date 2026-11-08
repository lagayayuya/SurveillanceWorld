// A company's fiche in theme A (board Entreprise-Electriox-A, lot 3): what it computes from the
// company's file, listes.json and the national graph. SYNTHETIC companies, buyers and contracts, no
// source's data.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Arete,
  axe,
  deArt,
  doublons,
  echelle,
  friseLignes,
  groupements,
  memeMetier,
  offresPubliees,
  parAnnee,
  seriesDe,
  voisins,
} from "../src/registre/vues/entreprise-a.ts";

const c = (d: string, b: string | null, amt: number, x: Record<string, unknown> = {}) => ({
  d,
  fin: null as string | null,
  b,
  amt,
  ...x,
});
const DEP: Record<string, string> = { A: "69", B: "69", C: "74", D: "38" };

test("the series are a rule: the largest client, the others of its département, elsewhere", () => {
  const s = seriesDe(
    [
      { s: "B", amt: 2 },
      { s: "A", amt: 30 },
      { s: "C", amt: 1 },
      { s: "D", amt: 1 },
    ],
    (x) => DEP[x],
  );
  assert.equal(s.top, "A");
  assert.equal(s.dep, "69");
  assert.deepEqual(
    ["A", "B", "C", "D", null].map(s.de),
    ["s1", "s2", "s3", "s3", "s3"],
  );
  // no client: nothing is the first
  assert.equal(seriesDe([], () => "").top, null);
});

test("the money by year: every year shown, each series' amount and count", () => {
  const s = seriesDe([{ s: "A", amt: 10 }, { s: "C", amt: 1 }], (x) => DEP[x]);
  const ans = parAnnee([c("2020-02-01", "C", 1), c("2022-03-01", "A", 10), c("2022-04-01", "A", 0)], s.de, 2020, 2023);
  assert.deepEqual(
    ans.map((a) => [a.an, a.total, a.nb, a.m.s1, a.n.s1, a.m.s3]),
    [
      ["2020", 1, 1, 0, 0, 1],
      ["2021", 0, 0, 0, 0, 0],
      ["2022", 10, 2, 10, 2, 0],
      ["2023", 0, 0, 0, 0, 0],
    ],
  );
});

test("a chart's scale: at most four lines under the largest value, the plot as tall as it", () => {
  assert.deepEqual(echelle(20.3), { pas: 5, lignes: 4, haut: 20.3 });
  assert.deepEqual(echelle(3), { pas: 1, lignes: 3, haut: 3 });
  assert.deepEqual(echelle(0), { pas: 1, lignes: 0, haut: 1 });
});

test("the offers: the fewest and the most, over the contracts that publish them", () => {
  assert.deepEqual(
    offresPubliees([c("2023-01-01", "A", 1, { offres: 5 }), c("2025-01-01", "A", 1, { offres: 2 }), c("2020-01-01", "A", 1)]),
    { min: 2, max: 5, n: 2 },
  );
  assert.deepEqual(offresPubliees([c("2020-01-01", "A", 1)]), { min: 0, max: 0, n: 0 });
});

test("joint contracts: one row per partner, never a sole trader, the largest first", () => {
  const rows = groupements(
    [
      c("2021-01-01", "A", 100, { entreprises: ["1", "2"] }),
      c("2025-01-01", "B", 900, { entreprises: ["3", "1", "ei"] }),
      c("2020-01-01", "C", 50, { entreprises: ["1"] }),
    ],
    "1",
    (s) => s === "ei",
  );
  assert.deepEqual(
    rows.map((r) => [r.siren, r.c.amt]),
    [
      ["3", 900],
      ["2", 100],
    ],
  );
});

test("its clients' other suppliers: counted per client, its partners out of the list", () => {
  const A: Arete[] = [
    ["A", "1", 10, 1],
    ["A", "X", 5, 1],
    ["A", "Y", 5, 1],
    ["B", "X", 5, 1],
    ["B", "P", 5, 1],
    ["Z", "X", 5, 1],
  ];
  const v = voisins(A, ["A", "B"], "1", (s) => s, new Set(["P"]));
  assert.deepEqual([...v.parClient], [
    ["A", 2],
    ["B", 2],
  ]);
  assert.deepEqual(
    v.ent.map((x) => [x.siren, x.clients]),
    [
      ["X", ["A", "B"]],
      ["Y", ["A"]],
    ],
  );
});

test("the same trade in its départements: same NAF code, contracts there, never itself nor a sole trader", () => {
  const lignes = {
    "1": { deps: { "69": 3 } },
    "2": { deps: { "69": 2, "74": 4 } },
    "3": { deps: { "13": 9 } },
    "4": { deps: { "69": 8 } },
    "5": { deps: { "69": 1 } },
  };
  const dico = {
    "1": { naf: "43.21A" },
    "2": { naf: "43.21A" },
    "3": { naf: "43.21A" },
    "4": { naf: "80.20Z" },
    "5": { naf: "43.21A", entrepreneur_individuel: true },
  };
  assert.deepEqual(memeMetier(lignes, dico, "43.21A", ["69", "74"], "1"), [{ siren: "2", n: 6 }]);
  assert.deepEqual(memeMetier(lignes, dico, "", ["69"], "1"), []);
});

test("the frieze: an axis by days; rows by client, the most money first; a cap keeps the running ones", () => {
  const x = axe(2020, 2029, 0, 1000);
  assert.equal(x("2020-01-01"), 0);
  assert.ok(Math.abs(x("2025-01-01") - 500.3) < 1);
  const CT = [
    c("2020-01-01", "C", 5),
    c("2022-01-01", "A", 50),
    c("2021-01-01", "A", 40),
    c("2023-01-01", "B", 1, { run: true }),
  ];
  const f = friseLignes(CT, (k) => !!(k as { run?: boolean }).run);
  assert.deepEqual(
    f.groupes.map((g) => [g.b, g.rows.map((r) => r.d.slice(0, 4))]),
    [
      ["A", ["2021", "2022"]],
      ["C", ["2020"]],
      ["B", ["2023"]],
    ],
  );
  assert.equal(f.caches, 0);
  const g = friseLignes(CT, (k) => !!(k as { run?: boolean }).run, 2);
  assert.deepEqual(
    g.groupes.flatMap((k) => k.rows.map((r) => r.d.slice(0, 4))),
    ["2022", "2023"],
  );
  assert.equal(g.caches, 2);
});

test("the same contract published twice: its communes, counted once", () => {
  assert.deepEqual(
    doublons(
      {
        a: { insee: "69282", nature: "doublon", entreprises: ["1", "2"] },
        b: { insee: "69123", nature: "lots", entreprises: ["1"] },
        c: { insee: "69001", nature: "doublon", entreprises: ["2"] },
      },
      "1",
    ),
    ["69282"],
  );
});

test("« de » before a département's article, contracted", () => {
  assert.equal(deArt("le Rhône"), "du Rhône");
  assert.equal(deArt("les Yvelines"), "des Yvelines");
  assert.equal(deArt("la Haute-Savoie"), "de la Haute-Savoie");
  assert.equal(deArt("l’Isère"), "de l’Isère");
});
