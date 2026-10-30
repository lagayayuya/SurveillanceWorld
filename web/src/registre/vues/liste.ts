// A list of the register (/registre/communes, …/entreprises, …/arretes; mockup V2-Liste): the rail
// of every list, the type's sticker and its name cut out, the text filter, « classer par » with the
// rank, the filters each with its count (left out of its own filter), the table whose every name is
// a typed link, « Afficher plus », the CSV the browser makes of the list shown. The sort, the
// filters and the words are in the address (?tri=…&dep=…&q=…), replaced as they change. The rows,
// their figures and their rules are listes.ts's (those of the old « Chiffres et classements » and
// of the old search of documents).

import { badge, date as docDate, docHref, type Index, type Recherche } from "../corpus.ts";
import type { Handler, Rich } from "../dc.ts";
import { load } from "../donnees.ts";
import { fr } from "../format.ts";
import { t } from "../i18n.ts";
import {
  adresse,
  appliquer,
  CATS,
  type Comptes,
  type Corpus,
  type CouvertureX,
  comptes,
  comptesIndex,
  corpus,
  csv,
  DEFS,
  type Def,
  type Etat,
  etatDe,
  type Filtre,
  type Liste,
  listeHref,
  motValeur,
  nomDep,
  type Rang,
  rangs,
  TYPE_DE,
  valeurs,
} from "../listes.ts";
import type { Miette, VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import {
  couleur,
  decoupe,
  FAMILLES,
  icone,
  motFamille,
  pluriel,
  repere,
  type TypeCle,
} from "../types.ts";
import { type BaseState, large, Vue } from "../vue.ts";
import "./autorisations.css";
import { panneauArrete } from "./commune-outils.ts";
import "./liste.css";
import template from "./liste.html?raw";

/** The rows shown at first, and added by « Afficher plus » (the mockup's 20). */
const PAS = 20;

type Props = { liste: Liste; q: Record<string, string>; C: Corpus; I: Index };
type State = BaseState & { e: Etat; lim: number };

/** The file the browser makes (a Blob and its object URL, no dependency). */
function enregistrer(nom: string, corps: string): void {
  const url = URL.createObjectURL(new Blob([corps], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The rail: every list by family, its count; the buyers by category (V2-Liste). */
export function rail(liste: Liste, e: Etat, n: Comptes) {
  const row = (k: TypeCle, l: string, count: number, href: string, on: boolean) => ({
    cls: `ri${on ? " on" : ""}`,
    c: `--c: ${couleur(k)}`,
    i: icone(k),
    l,
    n: fr(count),
    href,
    cur: on ? "page" : null,
  });
  return FAMILLES.map((f) => ({
    l: motFamille(f.famille),
    rows:
      f.famille === "acheteur"
        ? CATS.map((c) =>
            row(
              "acheteur",
              t(c === "autres" ? "liste.rail_autres" : `liste.cat.${c}`),
              n.categories[c],
              `${listeHref("acheteur")}?cat=${c}`,
              liste === "acheteurs" && e.f.cat === c,
            ),
          )
        : f.types.map((k) => {
            const l = (Object.keys(TYPE_DE) as Liste[]).find((x) => TYPE_DE[x] === k) as Liste;
            return row(
              k,
              k === "entreprise" ? t("liste.rail_titulaires") : pluriel(k),
              n.listes[l],
              listeHref(k),
              l === liste,
            );
          }),
  }));
}

/** A row's main link: where it leads (its fiche, a decree's commune at its row). */
const hrefDe = (r: Rang): string => (r.lien as { a?: { href?: string } }).a?.href ?? "";

/** A row's line under its name, as words (the panel's note is text). */
const plainSous = (x: Rich): string => (typeof x === "string" ? x : "");

/** The list's detail panel (v2.1 B4: the lists have the fiches' panel): a decree, everything the
 * build read of it and its two links (its source, « Signaler une erreur »), which no row repeats;
 * another document, its line, its reference, its links; a commune, a company…, its name and its
 * fiche (their figures are in the row). At rest it says what to hover (B3), never the figures beside it. */
function detail(C: Corpus, r: Rang | undefined, k: TypeCle, docs: boolean) {
  const vide = { corr: [], note: "", foot: "", btn: null, hint: "" };
  if (!r)
    return {
      ...vide,
      kicker: pluriel(k),
      title: t(docs ? "liste.panneau_repos_docs" : "liste.panneau_repos") as Rich,
      rows: [] as { k: string; v: Rich }[],
      links: [] as { l: string; href: string }[],
    };
  const href = hrefDe(r);
  const e = r.e;
  if (e?.t.startsWith("arrete")) {
    const p = panneauArrete(C.R, e);
    const nom = e.insee ? C.R.communes[e.insee]?.nom : undefined;
    return {
      ...vide,
      kicker: p.kicker,
      title: p.title,
      rows: p.rows.map(([k, v]) => ({ k, v })),
      note: p.note ?? "",
      foot: p.foot,
      links: [
        ...(nom ? [{ l: t("documents.lien_autorisations", { nom }), href: docHref(C.R, e) }] : []),
        ...p.links,
      ],
    };
  }
  // its figures are beside it, in its row: not again here (B3); its line, its links
  return {
    ...vide,
    kicker: e ? `${badge(e)} · ${docDate(e)}` : pluriel(k),
    title: r.nom as Rich,
    rows: [] as { k: string; v: Rich }[],
    hint: plainSous(r.sous),
    foot: e?.ref ?? "",
    links: [...(href ? [{ l: t("liste.ouvrir_fiche"), href }] : []), ...(r.liens ?? [])],
  };
}

export class ListeVue extends Vue<Props, State> {
  private def: Def = DEFS[this.props.liste];

  protected init(p: Props): Partial<State> {
    return { e: etatDe(DEFS[p.liste], p.q ?? {}), lim: PAS };
  }
  titre(): string {
    return pluriel(this.type());
  }
  type(): TypeCle {
    return TYPE_DE[this.props.liste];
  }
  fil(): Miette[] {
    return [{ k: "registre", l: t("types.registre.l"), href: "/registre/" }];
  }

  componentDidMount(): void {
    // on a phone the rail is a strip: its current list in view
    document
      .querySelector<HTMLElement>(".v-liste .rail.tel .ri.on")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }
  componentDidUpdate(): void {
    // the state in the address, replaced (no new step in the history)
    const href = adresse(this.def, this.state.e);
    if (href !== `${location.pathname}${location.search}`)
      history.replaceState(history.state, "", `${href}${location.hash}`);
  }

  /** A rail link to the list shown (its own words, another category): the state its address says,
   * here, since the router keeps a view whose address it already drew (modale.ts `shown`) and
   * this one replaced its address as it changed. */
  private ici: Handler = (ev) => {
    const u = new URL((ev.currentTarget as HTMLAnchorElement).href, location.href);
    if (u.pathname !== location.pathname) return;
    ev.preventDefault();
    this.setState({ e: etatDe(this.def, Object.fromEntries(u.searchParams)), lim: PAS });
  };

  private set(e: Partial<Etat>): void {
    this.setState({ e: { ...this.state.e, ...e }, lim: PAS });
  }
  /** A sort key: the same flips its direction, another starts with its own. */
  private trier(k: string): Handler {
    return () => {
      const S = this.state.e;
      const d = this.def.tris.find((x) => x.k === k)?.dir ?? -1;
      this.set({ tri: k, dir: S.tri === k ? (-S.dir as 1 | -1) : d });
    };
  }
  private filtrer(f: Filtre, v: string): Handler {
    return () => this.set({ f: { ...this.state.e.f, [f]: v || undefined } });
  }

  renderVals() {
    const { liste, C, I } = this.props;
    const def = this.def;
    const S = this.state;
    const e = S.e;
    const k = this.type();
    const all = rangs(C, liste);
    const { list, comptes: cpt } = appliquer(def, all, e);
    const n = comptesIndex(I) ?? comptes(C);
    const wide = large();
    const arrow = (key: string) => (e.tri === key ? (e.dir < 0 ? " ↓" : " ↑") : "");

    const sorts = def.tris.map((x) => ({
      l: x.l,
      on: e.tri === x.k ? "true" : "false",
      arrow: arrow(x.k),
      pick: this.trier(x.k),
    }));
    const filtres = def.filtres.map((f) => {
      const c = cpt[f] ?? {};
      const cur = e.f[f] ?? "";
      return {
        lbl: t(
          f === "dep" && liste === "entreprises"
            ? "liste.filtre.dep_entreprises"
            : `liste.filtre.${f}`,
        ),
        keys: [
          {
            l: t(`liste.tous.${f}`),
            nom: "",
            n: fr(c[""] ?? 0),
            on: cur ? "false" : "true",
            pick: this.filtrer(f, ""),
          },
          ...valeurs(f)
            .filter((v) => c[v] || cur === v)
            .map((v) => ({
              l: motValeur(f, v),
              // a département's key is its number; its name is read
              nom: f === "dep" && v !== "xx" ? nomDep(C, v) : "",
              n: fr(c[v] ?? 0),
              on: cur === v ? "true" : "false",
              pick: this.filtrer(f, v),
            })),
        ],
      };
    });
    const triNom = def.tris.some((x) => x.k === "nom");
    const head = (l: string, key: string | undefined, cls: string, w = "") => ({
      l,
      cls,
      w,
      tri: !!key,
      fixe: !key,
      sort: key && e.tri === key ? (e.dir < 0 ? "descending" : "ascending") : "none",
      arrow: key ? arrow(key) : "",
      pick: (key ? this.trier(key) : () => {}) as Handler,
    });
    const cols = [
      head(def.nom, triNom ? "nom" : undefined, "", wide ? "width: 38%" : ""),
      ...def.cols.map((c) => head(c.l, c.tri, c.num ? "num" : "")),
    ];
    const rows = list.slice(0, S.lim).map((r, i) => {
      let j = 0;
      const cells = def.cols.map((c) => {
        if (c.deps) {
          const ds = r.deps ?? [];
          const cut = ds.length > 7;
          return {
            cls: "",
            isDeps: true,
            deps: [
              ...(cut ? ds.slice(0, 6) : ds).map((d) => ({ d, cls: d === e.f.dep ? "on" : "" })),
              ...(cut ? [{ d: `+${ds.length - 6}`, cls: "" }] : []),
            ],
            v: "" as Rich,
          };
        }
        return { cls: c.num ? "num" : "", isDeps: false, deps: [], v: r.cells[j++] };
      });
      // the row under the contract (cadre.css « rows »): its name's link covers it, hovered or
      // focused it shows in the panel, chosen it keeps its type's bar
      return { rk: i + 1, lien: r.lien, sous: r.sous, cells, ...this.ligne(r.id, k) };
    });
    // the panel: the row hovered or focused stays there until another is (no `quitter`: the
    // row's click follows its link, the panel's links must stay within reach of the pointer)
    const vu = this.affiche();
    const det = detail(C, vu ? list.find((x) => x.id === vu) : undefined, k, !!all[0]?.e);
    const filtre = !!e.q.trim() || def.filtres.some((f) => e.f[f]);
    const shown = Math.min(S.lim, list.length);
    const more = Math.min(PAS, list.length - S.lim);

    return {
      ...this.base("liste"),
      wide,
      tel: !wide,
      lay: { inner: wide ? "inner" : "tin", stk: wide ? "stk big" : "stk" },
      railCls: wide ? "rail" : "rail tel",
      rail: rail(liste, e, n).map((f) => ({
        ...f,
        rows: f.rows.map((r) => ({ ...r, go: this.ici })),
      })),
      ty: repere(k),
      title: pluriel(k),
      letters: decoupe(pluriel(k)),
      idline: t(`liste.ligne.${liste.replace(/-/g, "_")}`, {
        n: all.length,
        maj: I.maj.split("-").reverse().join("/"),
      }),
      q: e.q,
      onQ: ((ev) => this.set({ q: ev.value })) as Handler,
      exemple: t(
        `liste.exemple.${["communes", "intercommunalites", "departements", "acheteurs", "entreprises"].includes(liste) ? liste : "documents"}`,
      ),
      sorts,
      filtres,
      argent: def.argent,
      caption: t("liste.caption", { liste: pluriel(k) }),
      cols,
      rows,
      empty: list.length === 0,
      reset: (() => this.set({ q: "", f: {} })) as Handler,
      hasMore: more > 0,
      moreL: t("liste.plus", { n: more }),
      showMore: (() => this.setState({ lim: S.lim + PAS })) as Handler,
      shown: t(filtre ? "liste.montre_filtre" : "liste.montre", {
        shown: fr(shown),
        total: fr(list.length),
      }),
      exporter: (() => enregistrer(`registre-${liste}.csv`, csv(def, list))) as Handler,
      arretes: liste === "arretes",
      det,
      nonLus: t("registre.non_lus", { n: I.non_lus }),
    };
  }
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  if (r.view !== "liste") return {};
  const [R, I, couverture] = await Promise.all([
    load<Recherche>("recherche.json"),
    load<Index>("index.json"),
    load<CouvertureX>("couverture.json"),
  ]);
  return { C: corpus(R, couverture, I.maj), I };
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: ListeVue as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
