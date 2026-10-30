// View 8 · Entreprise (/registre/entreprise/<siren>; mockup Entreprise-grand, the prototype's
// vues/entreprise.js), its logic apart from its template so that the tests read it. Without the
// scatter of amounts: in its place, the contracts running today and the largest ones. What a rule
// decides comes from the build (entreprise/<siren>.json): its contracts (a copy never), each one's
// planned end, the contracts running on the build's date, « Ce qui ressort » as facts, the lead's
// activity and regions; a total adds the `montant` of the contracts flagged `compte`, nothing else.
// A sole trader is never named (corpus.ts entName: « entreprise individuelle, nom non publié »).

import { depArt } from "../commun.ts";
import { buyerHref, buyerNom, depNom, docHref, entName, type Lexique } from "../corpus.ts";
import type { Handler, Rich, RichItem } from "../dc.ts";
import type { Acheteur, Affaire, Couverture, Evenement } from "../donnees.ts";
import { EI } from "../donnees.ts";
import { count, fr, money, moneyFull, shortDate, shortMonth } from "../format.ts";
import { has, t } from "../i18n.ts";
import {
  lienAcheteur,
  lienCommune,
  lienDepartement,
  lienDocument,
  lienEntreprise,
} from "../liens.ts";
import { sources } from "../sources.ts";
import { couleur, icone } from "../types.ts";
import { type BaseState, type Col, large, type Partage, Vue } from "../vue.ts";

export type Fin = { debut: string; duree: number | null; fin: string | null };
export type Faits = {
  identiques: { montant: number; contrats: string[] }[];
  rapproche: { montant: number; contrats: string[]; jours: number } | null;
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
  entreprise: {
    siren?: string;
    nom?: string | null;
    entrepreneur_individuel?: boolean;
    naf_libelle?: string | null;
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
  } | null;
  page: Page;
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

const strong = (s: Rich): RichItem => ({ strong: s });
const ym = (s: string) => +s.slice(0, 4) * 12 + +s.slice(5, 7);
const numDate = (d: string) => d.split("-").reverse().join("/");

/** A catalogue message whose placeholders may be rich (bold, a link), put back in place. */
type Param = string | number | Exclude<RichItem, string>;
export function rt(key: string, params: Record<string, Param> = {}): RichItem[] {
  const holes: RichItem[] = [];
  const flat: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "object") {
      flat[k] = `${holes.length}`;
      holes.push(v);
    } else flat[k] = v;
  }
  return t(key, flat)
    .split(/(\d+)/)
    .map((x, i) => (i % 2 ? holes[Number(x)] : x))
    .filter((x) => x !== "");
}

/** « A », « A et B », « A, B et C ». */
function list(items: RichItem[], sep = "entreprise.et"): RichItem[] {
  if (items.length < 2) return items;
  const out: RichItem[] = [];
  items.forEach((x, i) => {
    if (i) out.push(i === items.length - 1 ? t(sep) : ", ");
    out.push(x);
  });
  return out;
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
        fin: f?.fin ?? null,
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

/** « dans le Rhône », « en Île-de-France », « à Paris ». */
const dans = (r: string): string =>
  r === "idf"
    ? t("entreprise.dans_idf")
    : r === "75"
      ? t("entreprise.dans_paris")
      : t("entreprise.dans", { dep: depArt(r, depNom(r)) });

/** The lead: what its contracts are (when the export says), where its buyers are, how many. */
export function lead(F: FichierEntreprise, nCt: number, nCl: number): RichItem[] {
  const { surtout, regions } = F.page.lieux;
  const [r0, r1] = regions;
  let ou: RichItem[] = [];
  if (surtout && r0)
    ou = r1
      ? rt("entreprise.ou_surtout_deux", {
          surtout: strong(t("entreprise.surtout", { dans: dans(r0) })),
          dans2: dans(r1),
        })
      : rt("entreprise.ou_surtout", {
          surtout: strong(t("entreprise.surtout", { dans: dans(r0) })),
        });
  else if (r0 && r1) ou = rt("entreprise.ou_deux", { dans1: dans(r0), dans2: dans(r1) });
  else if (r0) ou = rt("entreprise.ou_un", { dans1: dans(r0) });
  const params = {
    clientes: strong(t("entreprise.n_collectivites", { n: nCl })),
    contrats: strong(count(nCt, "contrat")),
    nCl,
    y0: F.stats?.y0 ?? "—",
  };
  const act = F.page.activite;
  if (act)
    return [t(`entreprise.activite_${act}`), ...ou, ". ", ...rt("entreprise.lead_combien", params)];
  return rt("entreprise.lead_sans_activite", { ...params, ou: { span: ou, cls: "" } });
}

/** « Ce qui ressort »: the build's facts, in words; every place a link to its buyer's page. */
export function faits(F: FichierEntreprise, CT: Ct[]): RichItem[][] {
  const by = new Map(CT.map((c) => [c.e.id, c]));
  const place = (id: string): RichItem => {
    const c = by.get(id);
    return c ? placeLien(F, c) : "";
  };
  const out: RichItem[][] = [];
  const x = F.page.faits;
  if (x.identiques.length) {
    const groups = x.identiques.map((g) =>
      rt("entreprise.fait_groupe", {
        montant: moneyFull(g.montant),
        lieux: { span: list(g.contrats.map(place)), cls: "" },
      }),
    );
    out.push([
      strong(t("entreprise.fait_memes_montants")),
      " : ",
      ...groups.flatMap((g, i) => (i ? ["\u00a0; ", ...g] : g)),
      ".",
    ]);
  }
  if (x.rapproche) {
    const [a, b] = x.rapproche.contrats;
    out.push(
      rt("entreprise.fait_rapproche", {
        montant: strong(moneyFull(x.rapproche.montant)),
        a: place(a),
        b: place(b),
        jours: x.rapproche.jours,
      }),
    );
  }
  if (x.offres?.renseignes)
    out.push(
      rt("entreprise.fait_une_offre", {
        une: strong(t("entreprise.une_seule_offre")),
        n: count(x.offres.une_offre, "contrat"),
        m: x.offres.renseignes,
      }),
    );
  return out;
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

/** A contract's place as a link to its fiche: its commune's when the build knows it, else its
 * buyer's (a commune buyer's is its commune's); no buyer published, its words only. */
export function placeLien(F: FichierEntreprise, c: Ct, liste = false): RichItem {
  const k = c.e.insee;
  if (k && F.communes[k]) return lienCommune(F, k, undefined, liste);
  if (!c.b) return t("entreprise.acheteur_non_publie");
  return lienAcheteur(F, c.b, placeOf(F, c), liste);
}

/** The buyer's kind, in the words of the rankings (« commune », « centrale d'achat »). */
export function buyerCat(F: FichierEntreprise, c: Cl): string {
  if (c.centrale) return t("chiffres.cat_centrale");
  const k = F.acheteurs[c.s]?.categorie;
  return k && has(`registre.chiffres.cat_${k}`)
    ? t(`chiffres.cat_${k}`)
    : t("chiffres.cat_acheteur");
}

/** An amount in millions, one decimal, as the mockup's bars write them (« 5,2 M€ »); below
 * 100 000 € in euros (never « 0,0 M€ »); none: « — ». */
const meur = (n: number): string =>
  !n ? "—" : n < 1e5 ? money(n) : t("format.meur", { n: (n / 1e6).toFixed(1).replace(".", ",") });

export type Props = { siren: string; F: FichierEntreprise; couverture?: Couverture };
export type State = BaseState & {
  sort: string;
  dir: number;
  all: boolean;
  allAct: boolean;
  allDocs: boolean;
};
type Det = {
  kicker: string;
  title: string;
  rows: [string, string][];
  link?: string;
  href?: string;
  foot?: string;
};

// one colour for the measure, the fiche's type's; yellow for the selection alone (v2 § 8)
const COLOURS = {
  on: "var(--type-territoire)",
  bar: "var(--type-entreprise)",
  prog: "var(--type-entreprise)",
};

export class Entreprise extends Vue<Props, State> {
  private memo: { CT: Ct[]; CL: Cl[] } | null = null;
  protected init(): Partial<State> {
    return { sort: "amt", dir: -1, all: false, allAct: false, allDocs: false };
  }
  titre(): string {
    return entName(this.props.F, this.props.siren);
  }
  type() {
    return "entreprise" as const;
  }
  partage(): Partage | null {
    // a sole trader is never shared by its name: its page is not one either
    return this.props.F.entreprise.entrepreneur_individuel ? null : { titre: this.titre() };
  }
  private data() {
    this.memo ??= prepare(this.props.F);
    return this.memo;
  }
  renderVals() {
    const S = this.state;
    const { siren, F } = this.props;
    const { CT, CL } = this.data();
    const P = F.page;
    const x = F.entreprise;
    const nom = entName(F, siren);
    const ei = !!x.entrepreneur_individuel;
    const DET: Record<string, Det> = {};
    const total = CT.reduce((s, c) => s + c.amt, 0);
    const of = P.faits.offres;

    const kpis = [
      { v: fr(CT.length), l: t("entreprise.kpi_contrats", { n: CT.length }) },
      { v: fr(CL.length), l: t("entreprise.kpi_clientes", { n: CL.length }) },
      { v: total ? money(total) : "—", l: t("entreprise.kpi_montant") },
      {
        v: of?.renseignes
          ? t("entreprise.kpi_offre_v", { a: fr(of.une_offre), b: fr(of.renseignes) })
          : "—",
        l: t("entreprise.kpi_offre"),
      },
    ];

    // the years, from its first contract to the build's year
    const last = Number(P.maj.slice(0, 4));
    const first = Math.min(
      last,
      Number(F.stats?.y0 ?? last),
      ...CT.map((c) => Number(c.d.slice(0, 4)) || last),
    );
    const yrs = Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
    const ya = yrs.map((y) => CT.filter((c) => c.d.startsWith(y)));
    const sums = ya.map((l) => l.reduce((s, c) => s + c.amt, 0));
    const mxs = Math.max(1, ...sums);
    const qNom = ei ? "" : nom;
    const years = yrs.map((y, i) => {
      const k = `y${y}`;
      DET[k] = {
        kicker: t("entreprise.det_annee"),
        title: y,
        rows: [
          [t("entreprise.det_contrats_signes"), fr(ya[i].length)],
          [t("entreprise.det_montant"), sums[i] ? money(sums[i]) : "—"],
          [
            t("entreprise.det_plus_gros"),
            ya[i].some((c) => c.amt) ? money(Math.max(...ya[i].map((c) => c.amt))) : "—",
          ],
          [t("entreprise.det_clientes"), fr(new Set(ya[i].map((c) => c.b)).size)],
        ],
        link: t("entreprise.det_voir_annee", { y }),
        href: `/registre/?${new URLSearchParams({ ...(qNom ? { q: qNom } : {}), t: "con", y })}`,
      };
      return {
        y,
        v: meur(sums[i]),
        n: count(ya[i].length, "contrat"),
        label: t("entreprise.annee_label", { y, v: meur(sums[i]), n: ya[i].length }),
        on: String(this.on(k)),
        bar: `height: ${sums[i] ? Math.max(3, Math.round((sums[i] / mxs) * 150)) : 0}px; background: ${this.on(k) ? COLOURS.on : COLOURS.bar}`,
        hover: this.pick(k),
      };
    });

    // a contract in the panel
    const cDet = (c: Ct, k: string) => {
      const late = !!c.e.date_lue && c.e.date_lue !== c.e.date;
      DET[k] = {
        kicker: t("entreprise.det_contrat", { date: shortDate(c.d) }),
        title: placeOf(F, c),
        rows: [
          [t("entreprise.det_montant"), money(c.raw)],
          [
            t("entreprise.det_duree"),
            c.duree
              ? c.fin
                ? t("entreprise.duree_fin", { n: fr(c.duree), fin: shortMonth(c.fin) })
                : t("entreprise.duree_mois", { n: fr(c.duree) })
              : t("entreprise.non_publiee"),
          ],
          [
            t("entreprise.det_offres"),
            typeof c.e.offres === "number" ? fr(c.e.offres) : t("format.non_publie"),
          ],
          [
            t("entreprise.det_entreprises"),
            (c.e.entreprises ?? []).length > 1
              ? t("entreprise.a_plusieurs")
              : t("entreprise.seule"),
          ],
        ],
        link: t("entreprise.det_historique"),
        href: docHref(F, c.e),
        foot: late
          ? t("entreprise.note_date", {
              publiee: shortDate(c.e.date),
              lue: shortDate(c.e.date_lue),
            })
          : "",
      };
    };

    // running on the build's date (its list, the nearest end first), with how much has run
    const now = ym(P.maj);
    const byId = new Map(CT.map((c) => [c.e.id, c]));
    const actAll = P.en_cours.map((id) => byId.get(id)).filter((c): c is Ct => !!c && !!c.fin);
    const act = (S.allAct ? actAll : actAll.slice(0, 8)).map((c) => {
      const k = `c${c.i}`;
      const on = this.on(k);
      cDet(c, k);
      const end = c.fin as string;
      const pct = Math.max(
        2,
        Math.min(100, Math.round(((now - ym(c.d)) / Math.max(1, ym(end) - ym(c.d))) * 100)),
      );
      return {
        nom: placeLien(F, c),
        span: `${c.d.slice(0, 4)} → ${shortMonth(end)}`,
        amt: money(c.raw),
        prog: `position: absolute; left: 0; top: 0; bottom: 0; width: ${pct}%; background: ${on ? COLOURS.on : COLOURS.prog}`,
        progLabel: t("entreprise.ecoule", { pct }),
        cls: `bar2 rg2${on ? " on" : ""}`,
        hover: this.pick(k),
      };
    });

    // the largest, among the contracts a total adds
    const counted = CT.filter((c) => c.amt > 0);
    const bigL = counted
      .slice()
      .sort((a, b) => b.amt - a.amt)
      .slice(0, 8);
    const bmx = bigL[0]?.amt || 1;
    const big = bigL.map((c) => {
      const k = `c${c.i}`;
      const on = this.on(k);
      cDet(c, k);
      return {
        nom: placeLien(F, c),
        y: shortDate(c.d),
        rep: !!c.e.date_lue && c.e.date_lue !== c.e.date,
        amt: money(c.amt),
        bar: `display: inline-block; height: 14px; width: ${Math.max(4, Math.round((c.amt / bmx) * 150))}px; background: ${on ? COLOURS.on : COLOURS.bar}; border: 1.5px solid #111`,
        cls: `bar2 rg2b${on ? " on" : ""}`,
        hover: this.pick(k),
      };
    });

    // the clients: a bar by département, a sortable table
    const depOf = (s: string) => F.acheteurs[s]?.dep ?? "";
    const dc = new Map<string, number>();
    for (const c of CL) dc.set(depOf(c.s), (dc.get(depOf(c.s)) ?? 0) + 1);
    const dl = [...dc.entries()].sort((a, b) => b[1] - a[1]);
    const depLabel = (d: string) => (d ? depNom(d) : t("entreprise.dep_inconnu"));
    // where its clients are, each département a link to its fiche (in place of R1's stacked strip)
    const depLine = dl.map(([d, n]) => ({
      lien: d ? lienDepartement(d, depLabel(d)) : depLabel(d),
      n: t("entreprise.n_clientes", { n }),
    }));
    const key: Record<string, (c: Cl) => string | number> = {
      nom: (c) => buyerNom(F, c.s),
      dep: (c) => depNom(depOf(c.s)),
      n: (c) => c.n,
      amt: (c) => c.amt,
      last: (c) => c.last,
    };
    const get = key[S.sort] ?? key.amt;
    const sorted = CL.slice().sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const d = typeof va === "string" ? va.localeCompare(String(vb), "fr") : va - (vb as number);
      return d * S.dir || buyerNom(F, a.s).localeCompare(buyerNom(F, b.s), "fr");
    });
    const mxa = Math.max(1, ...CL.map((c) => c.amt));
    const clients = (S.all ? sorted : sorted.slice(0, 15)).map((c) => {
      const k = `k${c.s}`;
      const commune = F.acheteurs[c.s]?.categorie === "commune";
      DET[k] = {
        kicker: t("entreprise.det_cliente", { cat: buyerCat(F, c) }),
        title: buyerNom(F, c.s),
        rows: [
          [t("entreprise.det_departement"), depNom(depOf(c.s)) || "—"],
          [t("entreprise.det_contrats"), fr(c.n)],
          [t("entreprise.det_montant"), c.amt ? money(c.amt) : "—"],
          [t("entreprise.det_dernier"), c.last ? numDate(c.last) : "—"],
        ],
        link: commune ? t("entreprise.voir_commune") : t("entreprise.voir_acheteur"),
        href: buyerHref(F, c.s),
      };
      return {
        nom: lienAcheteur(F, c.s),
        cat: buyerCat(F, c),
        dep: depOf(c.s) ? lienDepartement(depOf(c.s)) : "—",
        n: fr(c.n),
        amt: c.amt ? money(c.amt) : "—",
        last: c.last.slice(0, 4),
        href: buyerHref(F, c.s),
        cls: `r${this.on(k) ? " on" : ""}`,
        bar: `display: inline-block; height: 10px; width: ${Math.max(2, Math.round((c.amt / mxa) * 120))}px; background: ${COLOURS.bar}; border: 1px solid #111`,
        hover: this.pick(k),
      };
    });
    const cols = this.cols(
      [
        ["nom", t("entreprise.col_cliente"), "", "width: 44%"],
        ["dep", t("entreprise.col_departement"), "", ""],
        ["n", t("entreprise.col_contrats"), "num", ""],
        ["amt", t("entreprise.col_montant"), "num", ""],
        ["last", t("entreprise.col_dernier"), "num", ""],
      ] as Col[],
      "sort",
      "dir",
      (k) => (k === "nom" || k === "dep" ? 1 : -1),
    );

    // signed together with other companies
    const par = new Map<string, number>();
    for (const c of CT)
      for (const s of c.e.entreprises ?? []) if (s !== siren) par.set(s, (par.get(s) ?? 0) + 1);
    const nPar = CT.filter((c) => (c.e.entreprises ?? []).length > 1).length;
    const partners = [...par.entries()]
      // a sole trader: no page, listed by no name (the build's token, or a flagged company)
      .filter(([s]) => s !== EI && !F.entreprises[s]?.entrepreneur_individuel)
      .sort((a, b) => b[1] - a[1] || entName(F, a[0]).localeCompare(entName(F, b[0]), "fr"))
      .map(([s, n]) => ({
        lien: lienEntreprise(F, s),
        n: count(n, "contrat"),
      }));

    const nDocs = CT.length + P.modifications;
    // its documents, the most recent first (V2-Entreprise): each its record
    const recent = CT.slice().sort((a, b) => b.d.localeCompare(a.d));
    const docs = (S.allDocs ? recent : recent.slice(0, 8)).map((c) => {
      const k = `c${c.i}`;
      cDet(c, k);
      return {
        cls: `drow${this.on(k) ? " on" : ""}`,
        c: `--c: ${couleur("con")}`,
        i: icone("con"),
        d: shortDate(c.d),
        qui: placeLien(F, c),
        amt: lienDocument(F, c.e, money(c.raw)),
        dur: c.duree ? t("entreprise.duree_mois", { n: fr(c.duree) }) : "",
        hover: this.pick(k),
      };
    });
    const d0 = this.state.sel ? DET[this.state.sel] : undefined;
    const det = d0
      ? {
          kicker: d0.kicker,
          title: d0.title,
          rows: d0.rows.map(([k, v]) => ({ k, v })),
          links: d0.link ? [{ l: d0.link, href: d0.href }] : [],
          foot: d0.foot ?? "",
        }
      : {
          kicker: t("entreprise.det_detail"),
          title: t("entreprise.det_survolez"),
          rows: [
            { k: t("entreprise.det_contrats_signes"), v: fr(CT.length) },
            { k: t("entreprise.det_clientes"), v: fr(CL.length) },
            { k: t("entreprise.det_montant"), v: total ? money(total) : "—" },
            { k: t("entreprise.det_premier"), v: CT[0] ? shortDate(CT[0].d) : "—" },
          ],
          links: [],
          foot: "",
        };
    const sirenTxt = siren.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
    const naf = x.naf_libelle ? x.naf_libelle.charAt(0).toLowerCase() + x.naf_libelle.slice(1) : "";
    const copies = F.stats?.copies ?? 0;

    // a sole trader: neither its name nor its number (the number names the person in SIRENE)
    const sous = ei
      ? t("entreprise.sous_ei")
      : naf
        ? t("entreprise.sous_naf", { siren: sirenTxt, naf })
        : t("entreprise.sous", { siren: sirenTxt });
    const secs = this.sections({
      essentiel: true,
      temps: yrs.length > 0 && CT.length > 0,
      avecqui: CL.length > 0 || partners.length > 0,
      documents: CT.length > 0,
      sources: true,
    });
    const wide = large();
    return {
      ...this.base("entreprise"),
      ...this.info("mt", "par"),
      tete: this.tete("entreprise", nom, sous),
      band: this.bandeau("entreprise", nom, secs),
      secs,
      lay: {
        inner: wide ? "inner" : "tin",
        tickets: wide ? "tickets" : "tickets t2",
        deux: wide ? "deux" : "deux un",
      },
      sources: sources(this.props.couverture, ["contrats", "avis"], !ei),
      nom,
      lead: lead(F, CT.length, CL.length),
      kpis,
      years,
      yearsCols: `repeat(${yrs.length}, minmax(0, 1fr))`,
      yearAlt: t("entreprise.annees_alt", { de: yrs[0], a: yrs[yrs.length - 1] }),
      act,
      big,
      bigPhrase:
        big.length === counted.length
          ? t("entreprise.big_tous", { n: big.length })
          : t("entreprise.les_premiers_des_par_montant", {
              nBig: big.length,
              nCon: fr(counted.length),
            }),
      // none running while some ends are unknown: not a zero
      nAct:
        !actAll.length && P.sans_fin ? t("entreprise.n_inconnu") : count(actAll.length, "contrat"),
      actMore: actAll.length > 8,
      actLabel: S.allAct
        ? t("entreprise.reduire")
        : t("entreprise.les_contrats_en_cours", { n: actAll.length }),
      toggleAct: (() => this.setState({ allAct: !S.allAct })) as Handler,
      sansFin: P.sans_fin ? t("entreprise.sans_fin", { n: P.sans_fin }) : "",
      faits: faits(F, CT),
      faitsShow: P.faits.identiques.length > 0 || !!P.faits.rapproche || !!of?.renseignes,
      nCli: CL.length,
      depLine,
      cols,
      clients,
      more: (() => this.setState({ all: !S.all })) as Handler,
      moreLabel: S.all ? t("entreprise.reduire") : t("entreprise.les_clientes", { n: CL.length }),
      showMore: CL.length > 15,
      doublonNote: copies
        ? ` ${t("entreprise.doublon_note", { contrats: count(CT.length, "contrat"), lignes: CT.length + copies })}`
        : "",
      parPhrase: !nPar
        ? t("entreprise.par_aucun")
        : nPar === CT.length
          ? t("entreprise.par_tous", { n: nPar })
          : t("entreprise.par_phrase", { n: nPar, total: fr(CT.length) }),
      partners,
      docs,
      docsMore: recent.length > 8,
      docsLabel: S.allDocs
        ? t("entreprise.reduire")
        : t("entreprise.les_contrats", { n: recent.length }),
      togDocs: (() => this.setState({ allDocs: !S.allDocs })) as Handler,
      docsPhrase: P.modifications
        ? t("entreprise.docs_phrase", {
            docs: count(nDocs, "document"),
            contrats: count(CT.length, "contrat"),
            mods: t("entreprise.n_modifications", { n: P.modifications }),
          })
        : t("entreprise.docs_sans_modification", { contrats: count(CT.length, "contrat") }),
      parcourir: qNom ? `/registre/?${new URLSearchParams({ q: qNom })}` : "/registre/",
      det,
    };
  }
}
