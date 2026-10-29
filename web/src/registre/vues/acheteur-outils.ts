// A buyer's page, its pure part (the prototype's vues/acheteur.js and the helpers it calls in
// donnees11.js): its file (lacarte-registre construire's acheteur/<siren>.json), its contracts in
// signing order with their notice, result and changes, who sells to it, its calls for tenders, the
// frieze's positions. The rules are the build's: a total adds the `montant` of the contracts flagged
// `compte` only, a commune buyer's page is its commune's (`page_commune`), a central purchasing body
// is flagged (`centrale`), the linked buyer and its contracts come with the file.

import { communeHref } from "../commun.ts";
import type { RichItem } from "../dc.ts";
import type { Acheteur, Affaire, Commune, Entreprise, Evenement } from "../donnees.ts";
import { addMonths, fr } from "../format.ts";
import { has, t } from "../i18n.ts";
import { capital, sentence, tidy, titleCase } from "../texte.ts";

export type StatsAcheteur = {
  siren: string;
  n: number;
  montant: number;
  ents: string[];
  contrats: string[];
};
export type FichierAcheteur = {
  v: number;
  acheteur: Acheteur & {
    siren: string;
    nom?: string;
    dep?: string | null;
    dep_nom?: string | null;
    page_commune?: string | null;
    centrale?: boolean;
    lie?: string | null;
    lead?: { sujet: string; pour: string } | null;
  };
  evenements: Evenement[];
  affaires: Record<string, Affaire>;
  entreprises: Record<string, Entreprise>;
  acheteurs: Record<string, Acheteur>;
  communes: Record<string, Commune>;
  libelles: Record<string, { court?: string; titre?: string }>;
  stats: StatsAcheteur | null;
  stats_lie: StatsAcheteur | null;
};

/** Where a commune buyer's path goes: its commune's page (the build decides it exists). */
export function redirection(f: FichierAcheteur): string | null {
  return f.acheteur.page_commune ? communeHref(f.acheteur.page_commune) : null;
}

/** « 256 900 994 ». */
export const sirenSpaced = (s: string): string => s.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");

/** A buyer's name: the short one, an intercommunality's usual one, else the published one. */
export function buyerNom(f: FichierAcheteur, siren: string): string {
  const a = f.acheteurs[siren] ?? (siren === f.acheteur.siren ? f.acheteur : undefined);
  return a?.nom_court || a?.nom || t("commun.acheteur_siren", { siren });
}
/** The title of a buyer's page: its short name without the words that only place it
 * (« Sytral (transports lyonnais) » → « Sytral »), as the mockup's title. */
export const titreCourt = (nom: string): string => nom.replace(/\s+\([^()]*\)$/, "") || nom;

/** A buyer's page: its commune's, for a commune. */
export function buyerHref(f: FichierAcheteur, siren: string): string {
  const a = f.acheteurs[siren];
  return a?.categorie === "commune" && a.insee_siege && f.communes[a.insee_siege]
    ? communeHref(a.insee_siege)
    : `/registre/acheteur/${siren}`;
}

/** Its category's word (« transports », « centrale d'achat »). */
export function categorie(f: FichierAcheteur): string {
  const c = f.acheteur.centrale ? "centrale" : (f.acheteur.categorie ?? "");
  return c && has(`registre.chiffres.cat_${c}`)
    ? t(`chiffres.cat_${c}`)
    : t("chiffres.cat_acheteur");
}

/** A company's name as SIRENE gives it; a sole trader is never named. */
export function entName(f: FichierAcheteur, siren: string): string {
  const x = f.entreprises[siren];
  if (x?.entrepreneur_individuel) return t("commun.nom_non_publie");
  if (!x?.nom) return t("commun.entreprise_siren", { siren });
  return tidy(titleCase(x.nom));
}
export const entHref = (siren: string): string => `/registre/entreprise/${siren}`;
export const contratHref = (affaire: string): string =>
  `/registre/contrat/${encodeURIComponent(affaire)}`;

/** A month count as published (a number, or a number in a string); none: null. */
export function months(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type Contrat = {
  e: Evenement;
  affaire: string;
  /** the date the timelines place it at: the reviewed one when the build has one */
  d: string;
  /** its date is to be checked (the build's date_lue) */
  flag: boolean;
  label: string;
  objet: string;
  ents: string[];
  m0: number | null;
  /** the amount after its last change, when it differs */
  m1: number | null;
  d0: number | null;
  d1: number | null;
  off: number | null;
  avis: Evenement | null;
  /** the notice is tied to it by a probable link (avis_probables), not by its affaire */
  avisProbable: boolean;
  res: Evenement | null;
  mods: string[];
  mixte: boolean;
  compte: boolean;
  ref: string;
};

/** A document's title: its affaire's short label, else its published object in sentence case. */
export function label(f: FichierAcheteur, affaire: string, e?: Evenement | null): string {
  const c = f.libelles[affaire]?.court;
  if (c) return capital(c);
  return sentence(e?.objet || f.affaires[affaire]?.titre || "") || t("acheteur.objet_non_publie");
}

const events = (f: FichierAcheteur, ids: string[] | undefined): Evenement[] => {
  const by = new Map(f.evenements.map((e) => [e.id, e]));
  return (ids ?? []).map((i) => by.get(i)).filter((e): e is Evenement => !!e);
};

/** The signed contracts of a buyer (its own, or the linked one's), in signing order: the build's
 * list (copies left out), each with its notice, its result and its changes. */
export function contrats(f: FichierAcheteur, stats: StatsAcheteur | null): Contrat[] {
  return events(f, stats?.contrats)
    .map((e): Contrat => {
      const a = f.affaires[e.affaire];
      const evs = events(f, a?.events);
      const mods = evs.filter((x) => x.t === "modification");
      const last = mods[mods.length - 1];
      let avis = evs.find((x) => x.t === "avis") ?? null;
      let avisProbable = false;
      if (!avis) {
        const ps = Array.isArray(a?.avis_probables) ? (a.avis_probables as string[]) : [];
        for (const p of ps) {
          const first = events(f, f.affaires[p]?.events)[0];
          if (first) {
            avis = first;
            avisProbable = true;
            break;
          }
        }
      }
      const res =
        evs.find((x) => x.t === "resultat") ??
        (avis
          ? events(f, f.affaires[avis.affaire]?.events).find((x) => x.t === "resultat")
          : null) ??
        null;
      const d0 = months(e.duree);
      const d1 = last ? months(last.duree) : null;
      const off = typeof e.offres === "number" ? e.offres : null;
      return {
        e,
        affaire: e.affaire,
        d: e.date_lue ?? e.date ?? "",
        flag: !!e.date_lue,
        label: label(f, e.affaire, e),
        objet: sentence(e.objet || a?.titre || "") || label(f, e.affaire, e),
        ents: e.entreprises ?? [],
        m0: e.montant ?? null,
        m1: last?.montant != null && last.montant !== e.montant ? last.montant : null,
        d0,
        d1: d1 && d1 !== d0 ? d1 : null,
        off,
        avis,
        avisProbable,
        res,
        mods: mods.map((x) => x.date ?? "").filter(Boolean),
        mixte: /^mixte/.test(e.hors_totaux ?? ""),
        compte: !!e.compte,
        ref: e.ref ?? "",
      };
    })
    .sort((x, y) => x.d.localeCompare(y.d));
}

/** The total of the contracts the build counts (`compte`), and those it leaves out. */
export function total(C: Contrat[]): { montant: number; comptes: number; hors: Contrat[] } {
  const counted = C.filter((c) => c.compte);
  return {
    montant: counted.reduce((s, c) => s + (c.m0 ?? 0), 0),
    comptes: counted.length,
    hors: C.filter((c) => !c.compte),
  };
}

/** The planned end: signature plus the duration (the changed one when given). */
export const fin = (c: Contrat, changed = true): string | null => {
  const m = (changed && c.d1) || c.d0;
  return m && c.d ? addMonths(c.d, m) : null;
};

/** Still running today: its planned end not passed; a contract without a duration is unknown. */
export function enCours(C: Contrat[], today: string): { n: number; connus: number } {
  const known = C.filter((c) => fin(c));
  return { n: known.filter((c) => (fin(c) ?? "") >= today).length, connus: known.length };
}

export type Vendeur = {
  s: string;
  n: number;
  /** the counted contracts' amounts at signing */
  montant: number;
  cs: Contrat[];
  /** its contracts signed with other companies, and those companies */
  partages: Contrat[];
  avec: string[];
  hors: Contrat[];
};

/** Who sells here: each company, its contracts with this buyer, the counted amounts, the
 * companies it shares a contract with; the largest amount first. */
export function vendeurs(C: Contrat[]): Vendeur[] {
  const sirens = [...new Set(C.flatMap((c) => c.ents))];
  return sirens
    .map((s) => {
      const cs = C.filter((c) => c.ents.includes(s));
      const partages = cs.filter((c) => c.ents.length > 1);
      return {
        s,
        n: cs.length,
        montant: cs.filter((c) => c.compte).reduce((t0, c) => t0 + (c.m0 ?? 0), 0),
        cs,
        partages,
        avec: [...new Set(partages.flatMap((c) => c.ents.filter((x) => x !== s)))],
        hors: cs.filter((c) => !c.compte),
      };
    })
    .sort((a, b) => b.montant - a.montant || b.n - a.n);
}

/** The companies that won most of the contracts: the first alone when it won them all; the first
 * two when they won some, not all, and no third won as many as the second; else the first alone
 * when no other won as many; a tie for the first names no one. */
export function premiers(C: Contrat[]): { ents: string[]; n: number; tous: boolean } | null {
  const by = new Map<string, number>();
  for (const c of C) for (const s of c.ents) by.set(s, (by.get(s) ?? 0) + 1);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]);
  if (!top.length) return null;
  const one = { ents: [top[0][0]], n: top[0][1], tous: top[0][1] === C.length };
  if (top.length === 1 || one.tous) return one;
  if (top[1][1] > (top[2]?.[1] ?? 0)) {
    const two = [top[0][0], top[1][0]];
    const got = C.filter((c) => c.ents.some((s) => two.includes(s))).length;
    if (got < C.length) return { ents: two, n: got, tous: false };
  }
  return top[0][1] > top[1][1] ? one : null;
}

export type Appel = {
  d: string;
  objet: string;
  refs: string;
  /** the contract that followed, its affaire; "" when none was found */
  contrat: string;
  ents: string[];
  dContrat: string;
  probable: boolean;
  href: string;
};

const refOf = (e: Evenement): string => String(e.ref ?? "").replace(/^BOAMP\s+/, "");
/** « avis 17-102157 · résultat 18-85216 »: each publication's kind and number. */
export function publications(evs: Evenement[]): string {
  return evs
    .filter((e) => /^(avis|rectificatif|resultat)$/.test(e.t))
    .map((e) => {
      const ref = refOf(e);
      return ref ? t(`acheteur.pub_${e.t}`, { ref }) : t(`acheteur.pub_${e.t}_seul`);
    })
    .join(" · ");
}

/** Its calls for tenders: the notices of its contracts, then those no contract was found for,
 * by date. */
export function appels(f: FichierAcheteur, C: Contrat[]): Appel[] {
  const out: Appel[] = [];
  const done = new Set<string>();
  for (const c of C) {
    if (!c.avis) continue;
    done.add(c.avis.affaire);
    out.push({
      d: c.avis.date ?? "",
      objet: c.label,
      refs: publications(c.res ? [c.avis, c.res] : [c.avis]),
      contrat: c.affaire,
      ents: c.ents,
      dContrat: c.d,
      probable: c.avisProbable,
      href: contratHref(c.avis.affaire),
    });
  }
  const siren = f.acheteur.siren;
  for (const [id, a] of Object.entries(f.affaires)) {
    if (a.kind !== "contrat_non_retrouve" || done.has(id)) continue;
    const evs = events(f, a.events).sort((x, y) => (x.date ?? "").localeCompare(y.date ?? ""));
    if (!evs.some((e) => e.acheteur_siren === siren)) continue;
    const av = evs.find((x) => x.t === "avis") ?? evs[0];
    const pc = typeof a.contrat_probable === "string" ? a.contrat_probable : "";
    const pe = pc
      ? events(f, f.affaires[pc]?.events).find((x) => x.t === "attribution")
      : undefined;
    out.push({
      d: String(a.debut ?? av?.date ?? ""),
      objet: label(f, id, av),
      refs: publications(evs),
      contrat: pe ? pc : "",
      ents: pe?.entreprises ?? [],
      dContrat: pe ? (pe.date_lue ?? pe.date ?? "") : "",
      probable: !!pe,
      href: contratHref(id),
    });
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

/** The frieze's scale: from the first year of a signature or notice to today, in percent. */
export function echelle(dates: string[], today: string): { y0: number; P: (d: string) => number } {
  const y0 = Math.min(
    ...dates.filter(Boolean).map((d) => Number(d.slice(0, 4))),
    Number(today.slice(0, 4)),
  );
  const T0 = Date.parse(`${y0}-01-01`);
  const T1 = Date.parse(today);
  return {
    y0,
    P: (d) => Math.max(0, Math.min(100, ((Date.parse(d) - T0) / (T1 - T0)) * 100)),
  };
}

/** A catalogue message whose placeholders may be rich (bold, a link): the message is the
 * catalogue's, the rich parts are put back in place of their placeholder. */
type Param = string | number | Exclude<RichItem, string> | RichItem[];
export function rt(key: string, params: Record<string, Param> = {}): RichItem[] {
  const holes: RichItem[][] = [];
  const flat: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "object") {
      flat[k] = `\uE000${holes.length}\uE000`;
      holes.push(Array.isArray(v) ? v : [v]);
    } else flat[k] = v;
  }
  return t(key, flat)
    .split(/\uE000(\d+)\uE000/)
    .flatMap((x, i) => (i % 2 ? holes[Number(x)] : [x]))
    .filter((x) => x !== "");
}

/** The lead: how many, for what, when, and who won most of them. */
export function lead(f: FichierAcheteur, C: Contrat[], nom: string): RichItem[] {
  if (!C.length) return rt("acheteur.lead_aucun", { nom });
  const L = f.acheteur.lead;
  const y0 = C[0].d.slice(0, 4);
  const y1 = C[C.length - 1].d.slice(0, 4);
  const p = {
    sujet: L?.sujet ?? nom,
    contrats: { strong: t("n.contrat", { n: C.length }) },
    pour: L?.pour ?? t("acheteur.lead_pour"),
    y0,
    y1,
  };
  const out = rt(y0 === y1 ? "acheteur.lead_en" : "acheteur.lead_entre", p);
  const top = premiers(C);
  if (top) {
    const names = top.ents.map((s) => entName(f, s)).join(t("acheteur.et"));
    // a name that ends with its own full stop (« Serfim T.I.C. ») does not take a second one
    out.push(" ", {
      strong: (top.tous
        ? t(C.length > 1 ? "acheteur.lead_tous" : "acheteur.lead_avec", { ent: names })
        : t(top.ents.length > 1 ? "acheteur.lead_obtenu" : "acheteur.lead_obtenu_un", {
            ents: names,
            n: fr(top.n),
          })
      ).replace(/\.\.$/, "."),
    });
  }
  return out;
}

/** Sorted rows: text in French order, numbers by value; dir 1 ascending, -1 descending. */
export function trier<T>(rows: T[], key: (r: T) => string | number, dir: number): T[] {
  return rows
    .map((r, i) => [r, i] as const)
    .sort(([a, i], [b, j]) => {
      const va = key(a);
      const vb = key(b);
      const c =
        typeof va === "string" || typeof vb === "string"
          ? String(va).localeCompare(String(vb), "fr")
          : va - vb;
      return c * dir || i - j;
    })
    .map(([r]) => r);
}
