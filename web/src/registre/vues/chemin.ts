// « Chemin entre deux » (/registre/chemin?de=<siren|insee>&a=<siren|insee>; board Chemin-entre-deux
// of the redesign v3, lot 4, its phone and dark variants): two fields, De and À, each a search among
// the names of the national graph of contracts (graphe/aretes.json: the companies of listes.json,
// the buyers it names, a commune by its own name), ⇄ to swap them, « Trouver »; then 1 · the
// shortest paths, counted, the largest amounts first, each drawn step by step (its nodes, the
// amount on each link) and told in a sentence, « Voir dans le graphe → »; then « Ce qu'un chemin ne
// dit pas ». The paths are computed in the page (chemin-a.ts), on the build's graph; a commune given
// by its INSEE code is the buyer of that commune (its name in the graph, else its commune's file).

import { remplacerAdresse } from "../adresse.ts";
import { communeHref } from "../commun.ts";
import { depNom, entName } from "../corpus.ts";
import type { Handler, RichItem } from "../dc.ts";
import { EI, load } from "../donnees.ts";
import { fr, shortDate } from "../format.ts";
import { t } from "../i18n.ts";
import { phrase } from "../liens.ts";
import type { Listes } from "../listes.ts";
import type { Miette, VueModule } from "../modale.ts";
import { partager } from "../partage.ts";
import type { Route } from "../routes.ts";
import { coupeMots, montantA, repli } from "../socle-a.ts";
import { tidy } from "../texte.ts";
import type { TypeCle } from "../types.ts";
import { type BaseState, type Partage, Vue } from "../vue.ts";
import { nomAcheteur } from "./accueil-outils.ts";
import {
  type Arete,
  chercher,
  clauses,
  communeDuNom,
  type Entree,
  estCommune,
  type Graphe,
  graphe,
  indexCommunes,
  MAX_ETAPES,
  plusCourts,
  type Resultat,
  roles,
  type Chemin as Voie,
} from "./chemin-a.ts";
import "./chemin.css";
import template from "./chemin.html?raw";

/** graphe/aretes.json (A, 07/11): the edges, and the buyers named (a commune buyer is not in
 * listes.json). */
type Aretes = {
  v: number;
  maj: string;
  aretes: Arete[];
  acheteurs: Record<
    string,
    { nom?: string; nom_court?: string; nom_inconnu?: boolean; ref?: string }
  >;
};
type Props = Extract<Route, { view: "chemin" }> & { A: Aretes | null; X: Listes };
type Champ = "de" | "a";
/** A node as the page shows it: its name, its kind's words, its fiche, its colour's family. */
type Noeud = { nom: string; kind: string; href: string | null; fam: "com" | "ach" | "ent" };
/** A computed answer: the ends asked (as in the address), the SIRENs they are, the paths. */
type Calcul = { de: string; a: string; sde: string | null; sa: string | null; r: Resultat };
type Trouve = Extract<Resultat, { k: "trouve" }>;
type State = BaseState & {
  de: string;
  a: string;
  menu: Champ | "";
  q: string;
  calc: Calcul | null;
  enCours: boolean;
  /** a commune buyer's commune, read from its buyer's file (a homonym the names do not settle) */
  communes: Record<string, string>;
};

const SIREN = /^\d{9}$/;
const INSEE = /^\d[\dAB]\d{3}$/;
/** The buyers' categories that have their own words under a node (« département »…). */
const CATEGORIES = new Set(["departement", "region", "intercommunalite", "metropole"]);

/** What a graph's data give once (kept while the file lives): the graph, the communes by name,
 * a commune's buyer by its INSEE code, the fields' names. */
type Fonds = {
  G: Graphe;
  idx: Map<string, string[]>;
  parInsee: Map<string, string>;
  entrees: Entree[];
  nA: number;
  nE: number;
};
const tousFonds = new WeakMap<Aretes, Fonds>();

/** An edge's amount; 0 is one the contracts do not publish, never « 0 € ». */
const somme = (m: number, court = false): string =>
  m > 0 ? montantA(m) : t(court ? "chemin_a.m_inconnu_court" : "chemin_a.m_inconnu");

class Chemin extends Vue<Props, State> {
  private fini = false;
  private jeton = 0;

  protected init(p: Props): Partial<State> {
    return {
      de: p.q.de ?? "",
      a: p.q.a ?? "",
      menu: "",
      q: "",
      calc: null,
      enCours: false,
      communes: {},
    };
  }

  titre(): string {
    return t("chemin_a.titre");
  }
  type(): TypeCle {
    return "registre";
  }
  fil(): Miette[] {
    return [
      { k: "registre", l: t("types.registre.l"), href: "/registre/" },
      { k: "registre", l: t("chemin_a.graphe"), href: "/registre/graphe" },
    ];
  }
  partage(): Partage | null {
    const c = this.state.calc;
    if (!c) return { titre: t("chemin_a.titre") };
    return {
      titre: t("chemin_a.partage_titre", { de: this.noeud(c.de).nom, a: this.noeud(c.a).nom }),
    };
  }

  componentDidMount(): void {
    document.addEventListener("pointerdown", this.dehors, true);
    if (this.state.de && this.state.a) void this.calculer();
  }
  componentWillUnmount(): void {
    this.fini = true;
    document.removeEventListener("pointerdown", this.dehors, true);
  }

  /** The graph's data, built once per file; null when the graph is not served. */
  private fonds(): Fonds | null {
    const A = this.props.A;
    if (!A) return null;
    const deja = tousFonds.get(A);
    if (deja) return deja;
    const L = this.props.X.dico;
    const G = graphe(A.aretes);
    const idx = indexCommunes(L.communes);
    const parInsee = new Map<string, string>();
    const entrees: Entree[] = [];
    let nA = 0;
    for (const [s, a] of Object.entries(A.acheteurs)) {
      const n = G.get(s)?.size ?? 0;
      if (!n) continue;
      nA++;
      if (a.nom_inconnu || !(a.nom || a.nom_court)) continue;
      if (estCommune(a.nom ?? "")) {
        const insee = communeDuNom(a.nom ?? "", idx);
        if (insee) parInsee.set(insee, s);
        const c = insee ? L.communes[insee] : undefined;
        entrees.push({
          id: s,
          nom: c?.nom ?? tidy(a.nom),
          kind: c ? t("chemin_a.k_commune_dep", { dep: c.dep }) : t("chemin_a.k_commune"),
          poids: n,
        });
      } else {
        const nd = this.acheteur(s);
        entrees.push({ id: s, nom: nd.nom, kind: nd.kind, poids: n });
      }
    }
    for (const [s, e] of Object.entries(L.entreprises)) {
      const n = G.get(s)?.size ?? 0;
      if (!n || e.entrepreneur_individuel || s === EI) continue;
      entrees.push({ id: s, nom: entName(L, s), kind: t("chemin_a.k_entreprise"), poids: n });
    }
    const nE = new Set(A.aretes.map((x) => x[1])).size;
    const f = { G, idx, parInsee, entrees, nA, nE };
    tousFonds.set(A, f);
    return f;
  }

  /** A buyer that is not a commune: its name (a generic one completed), its kind, its fiche. */
  private acheteur(s: string): Noeud {
    const L = this.props.X.dico;
    const a = this.props.A?.acheteurs[s];
    const d = L.acheteurs[s];
    const nom = nomAcheteur(
      { ...d, nom: d?.nom || a?.nom, nom_court: d?.nom_court || a?.nom_court },
      L,
      depNom,
      t("commun.acheteur_siren", { siren: s.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3") }),
    );
    const cat = d?.categorie ?? "";
    const ref = d?.ref ?? a?.ref;
    return {
      nom,
      kind: t(CATEGORIES.has(cat) ? `chemin_a.k_${cat}` : "chemin_a.k_acheteur"),
      href: ref ? `/registre/${ref}` : null,
      fam:
        cat === "departement" || cat === "intercommunalite" || cat === "metropole" ? "com" : "ach",
    };
  }

  /** A node by its id: a commune (its INSEE code), a company or a buyer (its SIREN); `role` the
   * part its path gives it (a SIREN on both sides of the graph). */
  private noeud(id: string, role?: "a" | "e"): Noeud {
    const L = this.props.X.dico;
    if (INSEE.test(id)) {
      const c = L.communes[id];
      return {
        nom: c?.nom ?? id,
        kind: t("chemin_a.k_commune"),
        href: c?.ref ? communeHref(id) : null,
        fam: "com",
      };
    }
    const ach = this.props.A?.acheteurs[id];
    const ent = L.entreprises[id];
    if (role === "e" || (!role && ent) || !ach) {
      const href = ent?.ref && !ent.entrepreneur_individuel ? `/registre/entreprise/${id}` : null;
      return { nom: entName(L, id), kind: t("chemin_a.k_entreprise"), href, fam: "ent" };
    }
    if (estCommune(ach.nom ?? "")) {
      const f = this.fonds();
      const insee = this.state.communes[id] ?? (f ? communeDuNom(ach.nom ?? "", f.idx) : null);
      const c = insee ? L.communes[insee] : undefined;
      return {
        nom: c?.nom ?? tidy(ach.nom),
        kind: t("chemin_a.k_commune"),
        href: insee && c?.ref ? communeHref(insee) : ach.ref ? `/registre/${ach.ref}` : null,
        fam: "com",
      };
    }
    return this.acheteur(id);
  }

  /** An end asked (a SIREN, an INSEE code) as the graph's SIREN: a commune is its own buyer, by
   * its name in the graph, else by its commune's file. */
  private async siren(id: string): Promise<string | null> {
    if (SIREN.test(id)) return id;
    if (!INSEE.test(id)) return null;
    const s = this.fonds()?.parInsee.get(id);
    if (s) return s;
    try {
      const f = await load<{
        acheteurs?: Record<string, { categorie?: string; insee_siege?: string | null }>;
      }>(`commune/${id}.json`);
      for (const [k, a] of Object.entries(f.acheteurs ?? {}))
        if (a.categorie === "commune" && a.insee_siege === id) return k;
    } catch {
      // a commune the register does not hold: no buyer
    }
    return null;
  }

  /** The paths between the two ends chosen; the communes the names leave unsettled (a few
   * homonyms) read from their buyers' files before the answer is drawn. */
  private async calculer(): Promise<void> {
    const f = this.fonds();
    const { de, a } = this.state;
    if (!f || !de || !a) return;
    const j = ++this.jeton;
    this.setState({ enCours: true });
    const [sde, sa] = await Promise.all([this.siren(de), this.siren(a)]);
    let r: Resultat;
    if (sde && sa) r = plusCourts(f.G, sde, sa);
    else if (de === a) r = { k: "meme" };
    else
      r = {
        k: "absent",
        qui: [
          ...(sde && f.G.has(sde) ? [] : ["de" as const]),
          ...(sa && f.G.has(sa) ? [] : ["a" as const]),
        ],
      };
    const ids = new Set<string>([sde ?? "", sa ?? ""]);
    if (r.k === "trouve") for (const c of r.chemins) for (const v of c.noeuds) ids.add(v);
    const A = this.props.A;
    const flous = [...ids].filter((s) => {
      const n = A?.acheteurs[s];
      return (
        n?.ref &&
        estCommune(n.nom ?? "") &&
        !communeDuNom(n.nom ?? "", f.idx) &&
        !this.state.communes[s]
      );
    });
    const lus = await Promise.all(
      flous.map((s) =>
        load<{ acheteur?: { page_commune?: string | null } }>(`${A?.acheteurs[s]?.ref}.json`).then(
          (x) => [s, x.acheteur?.page_commune ?? ""] as const,
          () => [s, ""] as const,
        ),
      ),
    );
    if (this.fini || j !== this.jeton) return;
    const communes = { ...this.state.communes };
    for (const [s, insee] of lus) if (insee) communes[s] = insee;
    this.setState({ calc: { de, a, sde, sa, r }, enCours: false, communes });
  }

  /** « Trouver »: the address says the two ends (a share, a reload give the same page). */
  private trouver = (): void => {
    const { de, a } = this.state;
    if (!de || !a) return;
    const u = new URLSearchParams(location.search);
    u.set("de", de);
    u.set("a", a);
    remplacerAdresse(`${location.pathname}?${u}`);
    void this.calculer();
  };
  /** ⇄: the two ends swapped; paths already shown are reversed at once. */
  private inverser = (): void => {
    const { de, a, calc } = this.state;
    this.setState({ de: a, a: de, menu: "" });
    if (calc && a && de) this.trouver();
  };

  /** A pointer down outside the open field closes its menu. */
  private dehors = (ev: Event): void => {
    if (this.state.menu && !(ev.target as Element).closest?.(".v-chemin .dancre"))
      this.setState({ menu: "", q: "" });
  };

  private focus(sel: string): void {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.v-chemin ${sel}`)?.focus());
  }

  /** A field, De or À: its words, and its menu (a search, the names as a listbox); arrows move,
   * Enter or a click chooses, Escape closes, the focus back on the field. */
  private champ(k: Champ, f: Fonds | null) {
    const open = this.state.menu === k;
    const id = this.state[k];
    const nd = id ? this.noeud(id) : null;
    const opts = open && f ? chercher(f.entrees, this.state.q) : [];
    const fermer = () => {
      this.setState({ menu: "", q: "" });
      this.focus(`.f-${k} > .fld`);
    };
    return {
      cls: `dancre f-${k}`,
      l: t(`chemin_a.${k}`),
      nom: nd?.nom ?? t("chemin_a.choisir"),
      kind: nd?.kind ?? "",
      lab: t(`chemin_a.q_${k}`),
      ouvert: open ? "true" : "false",
      menu: open,
      swap: k === "de",
      basculer: (() => {
        this.setState({ menu: open ? "" : k, q: "" });
        if (!open) this.focus(`.f-${k} input`);
      }) as Handler,
      opts: opts.map((o) => ({
        nom: o.nom,
        kind: o.kind,
        choisir: (() => {
          this.setState({ [k]: o.id, menu: "", q: "" } as Partial<State>);
          const autre = k === "de" ? this.state.a : this.state.de;
          this.focus(autre ? ".pair2 .btn.pri" : `.f-${k} > .fld`);
        }) as Handler,
      })),
      vide: !open
        ? ""
        : !this.state.q.trim()
          ? t("chemin_a.taper")
          : opts.length
            ? ""
            : t("chemin_a.rien"),
      clavier: ((ev) => {
        const os = [...document.querySelectorAll<HTMLElement>(`.v-chemin .f-${k} [role=option]`)];
        const champ = document.querySelector<HTMLElement>(`.v-chemin .f-${k} input`);
        const i = os.indexOf(document.activeElement as HTMLElement);
        if (ev.key === "Escape") fermer();
        else if (ev.key === "ArrowDown") os[Math.min(os.length - 1, i + 1)]?.focus();
        else if (ev.key === "ArrowUp") (i > 0 ? os[i - 1] : champ)?.focus();
        else if (ev.key === "Enter") (i >= 0 ? os[i] : os[0])?.click();
        else if (ev.key === " " && i >= 0) os[i].click();
        else return;
        ev.nativeEvent.preventDefault();
        ev.stopPropagation();
      }) as Handler,
    };
  }

  private onQ: Handler = (ev) => this.setState({ q: ev.value });

  /** A mention in a sentence: its fiche's link (every mention that has its fiche is one), bold the
   * first time (the board's), its family's underline. */
  private mention(n: Noeud, premiere: boolean): RichItem {
    if (!n.href) return premiere ? { strong: n.nom } : n.nom;
    const fam = n.fam === "com" ? " com" : n.fam === "ach" ? " ach" : "";
    return { a: { href: n.href, text: n.nom, cls: `ent${fam}${premiere ? "" : " re"}` } };
  }

  /** The answer's sentence: together or not, and through whom (the layers of every shortest path:
   * one node named, several counted). */
  private reponse(c: Calcul, r: Trouve): RichItem[] {
    const de = this.noeud(c.de);
    const a = this.noeud(c.a);
    if (r.etapes === 1) {
      const l = r.chemins[0].liens[0];
      return phrase("chemin_a.ans_direct", {
        de: this.mention(de, true),
        a: this.mention(a, true),
        n: l.n,
        m: somme(l.m),
      });
    }
    const out: RichItem[] = [
      ...phrase("chemin_a.ans_sans", { de: this.mention(de, true), a: this.mention(a, true) }),
      " ",
    ];
    const rl = roles(r.chemins[0]);
    const nomme = (i: number) => this.noeud(r.couches[i - 1][0], rl[i]);
    const role = (n: Noeud, i: number, pluriel: boolean) =>
      t(
        rl[i] === "e"
          ? pluriel
            ? "chemin_a.roles_fournisseur"
            : "chemin_a.role_fournisseur"
          : pluriel
            ? "chemin_a.roles_client"
            : n.kind === t("chemin_a.k_commune")
              ? "chemin_a.role_cliente"
              : "chemin_a.role_client",
      );
    const combien = (i: number) =>
      t(rl[i] === "e" ? "chemin_a.n_entreprises" : "chemin_a.n_acheteurs", {
        n: r.couches[i - 1].length,
      });
    const span = (x: RichItem[]): RichItem => ({ span: x, cls: "" });
    if (r.etapes === 2) {
      const n1 = nomme(1);
      const p =
        r.couches[0].length === 1
          ? phrase("chemin_a.p_un_deux", { x: this.mention(n1, true), role: role(n1, 1, false) })
          : phrase("chemin_a.p_plus_deux", { n: combien(1), role: role(n1, 1, true) });
      return [...out, ...phrase("chemin_a.ans_par", { p: span(p) })];
    }
    if (r.etapes === 3) {
      const [L1, L2] = r.couches;
      const n1 = nomme(1);
      const n2 = nomme(2);
      const p1 =
        L1.length === 1
          ? phrase("chemin_a.p_un", {
              x: this.mention(n1, true),
              role: role(n1, 1, false),
              y: this.mention(de, false),
            })
          : phrase("chemin_a.p_plus", {
              n: combien(1),
              role: role(n1, 1, true),
              y: this.mention(de, false),
            });
      const p2 =
        L2.length === 1
          ? phrase("chemin_a.p_un", {
              x: this.mention(n2, true),
              role: role(n2, 2, false),
              y: this.mention(a, false),
            })
          : L1.length === 1
            ? phrase(rl[2] === "e" ? "chemin_a.p_plus_e" : "chemin_a.p_plus_a", {
                n: combien(2),
                x: this.mention(n1, false),
                y: this.mention(a, false),
              })
            : phrase("chemin_a.p_plus", {
                n: combien(2),
                role: role(n2, 2, true),
                y: this.mention(a, false),
              });
      return [...out, ...phrase("chemin_a.ans_par2", { p1: span(p1), p2: span(p2) })];
    }
    return [...out, t("chemin_a.ans_loin_k", { n: r.etapes - 1 })];
  }

  /** A path's sentence, as the board tells it: its clauses, each name a link, bold the first time. */
  private phraseChemin(c: Voie, ns: Noeud[]): RichItem[] {
    const vus = new Set<number>();
    const m = (i: number) => {
      const p = !vus.has(i);
      vus.add(i);
      return this.mention(ns[i], p);
    };
    const out: RichItem[] = [];
    for (const cl of clauses(c)) {
      const l = c.liens[cl.i];
      const mt = somme(l.m);
      if (cl.mot === "contrat") {
        const x = m(cl.x);
        out.push(...phrase("chemin_a.c_contrat", { x, y: m(cl.y), n: l.n, m: mt }));
      } else if (cl.mot === "fournisseur" || cl.mot === "client") {
        const x = m(cl.x);
        out.push(
          " ",
          ...phrase(`chemin_a.c_${cl.mot}`, { x, y: m(cl.y), m: mt, fin: cl.fin ? 1 : 0 }),
        );
      } else out.push(...phrase(`chemin_a.c_${cl.mot}`, { y: m(cl.y), m: mt }));
    }
    return out;
  }

  /** A path drawn: its nodes and links (the board's .chain), with their bubbles. */
  private carte(c: Voie, i: number, k: number, G: Graphe) {
    const rl = roles(c);
    const ns = c.noeuds.map((v, j) => this.noeud(v, rl[j]));
    const items: Record<string, unknown>[] = [];
    c.noeuds.forEach((v, j) => {
      const n = ns[j];
      const voisins = G.get(v)?.size ?? 0;
      items.push({
        cls: `nd ${rl[j]}`,
        nom: n.nom,
        kind: n.kind,
        href: n.href,
        sans: !n.href,
        bl: [
          n.kind,
          t(rl[j] === "a" ? "chemin_a.b_voisins_a" : "chemin_a.b_voisins_e", { n: voisins }),
        ].join("\n"),
        bc: n.href ? t("chemin_a.b_ouvrir") : "",
      });
      const l = c.liens[j];
      if (l)
        items.push({
          lk: true,
          m: somme(l.m, true),
          bh: t("chemin_a.b_lien", { x: n.nom, y: ns[j + 1].nom }),
          bl: [t("chemin_a.b_contrats", { n: l.n, m: somme(l.m) }), t("chemin_a.b_plafond")].join(
            "\n",
          ),
        });
    });
    // the graph centred on the path's middle node (its own hub; the head's « Le graphe » is De's)
    const milieu = c.noeuds[Math.floor(c.noeuds.length / 2)];
    return {
      cls: i === 0 ? "card ch first" : "card ch",
      k: t("chemin_a.carte_k", { i: i + 1, k }),
      lab: t("chemin_a.chaine", { i: i + 1 }),
      go: `/registre/graphe/${milieu}`,
      chaine: k > 4 ? "chain long" : "chain",
      items,
      phrase: this.phraseChemin(c, ns),
    };
  }

  /** Section 1: the answer to the two ends asked, or why there is none; absent before a search. */
  private resultat(f: Fonds | null) {
    const vide = { ans: "" as RichItem[] | string, chemins: [] as unknown[], plus: "", lgd: false };
    if (!f) return { ...vide, h: t("chemin_a.h_non_lu"), nonLu: true };
    const c = this.state.calc;
    if (!c) return this.state.enCours ? { ...vide, h: t("chemin_a.h_calcul") } : null;
    const r = c.r;
    if (r.k === "meme") return { ...vide, h: t("chemin_a.h_meme"), ans: t("chemin_a.ans_meme") };
    if (r.k === "absent") {
      const qui = r.qui[0] === "de" ? c.de : c.a;
      const L = this.props.X.dico;
      const connu = INSEE.test(qui)
        ? !!L.communes[qui]
        : !!(L.entreprises[qui] || L.acheteurs[qui] || this.props.A?.acheteurs[qui]);
      return {
        ...vide,
        h: t("chemin_a.h_aucun"),
        ans: connu
          ? phrase("chemin_a.ans_absent", { x: this.mention(this.noeud(qui), true) })
          : t("chemin_a.ans_inconnu"),
      };
    }
    const de = this.mention(this.noeud(c.de), true);
    const a = this.mention(this.noeud(c.a), true);
    if (r.k === "aucun")
      return {
        ...vide,
        h: t("chemin_a.h_aucun"),
        ans:
          r.d === null
            ? phrase("chemin_a.ans_isoles", { de, a })
            : phrase("chemin_a.ans_loin", { de, a, d: r.d, max: MAX_ETAPES }),
      };
    return {
      h: t("chemin_a.h_trouve", { n: r.total, k: r.etapes }),
      ans: this.reponse(c, r),
      chemins: r.chemins.map((x, i) => this.carte(x, i, r.etapes, f.G)),
      plus:
        r.total > r.chemins.length
          ? t("chemin_a.plus", { n: r.chemins.length, total: fr(r.total) })
          : "",
      lgd: true,
    };
  }

  private basculer = (k: string): void =>
    this.setState({ open: { ...this.state.open, [k]: !this.state.open[k] } });

  renderVals() {
    const f = this.fonds();
    const A = this.props.A;
    const S = this.state;
    const sde = S.calc?.de === S.de ? S.calc.sde : SIREN.test(S.de) ? S.de : null;
    return {
      ...this.base("chemin"),
      letters: coupeMots(t("chemin_a.nom")),
      champs: [this.champ("de", f), this.champ("a", f)],
      q: S.q,
      onQ: this.onQ,
      inverser: this.inverser as Handler,
      trouver: this.trouver as Handler,
      incomplet: !(S.de && S.a) || !A,
      partager: ((ev) => partager(this, ev.currentTarget)) as Handler,
      grapheHref: sde ? `/registre/graphe/${sde}` : "/registre/graphe",
      r: this.resultat(f),
      srcs: {
        r: repli(S.open, "srcs", t("chemin_a.voir_detail"), 3, this.basculer, "card srcs"),
        rows: [
          { cls: "part", l: phrase("chemin_a.cov1", { b: { strong: t("chemin_a.cov1_b") } }) },
          {
            cls: "part",
            l: phrase("chemin_a.cov2", {
              b: { strong: t("chemin_a.cov2_b", { n: MAX_ETAPES }) },
            }),
          },
          { cls: "ok", l: t("chemin_a.cov3") },
        ],
        // recette 31: one figure per thing, the build's (listes.json `comptes.listes`, the
        // accueil's « 1 195 entreprises · 968 acheteurs »), the collectivities said apart — the
        // graph's own count (2 093 buyers with an edge) took them in under the same word
        note:
          A && f
            ? this.props.X.comptes?.listes
              ? t("chemin_a.note_listes", {
                  date: shortDate(A.maj),
                  na: t("chemin_a.n_acheteurs", { n: this.props.X.comptes.listes.acheteurs }),
                  ne: t("chemin_a.n_entreprises", { n: this.props.X.comptes.listes.entreprises }),
                })
              : t("chemin_a.note", {
                  date: shortDate(A.maj),
                  na: t("chemin_a.n_acheteurs", { n: f.nA }),
                  ne: t("chemin_a.n_entreprises", { n: f.nE }),
                })
            : t("chemin_a.note_non_lu"),
      },
    };
  }
}

/** The graph and the names, asked together; a graph not served yet leaves the page « non lu ». */
async function donnees(): Promise<Record<string, unknown>> {
  const [A, X] = await Promise.all([
    load<Aretes>("graphe/aretes.json").catch(() => null),
    load<Listes>("listes.json"),
  ]);
  return { A, X };
}

export default {
  Vue: Chemin as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
