// « Chemin entre deux » (board Chemin-entre-deux, lot 4): the shortest paths in the graph of buyers
// and companies, their count, their order, their sentence, the fields' search. SYNTHETIC edges and
// names, no source's data.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Arete,
  chercher,
  clauses,
  communeDuNom,
  distances,
  graphe,
  indexCommunes,
  MAX_ETAPES,
  plusCourts,
  roles,
} from "../src/registre/vues/chemin-a.ts";

// buyers A1…, companies E1…: E1 — A1 — {E2, E3} — A2, and E1 — A3 — E4 — A2 (the board's shape,
// three paths of three steps); E9 — A9 apart
const ARETES: Arete[] = [
  ["A1", "E1", 900000, 1],
  ["A1", "E2", 129910, 1],
  ["A2", "E2", 900000, 1],
  ["A1", "E3", 30100000, 4],
  ["A2", "E3", 959133, 3],
  ["A3", "E1", 89900, 1],
  ["A3", "E4", 8000000, 1],
  ["A2", "E4", 1582312, 3],
  ["A9", "E9", 10, 1],
];
const G = graphe(ARETES);

test("three paths of three steps, all counted, the largest amounts first, their layers exact", () => {
  const r = plusCourts(G, "E1", "A2");
  assert.equal(r.k, "trouve");
  if (r.k !== "trouve") return;
  assert.equal(r.etapes, 3);
  assert.equal(r.total, 3);
  assert.deepEqual(
    r.chemins.map((c) => c.noeuds.join(" ")),
    ["E1 A1 E3 A2", "E1 A3 E4 A2", "E1 A1 E2 A2"],
  );
  assert.equal(r.chemins[0].somme, 900000 + 30100000 + 959133);
  assert.deepEqual(
    r.chemins[0].liens.map((l) => [l.m, l.n]),
    [
      [900000, 1],
      [30100000, 4],
      [959133, 3],
    ],
  );
  assert.deepEqual(r.couches, [
    ["A1", "A3"],
    ["E2", "E3", "E4"],
  ]);
});

test("the same paths both ways, reversed", () => {
  const ab = plusCourts(G, "E1", "A2");
  const ba = plusCourts(G, "A2", "E1");
  assert.ok(ab.k === "trouve" && ba.k === "trouve");
  if (ab.k !== "trouve" || ba.k !== "trouve") return;
  assert.equal(ba.total, ab.total);
  assert.deepEqual(
    ba.chemins.map((c) => [...c.noeuds].reverse().join(" ")).sort(),
    ab.chemins.map((c) => c.noeuds.join(" ")).sort(),
  );
});

test("two direct neighbours: one step, one path", () => {
  const r = plusCourts(G, "A1", "E3");
  assert.equal(r.k, "trouve");
  if (r.k !== "trouve") return;
  assert.equal(r.etapes, 1);
  assert.equal(r.total, 1);
  assert.deepEqual(r.chemins[0].noeuds, ["A1", "E3"]);
  assert.deepEqual(r.couches, []);
});

test("not tied at all, the same node twice, a node the graph does not hold", () => {
  assert.deepEqual(plusCourts(G, "E1", "A9"), { k: "aucun", d: null });
  assert.deepEqual(plusCourts(G, "E1", "E1"), { k: "meme" });
  assert.deepEqual(plusCourts(G, "E1", "X"), { k: "absent", qui: ["a"] });
  assert.deepEqual(plusCourts(G, "X", "Y"), { k: "absent", qui: ["de", "a"] });
});

test("beyond the steps allowed: no path, the true distance said", () => {
  // a line of 8 steps
  const ligne: Arete[] = [];
  for (let i = 0; i < 4; i++) {
    ligne.push([`a${i}`, `e${i}`, 1, 1]);
    ligne.push([`a${i + 1}`, `e${i}`, 1, 1]);
  }
  const L = graphe(ligne);
  assert.equal(MAX_ETAPES, 6);
  assert.deepEqual(plusCourts(L, "a0", "a4"), { k: "aucun", d: 8 });
  const r = plusCourts(L, "a0", "a3");
  assert.ok(r.k === "trouve" && r.etapes === 6);
  assert.deepEqual(distances(L, "a0", 2).size, 3);
});

test("many paths: all counted, a few kept, the order stable", () => {
  // a hub: S — 30 buyers — T, each buyer with both
  const hub: Arete[] = [];
  for (let i = 0; i < 30; i++) {
    const a = `B${String(i).padStart(2, "0")}`;
    hub.push([a, "S", 100, 1]);
    hub.push([a, "T", i % 3 === 0 ? 500 : 100, 1]);
  }
  const H = graphe(hub);
  const r = plusCourts(H, "S", "T", 6, 5);
  assert.ok(r.k === "trouve");
  if (r.k !== "trouve") return;
  assert.equal(r.total, 30);
  assert.equal(r.chemins.length, 5);
  // the five largest (500 + 100), ties by their ids
  assert.deepEqual(
    r.chemins.map((c) => c.noeuds[1]),
    ["B00", "B03", "B06", "B09", "B12"],
  );
  assert.deepEqual(plusCourts(H, "S", "T", 6, 5), r);
});

test("each node's part, the sentence's clauses by twos (the board's)", () => {
  const r = plusCourts(G, "E1", "A2");
  assert.ok(r.k === "trouve");
  if (r.k !== "trouve") return;
  const c = r.chemins[2]; // E1 A1 E2 A2
  assert.deepEqual(roles(c), ["e", "a", "e", "a"]);
  assert.deepEqual(
    clauses(c).map((x) => [x.mot, x.x, x.y, x.fin]),
    [
      ["contrat", 0, 1, true],
      ["fournisseur", 1, 2, false],
      ["qui_client", 2, 3, true],
    ],
  );
  // from a buyer, two steps: « A1 a un contrat avec E2. E2 travaille aussi pour A2. »
  const d = plusCourts(G, "A1", "A2");
  assert.ok(d.k === "trouve");
  if (d.k !== "trouve") return;
  assert.deepEqual(
    clauses(d.chemins[0]).map((x) => x.mot),
    ["contrat", "client"],
  );
  // four steps: two sentences after the first
  const quatre = graphe([
    ["a0", "e0", 1, 1],
    ["a1", "e0", 1, 1],
    ["a1", "e1", 1, 1],
    ["a2", "e1", 1, 1],
  ]);
  const q = plusCourts(quatre, "a0", "a2");
  assert.ok(q.k === "trouve");
  if (q.k !== "trouve") return;
  assert.deepEqual(
    clauses(q.chemins[0]).map((x) => [x.mot, x.fin]),
    [
      ["contrat", true],
      ["client", false],
      ["qui_fournisseur", true],
      ["client", true],
    ],
  );
});

test("a buyer named after its commune finds it, its article given back; a homonym does not", () => {
  const idx = indexCommunes({
    "11111": { nom: "Le Havre" },
    "22222": { nom: "Annecy" },
    "33333": { nom: "Pierre-Bénite" },
    "44444": { nom: "Saint-Denis" },
    "55555": { nom: "Saint-Denis" },
    "66666": { nom: "La Rochelle" },
  });
  assert.equal(communeDuNom("Commune du Havre", idx), "11111");
  assert.equal(communeDuNom("Commune d'Annecy", idx), "22222");
  assert.equal(communeDuNom("Commune d’Annecy", idx), "22222");
  assert.equal(communeDuNom("Commune de Pierre Bénite", idx), "33333");
  assert.equal(communeDuNom("Commune de La Rochelle", idx), "66666");
  assert.equal(communeDuNom("Commune de Saint-Denis", idx), null);
  assert.equal(communeDuNom("Métropole du Havre", idx), null);
});

test("the fields' search: the start of the name first, then a word, then the most tied", () => {
  const E = [
    { id: "1", nom: "Annecy", kind: "commune", poids: 5 },
    { id: "2", nom: "Grand Annecy", kind: "acheteur", poids: 50 },
    { id: "3", nom: "Annemasse", kind: "commune", poids: 9 },
    { id: "4", nom: "Société d'Annecy-le-Vieux", kind: "entreprise", poids: 1 },
    { id: "5", nom: "Lyon", kind: "commune", poids: 99 },
  ];
  assert.deepEqual(
    chercher(E, "anne").map((e) => e.id),
    ["3", "1", "2", "4"],
  );
  assert.deepEqual(
    chercher(E, "annecy vieux").map((e) => e.id),
    ["4"],
  );
  assert.deepEqual(chercher(E, "  "), []);
  assert.equal(chercher(E, "a", 2).length, 2);
});
