// The register's home (/registre/; board Accueil-Registre-A of the redesign v3, its phone and dark
// variants): its name cut out, what it covers, the search across the register with its results by
// type, « Essayer » and « Autour de moi », the four figures, « Par où commencer » (four entries,
// Ju 07/11), « Cette semaine » (the latest documents; « Publiés avant le vol ? » « non lu », not
// served), « La France en un coup d'œil » (the départements drawn by the build, four measures; the
// largest contracts), « Comment ça marche » and the sources. It opens on index.json and
// couverture.json; the map's measures (listes.json) and outlines (geo/departements.json) are asked
// once drawn, as « Autour de moi » (the communes' points: the distance is reckoned here, the
// position never leaves the device) and the search (the names, and the search API's documents).
// The old addresses (/registre/chiffres, /registre/?t=…) are replaced by their list's before
// anything is drawn (listes.ts redirection).

import { communeHref } from "../commun.ts";
import { entName, type Index, type Lexique, titre as titreDoc } from "../corpus.ts";
import type { Handler, RichItem } from "../dc.ts";
import type { Evenement } from "../donnees.ts";
import { load } from "../donnees.ts";
import { fr } from "../format.ts";
import { t } from "../i18n.ts";
import { departementHref, lienDepartement } from "../liens.ts";
import {
  type Comptes,
  type Corpus,
  type CouvertureX,
  chercherDocuments,
  chercherNoms,
  comptesIndex,
  corpus,
  demander,
  type Groupe,
  grouper,
  type Listes,
  lienTrouve,
  nomDep,
  ordonner,
  redirection,
} from "../listes.ts";
import type { VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { coupeMots, montantA, pleinEcran, plusProche, repli } from "../socle-a.ts";
import { plain } from "../texte.ts";
import { pluriel, type TypeCle } from "../types.ts";
import { type BaseState, large, Vue } from "../vue.ts";
import {
  avantVol,
  casseNormale,
  jourDoc,
  nomAcheteur,
  ONGLETS,
  type Onglet,
  ordreDeps,
  type Publication,
  QUESTION,
  recentes,
} from "./accueil-outils.ts";
import "./sommaire.css";
import { vraiDepartement } from "./listes-outils.ts";
import template from "./sommaire.html?raw";

/** geo/departements.json (the build's, IGN Admin Express COG Carto): the métropole drawn in pixels
 * of a 660 × 640 picture, each département its path; the overseas ones listed, not drawn. */
export type Geo = {
  attribution: string;
  largeur: number;
  hauteur: number;
  departements: Record<string, { nom: string; d: string }>;
  outre_mer: { code: string; nom: string }[];
};
type Ligne = {
  n: number;
  con: number;
  aut: number;
  amt: number;
  carte?: number;
  cam?: number;
  dr?: number;
};

/** The map's four measures and their classes (the board's « Argent » five classes; the others in
 * the same spirit, from little to much). */
export const MESURES = ["argent", "cameras", "arretes", "drones"] as const;
export type Mesure = (typeof MESURES)[number];
const SEUILS: Record<Mesure, number[]> = {
  argent: [2e6, 8e6, 20e6, 50e6],
  cameras: [200, 500, 1000, 2500],
  arretes: [100, 300, 700, 1500],
  drones: [20, 50, 100, 250],
};
const valeur = (m: Mesure, o: Ligne | undefined): number | null => {
  if (!o) return null;
  const v = m === "argent" ? o.amt : m === "cameras" ? o.carte : m === "arretes" ? o.cam : o.dr;
  return typeof v === "number" ? v : null;
};
export function classe(m: Mesure, v: number | null): number {
  if (v == null) return 0;
  return SEUILS[m].filter((s) => v >= s).length;
}

/** A path's middle: the mean of its points (labels and bubbles). */
export function milieu(d: string): [number, number] {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let x = 0;
  let y = 0;
  let k = 0;
  for (let i = 0; i + 1 < n.length; i += 2) {
    x += n[i];
    y += n[i + 1];
    k++;
  }
  return k ? [x / k, y / k] : [0, 0];
}

/** A département's label on the map, short (the board's « B.-du-Rhône », « Alpes-Mar. »). */
export function court(nom: string): string {
  if (nom.length <= 10) return nom;
  const s = nom
    .replace(/^Bouches-du-/, "B.-du-")
    .replace(/-Maritimes$/, "-Mar.")
    .replace(/-Saint-/, "-St-");
  return s.length <= 12 ? s : `${s.slice(0, 10)}.`;
}

const TOUT: Record<Onglet, string> = {
  tous: "/registre/contrats",
  contrats: "/registre/contrats",
  arretes: "/registre/arretes",
  drones: "/registre/arretes?disp=dr",
};
/** A document's kind as the board writes it (« Drones », « Attribution », « Appel d'offres »). */
const dk = (tt: string): string =>
  tt === "arrete_drone"
    ? "drones"
    : tt === "resultat"
      ? "attribution"
      : /^(avis|rectificatif)$/.test(tt)
        ? "ao"
        : tt === "attribution"
          ? "contrat"
          : tt === "modification"
            ? "modification"
            : tt.startsWith("subvention")
              ? "subvention"
              : "arrete";
const minuscule = (s: string): string => (s ? s[0].toLocaleLowerCase("fr") + s.slice(1) : s);
const jourMois = (d: string): string => {
  const x = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
  return x.format(new Date(`${d.slice(0, 10)}T12:00:00Z`));
};

/** « Publiés avant le vol ? » as the card draws it: the sentence saying on which acts, the bar. */
function carteVol(p: Publication | null | undefined, X: Listes | null) {
  const v = avantVol(p);
  if (v.nonLu)
    return { nonLu: true, lu: false, phrase: [] as RichItem[], parts: [], ailleurs: false };
  // the départements by their drone acts, the most first (accueil-outils.ts `ordreDeps`)
  const deps = ordreDeps(v.deps, X ? (d) => X.lignes.departements[d]?.dr : undefined);
  const noms = deps.map((d) => t(`departement.du_${d}`));
  const ou = noms.length ? new Intl.ListFormat("fr", { type: "conjunction" }).format(noms) : "";
  const cls = { avant: "p-ok", jour_meme: "p-mid", apres: "p-late" };
  return {
    nonLu: false,
    lu: true,
    phrase: [
      t("accueil.avant_vol_sur_a"),
      { strong: t("accueil.avant_vol_sur_n", { n: fr(v.total) }) },
      ou ? t("accueil.avant_vol_sur_deps", { deps: ou }) : t("accueil.avant_vol_sur_seuls"),
    ] as RichItem[],
    parts: v.parts.map((x) => ({
      cls: `seg ${cls[x.k]}`,
      st: `flex: ${Math.max(x.pct, 1)}`,
      l: x.pct >= 6 ? t("accueil.pct", { n: x.pct }) : "",
      sw: `sw ${cls[x.k]}`,
      leg: t(`accueil.vol_${x.k}`),
    })),
    ailleurs: v.ailleurs,
  };
}

type Props = {
  q: Record<string, string>;
  I: Index & { totaux: Record<string, number> };
  couverture: CouvertureX;
};
type State = BaseState & {
  q: string;
  C: Corpus | null;
  res: Groupe[] | null;
  cherche: boolean;
  indispo: boolean;
  onglet: Onglet;
  /** a tab's latest documents as the search API gave them, and the names they need */
  recents: Partial<Record<Onglet, { evts: Evenement[]; L: Lexique }>>;
  mesure: Mesure;
  X: Listes | null;
  geo: Geo | null;
  survol: string | null;
  touche: string | null;
  carteEchec: boolean;
  autour: "" | "cherche" | "refus" | "echec";
};

class Sommaire extends Vue<Props, State> {
  private n = 0;
  private attente: ReturnType<typeof setTimeout> | undefined;
  private demande: Promise<Listes> | null = null;
  private fini = false;

  protected init(p: Props): Partial<State> {
    return {
      q: p.q?.q ?? "",
      C: null,
      res: null,
      cherche: false,
      indispo: false,
      onglet: "tous",
      recents: {},
      mesure: "argent",
      X: null,
      geo: null,
      survol: null,
      touche: null,
      carteEchec: false,
      autour: "",
    };
  }
  titre(): string {
    return "";
  }
  type(): TypeCle {
    return "registre";
  }

  /** listes.json, asked once: the search's names, the map's measures, the communes' points. */
  private listes(): Promise<Listes> {
    if (this.state.X) return Promise.resolve(this.state.X);
    if (!this.demande) {
      this.demande = load<Listes>("listes.json").then((X) => {
        if (!this.fini) this.setState({ X, C: corpus(X, this.props.couverture) });
        return X;
      });
      this.demande.catch(() => {
        this.demande = null;
      });
    }
    return this.demande;
  }

  /** A tab's latest documents, asked of the search API once (sorted by date, the latest first);
   * not answering, the build's `recents` stand in. */
  private demandeRecents(o: Onglet): void {
    if (this.state.recents[o]) return;
    Promise.all(
      QUESTION[o].map((q) => demander(new URLSearchParams({ page: "1", n: "20", ...q }))),
    ).then(
      (Ps) => {
        if (!this.fini)
          this.setState({
            recents: {
              ...this.state.recents,
              [o]: {
                evts: Ps.flatMap((P) => P.evenements),
                L: { communes: Object.assign({}, ...Ps.map((P) => P.dico.communes)) },
              },
            },
          });
      },
      () => {},
    );
  }
  private choisirOnglet(o: Onglet): Handler {
    return () => {
      this.setState({ onglet: o });
      this.demandeRecents(o);
    };
  }

  componentDidMount(): void {
    if (this.state.q) void this.chercher(this.state.q);
    this.demandeRecents("tous");
    // the map once the page is drawn: its outlines and its measures
    Promise.all([load<Geo>("geo/departements.json"), this.listes()]).then(
      ([geo]) => {
        if (!this.fini) this.setState({ geo });
      },
      () => {
        if (!this.fini) this.setState({ carteEchec: true });
      },
    );
  }
  componentWillUnmount(): void {
    clearTimeout(this.attente);
    this.n++;
    this.fini = true;
  }

  private async chercher(q: string): Promise<void> {
    const id = ++this.n;
    if (plain(q.trim()).length < 2) {
      this.setState({ res: null, cherche: false, indispo: false });
      return;
    }
    this.setState({ cherche: true });
    // the names (listes.json) and the documents (the search API) at once; the documents not
    // answered: the names found and « recherche indisponible »
    const [noms, docs] = await Promise.all([
      this.listes().then(
        (X) => grouper(chercherNoms(corpus(X, this.props.couverture), q), q),
        () => null,
      ),
      chercherDocuments(q, this.props),
    ]);
    if (id !== this.n) return;
    if (!noms && !docs) {
      this.setState({ res: null, cherche: false, indispo: true });
      return;
    }
    this.setState({
      res: ordonner([...(noms ?? []), ...(docs ?? [])]),
      cherche: false,
      indispo: !docs,
    });
  }

  private onQ: Handler = (ev) => {
    const q = ev.value;
    this.setState({ q });
    // the words in the address, replaced: back from a result finds them again
    const href = q.trim() ? `/registre/?${new URLSearchParams({ q: q.trim() })}` : "/registre/";
    history.replaceState(history.state, "", href);
    clearTimeout(this.attente);
    this.attente = setTimeout(() => void this.chercher(q), 180);
  };
  private onKey: Handler = (ev) => {
    if (ev.key !== "Enter") return;
    clearTimeout(this.attente);
    void this.chercher(this.state.q);
  };
  private essai(q: string): Handler {
    return (ev) => {
      ev.preventDefault();
      clearTimeout(this.attente);
      this.setState({ q });
      history.replaceState(history.state, "", `/registre/?${new URLSearchParams({ q })}`);
      void this.chercher(q);
    };
  }
  private lancer: Handler = () => {
    clearTimeout(this.attente);
    void this.chercher(this.state.q);
  };

  /** « Autour de moi »: the device's position, asked once, and the nearest commune's fiche. */
  private autour: Handler = () => {
    if (!navigator.geolocation) {
      this.setState({ autour: "echec" });
      return;
    }
    this.setState({ autour: "cherche" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        void this.listes().then(
          (X) => {
            const k = plusProche([p.coords.longitude, p.coords.latitude], X.dico.communes);
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
          () => this.setState({ autour: "echec" }),
        );
      },
      (e) => this.setState({ autour: e.code === e.PERMISSION_DENIED ? "refus" : "echec" }),
      { maximumAge: 600000, timeout: 15000 },
    );
  };

  private basculer = (k: string): void =>
    this.setState({ open: { ...this.state.open, [k]: !this.state.open[k] } });

  /** The map: the départements, their class in the measure chosen, the bubble of the one hovered
   * (on a phone the one touched, then its fiche), the five largest named. */
  private carte() {
    const S = this.state;
    const m = S.mesure;
    const cv = this.props.couverture;
    const onglets = MESURES.map((x) => ({
      l: t(`accueil.mesure.${x}`),
      on: x === m ? "true" : "false",
      pick: (() => this.setState({ mesure: x, survol: null, touche: null })) as Handler,
    }));
    const titre = t(`accueil.carte_titre.${m}`);
    const base = { titre, onglets, quitter: (() => this.setState({ survol: null })) as Handler };
    if (!S.geo || !S.X)
      return {
        ...base,
        pret: false,
        attente: t(S.carteEchec ? "accueil.carte_echec" : "accueil.carte_attente"),
      };
    const G = S.geo;
    const L = S.X.lignes.departements as Record<string, Ligne>;
    const fig = (code: string) => {
      const o = L[code];
      const lu = cv.departements[code]?.etat === "collecte";
      return {
        nom: `${G.departements[code]?.nom ?? nomDep(this.props, code)} (${code})`,
        v1: montantA(o?.amt ?? 0),
        v1b: ` · ${t("accueil.tip_contrats", { n: o?.con ?? 0 })}`,
        v2: o?.carte != null ? t("accueil.tip_carte", { n: fr(o.carte) }) : t("liste.non_lu"),
        v3: lu
          ? t("accueil.tip_lus", { cam: fr(o?.cam ?? 0), dr: fr(o?.dr ?? 0) })
          : t("accueil.tip_pas_lus"),
      };
    };
    const deps = Object.entries(G.departements).map(([code, g]) => {
      const v = valeur(m, L[code]);
      return {
        code,
        d: g.d,
        v,
        cls: `q${classe(m, v)}${S.survol === code || S.touche === code ? " on" : ""}`,
        survol: (() => {
          if (large()) this.setState({ survol: code });
        }) as Handler,
        pick: (() => {
          if (large() || S.touche === code) aller(departementHref(code));
          else this.setState({ touche: code });
        }) as Handler,
      };
    });
    const etiquettes = [...deps]
      .filter((d) => d.v != null && d.v > 0)
      .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
      .slice(0, 5)
      .map((d) => {
        const [x, y] = milieu(d.d);
        return { x: x.toFixed(0), y: (y - 4).toFixed(0), l: court(G.departements[d.code].nom) };
      });
    const tipDe = (code: string | null) => {
      if (!code || !G.departements[code]) return null;
      const [x, y] = milieu(G.departements[code].d);
      return {
        ...fig(code),
        st: `left: ${((100 * x) / G.largeur).toFixed(2)}%; top: ${((100 * y) / G.hauteur).toFixed(2)}%`,
      };
    };
    const touche = S.touche && G.departements[S.touche] ? fig(S.touche) : null;
    const s = SEUILS[m];
    // the board's legend: « 2 à 8 M€ », the unit once
    const u = (v: number, unite = true) =>
      m !== "argent" ? fr(v) : unite ? t("socle_a.me", { n: fr(v / 1e6) }) : fr(v / 1e6);
    return {
      ...base,
      pret: true,
      attente: "",
      vb: `0 0 ${G.largeur} ${G.hauteur}`,
      w: String(G.largeur),
      h: String(G.hauteur),
      deps,
      etiquettes,
      tip: large() ? tipDe(S.survol) : null,
      touche: touche
        ? {
            nom: touche.nom,
            ligne: `${touche.v1}${touche.v1b} · ${touche.v2} · ${touche.v3}`,
            href: departementHref(S.touche as string),
          }
        : null,
      leg: [
        { cls: "sw q0", l: t("accueil.leg_moins", { v: u(s[0]) }) },
        { cls: "sw q1", l: t("accueil.leg_entre", { a: u(s[0], false), b: u(s[1]) }) },
        { cls: "sw q2", l: t("accueil.leg_entre", { a: u(s[1], false), b: u(s[2]) }) },
        { cls: "sw q3", l: t("accueil.leg_entre", { a: u(s[2], false), b: u(s[3]) }) },
        { cls: "sw q4", l: t("accueil.leg_plus", { v: u(s[3]) }) },
      ],
      survol: t(large() ? "accueil.carte_survol" : "accueil.carte_toucher"),
      outremer: [
        t("accueil.outremer_avant"),
        { a: { href: "/registre/departements", text: t("accueil.outremer_lien") } },
      ] as RichItem[],
      attribution: t("accueil.carte_source", { source: G.attribution }),
    };
  }

  renderVals() {
    const S = this.state;
    const { I, couverture: cv } = this.props;
    const T = I.totaux;
    const n = comptesIndex(I) as Comptes;
    const L = I.dico;
    const res = (S.res ?? []).map((g) => ({
      l: pluriel(g.k),
      rows: g.rows.map((r) => ({ lien: lienTrouve(r) as RichItem, meta: r.detail })),
      plus:
        g.n > g.rows.length && g.tout !== "/registre/"
          ? t("sommaire.tout_voir", { n: fr(g.n) })
          : "",
      tout: g.tout,
    }));
    const pret = !S.cherche && S.res !== null;
    const maj = new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${I.maj}T12:00:00Z`));
    const [mv, mu] = montantA(T.montant ?? 0).split(" ");
    const figs = [
      {
        k: t("accueil.fig.docs"),
        v: fr(T.docs),
        u: "",
        l: t("accueil.fig.docs_l", { n: fr(n?.listes.communes ?? 0) }),
        r: t("accueil.fig.maj", { date: maj }),
        tip: t("accueil.fig.docs_tip"),
        href: "/registre/couverture",
      },
      {
        k: t("accueil.fig.argent"),
        v: T.montant ? mv : t("liste.non_lu"),
        u: T.montant ? mu : "",
        l: t("accueil.fig.argent_l", { n: fr(T.con) }),
        r: t("accueil.fig.argent_r", {
          e: fr(n?.listes.entreprises ?? 0),
          a: fr(n?.listes.acheteurs ?? 0),
        }),
        tip: t("accueil.fig.argent_tip"),
        href: "/registre/contrats",
      },
      {
        k: t("accueil.fig.aut"),
        v: fr(T.aut),
        u: "",
        l: t("accueil.fig.aut_l"),
        r: t("accueil.fig.aut_r", { n: fr(I.facettes.p?.dr ?? 0) }),
        tip: t("accueil.fig.aut_tip", { n: T.deps_lus ?? 0 }),
        href: "/registre/arretes",
      },
      {
        k: t("accueil.fig.carte"),
        v: T.carte != null ? fr(T.carte) : t("liste.non_lu"),
        u: "",
        l: t("accueil.fig.carte_l"),
        r: t("accueil.fig.carte_r"),
        tip: t("accueil.fig.carte_tip"),
        href: "/",
      },
    ];
    const entrees = [
      { k: "communes", cls: "card entry c-pink", href: "/registre/communes" },
      { k: "drones", cls: "card entry c-blue", href: "/registre/arretes?disp=dr" },
      { k: "entreprises", cls: "card entry c-lav", href: "/registre/entreprises" },
      // the graph without a centre (lot 4): « Choisissez un centre », the busiest companies
      { k: "graphe", cls: "card entry c-wht", href: "/registre/graphe" },
    ].map((e) => ({
      ...e,
      l: t(`accueil.entree.${e.k}`),
      d: t(`accueil.entree.${e.k}_d`),
      go: t(`accueil.entree.${e.k}_go`),
    }));
    // « Cette semaine »: the latest documents of the tab, six, none dated after the build's day
    const api = S.recents[S.onglet];
    const LR: Lexique = api ? { ...L, communes: { ...L.communes, ...api.L.communes } } : L;
    const recRows = recentes(api?.evts ?? I.recents, I.maj, S.onglet).map((e) => {
      const c = e.insee ? LR.communes[e.insee] : undefined;
      const lieu: RichItem = c
        ? c.ref
          ? { a: { href: communeHref(e.insee as string), text: c.nom, cls: "ent com" } }
          : c.nom
        : e.dep
          ? {
              a: {
                href: departementHref(e.dep),
                text: nomDep(this.props, e.dep),
                cls: "ent com",
              },
            }
          : "";
      const ref =
        e.t === "arrete_drone" && e.numero
          ? t("accueil.ref_arrete", { n: String(e.numero) })
          : String(e.ref ?? "").length > 40
            ? ""
            : String(e.ref ?? "");
      return {
        date: jourMois(jourDoc(e, S.onglet) ?? I.maj),
        dk: t(`accueil.dk.${dk(e.t)}`),
        lieu: [lieu] as RichItem[],
        ref,
        // the board's objets: lower case, no closing full stop (a title is not a sentence); a
        // published objet whole (its cell clamps it to two lines), never cut with « … » in its
        // words: a cut title read as a sentence that opens in lower case
        objet: minuscule(
          (e.objet && !e.t.startsWith("arrete") ? casseNormale(e.objet) : titreDoc(e))
            .trim()
            .replace(/\.$/, ""),
        ),
      };
    });
    const gros = I.gros.slice(0, 6).map((e) => {
      const s = (e.acheteur_ref ?? "").replace(/^acheteur\//, "");
      const a = L.acheteurs[s];
      // a name that says where (« CCAS de Nice »): its seat's commune or département added
      const nom = nomAcheteur(a, L, (d) => nomDep(this.props, d), s);
      // each company a link to its fiche (a sole trader is never named: entName)
      const ents: RichItem[] = (e.entreprises ?? []).flatMap((x, i) => {
        const nomE = entName(L, x);
        const lienE: RichItem = L.entreprises[x]?.ref
          ? { a: { href: `/registre/entreprise/${x}`, text: nomE } }
          : nomE;
        return i ? [", ", lienE] : [lienE];
      });
      // after its companies (« Spie · fourniture… ») the objet goes on the line in lower case;
      // alone, it opens the line with its capital
      const obj = casseNormale(e.objet).replace(/^./, (x) =>
        ents.length ? x.toLocaleLowerCase("fr") : x,
      );
      return {
        qui: [
          e.acheteur_ref
            ? { a: { href: `/registre/${e.acheteur_ref}`, text: nom, cls: "ent" } }
            : nom,
        ] as RichItem[],
        ligne: [...ents, ...(ents.length && obj ? [" · "] : []), obj] as RichItem[],
        an: (e.date ?? "").slice(0, 4),
        m: montantA(e.montant ?? 0),
      };
    });
    const srcRows = [
      { cls: "ok", l: t("accueil.src.contrats"), d: t("accueil.src.contrats_d") },
      { cls: "ok", l: t("accueil.src.ao"), d: t("accueil.src.ao_d") },
      {
        cls: "part",
        l: t("accueil.src.arretes"),
        d: t("accueil.src.arretes_d", { n: T.deps_lus ?? 0 }),
      },
      { cls: "part", l: t("accueil.src.subventions"), d: t("accueil.src.subventions_d") },
      { cls: "ok", l: t("accueil.src.carte"), d: t("accueil.src.carte_d") },
    ];
    return {
      ...this.base("sommaire"),
      title: t("sommaire.titre"),
      letters: coupeMots(t("accueil.titre")),
      lead: [
        t("accueil.lead_a"),
        { strong: t("accueil.lead_b") },
        t("accueil.lead_c"),
      ] as RichItem[],
      q: S.q,
      onQ: this.onQ,
      onKey: this.onKey,
      chercher: this.lancer,
      // « Essayer » (the board's): a name with its fiche opens it (every mention that has its
      // fiche is a link); otherwise the words are searched here, as if typed
      essais: (
        [
          ["lyon", L.communes["69123"]?.ref ? communeHref("69123") : ""],
          ["electriox", L.entreprises["794108878"]?.ref ? "/registre/entreprise/794108878" : ""],
          ["drones_paris", L.communes["75056"]?.ref ? communeHref("75056", "carte") : ""],
          ["rhone", cv.departements["69"] ? departementHref("69") : ""],
        ] as const
      ).map(([k, fiche]) => {
        const q = t(`accueil.essai.${k}`);
        return fiche
          ? { l: q, href: fiche, pick: null }
          : { l: q, href: `/registre/?${new URLSearchParams({ q })}`, pick: this.essai(q) };
      }),
      autour: this.autour,
      autourEtat: S.autour ? t(`accueil.autour_${S.autour}`) : "",
      cherche: S.cherche,
      hasRes: pret && res.length > 0,
      res,
      aucun: pret && res.length === 0 ? t("sommaire.aucun_resultat", { q: S.q.trim() }) : "",
      indispo: S.indispo,
      depsIndispo: Object.keys(cv.departements)
        .filter(vraiDepartement)
        .sort()
        .map((code) => lienDepartement(code, nomDep({ couverture: cv }, code), true)),
      figs,
      entrees,
      recents: {
        r: repli(S.open, "recents", t("accueil.derniers"), recRows.length, this.basculer),
        onglets: ONGLETS.map((o) => ({
          l: t(`accueil.onglet.${o}`),
          on: S.onglet === o ? "true" : "false",
          pick: this.choisirOnglet(o),
        })),
        rows: recRows,
        vide: recRows.length === 0,
        tout: TOUT[S.onglet],
      },
      carte: this.carte(),
      vol: carteVol((I as { drones?: { publication?: Publication } }).drones?.publication, S.X),
      pleinEcran,
      gros: {
        r: repli(S.open, "gros", t("accueil.gros"), gros.length, this.basculer),
        rows: gros,
      },
      etapes: [1, 2, 3].map((i) => ({ h: t(`accueil.etape${i}_h`), p: t(`accueil.etape${i}_p`) })),
      srcs: {
        r: repli(
          S.open,
          "srcs",
          t("accueil.voir_detail"),
          srcRows.length,
          this.basculer,
          "card srcs",
        ),
        rows: srcRows,
      },
      codeHref: "https://github.com/lagayayuya/SurveillanceWorld",
      maj: t("accueil.fig.maj", { date: maj }),
    };
  }
}

/** Follows a register link from a handler (the frame's router takes it, hote.ts). */
function aller(href: string): void {
  const a = document.createElement("a");
  a.href = href;
  document.getElementById("registre")?.append(a);
  a.click();
  a.remove();
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  const to = redirection(r);
  if (to) {
    // an old address: its list's, in place of this one (no new step in the history); the router
    // answers the new path at once and drops this one, never drawn
    history.replaceState(history.state, "", `${to}${location.hash}`);
    dispatchEvent(new PopStateEvent("popstate"));
    return new Promise(() => {});
  }
  const [I, couverture] = await Promise.all([
    load<Index>("index.json"),
    load<CouvertureX>("couverture.json"),
  ]);
  return { I, couverture };
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: Sommaire as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
