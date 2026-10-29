// A document's record (/registre/contrat/<affaire>, vues/contrat-outils.ts): one model for a contract,
// a call for tenders without a contract, a subsidy and a decree without a commune. Every file below
// is SYNTHETIC, shaped as the build writes document/<affaire>.json (fermetures.py document_file):
// the extract has no published duration, no probable link and no named subsidy beneficiary.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Evenement } from "../src/registre/donnees.ts";
import { setMessages } from "../src/registre/i18n.ts";
import { type Fichier, fiche, ouvreAilleurs, rt } from "../src/registre/vues/contrat-outils.ts";

const catalogue: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
);
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const N = " ";

const COMMUNE = { "69999": { nom: "Synthèse-la-Ville", dep: "69", pop: 1000 } };
const ev = (e: Partial<Evenement> & { id: string; t: string; affaire: string }): Evenement =>
  ({ insee: "69999", dep: "69", entreprises: [], copie: false, compte: false, communal: true, ...e }) as Evenement;
const vide = { fin_prevue: null, precedent: null, suivant: null, entreprises: {}, contrat: null };

function fichier(
  affaire: Record<string, unknown>,
  evenements: Evenement[],
  more: Partial<Fichier> = {},
): Fichier {
  const a = { insee: "69999", dep: "69", entreprises: [], ...affaire } as Fichier["affaire"];
  return {
    v: 1,
    affaire: a,
    evenements,
    affaires: { [a.id]: a, ...(more.affaires ?? {}) },
    entreprises: { "111111111": { nom: "SOCIETE EXEMPLE", entrepreneur_individuel: false } },
    acheteurs: {
      "222222222": { nom: "Commune de Synthèse-la-Ville", categorie: "commune", dep: "69", insee_siege: "69999" },
    },
    communes: COMMUNE,
    libelles: {},
    parcours: { ...vide, ...(more.parcours ?? {}) },
    ...Object.fromEntries(Object.entries(more).filter(([k]) => k !== "affaires" && k !== "parcours")),
  } as unknown as Fichier;
}

const contrat = () =>
  fichier(
    { id: "C1", kind: "contrat", acheteur_siren: "222222222", events: ["A1", "C1~0", "C1~1"], techniques: "Accord-cadre" },
    [
      ev({ id: "A1", t: "avis", date: "2024-06-27", affaire: "C1", acheteur_siren: "222222222" }),
      ev({
        id: "C1~0",
        t: "attribution",
        date: "2025-01-30",
        affaire: "C1",
        entreprises: ["111111111"],
        montant: 215000,
        duree: "36",
        offres: 2,
        dispositif: "videoprotection",
        compte: true,
      }),
      ev({ id: "C1~1", t: "modification", date: "2025-12-30", affaire: "C1", entreprises: ["111111111"], montant: 215000 }),
    ],
    {
      parcours: {
        ...vide,
        fin_prevue: { date: "2028-01-30", signature: "2025-01-30", mois: 36 },
        precedent: { affaire: "C0", date: "2021-02-05", date_a_verifier: true, entreprises: ["111111111"], montant: 200000 },
        suivant: { affaire: "avis-X", date: "2026-07-21" },
        entreprises: { "111111111": { contrats: 64, collectivites: 44 } },
      },
    },
  );

/** What a reader sees of a value (a Rich's link by its text), no-break spaces as spaces. */
const text = (x: unknown): string =>
  (typeof x === "string"
    ? x
    : Array.isArray(x)
      ? x.map(text).join("")
      : x && typeof x === "object"
        ? "a" in x
          ? text((x as { a: { text: string } }).a.text)
          : "span" in x
            ? text((x as { span: unknown }).span)
            : Object.values(x).map(text).join(" ")
        : String(x ?? "")
  ).replace(/\u00a0/g, " ");

test("a contract: call for tenders → contract → modification → planned end, said computed", () => {
  const F = fiche(contrat());
  assert.ok(F);
  assert.equal(F.kind, "con");
  assert.deepEqual(
    F.steps.map((s) => s.k),
    ["ao", "con", "mod", "fin"],
  );
  const fin = F.steps[3];
  assert.ok(fin.ghost);
  assert.equal(text(fin.date), "janv. 2028 (calculée)");
  assert.equal(fin.what, "Signature + 36 mois");
  assert.match(F.kpis[1].l, /calculée/);
  assert.equal(text(F.titreDoc), "Contrat de janvier 2025");
  assert.equal(text(F.sous.a), "Signé le 30 janv. 2025");
  // the lead: the amount alone, the duration as the mockup says it, a digit kept as text (rt)
  assert.equal(
    text(F.lead),
    `La mairie de Synthèse-la-Ville a signé avec Societe Exemple un contrat de 215 000 € pour 3 ans.`,
  );
  assert.ok(F.argent, "the money line under the amounts");
  assert.ok(!F.arretes);
  // the previous contract (its date to check: the discreet mark) and the next call for tenders
  assert.equal(text(F.prec?.l), `← Contrat précédent : 2021, Societe Exemple, 200 000 €`);
  assert.equal(F.prec?.m, "date à vérifier");
  assert.equal(F.prec?.href, "/registre/contrat/C0");
  assert.equal(F.suiv?.l, "Appel d'offres suivant : juillet 2026 →");
  assert.equal(F.suiv?.href, "/registre/contrat/avis-X");
  assert.ok(F.reperes.some((r) => r.startsWith("« ? » Date à vérifier")));
  const company = F.dl.find((x) => x.k === "Entreprise");
  assert.equal(company?.note, "· 64 contrats avec 44 collectivités");
  assert.equal(text(F.dl.find((x) => x.k === "Montant")?.v), `215 000 €, inchangé par la modification`);
});

test("no « au maximum », no review wording, « signé avec »: the rules win over the mockup", () => {
  const F = fiche(contrat());
  const all = text(F);
  assert.doesNotMatch(all, /au maximum/i);
  assert.doesNotMatch(all, /relu|lu par programme/i);
  assert.doesNotMatch(all, /versés? à/);
});

test("a call for tenders linked by a probable link: its mark, explained once in the panel", () => {
  const f = contrat();
  f.affaire.events = ["C1~0", "C1~1"];
  (f.affaire as Record<string, unknown>).avis_probables = ["avis-P"];
  f.affaires["avis-P"] = { id: "avis-P", kind: "contrat_non_retrouve", events: ["P1"] } as Fichier["affaires"][string];
  f.evenements = [
    ev({ id: "P1", t: "avis", date: "2024-05-02", affaire: "avis-P", acheteur_siren: "222222222" }),
    ...f.evenements.filter((e) => e.id !== "A1"),
  ];
  const F = fiche(f);
  assert.ok(F);
  assert.equal(F.steps[0].k, "ao");
  assert.equal(F.steps[0].lm, "lien probable");
  assert.equal(F.steps[0].href?.href, "/registre/contrat/avis-P");
  assert.equal(F.reperes.filter((r) => r.startsWith("« ? » Lien probable")).length, 1);
});

test("a call for tenders without a contract: awaited, not found, or a probable contract", () => {
  const ao = (contrat: "attendu" | "non_retrouve" | null, probable?: string) =>
    fichier(
      { id: "avis-X", kind: "contrat_non_retrouve", events: ["X1"], ...(probable ? { contrat_probable: probable } : {}) },
      [
        ev({ id: "X1", t: "avis", date: "2026-07-21", affaire: "avis-X", acheteur_siren: "222222222" }),
        ev({ id: "C1~0", t: "attribution", date: "2026-12-01", affaire: "C1", entreprises: ["111111111"], montant: 50000 }),
      ],
      {
        parcours: { ...vide, contrat },
        affaires: { C1: { id: "C1", kind: "contrat", events: ["C1~0"] } as Fichier["affaires"][string] },
      },
    );
  const attendu = fiche(ao("attendu"));
  assert.equal(attendu?.kind, "ao");
  assert.equal(text(attendu?.steps[1].date), "pas encore publié");
  assert.equal(attendu?.steps[1].what, "Aucun contrat n'est encore publié");
  assert.match(text(attendu?.lead), /^La mairie de Synthèse-la-Ville a publié un appel d'offres le 21 juillet 2026\. Aucun contrat n'est encore publié\.$/);
  assert.equal(text(fiche(ao("non_retrouve"))?.steps[1].date), "non retrouvé");
  const prob = fiche(ao("probable" as "attendu", "C1"));
  assert.equal(prob?.steps[1].k, "con");
  assert.equal(prob?.steps[1].lm, "lien probable");
  assert.equal(prob?.suiv?.href, "/registre/contrat/C1");
  assert.equal(prob?.suiv?.m, "lien probable");
  assert.equal(prob?.titreDoc, "Appel d'offres de juillet 2026");
});

test("a subsidy: a name not published stays « nom non publié », the commune is linked", () => {
  const sub = (beneficiaire: string, nom_publie: boolean) =>
    fiche(
      fichier({ id: "detr-1", kind: "subvention", events: ["detr-1"] }, [
        ev({
          id: "detr-1",
          t: "subvention_etat",
          date: "2025-12-31",
          date_annee: true,
          affaire: "detr-1",
          montant: 79100,
          cameras: 4,
          beneficiaire,
          nom_publie,
        }),
      ]),
    );
  const masked = sub("[non retenu]", false);
  assert.equal(masked?.kind, "sub");
  assert.equal(text(masked?.lead), `L'État a accordé 79 100 € pour un projet à Synthèse-la-Ville pour 4 caméras.`);
  assert.equal(masked?.dl[0].v, "nom non publié");
  assert.equal(text(masked?.titreDoc), "Subvention de 2025");
  assert.ok(!masked?.argent, "the money line is the contracts'");
  const named = sub("COMMUNE DE SYNTHESE", true);
  assert.match(text(named?.lead), /^L'État a accordé 79.100 € à Commune de Synthese pour 4 caméras\.$/);
});

test("a decree: opened in its commune's Autorisations when it has one, here when it has none", () => {
  const decree = (insee: string | null) =>
    fichier({ id: "75-2025-06-19-00003", kind: "acte", insee, dep: "75", events: ["75-2025-06-19-00003"] }, [
      ev({
        id: "75-2025-06-19-00003",
        t: "arrete_drone",
        date: "2025-06-19",
        affaire: "75-2025-06-19-00003",
        dep: "75",
        insee,
        cameras: 2,
        beneficiaire: "Direction de l'ordre public",
        url: "https://example.org/recueil.pdf",
        non_lu: ["commune_introuvable", "zone_non_deduite"],
      }),
    ]);
  assert.equal(
    ouvreAilleurs(decree("69999")),
    "/registre/commune/69999/autorisations/75-2025-06-19-00003",
  );
  const f = decree(null);
  assert.equal(ouvreAilleurs(f), null);
  const F = fiche(f);
  assert.equal(F?.kind, "aut");
  assert.ok(F?.arretes, "the one line on decrees read by a program");
  assert.equal(F?.source, "https://example.org/recueil.pdf");
  assert.match(text(F?.lead), /zone non déduite de l'arrêté/);
  assert.equal(F?.titre, "Autorisation de drones");
  assert.equal(text(F?.titreDoc), "Arrêté du 19 juin 2025");
});

test("an affaire without a document: no record (the view throws Absent)", () => {
  assert.equal(fiche(fichier({ id: "Z", kind: "contrat", events: [] }, [])), null);
});

test("a rich placeholder keeps the digits of the text around it", () => {
  assert.deepEqual(rt("contrat.lead_sub", { financeur: "L'État", montant: { strong: "3 €" }, beneficiaire: "X 12", cameras: "" }), [
    "L'État a accordé ",
    { strong: "3 €" },
    " à X 12.",
  ]);
});
