// A list of the register (/registre/communes, …/entreprises, …/arretes; boards Liste-Communes-A and
// Liste-Entreprises-A of the redesign v3, their phone and dark variants): the sticker « Liste » and
// the name cut out, the count in a sentence, the words to search, « Autour de moi » (communes),
// « Exporter (CSV) »; « Afficher » (the family's levels: communes, intercommunalités, départements;
// a buyers' category; a kind of document); « Classer par » and the filters (« Taille », then
// « Département ▾ », « Intercommunalité ▾ »… each value with its count, left out of its own
// filter); the table, the column of the order marked, every name a link; « Voir les N ». On a
// phone one row of commands: « Classer par ▾ » and « Filtres · N », the active filters as chips,
// the Filters panel (the size first, then the place, then « Voir les N »); a row shows its name
// and the column of the order only. The sort, the filters and the words are in the address
// (?tri=…&dep=…&q=…), replaced as they change. The rows, their figures and their rules are
// listes.ts's: a list of names reads listes.json, a list of documents asks the search API a page
// at a time (lot R3), « Voir … de plus » the next one.

import { remplacerAdresse } from "../adresse.ts";
import { communeHref } from "../commun.ts";
import type { Index, Lexique } from "../corpus.ts";
import type { Handler, Rich, RichItem } from "../dc.ts";
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
  MENUS,
  motValeur,
  nomDep,
  nomListe,
  question,
  type Rang,
  type Resultat,
  rangDocument,
  rangs,
  TAILLES,
  TYPE_DE,
  toutDemander,
  triDefaut,
  valeurs,
} from "../listes.ts";
import type { Miette, VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { coupe, plusProche } from "../socle-a.ts";
import { couvertureLiee } from "../sources.ts";
import { plain } from "../texte.ts";
import { pluriel, type TypeCle } from "../types.ts";
import { type BaseState, large, Vue } from "../vue.ts";
import "./autorisations.css";
import "./liste.css";
import template from "./liste.html?raw";

/** The rows shown at first, then added by « Voir … de plus » (a list of names: by a hundred; a
 * list of documents: a page of the API at a time). */
const PAS = 20;
const PAS_NOMS = 100;
/** A list reopened on a fiche's row (?ligne=, the breadcrumb's list step) asks pages of documents
 * until the row comes, at most this many. */
const PAGES_LIGNE = 25;

type Props = {
  liste: Liste;
  q: Record<string, string>;
  /** a list of names: listes.json; a list of documents: null */
  C: Corpus | null;
  couverture: CouvertureX;
  I: Index & { totaux: Record<string, number> };
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
  /** the menu open (« Classer par » on a phone, a filter's), and the words typed in its search */
  menu: string | null;
  menuQ: string;
  /** the phone's Filters panel */
  feuille: boolean;
  /** the list's link just copied */
  copie: boolean;
  autour: "" | "cherche" | "refus" | "echec";
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

/** « Afficher »: the levels of the list's family (theme A's tabs), the one shown current. */
export function niveaux(liste: Liste, e: Etat): { l: string; href: string; cur: "page" | null }[] {
  const tab = (l: string, href: string, on: boolean) => ({
    l,
    href,
    cur: on ? ("page" as const) : null,
  });
  const nom = (l: Liste) => t(`liste.a.niveau.${l.replace(/-/g, "_")}`);
  const de = (ls: Liste[]) => ls.map((l) => tab(nom(l), `/registre/${l}`, l === liste));
  if (["communes", "intercommunalites", "departements"].includes(liste))
    return de(["communes", "intercommunalites", "departements"]);
  if (liste === "acheteurs")
    return [
      tab(t("liste.a.niveau.tous"), "/registre/acheteurs", !e.f.cat),
      ...CATS.map((c) =>
        tab(nomListe("acheteurs", c), `/registre/acheteurs?cat=${c}`, e.f.cat === c),
      ),
    ];
  if (DEFS[liste].kind)
    return de(["contrats", "modifications", "appels-d-offres", "arretes", "subventions"]);
  return [];
}

/** A filter's value in words: a département by its name, an intercommunality, a trade, a year. */
function nomValeur(f: Filtre, v: string, C: Corpus | null, P: Pick<Props, "couverture">): string {
  if (f === "dep") return `${nomDep(P, v)} (${v})`;
  if (f === "epci") return C?.L.epcis?.[v]?.nom ?? C?.L.acheteurs[v]?.nom ?? v;
  if (f === "naf") {
    const lib = Object.values(C?.L.entreprises ?? {}).find(
      (x) => (x as { naf?: string }).naf === v && (x as { naf_libelle?: string }).naf_libelle,
    ) as { naf_libelle?: string } | undefined;
    return lib?.naf_libelle ? `${lib.naf_libelle} (${v})` : v;
  }
  if (f === "depuis") return v;
  return motValeur(f, v);
}

export class ListeVue extends Vue<Props, State> {
  private def: Def = DEFS[this.props.liste];

  /** the latest page asked: an older answer is dropped */
  private n = 0;

  /** the row the address names (?ligne=): reached, then scrolled into view once */
  private cible: string | null = this.props.q?.ligne ?? null;
  private vise = false;
  private fini = false;

  protected init(p: Props): Partial<State> {
    let e = etatDe(DEFS[p.liste], p.q ?? {});
    const ligne = p.q?.ligne;
    // reopened on a row its default filters leave out (Lyon among the communes of 20 000 to
    // 100 000): the defaults lifted
    if (ligne && p.C && DEFS[p.liste].filtresDefaut) {
      const vu = appliquer(DEFS[p.liste], rangs(p.C, p.liste), e).list.some((x) => x.id === ligne);
      if (!vu) {
        const f = { ...e.f };
        for (const k of Object.keys(DEFS[p.liste].filtresDefaut ?? {}) as Filtre[])
          if (p.q?.[k] === undefined) delete f[k];
        e = { ...e, f };
      }
    }
    // a list of names reopened on a row: as many rows as it takes to show it
    let lim = PAS;
    if (ligne && p.C) {
      const i = appliquer(DEFS[p.liste], rangs(p.C, p.liste), e).list.findIndex(
        (x) => x.id === ligne,
      );
      if (i >= PAS) lim = PAS + Math.ceil((i + 1 - PAS) / PAS_NOMS) * PAS_NOMS;
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
      feuille: false,
      copie: false,
      autour: "",
    };
  }

  /** A list of documents: its first page in the state `e` (after a pause for typed words), or the
   * next one. */
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
    if (!document.querySelector(".v-liste tr.me")) return;
    this.vise = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.querySelector(".v-liste tr.me")?.scrollIntoView({ block: "center" }),
      ),
    );
  }
  /** The table's keys: ↑ ↓ go from row to row (its link focused), Enter follows the link. */
  private clavierTable: Handler = (ev) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const tr = (document.activeElement as Element | null)?.closest(".v-liste tbody tr");
    const all = [...document.querySelectorAll<HTMLElement>(".v-liste tbody tr")];
    const i = tr ? all.indexOf(tr as HTMLElement) : -1;
    const next = all[ev.key === "ArrowDown" ? i + 1 : Math.max(0, i - 1)];
    next?.querySelector<HTMLElement>("a")?.focus();
    ev.nativeEvent.preventDefault();
  };
  /** A row clicked outside its link follows its link (the board's rows are targets). */
  private ouvrir: Handler = (ev) => {
    if ((ev.target as Element | null)?.closest?.("a, button")) return;
    (ev.currentTarget as HTMLElement).querySelector<HTMLElement>("td[data-t] a")?.click();
  };
  /** « Copier le lien »: its address, filters and order with it. */
  private copierLien: Handler = () => {
    void navigator.clipboard?.writeText(location.href).then(() => {
      this.setState({ copie: true });
      setTimeout(() => {
        if (!this.fini) this.setState({ copie: false });
      }, 2000);
    });
  };
  private attente: ReturnType<typeof setTimeout> | undefined;
  componentWillUnmount(): void {
    clearTimeout(this.attente);
    this.n++;
    this.fini = true;
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
  }
  componentDidUpdate(): void {
    this.viser();
    // the state in the address, replaced (no new step in the history)
    const href = adresse(this.def, this.state.e);
    if (href !== `${location.pathname}${location.search}`)
      remplacerAdresse(`${href}${location.hash}`);
  }

  /** A level's link to the list shown (another category of buyers, or itself): the state its
   * address says, here, since the router keeps a view whose address it already drew. */
  private ici: Handler = (ev) => {
    const u = new URL((ev.currentTarget as HTMLAnchorElement).href, location.href);
    if (u.pathname !== location.pathname) return;
    ev.preventDefault();
    const e = etatDe(this.def, Object.fromEntries(u.searchParams));
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
  /** A filter of one value: chosen, or the same again: every value. */
  private filtrer(f: Filtre, v: string): Handler {
    return () =>
      this.set({ f: { ...this.state.e.f, [f]: v && this.state.e.f[f] !== v ? v : undefined } });
  }

  // --- the menus: « Classer par » (phone), and a filter's values (several at once) ---------------
  private basculerValeur(f: Filtre, v: string): Handler {
    return () => {
      const cur = choisis(this.state.e.f[f]);
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      this.set({ f: { ...this.state.e.f, [f]: next.join(",") || undefined } });
    };
  }
  /** A menu's first control, the one shown (a menu is drawn in the row of filters and in the
   * phone's panel, one of them hidden). */
  private focusDans(sel: string): void {
    requestAnimationFrame(() => {
      const all = [...document.querySelectorAll<HTMLElement>(sel)];
      all.find((x) => x.offsetParent !== null)?.focus();
    });
  }
  private ouvrirMenu(k: string): Handler {
    return () => {
      const open = this.state.menu !== k;
      this.setState({ menu: open ? k : null, menuQ: "" });
      if (open)
        this.focusDans(
          k === "tri"
            ? ".v-liste .tmenu [aria-selected=true], .v-liste .tmenu [role=option]"
            : ".v-liste .dmenu input, .v-liste .dmenu [role=option]",
        );
    };
  }
  private fermerMenu = (): void => {
    const m = this.state.menu;
    if (!m) return;
    this.setState({ menu: null });
    this.focusDans(`.v-liste .dancre.${m} > button`);
  };
  private clavierListe(sel: string): Handler {
    return (ev) => {
      const opts = [...document.querySelectorAll<HTMLElement>(sel)].filter(
        (x) => x.offsetParent !== null,
      );
      const i = opts.indexOf(document.activeElement as HTMLElement);
      if (ev.key === "Escape") this.fermerMenu();
      else if (ev.key === "ArrowDown") opts[Math.min(opts.length - 1, i + 1)]?.focus();
      else if (ev.key === "ArrowUp") (i > 0 ? opts[i - 1] : opts[0])?.focus();
      else if ((ev.key === " " || ev.key === "Enter") && i >= 0) opts[i].click();
      else return;
      ev.nativeEvent.preventDefault();
      ev.stopPropagation();
    };
  }
  /** A pointer down outside the open menu closes it. */
  private dehors = (ev: Event): void => {
    if (this.state.menu && !(ev.target as Element).closest?.(".v-liste .dancre")) this.fermerMenu();
  };

  /** A filter's menu: its values the list has (or chosen), each with its count and its box. */
  private menu(f: Filtre, c: Record<string, number>, total: number, k: TypeCle) {
    const S = this.state;
    const chosen = choisis(S.e.f[f]);
    const q = plain(S.menuQ.trim());
    const open = S.menu === f;
    const dyn = f === "dep" ? valeurs("dep") : Object.keys(c).filter((v) => v !== "");
    const have = dyn.filter((v) => c[v] || chosen.includes(v));
    const ordre =
      f === "dep"
        ? have
        : f === "depuis"
          ? have.sort((a, b) => b.localeCompare(a))
          : f === "naf"
            ? have.sort((a, b) => (c[b] ?? 0) - (c[a] ?? 0))
            : have.sort((a, b) =>
                nomValeur(f, a, this.props.C, this.props).localeCompare(
                  nomValeur(f, b, this.props.C, this.props),
                  "fr",
                ),
              );
    const tous = (open ? ordre : [])
      .map((v) => {
        const on = chosen.includes(v);
        return {
          v,
          nom: nomValeur(f, v, this.props.C, this.props),
          n: fr(c[v] ?? 0),
          on: on ? "true" : "false",
          cls: on ? "drow on" : "drow",
          pick: this.basculerValeur(f, v),
        };
      })
      .filter((d) => !q || d.v.startsWith(q) || plain(d.nom).includes(q));
    const l = t(`liste.a.filtre.${f}`);
    return {
      f,
      l:
        chosen.length === 1
          ? `${l} · ${nomValeur(f, chosen[0], this.props.C, this.props)}`
          : chosen.length
            ? `${l} · ${chosen.length}`
            : l,
      etat: chosen.length
        ? chosen.length === 1
          ? nomValeur(f, chosen[0], this.props.C, this.props)
          : fr(chosen.length)
        : t(`liste.a.tous.${f}`),
      ouvert: open ? "true" : "false",
      menu: open,
      basculer: this.ouvrirMenu(f),
      cherche: f !== "depuis",
      chercher: t("liste.a.chercher"),
      q: S.menuQ,
      onQ: ((ev) => this.setState({ menuQ: ev.value })) as Handler,
      tous,
      vide: open && tous.length === 0,
      clavier: this.clavierListe(".v-liste .dmenu [role=option]"),
      effacer: (() => this.set({ f: { ...this.state.e.f, [f]: undefined } })) as Handler,
      fermer: (() => this.fermerMenu()) as Handler,
      voir: t("liste.voir", { n: fr(total), quoi: pluriel(k).toLowerCase() }),
      chips: chosen.map((v) => ({
        l: nomValeur(f, v, this.props.C, this.props),
        ote: this.basculerValeur(f, v),
        aide: t("liste.dep.oter", { nom: nomValeur(f, v, this.props.C, this.props) }),
      })),
    };
  }

  /** « Autour de moi » (communes): the nearest commune's fiche, found on the device. */
  private autour: Handler = () => {
    const C = this.props.C;
    if (!navigator.geolocation || !C) {
      this.setState({ autour: "echec" });
      return;
    }
    this.setState({ autour: "cherche" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const k = plusProche([p.coords.longitude, p.coords.latitude], C.L.communes);
        if (!k) {
          this.setState({ autour: "echec" });
          return;
        }
        this.setState({ autour: "" });
        const a = document.createElement("a");
        a.href = communeHref(k);
        document.getElementById("registre")?.append(a);
        a.click();
        a.remove();
      },
      (e) => this.setState({ autour: e.code === e.PERMISSION_DENIED ? "refus" : "echec" }),
      { maximumAge: 600000, timeout: 15000 },
    );
  };

  private ouvrirFeuille: Handler = () => {
    this.setState({ feuille: true, menu: null });
    this.focusDans(".v-liste .fsheet button");
  };
  private fermerFeuille: Handler = () => {
    this.setState({ feuille: false, menu: null });
    this.focusDans(".v-liste .mctl2 .flt");
  };
  private clavierFeuille: Handler = (ev) => {
    if (ev.key === "Escape" && !this.state.menu) {
      ev.nativeEvent.preventDefault();
      this.fermerFeuille(ev);
    }
  };

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
    const n = comptesIndex(I) as Comptes;
    const wide = large();
    const arrow = (key: string) => (e.tri === key ? (e.dir < 0 ? " ▾" : " ▴") : "");
    const quoi = pluriel(k).toLowerCase();

    const sorts = def.tris.map((x) => ({
      l: x.l,
      on: e.tri === x.k ? "true" : "false",
      arrow: arrow(x.k),
      pick: this.trier(x.k),
      choisir: ((ev) => {
        this.trier(x.k)(ev);
        this.fermerMenu();
      }) as Handler,
    }));
    const triCourant = def.tris.find((x) => x.k === e.tri) ?? triDefaut(def);
    const tri = {
      l: triCourant.l,
      ouvert: S.menu === "tri" ? "true" : "false",
      menu: S.menu === "tri",
      basculer: this.ouvrirMenu("tri"),
      clavier: this.clavierListe(".v-liste .tmenu [role=option]"),
    };
    // « Avec arrêtés drones »: one key that holds
    const drones = def.filtres.includes("drones")
      ? {
          on: e.f.drones ? "true" : "false",
          n: fr((cpt.drones ?? {})["1"] ?? 0),
          basculer: this.filtrer("drones", "1"),
        }
      : null;
    // « Taille » (communes): the four sizes, each with its count
    const ct = cpt.taille ?? {};
    const tailles = def.filtres.includes("taille")
      ? TAILLES.map((v) => ({
          l: motValeur("taille", v),
          n: fr(ct[v] ?? 0),
          on: e.f.taille === v ? "true" : "false",
          cls: `rd${e.f.taille === v ? " on" : ""}`,
          pick: this.filtrer("taille", v),
        }))
      : null;
    // the other filters of one value (a département's state, a year, a device): keys
    const segs = def.filtres
      .filter((f) => !MENUS.includes(f) && f !== "drones" && f !== "taille" && f !== "cat")
      .map((f) => {
        const c = cpt[f] ?? {};
        const cur = e.f[f] ?? "";
        return {
          f,
          lbl: t(`liste.filtre.${f}`),
          keys: [
            {
              l: t(`liste.tous.${f}`),
              n: fr(c[""] ?? 0),
              on: cur ? "false" : "true",
              cls: `rd${cur ? "" : " on"}`,
              pick: (() => this.set({ f: { ...this.state.e.f, [f]: undefined } })) as Handler,
            },
            ...valeurs(f)
              .filter((v) => c[v] || cur === v)
              .map((v) => ({
                l: motValeur(f, v),
                n: fr(c[v] ?? 0),
                on: cur === v ? "true" : "false",
                cls: `rd${cur === v ? " on" : ""}`,
                pick: this.filtrer(f, v),
              })),
          ],
        };
      });
    const menus = def.filtres
      .filter((f) => MENUS.includes(f))
      .map((f) => this.menu(f, cpt[f] ?? {}, total, k));
    // the active filters, as chips (on a phone all of them; on a wide screen the menus' ones)
    const chipsMenus = menus.flatMap((m) => m.chips);
    const achips = [
      ...(e.f.taille
        ? [
            {
              l: motValeur("taille", e.f.taille),
              ote: this.filtrer("taille", ""),
              aide: t("liste.dep.oter", { nom: motValeur("taille", e.f.taille) }),
            },
          ]
        : []),
      ...segs.flatMap((g) =>
        e.f[g.f]
          ? [
              {
                l: motValeur(g.f, e.f[g.f] as string),
                ote: (() => this.set({ f: { ...this.state.e.f, [g.f]: undefined } })) as Handler,
                aide: t("liste.dep.oter", { nom: motValeur(g.f, e.f[g.f] as string) }),
              },
            ]
          : [],
      ),
      ...chipsMenus,
      ...(e.f.drones
        ? [
            {
              l: t("liste.avec_drones"),
              ote: this.filtrer("drones", ""),
              aide: t("liste.dep.oter", { nom: t("liste.avec_drones") }),
            },
          ]
        : []),
    ];
    const nActifs = def.filtres.filter((f) => f !== "cat" && e.f[f]).length;

    // the columns: the one of the order marked (its key, or one it stands for)
    const marque = (c: { tri?: string; alt?: string[] }) =>
      !!c.tri && (c.tri === e.tri || (c.alt ?? []).includes(e.tri));
    const cols = def.cols
      .filter((c) => !c.deps)
      .map((c) => ({
        l: c.l,
        cls: `${c.num ? "n" : ""}${marque(c) ? " srt" : ""}`,
        tri: !!c.tri,
        fixe: !c.tri,
        sort: marque(c) ? (e.dir < 0 ? "descending" : "ascending") : "none",
        arrow: marque(c) ? (e.dir < 0 ? " ▾" : " ▴") : "",
        pick: (c.tri ? this.trier(c.tri) : () => {}) as Handler,
      }));
    const rows = list.slice(0, S.lim).map((r, i) => {
      let j = 0;
      const cells = def.cols.flatMap((c) => {
        if (c.deps) return [];
        return [
          { cls: `${c.num ? "n" : ""}${marque(c) ? " srt" : ""}`, lbl: c.l, v: r.cells[j++] },
        ];
      });
      return {
        rk: i + 1,
        lien: [r.lien] as RichItem[],
        sous: r.sous,
        cells,
        cls: r.id === S.sel ? "me" : "",
        ouvrir: this.ouvrir,
      };
    });
    const filtre = !!e.q.trim() || def.filtres.some((f) => e.f[f]);
    const shown = Math.min(S.lim, list.length);
    const reste = total - shown;
    const pas = docs ? Math.min(PAS, reste) : Math.min(PAS_NOMS, reste);
    // the note under the table: how many, which; what the figures are (theme A's lists)
    const compte = t(filtre ? "liste.a.compte_filtre" : "liste.a.compte", {
      n: fr(total),
      quoi,
    });
    const premieres = shown < total ? ` · ${t("liste.a.premieres", { n: fr(shown) })}` : "";
    const explique =
      liste === "communes"
        ? ` ${t("liste.a.note.communes", { deps: I.totaux.deps_lus ?? 0 })}`
        : liste === "entreprises"
          ? ` ${t("liste.a.note.entreprises")}`
          : "";
    const titreA = t(`liste.a.titre.${liste.replace(/-/g, "_")}`);
    const nl = n.listes[liste];
    const lead: Rich =
      liste === "communes" || liste === "entreprises"
        ? [{ strong: t(`liste.a.lead_n.${liste}`, { n: fr(nl) }) }, t(`liste.a.lead.${liste}`)]
        : t(`liste.ligne.${liste.replace(/-/g, "_")}`, {
            n: nl,
            maj: I.maj.split("-").reverse().join("/"),
          });

    return {
      ...this.base("liste"),
      wide,
      title: liste === "acheteurs" && e.f.cat ? nomListe(liste, e.f.cat) : titreA,
      letters: coupe(liste === "acheteurs" && e.f.cat ? nomListe(liste, e.f.cat) : titreA),
      lead,
      q: e.q,
      onQ: ((ev) => this.set({ q: ev.value })) as Handler,
      exemple: t(
        `liste.a.exemple.${["communes", "entreprises"].includes(liste) ? liste : "autres"}`,
      ),
      autour: liste === "communes" ? this.autour : null,
      autourEtat: S.autour ? t(`accueil.autour_${S.autour}`) : "",
      niveaux: (() => {
        const ns = niveaux(liste, e).map((x) => ({ ...x, go: this.ici }));
        return ns.length ? ns : null;
      })(),
      sorts,
      tri,
      tailles,
      segs,
      menus,
      drones,
      ligneFiltres: !!(tailles || segs.length || menus.length || drones),
      filtrerLk: !tailles && (menus.length > 0 || segs.length > 0),
      achips: achips.length ? achips : null,
      dchips: chipsMenus.length ? chipsMenus : null,
      feuille: {
        open: S.feuille,
        l: nActifs ? t("liste.a.filtres_n", { n: nActifs }) : t("liste.a.filtres"),
        ouvrir: this.ouvrirFeuille,
        fermer: this.fermerFeuille,
        clavier: this.clavierFeuille,
        tailles: tailles
          ? [
              {
                l: t("liste.a.taille.toutes"),
                n: fr((cpt.taille ?? {})[""] ?? 0),
                on: e.f.taille ? "false" : "true",
                cls: `rd${e.f.taille ? "" : " on"}`,
                pick: this.filtrer("taille", ""),
              },
              ...tailles,
            ]
          : null,
        segs,
        menus: menus.length ? menus : null,
        voir: t("liste.a.voir_n", { n: fr(total), quoi }),
      },
      argent: def.argent,
      caption: t("liste.caption", { liste: nomListe(liste, e.f.cat) }),
      nomCol: def.nom,
      cols,
      rows,
      empty: list.length === 0 && !S.charge && !S.echec && (!docs || !!S.docs),
      etat: S.echec ? t("liste.echec") : S.charge && !list.length ? t("liste.chargement") : "",
      reset: (() =>
        this.set({ q: "", f: liste === "acheteurs" ? { cat: e.f.cat } : {} })) as Handler,
      hasMore: reste > 0 && !S.echec,
      moreL:
        reste <= pas
          ? t("liste.a.voir_tous", { n: fr(total) })
          : t("liste.a.voir_plus", { n: fr(pas) }),
      showMore: (() =>
        docs ? void this.pages(e, true) : this.setState({ lim: S.lim + PAS_NOMS })) as Handler,
      note: `${compte}${premieres}.${explique}`,
      exporter: (() =>
        docs
          ? void toutDemander(def, e, this.props).then(
              (rows) => enregistrer(`registre-${liste}.csv`, csv(def, rows)),
              () => this.setState({ echec: true }),
            )
          : enregistrer(`registre-${liste}.csv`, csv(def, list))) as Handler,
      arretes: liste === "arretes",
      resumeArretes: liste === "arretes" ? couvertureLiee(this.props.couverture) : null,
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
