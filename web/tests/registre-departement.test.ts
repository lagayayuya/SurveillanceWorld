// The département page's pure helpers (src/registre/vues/departement-outils.ts): its name with its
// prepositions, the share of the most concerned intercommunality in words, an amount cell (a total
// the build counts; « — » when nothing of it counts, never a zero), the rows of its
// intercommunalities and communes, the filter by name with accents ignored, the years shown, and a
// département with no file. The file below is synthetic: the build's own figures are frozen in
// tests/test_registre_departement.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setMessages } from "../src/registre/i18n.ts";
import {
  achatsPropres,
  annees,
  communes,
  epciDe,
  epciHref,
  epciLa,
  type FichierDepartement,
  filtrer,
  intercommunalites,
  lienEpci,
  montant,
  noms,
  part,
  sourcesIds,
  trier,
  vide,
} from "../src/registre/vues/departement-outils.ts";

const catalogue: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
);
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const N = " ";

/** A synthetic département: two communes of one intercommunality, one without any. */
function fichier(): FichierDepartement {
  const f = vide("69", "2026-10-24", { etat: "collecte", depuis: "2025-09-30" });
  f.departement.nom = "Rhône";
  f.communes = {
    "69283": { nom: "Mions", dep: "69", pop: 13968, epci: "200046977" },
    "69290": { nom: "Saint-Priest", dep: "69", pop: 48000, epci: "200046977" },
    "69999": { nom: "Écully", dep: "69" },
  };
  f.stats.communes = {
    "69283": { docs: 19, con: 2, cam: 9, dr: 2, arr: 11, montant: 415000, carte: 10 },
    "69290": { docs: 11, con: 9, cam: 0, dr: 2, arr: 2, montant: 0, carte: null },
    "69999": { docs: 7, con: 7, cam: 0, dr: 0, arr: 0, montant: 0, carte: 24 },
  };
  f.stats.epcis = {
    "200046977": {
      nom: "Métropole de Lyon",
      communes: ["69283", "69290"],
      // a drone decree shared by both communes, once here
      uniq: { docs: 29, con: 11, cam: 9, dr: 3, arr: 12 },
      acheteur: true,
    },
    "": { nom: null, communes: ["69999"], uniq: { docs: 7, con: 7, cam: 0, dr: 0, arr: 0 }, acheteur: false },
  };
  return f;
}

test("a département's name, with its prepositions", () => {
  assert.deepEqual(noms("69", "Rhône"), { nom: "Rhône", art: "le Rhône", dans: "dans le Rhône", du: "du Rhône" });
  assert.deepEqual(noms("75", "Paris"), { nom: "Paris", art: "Paris", dans: "à Paris", du: "de Paris" });
  assert.equal(noms("93", null).du, "de la Seine-Saint-Denis");
  assert.equal(noms("91", null).dans, "dans l'Essonne");
  // a département the catalogue does not name
  assert.deepEqual(noms("01", "Ain"), {
    nom: "Ain",
    art: "le département Ain",
    dans: "dans le département Ain",
    du: "du département Ain",
  });
});

test("a share in words: all is all, under half nothing", () => {
  assert.equal(part(1), "tout");
  assert.equal(part(0.95), "presque");
  assert.equal(part(0.75), "trois_quarts");
  assert.equal(part(0.66), "deux_tiers");
  assert.equal(part(0.5), "moitie");
  assert.equal(part(0.3), null);
  assert.equal(part(0), null);
  assert.equal(part(Number.NaN), null);
  assert.equal(epciLa("Métropole de Lyon"), "la Métropole de Lyon");
  assert.equal(epciLa("CC du Pays de l'Ozon"), "la CC du Pays de l'Ozon");
  assert.equal(epciLa("Paris Terres d'Envol"), "Paris Terres d'Envol");
});

test("an amount: the counted contracts', « — » when none counts, « non publié » when none is given", () => {
  assert.equal(montant({ montant: 29_273_607.87, hors_totaux: 1 }), "29 M€");
  assert.equal(montant({ montant: 453_685, hors_totaux: 0 }), `453${N}685 €`);
  assert.equal(montant({ montant: 0, hors_totaux: 14 }), "—");
  assert.equal(montant({ montant: 0, hors_totaux: 0 }), "non publié");
});

test("the intercommunalities count each document once, the map's cameras when known", () => {
  const f = fichier();
  const coms = communes(f);
  const ics = intercommunalites(f, coms);
  const lyon = ics.find((o) => o.code === "200046977");
  assert.ok(lyon);
  assert.equal(lyon.docs, 29); // not 19 + 11
  assert.equal(lyon.n, 2);
  assert.equal(lyon.cams, 10); // Saint-Priest's map unknown: not a zero, left out
  assert.equal(lyon.acheteur, true);
  const sans = ics.find((o) => o.code === "");
  assert.equal(sans?.nom, "Sans intercommunalité");
  assert.equal(coms.find((c) => c.insee === "69290")?.cams, null);
  assert.equal(coms.find((c) => c.insee === "69283")?.ep, "Métropole de Lyon");
});

test("the filter ignores accents and case; the sort, names in French order", () => {
  const coms = communes(fichier());
  assert.deepEqual(
    filtrer(coms, "ecul").map((c) => c.nom),
    ["Écully"],
  );
  assert.deepEqual(
    filtrer(coms, " SAINT ").map((c) => c.nom),
    ["Saint-Priest"],
  );
  assert.equal(filtrer(coms, "").length, 3);
  assert.deepEqual(
    trier(coms, "nom", 1).map((c) => c.nom),
    ["Écully", "Mions", "Saint-Priest"],
  );
  assert.deepEqual(
    trier(coms, "docs", -1).map((c) => c.docs),
    [19, 11, 7],
  );
  // an unknown map count sorts last
  assert.deepEqual(
    trier(coms, "cams", -1).map((c) => c.cams),
    [24, 10, null],
  );
});

test("nine years, the last the build's", () => {
  assert.deepEqual(annees("2026-10-24"), ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]);
  assert.equal(annees("2027-01-02")[0], "2019");
});

test("a département with no document: empty figures, its collection kept", () => {
  const f = vide("91", "2026-10-24", { etat: "impossible", raison: "ferme_aux_robots", documents_demandes: true });
  assert.equal(f.couverture.etat, "impossible");
  assert.equal(f.stats.depStats.docs, 0);
  assert.deepEqual(intercommunalites(f, communes(f)), []);
});

test("one fiche per territory: an intercommunality's by its code, a link of its type", () => {
  const f = fichier();
  assert.equal(epciDe(f, "200046977"), "200046977");
  // an unknown code is the département's fiche, not an error
  assert.equal(epciDe(f, "999999999"), "");
  assert.equal(epciDe(f, ""), "");
  assert.equal(epciHref("69", "200046977"), "/registre/departement/69?ic=200046977");
  const a = lienEpci(f, "200046977") as { a: { href: string; text: string; c: string } };
  assert.equal(a.a.href, "/registre/departement/69?ic=200046977");
  assert.equal(a.a.text, "Métropole de Lyon");
  assert.equal(a.a.c, "var(--type-territoire)");
  // no row in the file: its words only
  assert.deepEqual(lienEpci(f, "247800584", "CA Versailles Grand Parc"), { span: "CA Versailles Grand Parc", cls: "" });
});

test("its own purchases: the intercommunality's buyer file, the département's own buyers", () => {
  const f = fichier();
  assert.deepEqual(achatsPropres(f, "200046977"), ["200046977"]);
  // no contract signed: its file is read all the same (its notices)
  f.stats.epcis["200046977"].acheteur = false;
  assert.deepEqual(achatsPropres(f, "200046977"), ["200046977"]);
  assert.deepEqual(achatsPropres(f, "999999999"), []);
  f.acheteurs = {
    "226900017": { nom: "Département du Rhône", categorie: "departement", dep: "69" },
    "221300015": { nom: "Département des Bouches-du-Rhône", categorie: "departement", dep: "13" },
    "216902825": { nom: "Commune de Vénissieux", categorie: "commune", dep: "69" },
  };
  assert.deepEqual(achatsPropres(f, ""), ["226900017"]);
});

test("the sources of a territory: its prefecture's decrees, its region's subsidies", () => {
  assert.deepEqual(sourcesIds("69"), ["contrats", "avis", "arretes_69", "subventions_etat_69"]);
  assert.deepEqual(sourcesIds("93").slice(-1), ["subventions_region_idf"]);
  assert.deepEqual(sourcesIds("13").slice(-1), ["subventions_region_sud"]);
});
