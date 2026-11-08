// The graph centred on a company or a buyer (/registre/graphe/<siren>; redesign v3 lot 4, boards
// Graphe-plein, its phone and dark variants, and Graphe-grammaire): « Qui travaille avec qui ».
// In the middle the centre; around it, its partners (the first circle); at the edge, pale, the
// partners that work with one of them only; between two, full and with their count, those that
// work with several. Hovered or focused, a node keeps only its lines; clicked (Enter, a second
// tap), its detail in the side panel, with « Recentrer » (a new address: /registre/graphe/<it>).
// « Vue tableau » gives the same links as rows (?vue=tableau), « Exporter » every edge of the
// neighbourhood as CSV. Its data: the build's graph (graphe/aretes.json, legal persons only) and
// the companies' names (listes.json); an edge's amount is never summed with another's.

import { remplacerAdresse } from "../adresse.ts";
import { allerA } from "../bulle.ts";
import { buyerHref, depNom, entName, type Lexique } from "../corpus.ts";
import type { Handler, RichItem } from "../dc.ts";
import type { Acheteur } from "../donnees.ts";
import { Absent, load } from "../donnees.ts";
import { count } from "../format.ts";
import { t } from "../i18n.ts";
import type { Listes } from "../listes.ts";
import type { Miette, VueModule } from "../modale.ts";
import { partager } from "../partage.ts";
import type { Route } from "../routes.ts";
import { montantA, pleinEcran } from "../socle-a.ts";
import type { TypeCle } from "../types.ts";
import { type BaseState, large, type Partage, Vue } from "../vue.ts";
import { nomAcheteur } from "./accueil-outils.ts";
import "./graphe.css";
import template from "./graphe.html?raw";
import {
  autre,
  csvGraphe,
  type Dessin,
  disposer,
  estCommune,
  etiquette,
  type FichierGraphe,
  type Index,
  indexer,
  type NoeudG,
  plusRelies,
  point,
  type Role,
  role,
  type Second,
  tableau,
  type Voisinage,
  voisinage,
} from "./graphe-a.ts";

type Props = Extract<Route, { view: "graphe" }> & { G: FichierGraphe; X: Listes; I: Index };
type State = BaseState & { tab: boolean };
type AcheteurL = Acheteur & { dep?: string | null };

/** Rows of the table drawn at most (the CSV holds them all). */
const LIGNES_MAX = 200;
/** Shared nodes the « Au centre de l'enquête » card lists. */
const CENTRE_MAX = 6;
/** Partners a selection's panel lists. */
const SEL_MAX = 8;

/** Words with « *…* » as bold, the catalogue's mark for the boards' <b>. */
function gras(s: string): RichItem[] {
  return s
    .split("*")
    .map((x, i): RichItem => (i % 2 ? { strong: x } : x))
    .filter((x) => x !== "");
}
/** A name put in a sentence that marks its bold with « * ». */
const sansEtoile = (s: string): string => s.replace(/\*/g, "∗");
const ln = (xs: string[]): string => xs.filter(Boolean).join("\n");

/** The index of the build's edges, made once per file. */
const index = new WeakMap<FichierGraphe, Index>();
function indexDe(G: FichierGraphe): Index {
  let I = index.get(G);
  if (!I) {
    I = indexer(G.aretes);
    index.set(G, I);
  }
  return I;
}

class Graphe extends Vue<Props, State> {
  private gv: HTMLElement | null = null;
  private centrePour = "";
  private L: Lexique;
  private v: Voisinage | null;
  private d: Dessin | null;

  constructor(props: Props) {
    super(props);
    const X = props.X;
    // the buyers: the graph's own names (1 376 buyers are not in the lists' dictionary), the
    // dictionary's category and seat when it has them (a commune's fiche)
    const acheteurs: Record<string, Acheteur> = {};
    for (const [s, a] of Object.entries(props.G.acheteurs ?? {})) {
      const x = X.dico.acheteurs[s] as AcheteurL | undefined;
      acheteurs[s] = {
        ...x,
        nom: a.nom ?? x?.nom ?? "",
        nom_court: a.nom_court ?? x?.nom_court,
        ref: (x?.ref ?? a.ref) as Acheteur["ref"],
      };
    }
    this.L = { ...X.dico, acheteurs };
    const r = props.centre ? role(props.I, props.centre, props.q.role) : null;
    this.v = r ? voisinage(props.I, props.centre, r) : null;
    this.d = this.v ? disposer(this.v, (s) => this.court(s)) : null;
  }

  protected init(props: Props): Partial<State> {
    return { tab: props.q.vue === "tableau" };
  }

  // --- names and links ---------------------------------------------------------------------------
  private estAcheteur(s: string): boolean {
    if (!this.v) return s in this.L.acheteurs && !(s in this.L.entreprises);
    // in this graph, a node's side is its circle's
    if (s === this.v.centre) return this.v.role === "a";
    const premier = this.v.premiers.some((p) => p.id === s);
    return premier ? this.v.role === "e" : this.v.role === "a";
  }
  /** A node's words: a company's SIRENE name, a buyer's (a generic one completed, « Commune de
   * Lyon » drawn « Lyon »). */
  private court(s: string): string {
    return this.estAcheteur(s) ? this.courtAcheteur(s) : entName(this.L, s);
  }
  private courtAcheteur(s: string): string {
    const a = this.L.acheteurs[s] as AcheteurL | undefined;
    const nom = a?.nom_court || a?.nom;
    if (!nom)
      return t("commun.acheteur_siren", {
        siren: s.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3"),
      });
    return etiquette(nomAcheteur(a, this.L, depNom, nom));
  }
  private href(s: string): string | null {
    if (!this.estAcheteur(s)) {
      const x = this.L.entreprises[s];
      return x?.ref && !x.entrepreneur_individuel ? `/registre/entreprise/${s}` : null;
    }
    return buyerHref(this.L, s);
  }
  private lienCls(s: string): string {
    if (!this.estAcheteur(s)) return "ent";
    const h = this.href(s) ?? "";
    const a = this.L.acheteurs[s];
    return h.startsWith("/registre/commune/") || estCommune(a?.nom ?? "", a?.categorie)
      ? "ent com"
      : "ent ach";
  }
  private mention(s: string, l = this.court(s)) {
    const href = this.href(s);
    return { href: href ?? "", l, cls: this.lienCls(s), lien: href !== null, texte: href === null };
  }
  /** The graph's address of a node: its SIREN, its role said when it has both. */
  private recentrer(s: string, r: Role): string {
    const I = this.props.I;
    const deux = I.a.has(s) && I.e.has(s);
    return `/registre/graphe/${s}${deux ? `?role=${r === "a" ? "acheteur" : "entreprise"}` : ""}`;
  }

  titre(): string {
    return this.v ? t("graphe_a.onglet", { nom: this.court(this.v.centre) }) : t("graphe_a.titre");
  }
  etape(): string {
    return this.v ? this.court(this.v.centre) : t("graphe_a.fil");
  }
  type(): TypeCle {
    return "registre";
  }
  fil(): Miette[] {
    const m: Miette[] = [{ k: "registre", l: t("types.registre.l"), href: "/registre/" }];
    return this.v ? [...m, { k: "registre", l: t("graphe_a.fil"), href: "/registre/graphe" }] : m;
  }
  partage(): Partage | null {
    return { titre: this.titre() };
  }

  // --- the phone's window on the drawing: centred, panned, pinched ------------------------------
  componentDidMount(): void {
    this.brancher();
  }
  componentDidUpdate(): void {
    this.brancher();
  }
  componentWillUnmount(): void {
    this.debrancher();
  }
  private debrancher(): void {
    const el = this.gv;
    if (!el) return;
    el.removeEventListener("touchstart", this.pince0);
    el.removeEventListener("touchmove", this.pince);
    el.removeEventListener("touchend", this.pinceFin);
    this.gv = null;
  }
  private brancher(): void {
    const el = document.querySelector<HTMLElement>("#vue .v-graphe .gv");
    if (el !== this.gv) {
      this.debrancher();
      this.gv = el;
      if (el) {
        el.addEventListener("touchstart", this.pince0, { passive: true });
        el.addEventListener("touchmove", this.pince, { passive: false });
        el.addEventListener("touchend", this.pinceFin, { passive: true });
      }
    }
    if (!el || large()) return;
    const k = `${this.props.centre}|${this.state.tab}`;
    if (this.centrePour === k) return;
    this.centrePour = k;
    // the centre in the middle of the window (the board: the svg at 820 px, offset)
    const svg = el.querySelector("svg");
    if (!svg) return;
    const w = svg.getBoundingClientRect().width;
    el.scrollLeft = (w * 500) / 1000 - el.clientWidth / 2;
    el.scrollTop = (w * 450) / 1000 - el.clientHeight / 2;
  }
  private depart: { d: number; w: number; cx: number; cy: number } | null = null;
  private pince0 = (ev: TouchEvent): void => {
    const el = this.gv;
    const svg = el?.querySelector("svg");
    if (!el || !svg || ev.touches.length !== 2) return;
    const [a, b] = [ev.touches[0], ev.touches[1]];
    const r = el.getBoundingClientRect();
    this.depart = {
      d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
      w: svg.getBoundingClientRect().width,
      cx: (a.clientX + b.clientX) / 2 - r.left,
      cy: (a.clientY + b.clientY) / 2 - r.top,
    };
  };
  private pince = (ev: TouchEvent): void => {
    const el = this.gv;
    const svg = el?.querySelector<SVGSVGElement>("svg");
    if (!el || !svg || !this.depart || ev.touches.length !== 2) return;
    ev.preventDefault();
    const [a, b] = [ev.touches[0], ev.touches[1]];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const avant = svg.getBoundingClientRect().width;
    const w = Math.min(2000, Math.max(el.clientWidth, (this.depart.w * d) / this.depart.d));
    // the point under the fingers stays under them
    const fx = (el.scrollLeft + this.depart.cx) / avant;
    const fy = (el.scrollTop + this.depart.cy) / avant;
    svg.style.setProperty("width", `${w}px`, "important");
    el.scrollLeft = fx * w - this.depart.cx;
    el.scrollTop = fy * w - this.depart.cy;
  };
  private pinceFin = (ev: TouchEvent): void => {
    if (ev.touches.length < 2) this.depart = null;
  };

  // --- what the reader does -----------------------------------------------------------------------
  /** A node clicked (Enter, a second tap, « Ouvrir »): its detail, again to let it go; a node's
   * « +N »: the table view. A double click recentres (the board v1's « Double clic »). */
  private clic(k: string): Handler {
    return (ev) => {
      if (k.startsWith("+")) {
        if (k !== "+") this.basculer(true);
        return;
      }
      if ((ev.nativeEvent as MouseEvent).detail === 2) {
        allerA(this.recentrer(k, this.estAcheteur(k) ? "a" : "e"));
        return;
      }
      const sel = this.state.sel === k ? null : k;
      this.setState({ sel, vu: null });
      if (sel && !large())
        requestAnimationFrame(() => {
          const card = document.getElementById("gp-sel");
          const doux = !matchMedia("(prefers-reduced-motion: reduce)").matches;
          card?.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "nearest" });
        });
    };
  }
  /** Escape on a node lets the node chosen go (the bubble, when open, goes first: bulle.ts); the
   * register closes only when nothing is chosen. */
  private clavier: Handler = (ev) => {
    if (ev.key !== "Escape" || !this.state.sel || ev.nativeEvent.defaultPrevented) return;
    ev.preventDefault();
    this.setState({ sel: null });
  };
  private basculer(tab = !this.state.tab): void {
    const q = new URLSearchParams(location.search);
    if (tab) q.set("vue", "tableau");
    else q.delete("vue");
    const s = q.toString();
    remplacerAdresse(`${location.pathname}${s ? `?${s}` : ""}${location.hash}`);
    this.setState({ tab, vu: null });
  }
  private exporter: Handler = () => {
    const v = this.v;
    if (!v) return;
    const tetes = [
      "cercle",
      "acheteur_siren",
      "acheteur",
      "entreprise_siren",
      "entreprise",
      "montant",
      "contrats",
    ].map((k) => t(`graphe_a.csv_${k}`));
    const nomA = (s: string) => this.L.acheteurs[s]?.nom_court || this.L.acheteurs[s]?.nom || s;
    const nomE = (s: string) => entName(this.L, s);
    const corps = csvGraphe(v, tetes, nomA, nomE);
    const url = URL.createObjectURL(new Blob([corps], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `registre-graphe-${v.centre}.csv`;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // --- the drawing's words ------------------------------------------------------------------------
  private bulle(
    n: NoeudG,
    v: Voisinage,
    sec: Map<string, Second>,
  ): { bh: string; bl: string; bc: string } {
    const centre = this.court(v.centre);
    const e = v.role === "e";
    const I = this.props.I;
    if (n.sorte === "p") {
      const p = v.premiers.find((x) => x.id === n.k);
      const autres = ((e ? I.a : I.e).get(n.k)?.size ?? 1) - 1;
      return {
        bh: this.court(n.k),
        bl: ln([
          t("graphe_a.b_avec", { nom: centre, m: montantA(p?.m ?? 0) }),
          t(e ? "graphe_a.b_autres_f" : "graphe_a.b_autres_a", { n: autres }),
        ]),
        bc: t("graphe_a.clic_detail"),
      };
    }
    if (n.sorte === "g1")
      return {
        bh: `+${n.n}`,
        bl: ln([
          t(e ? "graphe_a.b_g1_e" : "graphe_a.b_g1_a", { n: n.n, nom: centre }),
          t("graphe_a.b_g1_l"),
        ]),
        bc: "",
      };
    if (n.sorte === "g2")
      return {
        bh: `+${n.n}`,
        bl: t(e ? "graphe_a.b_g2_e" : "graphe_a.b_g2_a", { n: n.n, nom: this.court(n.vers[0]) }),
        bc: t("graphe_a.clic_tableau"),
      };
    const s = sec.get(n.k);
    const liens = [...(s?.liens ?? [])].sort((a, b) => b[1].m - a[1].m);
    if (liens.length === 1) {
      const [c, l] = liens[0];
      return {
        bh: this.court(n.k),
        bl: ln([
          t(e ? "graphe_a.b_fournit" : "graphe_a.b_achete", {
            nom: this.court(c),
            m: montantA(l.m),
          }),
          t(e ? "graphe_a.b_seul_e" : "graphe_a.b_seul_a", { nom: centre }),
        ]),
        bc: t("graphe_a.clic_detail"),
      };
    }
    return {
      bh: this.court(n.k),
      bl: ln([
        t(e ? "graphe_a.b_pont_e" : "graphe_a.b_pont_a", { n: liens.length, nom: centre }),
        ...liens
          .slice(0, 6)
          .map(([c, l]) => t("graphe_a.b_ligne", { nom: this.court(c), m: montantA(l.m) })),
      ]),
      bc: t("graphe_a.clic_detail"),
    };
  }

  /** The words of the first circle: « ses 8 communes clientes », « ses 5 fournisseurs ». */
  private premiersMots(v: Voisinage): {
    k: "communes" | "clients" | "fournisseurs";
    txt: string;
  } {
    if (v.role === "a")
      return { k: "fournisseurs", txt: t("graphe_a.p_fournisseurs", { n: v.premiers.length }) };
    const communes = v.premiers.every((p) => {
      const a = this.L.acheteurs[p.id];
      return estCommune(a?.nom ?? "", a?.categorie);
    });
    const k = communes ? "communes" : "clients";
    return { k, txt: t(`graphe_a.p_${k}`, { n: v.premiers.length }) };
  }

  renderVals() {
    const S = this.state;
    const base = this.base("graphe");
    const actions = {
      chemin: `/registre/chemin${this.v ? `?de=${this.v.centre}` : ""}`,
      tabL: t(S.tab ? "graphe_a.vue_graphe" : "graphe_a.vue_tableau"),
      tabOn: S.tab ? "true" : "false",
      basculer: (() => this.basculer()) as Handler,
      exporter: this.exporter,
      partager: ((ev) => partager(this, ev.currentTarget)) as Handler,
    };
    const v = this.v;
    const d = this.d;
    if (!v || !d)
      return {
        ...base,
        ...actions,
        lead: t("graphe_a.choisir_lead"),
        choix: this.choix(),
        g: null,
        tb: null,
        side: null,
      };
    const e = v.role === "e";
    const centre = this.court(v.centre);
    const sec = new Map(v.seconds.map((s) => [s.id, s]));
    const pm = this.premiersMots(v);
    const lead = gras(
      t("graphe_a.lead", {
        centre: sansEtoile(centre),
        premiers: pm.txt,
        seconds: t(`graphe_a.s_${e ? "e" : "a"}${v.premiers.length === 1 ? "1" : ""}`, {
          n: v.seconds.length,
        }),
      }),
    );
    // the drawing: hovered or focused (else chosen), a node keeps only its lines
    const vu = S.vu ?? S.sel;
    const fc = (n: NoeudG): string => {
      if (n.sorte === "g1" || n.sorte === "g2") return `mo ${n.forme}`;
      if (n.sorte === "s") return n.forme === "e" ? "e1" : "a1";
      return n.forme === "e" ? "e2" : "a";
    };
    const noeuds = d.noeuds.map((n) => {
      const b = this.bulle(n, v, sec);
      const lab = n.lab;
      const groupe = n.sorte === "g1" || n.sorte === "g2";
      return {
        k: n.k,
        cls: `nd s-${n.sorte}${S.sel === n.k ? " on" : ""}${S.vu === n.k ? " vu" : ""}`,
        on: S.sel === n.k ? "true" : "false",
        role: n.sorte === "g1" ? "img" : "button",
        aria: groupe
          ? `${b.bh}, ${b.bl.split("\n")[0]}`
          : t("graphe_a.aria_noeud", { nom: this.court(n.k), m: montantA(n.m) }),
        ...b,
        rond: n.forme === "a",
        carre: n.forme === "e",
        fc: fc(n),
        x: n.x,
        y: n.y,
        z: n.z,
        rx: n.x - n.z,
        ry: n.y - n.z,
        s: 2 * n.z,
        badge:
          n.sorte === "b" ? { cx: n.x + n.z, cy: n.y - n.z, ty: n.y - n.z + 4.5, n: n.n } : null,
        plus: groupe ? { txt: `+${n.n}`, y: n.y + 4.5 } : null,
        lab: lab
          ? {
              cls: n.sorte === "p" ? "t0" : n.sorte === "b" ? "t2" : "t1",
              tr: lab.rot === null ? "" : `translate(${lab.x},${lab.y}) rotate(${lab.rot})`,
              x: lab.rot === null ? lab.x : 0,
              y: lab.rot === null ? lab.y : 4,
              anc: lab.anc,
              txt: lab.txt,
            }
          : null,
        pick: this.clic(n.k),
        hover: this.survol(n.k),
      };
    });
    const traits = d.traits.map((l) => ({
      ...l,
      cls: `l${l.more ? " more" : ""}${vu && (l.a === vu || l.b === vu) ? " hi" : ""}`,
    }));
    const groupes = d.noeuds.some((n) => n.sorte === "g1" || n.sorte === "g2");
    const tel = !large();
    const g = S.tab
      ? null
      : {
          titre: t("graphe_a.svg", { nom: centre }),
          cls: `g2${vu ? " foc" : ""}`,
          traits,
          noeuds,
          cE: e ? { x: 500 - d.centre.w / 2, w: d.centre.w } : null,
          cA: e ? null : { rx: d.centre.w / 2 },
          ctxt: d.centre.txt,
          quitter: this.quitter(),
          clavier: this.clavier,
          leg: {
            p: t(`graphe_a.leg_p_${pm.k}`),
            s: t(e ? "graphe_a.leg_s_e" : "graphe_a.leg_s_a"),
            b: t(e ? "graphe_a.leg_b_e" : "graphe_a.leg_b_a"),
            pA: !e,
            pE: e,
            plus: groupes ? { a: !e, e } : null,
          },
        };
    // the table view: the same links as rows, the columns the first circle drawn
    const rows = tableau(v, d.colonnes);
    const mx = Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => c?.m ?? 0)));
    const cols = d.colonnes.map((k) => ({ k, l: this.court(k) }));
    const tb = S.tab
      ? {
          note: t(e ? "graphe_a.tableau_note_e" : "graphe_a.tableau_note_a", { nom: centre }),
          h1: t(e ? "graphe_a.col_entreprise" : "graphe_a.col_acheteur"),
          h2: t(e ? "graphe_a.col_clients" : "graphe_a.col_fournisseurs"),
          cols,
          rows: rows.slice(0, LIGNES_MAX).map((r) => ({
            cls: r.pont ? "sh" : "",
            nom: this.mention(r.id),
            n: r.n,
            cells: r.cells.map((c, i) => {
              if (!c) return { col: cols[i].l, on: null };
              const dd = point(c.m, mx);
              return {
                col: cols[i].l,
                on: {
                  st: `width: ${dd}px; height: ${dd}px`,
                  m: montantA(c.m),
                  bh: `${this.court(r.id)} · ${cols[i].l}`,
                  bl: `${montantA(c.m)} · ${count(c.n, "contrat")}`,
                },
              };
            }),
          })),
          vide: rows.length === 0,
          plus:
            rows.length > LIGNES_MAX
              ? t("graphe_a.tableau_lignes", { n: rows.length - LIGNES_MAX })
              : "",
          caches: d.caches.length
            ? t("graphe_a.tableau_caches", { n: d.caches.length, nom: centre })
            : "",
        }
      : null;
    // the side: the selection, the shared ones, how to read
    const ponts = rows.filter((r) => r.pont);
    const side = {
      sel: S.sel ? this.selection(S.sel, v, sec) : null,
      ponts: ponts.length
        ? {
            h: t(e ? "graphe_a.centre_h_e" : "graphe_a.centre_h_a"),
            rows: ponts.slice(0, CENTRE_MAX).map((r) => {
              const s = sec.get(r.id) as Second;
              const ps = [...s.liens].sort((a, b) => b[1].m - a[1].m).map(([k]) => this.court(k));
              return { nom: this.mention(r.id), clients: ps.join(", "), n: r.n };
            }),
            plus:
              ponts.length > CENTRE_MAX
                ? t("graphe_a.centre_plus", { n: ponts.length - CENTRE_MAX })
                : "",
            note: t(e ? "graphe_a.centre_note_e" : "graphe_a.centre_note_a", { nom: centre }),
          }
        : null,
      lire: [
        gras(t("graphe_a.lire_1", { nom: sansEtoile(centre), premiers: pm.txt })),
        // the edge and the shared ones, when the drawing has some
        ...(d.noeuds.some((n) => n.sorte === "s" || n.sorte === "g2")
          ? [gras(t(`graphe_a.lire_2_${e ? (pm.k === "communes" ? "e" : "ec") : "a"}`))]
          : []),
        ...(d.noeuds.some((n) => n.sorte === "b")
          ? [gras(t(`graphe_a.lire_3_${e ? (pm.k === "communes" ? "e" : "ec") : "a"}`))]
          : []),
        gras(t(tel ? "graphe_a.lire_4_tel" : "graphe_a.lire_4")),
        ...(groupes ? [gras(t("graphe_a.lire_plus"))] : []),
      ],
    };
    return { ...base, ...actions, lead, choix: null, g, tb, side, pleinEcran };
  }

  /** The detail of the node chosen (« Cliquez : son détail ici »): who it is, its links in this
   * graph, « Recentrer », its fiche, the path from the centre. */
  private selection(k: string, v: Voisinage, sec: Map<string, Second>) {
    const e = v.role === "e";
    const centre = this.court(v.centre);
    const p = v.premiers.find((x) => x.id === k);
    const s = sec.get(k);
    if (!p && !s) return null;
    const forme: Role = p ? autre(v.role) : v.role;
    type Row = { nom: ReturnType<Graphe["mention"]>; c: string; m: string };
    let rows: Row[];
    let tag: string;
    let phrase: RichItem[];
    let note = "";
    let fc: string;
    if (p) {
      tag = t(e ? "graphe_a.sel_tag_p_e" : "graphe_a.sel_tag_p_a");
      phrase = gras(
        t("graphe_a.sel_p", {
          nom: sansEtoile(centre),
          m: montantA(p.m),
          contrats: count(p.n, "contrat"),
        }),
      );
      rows = v.seconds
        .filter((x) => x.liens.has(k))
        .map((x) => ({ id: x.id, l: x.liens.get(k) as { m: number; n: number } }))
        .sort((a, b) => b.l.m - a.l.m)
        .map((x) => ({ nom: this.mention(x.id), c: count(x.l.n, "contrat"), m: montantA(x.l.m) }));
      fc = forme === "e" ? "e2" : "a";
    } else {
      const sx = s as Second;
      const pont = sx.liens.size > 1;
      tag = t(pont ? "graphe_a.sel_tag_b" : e ? "graphe_a.sel_tag_s_e" : "graphe_a.sel_tag_s_a");
      phrase = gras(
        t(e ? "graphe_a.sel_fournit" : "graphe_a.sel_achete", {
          n: sx.liens.size,
          nom: sansEtoile(centre),
        }),
      );
      rows = [...sx.liens]
        .sort((a, b) => b[1].m - a[1].m)
        .map(([c, l]) => ({ nom: this.mention(c), c: count(l.n, "contrat"), m: montantA(l.m) }));
      const ailleurs = sx.degre - sx.liens.size;
      if (ailleurs > 0)
        note = t(e ? "graphe_a.sel_ailleurs_e" : "graphe_a.sel_ailleurs_a", { n: ailleurs });
      fc = pont ? (forme === "e" ? "e2" : "a") : forme === "e" ? "e1" : "a1";
    }
    const nom = this.court(k);
    return {
      tag,
      nom,
      rond: forme === "a",
      carre: forme === "e",
      fc,
      phrase,
      rows: rows.slice(0, SEL_MAX),
      plus: rows.length > SEL_MAX ? t("graphe_a.sel_plus", { n: rows.length - SEL_MAX }) : "",
      note,
      recentrer: this.recentrer(k, forme),
      recentrerL: t("graphe_a.recentrer", { nom }),
      fiche: this.href(k) ?? "",
      chemin: `/registre/chemin?de=${v.centre}&a=${k}`,
      cheminL: t("graphe_a.chemin_depuis", { nom: centre }),
    };
  }

  /** The page without a centre (the breadcrumb's « Graphe »): the most connected, as centres. */
  private choix() {
    const I = this.props.I;
    const liste = (r: Role) =>
      plusRelies(I, r, 8).map(({ id, d }) => ({
        href: this.recentrer(id, r),
        l: r === "e" ? entName(this.L, id) : this.courtAcheteur(id),
        n: t(r === "e" ? "graphe_a.n_clients" : "graphe_a.n_fournisseurs", { n: d }),
      }));
    return { e: liste("e"), a: liste("a") };
  }
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  if (r.view !== "graphe") return {};
  const [G, X] = await Promise.all([
    load<FichierGraphe>("graphe/aretes.json"),
    load<Listes>("listes.json"),
  ]);
  const I = indexDe(G);
  // a SIREN without any edge (a sole trader, a company outside the register): « introuvable »
  if (r.centre && !role(I, r.centre, r.q.role)) throw new Absent(r.centre);
  return { G, X, I };
}

export default {
  Vue: Graphe as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
