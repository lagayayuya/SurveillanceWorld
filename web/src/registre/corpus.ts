// Every document of the register at once: the home (Documents) and « Chiffres et classements »
// read the build's index.json (counts, facets, the latest and largest documents) and, when the
// reader searches, recherche.json (every document and the dictionaries). The prototype's helpers
// for these two views (donnees11.js: typ, disp, titre, the companies' and buyers' figures): the
// rules (counted, a copy, a shared decree, an unread one) are the build's flags, read here.

import { communeHref, isArr, sortKey } from "./commun.ts";
import type { Acheteur, Commune, Entreprise, Evenement } from "./donnees.ts";
import { EI } from "./donnees.ts";
import { count, docDate } from "./format.ts";
import { has, t } from "./i18n.ts";
import { plain, sentence, tidy, titleCase } from "./texte.ts";

export type AffaireCourte = {
  acheteur_siren?: string;
  acheteur_communal?: boolean;
  titre?: string;
};
/** The dictionaries a list of documents names, their affaires included (index.json and recherche.json). */
export type Lexique = {
  entreprises: Record<string, Entreprise>;
  acheteurs: Record<string, Acheteur>;
  communes: Record<string, Commune & { carte?: number | null }>;
  affaires?: Record<string, AffaireCourte>;
};
export type Index = {
  v: number;
  maj: string;
  totaux: Record<"con" | "ao" | "aut" | "mod" | "sub" | "docs", number>;
  facettes: Record<"t" | "d" | "p" | "y", Record<string, number>>;
  recents: Evenement[];
  gros: Evenement[];
  non_lus: number;
  dico: Lexique;
};
export type Recherche = Lexique & { v: number; evenements: Evenement[] };

export type Kind = "con" | "ao" | "aut" | "mod" | "sub";
export const KINDS: Kind[] = ["con", "ao", "aut", "mod", "sub"];
/** The pilot's départements, in the facets' order; any other is « Autres » (xx). */
export const DEPS = ["69", "75", "77", "78", "91", "92", "93", "94", "95", "13"];
export const DISPS = ["vp", "csu", "vsa", "lapi", "pi", "vv", "dr", "na"];

/** The kit's five kinds of document (§ 4). */
export const typ = (e: Evenement): Kind | "?" =>
  e.t === "attribution"
    ? "con"
    : e.t === "modification"
      ? "mod"
      : /^(avis|resultat|rectificatif)$/.test(e.t)
        ? "ao"
        : e.t.startsWith("arrete")
          ? "aut"
          : e.t.startsWith("subvention")
            ? "sub"
            : "?";
const DISP: Record<string, string> = {
  videoprotection: "vp",
  csu: "csu",
  vsa: "vsa",
  lapi: "lapi",
  pietons: "pi",
  cameras_pietons: "pi",
  videoverbalisation: "vv",
  drone: "dr",
  drones: "dr",
};
export const disp = (e: Evenement): string => DISP[e.dispositif ?? ""] ?? "na";
export const yGroup = (d: string | null | undefined): string => {
  const y = Number((d ?? "").slice(0, 4));
  return !y ? "" : y < 2018 ? "<2018" : String(y);
};
export const depGroup = (d: string | null | undefined): string =>
  d && DEPS.includes(d) ? d : "xx";

/** A département's name: the pilot's from the catalogue, any other by its code. */
export const depNom = (d: string | null | undefined): string =>
  !d
    ? ""
    : has(`registre.departement.nom_${d}`)
      ? t(`departement.nom_${d}`)
      : t("registre.dep_code", { code: d });

/** The kit's badge of a document, and its style (§ 4). */
export const BADGE: Record<string, string> = {
  con: "background: var(--fg); color: var(--bg)",
  mod: "background: transparent; color: var(--fg)",
  ao: "background: var(--ao); color: var(--ao-ink); border-color: var(--ao)",
  aut: "background: var(--aut); color: var(--aut-ink); border-color: var(--aut)",
  sub: "background: var(--sub); color: var(--sub-ink); border-color: var(--sub)",
};
export const badge = (e: Evenement): string => t(`registre.badge_${typ(e)}`);

/** A document's title: a decree by what it authorises, anything else by its published object. */
export function titre(e: Evenement): string {
  if (e.t === "arrete_drone") {
    const base = t("registre.titre_drone");
    return e.partage?.length
      ? t("registre.titre_partage", { titre: base, n: e.partage.length })
      : base;
  }
  if (e.t === "arrete_pietons") return t("registre.titre_pietons");
  if (e.t === "arrete_vsa") return t("registre.titre_vsa");
  if (e.t === "arrete")
    return e.cameras != null
      ? t("registre.titre_cameras", { cams: count(e.cameras, "camera") })
      : t("registre.titre_cameras_seul");
  return sentence(e.objet) || t("registre.titre_objet_non_publie");
}

export const date = (e: Evenement): string => docDate(e.date, e.date_annee);

/** A company's page, or null for a sole trader (it has none). */
export const entHref = (siren: string): string | null =>
  siren === EI ? null : `/registre/entreprise/${siren}`;

/** A company's name as SIRENE gives it; a sole trader is never named. */
export function entName(L: Lexique, siren: string): string {
  const x = L.entreprises[siren];
  if (siren === EI || x?.entrepreneur_individuel) return t("commun.entreprise_individuelle");
  if (!x?.nom) return t("commun.entreprise_siren", { siren });
  return tidy(titleCase(x.nom));
}
export const buyerOf = (L: Lexique, e: Evenement): string | null =>
  e.acheteur_siren ?? L.affaires?.[e.affaire]?.acheteur_siren ?? null;
export function buyerNom(L: Lexique, siren: string): string {
  const a = L.acheteurs[siren];
  return a?.nom_court || a?.nom || t("commun.acheteur_siren", { siren });
}
/** A buyer's page: its commune's, for a commune whose fiche exists; else its own when the build
 * wrote it (its reference, lot R3); else none. */
export function buyerHref(L: Lexique, siren: string): string | null {
  const a = L.acheteurs[siren];
  if (a?.categorie === "commune" && a.insee_siege && L.communes[a.insee_siege]?.ref)
    return communeHref(a.insee_siege);
  return a?.ref ? `/registre/${a.ref}` : null;
}

/** Where a document opens: a decree, its commune's Autorisations at the decree itself (its own
 * address: its section, its row chosen, its panel; v2.1 A7); else its record. */
export function docHref(L: Lexique, e: Evenement): string {
  return isArr(e) && e.insee && L.communes[e.insee]?.ref
    ? `${communeHref(e.insee, "autorisations")}/${encodeURIComponent(e.id)}`
    : `/registre/contrat/${encodeURIComponent(e.affaire)}`;
}

/** A row of the list: its keys for the filters, its words for the search, what it shows. */
export type Ligne = {
  e: Evenement;
  id: string;
  date: string;
  k: Kind | "?";
  key: [string, string, string, string];
  title: string;
  com: string;
  qui: string;
  ents: string;
  amt: number;
  /** The amount the second sort ranks, as the build ranks its largest documents: a contract's when
   * it counts (`compte`), a subsidy's; none for the others (a ceiling for other buyers, a copy, a
   * modification). */
  rank: number;
  words: string;
  href: string;
};
/** The facets' families, in the order of `Ligne.key`. */
export const FK = ["t", "d", "y", "p"] as const;

export function ligne(L: Lexique, e: Evenement): Ligne {
  const k = typ(e);
  const com = e.insee && L.communes[e.insee] ? L.communes[e.insee].nom : "";
  const arr = isArr(e);
  const sub = e.t.startsWith("subvention");
  const s = !arr && !sub ? buyerOf(L, e) : null;
  // a contract's buyer is not repeated when it is the commune itself; a notice keeps its buyer as published
  const own =
    s && L.acheteurs[s]?.categorie === "commune" && L.acheteurs[s]?.insee_siege === e.insee;
  let qui = "";
  if (arr) qui = benef(e);
  else if (sub) qui = tidy(titleCase(String(e.beneficiaire ?? "")));
  else if (/^(avis|resultat|rectificatif)$/.test(e.t)) qui = tidy(e.acheteur ?? "");
  else if (s && !own) qui = buyerNom(L, s);
  const ents = (e.entreprises ?? []).map((x) => entName(L, x)).join(", ");
  const title = titre(e);
  return {
    e,
    id: e.id,
    date: sortKey(e),
    k,
    key: [k, depGroup(e.dep), yGroup(e.date), disp(e)],
    title,
    com,
    qui,
    ents,
    amt: e.montant ?? 0,
    rank: e.compte || e.t.startsWith("subvention") ? (e.montant ?? 0) : 0,
    // a decree shared by several communes is found by each one's name
    words: plain(
      [
        title,
        e.objet,
        com,
        qui,
        ents,
        e.ref,
        ...(e.partage ?? []).map((k) => L.communes[k]?.nom),
      ].join(" "),
    ),
    href: docHref(L, e),
  };
}

/** A decree's beneficiary: « nom non publié » for a private person or a name not verified. */
export function benef(e: Evenement): string {
  if (e.beneficiaire === "[non retenu]" || e.nom_publie === false)
    return t("commun.nom_non_publie");
  if (e.beneficiaire === "[non précisé]") return t("commun.non_precise");
  return tidy(titleCase(String(e.beneficiaire ?? "")));
}

// --- the figures of every document (Chiffres et classements, « Aller directement à ») -------------

export type EntStat = {
  siren: string;
  n: number;
  clientes: Set<string>;
  montant: number;
  deps: Record<string, number>;
  y0: string;
};
export type BuyStat = {
  siren: string;
  n: number;
  montant: number;
  ents: Set<string>;
  centrale: boolean;
};
export type ComStat = { insee: string; docs: number; con: number; cam: number; dr: number };

export type Figures = {
  ents: Record<string, EntStat>;
  buyers: Record<string, BuyStat>;
  /** Each commune's documents, a decree shared by several communes counted in each. */
  coms: Record<string, ComStat>;
};

/** The companies' and buyers' figures over the signed contracts (a copy once; amounts the build
 * counts, `compte`), and each commune's documents. */
export function figures(R: Recherche): Figures {
  const ents: Record<string, EntStat> = {};
  const buyers: Record<string, BuyStat> = {};
  const coms: Record<string, ComStat> = {};
  for (const e of R.evenements) {
    for (const k of new Set([e.insee, ...(e.partage ?? [])])) {
      if (!k || !R.communes[k]) continue;
      coms[k] ??= { insee: k, docs: 0, con: 0, cam: 0, dr: 0 };
      const c = coms[k];
      c.docs++;
      if (e.t === "attribution") c.con++;
      if (e.t === "arrete") c.cam++;
      if (e.t === "arrete_drone") c.dr++;
    }
    if (e.t !== "attribution") continue;
    // a contract published twice still names its company and its buyer, and counts once (the
    // prototype's entStats and buyStats)
    const b = buyerOf(R, e);
    for (const s of e.entreprises ?? []) {
      if (s === EI) continue; // a sole trader: no ranking
      ents[s] ??= {
        siren: s,
        n: 0,
        clientes: new Set(),
        montant: 0,
        deps: {},
        y0: "9999",
      };
      const o = ents[s];
      if (e.copie) continue;
      o.n++;
      if (b) o.clientes.add(b);
      if (e.compte) o.montant += e.montant ?? 0;
      if (e.dep) o.deps[e.dep] = (o.deps[e.dep] ?? 0) + 1;
      if (e.date && e.date.slice(0, 4) < o.y0) o.y0 = e.date.slice(0, 4);
    }
    if (!b) continue;
    buyers[b] ??= { siren: b, n: 0, montant: 0, ents: new Set(), centrale: false };
    const o = buyers[b];
    if (e.copie) continue;
    o.n++;
    if (e.compte) o.montant += e.montant ?? 0;
    if (e.hors_totaux === "centrale") o.centrale = true;
    for (const s of e.entreprises ?? []) if (s !== EI) o.ents.add(s);
  }
  return { ents, buyers, coms };
}
