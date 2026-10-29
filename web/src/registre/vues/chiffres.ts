// View 2 · Registre · Chiffres et classements (mockup Registre-chiffres.dc.html, the prototype's
// vues/chiffres.js): who sells, who buys, where, and year by year, over every document
// (recherche.json, loaded on open). Amounts are those the build counts (`compte`): a ceiling
// signed for other buyers, a copy or a national buyer's contract stays out.

import { communeHref } from "../commun.ts";
import {
  buyerHref,
  buyerNom,
  type ComStat,
  depNom,
  disp,
  entName,
  type Figures,
  figures,
  type Index,
  type Recherche,
  typ,
} from "../corpus.ts";
import type { Couverture } from "../donnees.ts";
import { load } from "../donnees.ts";
import { fr, money } from "../format.ts";
import { has, t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import type { Route } from "../routes.ts";
import { type BaseState, type Col, Vue } from "../vue.ts";
import template from "./chiffres.html?raw";

const DISPS = ["vp", "csu", "vsa", "lapi", "pi", "vv", "dr"];
type Props = { R: Recherche; index: Index; couverture: Couverture };
type State = BaseState & {
  sortE: string;
  dirE: number;
  sortB: string;
  dirB: number;
  sortC: string;
  dirC: number;
  yt: string;
};

type Tout = {
  fig: Figures;
  years: Record<string, Record<string, number>>;
  disp: Record<string, number>;
  dr: Record<string, number>;
  nCon: number;
  coms: (ComStat & { carte: number | null })[];
  collecte: Set<string>;
};
/** The figures, once per page (the file does not change while the page lives). */
const memo = new WeakMap<Recherche, Tout>();
function tout(R: Recherche, couverture: Couverture): Tout {
  let x = memo.get(R);
  if (x) return x;
  const years: Record<string, Record<string, number>> = {};
  const dispN: Record<string, number> = {};
  const dr: Record<string, number> = {};
  let nCon = 0;
  for (const e of R.evenements) {
    const y = (e.date ?? "").slice(0, 4);
    const k = typ(e);
    years[y] ??= {};
    years[y][k] = (years[y][k] ?? 0) + 1;
    if (e.t === "attribution") {
      nCon++;
      dispN[disp(e)] = (dispN[disp(e)] ?? 0) + 1;
    }
    if (e.t === "arrete_drone" && e.insee && R.communes[e.insee])
      dr[e.insee] = (dr[e.insee] ?? 0) + 1;
  }
  const fig = figures(R);
  x = {
    fig,
    years,
    disp: dispN,
    dr,
    nCon,
    // the map's cameras of a commune when the build gives them with every document
    coms: Object.values(fig.coms).map((c) => ({ ...c, carte: R.communes[c.insee]?.carte ?? null })),
    collecte: new Set(
      Object.entries(couverture.departements)
        .filter(([, d]) => d.etat === "collecte")
        .map(([k]) => k),
    ),
  };
  memo.set(R, x);
  return x;
}

class Chiffres extends Vue<Props, State> {
  protected init(): Partial<State> {
    return { sortE: "clients", dirE: -1, sortB: "n", dirB: -1, sortC: "n", dirC: -1, yt: "con" };
  }
  titre(): string {
    return t("chiffres.chiffres_et_classements");
  }
  renderVals() {
    const S = this.state;
    const { R, index: I, couverture } = this.props;
    const F = tout(R, couverture);
    const by = <T>(rows: T[], get: (r: T) => number, dir: number, tie: (r: T) => number) =>
      rows.slice().sort((a, b) => dir * (get(a) - get(b)) || tie(b) - tie(a));

    // who sells
    const entRows = Object.values(F.fig.ents).map((o) => {
      const deps = Object.entries(o.deps)
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k);
      return {
        siren: o.siren,
        nom: entName(R, o.siren),
        deps: deps.length > 10 ? t("chiffres.n_departements", { n: deps.length }) : deps.join(", "),
        clients: o.clientes.size,
        n: o.n,
        amt: o.montant,
        y0: o.y0,
      };
    });
    const ek: Record<string, (r: (typeof entRows)[number]) => number> = {
      clients: (r) => r.clients,
      n: (r) => r.n,
      amt: (r) => r.amt,
    };
    const ents = by(entRows, ek[S.sortE], S.dirE, (r) => r.n)
      .slice(0, 10)
      .map((e) => ({
        nom: e.nom,
        deps: e.deps,
        y0: e.y0,
        clients: fr(e.clients),
        n: fr(e.n),
        amt: money(e.amt),
        href: `/registre/entreprise/${e.siren}`,
      }));
    const entCols = this.cols(
      [
        ["clients", t("chiffres.col_clientes")],
        ["n", t("chiffres.col_contrats")],
        ["amt", t("chiffres.col_montant")],
      ] as Col[],
      "sortE",
      "dirE",
    );

    // who buys
    const buyRows = Object.values(F.fig.buyers).map((o) => {
      const a = R.acheteurs[o.siren];
      const cat = o.centrale
        ? t("chiffres.cat_centrale")
        : a?.categorie && has(`registre.chiffres.cat_${a.categorie}`)
          ? t(`chiffres.cat_${a.categorie}`)
          : t("chiffres.cat_acheteur");
      const dep = (a as { dep?: string } | undefined)?.dep;
      return {
        nom: buyerNom(R, o.siren),
        cat: dep ? `${cat} · ${depNom(dep)}` : cat,
        n: o.n,
        amt: o.montant,
        ents: o.ents.size,
        href: buyerHref(R, o.siren),
      };
    });
    const bk: Record<string, (r: (typeof buyRows)[number]) => number> = {
      n: (r) => r.n,
      amt: (r) => r.amt,
      ents: (r) => r.ents,
    };
    const buyers = by(buyRows, bk[S.sortB], S.dirB, (r) => r.n)
      .slice(0, 10)
      .map((b) => ({ ...b, n: fr(b.n), amt: money(b.amt), ents: fr(b.ents) }));
    const buyCols = this.cols(
      [
        ["n", t("chiffres.col_contrats")],
        ["amt", t("chiffres.col_montant")],
        ["ents", t("chiffres.col_entreprises")],
      ] as Col[],
      "sortB",
      "dirB",
    );

    // the communes
    const carte = F.coms.some((c) => c.carte != null);
    const ck: Record<string, (c: (typeof F.coms)[number]) => number> = {
      n: (c) => c.docs,
      con: (c) => c.con,
      aut: (c) => c.cam,
      dr: (c) => c.dr,
      cam: (c) => c.carte ?? 0,
    };
    const coms = by(F.coms, ck[S.sortC], S.dirC, (c) => c.docs)
      .slice(0, 12)
      .map((c) => {
        const x = R.communes[c.insee];
        const col = F.collecte.has(x.dep);
        return {
          nom: x.nom,
          dep: depNom(x.dep),
          n: fr(c.docs),
          con: fr(c.con),
          aut: col ? fr(c.cam) : "—",
          dr: col ? fr(c.dr) : "—",
          cam: c.carte == null ? "—" : fr(c.carte),
          href: communeHref(c.insee),
        };
      });
    const comCols = this.cols(
      [
        ["n", t("chiffres.col_documents")],
        ["con", t("chiffres.col_contrats")],
        ["aut", t("chiffres.col_autorisations")],
        ["dr", t("chiffres.col_drones")],
        // sortable once the build gives the map's cameras with every document
        [carte ? "cam" : "", t("chiffres.col_carte")],
      ] as Col[],
      "sortC",
      "dirC",
    );

    // every year, from 2018 to the year of the last update (incomplete, hatched)
    const last = Number(I.maj.slice(0, 4));
    const yrs = Array.from({ length: last - 2017 }, (_, i) => String(2018 + i));
    const vals = yrs.map((y) => F.years[y]?.[S.yt] ?? 0);
    const mx = Math.max(1, ...vals);
    const years = yrs.map((y, i) => ({
      y: y === String(last) ? t("chiffres.annee_en_cours", { y }) : y,
      v: vals[i] ? fr(vals[i]) : "—",
      bar: `display: block; height: ${Math.round((vals[i] / mx) * 170)}px; background: ${
        y === String(last)
          ? "repeating-linear-gradient(45deg, var(--fg) 0 3px, transparent 3px 7px); border: 2px solid var(--fg); box-sizing: border-box"
          : "var(--fg)"
      }`,
    }));
    const yearTypes = (["con", "ao", "aut", "sub"] as const).map((k) => ({
      l: t(`chiffres.an_${k}`),
      pressed: S.yt === k ? "true" : "false",
      pick: () => this.setState({ yt: k }),
      style:
        S.yt === k
          ? "background: var(--fg); color: var(--bg)"
          : "background: var(--bg-2); color: var(--fg)",
    }));

    // what is bought, and the drones
    const nv = Math.max(1, ...DISPS.map((k) => F.disp[k] ?? 0));
    const dispRows = DISPS.map((k) => {
      const n = F.disp[k] ?? 0;
      return {
        l: t(`registre.disp_${k}`),
        n: fr(n),
        href: `/registre/?t=con&p=${k}`,
        bar: `position: absolute; left: 0; top: 0; bottom: 0; width: ${Math.max(1, Math.round(Math.sqrt(n / nv) * 100))}%; background: var(--fg)`,
      };
    });
    const drl = Object.entries(F.dr)
      .sort((a, b) => b[1] - a[1] || R.communes[a[0]].nom.localeCompare(R.communes[b[0]].nom, "fr"))
      .slice(0, 8);
    const dmx = drl[0]?.[1] ?? 1;
    const drones = drl.map(([k, n]) => ({
      l: R.communes[k].nom,
      n: fr(n),
      href: communeHref(k, "carte"),
      bar: `position: absolute; left: 0; top: 0; bottom: 0; width: ${Math.round((n / dmx) * 100)}%; background: var(--drone)`,
    }));

    return {
      ...this.base("chiffres"),
      ...this.info("scope", "ach", "com"),
      maj: I.maj.split("-").reverse().join("/"),
      ndocs: fr(I.totaux.docs),
      nEnts: fr(Object.keys(F.fig.ents).length),
      nBuy: fr(Object.keys(F.fig.buyers).length),
      nCon: fr(F.nCon),
      ents,
      entCols,
      buyers,
      buyCols,
      enveloppe: t("argent.enveloppe"),
      coms,
      comCols,
      ncom: fr(F.coms.length),
      years,
      yearTypes,
      yearAlt: t("chiffres.annees_alt", { de: yrs[0], a: String(last) }),
      disp: dispRows,
      drones,
    };
  }
}

async function donnees(_r: Route): Promise<Record<string, unknown>> {
  const [R, index, couverture] = await Promise.all([
    load<Recherche>("recherche.json"),
    load<Index>("index.json"),
    load<Couverture>("couverture.json"),
  ]);
  return { R, index, couverture };
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: Chiffres as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
