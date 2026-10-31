// A list of the register (/registre/communes, …/entreprises, …/arretes; mockup V2-Liste): the rail
// of every list, the type's sticker and its name cut out, the text filter, « classer par » with the
// rank, the filters each with its count (left out of its own filter), the table whose every name is
// a typed link, « Afficher plus », the CSV the browser makes of the list shown. The sort, the
// filters and the words are in the address (?tri=…&dep=…&q=…), replaced as they change. The rows,
// their figures and their rules are listes.ts's: a list of names reads listes.json, a list of
// documents asks the search API a page at a time (lot R3), « Afficher plus » the next one.

import { remplacerAdresse } from "../adresse.ts";
import { communeHref } from "../commun.ts";
import { badge, date as docDate, docHref, type Index, type Lexique } from "../corpus.ts";
import { type Handler, type Rich, richText } from "../dc.ts";
import { load } from "../donnees.ts";
import { fr } from "../format.ts";
import { has, t } from "../i18n.ts";
import { departementHref } from "../liens.ts";
import {
  adresse,
  appliquer,
  CATS,
  type Colonne,
  type Comptes,
  type Corpus,
  type CouvertureX,
  choisis,
  comptesIndex,
  comptesPage,
  corpus,
  csv,
  DEFS,
  type Def,
  demander,
  type Etat,
  etatDe,
  type Filtre,
  fondre,
  type Liste,
  type Listes,
  listeHref,
  motValeur,
  nomDep,
  nomListe,
  noteNonLu,
  question,
  type Rang,
  type Resultat,
  rangDocument,
  rangs,
  TYPE_DE,
  toutDemander,
  valeurs,
} from "../listes.ts";
import type { Miette, VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { plain } from "../texte.ts";
import {
  couleur,
  decoupe,
  FAMILLES,
  icone,
  mot,
  motFamille,
  pluriel,
  repere,
  type TypeCle,
} from "../types.ts";
import { type BaseState, large, Vue } from "../vue.ts";
import "./autorisations.css";
import { panneauArrete } from "./commune-outils.ts";
import "./liste.css";
import { couvertureLiee } from "../sources.ts";
import template from "./liste.html?raw";

/** The rows shown at first, and added by « Afficher plus » (the mockup's 20). */
const PAS = 20;
/** A list reopened on a fiche's row (?ligne=, the breadcrumb's list step) asks pages of documents
 * until the row comes, at most this many. */
const PAGES_LIGNE = 25;

type Props = {
  liste: Liste;
  q: Record<string, string>;
  /** a list of names: listes.json; a list of documents: null */
  C: Corpus | null;
  couverture: CouvertureX;
  I: Index;
};
/** A list of documents' pages so far: their rows, the names they need, the API's counts. */
type Docs = { rows: Rang[]; L: Lexique; total: number; comptes: Resultat["comptes"] };
type State = BaseState & {
  e: Etat;
  lim: number;
  docs: Docs | null;
  /** a page is being asked; the API did not answer */
  charge: boolean;
  echec: boolean;
  /** the menu open (« Départements », v2.3), and the words typed in its search */
  menu: "dep" | "tri" | null;
  menuQ: string;
  /** the list's link just copied */
  copie: boolean;
};
const VIDE: Lexique = { entreprises: {}, acheteurs: {}, communes: {}, affaires: {} };

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
              nomListe("acheteurs", c),
              n.categories[c],
              `${listeHref("acheteur")}?cat=${c}`,
              liste === "acheteurs" && e.f.cat === c,
            ),
          )
        : f.types.map((k) => {
            const l = (Object.keys(TYPE_DE) as Liste[]).find((x) => TYPE_DE[x] === k) as Liste;
            return row(k, nomListe(l), n.listes[l], listeHref(k), l === liste);
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
/** A figure of a row named (« 93 documents »): the phone's line under the name, the panel's tiles. */
function nomme(c: Colonne, r: Rang, cell: Rich): string {
  const v = richText(cell);
  const n = c.tri ? r.v[c.tri] : undefined;
  if (
    c.cle &&
    typeof n === "number" &&
    n >= 0 &&
    /\d/.test(v) &&
    has(`registre.liste.nomme.${c.cle}`)
  )
    return c.cle === "montant" || c.cle === "depuis"
      ? t(`liste.nomme.${c.cle}`, { v })
      : t(`liste.nomme.${c.cle}`, { n });
  return t("liste.nomme.autre", { v, l: c.l.toLowerCase() });
}

/** A list of names' row in the panel (v2.3, mockups liste-communes-*): its type and département,
 * its name, its figures as tiles, « Ouvrir la fiche → », its drones' door, « Voir sur la carte »
 * for a commune. */
function detailNom(r: Rang, def: Def, P: Pick<Props, "couverture">) {
  const k = def.k;
  const dep = r.f.dep?.length === 1 && (k === "commune" || k === "epci") ? r.f.dep[0] : null;
  const nums = def.cols.filter((c) => c.num);
  const cells = def.cols.flatMap((c, i) =>
    c.num ? [r.cells[i - def.cols.slice(0, i).filter((x) => x.deps).length]] : [],
  );
  const dr = typeof r.v.dr === "number" && r.v.dr > 0 ? r.v.dr : 0;
  const href = hrefDe(r);
  // every mention that has its fiche is a link (the owner's rule): the name, its département
  const kicker: Rich = dep
    ? t("liste.kicker_dep", { type: mot(k), nom: "\u0000", dep })
        .split("\u0000")
        .flatMap((x, i) =>
          i ? [{ a: { href: departementHref(dep), text: nomDep(P, dep) } }, x] : [x],
        )
    : mot(k);
  return {
    kicker,
    title: href ? [{ a: { href, text: r.nom } }] : (r.nom as Rich),
    // a figure the row does not know (« — ») is no tile (v2.3: no « — » ticket)
    tiles: nums
      .map((c, i) => ({ v: cells[i], l: c.l.toLowerCase() }))
      .filter((x) => richText(x.v).trim() !== "—"),
    ouvrir: href ? { href, l: t("liste.ouvrir_fiche") } : null,
    drones: dr
      ? {
          l: t("liste.drones_porte", { n: dr }),
          href:
            k === "commune"
              ? communeHref(r.id, "carte")
              : `/registre/arretes?dep=${encodeURIComponent(r.id)}&disp=dr`,
        }
      : null,
    carte:
      k === "commune"
        ? { l: t("liste.voir_carte"), href: `/?insee=${encodeURIComponent(r.id)}` }
        : null,
  };
}

function detail(L: Lexique, r: Rang | undefined, k: TypeCle, docs: boolean, def?: Def, P?: Props) {
  const vide = {
    corr: [],
    note: "",
    foot: "",
    btn: null,
    hint: "",
    tiles: null,
    ouvrir: null,
    drones: null,
    carte: null,
    clavier: t("liste.clavier"),
  };
  if (!r)
    return {
      ...vide,
      kicker: pluriel(k),
      title: "" as Rich,
      hint: t(docs ? "liste.panneau_repos_docs" : "liste.panneau_repos"),
      rows: [] as { k: string; v: Rich }[],
      links: [] as { l: string; href: string }[],
    };
  const href = hrefDe(r);
  const e = r.e;
  if (e?.t.startsWith("arrete")) {
    const p = panneauArrete(L, e);
    const nom = e.insee ? L.communes[e.insee]?.nom : undefined;
    return {
      ...vide,
      kicker: p.kicker,
      title: p.title,
      rows: p.rows.map(([k, v]) => ({ k, v })),
      note: p.note ?? "",
      foot: p.foot,
      links: [
        ...(nom ? [{ l: t("documents.lien_autorisations", { nom }), href: docHref(L, e) }] : []),
        ...p.links,
      ],
    };
  }
  // a list of names (v2.3, Ju's mockups): its figures again as tiles, its doors
  if (!e && def && P)
    return { ...vide, rows: [] as { k: string; v: Rich }[], links: [], ...detailNom(r, def, P) };
  // a document: its line, its reference, its links
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

  /** the latest page asked: an older answer is dropped */
  private n = 0;

  /** the row the address names (?ligne=): reached, then scrolled into view once */
  private cible: string | null = this.props.q?.ligne ?? null;
  private vise = false;

  protected init(p: Props): Partial<State> {
    const e = etatDe(DEFS[p.liste], p.q ?? {});
    const ligne = p.q?.ligne;
    // a list of names reopened on a row: as many steps of 20 as it takes to show it, chosen
    let lim = PAS;
    if (ligne && p.C) {
      const i = appliquer(DEFS[p.liste], rangs(p.C, p.liste), e).list.findIndex(
        (x) => x.id === ligne,
      );
      if (i >= 0) lim = Math.ceil((i + 1) / PAS) * PAS;
    }
    return {
      e,
      lim,
      docs: null,
      charge: false,
      echec: false,
      sel: ligne ?? null,
      menu: null,
      menuQ: "",
      copie: false,
    };
  }

  /** A list of documents: its first page in the state `e` (after a pause for typed words), or the
   * next one (« Afficher plus »). */
  private async pages(e: Etat, suite = false): Promise<void> {
    if (!this.def.kind) return;
    const id = ++this.n;
    const page = suite ? Math.floor((this.state.docs?.rows.length ?? 0) / PAS) + 1 : 1;
    this.setState({ charge: true });
    try {
      const P = await demander(question(this.def, e, page, PAS));
      if (id !== this.n) return;
      const prev = suite ? this.state.docs : null;
      const L = fondre(prev?.L ?? VIDE, P.dico);
      const rows = [
        ...(prev?.rows ?? []),
        ...P.evenements.map((x) => rangDocument(P.dico, this.props, x)),
      ];
      // reopened on a document's row: its record or its affair (a fiche's address names the affair)
      const cible = this.cible;
      const vu = cible ? rows.find((x) => x.id === cible || x.e?.affaire === cible) : undefined;
      this.setState({
        docs: { rows, L, total: P.total, comptes: comptesPage(this.def, P, e) },
        lim: rows.length,
        charge: false,
        echec: false,
        ...(vu ? { sel: vu.id } : {}),
      });
      if (cible && !vu && rows.length < P.total && page < PAGES_LIGNE) void this.pages(e, true);
      else if (!vu) this.cible = null;
    } catch {
      if (id === this.n) this.setState({ charge: false, echec: true });
    }
  }
  /** The row the address named, once drawn: scrolled to the middle of the list, once. */
  private viser(): void {
    if (!this.cible || this.vise || !this.state.sel) return;
    if (!document.querySelector(".v-liste tr.on")) return;
    this.vise = true;
    // after the frame has put the new page at its top (modale.ts afficher, its next frame); the row
    // asked then, a render may have replaced it
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.querySelector(".v-liste tr.on")?.scrollIntoView({ block: "center" }),
      ),
    );
  }
  /** The table's keys (v2.3): ↑ ↓ go from row to row (its link focused, its detail in the panel),
   * Enter follows the link. */
  private clavierTable: Handler = (ev) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const tr = (document.activeElement as Element | null)?.closest(".v-liste tbody tr");
    const all = [...document.querySelectorAll<HTMLElement>(".v-liste tbody tr")];
    const i = tr ? all.indexOf(tr as HTMLElement) : -1;
    const next = all[ev.key === "ArrowDown" ? i + 1 : Math.max(0, i - 1)];
    next?.querySelector<HTMLElement>("a")?.focus();
    ev.nativeEvent.preventDefault();
  };
  /** « copier le lien de cette liste »: its address, filters and order with it. */
  private copierLien: Handler = () => {
    void navigator.clipboard?.writeText(location.href).then(() => {
      this.setState({ copie: true });
      setTimeout(() => this.setState({ copie: false }), 2000);
    });
  };
  private attente: ReturnType<typeof setTimeout> | undefined;
  componentWillUnmount(): void {
    clearTimeout(this.attente);
    this.n++;
    document.removeEventListener("pointerdown", this.dehors, true);
  }
  titre(): string {
    return nomListe(this.props.liste, this.state.e.f.cat);
  }
  type(): TypeCle {
    return TYPE_DE[this.props.liste];
  }
  fil(): Miette[] {
    return [{ k: "registre", l: t("types.registre.l"), href: "/registre/" }];
  }

  componentDidMount(): void {
    void this.pages(this.state.e);
    this.viser();
    document.addEventListener("pointerdown", this.dehors, true);
    // on a phone the rail is a strip: its current list in view
    document
      .querySelector<HTMLElement>(".v-liste .rail.tel .ri.on")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }
  componentDidUpdate(): void {
    this.viser();
    // the state in the address, replaced (no new step in the history)
    const href = adresse(this.def, this.state.e);
    if (href !== `${location.pathname}${location.search}`)
      remplacerAdresse(`${href}${location.hash}`);
  }

  /** A rail link to the list shown (its own words, another category): the state its address says,
   * here, since the router keeps a view whose address it already drew (modale.ts `shown`) and
   * this one replaced its address as it changed. */
  private ici: Handler = (ev) => {
    const u = new URL((ev.currentTarget as HTMLAnchorElement).href, location.href);
    if (u.pathname !== location.pathname) return;
    ev.preventDefault();
    const e = etatDe(this.def, Object.fromEntries(u.searchParams));
    // a list of documents: the old state's rows go at once (« Afficher plus » would add to them)
    this.setState({ e, lim: PAS, ...(this.def.kind ? { docs: null } : {}) });
    void this.pages(e);
  };

  private set(x: Partial<Etat>): void {
    const e = { ...this.state.e, ...x };
    this.setState({ e, lim: PAS, ...(this.def.kind ? { docs: null } : {}) });
    clearTimeout(this.attente);
    // typed words are asked after a pause; a key at once
    if (x.q !== undefined) this.attente = setTimeout(() => void this.pages(e), 250);
    else void this.pages(e);
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

  // --- the départements' menu (v2.3, mockups liste-communes-*): one button for the 101 ---------
  /** A département chosen or not: the list follows at once, the menu stays open. */
  private basculerDep(v: string): Handler {
    return () => {
      const cur = choisis(this.state.e.f.dep);
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      this.set({ f: { ...this.state.e.f, dep: next.join(",") || undefined } });
    };
  }
  private effacerDeps: Handler = () => this.set({ f: { ...this.state.e.f, dep: undefined } });
  private ouvrirMenu: Handler = () => {
    const open = this.state.menu !== "dep";
    this.setState({ menu: open ? "dep" : null, menuQ: "" });
    if (open)
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>(".v-liste .dmenu input")?.focus(),
      );
  };
  private fermerMenu = (): void => {
    const m = this.state.menu;
    if (!m) return;
    this.setState({ menu: null });
    document.querySelector<HTMLElement>(`.v-liste .dancre.${m} > button`)?.focus();
  };
  /** « Classer par » (v2.3): one menu of the list's orders; the current one chosen again turns
   * its direction. */
  private ouvrirTri: Handler = () => {
    const open = this.state.menu !== "tri";
    this.setState({ menu: open ? "tri" : null });
    if (open)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            ".v-liste .tmenu [aria-selected=true], .v-liste .tmenu [role=option]",
          )
          ?.focus(),
      );
  };
  private choisirTri(k: string): Handler {
    return (ev) => {
      this.trier(k)(ev);
      this.fermerMenu();
    };
  }
  private clavierTri: Handler = (ev) => {
    const opts = [...document.querySelectorAll<HTMLElement>(".v-liste .tmenu [role=option]")];
    const i = opts.indexOf(document.activeElement as HTMLElement);
    if (ev.key === "Escape") this.fermerMenu();
    else if (ev.key === "ArrowDown") opts[Math.min(opts.length - 1, i + 1)]?.focus();
    else if (ev.key === "ArrowUp") (i > 0 ? opts[i - 1] : opts[0])?.focus();
    else if ((ev.key === " " || ev.key === "Enter") && i >= 0) opts[i].click();
    else return;
    ev.nativeEvent.preventDefault();
  };
  /** Its keys: Escape closes it, the arrows go through the départements, Space ticks one. */
  private clavierMenu: Handler = (ev) => {
    const opts = [...document.querySelectorAll<HTMLElement>(".v-liste .dmenu [role=option]")];
    const i = opts.indexOf(document.activeElement as HTMLElement);
    if (ev.key === "Escape") this.fermerMenu();
    else if (ev.key === "ArrowDown") opts[Math.min(opts.length - 1, i + 1)]?.focus();
    else if (ev.key === "ArrowUp") (i > 0 ? opts[i - 1] : opts[0])?.focus();
    else if (ev.key === " " && i >= 0) opts[i].click();
    else return;
    ev.nativeEvent.preventDefault();
  };
  /** A pointer down outside the menu closes it. */
  private dehors = (ev: Event): void => {
    const m = this.state.menu;
    if (m && !(ev.target as Element).closest?.(`.v-liste .dancre.${m}`)) this.fermerMenu();
  };

  /** The menu's words and rows: the départements the list has, by number, each with its count and
   * its box; the four with the most rows; the chosen ones as chips under the bar. */
  private menuDeps(c: Record<string, number>, total: number, k: TypeCle) {
    const S = this.state;
    const chosen = choisis(S.e.f.dep);
    const q = plain(S.menuQ.trim());
    const dep = (v: string) => {
      const on = chosen.includes(v);
      return {
        code: v,
        nom: nomDep(this.props, v),
        n: fr(c[v] ?? 0),
        on: on ? "true" : "false",
        cls: on ? "drow on" : "drow",
        pick: this.basculerDep(v),
      };
    };
    const have = valeurs("dep").filter((v) => c[v] || chosen.includes(v));
    const tous = have
      .map(dep)
      .filter((d) => !q || d.code.startsWith(q) || plain(d.nom).includes(q));
    const top = [...have]
      .sort((a, b) => (c[b] ?? 0) - (c[a] ?? 0))
      .slice(0, 4)
      .map(dep);
    return {
      etat: chosen.length ? t("liste.dep.choisis", { n: chosen.length }) : t("liste.tous.dep"),
      ouvert: S.menu === "dep" ? "true" : "false",
      menu: S.menu === "dep",
      basculer: this.ouvrirMenu,
      q: S.menuQ,
      onQ: ((ev) => this.setState({ menuQ: ev.value })) as Handler,
      top: q || !top.length ? null : top,
      tous,
      vide: tous.length === 0,
      clavier: this.clavierMenu,
      effacer: this.effacerDeps,
      fermer: (() => this.fermerMenu()) as Handler,
      voir: t("liste.voir", { n: fr(total), quoi: pluriel(k).toLowerCase() }),
      chips: !chosen.length
        ? null
        : chosen.map((v) => ({
            l: `${nomDep(this.props, v)} · ${fr(c[v] ?? 0)}`,
            ote: this.basculerDep(v),
            aide: t("liste.dep.oter", { nom: nomDep(this.props, v) }),
          })),
    };
  }

  renderVals() {
    const { liste, C, I } = this.props;
    const def = this.def;
    const S = this.state;
    const e = S.e;
    const k = this.type();
    // a list of names: its rows here; a list of documents: the pages the API gave
    const docs = !!def.kind;
    const all = C ? rangs(C, liste) : [];
    const { list, comptes: cpt } = docs
      ? { list: S.docs?.rows ?? [], comptes: S.docs?.comptes ?? {} }
      : appliquer(def, all, e);
    const total = docs ? (S.docs?.total ?? 0) : list.length;
    const L = docs ? (S.docs?.L ?? VIDE) : (C?.L ?? VIDE);
    const n = comptesIndex(I) as Comptes;
    const wide = large();
    const arrow = (key: string) => (e.tri === key ? (e.dir < 0 ? " ↓" : " ↑") : "");

    const sorts = def.tris.map((x) => ({
      l: x.l,
      on: e.tri === x.k ? "true" : "false",
      arrow: arrow(x.k),
      pick: this.choisirTri(x.k),
    }));
    const triCourant = def.tris.find((x) => x.k === e.tri) ?? def.tris[0];
    const tri = {
      l: `${triCourant.l}${arrow(triCourant.k)}`,
      ouvert: S.menu === "tri" ? "true" : "false",
      menu: S.menu === "tri",
      basculer: this.ouvrirTri,
      clavier: this.clavierTri,
    };
    // « Avec arrêtés drones »: a button that holds, beside « Classer par » (the mockup's)
    const drones = def.filtres.includes("drones")
      ? {
          on: e.f.drones ? "true" : "false",
          n: fr((cpt.drones ?? {})["1"] ?? 0),
          basculer: this.filtrer("drones", e.f.drones ? "" : "1"),
        }
      : null;
    const filtres = def.filtres
      .filter((f) => f !== "dep" && f !== "drones")
      .map((f) => {
        const c = cpt[f] ?? {};
        const cur = e.f[f] ?? "";
        return {
          lbl: t(`liste.filtre.${f}`),
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
                nom: "",
                n: fr(c[v] ?? 0),
                on: cur === v ? "true" : "false",
                pick: this.filtrer(f, v),
              })),
          ],
        };
      });
    const triNom = def.tris.some((x) => x.k === "nom");
    const head = (l: string, key: string | undefined, cls: string, w = "", aide = "") => ({
      l,
      // a head that does not read alone carries its sentence (v2.1 A6); one that sorts is a
      // button, its sentence read with it, shown on its hover and its focus
      aide,
      acls: aide ? "aide" : "",
      tab: aide && !key ? "0" : null,
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
      ...def.cols.map((c) => head(c.l, c.tri, c.num ? "num" : "", "", c.aide ?? "")),
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
      // on a phone each figure says its name, the first two only (the others are in the fiche)
      const telNums = wide
        ? ""
        : def.cols
            .map((c, i) => [c, cells[i]] as const)
            .filter(([c]) => c.num)
            .slice(0, 2)
            .map(([c, x]) => nomme(c, r, x.v))
            .join(" · ");
      return { rk: i + 1, lien: r.lien, sous: r.sous, cells, telNums, ...this.ligne(r.id, k) };
    });
    // the panel: the row hovered or focused stays there until another is (no `quitter`: the
    // row's click follows its link, the panel's links must stay within reach of the pointer);
    // none yet, the list's first row (v2.4, Ju: not « Survolez une ligne »), not marked as chosen
    const vu = this.affiche() ?? list[0]?.id ?? null;
    const det = detail(L, vu ? list.find((x) => x.id === vu) : undefined, k, docs, def, this.props);
    const filtre = !!e.q.trim() || def.filtres.some((f) => e.f[f]);
    const shown = Math.min(S.lim, list.length);
    const more = Math.min(PAS, total - shown);

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
      title: nomListe(liste, e.f.cat),
      letters: decoupe(nomListe(liste, e.f.cat)),
      idline: t(`liste.ligne.${liste.replace(/-/g, "_")}`, {
        n: n.listes[liste],
        maj: I.maj.split("-").reverse().join("/"),
      }),
      q: e.q,
      onQ: ((ev) => this.set({ q: ev.value })) as Handler,
      exemple: t(
        `liste.exemple.${["communes", "intercommunalites", "departements", "acheteurs", "entreprises"].includes(liste) ? liste : "documents"}`,
      ),
      sorts,
      tri,
      filtres,
      drones,
      deps: def.filtres.includes("dep") ? this.menuDeps(cpt.dep ?? {}, total, k) : null,
      argent: def.argent,
      caption: t("liste.caption", { liste: nomListe(liste, e.f.cat) }),
      cols,
      rows,
      empty: list.length === 0 && !S.charge && !S.echec && (!docs || !!S.docs),
      // a list of documents being asked, or the API not answering (lot R3)
      etat: S.echec ? t("liste.echec") : S.charge && !list.length ? t("liste.chargement") : "",
      reset: (() => this.set({ q: "", f: {} })) as Handler,
      hasMore: more > 0 && !S.echec,
      moreL: t("liste.plus", { n: more }),
      showMore: (() =>
        docs ? void this.pages(e, true) : this.setState({ lim: S.lim + PAS })) as Handler,
      shown: t(filtre ? "liste.montre_filtre" : "liste.montre", {
        shown: fr(shown),
        total: fr(total),
      }),
      exporter: (() =>
        docs
          ? void toutDemander(def, e, this.props).then(
              (rows) => enregistrer(`registre-${liste}.csv`, csv(def, rows)),
              () => this.setState({ echec: true }),
            )
          : enregistrer(`registre-${liste}.csv`, csv(def, list))) as Handler,
      arretes: liste === "arretes",
      // the decrees: what the register reads of them, and where the others come from, as the
      // coverage says it (v2.3: the list and « Ce que couvre le registre » say the same)
      resumeArretes: liste === "arretes" ? couvertureLiee(this.props.couverture) : null,
      // the lists whose rows may say « non lu »: the line that says why, once
      nonLu: C && (liste === "communes" || liste === "departements") ? noteNonLu(C) : null,
      det,
      clavierTable: this.clavierTable,
      copier: this.copierLien,
      copierL: t(S.copie ? "liste.lien_copie" : "liste.copier_lien"),
      nonLus: t("registre.non_lus", { n: I.non_lus }),
    };
  }
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  if (r.view !== "liste") return {};
  // a list of names reads listes.json; a list of documents asks the API once drawn
  const names = !DEFS[r.liste].kind;
  const [X, I, couverture] = await Promise.all([
    names ? load<Listes>("listes.json") : Promise.resolve(null),
    load<Index>("index.json"),
    load<CouvertureX>("couverture.json"),
  ]);
  return { C: X ? corpus(X, couverture) : null, couverture, I };
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: ListeVue as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
