// A company's page (src/registre/vues/entreprise-outils.ts) on a SYNTHETIC file shaped as the build
// writes entreprise/<siren>.json: made-up companies, buyers and contracts, no source's data. A total
// adds the contracts flagged `compte` only; the running list is the build's; a sole trader is never
// named; one is singular.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type Rich, richText } from "../src/registre/dc.ts";
import { setMessages } from "../src/registre/i18n.ts";
import {
  Entreprise,
  type FichierEntreprise,
  lead,
  prepare,
} from "../src/registre/vues/entreprise-outils.ts";
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
      "100000001": { nom: "ACME VIDEO", ...over },
      "100000002": { entrepreneur_individuel: true },
    },
    acheteurs: {
      "200000001": { nom: "Commune de Une", categorie: "commune", insee_siege: "69001", dep: "69" },
      "200000002": { nom: "Commune de Deux", categorie: "commune", insee_siege: "69002", dep: "69" },
      "200000003": { nom: "Centrale", categorie: "autre", dep: "93" },
    },
    communes: { "69001": { nom: "Une", dep: "69" }, "69002": { nom: "Deux", dep: "69" } },
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

test("the page's values: figures, running contracts, unknown ends, singulars", () => {
  const v = new Entreprise({ siren: "100000001", F: fichier() }).renderVals() as Record<string, unknown>;
  assert.equal(v.nom, "Acme Video");
  assert.equal((v.tete as { ligne: string }).ligne, "SIREN 100 000 001");
  const kpis = v.kpis as { v: string; l: string; aide?: string }[];
  assert.deepEqual(
    kpis.map((k) => k.v),
    ["3", "3", `600${N}000 €`, "1"],
  );
  assert.equal(kpis[0].l, "contrats signés");
  // « 1 contrat sur 1 n'a reçu qu'une offre », its help saying which contracts count (B7)
  assert.equal(kpis[3].l, "contrat sur 1 n'a reçu qu'une offre");
  assert.equal(kpis[3].aide, "Le contrat compté est le seul dont le nombre d'offres reçues est publié.");
  assert.equal(v.nAct, "1 contrat");
  assert.equal(v.sansFin, "1 contrat n'a pas de durée publiée : sa fin n'est pas connue.");
  assert.equal(richText((v.act as { nom: Rich }[])[0].nom), "Deux");
  // the largest: the counted ones only, never the ceiling for other buyers
  assert.deepEqual(
    (v.big as { amt: string }[]).map((b) => b.amt),
    [`300${N}000 €`, `300${N}000 €`],
  );
  assert.equal(v.parPhrase, "1 des 3 contrats a été signé avec d'autres entreprises.");
  // a co-contractor who is a sole trader has no page and is listed by no name (DECISIONS 2026-10-29)
  assert.deepEqual(v.partners, []);
  assert.equal(v.docsPhrase, "4 documents : 3 contrats et 1 modification, avec la cliente, le montant et la source.");
  assert.equal(v.doublonNote, " Un contrat publié deux fois compte une fois : 3 contrats ici, 4 lignes publiées dans les données de la commande publique.");
  // a commune buyer opens its commune's page, its link the territories' (design/registre/v2)
  const client = (v.clients as { nom: Rich }[]).map((c) => JSON.stringify(c.nom)).find((c) => c.includes("69001"));
  assert.match(client ?? "", /"href":"\/registre\/commune\/69001"/);
  assert.match(client ?? "", /"c":"var\(--type-territoire\)"/);
});

test("the lead says what the build found, nothing more", () => {
  const F = fichier();
  assert.equal(richText(lead(F, 3, 3)), "3 collectivités lui ont signé 3 contrats depuis 2024, surtout dans le Rhône.");
  assert.equal(richText(lead(F, 1, 1)), "1 collectivité lui a signé 1 contrat depuis 2024, surtout dans le Rhône.");
});

test("no « Ce qui ressort »: no amounts or dates set side by side to suggest (v2.1 B5)", () => {
  const v = new Entreprise({ siren: "100000001", F: fichier() }).renderVals() as Record<string, unknown>;
  assert.equal("faits" in v, false);
  assert.doesNotMatch(JSON.stringify(v), /mêmes montants|d'intervalle/);
});

test("a sole trader is never named, nor its number shown", () => {
  const v = new Entreprise({
    siren: "100000001",
    F: fichier({ nom: null, entrepreneur_individuel: true }),
  }).renderVals() as Record<string, unknown>;
  assert.equal(v.nom, "entreprise individuelle, nom non publié");
  assert.equal((v.tete as { nom: string }).nom, "entreprise individuelle, nom non publié");
  assert.equal((v.tete as { ligne: string }).ligne, "Entreprise individuelle");
  assert.equal(v.parcourir, "/registre/");
});

test("the single-offer ticket: plural, its help, and none published", () => {
  const F = fichier();
  F.page = { ...F.page, faits: { offres: { une_offre: 2, renseignes: 27 } } };
  let k = (new Entreprise({ siren: "100000001", F }).renderVals() as { kpis: { v: string; l: string; aide?: string }[] }).kpis[3];
  assert.equal(`${k.v} ${k.l}`, "2 contrats sur 27 n'ont reçu qu'une offre");
  assert.equal(k.aide, "Les 27 sont les contrats dont le nombre d'offres reçues est publié ; pour les autres, il ne l'est pas.");
  F.page = { ...F.page, faits: { offres: null } };
  k = (new Entreprise({ siren: "100000001", F }).renderVals() as { kpis: { v: string; l: string; aide?: string }[] }).kpis[3];
  assert.deepEqual([k.v, k.l, k.aide], ["—", "nombre d'offres reçues non publié", undefined]);
});

test("one buyer, every contract shared, no modification, no known end: said as such", () => {
  const F = fichier();
  // SYNTHETIC: keep a and b only, both signed with another company, no duration published
  F.stats = { ...(F.stats as NonNullable<FichierEntreprise["stats"]>), contrats: ["a~0", "b~0"] };
  for (const e of F.evenements) e.entreprises = ["100000001", "100000002"];
  F.page = {
    ...F.page,
    fins: {
      "a~0": { debut: "2024-03-01", duree: null, fin: null },
      "b~0": { debut: "2025-05-01", duree: null, fin: null },
    },
    en_cours: [],
    sans_fin: 2,
    modifications: 0,
  };
  const v = new Entreprise({ siren: "100000001", F }).renderVals() as Record<string, unknown>;
  // no end known: not « 0 contrat »
  assert.equal(v.nAct, "non connu");
  assert.equal(v.bigPhrase, "Ses 2 contrats, par montant.");
  assert.equal(v.parPhrase, "Ses 2 contrats ont été signés avec d'autres entreprises.");
  assert.equal(v.docsPhrase, "2 contrats, avec la cliente, le montant et la source.");
});
