// A company's file as the fiche reads it (src/registre/vues/entreprise-outils.ts) on a SYNTHETIC file
// shaped as the build writes entreprise/<siren>.json: made-up companies, buyers and contracts, no
// source's data. A total adds the contracts flagged `compte` only; a sole trader is never named.
// The theme A fiche's computations: registre-entreprise-a.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { entName } from "../src/registre/corpus.ts";
import { setMessages } from "../src/registre/i18n.ts";
import { type FichierEntreprise, placeOf, prepare } from "../src/registre/vues/entreprise-outils.ts";
import { setWords } from "../src/registre/vue.ts";

const catalogue: Record<string, string> = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"));
const registre = Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre.")));
setMessages(registre);
setWords(registre);
const N = " ";

/** SYNTHETIC: two communes and an intercommunality buy from the company « ACME VIDEO ». */
function fichier(over: Partial<FichierEntreprise["entreprise"]> = {}): FichierEntreprise {
  const con = (id: string, date: string, b: string, insee: string, montant: number, x = {}) => ({
    id: `${id}~0`,
    t: "attribution",
    date,
    insee,
    dep: insee.slice(0, 2),
    affaire: id,
    entreprises: ["100000001"],
    montant,
    acheteur_siren: b,
    compte: true,
    copie: false,
    ...x,
  });
  const evenements = [
    con("a", "2024-03-01", "200000001", "69001", 300_000),
    con("b", "2025-05-01", "200000002", "69002", 300_000, { entreprises: ["100000001", "100000002"] }),
    // a ceiling for other buyers: not added
    con("c", "2025-06-01", "200000003", "", 5_000_000, { compte: false, hors_totaux: "centrale" }),
    // the second publication of a: a copy, not in the company's list
    con("a2", "2024-03-01", "200000001", "69001", 300_000, { compte: false, copie: true }),
  ];
  return {
    v: 1,
    entreprise: { siren: "100000001", nom: "ACME VIDEO", entrepreneur_individuel: false, ...over },
    evenements,
    affaires: Object.fromEntries(evenements.map((e) => [e.affaire, { events: [e.id], acheteur_siren: e.acheteur_siren }])),
    entreprises: {
      "100000001": { nom: "ACME VIDEO", ref: "entreprise/100000001", ...over },
      "100000002": { entrepreneur_individuel: true },
    },
    acheteurs: {
      "200000001": { nom: "Commune de Une", categorie: "commune", insee_siege: "69001", dep: "69", ref: "acheteur/200000001" },
      "200000002": { nom: "Commune de Deux", categorie: "commune", insee_siege: "69002", dep: "69", ref: "acheteur/200000002" },
      "200000003": { nom: "Centrale", categorie: "autre", dep: "93", ref: "acheteur/200000003" },
    },
    communes: { "69001": { nom: "Une", dep: "69", ref: "commune/69001" }, "69002": { nom: "Deux", dep: "69", ref: "commune/69002" } },
    stats: { n: 3, copies: 1, clientes: ["200000001", "200000002", "200000003"], montant: 600_000, y0: "2024", contrats: ["a~0", "b~0", "c~0"] },
    page: {
      maj: "2026-10-24",
      fins: {
        "a~0": { debut: "2024-03-01", duree: 12, fin: "2025-03-01" },
        "b~0": { debut: "2025-05-01", duree: 36, fin: "2028-05-01" },
        "c~0": { debut: "2025-06-01", duree: null, fin: null },
      },
      en_cours: ["b~0"],
      sans_fin: 1,
      modifications: 1,
      faits: { offres: { une_offre: 1, renseignes: 1 } },
      activite: null,
      lieux: { surtout: true, regions: ["69"] },
    },
  };
}

test("the contracts: the build's list (no copy), oldest first; a total adds `compte` only", () => {
  const { CT, CL } = prepare(fichier());
  assert.deepEqual(
    CT.map((c) => c.e.id),
    ["a~0", "b~0", "c~0"],
  );
  assert.equal(
    CT.reduce((s, c) => s + c.amt, 0),
    600_000,
  );
  assert.equal(CL.length, 3);
  assert.equal(CL.find((c) => c.s === "200000003")?.centrale, true);
});

test("a contract is named by its commune; a sole trader by no name", () => {
  const F = fichier();
  const { CT } = prepare(F);
  assert.deepEqual(
    CT.map((c) => placeOf(F, c)),
    ["Une", "Deux", "Centrale"],
  );
  assert.equal(entName(F, "100000002"), "entreprise individuelle, nom non publié");
  assert.equal(entName(F, "100000001"), "Acme Video");
});

test("a legal person's Sources lead to its official record; a sole trader's never", async () => {
  const { annuaire, sources } = await import("../src/registre/sources.ts");
  const rows = sources(undefined, [], true, annuaire("431903954"));
  assert.deepEqual(
    rows.map((s) => [s.href, s.lien]),
    [["https://annuaire-entreprises.data.gouv.fr/entreprise/431903954", "Fiche officielle"]],
  );
  // a sole trader: neither its name nor its number, no SIRENE row at all
  assert.deepEqual(sources(undefined, [], false), []);
});

test("a planned end past its month's last day is that last day", async () => {
  const { jourValide } = await import("../src/registre/vues/entreprise-outils.ts");
  assert.equal(jourValide("2023-11-31"), "2023-11-30");
  assert.equal(jourValide("2024-02-30"), "2024-02-29");
  assert.equal(jourValide("2025-12-10"), "2025-12-10");
});
