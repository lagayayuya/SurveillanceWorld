// The register's home (board Accueil-Registre-A): « Cette semaine » never shows a date after the
// build's (a drone decree's date is its first day of flight: 18 nov. on a build of 8 nov., the lot 1
// review), its « Tous » brings the contracts and the notices back; a buyer is named so that one
// knows where it is (« CCAS de Nice »); a published object reads in ordinary case. SYNTHETIC
// documents, no source's data.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Evenement } from "../src/registre/donnees.ts";
import {
  avantVol,
  casseNormale,
  dansOnglet,
  jourDoc,
  nomAcheteur,
  QUESTION,
  recentes,
  ordreDeps,
} from "../src/registre/vues/accueil-outils.ts";

const ev = (id: string, t: string, date: string, publie?: string) =>
  ({ id, t, date, ...(publie ? { publie } : {}) }) as unknown as Evenement;
const MAJ = "2026-11-08";
const DOCS = [
  // a drone decree flies on `date`, was published on `publie` (A, b272a68)
  ev("d1", "arrete_drone", "2026-11-18", "2026-11-07"),
  ev("d2", "arrete_drone", "2026-11-10", "2026-11-03"),
  ev("d3", "arrete_drone", "2026-11-07"),
  ev("c1", "attribution", "2026-11-05"),
  ev("a1", "avis", "2026-11-06"),
  ev("r1", "arrete", "2026-11-04"),
  ev("m1", "modification", "2026-11-12"),
];

test("« Cette semaine »: no date after the build's, the latest published first, in every tab", () => {
  for (const o of ["tous", "contrats", "arretes", "drones"] as const) {
    const got = recentes(DOCS, MAJ, o);
    const jours = got.map((e) => jourDoc(e, o) ?? "");
    assert.ok(jours.every((j) => j && j <= MAJ), o);
    assert.deepEqual(jours, [...jours].sort().reverse(), o);
  }
  // « Tous »: a drone decree by its publication (d1 flies on the 18th, published on the 7th); one
  // without `publie` stays out
  assert.deepEqual(
    recentes(DOCS, MAJ, "tous").map((e) => e.id),
    ["d1", "a1", "c1", "r1", "d2"],
  );
  // the drones' tab: by `publie`, by a past `date` without it
  assert.deepEqual(
    recentes(DOCS, MAJ, "drones").map((e) => e.id),
    ["d1", "d3", "d2"],
  );
  assert.equal(recentes(DOCS, MAJ, "tous", 2).length, 2);
  assert.ok(dansOnglet("tous", "arrete_drone") && dansOnglet("tous", "attribution"));
  // the API: « Tous » asks its drones apart, the drones' tab its device
  assert.ok(!QUESTION.tous[0].p.split(",").includes("dr"));
  assert.equal(QUESTION.tous[1].p, "dr");
  assert.equal(QUESTION.drones[0].p, "dr");
});

test("a buyer's name says where it is", () => {
  const L = { communes: { "06088": { nom: "Nice", dep: "06" } } } as never;
  const dep = (d: string) => (d === "38" ? "Isère" : d);
  assert.equal(
    nomAcheteur({ nom: "Centre Communal d'Action Sociale", insee_siege: "06088", dep: "06" }, L, dep),
    "CCAS de Nice",
  );
  assert.equal(nomAcheteur({ nom: "Commune", insee_siege: "06088" }, L, dep), "Commune de Nice");
  assert.equal(nomAcheteur({ nom: "Syndicat mixte", dep: "38" }, L, dep), "Syndicat mixte (Isère)");
  // a name that says it already, unchanged
  assert.equal(nomAcheteur({ nom: "Commune de Lyon", insee_siege: "69123" }, L, dep), "Commune de Lyon");
  assert.equal(
    nomAcheteur({ nom: "x", nom_court: "Métropole Nice Côte d'Azur", insee_siege: "06088" }, L, dep),
    "Métropole Nice Côte d'Azur",
  );
  // nowhere to say: as published
  assert.equal(nomAcheteur({ nom: "Métropole" }, L, dep), "Métropole");
});

test("a published object in ordinary case", () => {
  assert.equal(
    casseNormale("LOT 1 - ACHAT, INSTALLATION ET MAINTENANCE DES EQUIPEMENTS"),
    "Lot 1 - achat, installation et maintenance des equipements",
  );
  assert.equal(casseNormale("LOT2 CA 100 -FOURNITURE"), "Lot2 ca 100 -fourniture");
  assert.equal(
    casseNormale("Fourniture, installation et maintenance"),
    "Fourniture, installation et maintenance",
  );
  assert.equal(casseNormale(""), "");
});

test("« Publiés avant le vol ? »: shares on the acts counted, « non lu » when none, the others said", () => {
  // France on the local register after A's fe106f2: 746 / 323 / 181 of 1 250, 6 480 without days
  const fr = avantVol({ avant: 746, jour_meme: 323, apres: 181, total: 1250, non_lus: 6480, deps: ["13", "75"] });
  assert.equal(fr.nonLu, false);
  assert.deepEqual(
    fr.parts.map((x) => x.pct),
    [60, 26, 14],
  );
  assert.equal(fr.parts.reduce((a, x) => a + x.pct, 0), 100);
  assert.deepEqual(fr.deps, ["13", "75"]);
  assert.equal(fr.ailleurs, true);
  // Lyon: none counted, « non lu », never « 0 % »
  const lyon = avantVol({ avant: 0, jour_meme: 0, apres: 0, total: 0, non_lus: 50 });
  assert.equal(lyon.nonLu, true);
  assert.deepEqual(lyon.parts, []);
  assert.equal(avantVol(undefined).nonLu, true);
  // more counted than not: no « ailleurs »
  assert.equal(avantVol({ avant: 1, jour_meme: 1, apres: 1, total: 3, non_lus: 2 }).ailleurs, false);
});

test("« Publiés avant le vol ? » names its départements by their acts, Paris first (Ju 09/11)", () => {
  const dr: Record<string, number> = { "13": 349, "69": 126, "75": 782 };
  // the build's order (13, 69, 75) by the counts of listes.json
  assert.deepEqual(ordreDeps(["13", "69", "75"], (d) => dr[d]), ["75", "13", "69"]);
  // before listes.json, or a count missing: the order measured on 08/11, then the others
  assert.deepEqual(ordreDeps(["13", "69", "75"]), ["75", "13", "69"]);
  assert.deepEqual(ordreDeps(["92", "13", "75"], (d) => dr[d]), ["75", "13", "92"]);
  // a larger count goes first, ties keep the measured order
  assert.deepEqual(ordreDeps(["75", "13"], () => 5), ["75", "13"]);
  assert.deepEqual(ordreDeps(["75", "69"], (d) => (d === "69" ? 900 : 10)), ["69", "75"]);
});

test("the map's labels never meet: the next largest is named instead", async () => {
  const { etiquettesLibres } = await import("../src/registre/vues/accueil-outils.ts");
  const c = [
    { x: 100, y: 20, l: "Pas-de-Cal." },
    { x: 130, y: 30, l: "Nord" },
    { x: 300, y: 300, l: "Rhône" },
    { x: 100, y: 60, l: "Somme" },
  ];
  assert.deepEqual(
    etiquettesLibres(c, 3).map((e) => e.l),
    ["Pas-de-Cal.", "Rhône", "Somme"],
  );
});
