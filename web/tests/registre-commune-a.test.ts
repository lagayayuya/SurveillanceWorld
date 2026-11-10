// A commune's fiche in theme A (board Lyon-A-theme-actuel, lot 2): what it computes from the
// commune's file. SYNTHETIC decrees and contracts, no source's data.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aNom,
  argentParAnnee,
  articleEpci,
  camerasAutorisees,
  contracte,
  deNom,
  fournisseurs,
  grandsSystemes,
  joursDeVol,
  joursPublies,
  rang,
  classeMotif,
  strate,
} from "../src/registre/vues/commune-a.ts";

const arr = (x: Record<string, unknown>) => ({ t: "arrete", copie: false, ...x }) as never;

test("the cameras the decrees authorise, by kind of beneficiary; the largest systems, named only when published", () => {
  const A = [
    arr({ cameras: 40, communal: true, type_beneficiaire: "commune" }),
    arr({ cameras: 12, type_beneficiaire: "commerce", beneficiaire: "LIDL", beneficiaire_siren: "1", nom_publie: true }),
    arr({ cameras: 8, type_beneficiaire: "commerce", beneficiaire: "LIDL", beneficiaire_siren: "1", nom_publie: true }),
    arr({ cameras: 5, type_beneficiaire: "banque", beneficiaire: "[non retenu]" }),
    arr({ cameras: 30, type_beneficiaire: "transport", beneficiaire: "Une personne", nom_publie: false }),
    arr({ cameras: 9, type_beneficiaire: "etat", beneficiaire: "France Travail", nom_publie: true }),
    arr({ cameras: 99, copie: true }),
    { t: "arrete_drone", cameras: 3 } as never,
  ];
  assert.deepEqual(camerasAutorisees(A), { mairie: 40, commerces: 25, autres: 39, total: 104 });
  // the mairie, a private person, a name not checked: never among the systems
  assert.deepEqual(
    grandsSystemes(A).map((x) => [x.nom, x.arretes, x.cameras]),
    [
      ["LIDL", 2, 20],
      ["France Travail", 1, 9],
    ],
  );
});

test("the money by year and by buyer, every year from 2018 shown", () => {
  const C = [
    { date: "2022-03-10", montant: 6e6, s: "ville" },
    { date: "2022-05-01", montant: 1e6, s: "transports" },
    { date: "2026-01-06", montant: 20e6, s: "ville" },
    { date: "2017-01-01", montant: 9e6, s: "ville" },
  ];
  const { annees, totaux } = argentParAnnee(C, ((e: { s: never }) => e.s) as never);
  assert.equal(annees[0].an, "2018");
  assert.equal(annees.at(-1)?.an, "2026");
  assert.equal(annees.length, 9);
  assert.deepEqual(annees.find((a) => a.an === "2022"), { an: "2022", ville: 6e6, transports: 1e6, autres: 0 });
  assert.deepEqual(totaux, { ville: 26e6, transports: 1e6, autres: 0 });
});

test("the suppliers by amount, the days of flight in twelve months, a rank among others", () => {
  const f = fournisseurs([
    { entreprises: ["a"], montant: 20e6, date: "2026-01-06" },
    { entreprises: ["a", "b"], montant: 6e6, date: "2022-03-10" },
    { entreprises: ["c"], montant: 1e5, date: "2018-11-16" },
  ]);
  assert.deepEqual(
    f.map((x) => [x.siren, x.montant, x.contrats, x.annees.join(",")]),
    [
      ["a", 26e6, 2, "2022,2026"],
      ["b", 6e6, 1, "2022"],
      ["c", 1e5, 1, "2018"],
    ],
  );
  const j = joursDeVol(
    [
      { t: "arrete_drone", jours: ["2026-11-05", "2026-11-05", "2026-10-01", "2025-10-01"] },
      { t: "arrete_drone", jours: ["2026-11-05", "2026-11-18"] },
      { t: "arrete", jours: ["2026-11-01"] },
    ],
    "2026-11-08",
  );
  // a day once per act, none after the update nor a year before it
  assert.deepEqual([...j].sort(), [
    ["2026-10-01", 1],
    ["2026-11-05", 2],
  ]);
  assert.equal(strate(519127), 200000);
  assert.equal(strate(42982), 20000);
  assert.equal(strate(45), 0);
  assert.deepEqual(rang(61, [117, 61, 23, -1, 10, 4]), { r: 2, n: 5 });
  assert.equal(rang(null, [1, 2]), null);
  // « 3e sur 3 » says nothing: under five communes ranked, no rank
  assert.equal(rang(61, [117, 61, 23, -1, 10]), null);
});

test("a drone act's motive in the board's classes", () => {
  assert.equal(classeMotif({ categorie: "manifestation", libelle: null, origine: "regles" }), "manifestation");
  for (const c of ["sport", "concert_fete", "commemoration"])
    assert.equal(classeMotif({ categorie: c }), "evenement");
  assert.equal(classeMotif({ categorie: "stupefiants" }), "stupefiants");
  assert.equal(classeMotif(undefined), null);
  assert.equal(classeMotif({ categorie: null }), null);
});

test("a name in a sentence: its article contracted, a size class's point once (recette 21)", () => {
  assert.equal(deNom("Les Baux-de-Provence"), "des Baux-de-Provence");
  assert.equal(deNom("Le Mans"), "du Mans");
  assert.equal(deNom("La Ciotat"), "de La Ciotat");
  assert.equal(deNom("Lyon"), "de Lyon");
  assert.equal(deNom("Aix-en-Provence"), "d'Aix-en-Provence");
  assert.equal(aNom("Les Baux-de-Provence"), "aux Baux-de-Provence");
  assert.equal(aNom("Le Mans"), "au Mans");
  assert.equal(aNom("La Ciotat"), "à La Ciotat");
  const nom = "Les Baux-de-Provence";
  assert.equal(
    contracte(`Les arrêtés de caméras de ${nom} ne sont pas lus`, nom),
    "Les arrêtés de caméras des Baux-de-Provence ne sont pas lus",
  );
  assert.equal(contracte(`des drones à ${nom} sur 12 mois`, nom), "des drones aux Baux-de-Provence sur 12 mois");
  // a name inside a longer name, or another word: untouched
  assert.equal(contracte("la gare de Le Mans-Nord", "Le Mans"), "la gare de Le Mans-Nord");
  assert.equal(contracte("Vichy parmi les communes de 20 000 à 100 000 hab..", "Vichy"), "Vichy parmi les communes de 20 000 à 100 000 hab.");
  assert.equal(articleEpci("CC Vallée des Baux-Alpilles"), "la CC Vallée des Baux-Alpilles");
  assert.equal(articleEpci("Métropole du Grand Paris"), "la Métropole du Grand Paris");
  assert.equal(articleEpci("Grand Paris Seine Ouest"), "Grand Paris Seine Ouest");
});

test("the days today's acts were published: each once, a month written once", () => {
  assert.deepEqual(joursPublies(["2026-11-08", "2026-11-06", "2026-11-06T10:00", null], "2026"), [
    { jours: [6, 8], mois: "2026-11", an: null },
  ]);
  assert.deepEqual(joursPublies(["2026-11-02", "2025-12-30", "2026-10-31"], "2026"), [
    { jours: [30], mois: "2025-12", an: "2025" },
    { jours: [31], mois: "2026-10", an: null },
    { jours: [2], mois: "2026-11", an: null },
  ]);
  assert.deepEqual(joursPublies([], "2026"), []);
});
