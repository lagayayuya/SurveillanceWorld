// The graph centred on a company or a buyer (boards Graphe-plein and Graphe-grammaire, lot 4): what
// it computes from the build's edges. SYNTHETIC edges and SIRENs, no source's data.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Arete,
  colonnesTableau,
  couper,
  csvGraphe,
  disposer,
  ecarter,
  estCommune,
  etiquette,
  H,
  indexer,
  ordre,
  plusRelies,
  point,
  quotas,
  role,
  tableau,
  voisinage,
  W,
} from "../src/registre/vues/graphe-a.ts";

// the centre E0 (a company) works for four buyers; B1 and B2 share F1, B2 and B3 share F2, B1, B2
// and B4 share F3; F4 to F7 have one of them each; B9 buys from F7 only (a second step away)
const A: Arete[] = [
  ["B1", "E0", 3_000_000, 4],
  ["B2", "E0", 900_000, 1],
  ["B3", "E0", 200_000, 1],
  ["B4", "E0", 400_000, 2],
  ["B1", "F1", 100_000, 1],
  ["B2", "F1", 800_000, 1],
  ["B2", "F2", 50_000, 1],
  ["B3", "F2", 60_000, 1],
  ["B1", "F3", 10_000, 1],
  ["B2", "F3", 20_000, 1],
  ["B4", "F3", 30_000, 1],
  ["B1", "F4", 5_000, 1],
  ["B2", "F5", 7_000, 1],
  ["B3", "F6", 9_000, 1],
  ["B4", "F7", 11_000, 1],
  ["B9", "F7", 1_000, 1],
];
const nom = (s: string) => `Nom ${s}`;

test("the centre's role: the one asked when it has edges there, else the one with more partners", () => {
  const I = indexer([...A, ["E0", "F9", 1, 1]]);
  assert.equal(role(I, "E0"), "e");
  assert.equal(role(I, "E0", "acheteur"), "a");
  assert.equal(role(I, "B1"), "a");
  assert.equal(role(I, "B1", "entreprise"), "a", "no edge as a company: its role as a buyer");
  assert.equal(role(I, "XX"), null);
});

test("the first circle by money, the second without the centre, each edge kept apart", () => {
  const v = voisinage(indexer(A), "E0", "e");
  assert.deepEqual(
    v.premiers.map((p) => p.id),
    ["B1", "B2", "B4", "B3"],
  );
  assert.deepEqual(v.seconds.map((s) => s.id).sort(), ["F1", "F2", "F3", "F4", "F5", "F6", "F7"]);
  const f3 = v.seconds.find((s) => s.id === "F3");
  assert.equal(f3?.liens.size, 3);
  assert.equal(f3?.liens.get("B4")?.m, 30_000);
  // F7's degree counts B9, which is not in the drawing
  assert.equal(v.seconds.find((s) => s.id === "F7")?.degre, 2);
  // centred on a buyer, the circles turn round
  const w = voisinage(indexer(A), "B4", "a");
  assert.deepEqual(w.premiers.map((p) => p.id), ["E0", "F3", "F7"]);
  assert.ok(w.seconds.some((s) => s.id === "B9"));
});

test("the order around the centre: the most money, then the node sharing the most with the last", () => {
  const v = voisinage(indexer(A), "E0", "e");
  // B1 first; B2 shares F1 and F3 with it; then B3 (F2 with B2) against B4 (F3 with B2): one each,
  // B4 has more money
  assert.deepEqual(ordre(v.premiers, v.seconds), ["B1", "B2", "B4", "B3"]);
});

test("a budget shared out to the same level, the remainder to the first ones", () => {
  assert.deepEqual(quotas([3, 2, 1], 10), [3, 2, 1]);
  assert.deepEqual(quotas([85, 7, 2, 0], 40), [31, 7, 2, 0]);
  assert.deepEqual(quotas([10, 10, 10], 20), [7, 7, 6]);
});

test("a buyer's drawn name, a commune told by its name or its dictionary, a label cut", () => {
  assert.equal(etiquette("Commune de Lyon"), "Lyon");
  assert.equal(etiquette("Commune d'Annecy"), "Annecy");
  assert.equal(etiquette("Ville d’Écully"), "Écully");
  assert.equal(etiquette("Communauté de communes du Pays"), "Communauté de communes du Pays");
  assert.ok(estCommune("Commune de Vienne"));
  assert.ok(estCommune("Mairie", "commune"));
  assert.ok(!estCommune("Communauté d'agglomération Val Parisis"));
  assert.equal(couper("Trafic Transport Sûreté Industrie", 22), "Trafic Transport Sûre…");
  assert.equal(couper("Axione", 22), "Axione");
});

test("the drawing: the shared ones between their partners with their count, the others at the edge, all inside", () => {
  const v = voisinage(indexer(A), "E0", "e");
  const d = disposer(v, nom);
  const by = new Map(d.noeuds.map((n) => [n.k, n]));
  assert.deepEqual(d.colonnes, ["B1", "B2", "B4", "B3"]);
  assert.equal(by.get("B1")?.sorte, "p");
  assert.equal(by.get("B1")?.forme, "a");
  assert.equal(by.get("F3")?.sorte, "b");
  assert.equal(by.get("F3")?.n, 3);
  assert.equal(by.get("F3")?.forme, "e");
  assert.equal(by.get("F4")?.sorte, "s");
  // the biggest edge sizes the biggest node of the first circle: 22 = 9 + 13
  assert.equal(by.get("B1")?.z, 22);
  // a shared node is nearer the centre than the edge's
  const dist = (k: string) => Math.hypot((by.get(k)?.x ?? 0) - 500, (by.get(k)?.y ?? 0) - 450);
  assert.ok(dist("F1") < dist("F4"));
  // lines: centre to each first-circle node, each node to its drawn partners
  assert.equal(d.traits.filter((t) => t.a === "c").length, 4);
  assert.equal(d.traits.filter((t) => t.b === "F3").length, 3);
  for (const n of d.noeuds) {
    assert.ok(n.x - n.z >= 0 && n.x + n.z <= W && n.y - n.z >= 0 && n.y + n.z <= H, n.k);
    assert.ok(n.lab === null || n.lab.txt.length <= 24, n.k);
  }
});

test("over the caps: a first circle's « +N », a node's « +N » at the edge, the table still complete for the columns", () => {
  const big: Arete[] = [];
  for (let i = 0; i < 20; i++) big.push([`B${i}`, "E0", 1000 * (i + 1), 1]);
  for (let j = 0; j < 60; j++) big.push(["B19", `F${j}`, 100 + j, 1]);
  big.push(["B18", "F0", 5, 1]);
  const v = voisinage(indexer(big), "E0", "e");
  const d = disposer(v, nom, { max1: 12, budget: 20, maxPonts: 12 });
  assert.equal(d.colonnes.length, 12);
  assert.equal(d.caches.length, 8);
  const g1 = d.noeuds.find((n) => n.sorte === "g1");
  assert.equal(g1?.n, 8);
  const g2 = d.noeuds.find((n) => n.sorte === "g2");
  assert.equal(g2?.k, "+B19");
  // B19 holds 59 alone (F0 is shared with B18); 12 first-circle nodes leave 16 places at the
  // edge, not 20: 15 drawn, 44 grouped
  assert.equal(d.noeuds.filter((n) => n.sorte === "s").length, 15);
  assert.equal(g2?.n, 44);
  assert.equal(d.groupes.get("B19")?.length, 44);
  assert.ok(d.traits.some((t) => t.b === "+B19" && t.more));
  assert.ok(d.traits.some((t) => t.b === "+" && t.more));
  // the table holds every second-circle node of the columns drawn, the shared one first
  const rows = tableau(v, d.colonnes);
  assert.equal(rows.length, 60);
  assert.equal(rows[0].id, "F0");
  assert.equal(rows[0].pont, true);
});

test("one neighbour only: a centre, one node, one line", () => {
  const v = voisinage(indexer([["B1", "E0", 500, 1]]), "E0", "e");
  const d = disposer(v, nom);
  assert.equal(d.noeuds.length, 1);
  assert.equal(d.traits.length, 1);
  assert.deepEqual(tableau(v, d.colonnes), []);
});

test("shared nodes on the same partners are pushed apart", () => {
  const m = new Map([
    ["a", 1],
    ["b", 1.01],
    ["c", 1.02],
  ]);
  ecarter(m, 0.2);
  const xs = [...m.values()].sort((x, y) => x - y);
  assert.ok(xs[1] - xs[0] >= 0.199 && xs[2] - xs[1] >= 0.199);
});

test("the table's rows: shared first, then money; a dot's size by the square root", () => {
  const v = voisinage(indexer(A), "E0", "e");
  const rows = tableau(v, ["B1", "B2", "B4", "B3"]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["F3", "F1", "F2", "F7", "F6", "F5", "F4"],
  );
  assert.deepEqual(rows[0].cells.map((c) => c?.m ?? null), [10_000, 20_000, 30_000, null]);
  assert.equal(point(0, 100), 8);
  assert.equal(point(100, 100), 24);
  assert.equal(point(25, 100), 16);
});

test("the table's columns: the most shared first, then the most rows, then money", () => {
  const v = voisinage(indexer(A), "E0", "e");
  // B2 shares F1, F2, F3; B1 F1, F3; B3 and B4 one each, two rows each: B4 has more money
  assert.deepEqual(colonnesTableau(v, ["B1", "B2", "B4", "B3"]), ["B2", "B1", "B4", "B3"]);
  assert.deepEqual(colonnesTableau(v, ["B3", "B4"]), ["B4", "B3"]);
  // the rows follow the columns given
  const rows = tableau(v, colonnesTableau(v, ["B1", "B2", "B4", "B3"]));
  assert.deepEqual(rows[0].cells.map((c) => c?.m ?? null), [20_000, 10_000, 30_000, null]);
});

test("the CSV: each edge once, the centre's first, a formula kept as text", () => {
  const v = voisinage(indexer(A), "E0", "e");
  const csv = csvGraphe(
    v,
    ["cercle", "acheteur_siren", "acheteur", "entreprise_siren", "entreprise", "montant", "contrats"],
    (s) => (s === "B1" ? "=B1" : s),
    (s) => s,
  );
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines.length, 1 + 4 + 11);
  assert.equal(lines[1], '"1","B1","\'=B1","E0","E0","3000000","4"');
  assert.ok(lines.slice(5).every((l) => l.startsWith('"2"')));
});

test("the most connected, for the page without a centre", () => {
  assert.deepEqual(plusRelies(indexer(A), "e", 2), [
    { id: "E0", d: 4 },
    { id: "F3", d: 3 },
  ]);
});
