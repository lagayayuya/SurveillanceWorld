// A buyer's page, its pure part (registre/vues/acheteur-outils.ts): a collectivité buyer's path (its
// commune's, its intercommunality's, its département's page), the total of the counted contracts
// only, who sells here, the lead's facts, the calls for tenders, its contracts by year, where they
// are, the sort. SYNTHETIC records shaped as the build writes acheteur/<siren>.json (lacarte-registre
// construire); the real figures are frozen in tests/test_registre_acheteur.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { RichItem } from "../src/registre/dc.ts";
import { richText } from "../src/registre/dc.ts";
import type { Evenement } from "../src/registre/donnees.ts";
import { setMessages } from "../src/registre/i18n.ts";
import {
  appels,
  categorie,
  contrats,
  departementAVerifier,
  enCours,
  type FichierAcheteur,
  lead,
  lieux,
  months,
  parAnnee,
  premiers,
  publications,
  redirection,
  sirenSpaced,
  titreCourt,
  total,
  trier,
  vendeurs,
} from "../src/registre/vues/acheteur-outils.ts";
import type { FichierDepartement } from "../src/registre/vues/departement-outils.ts";

const catalogue: Record<string, string> = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"));
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const N = " ";

const ev = (id: string, x: Partial<Evenement>): Evenement => ({ id, t: "attribution", affaire: id.split("~")[0], ...x });

/** SYNTHETIC: a transport authority, three contracts (one mixed, one shared by two companies), a
 * notice whose contract was not found, a linked buyer with one contract. */
function fichier(over: Partial<FichierAcheteur["acheteur"]> = {}): FichierAcheteur {
  const evenements: Evenement[] = [
    ev("a1~0", { date: "2018-06-20", montant: 5_000_000, entreprises: ["111111111"], compte: true, duree: 84 as unknown as string }),
    ev("a1~1", { t: "modification", date: "2022-01-10", montant: 4_800_000, entreprises: ["111111111"], compte: false, duree: 96 as unknown as string }),
    ev("a2~0", { date: "2019-04-23", montant: 900_000, entreprises: ["111111111"], compte: false, hors_totaux: "mixte_surete" }),
    ev("a3~0", { date: "2020-10-28", montant: 180_000, entreprises: ["222222222", "333333333"], compte: true, date_lue: "2020-11-28" }),
    ev("17-100", { t: "avis", date: "2017-07-19", affaire: "a1", acheteur_siren: "999999999", ref: "BOAMP 17-100" }),
    ev("18-200", { t: "resultat", date: "2018-07-01", affaire: "a1", acheteur_siren: "999999999", ref: "BOAMP 18-200" }),
    ev("16-300", { t: "avis", date: "2016-02-18", affaire: "avis-16-300", acheteur_siren: "999999999", ref: "BOAMP 16-300" }),
    ev("16-301", { t: "rectificatif", date: "2016-02-25", affaire: "avis-16-300", acheteur_siren: "999999999" }),
    ev("b1~0", { date: "2024-02-13", montant: 113_090, entreprises: ["444444444"], compte: true }),
  ];
  const affaires = Object.fromEntries(
    [...new Set(evenements.map((e) => e.affaire))].map((a) => [
      a,
      { events: evenements.filter((e) => e.affaire === a).map((e) => e.id), kind: a.startsWith("avis") ? "contrat_non_retrouve" : "contrat" },
    ]),
  );
  return {
    v: 1,
    acheteur: { siren: "999999999", nom: "Syndicat des transports", nom_court: "Réseau (transports)", categorie: "transports", lie: "888888888", ...over },
    evenements,
    affaires,
    entreprises: {
      "111111111": { nom: "ROIRET TRANSPORT" },
      "222222222": { nom: "SERFIM T.I.C." },
      "333333333": { nom: "SERPOLLET" },
      "444444444": { nom: "ENFRASYS" },
    },
    acheteurs: { "888888888": { nom: "Réseau Mobilités", categorie: "transports" } },
    communes: {},
    libelles: { a1: { court: "systèmes centraux, métro et réseau" } },
    stats: { siren: "999999999", n: 3, montant: 5_180_000, ents: ["111111111", "222222222", "333333333"], contrats: ["a1~0", "a2~0", "a3~0"] },
    stats_lie: { siren: "888888888", n: 1, montant: 113_090, ents: ["444444444"], contrats: ["b1~0"] },
  };
}

test("a commune buyer's path goes to its commune's page, decided by the build", () => {
  assert.equal(redirection(fichier({ categorie: "commune", page_commune: "69283" })), "/registre/commune/69283");
  // a commune whose page does not exist stays a buyer's page
  assert.equal(redirection(fichier({ categorie: "commune", page_commune: null })), null);
  assert.equal(redirection(fichier()), null);
});

/** SYNTHETIC: the Rhône's file as the build writes its intercommunalities (code = SIREN). */
const rhone = {
  departement: { code: "69", nom: "Rhône" },
  stats: {
    epcis: { "200046977": { nom: "Métropole de Lyon", communes: ["69123"], uniq: { docs: 1, con: 1, cam: 0, dr: 0, arr: 0 }, acheteur: true } },
  },
} as unknown as Pick<FichierDepartement, "departement" | "stats">;

test("an intercommunality's path goes to its territory's page when the build holds its row", () => {
  const metro = fichier({ siren: "200046977", categorie: "metropole", dep: "69" });
  assert.equal(departementAVerifier(metro), "69");
  assert.equal(redirection(metro, rhone), "/registre/departement/69?ic=200046977");
  // the département's file not read: its buyer's page
  assert.equal(redirection(metro), null);
  // a syndicate filed as an intercommunality, no territory row: its buyer's page
  const syndicat = fichier({ siren: "257800300", categorie: "intercommunalite", dep: "69" });
  assert.equal(redirection(syndicat, rhone), null);
  // the row of another département does not count
  assert.equal(redirection(fichier({ siren: "200046977", categorie: "metropole", dep: "01" }), rhone), null);
});

test("a département's path goes to its département's page; any other buyer stays", () => {
  const cd = fichier({ siren: "226900017", categorie: "departement", dep: "69" });
  assert.equal(departementAVerifier(cd), "69");
  assert.equal(redirection(cd, rhone), "/registre/departement/69");
  assert.equal(departementAVerifier(fichier({ dep: "69" })), null);
  assert.equal(redirection(fichier({ dep: "69" }), rhone), null);
});

test("its contracts by year, every year to today's, and where they are", () => {
  const f = fichier();
  f.evenements[0].insee = "69123";
  f.evenements[3].insee = "69123";
  const C = contrats(f, f.stats);
  const Y = parAnnee(C, 2022);
  assert.deepEqual(
    Y.map((y) => [y.y, y.cs.length, y.montant, y.max]),
    [
      ["2018", 1, 5_000_000, 5_000_000],
      // the mixed contract is signed, not counted
      ["2019", 1, 0, 0],
      ["2020", 1, 180_000, 180_000],
      ["2021", 0, 0, 0],
      ["2022", 0, 0, 0],
    ],
  );
  assert.deepEqual(parAnnee([], 2026), []);
  assert.deepEqual(lieux(C), [{ insee: "69123", n: 2 }]);
});

test("its contracts in signing order, with their notice, result and change", () => {
  const C = contrats(fichier(), fichier().stats);
  assert.deepEqual(
    C.map((c) => c.affaire),
    ["a1", "a2", "a3"],
  );
  const [a1, a2, a3] = C;
  assert.equal(a1.label, "Systèmes centraux, métro et réseau");
  assert.equal(a1.avis?.id, "17-100");
  assert.equal(a1.res?.id, "18-200");
  assert.deepEqual([a1.m1, a1.d0, a1.d1, a1.mods], [4_800_000, 84, 96, ["2022-01-10"]]);
  assert.equal(a2.mixte, true);
  // the reviewed date places it, and is marked
  assert.deepEqual([a3.d, a3.flag], ["2020-11-28", true]);
  assert.equal(a3.label, "Objet non publié");
  assert.equal(months("36"), 36);
  assert.equal(months(null), null);
});

test("the total adds the counted contracts only (compte)", () => {
  const T = total(contrats(fichier(), fichier().stats));
  assert.equal(T.montant, 5_180_000);
  assert.equal(T.comptes, 2);
  assert.deepEqual(
    T.hors.map((c) => c.affaire),
    ["a2"],
  );
});

test("who sells here: counted amounts, out-of-total and shared contracts", () => {
  const V = vendeurs(contrats(fichier(), fichier().stats));
  assert.deepEqual(
    V.map((v) => [v.s, v.n, v.montant, v.hors.length, v.avec]),
    [
      ["111111111", 2, 5_000_000, 1, []],
      ["222222222", 1, 180_000, 0, ["333333333"]],
      ["333333333", 1, 180_000, 0, ["222222222"]],
    ],
  );
});

test("the lead states the facts: how many, for what, when, who won most", () => {
  const f = fichier({ lead: { sujet: "L'autorité des transports", pour: "pour filmer son réseau" } });
  const C = contrats(f, f.stats);
  assert.equal(
    richText(lead(f, C, "Réseau")),
    `L'autorité des transports a signé 3 contrats pour filmer son réseau entre 2018 et 2020. Roiret Transport en a obtenu 2.`,
  );
  // one contract: « Avec », never « Tous avec »
  assert.equal(richText(lead(f, C.slice(0, 1), "Réseau")), "L'autorité des transports a signé 1 contrat pour filmer son réseau en 2018. Avec Roiret Transport.");
  // a name ending with a full stop takes no second one
  const g = fichier({ lead: null });
  g.entreprises["111111111"] = { nom: "SERFIM T.I.C." };
  assert.equal(richText(lead(g, C.slice(0, 1), "Réseau")), "Réseau a signé 1 contrat de vidéosurveillance en 2018. Avec Serfim T.I.C.");
  assert.equal(richText(lead(f, [], "Réseau")), "Réseau n'a signé aucun contrat de vidéosurveillance publié.");
  // the count is in bold, a value, never markup
  const bold = lead(f, C, "Réseau").find((x): x is { strong: RichItem[] } => typeof x === "object" && "strong" in x);
  assert.ok(bold);
  // the company named is a link to its fiche, in its type's colour
  const who = lead(f, C, "Réseau").find((x): x is { strong: RichItem[] } => typeof x === "object" && "strong" in x && Array.isArray(x.strong));
  const a = who?.strong.find((x): x is { a: { href: string; c?: string } } => typeof x === "object" && "a" in x);
  assert.equal(a?.a.href, "/registre/entreprise/111111111");
  assert.equal(a?.a.c, "var(--type-entreprise)");
});

test("a tie names no one", () => {
  const f = fichier();
  const C = contrats(f, f.stats).slice(1); // a2 (Roiret), a3 (Serfim + Serpollet): 1 each
  assert.equal(premiers(C), null);
});

test("the calls for tenders: its contracts' notices, then those without a contract", () => {
  const f = fichier();
  const A = appels(f, contrats(f, f.stats));
  assert.deepEqual(
    A.map((a) => [a.d, a.refs, a.contrat]),
    [
      ["2016-02-18", "avis 16-300 · rectificatif", ""],
      ["2017-07-19", "avis 17-100 · résultat 18-200", "a1"],
    ],
  );
  assert.equal(publications([]), "");
});

test("still running: only the contracts whose duration is published", () => {
  const f = fichier();
  const C = contrats(f, f.stats);
  // a1: 2018-06-20 + 96 months (its change) = 2026-06-20
  assert.deepEqual(enCours(C, "2026-06-01"), { n: 1, connus: 1 });
  assert.deepEqual(enCours(C, "2027-01-01"), { n: 0, connus: 1 });
});

test("the sort", () => {
  assert.deepEqual(trier([3, 1, 2], (x) => x, -1), [3, 2, 1]);
  assert.deepEqual(trier(["éa", "eb", "ec"], (x) => x, 1), ["éa", "eb", "ec"]);
});

test("its names and category", () => {
  assert.equal(titreCourt("Sytral (transports lyonnais)"), "Sytral");
  assert.equal(titreCourt("Sytral Mobilités"), "Sytral Mobilités");
  assert.equal(sirenSpaced("256900994"), "256 900 994");
  assert.equal(categorie(fichier()), "transports");
  assert.equal(categorie(fichier({ centrale: true })), "centrale d'achat");
  assert.equal(categorie(fichier({ categorie: "inconnue" })), "acheteur");
  assert.equal(`5${N}000`, `5${N}000`);
});
