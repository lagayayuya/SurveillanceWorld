// What the register's commune pages share (L'essentiel, Documents, Autorisations): a commune's file
// read once (lacarte-registre construire's commune/<insee>.json), its head and crumbs, and the
// prototype's helpers (app.js, donnees11.js) that its views read — the last decree of each dossier,
// the contracts of one procedure added up, the beneficiary's label. The rules (counted or not, a
// copy, the commune's own, a shared decree) are the build's flags, read here, never recomputed.
import type { Acheteur, Affaire, Commune, Evenement, Stats } from "./donnees.ts";
import { load } from "./donnees.ts";
import { fr } from "./format.ts";
import { has, t } from "./i18n.ts";
import { tidy, titleCase } from "./texte.ts";

export type Groupe = { nature: string; membres: { affaire: string; evenement?: string }[] };
export type Zones = {
  autorisations: Autorisation[];
  zones: Zone[];
  sites: Site[];
  unites: unknown[];
};
export type Autorisation = {
  acte: string;
  kind: "drone" | "vsa";
  date_acte: string;
  insee: string[];
  zones: string[];
  periodes: { t0: number; t1: number; heures?: number }[];
  url?: string;
  ref?: string;
  [k: string]: unknown;
};
export type Zone = { id: string; site?: string; statut?: string; [k: string]: unknown };
export type Site = { id: string; parts?: Record<string, unknown>; [k: string]: unknown };
export type Couverture = {
  maj: string;
  departement: {
    etat: "collecte" | "non_collecte" | "impossible";
    documents_demandes?: boolean;
    depuis?: string;
    dernier_recueil?: string;
    raison?: string;
  };
  sources: { id: string; jusqu_au: string | null; collecte_le: string | null }[];
};
export type FichierCommune = {
  v: number;
  commune: Commune & { insee: string };
  evenements: Evenement[];
  affaires: Record<string, Affaire>;
  entreprises: Record<string, { nom?: string | null; entrepreneur_individuel?: boolean }>;
  acheteurs: Record<string, Acheteur>;
  communes: Record<string, Commune>;
  lots: Record<string, Groupe>;
  libelles: Record<string, { court?: string; titre?: string }>;
  stats: {
    communes: Record<string, Stats>;
    epci: {
      code: string;
      nom: string | null;
      communes: string[];
      uniq: Record<string, number>;
    } | null;
    dep: {
      code: string;
      nom: string | null;
      uniq: Record<string, number>;
      depStats: Record<string, number>;
    };
  };
  carte: { n: number | null; pub: number | null; all: number | null };
  zones: Zones;
  mandats: { mandat: string; second_tour: string }[];
  couverture: Couverture;
};

/** A commune's file, its documents by id, its lots by affaire. */
export class Donnees {
  readonly f: FichierCommune;
  readonly insee: string;
  readonly ev: Map<string, Evenement>;
  /** Its own documents (and the copies of the decrees it shares), newest first. */
  readonly all: Evenement[];
  private readonly groupeOf: Map<string, string>;

  constructor(f: FichierCommune) {
    this.f = f;
    this.insee = f.commune.insee;
    this.ev = new Map(f.evenements.map((e) => [e.id, e]));
    this.all = f.evenements.filter((e) => e.insee === this.insee).sort(byDateDesc);
    this.groupeOf = new Map(
      Object.entries(f.lots).flatMap(([g, x]) => x.membres.map((m) => [m.affaire, g] as const)),
    );
  }

  affaire(id: string): Affaire | undefined {
    return this.f.affaires[id];
  }
  commune(insee: string): Commune {
    return this.f.communes[insee] ?? { nom: insee, dep: insee.slice(0, 2) };
  }
  /** A company's name as SIRENE gives it, in title case; a sole trader is never named. */
  entName(siren: string): string {
    const x = this.f.entreprises[siren];
    if (!x?.nom || x.entrepreneur_individuel) return t("commun.entreprise_siren", { siren });
    return tidy(titleCase(x.nom));
  }
  buyer(e: Evenement): string | null {
    return e.acheteur_siren ?? this.affaire(e.affaire)?.acheteur_siren ?? null;
  }
  buyerNom(siren: string): string {
    const a = this.f.acheteurs[siren];
    return a?.nom_court || a?.nom || t("commun.acheteur_siren", { siren });
  }
  /** A buyer's page: its commune's, for a commune. */
  buyerHref(siren: string): string {
    const a = this.f.acheteurs[siren];
    return a?.categorie === "commune" && a.insee_siege
      ? communeHref(a.insee_siege)
      : `/registre/acheteur/${siren}`;
  }
  /** The contracts of one procedure in one row: lots added up, a doublon once (app.js mergeLots). */
  mergeLots(cs: Evenement[]): (Evenement & { lots?: Evenement[]; copies?: number })[] {
    const by = new Map<string, Evenement[]>();
    for (const e of cs) {
      const k = this.groupeOf.get(e.affaire) ?? e.affaire;
      by.set(k, [...(by.get(k) ?? []), e]);
    }
    return [...by.entries()].map(([k, es]) => {
      if (es.length === 1) return es[0];
      return this.f.lots[k]?.nature === "doublon"
        ? { ...es[0], copies: es.length }
        : { ...es[0], montant: es.reduce((s, e) => s + (e.montant ?? 0), 0), lots: es };
    });
  }
  /** The date of a document as the timelines place it: the reviewed one when the build has one. */
  dateLue(e: Evenement): string {
    return e.date_lue ?? e.date ?? "";
  }
  /** The map's cameras in the commune (OpenStreetMap), none when the map is not cut for it. */
  get carte(): number | null {
    return this.f.carte.n ?? null;
  }
  /** Whether its département's decrees are collected, and since when. */
  get arretes(): { collectes: boolean; depuis?: string; dernier?: string; etat: string } {
    const d = this.f.couverture.departement;
    return {
      collectes: d.etat === "collecte",
      depuis: d.depuis,
      dernier: d.dernier_recueil,
      etat: d.etat,
    };
  }
}

const files = new Map<string, Promise<Donnees>>();
/** A commune's file, once per page. */
export function commune(insee: string): Promise<Donnees> {
  let p = files.get(insee);
  if (!p) {
    p = load<FichierCommune>(`commune/${insee}.json`).then((f) => new Donnees(f));
    files.set(insee, p);
    p.catch(() => files.delete(insee));
  }
  return p;
}

export const communeHref = (insee: string, tab = ""): string =>
  `/registre/commune/${insee}${tab ? `/${tab}` : ""}`;

/** A date as the lists sort it: a year-only date at the start of its year (app.js sortKey). */
export const sortKey = (e: Evenement): string =>
  e.date_annee ? `${(e.date ?? "").slice(0, 4)}-00-00` : (e.date ?? "");
export const byDateDesc = (a: Evenement, b: Evenement): number =>
  sortKey(b).localeCompare(sortKey(a));
export const byDateAsc = (a: Evenement, b: Evenement): number =>
  sortKey(a).localeCompare(sortKey(b));

export const isCam = (e: Evenement): boolean => e.t === "arrete";
export const isDrone = (e: Evenement): boolean => e.t === "arrete_drone";
export const isArr = (e: Evenement): boolean => e.t.startsWith("arrete");

/** The last decree of each video-protection dossier that gives its number of cameras (app.js). */
export function lastArretes(rows: Evenement[]): Evenement[] {
  const last: Record<string, Evenement> = {};
  for (const e of rows)
    if (
      e.t === "arrete" &&
      e.cameras != null &&
      (!last[e.affaire] || (last[e.affaire].date ?? "") < (e.date ?? ""))
    )
      last[e.affaire] = e;
  return Object.values(last);
}

/** A decree's beneficiary: « nom non publié » for a private person or a name not verified in
 * SIRENE (the build's nom_publie), else the published name, cleaned for display. */
export function benefLabel(e: Evenement): string {
  if (e.beneficiaire === "[non retenu]" || e.nom_publie === false)
    return t("commun.nom_non_publie");
  if (e.beneficiaire === "[non précisé]") return t("commun.non_precise");
  return tidy(titleCase(String(e.beneficiaire ?? "")));
}

/** Who published a document (app.js emetteur): the préfecture, the Region, the State. */
export function emetteur(e: Evenement): string {
  if (e.publie_par) return e.publie_par.charAt(0).toUpperCase() + e.publie_par.slice(1);
  const kind = e.t.startsWith("arrete") ? "arrete" : e.t;
  for (const key of [`emetteur.${kind}_${e.dep}`, `emetteur.${kind}`])
    if (has(`registre.${key}`)) return t(key);
  return "";
}

/** « le Rhône », « les Bouches-du-Rhône », « Paris »: a département with its article. */
export function depArt(dep: string, nom: string | null | undefined): string {
  return has(`registre.departement.art_${dep}`)
    ? t(`departement.art_${dep}`)
    : t("departement.art", { nom: nom ?? dep });
}

/** The figures of a commune's L'essentiel (app.js ess): its decrees' last state, its contracts. */
export function ess(d: Donnees) {
  const all = d.all;
  const mine = all.filter((e) => e.communal);
  const arr = lastArretes(all);
  const com = arr.filter((e) => e.communal).sort((a, b) => (b.cameras ?? 0) - (a.cameras ?? 0));
  const prv = arr.filter((e) => !e.communal);
  const contrats = mine.filter((e) => e.t === "attribution").sort(byDateAsc);
  const counted = contrats.filter((e) => e.compte);
  const excluded = contrats.filter((e) => !e.compte && !e.copie);
  return {
    all,
    mine,
    com,
    prv,
    contrats,
    counted,
    excluded,
    subs: all.filter((e) => e.t.startsWith("subvention")),
    // the street cameras only when every dossier of the mairie gives them (else not summed)
    camAut: com.reduce((s, e) => s + (e.cameras ?? 0), 0),
    vpAut:
      com.length && com.every((e) => e.cameras_vp != null)
        ? com.reduce((s, e) => s + (e.cameras_vp ?? 0), 0)
        : null,
    vpPart: com.filter((e) => e.cameras_vp != null),
    // « complete »: at most 3 dossiers of the mairie, each giving its street cameras
    complet: com.length > 0 && com.length <= 3 && com.every((e) => e.cameras_vp != null),
    dateAut: com
      .map((e) => e.date ?? "")
      .sort()
      .pop(),
    autres: all.filter((e) => /^arrete_(drone|vsa)$/.test(e.t)),
    eur: counted.reduce((s, e) => s + (e.montant ?? 0), 0),
  };
}

/** The head of a commune's pages: its line and its four tabs, always in the same order. */
export function tete(d: Donnees, cur: "ess" | "doc" | "aut" | "carte") {
  const c = d.f.commune;
  const dep = d.f.stats.dep;
  const epci = d.f.stats.epci;
  const parts = [
    dep.nom ?? c.dep,
    epci?.nom ?? "",
    c.pop ? t("commun.habitants", { n: fr(c.pop) }) : "",
  ].filter(Boolean);
  const ligne = parts.join(" · ");
  const insee = d.insee;
  const onglets: [string, string, string][] = [
    ["ess", t("commun.onglet_essentiel"), communeHref(insee)],
    ["doc", t("commun.onglet_documents", { n: fr(d.all.length) }), communeHref(insee, "documents")],
    [
      "aut",
      t("commun.onglet_autorisations", { n: fr(d.all.filter(isArr).length) }),
      communeHref(insee, "autorisations"),
    ],
    // Carte et drones is lot R1b's: the map's own page on the commune until then
    ["carte", t("commun.onglet_carte"), `/?insee=${insee}`],
  ];
  return {
    insee,
    nom: c.nom,
    dep: c.dep,
    epci: c.epci,
    ligne,
    ligneLongue: `${ligne} · ${t("commun.code_insee", { insee })}`,
    ongletsMt: cur === "ess" ? "22px" : "16px",
    onglets: onglets.map(([k, l, href]) => ({ l, href, cur: k === cur ? "page" : null })),
  };
}

/** The crumbs: Registre › département › (intercommunality on L'essentiel) › commune › tab. */
export function filCommune(d: Donnees, ici?: string) {
  const c = d.f.commune;
  const dep = d.f.stats.dep;
  const epci = d.f.stats.epci;
  const fil = [
    { l: t("commun.fil_registre"), href: "/registre/" },
    { l: dep.nom ?? c.dep, href: `/registre/departement/${c.dep}` },
  ];
  if (!ici && epci)
    fil.push({ l: epci.nom ?? epci.code, href: `/registre/departement/${c.dep}?ic=${epci.code}` });
  if (ici) fil.push({ l: c.nom, href: communeHref(d.insee) });
  return { fil, filIci: ici ?? c.nom };
}
