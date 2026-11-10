// The map's sheets, board 12 · Fiches de la carte (v3): « Combien en manque-t-il ? »'s arithmetic
// (src/gapcalc.ts) and what the sheets read of a département's register file (src/placedata.ts),
// on frozen cases: the board's Lyon (every category read), Vaulx-en-Velin (one category read),
// a place where nothing is served, and a small département.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { parentCommune } from "../src/arrondissements.ts";
import { type Autorisees, ecart, nb, totalAut } from "../src/gapcalc.ts";
import {
  aCommune,
  actesCam,
  autOf,
  type DepFile,
  depuis,
  etatCam,
  euros,
  per1000,
  rankInEpci,
  tops,
} from "../src/placedata.ts";

const LYON: Autorisees = {
  rows: [
    { cle: "mairie", n: 404 },
    { cle: "commerces", n: 3739 },
    { cle: "autres", n: 2213 },
  ],
  voiePublique: null,
  periode: ["2025-09-30", "2026-11-04"],
};
const VAULX: Autorisees = {
  rows: [
    { cle: "mairie", n: null },
    { cle: "commerces", n: 609 },
    { cle: "autres", n: null },
  ],
  voiePublique: null,
  periode: null,
};

test("the board's Lyon: every category read, the acts all tied: + 4 243, not « au moins »", () => {
  assert.deepEqual(totalAut(LYON, "lu"), { n: 6356, entier: true });
  assert.deepEqual(ecart({ carte: 2113, aut: LYON, etat: "lu" }), {
    kind: "plus",
    n: 4243,
    auMoins: false,
  });
  assert.equal(nb(4243), "4 243");
});

test("some acts without a commune (partiel): the same sum is « au moins »", () => {
  assert.deepEqual(ecart({ carte: 2113, aut: LYON, etat: "partiel" }), {
    kind: "plus",
    n: 4243,
    auMoins: true,
  });
});

test("the board's Vaulx-en-Velin: one category read: au moins + 379", () => {
  assert.deepEqual(totalAut(VAULX, "lu"), { n: 609, entier: false });
  assert.deepEqual(ecart({ carte: 230, aut: VAULX, etat: "lu" }), {
    kind: "plus",
    n: 379,
    auMoins: true,
  });
});

test("nothing served: no total, no gap (« non lu », never 0)", () => {
  assert.equal(totalAut(null, "lu"), null);
  assert.deepEqual(ecart({ carte: 230, aut: null, etat: "lu" }), { kind: "non_lu" });
  const none: Autorisees = { ...VAULX, rows: VAULX.rows.map((r) => ({ ...r, n: null })) };
  assert.equal(totalAut(none, "lu"), null);
  // a map count unknown (an arrondissement's commune without the register's file)
  assert.deepEqual(ecart({ carte: null, aut: LYON, etat: "lu" }), { kind: "non_lu" });
});

test("more cameras on the map than authorised: said only when the acts are the whole", () => {
  assert.deepEqual(ecart({ carte: 7000, aut: LYON, etat: "lu" }), { kind: "moins", n: 644 });
  assert.deepEqual(ecart({ carte: 7000, aut: LYON, etat: "partiel" }), { kind: "incomplet" });
  assert.deepEqual(ecart({ carte: 700, aut: VAULX, etat: "lu" }), { kind: "incomplet" });
});

test("autOf reads cam_aut's categories, a missing one null, nothing served null", () => {
  assert.equal(autOf(undefined), null);
  assert.equal(autOf({}), null);
  assert.equal(autOf({ mairie: null, commerces: null }), null);
  assert.deepEqual(autOf({ commerces: 609, voie_publique: 12, periode: ["2025-10-01", "2026-10-01"] }), {
    rows: [
      { cle: "mairie", n: null },
      { cle: "commerces", n: 609 },
      { cle: "autres", n: null },
    ],
    voiePublique: 12,
    periode: ["2025-10-01", "2026-10-01"],
  });
  assert.deepEqual(autOf({ mairie: 0, commerces: 1, autres: 2, periode: { de: "2025-01-02" } })?.periode, [
    "2025-01-02",
    "2025-01-02",
  ]);
  // a 0 is a 0 when served
  assert.equal(autOf({ mairie: 0 })?.rows[0].n, 0);
});

// A département of four communes, two in one intercommunality (the register's shape, 10/11).
const DEP: DepFile = {
  departement: { code: "99", nom: "Essai", pop: 100_000 },
  communes: {
    "99001": { nom: "Grande", pop: 50_000, epci: "200000001" },
    "99002": { nom: "Moyenne", pop: 20_000, epci: "200000001" },
    "99003": { nom: "Petite", pop: 1_000, epci: "200000001" },
    "99004": { nom: "Seule", pop: 29_000 },
  },
  acheteurs: { "200000001": { nom: "Communauté d'essai", nom_court: "CC d'essai" } },
  stats: {
    depStats: { cam: 40, dr: 3, dr_commune: 0, dr_autorite: 3, montant: 1_400_000, con: 2 },
    communes: {
      "99001": { docs: 10, cam: 30, carte: 200, couverture_actes: { cam: "partiel", dr: "lu" } },
      "99002": { docs: 3, cam: 10, carte: 120, couverture_actes: { cam: "lu", dr: "lu" } },
      "99003": { docs: 0, cam: 0, carte: 0, couverture_actes: { cam: "non_lu", dr: "non_lu" } },
      "99004": { docs: 1, cam: 0, carte: 5 },
    },
  },
  couverture: { etat: "collecte", depuis: "2025-09-30" },
};

test("rank per 1 000 inhabitants in the intercommunality: the map's own count, the others' register's", () => {
  // Moyenne: 120 / 20 000 = 6 ‰, Grande 4 ‰, Petite 0: first of three.
  assert.deepEqual(rankInEpci(DEP, "99002", 120), { r: 1, sur: 3 });
  assert.deepEqual(rankInEpci(DEP, "99001", 200), { r: 2, sur: 3 });
  // no intercommunality: no rank
  assert.equal(rankInEpci(DEP, "99004", 5), null);
  assert.equal(per1000(230, 53_069), 4.3);
  assert.equal(per1000(5, undefined), null);
});

test("« Où sont-elles ? »: the communes with cameras, most first; the total and the communes listed", () => {
  const t = tops(DEP, 6);
  assert.deepEqual(
    t.rows.map((r) => [r.insee, r.carte, r.per1000]),
    [
      ["99001", 200, 4],
      ["99002", 120, 6],
      ["99004", 5, 0.2],
    ],
  );
  assert.equal(t.total, 325);
  assert.equal(t.communes, 3); // those with a document
});

test("coverage: an unlisted commune is non_lu, never lu", () => {
  assert.equal(etatCam(DEP, "99002"), "lu");
  assert.equal(etatCam(DEP, "99001"), "partiel");
  assert.equal(etatCam(DEP, "99004"), "non_lu");
  assert.equal(etatCam(null, "99002"), "non_lu");
  assert.equal(depuis(DEP), "2025");
  assert.equal(depuis({ ...DEP, couverture: { etat: "pilote" } }), null);
});

test("places: arrondissements are their commune's, names take their preposition", () => {
  assert.equal(parentCommune("69382"), "69123");
  assert.equal(parentCommune("75116"), "75056");
  assert.equal(parentCommune("13216"), "13055");
  assert.equal(parentCommune("13217"), "13217");
  assert.equal(parentCommune("69256"), "69256");
  assert.equal(aCommune("Lyon"), "À Lyon");
  assert.equal(aCommune("Le Havre"), "Au Havre");
  assert.equal(aCommune("Les Lilas"), "Aux Lilas");
  assert.equal(aCommune("La Rochelle"), "À La Rochelle");
  assert.equal(euros(1_410_000), "1,4 M€");
  assert.equal(euros(54_810), "55 k€");
});

test("a commune's camera acts: counted when read or tied, never 0 when not read", () => {
  assert.equal(actesCam(DEP, "99002"), 10); // lu
  assert.equal(actesCam(DEP, "99001"), 30); // partiel, some tied
  assert.equal(actesCam(DEP, "99003"), undefined); // non_lu, 0 in the file
  assert.equal(actesCam(DEP, "99004"), undefined); // no coverage served
  const tied = { ...DEP, stats: { ...DEP.stats, communes: { ...DEP.stats.communes, "99002": { cam: 0, couverture_actes: { cam: "partiel" } } } } };
  assert.equal(actesCam(tied, "99002"), undefined); // partiel with none tied: not a 0
  const none = { ...DEP, stats: { ...DEP.stats, communes: { ...DEP.stats.communes, "99002": { cam: 0, couverture_actes: { cam: "non_rattache" } } } } };
  assert.equal(actesCam(none, "99002"), undefined);
});
