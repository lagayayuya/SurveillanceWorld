// The département page's pure helpers (view 10, the prototype's vues/departement.js): its file's
// shape (fermetures.py departement_file), the département's name with its prepositions, the rows of
// its intercommunalities and communes, a filter by name, an amount cell, the share of the most
// concerned intercommunality in words, the years shown; one fiche per territory (an
// intercommunality's at `?ic=<its code>`, its typed link, the territory's own buyer files, its
// sources). The figures are the build's: a total adds `montant` of counted contracts only
// (`compte`), never recomputed here.
import { departementArt } from "../collecte.ts";
import type { Rich, RichItem } from "../dc.ts";
import type { Acheteur, Commune, Entreprise, PartageFichier, Stats } from "../donnees.ts";
import { money } from "../format.ts";
import { has, t } from "../i18n.ts";
import { departementHref, lien } from "../liens.ts";
import { plain } from "../texte.ts";
import type { TypeCle } from "../types.ts";

export type Comptes = { docs: number; con: number; cam: number; dr: number; arr: number };
/** A company's or a buyer's contracts in the département: `montant` the counted ones'. */
export type Ligne = {
  siren: string;
  n: number;
  montant: number;
  hors_totaux: number;
  centrale?: boolean;
};
export type EtatCollecte = {
  etat: "collecte" | "non_collecte" | "impossible";
  raison?: string;
  documents_demandes?: boolean;
  depuis?: string;
  dernier_recueil?: string;
  nom?: string;
};
export type FichierDepartement = {
  v: number;
  partage?: PartageFichier;
  maj: string;
  departement: { code: string; nom: string | null };
  communes: Record<string, Commune>;
  entreprises: Record<string, Entreprise>;
  acheteurs: Record<string, Acheteur & { dep?: string }>;
  stats: {
    depStats: Comptes & { sansCommune: number; montant: number; montantBrut: number };
    uniq: Comptes;
    communes: Record<string, Stats>;
    epcis: Record<
      string,
      { nom: string | null; communes: string[]; uniq: Comptes; acheteur: boolean }
    >;
    vendeurs: Ligne[];
    acheteurs: Ligne[];
    annees: Record<string, Record<"con" | "mod" | "ao" | "sub" | "cam" | "dr", number>>;
  };
  couverture: EtatCollecte;
};

/** A département with no document has no file: its page from the coverage's row alone. */
export function vide(dep: string, maj: string, couverture: EtatCollecte): FichierDepartement {
  const zero = { docs: 0, con: 0, cam: 0, dr: 0, arr: 0 };
  return {
    v: 2,
    maj,
    departement: { code: dep, nom: couverture.nom ?? null },
    communes: {},
    entreprises: {},
    acheteurs: {},
    stats: {
      depStats: { ...zero, sansCommune: 0, montant: 0, montantBrut: 0 },
      uniq: zero,
      communes: {},
      epcis: {},
      vendeurs: [],
      acheteurs: [],
      annees: {},
    },
    couverture,
  };
}

/** Its name (the catalogue's, else the file's, else its code), « le Rhône », « dans le Rhône »,
 * « du Rhône »; Paris: « à Paris », « de Paris ». */
export function noms(dep: string, nomFichier: string | null | undefined) {
  const nom = has(`registre.departement.nom_${dep}`)
    ? t(`departement.nom_${dep}`)
    : (nomFichier ?? dep);
  const art = departementArt(dep, nom);
  const dans = has(`registre.departement.dans_${dep}`)
    ? t(`departement.dans_${dep}`)
    : t("departement.dans", { art });
  const du = has(`registre.departement.du_${dep}`)
    ? t(`departement.du_${dep}`)
    : t("departement.du", { nom });
  return { nom, art, dans, du };
}

/** A share in words, as the mockup's lead says it; under half, none. */
export function part(x: number): string | null {
  if (!(x > 0)) return null;
  if (x >= 1) return "tout";
  if (x >= 0.9) return "presque";
  if (x >= 0.72) return "trois_quarts";
  if (x >= 0.6) return "deux_tiers";
  if (x >= 0.45) return "moitie";
  return null;
}

/** An amount in a table: the counted contracts' sum; « — » when none of them counts (a ceiling,
 * a mixed contract, an amount to check, a national buyer), « non publié » when none gives one. */
export function montant(o: Pick<Ligne, "montant" | "hors_totaux">): string {
  if (o.montant > 0) return money(o.montant);
  return o.hors_totaux > 0 ? "—" : t("format.non_publie");
}

/** The intercommunality's name; the communes without one. */
export function nomEpci(code: string, nom: string | null | undefined): string {
  return code ? (nom ?? t("departement.epci_code", { code })) : t("departement.sans_epci");
}

/** « la Métropole de Lyon », « la CC du Pays de l'Arbresle », as the lead names it. */
export const epciLa = (nom: string): string =>
  /^(Métropole|CA |CC |CU |Communauté)/.test(nom) ? t("departement.epci_la", { nom }) : nom;

export type ComRow = {
  insee: string;
  nom: string;
  epci: string;
  ep: string;
  pop: number;
  docs: number;
  con: number;
  aut: number;
  dr: number;
  cams: number | null;
};
export type IcRow = {
  code: string;
  nom: string;
  n: number;
  docs: number;
  con: number;
  aut: number;
  dr: number;
  cams: number | null;
  acheteur: boolean;
  list: ComRow[];
};

/** Each commune with a document, its figures (a decree shared by several communes in each). */
export function communes(f: FichierDepartement): ComRow[] {
  const ep = f.stats.epcis;
  return Object.entries(f.stats.communes).map(([insee, s]) => {
    const c = f.communes[insee] ?? { nom: insee, dep: f.departement.code };
    const epci = c.epci ?? "";
    return {
      insee,
      nom: c.nom,
      epci,
      ep: epci ? nomEpci(epci, ep[epci]?.nom) : "",
      pop: c.pop ?? 0,
      docs: s.docs,
      con: s.con,
      aut: s.cam,
      dr: s.dr,
      cams: s.carte ?? null,
    };
  });
}

/** Each intercommunality: its communes with a document, each document once (the build's uniq);
 * the map's cameras added up when the map knows them. */
export function intercommunalites(f: FichierDepartement, coms: ComRow[]): IcRow[] {
  const by = new Map(coms.map((c) => [c.insee, c]));
  return Object.entries(f.stats.epcis).map(([code, x]) => {
    const list = x.communes.map((k) => by.get(k)).filter((c): c is ComRow => !!c);
    const known = list.filter((c) => c.cams != null);
    return {
      code,
      nom: nomEpci(code, x.nom),
      n: list.length,
      docs: x.uniq.docs,
      con: x.uniq.con,
      aut: x.uniq.cam,
      dr: x.uniq.dr,
      cams: known.length ? known.reduce((s, c) => s + (c.cams ?? 0), 0) : null,
      acheteur: x.acheteur,
      list,
    };
  });
}

/** The rows whose name holds the query, accents and case ignored. */
export function filtrer<T extends { nom: string }>(rows: T[], q: string): T[] {
  const k = plain(q.trim());
  return k ? rows.filter((r) => plain(r.nom).includes(k)) : rows;
}

/** Sort by a key, numbers or names (French order), `dir` 1 or −1; the documents break a tie. */
export function trier<T extends Record<string, unknown>>(rows: T[], k: string, dir: number): T[] {
  return rows.slice().sort((a, b) => {
    const va = a[k];
    const vb = b[k];
    const d =
      typeof va === "string" || typeof vb === "string"
        ? String(va ?? "").localeCompare(String(vb ?? ""), "fr")
        : Number(va ?? -1) - Number(vb ?? -1);
    return d * dir || Number(b.docs ?? 0) - Number(a.docs ?? 0);
  });
}

// --- one fiche per territory (design/registre/v2): a département's, an intercommunality's -------

/** An intercommunality's fiche: its département's page with `?ic=<its code>` (its SIREN). */
export const epciHref = (dep: string, code: string): string =>
  `${departementHref(dep)}?ic=${encodeURIComponent(code)}`;

/** A row's main link (v2.1, A2): the mention made the row's link (`a.rl`, cadre.css « rows »), the
 * whole row its target; a mention without a fiche stays as it is. */
export function enLigne(x: RichItem): RichItem {
  return typeof x === "object" && x && "a" in x ? { a: { ...x.a, cls: "rl" } } : x;
}

/** Column heads that do not read alone (v2.1, A6): each one's sentence, in the order of the
 * heads (none: the head reads alone), its button or its words then `.aide` (cadre.css). */
export function aides<T extends object>(
  cols: T[],
  phrases: (string | undefined)[],
): (T & { ac: string; aide: string })[] {
  return cols.map((c, i) => ({ ...c, ac: phrases[i] ? "aide" : "", aide: phrases[i] ?? "" }));
}

/** The type of the fiche a mention leads to, read from its address (a row's bar takes its colour,
 * cadre.css « rows »); a mention without a fiche, none. */
export function typeDe(x: RichItem): TypeCle | undefined {
  const href = typeof x === "object" && x && "a" in x ? x.a.href : "";
  if (href.startsWith("/registre/commune/")) return "commune";
  if (href.startsWith("/registre/entreprise/")) return "entreprise";
  if (href.startsWith("/registre/acheteur/")) return "acheteur";
  if (href.startsWith("/registre/contrat/")) return "con";
  if (href.startsWith("/registre/departement/"))
    return href.includes("?ic=") ? "epci" : "departement";
  return undefined;
}

/** An intercommunality's mention: a link to its fiche when the département's file has its row. */
export function lienEpci(
  f: Pick<FichierDepartement, "departement" | "stats">,
  code: string,
  text?: Rich,
  liste = false,
): RichItem {
  const row = code ? f.stats.epcis[code] : undefined;
  return lien(
    "epci",
    row ? epciHref(f.departement.code, code) : null,
    text ?? nomEpci(code, row?.nom),
    liste,
  );
}

/** The fiche the path shows: an intercommunality's when `?ic=` names a row of the file, else the
 * département's (an unknown code is not an error: the département is there). */
export const epciDe = (f: Pick<FichierDepartement, "stats">, ic: string): string =>
  ic && f.stats.epcis[ic] ? ic : "";

/** The territory's own purchases, the buyer files to read beside it (« une collectivité a une
 * seule fiche »): an intercommunality's own SIREN (its file, when the build wrote one, holds its
 * contracts and its notices: `acheteur` counts the contracts only), a département's buyers filed
 * as a département of this one and named in its file (the build's `categorie`, `dep`). */
export function achatsPropres(f: FichierDepartement, ic: string): string[] {
  if (ic) return f.stats.epcis[ic] ? [ic] : [];
  return Object.entries(f.acheteurs)
    .filter(([, a]) => a.categorie === "departement" && a.dep === f.departement.code)
    .map(([s]) => s)
    .sort();
}

/** The sources a territory's fiche reads (couverture.json's ids; sources.ts skips one it lacks):
 * the contracts, the notices, its prefecture's decrees, the State's and its region's subsidies. */
const REGION: Record<string, string> = {
  ...Object.fromEntries(["75", "77", "78", "91", "92", "93", "94", "95"].map((d) => [d, "idf"])),
  ...Object.fromEntries(["04", "05", "06", "13", "83", "84"].map((d) => [d, "sud"])),
};
export function sourcesIds(dep: string): string[] {
  return [
    "contrats",
    "avis",
    `arretes_${dep}`,
    `subventions_etat_${dep}`,
    ...(REGION[dep] ? [`subventions_region_${REGION[dep]}`] : []),
  ];
}

/** The nine years the chart shows, the last the build's (in progress). */
export function annees(maj: string): string[] {
  const last = Number(maj.slice(0, 4));
  return Array.from({ length: 9 }, (_, i) => String(last - 8 + i));
}
