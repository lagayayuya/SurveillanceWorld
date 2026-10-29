// A company's page (src/registre/vues/entreprise-outils.ts) on a SYNTHETIC file shaped as the build
// writes entreprise/<siren>.json: made-up companies, buyers and contracts, no source's data. A total
// adds the contracts flagged `compte` only; the running list is the build's; a sole trader is never
// named; one is singular.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { richText } from "../src/registre/dc.ts";
import { setMessages } from "../src/registre/i18n.ts";
import {
  Entreprise,
  type FichierEntreprise,
  faits,
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
      faits: {
        identiques: [{ montant: 300_000, contrats: ["a~0", "b~0"] }],
        rapproche: null,
        offres: { une_offre: 1, renseignes: 1 },
      },
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
  assert.equal(v.sous, "SIREN 100 000 001");
  const kpis = v.kpis as { v: string; l: string }[];
  assert.deepEqual(
    kpis.map((k) => k.v),
    ["3", "3", `600${N}000 €`, "1 sur 1"],
  );
  assert.equal(kpis[0].l, "contrats signés");
  assert.equal(v.nAct, "1 contrat");
  assert.equal(v.sansFin, "1 contrat n'a pas de durée publiée : sa fin n'est pas connue.");
  assert.equal((v.act as { nom: string }[])[0].nom, "Deux");
  // the largest: the counted ones only, never the ceiling for other buyers
  assert.deepEqual(
    (v.big as { amt: string }[]).map((b) => b.amt),
    [`300${N}000 €`, `300${N}000 €`],
  );
  assert.equal(v.parPhrase, "1 des 3 contrats a été signé avec d'autres entreprises.");
  // a co-contractor who is a sole trader is not named
  assert.deepEqual(v.partners, [{ nom: "nom non publié", n: "1 contrat", href: "/registre/entreprise/100000002" }]);
  assert.equal(v.docsPhrase, "4 documents : 3 contrats et 1 modification, avec la cliente, le montant et la source.");
  assert.equal(v.doublonNote, " Un contrat publié deux fois compte une fois : 3 contrats ici, 4 lignes publiées dans les données de la commande publique.");
  // a commune buyer opens its commune's page
  assert.equal((v.clients as { href: string }[]).find((c) => c.href.includes("69001"))?.href, "/registre/commune/69001");
});

test("the lead and the facts say what the build found, nothing more", () => {
  const F = fichier();
  const { CT } = prepare(F);
  assert.equal(richText(lead(F, 3, 3)), "3 collectivités lui ont signé 3 contrats depuis 2024, surtout dans le Rhône.");
  assert.equal(richText(lead(F, 1, 1)), "1 collectivité lui a signé 1 contrat depuis 2024, surtout dans le Rhône.");
  const fs = faits(F, CT).map((f) => richText(f));
  assert.deepEqual(fs, [
    `Les mêmes montants reviennent : 300${N}000 € à Une et Deux.`,
    "Une seule offre pour 1 contrat sur les 1 où le nombre d'offres est publié.",
  ]);
  // every place is a link to its buyer's page
  const links = JSON.stringify(faits(F, CT)[0]);
  assert.match(links, /\/registre\/commune\/69001/);
  // no word that judges
  for (const f of fs) assert.doesNotMatch(f, /pourrait|serait|suspect|étrange|anormal|favoris/i);
});

test("a sole trader is never named, nor its number shown", () => {
  const v = new Entreprise({
    siren: "100000001",
    F: fichier({ nom: null, entrepreneur_individuel: true }),
  }).renderVals() as Record<string, unknown>;
  assert.equal(v.nom, "nom non publié");
  assert.equal(v.filIci, "nom non publié");
  assert.equal(v.sous, "Entreprise individuelle");
  assert.equal(v.parcourir, "/registre/");
});
