// The register's lists, one per type (design/registre/v2, V2-Liste), and what the summary reads of
// them (V2-Sommaire): each list's rows, its sort keys, its filters, its count; the search across the
// register; the old addresses that now open a list. One function makes a list's rows and the
// summary counts them (a count and its list cannot disagree). The figures and rules are those of
// « Chiffres et classements » (corpus.ts figures: a contract counted once, an amount the build counts,
// `compte`) and of the old documents' search (corpus.ts ligne: the facets, the amount it ranks), read
// from recherche.json; a figure the build should write for the whole register is asked of it (R3),
// read here when it is there (index.json `comptes`).

import { communeHref } from "./commun.ts";
import {
  badge,
  benef,
  buyerOf,
  DEPS,
  DISPS,
  type Ligne as Doc,
  date,
  depGroup,
  depNom,
  entName,
  type Figures,
  figures,
  type Index,
  type Kind,
  type Lexique,
  ligne,
  type Recherche,
} from "./corpus.ts";
import type { Rich, RichItem } from "./dc.ts";
import type { Acheteur, Couverture } from "./donnees.ts";
import { EI } from "./donnees.ts";
import { count, fr, money } from "./format.ts";
import { has, t } from "./i18n.ts";
import {
  lien,
  lienAcheteur,
  lienCommune,
  lienDepartement,
  lienDocument,
  lienEntreprise,
} from "./liens.ts";
import { LISTES, type Liste, type Route } from "./routes.ts";
import { plain, tidy, titleCase } from "./texte.ts";
import type { TypeCle } from "./types.ts";

export { LISTES, type Liste };

// --- the lists' addresses ----------------------------------------------------------------------

/** Each list's type: its colour, its pictogram, its word. */
export const TYPE_DE: Record<Liste, TypeCle> = {
  communes: "commune",
  intercommunalites: "epci",
  departements: "departement",
  acheteurs: "acheteur",
  entreprises: "entreprise",
  contrats: "con",
  modifications: "mod",
  "appels-d-offres": "ao",
  arretes: "aut",
  subventions: "sub",
};
const LISTE_DE = Object.fromEntries(
  Object.entries(TYPE_DE).map(([l, k]) => [k, l as Liste]),
) as Partial<Record<TypeCle, Liste>>;

/** A type's list (« Registre › Entreprises » leads there); the register itself, its summary. */
export function listeHref(k: TypeCle): string {
  const l = LISTE_DE[k];
  return l ? `/registre/${l}` : "/registre/";
}

/** The list of a document's kind (corpus.ts typ). */
const LISTE_KIND: Record<Kind, Liste> = {
  con: "contrats",
  mod: "modifications",
  ao: "appels-d-offres",
  aut: "arretes",
  sub: "subventions",
};

// --- the buyers' categories (V2-Sommaire: « hors collectivités ») --------------------------------

/** The buyers' list holds the buyers that are not a collectivité (a commune, an intercommunality,
 * a métropole, a département are territories: their fiche is the territory's or their own), in
 * four categories; a buyer without category (an unnamed entry of the dictionary) is in none. */
export const CATS = ["etat", "bailleur", "transports", "autres"] as const;
export type Cat = (typeof CATS)[number];
const CAT_DE: Record<string, Cat> = {
  etat: "etat",
  bailleur: "bailleur",
  transports: "transports",
  sante: "autres",
  education: "autres",
  autre: "autres",
  region: "autres",
};
export const catAcheteur = (a: Acheteur | undefined): Cat | null =>
  CAT_DE[a?.categorie ?? ""] ?? null;
const EPCI = new Set(["intercommunalite", "metropole"]);

// --- the data a list reads ---------------------------------------------------------------------

/** couverture.json as the build writes it: each département's name beside its state. */
export type CouvertureX = Couverture & {
  departements: Record<string, Couverture["departements"][string] & { nom?: string }>;
};
type AcheteurX = Acheteur & { dep?: string };

/** Every document and the dictionaries (recherche.json), their figures, and the coverage. */
export type Corpus = {
  R: Recherche;
  fig: Figures;
  docs: Doc[];
  couverture: CouvertureX;
  maj: string;
};
const memo = new WeakMap<Recherche, { fig: Figures; docs: Doc[] }>();
export function corpus(R: Recherche, couverture: CouvertureX, maj: string): Corpus {
  let m = memo.get(R);
  if (!m) {
    m = { fig: figures(R), docs: R.evenements.map((e) => ligne(R, e)) };
    memo.set(R, m);
  }
  return { R, ...m, couverture, maj };
}

/** A département's name: the build's (couverture.json), else the catalogue's, else its code. */
export const nomDep = (C: Pick<Corpus, "couverture">, code: string): string =>
  C.couverture.departements[code]?.nom ?? depNom(code);

// --- a list's rows ----------------------------------------------------------------------------

export type Filtre = "dep" | "cat" | "annee" | "disp" | "etat";
export const FILTRES: Filtre[] = ["cat", "etat", "dep", "annee", "disp"];

/** A row: its name (a typed link, the pictogram alone), the line under it, its other cells, what
 * its filters, its sort keys and its CSV read. */
export type Rang = {
  id: string;
  nom: string;
  lien: RichItem;
  sous: string;
  /** the départements' chips (Entreprises) */
  deps?: string[];
  cells: Rich[];
  mots: string;
  f: Partial<Record<Filtre, string[]>>;
  v: Record<string, number | string>;
  csv: Record<string, string | number>;
};

/** A column after the name: its words, numeric or not, the sort key its head picks. */
export type Colonne = { l: string; num?: boolean; tri?: string; deps?: boolean };
/** A « classer par » key: its words, its first direction (-1: the largest first). */
export type Tri = { k: string; l: string; dir: 1 | -1 };

export type Def = {
  liste: Liste;
  k: TypeCle;
  /** the name's column head */
  nom: string;
  cols: Colonne[];
  tris: Tri[];
  filtres: Filtre[];
  /** « Montant prévu au contrat : une enveloppe… » under the tools */
  argent: boolean;
  /** the CSV's columns after the rank and the name: [key of Rang.csv, words] */
  csv: [string, string][];
  rangs(C: Corpus): Rang[];
};

const W = (k: string) => t(`liste.${k}`);
const tri = (k: string, l: string, dir: 1 | -1 = -1): Tri => ({ k, l: W(`tri.${l}`), dir });
const col = (l: string, x: Partial<Colonne> = {}): Colonne => ({ l: W(`col.${l}`), ...x });
const csvCol = (k: string): [string, string] => [k, W(`csv.${k}`)];
/** « — »: a figure the register does not have (a département whose decrees are not collected). */
const NA = "—";

function collectes(C: Corpus): Set<string> {
  return new Set(
    Object.entries(C.couverture.departements)
      .filter(([, d]) => d.etat === "collecte")
      .map(([k]) => k),
  );
}

function rangsCommunes(C: Corpus): Rang[] {
  const lus = collectes(C);
  return Object.values(C.fig.coms).map((c) => {
    const x = C.R.communes[c.insee];
    const ok = lus.has(x.dep);
    const carte = x.carte ?? null;
    return {
      id: c.insee,
      nom: x.nom,
      lien: lienCommune(C.R, c.insee, x.nom, true),
      sous: nomDep(C, x.dep),
      cells: [
        fr(c.docs),
        fr(c.con),
        ok ? fr(c.cam) : NA,
        ok ? fr(c.dr) : NA,
        carte == null ? NA : fr(carte),
      ],
      mots: plain(`${x.nom} ${nomDep(C, x.dep)}`),
      f: { dep: [depGroup(x.dep)] },
      v: {
        docs: c.docs,
        con: c.con,
        aut: ok ? c.cam : -1,
        dr: ok ? c.dr : -1,
        carte: carte ?? -1,
        nom: x.nom,
      },
      csv: {
        id: c.insee,
        departement: x.dep,
        documents: c.docs,
        contrats: c.con,
        autorisations: ok ? c.cam : "",
        drones: ok ? c.dr : "",
        carte: carte ?? "",
      },
    };
  });
}

/** The intercommunalities of the register's communes (each commune's `epci`). A name and a fiche
 * only for one that buys (its buyer's fiche): the build writes no list of them yet (asked of R3). */
function rangsEpci(C: Corpus): Rang[] {
  const by = new Map<string, string[]>();
  for (const c of Object.values(C.fig.coms)) {
    const e = C.R.communes[c.insee]?.epci;
    if (!e) continue;
    by.set(e, [...(by.get(e) ?? []), c.insee]);
  }
  return [...by].map(([siren, coms]) => {
    const a = C.R.acheteurs[siren];
    const nom = a ? a.nom_court || a.nom || "" : "";
    const label = nom || t("liste.epci_siren", { siren });
    const noms = coms.map((k) => C.R.communes[k].nom).sort((x, y) => x.localeCompare(y, "fr"));
    const deps = [...new Set(coms.map((k) => C.R.communes[k].dep))];
    const b = C.fig.buyers[siren];
    return {
      id: siren,
      nom: label,
      lien: nom ? lienAcheteur(C.R, siren, nom, true) : lien("epci", null, label, true),
      sous: noms.length > 3 ? `${noms.slice(0, 3).join(", ")}…` : noms.join(", "),
      cells: [fr(coms.length), fr(b?.n ?? 0), b?.montant ? money(b.montant) : NA],
      mots: plain(`${label} ${noms.join(" ")}`),
      f: { dep: [...new Set(deps.map(depGroup))] },
      v: { communes: coms.length, con: b?.n ?? 0, amt: b?.montant ?? 0, nom: label },
      csv: {
        id: siren,
        departement: deps.join(" "),
        communes: coms.length,
        contrats: b?.n ?? 0,
        montant: b?.montant ?? "",
      },
    };
  });
}

/** Etat label of a département's decrees (couverture.json). */
function etatDep(C: Corpus, code: string): string {
  const d = C.couverture.departements[code];
  if (!d) return "";
  if (d.etat === "collecte") return t("couverture.etat_collecte");
  if (d.etat === "impossible") return t("couverture.etat_impossible_court");
  return t("couverture.etat_non_collecte_court");
}

function rangsDepartements(C: Corpus): Rang[] {
  const docs: Record<string, { n: number; con: number; aut: number; amt: number }> = {};
  for (const e of C.R.evenements) {
    if (!e.dep) continue;
    docs[e.dep] ??= { n: 0, con: 0, aut: 0, amt: 0 };
    const o = docs[e.dep];
    o.n++;
    // a contract counted once (a copy is the second publication), its amount when the build counts it
    if (e.t === "attribution" && !e.copie) o.con++;
    if (e.t.startsWith("arrete")) o.aut++;
    if (e.compte) o.amt += e.montant ?? 0;
  }
  const coms: Record<string, number> = {};
  for (const c of Object.values(C.fig.coms)) {
    const d = C.R.communes[c.insee].dep;
    coms[d] = (coms[d] ?? 0) + 1;
  }
  return Object.entries(C.couverture.departements).map(([code, d]) => {
    const o = docs[code] ?? { n: 0, con: 0, aut: 0, amt: 0 };
    const nom = nomDep(C, code);
    const ok = d.etat === "collecte";
    return {
      id: code,
      nom,
      lien: lienDepartement(code, nom, true),
      sous: `${code} · ${t("liste.arretes_etat", { etat: etatDep(C, code) })}`,
      cells: [
        fr(coms[code] ?? 0),
        fr(o.n),
        fr(o.con),
        o.amt ? money(o.amt) : NA,
        ok ? fr(o.aut) : NA,
      ],
      mots: plain(`${code} ${nom}`),
      f: { etat: [d.etat] },
      v: {
        docs: o.n,
        communes: coms[code] ?? 0,
        con: o.con,
        amt: o.amt,
        aut: ok ? o.aut : -1,
        nom,
      },
      csv: {
        id: code,
        etat: d.etat,
        communes: coms[code] ?? 0,
        documents: o.n,
        contrats: o.con,
        montant: o.amt || "",
        arretes: ok ? o.aut : "",
      },
    };
  });
}

/** A buyer's category in words: « État », « bailleur social », « centrale d'achat ». */
function motCategorie(a: Acheteur | undefined, centrale: boolean): string {
  if (centrale) return t("chiffres.cat_centrale");
  return a?.categorie && has(`registre.chiffres.cat_${a.categorie}`)
    ? t(`chiffres.cat_${a.categorie}`)
    : t("chiffres.cat_acheteur");
}

function rangsAcheteurs(C: Corpus): Rang[] {
  const out: Rang[] = [];
  for (const [s, a] of Object.entries(C.R.acheteurs) as [string, AcheteurX][]) {
    const cat = catAcheteur(a);
    if (!cat) continue;
    const b = C.fig.buyers[s];
    const nom = a.nom_court || a.nom || s;
    const dep = a.dep ?? "";
    const catMot = motCategorie(a, !!b?.centrale);
    out.push({
      id: s,
      nom,
      lien: lienAcheteur(C.R, s, nom, true),
      sous: dep ? `${catMot} · ${nomDep(C, dep)}` : catMot,
      cells: [fr(b?.n ?? 0), b?.montant ? money(b.montant) : NA, fr(b?.ents.size ?? 0)],
      mots: plain(`${a.nom ?? ""} ${a.nom_court ?? ""} ${catMot}`),
      f: { cat: [cat], dep: dep ? [depGroup(dep)] : [] },
      v: { con: b?.n ?? 0, amt: b?.montant ?? 0, ents: b?.ents.size ?? 0, nom },
      csv: {
        id: s,
        categorie: a.categorie ?? "",
        departement: dep,
        contrats: b?.n ?? 0,
        montant: b?.montant ?? "",
        entreprises: b?.ents.size ?? 0,
      },
    });
  }
  return out;
}

function rangsEntreprises(C: Corpus): Rang[] {
  return Object.values(C.fig.ents)
    .filter((o) => o.n > 0 && o.siren !== EI && !C.R.entreprises[o.siren]?.entrepreneur_individuel)
    .map((o) => {
      const nom = entName(C.R, o.siren);
      const naf =
        (C.R.entreprises[o.siren] as { naf_libelle?: string | null } | undefined)?.naf_libelle ??
        "";
      const deps = Object.entries(o.deps)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k]) => k);
      const y0 = o.y0 === "9999" ? "" : o.y0;
      return {
        id: o.siren,
        nom,
        lien: lienEntreprise(C.R, o.siren, nom, true),
        sous: naf,
        deps: deps.slice().sort((a, b) => a.localeCompare(b)),
        cells: [fr(o.n), fr(o.clientes.size), o.montant ? money(o.montant) : NA, y0 || NA],
        mots: plain(`${nom} ${naf}`),
        f: { dep: [...new Set(deps.map(depGroup))] },
        v: { n: o.n, cl: o.clientes.size, amt: o.montant, y: y0 || "9999", nom },
        csv: {
          id: o.siren,
          activite: naf,
          departements: deps.join(" "),
          contrats: o.n,
          clientes: o.clientes.size,
          montant: o.montant || "",
          depuis: y0,
        },
      };
    });
}

/** A document's « qui »: its buyer (a link), a decree's beneficiary, a subsidy's. */
function qui(L: Lexique, d: Doc): RichItem {
  const e = d.e;
  if (d.k === "aut") return benef(e);
  if (d.k === "sub") {
    const nom =
      e.nom_publie === false
        ? t("commun.nom_non_publie")
        : tidy(titleCase(String(e.beneficiaire ?? "")));
    const s = e.beneficiaire_siren;
    return s && L.acheteurs[s] && e.nom_publie !== false ? lienAcheteur(L, s, nom, true) : nom;
  }
  if (d.k === "ao") {
    const s = e.acheteur_siren;
    const nom = tidy(e.acheteur ?? "");
    if (s && L.acheteurs[s]) return lienAcheteur(L, s, nom || undefined, true);
    return nom || NA;
  }
  const s = buyerOf(L, e);
  return s ? lienAcheteur(L, s, undefined, true) : NA;
}

/** A document's companies, each a link (a sole trader its words only). */
function entreprises(L: Lexique, d: Doc): Rich {
  const xs = d.e.entreprises ?? [];
  if (!xs.length) return NA;
  const out: RichItem[] = [];
  xs.forEach((s, i) => {
    if (i) out.push(", ");
    out.push(lienEntreprise(L, s, undefined, true));
  });
  return out;
}

function rangsDocuments(C: Corpus, k: Kind): Rang[] {
  const L = C.R;
  const zone = t("arretes.zone_non_deduite");
  return C.docs
    .filter((d) => d.k === k)
    .map((d) => {
      const e = d.e;
      const where: Rich =
        e.insee && L.communes[e.insee]
          ? [lienCommune(L, e.insee, undefined, true)]
          : e.dep
            ? nomDep(C, e.dep)
            : NA;
      const cams = e.t === "arrete" && e.cameras != null ? e.cameras : null;
      const amount: Rich = k === "aut" ? (cams == null ? NA : fr(cams)) : money(e.montant);
      const cells: Rich[] =
        k === "aut" || k === "sub"
          ? [where, [qui(L, d)], amount]
          : [where, [qui(L, d)], entreprises(L, d), amount];
      const sous = [
        date(e) + (e.date_lue ? "*" : ""),
        e.non_lu?.includes("zone_non_deduite") ? zone : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        id: e.id,
        nom: d.title,
        lien: lienDocument(L, e, d.title, true),
        sous,
        cells,
        mots: d.words,
        f: { dep: [d.key[1]], annee: [d.key[2]], disp: [d.key[3]] },
        v: { date: d.date, amt: k === "aut" ? (cams ?? -1) : d.rank, nom: d.title },
        csv: {
          id: e.id,
          date: e.date_annee ? (e.date ?? "").slice(0, 4) : (e.date ?? ""),
          nature: badge(e),
          commune: d.com,
          insee: e.insee ?? "",
          departement: e.dep ?? "",
          qui: d.qui,
          entreprises: d.ents,
          montant: e.montant ?? "",
          cameras: e.cameras ?? "",
          reference: e.ref ?? "",
          url: e.url ?? "",
        },
      };
    });
}

const DOC_CSV = ["date", "nature", "commune", "insee", "departement", "qui", "entreprises"];

function defDocument(liste: Liste, k: Kind): Def {
  const aut = k === "aut";
  const sub = k === "sub";
  return {
    liste,
    k: k as TypeCle,
    nom: W(`col.doc_${k}`),
    cols: [
      col("commune"),
      col(aut || sub ? "beneficiaire" : "acheteur"),
      ...(aut || sub ? [] : [col("entreprises")]),
      aut ? col("cameras", { num: true, tri: "amt" }) : col("montant", { num: true, tri: "amt" }),
    ],
    tris: [tri("date", "date"), aut ? tri("amt", "cameras") : tri("amt", "montant")],
    filtres: ["dep", "annee", ...(k === "ao" ? [] : (["disp"] as Filtre[]))],
    argent: k === "con" || k === "mod",
    csv: [...DOC_CSV, aut ? "cameras" : "montant", "reference", "url"].map(csvCol),
    rangs: (C) => rangsDocuments(C, k),
  };
}

/** Every list: its columns, its sort keys (the first is the list's own order), its filters. */
export const DEFS: Record<Liste, Def> = {
  get communes(): Def {
    return {
      liste: "communes",
      k: "commune",
      nom: W("col.commune"),
      cols: [
        col("documents", { num: true, tri: "docs" }),
        col("contrats", { num: true, tri: "con" }),
        col("autorisations", { num: true, tri: "aut" }),
        col("drones", { num: true, tri: "dr" }),
        col("carte", { num: true, tri: "carte" }),
      ],
      tris: [
        tri("docs", "documents"),
        tri("con", "contrats"),
        tri("aut", "autorisations"),
        tri("dr", "drones"),
        tri("carte", "carte"),
        tri("nom", "nom", 1),
      ],
      filtres: ["dep"],
      argent: false,
      csv: ["departement", "documents", "contrats", "autorisations", "drones", "carte"].map(csvCol),
      rangs: rangsCommunes,
    };
  },
  get intercommunalites(): Def {
    return {
      liste: "intercommunalites",
      k: "epci",
      nom: W("col.epci"),
      cols: [
        col("communes", { num: true, tri: "communes" }),
        col("contrats_signes", { num: true, tri: "con" }),
        col("montant", { num: true, tri: "amt" }),
      ],
      tris: [
        tri("communes", "communes"),
        tri("con", "contrats"),
        tri("amt", "montant"),
        tri("nom", "nom", 1),
      ],
      filtres: ["dep"],
      argent: true,
      csv: ["departement", "communes", "contrats", "montant"].map(csvCol),
      rangs: rangsEpci,
    };
  },
  get departements(): Def {
    return {
      liste: "departements",
      k: "departement",
      nom: W("col.departement"),
      cols: [
        col("communes", { num: true, tri: "communes" }),
        col("documents", { num: true, tri: "docs" }),
        col("contrats", { num: true, tri: "con" }),
        col("montant", { num: true, tri: "amt" }),
        col("arretes", { num: true, tri: "aut" }),
      ],
      tris: [
        tri("docs", "documents"),
        tri("communes", "communes"),
        tri("con", "contrats"),
        tri("amt", "montant"),
        tri("nom", "nom", 1),
      ],
      filtres: ["etat"],
      argent: true,
      csv: ["etat", "communes", "documents", "contrats", "montant", "arretes"].map(csvCol),
      rangs: rangsDepartements,
    };
  },
  get acheteurs(): Def {
    return {
      liste: "acheteurs",
      k: "acheteur",
      nom: W("col.acheteur"),
      cols: [
        col("contrats", { num: true, tri: "con" }),
        col("montant", { num: true, tri: "amt" }),
        col("entreprises", { num: true, tri: "ents" }),
      ],
      tris: [
        tri("con", "contrats"),
        tri("amt", "montant"),
        tri("ents", "entreprises"),
        tri("nom", "nom", 1),
      ],
      filtres: ["cat", "dep"],
      argent: true,
      csv: ["categorie", "departement", "contrats", "montant", "entreprises"].map(csvCol),
      rangs: rangsAcheteurs,
    };
  },
  get entreprises(): Def {
    return {
      liste: "entreprises",
      k: "entreprise",
      nom: W("col.entreprise"),
      cols: [
        col("departements", { deps: true }),
        col("contrats", { num: true, tri: "n" }),
        col("clientes", { num: true, tri: "cl" }),
        col("montant", { num: true, tri: "amt" }),
        col("depuis", { num: true, tri: "y" }),
      ],
      tris: [
        tri("n", "contrats"),
        tri("cl", "clientes"),
        tri("amt", "montant"),
        tri("y", "anciennete", 1),
        tri("nom", "nom", 1),
      ],
      filtres: ["dep"],
      argent: true,
      csv: ["activite", "departements", "contrats", "clientes", "montant", "depuis"].map(csvCol),
      rangs: rangsEntreprises,
    };
  },
  get contrats(): Def {
    return defDocument("contrats", "con");
  },
  get modifications(): Def {
    return defDocument("modifications", "mod");
  },
  get "appels-d-offres"(): Def {
    return defDocument("appels-d-offres", "ao");
  },
  get arretes(): Def {
    return defDocument("arretes", "aut");
  },
  get subventions(): Def {
    return defDocument("subventions", "sub");
  },
};

/** A list's rows, once per page and corpus. */
const rangsMemo = new WeakMap<Recherche, Partial<Record<Liste, Rang[]>>>();
export function rangs(C: Corpus, l: Liste): Rang[] {
  let m = rangsMemo.get(C.R);
  if (!m) {
    m = {};
    rangsMemo.set(C.R, m);
  }
  m[l] ??= DEFS[l].rangs(C);
  return m[l];
}

// --- the filters -------------------------------------------------------------------------------

const YEARS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "<2018"];

/** A filter's values, in the keys' order. */
export function valeurs(f: Filtre): string[] {
  // the pilot's départements as V2-Liste orders them (the Rhône, then the Bouches-du-Rhône), then the others
  if (f === "dep") return ["69", "13", ...DEPS.filter((d) => d !== "69" && d !== "13"), "xx"];
  if (f === "cat") return [...CATS];
  if (f === "annee") return YEARS;
  if (f === "disp") return DISPS;
  return ["collecte", "non_collecte", "impossible"];
}

/** A filter value's words on its key (« 69 », « Hors pilote », « État », « 2025 »). */
export function motValeur(f: Filtre, v: string): string {
  if (f === "dep") return v === "xx" ? W("hors_pilote") : v;
  if (f === "cat") return W(`cat.${v}`);
  if (f === "annee") return v === "<2018" ? t("registre.annee_avant_2018") : v;
  if (f === "disp") return t(`registre.disp_${v}`);
  return W(`etat.${v}`);
}

// --- a list's state: its sort, its filters, its text; in the address ----------------------------

export type Etat = { tri: string; dir: 1 | -1; q: string; f: Partial<Record<Filtre, string>> };

/** The state an address says (?tri=…&ordre=…&dep=…&q=…); a value it does not know is dropped. */
export function etatDe(def: Def, q: Record<string, string>): Etat {
  const t0 = def.tris.find((x) => x.k === q.tri) ?? def.tris[0];
  const dir = q.ordre === "asc" ? 1 : q.ordre === "desc" ? -1 : t0.dir;
  const f: Partial<Record<Filtre, string>> = {};
  for (const k of def.filtres) if (q[k] && valeurs(k).includes(q[k])) f[k] = q[k];
  return { tri: t0.k, dir, q: q.q ?? "", f };
}

/** The address of a list in a state: only what differs from the list's own order. */
export function adresse(def: Def, e: Etat): string {
  const p = new URLSearchParams();
  const t0 = def.tris.find((x) => x.k === e.tri) ?? def.tris[0];
  if (t0 !== def.tris[0]) p.set("tri", t0.k);
  if (e.dir !== t0.dir) p.set("ordre", e.dir > 0 ? "asc" : "desc");
  for (const k of def.filtres) if (e.f[k]) p.set(k, e.f[k] as string);
  if (e.q.trim()) p.set("q", e.q.trim());
  const s = p.toString();
  return `/registre/${def.liste}${s ? `?${s}` : ""}`;
}

export type Resultat = {
  list: Rang[];
  /** each filter's values counted without the filter itself; "" is « every value » */
  comptes: Partial<Record<Filtre, Record<string, number>>>;
};

/** The rows the state keeps, sorted, and each filter's counts left out of its own filter. */
export function appliquer(def: Def, all: Rang[], e: Etat): Resultat {
  const q = plain(e.q.trim());
  const base = q ? all.filter((r) => r.mots.includes(q)) : all;
  const ok = (r: Rang, skip: Filtre | null) =>
    def.filtres.every((k) => k === skip || !e.f[k] || (r.f[k] ?? []).includes(e.f[k] as string));
  const comptes: Resultat["comptes"] = {};
  for (const k of def.filtres) {
    const c: Record<string, number> = { "": 0 };
    for (const r of base) {
      if (!ok(r, k)) continue;
      c[""]++;
      for (const v of r.f[k] ?? []) c[v] = (c[v] ?? 0) + 1;
    }
    comptes[k] = c;
  }
  const key = e.tri;
  const list = base
    .filter((r) => ok(r, null))
    .sort((a, b) => {
      const x = a.v[key];
      const y = b.v[key];
      const d =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), "fr");
      return e.dir * d || a.nom.localeCompare(b.nom, "fr");
    });
  return { list, comptes };
}

/** The list as a CSV file's text (the browser makes the file): its rank, name, then its columns,
 * the heads in the catalogue's words; every value quoted. */
export function csv(def: Def, list: Rang[]): string {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = [W("csv.rang"), def.nom, W("csv.id"), ...def.csv.map(([, l]) => l)];
  const lines = list.map((r, i) =>
    [i + 1, r.nom, r.csv.id ?? r.id, ...def.csv.map(([k]) => r.csv[k])].map(q).join(","),
  );
  return `﻿${head.map(q).join(",")}\r\n${lines.join("\r\n")}\r\n`;
}

// --- the counts the summary and the rail show ----------------------------------------------------

export type Comptes = { listes: Record<Liste, number>; categories: Record<Cat, number> };

/** The counts the build writes (index.json `comptes`, asked of R3), when it does. */
export function comptesIndex(I: Index): Comptes | null {
  const c = (I as Index & { comptes?: Comptes }).comptes;
  return c?.listes && c.categories ? c : null;
}

/** The counts of every list: its rows, one function for both. */
export function comptes(C: Corpus): Comptes {
  const listes = Object.fromEntries(LISTES.map((l) => [l, rangs(C, l).length])) as Record<
    Liste,
    number
  >;
  const categories = Object.fromEntries(CATS.map((c) => [c, 0])) as Record<Cat, number>;
  for (const r of rangs(C, "acheteurs")) for (const c of r.f.cat ?? []) categories[c as Cat]++;
  return { listes, categories };
}

// --- the old addresses ---------------------------------------------------------------------------

/** Where an old address now opens (replaceState, nothing drawn before): « Chiffres et classements »
 * its first ranking, the companies; the old search of documents (/registre/?t=…&d=…&y=…&p=…&q=…)
 * the list of its first kind (the contracts without one) with its filters. The summary's own
 * search (/registre/?q=…) stays. */
export function redirection(r: Route): string | null {
  if (r.view === "chiffres") return "/registre/entreprises";
  if (r.view !== "registre") return null;
  const q = r.q;
  if (!["t", "d", "y", "p", "tri"].some((k) => q[k])) return null;
  const first = (s?: string) => (s ?? "").split(",").filter(Boolean)[0] ?? "";
  const liste = LISTE_KIND[first(q.t) as Kind] ?? "contrats";
  const def = DEFS[liste];
  const e: Etat = {
    tri: q.tri === "montant" ? "amt" : def.tris[0].k,
    dir: -1,
    q: q.q ?? "",
    f: {},
  };
  for (const [k, old] of [
    ["dep", "d"],
    ["annee", "y"],
    ["disp", "p"],
  ] as const) {
    const v = first(q[old]);
    if (v && def.filtres.includes(k) && valeurs(k).includes(v)) e.f[k] = v;
  }
  return adresse(def, e);
}

// --- the search across the register ---------------------------------------------------------------

/** A result: its type, its id, its name, a few words about it, its fiche. */
export type Trouve = { type: TypeCle; id: string; nom: string; detail: string; href: string };
/** The results of one type (or one list), the first few, how many, where to see them all. */
export type Groupe = { k: TypeCle; n: number; rows: Trouve[]; tout: string };

const ORDRE: TypeCle[] = [
  "commune",
  "epci",
  "departement",
  "acheteur",
  "entreprise",
  "con",
  "mod",
  "ao",
  "aut",
  "sub",
];
const TYPES = new Set<string>([...ORDRE, "registre"]);

/** The register's search through the build's API (R3: GET /api/registre/recherche?q=, answering
 * { resultats: [{ type, id, nom, detail, href }] }). null when it does not answer as such (no API,
 * the dev server's page, a timeout): the page then searches recherche.json and asks the API no more. */
let sansApi = false;
export async function chercherApi(
  q: string,
  doFetch: typeof fetch = fetch,
): Promise<Trouve[] | null> {
  if (sansApi) return null;
  try {
    const r = await doFetch(`/api/registre/recherche?${new URLSearchParams({ q })}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok || !/json/.test(r.headers.get("content-type") ?? "")) throw new Error("no api");
    const j = (await r.json()) as { resultats?: unknown };
    if (!Array.isArray(j.resultats)) throw new Error("no api");
    return j.resultats.filter(
      (x): x is Trouve =>
        !!x &&
        typeof x === "object" &&
        TYPES.has((x as Trouve).type) &&
        typeof (x as Trouve).nom === "string" &&
        typeof (x as Trouve).href === "string" &&
        (x as Trouve).href.startsWith("/registre/"),
    );
  } catch {
    sansApi = true;
    return null;
  }
}

/** The same search over recherche.json: names that contain the words (a commune whose name starts
 * so first), documents whose words do. */
export function chercherLocal(C: Corpus, q0: string): Trouve[] {
  const q = plain(q0.trim());
  if (q.length < 2) return [];
  const R = C.R;
  const out: Trouve[] = [];
  const debut = (s: string) => (plain(s).startsWith(q) ? 0 : 1);
  const coms = Object.entries(R.communes)
    .filter(([, c]) => plain(c.nom).includes(q))
    .sort(
      ([a, x], [b, y]) =>
        debut(x.nom) - debut(y.nom) ||
        (C.fig.coms[b]?.docs ?? 0) - (C.fig.coms[a]?.docs ?? 0) ||
        x.nom.localeCompare(y.nom, "fr"),
    );
  for (const [insee, c] of coms)
    out.push({
      type: "commune",
      id: insee,
      nom: c.nom,
      detail: `${nomDep(C, c.dep)} · ${count(C.fig.coms[insee]?.docs ?? 0, "document")}`,
      href: communeHref(insee),
    });
  for (const r of rangs(C, "intercommunalites"))
    if (R.acheteurs[r.id] && plain(r.nom).includes(q))
      out.push({
        type: "epci",
        id: r.id,
        nom: r.nom,
        detail: count(Number(r.v.communes), "commune"),
        href: `/registre/acheteur/${r.id}`,
      });
  for (const [code, d] of Object.entries(C.couverture.departements))
    if (plain(d.nom ?? "").includes(q) || code === q)
      out.push({
        type: "departement",
        id: code,
        nom: nomDep(C, code),
        detail: code,
        href: `/registre/departement/${code}`,
      });
  const buyers = (Object.entries(R.acheteurs) as [string, AcheteurX][])
    .filter(
      ([, a]) =>
        a.categorie !== "commune" &&
        !EPCI.has(a.categorie ?? "") &&
        (a.nom || a.nom_court) &&
        plain(`${a.nom ?? ""} ${a.nom_court ?? ""}`).includes(q),
    )
    .sort(([a], [b]) => (C.fig.buyers[b]?.n ?? 0) - (C.fig.buyers[a]?.n ?? 0));
  for (const [s, a] of buyers)
    out.push({
      type: "acheteur",
      id: s,
      nom: a.nom_court || a.nom || s,
      detail: `${motCategorie(a, !!C.fig.buyers[s]?.centrale)} · ${count(C.fig.buyers[s]?.n ?? 0, "contrat")}`,
      href: `/registre/acheteur/${s}`,
    });
  const ents = Object.entries(R.entreprises)
    .filter(([s, x]) => s !== EI && !x.entrepreneur_individuel && x.nom && plain(x.nom).includes(q))
    .sort(([a], [b]) => (C.fig.ents[b]?.n ?? 0) - (C.fig.ents[a]?.n ?? 0));
  for (const [s] of ents)
    out.push({
      type: "entreprise",
      id: s,
      nom: entName(R, s),
      detail: count(C.fig.ents[s]?.n ?? 0, "contrat"),
      href: `/registre/entreprise/${s}`,
    });
  const docs = C.docs
    .filter((d) => d.k !== "?" && d.words.includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const d of docs)
    out.push({
      type: d.k as TypeCle,
      id: d.id,
      nom: d.title,
      detail: [date(d.e), d.com || nomDep(C, d.e.dep ?? "")].filter(Boolean).join(" · "),
      href: d.href,
    });
  return out;
}

/** The results by type, in the summary's order: the first `par` of each, how many, and the list
 * that shows them all (filtered by the same words). */
export function grouper(res: Trouve[], q: string, par = 4): Groupe[] {
  const by = new Map<TypeCle, Trouve[]>();
  for (const r of res) by.set(r.type, [...(by.get(r.type) ?? []), r]);
  return ORDRE.filter((k) => by.get(k)?.length).map((k) => {
    const rows = by.get(k) ?? [];
    const base = listeHref(k);
    return {
      k,
      n: rows.length,
      rows: rows.slice(0, par),
      tout: base === "/registre/" ? base : `${base}?${new URLSearchParams({ q: q.trim() })}`,
    };
  });
}

/** A result as a typed link (the pictogram alone, it is a list). */
export const lienTrouve = (r: Trouve): RichItem => lien(r.type, r.href || null, r.nom, true);
