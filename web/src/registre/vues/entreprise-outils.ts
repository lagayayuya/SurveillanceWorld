// A company's file (/registre/entreprise/<siren>, the build's entreprise/<siren>.json) as the fiche
// reads it: its contracts (the build's list, a copy never) with their start and planned end, and its
// buyers. What a rule decides comes from the build: the contracts running on the build's date, the
// activity and regions; a total adds the `montant` of the contracts flagged `compte`, nothing else.
// A sole trader is never named (corpus.ts entName: « entreprise individuelle, nom non publié »).

import { buyerNom, type Lexique } from "../corpus.ts";
import type { Acheteur, Affaire, Evenement, PartageFichier } from "../donnees.ts";
import { has, t } from "../i18n.ts";

export type Fin = { debut: string; duree: number | null; fin: string | null };
/** The build's facts: the page reads how many contracts had one offer among those whose number of
 * offers is published (v2.1 B5: no figure that sets amounts or dates side by side to suggest). */
export type Faits = {
  offres: { une_offre: number; renseignes: number } | null;
};
export type Page = {
  maj: string;
  fins: Record<string, Fin>;
  en_cours: string[];
  sans_fin: number;
  modifications: number;
  faits: Faits;
  activite: "installe_entretient" | "installe" | "entretient" | "vend" | null;
  lieux: { surtout: boolean; regions: string[] };
};
export type FichierEntreprise = Lexique & {
  v: number;
  partage?: PartageFichier;
  entreprise: {
    siren?: string;
    nom?: string | null;
    entrepreneur_individuel?: boolean;
    naf?: string | null;
    naf_libelle?: string | null;
    // SIRENE's record of a legal person (A, 08/11 and 09/11; never a sole trader's): INSEE's
    // category (PME, ETI, GE), the year it was created, its headcount band in words and its year,
    // its head office's commune (INSEE code, an arrondissement given as its city) and département
    categorie?: "PME" | "ETI" | "GE" | null;
    creation?: number | null;
    effectif?: string | null;
    effectif_annee?: string | null;
    siege_commune?: string | null;
    siege_commune_nom?: string | null;
    siege_departement?: string | null;
  };
  evenements: Evenement[];
  affaires: Record<string, Affaire>;
  acheteurs: Record<string, Acheteur & { dep?: string }>;
  stats: {
    n: number;
    copies: number;
    clientes: string[];
    montant: number;
    y0: string | null;
    contrats: string[];
    deps?: Record<string, number>;
  } | null;
  page: Page;
  /** « Même métier, mêmes départements » (A, 08/11): the companies holding counted contracts of a
   * same nature (`autre` aside) in a département where it holds one; `n` the (nature, département)
   * couples they share. Ten at most, its partners in a joint contract and sole traders never. */
  pairs?: { siren: string; n: number }[];
  /** the build's groups of contracts (lots of one tender, the same contract published twice) */
  lots?: Record<string, { insee?: string; nature?: string; entreprises?: string[] }>;
};

/** A contract of the company: its document, its start and end (the build's), its buyer, the
 * amount a total adds (`compte`) and its own. */
export type Ct = {
  e: Evenement;
  i: number;
  d: string;
  fin: string | null;
  duree: number | null;
  b: string | null;
  amt: number;
  raw: number;
};
export type Cl = { s: string; n: number; amt: number; last: string; centrale: boolean };

/** A published duration longer than this (in months) is a typing error to check (« 1 540 mois »,
 * an end in 2150): its end is not drawn nor said, as if no duration were published. Twenty
 * years, well past the longest public contracts (a concession's). */
export const DUREE_MAX = 240;

/** A date as a calendar has it: the build's planned end adds months to the start and keeps its
 * day (« 2023-11-31 »); past the month's last day, that last day. */
export function jourValide(d: string): string {
  const [y, m, j] = d.split("-").map(Number);
  if (!y || !m || !j) return d;
  const der = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return j > der ? `${d.slice(0, 8)}${String(der).padStart(2, "0")}` : d;
}

/** The company's contracts (the build's list: a copy never), oldest first, and its buyers. */
export function prepare(F: FichierEntreprise): { CT: Ct[]; CL: Cl[] } {
  const ev = new Map(F.evenements.map((e) => [e.id, e]));
  const CT = (F.stats?.contrats ?? [])
    .map((id) => ev.get(id))
    .filter((e): e is Evenement => !!e)
    .map((e) => {
      const f = F.page.fins[e.id];
      return {
        e,
        i: 0,
        d: f?.debut ?? e.date_lue ?? e.date ?? "",
        fin: f?.fin && (f.duree ?? 0) <= DUREE_MAX ? jourValide(f.fin) : null,
        duree: f?.duree ?? null,
        b: e.acheteur_siren ?? F.affaires[e.affaire]?.acheteur_siren ?? null,
        amt: e.compte ? (e.montant ?? 0) : 0,
        raw: e.montant ?? 0,
      };
    })
    .sort((a, b) => a.d.localeCompare(b.d));
  CT.forEach((c, i) => {
    c.i = i;
  });
  const cl = new Map<string, Cl>();
  for (const c of CT) {
    if (!c.b) continue;
    let o = cl.get(c.b);
    if (!o) {
      o = { s: c.b, n: 0, amt: 0, last: "", centrale: false };
      cl.set(c.b, o);
    }
    o.n++;
    o.amt += c.amt;
    if (c.d > o.last) o.last = c.d;
    if (c.e.hors_totaux === "centrale") o.centrale = true;
  }
  return { CT, CL: [...cl.values()] };
}

/** A contract is named by its place (its commune), as the mockup's lists do; else by its buyer. */
export function placeOf(F: FichierEntreprise, c: Ct): string {
  const k = c.e.insee;
  if (k && F.communes[k]) return F.communes[k].nom;
  if (!c.b) return t("entreprise.acheteur_non_publie");
  const a = F.acheteurs[c.b];
  return a?.categorie === "commune" && a.insee_siege && F.communes[a.insee_siege]
    ? F.communes[a.insee_siege].nom
    : buyerNom(F, c.b);
}

/** The buyer's kind, in the words of the rankings (« commune », « centrale d'achat »). */
export function buyerCat(F: FichierEntreprise, c: Cl): string {
  if (c.centrale) return t("chiffres.cat_centrale");
  const k = F.acheteurs[c.s]?.categorie;
  return k && has(`registre.chiffres.cat_${k}`)
    ? t(`chiffres.cat_${k}`)
    : t("chiffres.cat_acheteur");
}
