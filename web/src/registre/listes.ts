// The register's lists, one per type (design/registre/v2, V2-Liste), and what the summary reads of
// them (V2-Sommaire): each list's rows, its sort keys, its filters, its count; the search across the
// register; the old addresses that now open a list. The lists of names (communes,
// intercommunalities, départements, buyers, companies) are listes.json's rows, every one, filtered
// and sorted here; the lists of documents and the documents the summary's search finds are the
// search API's (GET /api/registre/recherche, lot R3: all of France does not fit in one file),
// page by page, filtered, counted and sorted by it. The counts of every list are the build's
// (index.json and listes.json `comptes`): the function that writes a list's rows counts them. The
// figures and rules are those of « Chiffres et classements » (a contract counted once, an amount
// the build counts, `compte`), now computed by the build (recherche.py listes).

import {
  badge,
  benef,
  buyerOf,
  DISPS,
  depNom,
  entName,
  type Index,
  type Kind,
  type Lexique,
  type Ligne,
  ligne,
} from "./corpus.ts";
import type { Rich, RichItem } from "./dc.ts";
import type { Acheteur, Couverture, Evenement } from "./donnees.ts";
import { count, fr, money, shortDate } from "./format.ts";
import { has, t } from "./i18n.ts";
import {
  departementDans,
  departementHref,
  lien,
  lienAcheteur,
  lienCommune,
  lienDepartement,
  lienDocument,
  lienEntreprise,
  phrase,
} from "./liens.ts";
import type { Miette } from "./modale.ts";
import { LISTES, type Liste, type Route } from "./routes.ts";
import { signaler } from "./signaler.ts";
import { montantA } from "./socle-a.ts";
import { plain, tidy, titleCase } from "./texte.ts";
import { pluriel, type TypeCle } from "./types.ts";
import { appareils } from "./vues/commune-outils.ts";
import { couvertureActes, lecture } from "./vues/comparer-a.ts";

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

/** A list's name, the rail's, for its title and for its step of the breadcrumb (v2.3: one name per
 * type): « Titulaires » for the companies, a buyers' category for its buyers. */
export function nomListe(liste: Liste, cat?: string | null): string {
  // theme A (boards Accueil and Liste-Entreprises): « Entreprises », the title and the breadcrumb
  if (liste === "entreprises") return t("liste.a.titre.entreprises");
  if (liste === "acheteurs" && cat && (CATS as readonly string[]).includes(cat))
    return t(cat === "autres" ? "liste.rail_autres" : `liste.cat.${cat}`);
  return pluriel(TYPE_DE[liste]);
}

/** The breadcrumb's step of a fiche's list (« Registre › Transports › Sytral »): its rail name, and
 * an address that reopens the list on the fiche's row (?ligne=, liste.ts); a buyer's category, a
 * document's département (its list then holds a few hundred rows at most, reached in pages). */
export function etapeListe(
  k: TypeCle,
  ligne?: string | null,
  f: { cat?: string | null; dep?: string | null } = {},
): Miette {
  const liste = LISTE_DE[k];
  if (!liste) return { k: "registre", l: t("types.registre.l"), href: "/registre/" };
  const p = new URLSearchParams();
  if (liste === "acheteurs" && f.cat) p.set("cat", f.cat);
  if (DEFS[liste].kind && f.dep) p.set("dep", f.dep);
  if (ligne) p.set("ligne", ligne);
  const s = p.toString();
  return { k, l: nomListe(liste, f.cat), href: `/registre/${liste}${s ? `?${s}` : ""}` };
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
 * four categories; a buyer without category (an unnamed entry of the dictionary) is in none. The
 * build groups them the same way (recherche.py LISTE_CAT). */
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

export type Comptes = { listes: Record<Liste, number>; categories: Record<Cat, number> };

/** listes.json (recherche.py listes): every row of the lists of names by its id, its figures as
 * the build counts them, the names the rows need with their references, every list's count. */
export type Listes = {
  v: number;
  maj: string;
  lignes: {
    communes: Record<
      string,
      {
        docs: number;
        con: number;
        cam: number;
        dr: number;
        carte?: number | null;
        /** the contracts the commune signed itself, € (A, 07/11); 0: none in its name */
        amt?: number;
        /** its drone days over the 12 months to the update */
        jv?: number;
      }
    >;
    acheteurs: Record<string, { n: number; amt: number; ents: number; centrale: boolean }>;
    entreprises: Record<
      string,
      { n: number; clientes: number; amt: number; y0: string; deps: Record<string, number> }
    >;
    departements: Record<
      string,
      {
        n: number;
        con: number;
        aut: number;
        amt: number;
        carte?: number;
        cam?: number;
        dr?: number;
      }
    >;
  };
  comptes: Comptes;
  dico: Lexique;
};

/** What the lists of names read: listes.json's names and rows, the coverage, the update day. */
export type Corpus = { L: Lexique; X: Listes["lignes"]; couverture: CouvertureX; maj: string };
export const corpus = (X: Listes, couverture: CouvertureX): Corpus => ({
  L: X.dico,
  X: X.lignes,
  couverture,
  maj: X.maj,
});

/** A département's name: the build's (couverture.json), else the catalogue's, else its code. */
export const nomDep = (C: Pick<Corpus, "couverture">, code: string): string =>
  C.couverture.departements[code]?.nom ?? depNom(code);

// --- a list's rows ----------------------------------------------------------------------------

export type Filtre =
  | "dep"
  | "cat"
  | "annee"
  | "disp"
  | "etat"
  | "drones"
  | "taille"
  | "epci"
  | "naf"
  | "depuis";
export const FILTRES: Filtre[] = [
  "cat",
  "etat",
  "taille",
  "dep",
  "epci",
  "naf",
  "depuis",
  "annee",
  "disp",
  "drones",
];
/** The filters whose values are several at once (« 69,13 ») and chosen in a menu (theme A's
 * « Département ▾ », « Intercommunalité ▾ », « Métier ▾ », « Depuis ▾ »; « Année ▾ », Ju 10/11:
 * the years were a row of keys). */
export const MENUS: Filtre[] = ["dep", "epci", "naf", "depuis", "annee"];

/** A row: its name (a typed link, the pictogram alone), the line under it, its other cells, what
 * its filters, its sort keys and its CSV read. */
export type Rang = {
  id: string;
  nom: string;
  lien: RichItem;
  /** the line under the name: words, and the fiches it names as links */
  sous: Rich;
  /** a document's own links: its source (« Voir l'arrêté »), « Signaler une erreur » (DECISIONS
   * 2026-10-28 and 29), shown in the list's detail panel, never on each row (v2.1 B4) */
  liens?: { l: string; href: string }[];
  /** a document's record, for the list's detail panel */
  e?: Evenement;
  /** the départements' chips (Entreprises) */
  deps?: string[];
  cells: Rich[];
  mots: string;
  f: Partial<Record<Filtre, string[]>>;
  v: Record<string, number | string>;
  csv: Record<string, string | number>;
};

/** A column after the name: its words, numeric or not, the sort key its head picks. */
export type Colonne = {
  l: string;
  /** its key (« documents »): a figure named on a phone (liste.nomme.<cle>, v2.3) */
  cle?: string;
  num?: boolean;
  tri?: string;
  deps?: boolean;
  /** the head's sentence when it does not read alone (v2.1 A6) */
  aide?: string;
  /** other sort keys the column stands for (theme A: « € par habitant » shows in « Argent
   * public », « Caméras sur la carte » in « Caméras pour 1 000 hab. ») */
  alt?: string[];
};
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
  /** a list of names: its rows from listes.json */
  rangs?(C: Corpus): Rang[];
  /** a list of documents: its kind, its rows the search API's (pageDocuments) */
  kind?: Kind;
  /** the list's own order when it is not its first sort key (theme A: the boards' order of
   * « Classer par » kept, communes by cameras per 1 000 inhabitants, companies by amount) */
  defaut?: string;
  /** filters on when the address says none (board Liste-Communes-A: « 20 000 à 100 000 », a ratio
   * of cameras ranks villages of a few dozen people first otherwise); « toutes » in the address
   * lifts it */
  filtresDefaut?: Partial<Record<Filtre, string>>;
};
/** The address's word for a default filter lifted (« ?taille=toutes »). */
export const TOUTES = "toutes";

const W = (k: string) => t(`liste.${k}`);
const tri = (k: string, l: string, dir: 1 | -1 = -1): Tri => ({ k, l: W(`tri.${l}`), dir });
const col = (l: string, x: Partial<Colonne> = {}): Colonne => ({
  l: W(`col.${l}`),
  cle: l,
  ...x,
});
const csvCol = (k: string): [string, string] => [k, W(`csv.${k}`)];
/** « — »: a figure the register does not have (no commune, no year, no amount on a document). */
const NA = "—";
/** « non lu » (v2.3): a figure the register does not read yet (the decrees of a département it does
 * not collect), as a dashed mark; a true zero stays « 0 ». */
export const nonLu = (): Rich => [{ span: t("liste.non_lu"), cls: "nonlu" }];

/** The line over a list whose rows say « non lu » (v2.3), once: « le registre ne lit encore que
 * les arrêtés du Rhône ; contrats : toute la France. » */
export function noteNonLu(C: Pick<Corpus, "couverture">): RichItem[] | null {
  const codes = [...collectes(C)].sort();
  if (!codes.length) return null;
  // each département a link to its fiche (« du Rhône »: the article words, the name the link)
  const des = codes.map((d) =>
    departementDans(d, has(`registre.departement.du_${d}`) ? t(`departement.du_${d}`) : d),
  );
  const mots = new Intl.ListFormat("fr", { type: "conjunction" })
    .formatToParts(codes)
    .map((p) => (p.type === "element" ? des[codes.indexOf(p.value)] : p.value));
  return phrase("liste.non_lu_note", { des: { span: mots, cls: "" } });
}

function collectes(C: Pick<Corpus, "couverture">): Set<string> {
  return new Set(
    Object.entries(C.couverture.departements)
      .filter(([, d]) => d.etat === "collecte")
      .map(([k]) => k),
  );
}

/** A commune's size (theme A's « Taille »), by its inhabitants. */
export const TAILLES = ["100k", "20k", "5k", "0"] as const;
export function taille(pop: number | undefined): string {
  const p = pop ?? 0;
  return p >= 100000 ? "100k" : p >= 20000 ? "20k" : p >= 5000 ? "5k" : "0";
}

function rangsCommunes(C: Corpus): Rang[] {
  const lus = collectes(C);
  return Object.entries(C.X.communes).map(([insee, c]) => {
    const x = C.L.communes[insee];
    // the build's reading of each family (comparer-a.ts couvertureActes, recette 01): never a 0
    // where the commune's acts are not read
    const lu = lecture(
      couvertureActes({
        insee,
        dep: x.dep,
        etat: lus.has(x.dep) ? "collecte" : undefined,
        X: { lignes: C.X, dico: C.L } as never,
      }),
    );
    const carte = c.carte ?? null;
    const pop = x.pop ?? 0;
    const p1000 = carte != null && pop > 0 ? (1000 * carte) / pop : -1;
    const amt = c.amt ?? 0;
    const eph = amt > 0 && pop > 0 ? amt / pop : -1;
    const epci = x.epci ?? "";
    const nomEpci = epci ? (C.L.epcis?.[epci]?.nom ?? C.L.acheteurs[epci]?.nom ?? "") : "";
    const v = (n: string) => ({ span: n, cls: "v" });
    const sub = (n: string) => ({ span: n, cls: "sub" });
    return {
      id: insee,
      nom: x.nom,
      lien: { a: { href: x.ref ? `/registre/${x.ref}` : "", text: x.nom, cls: "ent com" } },
      // every mention that has its fiche a link (the owner's rule): its département, its
      // intercommunality when it buys
      sous: [
        { a: { href: departementHref(x.dep), text: nomDep(C, x.dep) } },
        ` (${x.dep})`,
        ...(nomEpci
          ? [
              " · ",
              (C.L.epcis?.[epci]?.ref ?? C.L.acheteurs[epci]?.ref)
                ? {
                    a: {
                      href: `/registre/${C.L.epcis?.[epci]?.ref ?? C.L.acheteurs[epci]?.ref}`,
                      text: nomEpci,
                    },
                  }
                : nomEpci,
            ]
          : []),
      ] as RichItem[],
      cells: [
        pop ? fr(pop) : NA,
        p1000 < 0
          ? NA
          : [
              v(p1000.toFixed(1).replace(".", ",")),
              sub(t("liste.a.cameras_n", { n: fr(carte ?? 0) })),
            ],
        amt > 0
          ? [v(montantA(amt)), sub(t("liste.a.eph", { n: fr(eph) }))]
          : [v(NA), sub(t("liste.a.aucun_contrat"))],
        fr(c.con),
        lu.cam ? fr(c.cam) : nonLu(),
        lu.dr ? (c.dr ? fr(c.dr) : NA) : nonLu(),
      ],
      mots: plain(`${x.nom} ${nomDep(C, x.dep)} ${nomEpci}`),
      f: {
        dep: [x.dep],
        drones: lu.dr && c.dr > 0 ? ["1"] : [],
        taille: [taille(pop)],
        epci: epci ? [epci] : [],
      },
      v: {
        docs: c.docs,
        con: c.con,
        aut: lu.cam ? c.cam : -1,
        dr: lu.dr ? c.dr : -1,
        carte: carte ?? -1,
        pop,
        p1000,
        amt,
        eph,
        nom: x.nom,
      },
      csv: {
        id: insee,
        departement: x.dep,
        habitants: pop || "",
        documents: c.docs,
        contrats: c.con,
        montant: amt || "",
        autorisations: lu.cam ? c.cam : "",
        drones: lu.dr ? c.dr : "",
        carte: carte ?? "",
      },
    };
  });
}

/** The intercommunalities of the register's communes (each commune's `epci`): named by the build
 * (listes.json `dico.epcis`, France's reference), a fiche only for one that buys (its buyer's). */
function rangsEpci(C: Corpus): Rang[] {
  const by = new Map<string, string[]>();
  for (const insee of Object.keys(C.X.communes)) {
    const e = C.L.communes[insee]?.epci;
    if (!e) continue;
    by.set(e, [...(by.get(e) ?? []), insee]);
  }
  return [...by].map(([siren, coms]) => {
    const a = C.L.acheteurs[siren];
    const nom = a?.nom_court || C.L.epcis?.[siren]?.nom || a?.nom || "";
    const label = nom || t("liste.epci_siren", { siren });
    const noms = coms.map((k) => C.L.communes[k].nom).sort((x, y) => x.localeCompare(y, "fr"));
    const deps = [...new Set(coms.map((k) => C.L.communes[k].dep))];
    const b = C.X.acheteurs[siren];
    return {
      id: siren,
      nom: label,
      lien: a?.ref ? lienAcheteur(C.L, siren, nom || label, true) : lien("epci", null, label, true),
      sous: [
        ...coms
          .slice()
          .sort((x, y) => C.L.communes[x].nom.localeCompare(C.L.communes[y].nom, "fr"))
          .slice(0, 3)
          .flatMap((k, i) => [...(i ? [", "] : []), lienCommune(C.L, k, undefined, true)]),
        ...(noms.length > 3 ? ["…"] : []),
        // its row leads to its fiche, or to nothing, and says so (v2.3)
        ...(a?.ref ? [] : [` · ${t("liste.epci_sans_fiche")}`]),
      ],
      cells: [fr(coms.length), fr(b?.n ?? 0), money(b?.amt ?? 0)],
      mots: plain(`${label} ${noms.join(" ")}`),
      f: { dep: deps },
      v: { communes: coms.length, con: b?.n ?? 0, amt: b?.amt ?? 0, nom: label },
      csv: {
        id: siren,
        departement: deps.join(" "),
        communes: coms.length,
        contrats: b?.n ?? 0,
        montant: b?.amt ?? "",
      },
    };
  });
}

/** Etat label of a département's decrees (couverture.json). */
function etatDep(C: Pick<Corpus, "couverture">, code: string): string {
  const d = C.couverture.departements[code];
  if (!d) return "";
  if (d.etat === "collecte") return t("couverture.etat_collecte");
  if (d.etat === "impossible") return t("couverture.etat_impossible_court");
  return t("couverture.etat_non_collecte_court");
}

function rangsDepartements(C: Corpus): Rang[] {
  const coms: Record<string, number> = {};
  // a département with drone decrees: one of its communes has some (the lists count none of
  // their own for a département)
  const drones = new Set<string>();
  for (const insee of Object.keys(C.X.communes)) {
    const d = C.L.communes[insee].dep;
    coms[d] = (coms[d] ?? 0) + 1;
    if ((C.X.communes[insee]?.dr ?? 0) > 0) drones.add(d);
  }
  return Object.entries(C.couverture.departements).map(([code, d]) => {
    const o = C.X.departements[code] ?? { n: 0, con: 0, aut: 0, amt: 0 };
    const nom = nomDep(C, code);
    const ok = d.etat === "collecte";
    return {
      id: code,
      nom,
      lien: lienDepartement(code, nom, true),
      sous: `${code} · ${t("liste.arretes_etat", { etat: etatDep(C, code) })}`,
      cells: [fr(coms[code] ?? 0), fr(o.n), fr(o.con), money(o.amt ?? 0), ok ? fr(o.aut) : nonLu()],
      mots: plain(`${code} ${nom}`),
      f: { etat: [d.etat], drones: ok && drones.has(code) ? ["1"] : [] },
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
  for (const [s, a] of Object.entries(C.L.acheteurs) as [string, AcheteurX][]) {
    const cat = catAcheteur(a);
    if (!cat) continue;
    const b = C.X.acheteurs[s];
    const nom = a.nom_court || a.nom || s;
    const dep = a.dep ?? "";
    const catMot = motCategorie(a, !!b?.centrale);
    out.push({
      id: s,
      nom,
      lien: lienAcheteur(C.L, s, nom, true),
      sous: dep ? [`${catMot} · `, lienDepartement(dep, nomDep(C, dep), true)] : catMot,
      cells: [fr(b?.n ?? 0), b?.amt ? money(b.amt) : NA, fr(b?.ents ?? 0)],
      mots: plain(`${a.nom ?? ""} ${a.nom_court ?? ""} ${catMot}`),
      f: { cat: [cat], dep: dep ? [dep] : [] },
      v: { con: b?.n ?? 0, amt: b?.amt ?? 0, ents: b?.ents ?? 0, nom },
      csv: {
        id: s,
        categorie: a.categorie ?? "",
        departement: dep,
        contrats: b?.n ?? 0,
        montant: b?.amt ?? "",
        entreprises: b?.ents ?? 0,
      },
    });
  }
  return out;
}

function rangsEntreprises(C: Corpus): Rang[] {
  return Object.entries(C.X.entreprises).map(([siren, o]) => {
    const nom = entName(C.L, siren);
    const x = C.L.entreprises[siren] as { naf?: string; naf_libelle?: string | null } | undefined;
    const naf = x?.naf_libelle ?? "";
    const deps = Object.entries(o.deps)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k);
    const y0 = o.y0 === "9999" ? "" : o.y0;
    const noms = deps.slice(0, 2);
    const ref = (C.L.entreprises[siren] as { ref?: string } | undefined)?.ref;
    return {
      id: siren,
      nom,
      lien: ref ? { a: { href: `/registre/${ref}`, text: nom, cls: "ent" } } : nom,
      sous: naf,
      cells: [
        o.amt ? [{ span: montantA(o.amt), cls: "v" }] : NA,
        fr(o.n),
        fr(o.clientes),
        [
          { span: fr(deps.length), cls: "v" },
          ...(noms.length
            ? [
                {
                  span: [
                    ...deps
                      .slice(0, 2)
                      .flatMap((d, i): RichItem[] => [
                        ...(i ? [", "] : []),
                        { a: { href: departementHref(d), text: nomDep(C, d) } },
                      ]),
                    ...(deps.length > 2 ? ["…"] : []),
                  ],
                  cls: "sub",
                },
              ]
            : []),
        ],
        y0 || NA,
      ],
      mots: plain(`${nom} ${naf} ${siren}`),
      f: { dep: deps, naf: x?.naf ? [x.naf] : [], depuis: y0 ? [y0] : [] },
      v: { n: o.n, cl: o.clientes, amt: o.amt, nd: deps.length, y: y0 || "9999", nom },
      csv: {
        id: siren,
        activite: naf,
        departements: deps.join(" "),
        contrats: o.n,
        clientes: o.clientes,
        montant: o.amt || "",
        depuis: y0,
      },
    };
  });
}

/** A beneficiary published by its name alone (« Roissy-en-Brie », « Commune de Mions »): the commune
 * of its département so named, a link, when there is exactly one; else its words. */
function communeNommee(L: Lexique, dep: string | null | undefined, nom: string): RichItem {
  const n = nom
    .replace(/^(commune|ville|mairie)\s+(de\s+|d['’]\s*)?/i, "")
    .trim()
    .toLowerCase();
  const ks = Object.entries(L.communes).filter(
    ([, c]) => (!dep || c.dep === dep) && c.nom.toLowerCase() === n,
  );
  return ks.length === 1 ? lienCommune(L, ks[0][0], nom, true) : nom;
}

/** A document's « qui »: its buyer (a link), a decree's beneficiary, a subsidy's. */
function qui(L: Lexique, d: Ligne): RichItem {
  const e = d.e;
  if (d.k === "aut") {
    // a decree's beneficiary: its fiche when it is a buyer the register holds (a mairie: its commune)
    const s = e.beneficiaire_siren;
    return s && L.acheteurs[s] && e.nom_publie !== false
      ? lienAcheteur(L, s, benef(e), true)
      : communeNommee(L, e.dep, benef(e));
  }
  if (d.k === "sub") {
    const nom =
      e.nom_publie === false
        ? t("commun.nom_non_publie")
        : tidy(titleCase(String(e.beneficiaire ?? "")));
    const s = e.beneficiaire_siren;
    return s && L.acheteurs[s] && e.nom_publie !== false
      ? lienAcheteur(L, s, nom, true)
      : e.nom_publie === false
        ? nom
        : communeNommee(L, e.dep, nom);
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
function entreprises(L: Lexique, d: Ligne): Rich {
  const xs = d.e.entreprises ?? [];
  if (!xs.length) return NA;
  const out: RichItem[] = [];
  xs.forEach((s, i) => {
    if (i) out.push(", ");
    out.push(lienEntreprise(L, s, undefined, true));
  });
  return out;
}

// --- a document's date, and which one it is (Ju 10/11) --------------------------------------------

/** A drone act's publication day (`publie`, its recueil's), the day the lists sort it by
 * (regles.sort_key); null when the build did not read it. */
export const publie = (e: Evenement): string | null =>
  e.t === "arrete_drone" ? ((e as { publie?: string | null }).publie ?? null) : null;

/** The day a document is ordered by: a drone act's publication, any other document's date (a
 * subsidy dated by its year at its year's start), as the search API orders them. */
export const cleDate = (e: Evenement): string =>
  publie(e) ?? (e.date_annee ? `${(e.date ?? "").slice(0, 4)}-00-00` : (e.date ?? ""));

/** A document's date said with what it is: a contract « signé le » (DECP's notification), a
 * notice « publié le » (BOAMP's publication), a camera decree « arrêté du » (its day, else its
 * recueil's), a region's subsidy « votée le », one dated by its year « en 2024 »; a drone act
 * « publié le 8 nov. 2026 · vol le 9 nov. 2026 » (its recueil, its first flight day), its flight
 * left out when `court`. */
export function dateDite(e: Evenement, court = false): string {
  const P = publie(e);
  if (e.t === "arrete_drone") {
    const vol = e.date ? t("liste.date.vol", { date: shortDate(e.date) }) : "";
    if (!P) return vol;
    const pub = t("liste.date.publie", { date: shortDate(P) });
    return court || !vol ? pub : `${pub} · ${vol}`;
  }
  if (!e.date) return "";
  if (e.date_annee) return t("liste.date.annee", { an: e.date.slice(0, 4) });
  return t(`liste.date.${quelleDate(e)}`, { date: shortDate(e.date) });
}

/** Which date a document's is (the key of « publié le », « signé le »…): a drone act's the
 * publication when read, else its flight. */
export function quelleDate(
  e: Evenement,
): "publie" | "vol" | "signe" | "arrete" | "votee" | "annee" | "du" {
  if (e.t === "arrete_drone") return publie(e) ? "publie" : "vol";
  if (e.date_annee) return "annee";
  if (e.t === "attribution" || e.t === "modification") return "signe";
  if (/^(avis|resultat|rectificatif)$/.test(e.t)) return "publie";
  if (e.t === "arrete") return "arrete";
  return e.t === "subvention_region" ? "votee" : "du";
}

/** A document as a row of its list (the search API's page: its names in `L`). */
export function rangDocument(L: Lexique, C: Pick<Corpus, "couverture">, e: Evenement): Rang {
  const d = ligne(L, e);
  const k = d.k as Kind;
  const zone = t("arretes.zone_non_deduite");
  const where: Rich =
    e.insee && L.communes[e.insee]
      ? [lienCommune(L, e.insee, undefined, true)]
      : e.dep
        ? [lienDepartement(e.dep, nomDep(C, e.dep), true)]
        : NA;
  const cams = e.cameras ?? null;
  // a decree of drones or body cameras counts its devices, with their word (« 2 drones »,
  // v2.1 B4); the act's own words when it gives no number (« non précisé »)
  const amount: Rich =
    k !== "aut"
      ? money(e.montant)
      : cams == null
        ? e.cameras_lib && e.t !== "arrete"
          ? String(e.cameras_lib)
          : NA
        : e.t === "arrete"
          ? fr(cams)
          : appareils(e);
  const cells: Rich[] =
    k === "aut" || k === "sub"
      ? [where, [qui(L, d)], amount]
      : [where, [qui(L, d)], entreprises(L, d), amount];
  // a correction accepted in /revue says so where the document is listed (DECISIONS 2026-10-29)
  const le = Object.values((e.corrige ?? {}) as Record<string, { le?: string }>)
    .map((x) => x?.le ?? "")
    .filter(Boolean)
    .sort()
    .pop();
  // a decree from another département's or a zone's préfecture says where it comes from (v2.3)
  const prov = typeof e.provenance === "string" && e.provenance !== "collecte" ? e.provenance : "";
  const sous = [
    dateDite(e) + (e.date_lue ? "*" : ""),
    prov && has(`registre.sommaire.par_source.provenance.${prov}`)
      ? t("liste.provenance", { p: t(`sommaire.par_source.provenance.${prov}`) })
      : "",
    e.non_lu?.includes("zone_non_deduite") ? zone : "",
    le ? t("corrige.le", { date: le.split("-").reverse().join("/") }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id: e.id,
    nom: d.title,
    lien: lienDocument(L, e, d.title, true),
    sous,
    liens: [
      ...(e.url ? [{ l: k === "aut" ? t("arretes.voir") : t("liste.source"), href: e.url }] : []),
      signaler(e),
    ],
    e,
    cells,
    mots: d.words,
    // the filters and the sorts are the search API's
    f: {},
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
      aut
        ? col("cameras", { num: true, tri: "amt", aide: W("aide.cameras") })
        : col("montant", { num: true, tri: "amt", aide: W("aide.montant") }),
    ],
    tris: [tri("date", "date"), aut ? tri("amt", "cameras") : tri("amt", "montant")],
    filtres: ["dep", "annee", ...(k === "ao" ? [] : (["disp"] as Filtre[]))],
    argent: k === "con" || k === "mod",
    csv: [...DOC_CSV, aut ? "cameras" : "montant", "reference", "url"].map(csvCol),
    kind: k,
  };
}

/** Every list: its columns, its sort keys (the first is the list's own order), its filters. */
export const DEFS: Record<Liste, Def> = {
  get communes(): Def {
    const A = (k: string) => t(`liste.a.${k}`);
    return {
      liste: "communes",
      k: "commune",
      nom: A("col.commune"),
      cols: [
        { l: A("col.habitants"), cle: "habitants", num: true, tri: "pop" },
        { l: A("col.p1000"), cle: "p1000", num: true, tri: "p1000", alt: ["carte"] },
        { l: A("col.argent"), cle: "argent", num: true, tri: "amt", alt: ["eph"] },
        { l: A("col.contrats"), cle: "contrats", num: true, tri: "con", aide: W("aide.contrats") },
        { l: A("col.arretes"), cle: "autorisations", num: true, tri: "aut" },
        { l: A("col.drones"), cle: "drones", num: true, tri: "dr" },
      ],
      tris: [
        { k: "carte", l: A("tri.carte"), dir: -1 },
        { k: "p1000", l: A("tri.p1000"), dir: -1 },
        { k: "amt", l: A("tri.amt"), dir: -1 },
        { k: "eph", l: A("tri.eph"), dir: -1 },
        { k: "aut", l: A("tri.aut"), dir: -1 },
        { k: "dr", l: A("tri.dr"), dir: -1 },
      ],
      defaut: "p1000",
      filtresDefaut: { taille: "20k" },
      filtres: ["taille", "dep", "epci"],
      argent: false,
      csv: [
        "departement",
        "habitants",
        "documents",
        "contrats",
        "montant",
        "autorisations",
        "drones",
        "carte",
      ].map(csvCol),
      rangs: rangsCommunes,
    };
  },
  get intercommunalites(): Def {
    return {
      liste: "intercommunalites",
      k: "epci",
      nom: W("col.epci"),
      cols: [
        col("communes", { num: true, tri: "communes", aide: W("aide.communes_epci") }),
        col("contrats_signes", { num: true, tri: "con", aide: W("aide.contrats") }),
        col("montant", { num: true, tri: "amt", aide: W("aide.montant") }),
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
        col("communes", { num: true, tri: "communes", aide: W("aide.communes_dep") }),
        col("documents", { num: true, tri: "docs", aide: W("aide.documents") }),
        col("contrats", { num: true, tri: "con", aide: W("aide.contrats") }),
        col("montant", { num: true, tri: "amt", aide: W("aide.montant") }),
        col("arretes", { num: true, tri: "aut", aide: W("aide.arretes") }),
      ],
      tris: [
        tri("docs", "documents"),
        tri("communes", "communes"),
        tri("con", "contrats"),
        tri("amt", "montant"),
        tri("nom", "nom", 1),
      ],
      filtres: ["etat", "drones"],
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
        col("contrats", { num: true, tri: "con", aide: W("aide.contrats") }),
        col("montant", { num: true, tri: "amt", aide: W("aide.montant") }),
        col("entreprises", { num: true, tri: "ents", aide: W("aide.entreprises") }),
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
    const A = (k: string) => t(`liste.a.${k}`);
    return {
      liste: "entreprises",
      k: "entreprise",
      nom: A("col.entreprise"),
      cols: [
        { l: A("col.montant"), cle: "montant", num: true, tri: "amt", aide: W("aide.montant") },
        { l: A("col.contrats_e"), cle: "contrats", num: true, tri: "n", aide: W("aide.contrats") },
        { l: A("col.clients"), cle: "clientes", num: true, tri: "cl", aide: W("aide.clientes") },
        { l: A("col.departements"), cle: "departements", num: true, tri: "nd" },
        { l: A("col.depuis"), cle: "depuis", num: true },
      ],
      tris: [
        { k: "amt", l: A("tri.montant"), dir: -1 },
        { k: "n", l: A("tri.contrats"), dir: -1 },
        { k: "cl", l: A("tri.clients"), dir: -1 },
        { k: "nd", l: A("tri.departements"), dir: -1 },
      ],
      filtres: ["dep", "naf", "depuis"],
      argent: false,
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

/** A list of names' rows, once per page and file. */
const rangsMemo = new WeakMap<Listes["lignes"], Partial<Record<Liste, Rang[]>>>();
export function rangs(C: Corpus, l: Liste): Rang[] {
  const def = DEFS[l];
  if (!def.rangs) return [];
  let m = rangsMemo.get(C.X);
  if (!m) {
    m = {};
    rangsMemo.set(C.X, m);
  }
  m[l] ??= def.rangs(C);
  return m[l];
}

// --- the filters -------------------------------------------------------------------------------

const YEARS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "<2018"];
/** The départements of France in their order (01 … 19, 2A, 2B, 21 … 95, then overseas): a list
 * shows those its rows have. */
export const DEPARTEMENTS = [
  ...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, "0")).flatMap((d) =>
    d === "20" ? ["2A", "2B"] : [d],
  ),
  "971",
  "972",
  "973",
  "974",
  "976",
];

/** A filter's values, in the keys' order. */
export function valeurs(f: Filtre): string[] {
  if (f === "dep") return DEPARTEMENTS;
  if (f === "taille") return [...TAILLES];
  if (f === "cat") return [...CATS];
  if (f === "annee") return YEARS;
  if (f === "disp") return DISPS;
  // « Avec arrêtés drones » (v2.4, mockup liste-communes-menu-departements): one value, on
  if (f === "drones") return ["1"];
  return ["collecte", "non_collecte", "impossible"];
}

/** A filter value's words on its key (« 69 », « État », « 2025 »). */
export function motValeur(f: Filtre, v: string): string {
  if (f === "dep") return v;
  if (f === "taille") return t(`liste.a.taille.${v}`);
  if (f === "cat") return W(`cat.${v}`);
  if (f === "annee") return v === "<2018" ? t("registre.annee_avant_2018") : v;
  if (f === "disp") return t(`registre.disp_${v}`);
  if (f === "drones") return t("liste.avec_drones");
  return W(`etat.${v}`);
}

// --- a list's state: its sort, its filters, its text; in the address ----------------------------

export type Etat = { tri: string; dir: 1 | -1; q: string; f: Partial<Record<Filtre, string>> };

/** A filter's values chosen: « 69,13 » the Rhône and the Bouches-du-Rhône (the départements). */
export const choisis = (v: string | undefined): string[] => (v ? v.split(",").filter(Boolean) : []);

/** The state an address says (?tri=…&ordre=…&dep=…&q=…); a value it does not know is dropped. */
/** A filter's value the address may hold: one of its values, or of its form for the filters whose
 * values are the data's (an intercommunality's SIREN, a NAF code, a year). */
const FORME: Partial<Record<Filtre, RegExp>> = {
  epci: /^\d{9}$/,
  naf: /^\d{2}\.\d{2}[A-Z]$/,
  depuis: /^\d{4}$/,
};
const valide = (k: Filtre, v: string): boolean =>
  FORME[k] ? (FORME[k] as RegExp).test(v) : valeurs(k).includes(v);
/** A list's own order: its `defaut`, else its first sort key. */
export const triDefaut = (def: Def): Tri => def.tris.find((x) => x.k === def.defaut) ?? def.tris[0];

export function etatDe(def: Def, q: Record<string, string>): Etat {
  const t0 = def.tris.find((x) => x.k === q.tri) ?? triDefaut(def);
  const dir = q.ordre === "asc" ? 1 : q.ordre === "desc" ? -1 : t0.dir;
  const f: Partial<Record<Filtre, string>> = {};
  for (const k of def.filtres) {
    const d = def.filtresDefaut?.[k];
    if (d && q[k] === undefined) {
      f[k] = d;
      continue;
    }
    // the départements, several at once (« 69,13 », v2.3); the other filters one value
    const vs = MENUS.includes(k) ? choisis(q[k]) : q[k] ? [q[k]] : [];
    const ok = vs.filter((v) => valide(k, v));
    if (ok.length) f[k] = ok.join(",");
  }
  return { tri: t0.k, dir, q: q.q ?? "", f };
}

/** The address of a list in a state: only what differs from the list's own order. */
export function adresse(def: Def, e: Etat): string {
  const p = new URLSearchParams();
  const t0 = def.tris.find((x) => x.k === e.tri) ?? triDefaut(def);
  if (t0 !== triDefaut(def)) p.set("tri", t0.k);
  if (e.dir !== t0.dir) p.set("ordre", e.dir > 0 ? "asc" : "desc");
  for (const k of def.filtres) {
    const d = def.filtresDefaut?.[k];
    if (d) {
      if (!e.f[k]) p.set(k, TOUTES);
      else if (e.f[k] !== d) p.set(k, e.f[k] as string);
    } else if (e.f[k]) p.set(k, e.f[k] as string);
  }
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
    def.filtres.every(
      (k) => k === skip || !e.f[k] || (r.f[k] ?? []).some((v) => choisis(e.f[k]).includes(v)),
    );
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

// --- a list of documents: the search API's ------------------------------------------------------

/** GET /api/registre/recherche's answer (pipeline/lacarte/api/registre.py). */
export type Page = {
  total: number;
  page: number;
  n: number;
  facettes: Record<"t" | "d" | "p" | "y", Record<string, number>>;
  par_type: Partial<Record<Kind, number>>;
  evenements: Evenement[];
  dico: Lexique;
};
/** A filter's family in the API. */
const FAMILLE: Partial<Record<Filtre, "d" | "y" | "p">> = { dep: "d", annee: "y", disp: "p" };
/** The most rows the API gives at once (its N_MAX). */
export const N_MAX = 500;

/** The API's question for a list of documents in a state, its page of `n` rows. */
export function question(def: Def, e: Etat, page: number, n: number): URLSearchParams {
  const p = new URLSearchParams();
  if (e.q.trim()) p.set("q", e.q.trim());
  if (def.kind) p.set("t", def.kind);
  for (const f of def.filtres) {
    const fam = FAMILLE[f];
    if (fam && e.f[f]) p.set(fam, e.f[f] as string);
  }
  if (e.tri === "amt") p.set("tri", "montant");
  if (e.dir > 0) p.set("ordre", "asc");
  p.set("page", String(page));
  p.set("n", String(n));
  return p;
}

/** One page of the search API; throws when it does not answer as such (no API, the dev server's
 * page, a timeout). */
export async function demander(p: URLSearchParams, doFetch: typeof fetch = fetch): Promise<Page> {
  const ask = () =>
    doFetch(`/api/registre/recherche?${p}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  let r = await ask();
  // the search busy for everyone (503, v2.3: a cap on the searches at once, no reader told apart):
  // once again after the pause it asks, 5 s at most
  if (r.status === 503) {
    const s = Math.min(5, Math.max(0, Number(r.headers.get("retry-after")) || 1));
    await new Promise((ok) => setTimeout(ok, s * 1000));
    r = await ask();
  }
  if (!r.ok || !/json/.test(r.headers.get("content-type") ?? "")) throw new Error("no api");
  const j = (await r.json()) as Page;
  if (!Array.isArray(j.evenements) || typeof j.total !== "number") throw new Error("no api");
  j.dico ??= { entreprises: {}, acheteurs: {}, communes: {} };
  return j;
}

/** A page's filters counted as a list counts them: each value without its own filter (the API's
 * facets), "" every value. */
export function comptesPage(def: Def, P: Page, e: Etat): Resultat["comptes"] {
  const out: Resultat["comptes"] = {};
  for (const f of def.filtres) {
    const fam = FAMILLE[f];
    if (!fam) continue;
    const c: Record<string, number> = { ...(P.facettes[fam] ?? {}) };
    c[""] = e.f[f] ? Object.values(c).reduce((a, b) => a + b, 0) : P.total;
    out[f] = c;
  }
  return out;
}

/** Two lexicons as one (a list's pages, each with the names its rows need). */
export function fondre(a: Lexique, b: Lexique): Lexique {
  return {
    entreprises: { ...a.entreprises, ...b.entreprises },
    acheteurs: { ...a.acheteurs, ...b.acheteurs },
    communes: { ...a.communes, ...b.communes },
    affaires: { ...(a.affaires ?? {}), ...(b.affaires ?? {}) },
  };
}

/** Every row of a list of documents in a state, page by page (the CSV): at most `max` rows. */
export async function toutDemander(
  def: Def,
  e: Etat,
  C: Pick<Corpus, "couverture">,
  max = 20_000,
  doFetch: typeof fetch = fetch,
): Promise<Rang[]> {
  const out: Rang[] = [];
  for (let page = 1; out.length < max; page++) {
    const P = await demander(question(def, e, page, N_MAX), doFetch);
    out.push(...P.evenements.map((x) => rangDocument(P.dico, C, x)));
    if (P.evenements.length < N_MAX || out.length >= P.total) break;
  }
  return out;
}

/** The list as a CSV file's text (the browser makes the file): its rank, name, then its columns,
 * the heads in the catalogue's words; every value quoted, an amount to the cent (a sum of amounts
 * carries the floats' dust: 91437049.75000001). */
/** A published text written into a CSV cell: one that a spreadsheet would take for a formula (=, +,
 * -, @, a tab or a return first) is kept as text by a leading apostrophe. */
export const sansFormule = (v: unknown): string => {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

export function csv(def: Def, list: Rang[]): string {
  const q = (v: unknown) =>
    `"${(typeof v === "number" ? String(Math.round(v * 100) / 100) : sansFormule(v)).replace(/"/g, '""')}"`;
  const head = [W("csv.rang"), def.nom, W("csv.id"), ...def.csv.map(([, l]) => l)];
  const lines = list.map((r, i) =>
    [i + 1, r.nom, r.csv.id ?? r.id, ...def.csv.map(([k]) => r.csv[k])].map(q).join(","),
  );
  return `﻿${head.map(q).join(",")}\r\n${lines.join("\r\n")}\r\n`;
}

// --- the counts the summary and the rail show ----------------------------------------------------

/** The counts the build writes (index.json `comptes`). */
export function comptesIndex(I: Index): Comptes | null {
  const c = (I as Index & { comptes?: Comptes }).comptes;
  return c?.listes && c.categories ? c : null;
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
const KINDS_ORDRE: Kind[] = ["con", "mod", "ao", "aut", "sub"];
/** The results shown of each type, then « Voir les N » (Ju 10/11: five at most). */
export const PAR_TYPE = 5;

/** A name's fiche, from its reference (only a fiche the build wrote has one). */
const parRef = (ref: string | undefined): string => (ref ? `/registre/${ref}` : "");

/** The names that contain the words (listes.json: a commune whose name starts so first), each with
 * its fiche; a name without a fiche is no result. */
export function chercherNoms(C: Corpus, q0: string): Trouve[] {
  const q = plain(q0.trim());
  if (q.length < 2) return [];
  const { L, X } = C;
  const out: Trouve[] = [];
  const debut = (s: string) => (plain(s).startsWith(q) ? 0 : 1);
  const coms = Object.keys(X.communes)
    .map((insee) => [insee, L.communes[insee]] as const)
    .filter(([, c]) => c?.ref && plain(c.nom).includes(q))
    .sort(
      ([a, x], [b, y]) =>
        debut(x.nom) - debut(y.nom) ||
        (X.communes[b]?.docs ?? 0) - (X.communes[a]?.docs ?? 0) ||
        x.nom.localeCompare(y.nom, "fr"),
    );
  for (const [insee, c] of coms)
    out.push({
      type: "commune",
      id: insee,
      nom: c.nom,
      detail: `${nomDep(C, c.dep)} · ${count(X.communes[insee]?.docs ?? 0, "document")}`,
      href: parRef(c.ref),
    });
  for (const r of rangs(C, "intercommunalites"))
    if (L.acheteurs[r.id]?.ref && plain(r.nom).includes(q))
      out.push({
        type: "epci",
        id: r.id,
        nom: r.nom,
        detail: count(Number(r.v.communes), "commune"),
        href: parRef(L.acheteurs[r.id].ref),
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
  const buyers = (Object.entries(L.acheteurs) as [string, AcheteurX][])
    .filter(
      ([, a]) =>
        a.ref &&
        a.categorie !== "commune" &&
        !EPCI.has(a.categorie ?? "") &&
        (a.nom || a.nom_court) &&
        plain(`${a.nom ?? ""} ${a.nom_court ?? ""}`).includes(q),
    )
    .sort(([a], [b]) => (X.acheteurs[b]?.n ?? 0) - (X.acheteurs[a]?.n ?? 0));
  for (const [s, a] of buyers)
    out.push({
      type: "acheteur",
      id: s,
      nom: a.nom_court || a.nom || s,
      detail: `${motCategorie(a, !!X.acheteurs[s]?.centrale)} · ${count(X.acheteurs[s]?.n ?? 0, "contrat")}`,
      href: parRef(a.ref),
    });
  const ents = Object.keys(X.entreprises)
    .filter((s) => L.entreprises[s]?.ref && plain(L.entreprises[s].nom ?? "").includes(q))
    .sort((a, b) => X.entreprises[b].n - X.entreprises[a].n);
  for (const s of ents)
    out.push({
      type: "entreprise",
      id: s,
      nom: entName(L, s),
      detail: count(X.entreprises[s].n, "contrat"),
      href: parRef(L.entreprises[s].ref),
    });
  return out;
}

/** A document found, as a result. */
function trouveDocument(L: Lexique, C: Pick<Corpus, "couverture">, e: Evenement): Trouve {
  const d = ligne(L, e);
  return {
    type: d.k as TypeCle,
    id: d.id,
    nom: d.title,
    detail: [dateDite(e, true), d.com || nomDep(C, e.dep ?? "")].filter(Boolean).join(" · "),
    href: d.href,
  };
}

/** The documents the words find, by kind (the search API: how many of each, the latest `par`):
 * null when the API does not answer. */
export async function chercherDocuments(
  q0: string,
  C: Pick<Corpus, "couverture">,
  par = PAR_TYPE,
  doFetch: typeof fetch = fetch,
): Promise<Groupe[] | null> {
  const q = q0.trim();
  if (plain(q).length < 2) return [];
  try {
    const all = await demander(new URLSearchParams({ q, n: "1" }), doFetch);
    const kinds = KINDS_ORDRE.filter((k) => (all.par_type[k] ?? 0) > 0);
    const pages = await Promise.all(
      kinds.map((k) => demander(new URLSearchParams({ q, t: k, n: String(par) }), doFetch)),
    );
    return kinds.map((k, i) => ({
      k: k as TypeCle,
      n: all.par_type[k] ?? 0,
      rows: pages[i].evenements.map((e) => trouveDocument(pages[i].dico, C, e)),
      tout: `${listeHref(k as TypeCle)}?${new URLSearchParams({ q })}`,
    }));
  } catch {
    return null;
  }
}

/** The results by type, in the summary's order: the first `par` of each, how many, and the list
 * that shows them all (filtered by the same words). */
export function grouper(res: Trouve[], q: string, par = PAR_TYPE): Groupe[] {
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

/** The names' groups and the documents', in the summary's order. */
export function ordonner(groupes: Groupe[]): Groupe[] {
  return groupes.slice().sort((a, b) => ORDRE.indexOf(a.k) - ORDRE.indexOf(b.k));
}

/** A result as a typed link (the pictogram alone, it is a list). */
export const lienTrouve = (r: Trouve): RichItem => lien(r.type, r.href || null, r.nom, true);
