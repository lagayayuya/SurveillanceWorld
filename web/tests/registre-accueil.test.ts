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
  nomAcheteur,
  QUESTION,
  recentes,
} from "../src/registre/vues/accueil-outils.ts";

const ev = (id: string, t: string, date: string) => ({ id, t, date }) as unknown as Evenement;
const MAJ = "2026-11-08";
const DOCS = [
  ev("d1", "arrete_drone", "2026-11-18"),
  ev("d2", "arrete_drone", "2026-11-10"),
  ev("d3", "arrete_drone", "2026-11-07"),
  ev("c1", "attribution", "2026-11-05"),
  ev("a1", "avis", "2026-11-06"),
  ev("r1", "arrete", "2026-11-04"),
  ev("m1", "modification", "2026-11-12"),
];

test("« Cette semaine »: no date after the build's, the latest first, in every tab", () => {
  for (const o of ["tous", "contrats", "arretes", "drones"] as const) {
    const got = recentes(DOCS, MAJ, o);
    assert.ok(got.every((e) => (e.date ?? "") <= MAJ), o);
    const dates = got.map((e) => e.date);
    assert.deepEqual(dates, [...dates].sort().reverse(), o);
  }
  // « Tous »: the contracts and the notices, not the drones (their date is a flight's)
  assert.deepEqual(
    recentes(DOCS, MAJ, "tous").map((e) => e.id),
    ["a1", "c1", "r1"],
  );
  assert.deepEqual(
    recentes(DOCS, MAJ, "drones").map((e) => e.id),
    ["d3"],
  );
  assert.equal(recentes(DOCS, MAJ, "tous", 2).length, 2);
  assert.ok(!dansOnglet("tous", "arrete_drone") && dansOnglet("tous", "attribution"));
  // the API is asked for the same tabs: « Tous » without the drones' device
  assert.ok(!QUESTION.tous.p.split(",").includes("dr"));
  assert.equal(QUESTION.drones.p, "dr");
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
