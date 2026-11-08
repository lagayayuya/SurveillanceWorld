// A company's fiche (/registre/entreprise/<siren>; board Entreprise-Electriox-A of the redesign v3,
// lot 3, its phone and dark variants): the sticker « Entreprise » and the name cut out, its NAF
// activity, its SIREN, a sentence of its figures; the four figures (public money, clients, running
// contracts, competition); the yellow table of contents; then 1 · Pour qui travaille-t-elle ?,
// 2 · Combien, et quand ?, 3 · Que fait-elle ?, 4 · Avec qui, et contre combien ?, 5 · Ses contrats
// dans le temps, « Tous les documents », « D'où viennent ces chiffres ». A section with nothing to
// say is left out, the others numbered in turn. Signals and missions come later (Ju, 07/11):
// absent. The centred graph is lot 4 (/registre/graphe/<siren>, a stub until then). Every figure
// is the build's: the company's file, listes.json and graphe/aretes.json (asked once the page is
// drawn) for its trade's companies and its clients' other suppliers.

import { communeHref, depArt, depDans } from "../commun.ts";
import { buyerHref, buyerNom, depNom, docHref, entName, titre as titreDoc } from "../corpus.ts";
import type { Handler, RichItem } from "../dc.ts";
import { Absent, type Couverture, EI, type Evenement, load } from "../donnees.ts";
import { fr, longMonth, moneyFull, shortDate } from "../format.ts";
import { t } from "../i18n.ts";
import { departementHref } from "../liens.ts";
import type { Listes } from "../listes.ts";
import type { VueModule } from "../modale.ts";
import { partager } from "../partage.ts";
import type { Route } from "../routes.ts";
import { signalerHref } from "../signaler.ts";
import { coupe, montantA, pleinEcran, repli } from "../socle-a.ts";
import { annuaire, couverture } from "../sources.ts";
import type { TypeCle } from "../types.ts";
import { type BaseState, type Partage, partageDe, Vue } from "../vue.ts";
import { casseNormale } from "./accueil-outils.ts";
import { exportRows } from "./documents.ts";
import {
  type Arete,
  axe,
  deArt,
  doublons,
  echelle,
  friseLignes,
  groupements,
  memeMetier,
  offresPubliees,
  parAnnee,
  SERIES,
  type Serie,
  seriesDe,
  voisins,
} from "./entreprise-a.ts";
import {
  buyerCat,
  type Ct,
  type FichierEntreprise,
  jourValide,
  prepare,
} from "./entreprise-outils.ts";
import "./entreprise-a.css";
import template from "./entreprise.html?raw";

type Props = { siren: string; F: FichierEntreprise; couverture?: Couverture };
type Onglet = "con" | "avis" | "resultat" | "modification" | "rectificatif";
type Graphe = { aretes: Arete[] };
type State = BaseState & {
  X: Listes | null;
  G: Graphe | null;
  /** graphe/aretes.json could not be read (not served): « non lu » */
  gNonLu: boolean;
  vue: "m" | "n";
  onglet: Onglet;
  annee: string;
  ach: string;
  tri: "date" | "montant";
  menu: string;
  tout: boolean;
  actions: boolean;
  cite: boolean;
};

const ONGLETS: Onglet[] = ["con", "avis", "resultat", "modification", "rectificatif"];
/** The series' classes: the board's pink (its largest client), lavender (the others of that
 * client's département), grey (elsewhere); the clients' bars use the board's names for them. */
const CLS: Record<Serie, string> = { s1: "c-ville", s2: "c-comm", s3: "c-autres" };
const BARRE: Record<Serie, string> = { s1: "lyon", s2: "rh", s3: "hors" };

/** A link in theme A's words (`a.ent`, `a.ent com`, `a.ent ach`), or the words alone. */
const lienA = (href: string | null, text: string, cls = "ent"): RichItem =>
  href ? { a: { href, text, cls } } : text;
/** « 35,1 M€ » as the figures write it: the number, then its unit apart. */
const coupeMontant = (s: string): [string, string] => {
  const i = s.lastIndexOf(" ") >= 0 ? s.lastIndexOf(" ") : s.lastIndexOf(" ");
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ""];
};
/** An amount in millions as the board's lists write it: « 2,6 M€ », « 0,22 M€ »; under 10 000 € in
 * euros. */
const meur = (n: number): string =>
  n >= 1e6
    ? t("socle_a.me", { n: (n / 1e6).toFixed(1).replace(".", ",") })
    : n >= 1e4
      ? t("socle_a.me", { n: (n / 1e6).toFixed(2).replace(".", ",") })
      : t("socle_a.e", { n: fr(n) });
const coupeTexte = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
/** « A, B et C ». */
function liste(items: RichItem[]): RichItem[] {
  const out: RichItem[] = [];
  items.forEach((x, i) => {
    if (i) out.push(i === items.length - 1 ? t("entreprise_a.et") : ", ");
    out.push(x);
  });
  return out;
}
/** A département's name in a phrase (« dans le Rhône », « du Rhône »), the name its fiche's link. */
function depLie(dep: string, phrase: string): RichItem[] {
  const nom = depNom(dep);
  const i = phrase.lastIndexOf(nom);
  if (!nom || i < 0) return [{ a: { href: departementHref(dep), text: phrase, cls: "" } }];
  return [
    phrase.slice(0, i),
    { a: { href: departementHref(dep), text: nom, cls: "" } },
    phrase.slice(i + nom.length),
  ].filter((x) => x !== "");
}

export class Entreprise extends Vue<Props, State> {
  private fini = false;
  private memo: ReturnType<typeof prepare> | null = null;

  protected init(): Partial<State> {
    return {
      X: null,
      G: null,
      gNonLu: false,
      vue: "m",
      onglet: "con",
      annee: "",
      ach: "",
      tri: "date",
      menu: "",
      tout: false,
      actions: false,
      cite: false,
    };
  }
  titre(): string {
    return entName(this.props.F, this.props.siren);
  }
  type(): TypeCle {
    return "entreprise";
  }
  partage(): Partage | null {
    // a sole trader is never shared by its name: its page is not one either
    return this.props.F.entreprise.entrepreneur_individuel
      ? null
      : partageDe(this.titre(), this.props.F.partage);
  }
  private data() {
    this.memo ??= prepare(this.props.F);
    return this.memo;
  }

  componentDidMount(): void {
    document.addEventListener("pointerdown", this.dehors, true);
    // its trade's companies and its clients' other suppliers: listes.json and the national graph
    // once the page is drawn
    load<Listes>("listes.json").then(
      (X) => {
        if (!this.fini) this.setState({ X });
      },
      () => {},
    );
    load<Graphe>("graphe/aretes.json").then(
      (G) => {
        if (!this.fini) this.setState({ G });
      },
      () => {
        if (!this.fini) this.setState({ gNonLu: true });
      },
    );
  }
  componentWillUnmount(): void {
    this.fini = true;
    document.removeEventListener("pointerdown", this.dehors, true);
  }

  private basculer = (k: string): void =>
    this.setState({ open: { ...this.state.open, [k]: !this.state.open[k] } });

  /** A pointer down outside the open menu closes it. */
  private dehors = (ev: Event): void => {
    if (this.state.menu && !(ev.target as Element).closest?.(".v-entreprise-a .dancre"))
      this.setState({ menu: "" });
  };

  /** A menu of « Tous les documents » (the board's Année ▾, Acheteur ▾): a chip, its values as a
   * listbox; arrows move, Enter or a click chooses, Escape closes, the focus back on the chip. */
  private menuDocs(
    k: string,
    l: string,
    cur: string,
    opts: { v: string; l: string }[],
    choisir: (v: string) => Partial<State>,
  ) {
    const open = this.state.menu === k;
    const focus = (sel: string) =>
      requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus());
    const fermer = () => {
      this.setState({ menu: "" });
      focus(`.v-entreprise-a .dancre.m-${k} > button`);
    };
    return {
      cls: `dancre m-${k}`,
      chip: cur ? "chip f on" : "chip f",
      l: cur ? (opts.find((o) => o.v === cur)?.l ?? cur) : l,
      lab: l,
      ouvert: open ? "true" : "false",
      menu: open,
      basculer: (() => {
        this.setState({ menu: open ? "" : k });
        if (!open) focus(`.v-entreprise-a .dancre.m-${k} [role=option]`);
      }) as Handler,
      opts: [{ v: "", l: t("entreprise_a.m_tous") }, ...opts].map((o) => ({
        l: o.l,
        on: o.v === cur ? "true" : "false",
        choisir: (() => {
          this.setState({ ...choisir(o.v), menu: "" });
          focus(`.v-entreprise-a .dancre.m-${k} > button`);
        }) as Handler,
      })),
      clavier: ((ev) => {
        const os = [
          ...document.querySelectorAll<HTMLElement>(`.v-entreprise-a .dancre.m-${k} [role=option]`),
        ];
        const i = os.indexOf(document.activeElement as HTMLElement);
        if (ev.key === "Escape") fermer();
        else if (ev.key === "ArrowDown") os[Math.min(os.length - 1, i + 1)]?.focus();
        else if (ev.key === "ArrowUp") (i > 0 ? os[i - 1] : os[0])?.focus();
        else if ((ev.key === " " || ev.key === "Enter") && i >= 0) os[i].click();
        else return;
        ev.nativeEvent.preventDefault();
        ev.stopPropagation();
      }) as Handler,
    };
  }

  /** A shape's click: « Tous les documents » filtered, then reached. */
  private versDocs(patch: Partial<State>): void {
    this.setState({
      annee: "",
      ach: "",
      menu: "",
      tout: false,
      ...patch,
      open: { ...this.state.open, docs: true },
    });
    requestAnimationFrame(() => {
      const el = document.getElementById("documents");
      const doux = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      el?.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" });
    });
  }

  /** A section's anchor followed in the frame's scroll, smoothly unless motion is reduced. */
  private allerSection: Handler = (ev) => {
    const href = (ev.currentTarget as HTMLAnchorElement).getAttribute("href") ?? "";
    if (!href.startsWith("#")) return;
    const el = document.getElementById(href.slice(1));
    if (!el) return;
    ev.preventDefault();
    const doux = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" });
  };

  /** Its documents as the export writes them (documents.ts exportRows reads a commune's data: its
   * buyer, names and update, given here from the company's file). */
  private exporterDocs(es: Evenement[], nom: string): void {
    const F = this.props.F;
    const d = {
      buyer: (e: Evenement) => e.acheteur_siren ?? F.affaires[e.affaire]?.acheteur_siren ?? null,
      buyerNom: (s: string) => buyerNom(F, s),
      entName: (s: string) => entName(F, s),
      f: { couverture: { maj: F.page.maj } },
    };
    exportRows(d as never, es, "csv", nom);
  }

  /** « Citer »: the fiche's citation, copied. */
  private citer: Handler = () => {
    const txt = t("entreprise_a.citation", {
      nom: this.titre(),
      date: shortDate(this.props.F.page.maj),
      url: `${location.origin}/registre/entreprise/${this.props.siren}`,
    });
    void navigator.clipboard?.writeText(txt).then(() => {
      this.setState({ cite: true });
      setTimeout(() => {
        if (!this.fini) this.setState({ cite: false });
      }, 2000);
    });
  };

  renderVals() {
    const S = this.state;
    const { siren, F } = this.props;
    const { CT, CL } = this.data();
    const P = F.page;
    const X = S.X;
    const ei = !!F.entreprise.entrepreneur_individuel;
    const nom = entName(F, siren);
    const maj = P.maj;
    const majY = Number(maj.slice(0, 4));
    const y0 = F.stats?.y0 ?? CT[0]?.d.slice(0, 4) ?? String(majY);
    const total = F.stats?.montant ?? CT.reduce((s, c) => s + c.amt, 0);
    const nCt = F.stats?.n ?? CT.length;
    const enCours = new Set(P.en_cours);
    const run = CT.filter((c) => enCours.has(c.e.id));
    const isEi = (s: string) => s === EI || !!F.entreprises[s]?.entrepreneur_individuel;

    // --- the buyers: their names, links, départements, series --------------------------------------
    const acheteur = (b: string) => F.acheteurs[b];
    const commune = (b: string) => acheteur(b)?.categorie === "commune";
    const depOf = (b: string) => acheteur(b)?.dep ?? "";
    const nomClient = (b: string | null): string => {
      if (!b) return t("entreprise_a.acheteur_non_publie");
      const a = acheteur(b);
      return a?.categorie === "commune" && a.insee_siege && F.communes[a.insee_siege]
        ? F.communes[a.insee_siege].nom
        : buyerNom(F, b);
    };
    const lienClient = (b: string | null, text?: string): RichItem => {
      if (!b) return t("entreprise_a.acheteur_non_publie");
      const href = buyerHref(F, b);
      return lienA(
        href,
        text ?? nomClient(b),
        href?.startsWith("/registre/commune/") ? "ent com" : "ent ach",
      );
    };
    // a company: its fiche when the build wrote it (the file's lexicon, else listes.json's)
    const lienEnt = (s: string): RichItem => {
      const own = F.entreprises[s];
      const x = own ?? X?.dico.entreprises[s];
      const n = own || !X ? entName(F, s) : entName(X.dico as never, s);
      return lienA(x?.ref && !isEi(s) ? `/registre/entreprise/${s}` : null, n);
    };
    const ser = seriesDe(CL, depOf);
    const top = ser.top;
    const allCommunes = CL.length > 0 && CL.every((c) => commune(c.s));
    const pct = (v: number) => (total > 0 ? Math.round((100 * v) / total) : 0);
    const topCl = CL.find((c) => c.s === top);

    // --- the series' names: its largest client, the others of its département, elsewhere --------
    const s2Cl = CL.filter((c) => ser.de(c.s) === "s2");
    const s3Cl = CL.filter((c) => ser.de(c.s) === "s3");
    const deDep = ser.dep ? deArt(depArt(ser.dep, depNom(ser.dep))) : "";
    const nomSerie = (k: Serie): RichItem[] => {
      if (k === "s1") return [lienClient(top)];
      if (k === "s2")
        return [
          t(
            s2Cl.every((c) => commune(c.s))
              ? "entreprise_a.s2_communes"
              : "entreprise_a.s2_acheteurs",
          ),
          ...depLie(ser.dep, deDep),
        ];
      if (s3Cl.length && s3Cl.length <= 2) return liste(s3Cl.map((c) => lienClient(c.s)));
      return [t("entreprise_a.s3_hors"), ...(ser.dep ? depLie(ser.dep, deDep) : [])];
    };
    const deSerie = (k: Serie) => CT.filter((c) => ser.de(c.b) === k);
    const montantsSerie = Object.fromEntries(
      SERIES.map((k) => [k, deSerie(k).reduce((s, c) => s + c.amt, 0)]),
    ) as Record<Serie, number>;
    const nbSerie = Object.fromEntries(SERIES.map((k) => [k, deSerie(k).length])) as Record<
      Serie,
      number
    >;
    const seriesPresentes = SERIES.filter((k) => nbSerie[k] > 0);

    // --- the modifications of each contract (its affaire's), the oldest first ---------------------
    const modsDe = new Map<string, Evenement[]>();
    for (const e of F.evenements)
      if (e.t === "modification" && !e.copie)
        modsDe.set(e.affaire, [...(modsDe.get(e.affaire) ?? []), e]);
    for (const l of modsDe.values()) l.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const nMods = (c: Ct) => modsDe.get(c.e.affaire)?.length ?? 0;
    const modsAll = [...modsDe.values()].flat();
    const modY0 = modsAll
      .map((e) => String(e.date ?? "").slice(0, 4))
      .filter(Boolean)
      .sort()[0];
    // a lot of a tender: its number and its own words (« Lot 1 · maintenance des systèmes »)
    const lotDe = new Map<string, number>();
    for (const l of Object.values(F.lots ?? {}) as {
      nature?: string;
      membres?: { affaire: string; lot?: number | null }[];
    }[])
      if (l.nature === "lots")
        for (const m of l.membres ?? []) if (m.lot) lotDe.set(m.affaire, m.lot);
    const objet = (e: Evenement): string => {
      const o = casseNormale(String(e.objet ?? titreDoc(e)));
      const lot = lotDe.get(e.affaire);
      if (!lot) return o;
      const m = /lot\s*\d+\s*[-–:]\s*(.+)$/i.exec(o);
      const reste = m ? m[1] : o;
      return t("entreprise_a.lot", {
        n: lot,
        objet: reste.charAt(0).toLowerCase() + reste.slice(1),
      });
    };

    // --- the figures ----------------------------------------------------------------------------
    const deps = Object.entries(F.stats?.deps ?? {}).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const clDeps = new Map<string, number>();
    for (const c of CL) clDeps.set(depOf(c.s), (clDeps.get(depOf(c.s)) ?? 0) + 1);
    const clDepsL = [...clDeps]
      .filter(([d]) => d)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const nDeps = clDepsL.length;
    const of = P.faits.offres;
    const op = offresPubliees(CT.map((c) => ({ ...c, offres: c.e.offres as number | null })));
    const offN = of?.renseignes ?? op.n;
    const une = of?.une_offre ?? 0;
    const sansOffre = Math.max(0, CT.length - offN);
    const derniere = run
      .map((c) => c.fin)
      .filter((x): x is string => !!x)
      .sort()
      .pop();
    const [mv, mu] = coupeMontant(montantA(total));
    const partTop = CL.length > 1 && topCl && total > 0;
    const figs = [
      {
        cls: total > 0 ? "fig" : "fig nl",
        k: t("entreprise_a.fig.argent"),
        v: total > 0 ? mv : t("entreprise_a.fig.argent_aucun"),
        u: total > 0 ? mu : "",
        l: t("entreprise_a.fig.argent_l", { n: nCt, y: y0 }),
        share: partTop ? `width: ${pct(topCl.amt)}%` : "",
        r: partTop
          ? t("entreprise_a.fig.argent_r", {
              nom: nomClient(top),
              m: montantA(topCl.amt),
              p: pct(topCl.amt),
            })
          : "",
        tip: t("entreprise_a.fig.argent_tip", { y: y0 }),
        href: "#combien",
      },
      {
        cls: "fig",
        k: t("entreprise_a.fig.clients"),
        v: fr(CL.length),
        u: t(allCommunes ? "entreprise_a.u_communes" : "entreprise_a.u_acheteurs", {
          n: CL.length,
        }),
        l: t("entreprise_a.fig.clients_l", { n: nDeps }),
        share: "",
        r: [
          ...clDepsL.slice(0, 3).map(([d, k]) => `${depNom(d)} ${fr(k)}`),
          ...(clDepsL.length > 3 ? ["…"] : []),
        ].join(" · "),
        tip: t("entreprise_a.fig.clients_tip"),
        href: "#qui",
      },
      {
        cls: "fig",
        k: t("entreprise_a.fig.en_cours"),
        v: fr(run.length),
        u: t("entreprise_a.u_contrats", { n: run.length }),
        l: derniere
          ? t("entreprise_a.fig.en_cours_l", { mois: longMonth(derniere) })
          : P.sans_fin
            ? t("entreprise_a.fig.en_cours_sans", { n: P.sans_fin })
            : t("entreprise_a.fig.en_cours_aucun"),
        share: "",
        r: modsAll.length
          ? t("entreprise_a.fig.mods", { n: modsAll.length, y: modY0 ?? "" })
          : t("entreprise_a.fig.mods0"),
        tip: t("entreprise_a.fig.en_cours_tip"),
        href: "#temps",
      },
      {
        cls: offN ? "fig" : "fig nl",
        k: t("entreprise_a.fig.concurrence"),
        v: !offN
          ? t("entreprise_a.fig.non_publiee")
          : op.min === op.max
            ? fr(op.max)
            : t("entreprise_a.fig.de_a", { a: fr(op.min), b: fr(op.max) }),
        u: offN ? t("entreprise_a.u_offres", { n: op.max }) : "",
        l: offN
          ? t("entreprise_a.fig.concurrence_l", { n: offN })
          : t("entreprise_a.fig.concurrence_l0", { n: CT.length }),
        share: "",
        r: offN
          ? [
              une ? t("entreprise_a.fig.une", { n: une }) : t("entreprise_a.fig.jamais_une"),
              ...(sansOffre ? [t("entreprise_a.fig.sans", { n: sansOffre })] : []),
            ].join(" · ")
          : "",
        tip: t("entreprise_a.fig.concurrence_tip"),
        href: "#avec",
      },
    ];

    // --- the lead -------------------------------------------------------------------------------
    const nClients = t(allCommunes ? "entreprise_a.n_communes" : "entreprise_a.n_acheteurs", {
      n: CL.length,
    });
    const lead: RichItem[] = [
      ei ? t("entreprise_a.lead_elle") : t("entreprise_a.lead_a", { nom }),
      { strong: t("entreprise_a.lead_contrats", { n: nCt }) },
      t("entreprise_a.lead_avec"),
      { strong: nClients },
      t("entreprise_a.lead_depuis", { y: y0 }),
    ];
    if (total > 0)
      lead.push(
        t("entreprise_a.lead_pour"),
        { strong: montantA(total) },
        t("entreprise_a.lead_plafonds"),
      );
    lead.push(".");
    if (partTop && pct(topCl.amt) >= 40)
      lead.push(
        " ",
        { strong: [lienClient(top)] },
        t("entreprise_a.lead_pese", { p: pct(topCl.amt) }),
      );
    if (P.activite) lead.push(" ", t(`entreprise.activite_${P.activite}`), ".");
    if (run.length && derniere)
      lead.push(
        t("entreprise_a.lead_run_a"),
        { strong: t("entreprise_a.lead_run", { n: run.length }) },
        t("entreprise_a.lead_run_b", { y: derniere.slice(0, 4) }),
      );

    // --- the sections, numbered in turn ---------------------------------------------------------
    let n = 0;
    const num = () => String(++n);
    const toc: { href: string; l: string; go: Handler }[] = [];
    const entree = (id: string, l: string) =>
      toc.push({ href: `#${id}`, l, go: this.allerSection });

    // 1 · its clients
    let s1 = null;
    if (CL.length) {
      const n1 = num();
      entree("qui", `${n1} · ${t("entreprise_a.toc.qui")}`);
      const tries = CL.slice().sort((a, b) => b.amt - a.amt || b.n - a.n);
      const max = Math.max(1, tries[0]?.amt ?? 1);
      const annees = (b: string) =>
        [...new Set(CT.filter((c) => c.b === b).map((c) => c.d.slice(0, 4)))].sort();
      const montres = tries.slice(0, 12);
      const ans: RichItem[] = [];
      const ailleurs = CL.filter((c) => depOf(c.s) !== ser.dep);
      const anTop = top ? annees(top)[0] : "";
      const dansDep = ser.dep ? depLie(ser.dep, depDans(ser.dep, depNom(ser.dep))) : [];
      if (CL.length === 1) {
        ans.push(
          { strong: t("entreprise_a.qui_un") },
          lienClient(top),
          t("entreprise_a.qui_un_b", { y: anTop }),
        );
      } else {
        ans.push({ strong: nClients });
        if (nDeps <= 1) ans.push(", ", ...dansDep);
        else
          ans.push(
            t("entreprise_a.qui_deps", { n: nDeps }),
            `${fr(clDeps.get(ser.dep) ?? 0)} `,
            ...dansDep,
          );
        ans.push(
          t("entreprise_a.qui_dont"),
          { strong: [lienClient(top)] },
          t("entreprise_a.qui_top", { y: anTop }),
        );
        if (ailleurs.length && ailleurs.length <= 3 && nDeps > 1)
          ans.push(t("entreprise_a.qui_plus"), ...liste(ailleurs.map((c) => lienClient(c.s))));
        else if (ailleurs.length && nDeps > 1)
          ans.push(t("entreprise_a.qui_plus_n", { n: ailleurs.length }));
        ans.push(".");
        if (nDeps <= 3) ans.push(" ", t("entreprise_a.qui_ailleurs"));
      }
      s1 = {
        n: n1,
        ans,
        r: repli(S.open, "clients", t("entreprise_a.clients_k"), montres.length, this.basculer),
        depsN: t("entreprise_a.deps_n", { n: deps.length }),
        deps: deps.slice(0, 4).map(([d, k], i) => ({
          href: departementHref(d),
          l: i
            ? `${depNom(d)} · ${fr(k)}`
            : `${depNom(d)} · ${t("entreprise_a.u_contrats_n", { n: k })}`,
        })),
        depsPlus: deps.length > 4 ? t("entreprise_a.deps_plus", { n: deps.length - 4 }) : "",
        rows: montres.map((c) => {
          const href = buyerHref(F, c.s);
          const com = !!href?.startsWith("/registre/commune/");
          const ans2 = annees(c.s);
          const p = pct(c.amt);
          return {
            nom: [lienClient(c.s)] as RichItem[],
            // its département, a link with a bubble of its own (the row's click is the client's)
            cat: com ? "" : buyerCat(F, c),
            dep: depNom(depOf(c.s)),
            depHref: depOf(c.s) ? departementHref(depOf(c.s)) : null,
            depBc: t("entreprise_a.b.fiche_dep"),
            cls: BARRE[ser.de(c.s)],
            st: `width: ${Math.max(1.2, (100 * c.amt) / max).toFixed(1)}%`,
            m: c.amt ? montantA(c.amt) : "—",
            c: `${t("entreprise_a.u_contrats_n", { n: c.n })} · ${ans2.length > 4 ? `${ans2[0]}–${ans2[ans2.length - 1]}` : ans2.join(", ")}`,
            bh: nomClient(c.s),
            bl:
              total > 0
                ? t(p < 1 && c.amt > 0 ? "entreprise_a.b.part_moins" : "entreprise_a.b.part", {
                    p,
                    nom,
                  })
                : "",
            bc: !href
              ? null
              : com
                ? t("entreprise_a.b.fiche_commune", { nom: nomClient(c.s) })
                : t("entreprise_a.b.fiche", { nom: nomClient(c.s) }),
            go: href ? (com ? `${href}#entreprises` : href) : null,
          };
        }),
        plus:
          tries.length > montres.length
            ? {
                l: t("entreprise_a.autres_acheteurs", { n: tries.length - montres.length }),
                href: `/registre/graphe/${siren}`,
              }
            : null,
        note: allCommunes ? t("entreprise_a.qui_note") : "",
      };
    }

    // 2 · money by year
    let s2 = null;
    if (CT.length) {
      const n2 = num();
      entree("combien", `${n2} · ${t("entreprise_a.toc.combien")}`);
      const ya = Math.min(majY, ...CT.map((c) => Number(c.d.slice(0, 4)) || majY));
      const ans = parAnnee(CT, ser.de, ya, majY);
      const nb = S.vue === "n";
      const maxM = Math.max(0, ...ans.map((a) => a.total));
      const kilo = !nb && maxM < 1e6;
      const k = nb ? 1 : kilo ? 1e-3 : 1e-6;
      const val = (a: (typeof ans)[number], s: Serie) => (nb ? a.n[s] : a.m[s] * k);
      const tot = (a: (typeof ans)[number]) => (nb ? a.nb : a.total * k);
      const sc = echelle(Math.max(0, ...ans.map(tot)));
      const H = 194;
      const y = (v: number) => 230 - (H * v) / (sc.haut || 1);
      const w = Math.min(96, (1180 / ans.length) * 0.53);
      const slot = ans.length > 1 ? (1180 - w) / (ans.length - 1) : 0;
      const cx0 = ans.length > 1 ? 60 + w / 2 : 650;
      const v1 = (v: number) =>
        nb || kilo ? fr(v) : (v >= 1 ? v.toFixed(1) : v.toFixed(2)).replace(".", ",");
      const cols = ans.map((a, i) => {
        const cx = cx0 + i * slot;
        let base = 230;
        const rects = SERIES.filter((s) => val(a, s) > 0).map((s) => {
          const h = Math.max(2, (H * val(a, s)) / (sc.haut || 1));
          base -= h;
          return { cls: CLS[s], y: base.toFixed(1), h: h.toFixed(1) };
        });
        // its buyers that year, the most money first
        const parB = new Map<string, { m: number; n: number }>();
        for (const c of CT)
          if (c.d.startsWith(a.an)) {
            const o = parB.get(c.b ?? "") ?? { m: 0, n: 0 };
            o.m += c.amt;
            o.n++;
            parB.set(c.b ?? "", o);
          }
        const lignes = [...parB].sort((p, q) => q[1].m - p[1].m || q[1].n - p[1].n);
        const hw = Math.max(slot || 200, w + 20);
        return {
          an: a.an,
          cx: cx.toFixed(1),
          x: (cx - w / 2).toFixed(1),
          w: w.toFixed(1),
          hx: (cx - hw / 2).toFixed(1),
          hw: hw.toFixed(1),
          vy: (base - 6).toFixed(1),
          v: a.nb ? v1(tot(a)) : "—",
          rects,
          tab: a.nb ? "0" : null,
          bh: `${a.an} · ${nb ? t("entreprise_a.u_contrats_n", { n: a.nb }) : montantA(a.total)}`,
          bl: [
            ...lignes
              .slice(0, 6)
              .map(
                ([b, o]) =>
                  `§${CLS[ser.de(b || null)]}§${nomClient(b || null)} · ${montantA(o.m)} · ${t("entreprise_a.u_contrats_n", { n: o.n })}`,
              ),
            ...(lignes.length > 6 ? [t("entreprise_a.b.et_autres", { n: lignes.length - 6 })] : []),
          ].join("\n"),
          bc: a.nb ? t("entreprise_a.b.annee_clic") : "",
          pick: (() => {
            if (a.nb) this.versDocs({ onglet: "con", annee: a.an });
          }) as Handler,
        };
      });
      const pic = ans.slice().sort((p, q) => q.total - p.total)[0];
      const horsTop = CT.filter((c) => c.b !== top && c.amt > 0).map((c) => c.amt);
      const ansS2: RichItem[] = [];
      if (total > 0) {
        ansS2.push({ strong: montantA(total) }, t("entreprise_a.combien_a", { n: nCt }));
        if (ans.filter((a) => a.total > 0).length > 1 && pic) {
          const picTop = CT.filter((c) => c.d.startsWith(pic.an) && c.b === top).reduce(
            (s, c) => s + c.amt,
            0,
          );
          ansS2.push(t("entreprise_a.combien_pic"), { strong: pic.an }, ` (${montantA(pic.total)}`);
          if (CL.length > 1 && picTop >= pic.total / 2)
            ansS2.push(t("entreprise_a.combien_dont"), lienClient(top), ` ${montantA(picTop)}`);
          ansS2.push(").");
        }
        if (CL.length > 1 && horsTop.length > 1)
          ansS2.push(
            t("entreprise_a.combien_hors"),
            lienClient(top),
            t("entreprise_a.combien_vont", {
              a: montantA(Math.min(...horsTop)),
              b: montantA(Math.max(...horsTop)),
            }),
          );
      } else ansS2.push(t("entreprise_a.combien_0", { n: nCt }));
      const dbl = doublons(F.lots, siren).filter((i) => F.communes[i]);
      s2 = {
        n: n2,
        ans: ansS2,
        titre: t("entreprise_a.annees_titre", { nom }),
        vues: (["m", "n"] as const).map((o) => ({
          l: t(`entreprise_a.vue_${o}`),
          on: S.vue === o ? "true" : "false",
          pick: (() => this.setState({ vue: o })) as Handler,
        })),
        unite: nb
          ? t("entreprise_a.unite_n")
          : kilo
            ? t("entreprise_a.unite_k")
            : t("entreprise_a.unite_m"),
        grille: Array.from({ length: sc.lignes }, (_, i) => (i + 1) * sc.pas).map((v) => ({
          y: y(v).toFixed(1),
          ty: (y(v) + 4).toFixed(1),
          l: nb || kilo ? fr(v) : String(Math.round(v * 100) / 100).replace(".", ","),
        })),
        cols,
        leg: seriesPresentes.map((s) => ({
          cls: `lg l-${s}`,
          sw: `sw ${CLS[s]}`,
          l: nomSerie(s),
          v: nb ? t("entreprise_a.u_contrats_n", { n: nbSerie[s] }) : montantA(montantsSerie[s]),
        })),
        note: [
          t("entreprise_a.combien_note"),
          ...(dbl.length
            ? [
                t("entreprise_a.doublon_a"),
                ...liste(
                  dbl.map((i) =>
                    lienA(F.communes[i]?.ref ? communeHref(i) : null, F.communes[i].nom, "ent com"),
                  ),
                ),
                t(dbl.length > 1 ? "entreprise_a.doublon_b_n" : "entreprise_a.doublon_b"),
              ]
            : []),
        ] as RichItem[],
      };
    }

    // 3 · what it does
    let s3 = null;
    if (CT.length) {
      const n3 = num();
      entree("quoi", `${n3} · ${t("entreprise_a.toc.quoi")}`);
      const naf = F.entreprise.naf ?? "";
      const depsK = deps.map(([d]) => d);
      const rows =
        X && naf
          ? memeMetier(
              X.lignes.entreprises as never,
              X.dico.entreprises as never,
              naf,
              depsK,
              siren,
            )
          : [];
      const lapi = CT.filter((c) => F.affaires[c.e.affaire]?.dispositif === "lapi");
      const ans: RichItem[] = [
        P.activite ? `${t(`entreprise.activite_${P.activite}`)}.` : t("entreprise_a.quoi_nl"),
      ];
      if (lapi.length === 1)
        ans.push(
          t("entreprise_a.quoi_lapi_un"),
          lienClient(lapi[0].b),
          t("entreprise_a.quoi_lapi_an", { y: lapi[0].d.slice(0, 4) }),
        );
      else if (lapi.length > 1) ans.push(t("entreprise_a.quoi_lapi_n", { n: lapi.length }));
      s3 = {
        n: n3,
        ans,
        r: repli(S.open, "metier", t("entreprise_a.metier_k"), rows.length, this.basculer),
        rows: rows.length
          ? rows.map((x) => ({
              nom: [lienEnt(x.siren)] as RichItem[],
              n: t("entreprise_a.u_contrats_n", { n: x.n }),
            }))
          : null,
        vide: !naf
          ? t("entreprise_a.metier_sans_naf")
          : !X
            ? t("entreprise_a.attente")
            : rows.length
              ? ""
              : t("entreprise_a.metier_aucune"),
        note: naf
          ? ([
              t("entreprise_a.metier_note_a", {
                naf,
                l: casseNormale(F.entreprise.naf_libelle ?? "").toLowerCase(),
              }),
              ...(depsK.length > 3
                ? [t("entreprise_a.metier_note_n", { n: depsK.length })]
                : [
                    t("entreprise_a.metier_dans"),
                    ...liste(
                      depsK.map((d) => ({ span: depLie(d, depArt(d, depNom(d))), cls: "" })),
                    ),
                  ]),
              t("entreprise_a.metier_note_b"),
            ] as RichItem[])
          : ([t("entreprise_a.metier_note_c")] as RichItem[]),
      };
    }

    // 4 · with whom, against how many
    let s4 = null;
    if (CT.length) {
      const n4 = num();
      entree("avec", `${n4} · ${t("entreprise_a.toc.avec")}`);
      const grp = groupements(
        CT.map((c) => ({ ...c, entreprises: c.e.entreprises })),
        siren,
        isEi,
      );
      const partenaires = new Set(grp.map((x) => x.siren));
      const grpN = CT.filter((c) => (c.e.entreprises ?? []).length > 1).length;
      // a modification that changes the holders: who comes in
      const titu = CT.flatMap((c) =>
        (modsDe.get(c.e.affaire) ?? [])
          .filter((m) => ((m.changements as string[] | undefined) ?? []).includes("titulaires"))
          .map((m) => ({
            c,
            m,
            entrants: (m.entreprises ?? []).filter(
              (s) => s !== siren && !isEi(s) && !(c.e.entreprises ?? []).includes(s),
            ),
          })),
      );
      const ans: RichItem[] = [];
      if (grpN)
        ans.push(
          { strong: t("entreprise_a.u_contrats_n", { n: grpN }) },
          t("entreprise_a.avec_en"),
          { strong: t("entreprise_a.avec_groupement") },
          t("entreprise_a.avec_autre"),
        );
      else ans.push(t("entreprise_a.avec_seule"));
      if (offN) {
        if (!une)
          ans.push(
            t("entreprise_a.avec_off_a"),
            { strong: t("entreprise_a.avec_jamais") },
            op.min === op.max
              ? t("entreprise_a.avec_off_un", { n: op.max })
              : t("entreprise_a.avec_off_de", { a: op.min, b: op.max }),
          );
        else ans.push(t("entreprise_a.avec_off_une", { une, n: offN }));
      } else ans.push(t("entreprise_a.avec_off_0"));
      const offRows = CT.filter((c) => typeof c.e.offres === "number")
        .sort((a, b) => (b.e.offres as number) - (a.e.offres as number) || b.d.localeCompare(a.d))
        .slice(0, 8);
      // its clients' other suppliers, from the national graph
      const vs = S.G
        ? voisins(
            S.G.aretes,
            CL.map((c) => c.s),
            siren,
            (s) => (X ? entName(X.dico as never, s) : s),
            partenaires,
          )
        : null;
      const nodesCl = CL.slice()
        .sort((a, b) => b.amt - a.amt)
        .slice(0, 8);
      const gmax = Math.max(1, nodesCl[0]?.amt ?? 1);
      const centre = coupeTexte(nom, 24);
      const cw = Math.min(280, Math.max(110, centre.length * 10 + 28));
      const tituN = titu[0];
      s4 = {
        n: n4,
        ans,
        cls: grp.length ? "row2" : "row1",
        grp: grp.length
          ? {
              r: repli(
                S.open,
                "grp",
                t("entreprise_a.grp_k"),
                Math.min(8, grp.length),
                this.basculer,
              ),
              rows: grp.slice(0, 8).map((x) => ({
                nom: [lienEnt(x.siren)] as RichItem[],
                ou: [lienClient(x.c.b), `, ${x.c.d.slice(0, 4)}`] as RichItem[],
                m: x.c.amt ? meur(x.c.amt) : "—",
              })),
              note: tituN
                ? ([
                    t("entreprise_a.titu_a"),
                    lienClient(tituN.c.b),
                    t("entreprise_a.titu_b", { mois: longMonth(String(tituN.m.date)) }),
                    ...(tituN.entrants.length
                      ? [
                          " : ",
                          ...liste(tituN.entrants.map((s) => lienEnt(s))),
                          t(
                            tituN.entrants.length > 1
                              ? "entreprise_a.titu_entrent"
                              : "entreprise_a.titu_entre",
                          ),
                        ]
                      : []),
                    ".",
                  ] as RichItem[])
                : null,
            }
          : null,
        off: {
          r: repli(S.open, "off", t("entreprise_a.off_k"), offRows.length, this.basculer),
          rows: offRows.length
            ? offRows.map((c) => {
                const o = objet(c.e);
                return {
                  ou: [lienClient(c.b)] as RichItem[],
                  an: c.d.slice(0, 4),
                  obj: coupeTexte(o.charAt(0).toLowerCase() + o.slice(1), 40),
                  n: fr(c.e.offres as number),
                  ret:
                    (c.e.entreprises ?? []).length > 1
                      ? t("entreprise_a.retenue_grp", { nom })
                      : nom,
                };
              })
            : null,
          nonPub: !offN,
          note: offN
            ? [
                t("entreprise_a.off_note_a"),
                sansOffre ? t("entreprise_a.off_note_sans", { n: sansOffre }) : "",
                t("entreprise_a.off_note_b"),
              ]
                .filter(Boolean)
                .join(" ")
            : t("entreprise_a.off_note_0"),
        },
        g: {
          titre: t("entreprise_a.graphe_titre", { nom }),
          href: `/registre/graphe/${siren}`,
          plus:
            CL.length > nodesCl.length
              ? t("entreprise_a.autres_acheteurs", { n: CL.length - nodesCl.length })
              : "",
          cx: (300 - cw / 2).toFixed(1),
          cw: cw.toFixed(1),
          cl: centre,
          nodes: nodesCl.map((c, i) => {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / nodesCl.length;
            const x = 300 + 162 * Math.cos(a);
            const yy = 204 + 120 * Math.sin(a);
            const r = 8.5 + 9.5 * Math.sqrt(c.amt / gmax);
            const autres = vs?.parClient.get(c.s) ?? 0;
            const mo = autres ? `+${fr(autres)}` : "";
            const mx = 300 + 224 * Math.cos(a);
            const my = 204 + 168 * Math.sin(a);
            const mw = Math.max(28, mo.length * 8 + 10);
            const nm = nomClient(c.s);
            return {
              x: x.toFixed(0),
              y: yy.toFixed(0),
              r: r.toFixed(1),
              ty: (Math.sin(a) < -0.1 ? yy + r + 16 : yy - r - 6).toFixed(0),
              l: coupeTexte(nm, 22),
              ci: `nd i${i}`,
              href: `/registre/graphe/${c.s}`,
              bh: nm,
              bl: [
                t("entreprise_a.b.avec", { nom, m: c.amt ? montantA(c.amt) : "—" }),
                ...(vs ? [t("entreprise_a.b.autres_fourn", { n: autres })] : []),
              ].join("\n"),
              bc: t("entreprise_a.b.graphe_clic", { nom: nm }),
              mo,
              mx: mx.toFixed(0),
              my: my.toFixed(0),
              mrx: (mx - mw / 2).toFixed(0),
              mry: (my - 14).toFixed(0),
              mw: mw.toFixed(0),
            };
          }),
        },
        aut: {
          r: repli(
            S.open,
            "aut",
            t("entreprise_a.autres_k"),
            Math.min(7, vs?.ent.length ?? 0),
            this.basculer,
          ),
          rows: vs?.ent.length
            ? vs.ent.slice(0, 7).map((x) => ({
                nom: [lienEnt(x.siren)] as RichItem[],
                ou: [
                  ...liste(
                    x.clients
                      .slice()
                      .sort((p, q) => nomClient(p).localeCompare(nomClient(q), "fr"))
                      .slice(0, 3)
                      .map((b) => lienClient(b)),
                  ),
                  ...(x.clients.length > 3 ? ["…"] : []),
                ] as RichItem[],
                n: fr(x.clients.length),
              }))
            : null,
          vide: S.gNonLu
            ? t("entreprise_a.autres_non_lu")
            : !S.G
              ? t("entreprise_a.attente")
              : vs?.ent.length
                ? ""
                : t("entreprise_a.autres_aucun"),
        },
      };
    }

    // 5 · its contracts in time
    let s5 = null;
    if (CT.length) {
      const n5 = num();
      entree("temps", `${n5} · ${t("entreprise_a.toc.temps")}`);
      const { groupes, caches } = friseLignes(CT, (c) => enCours.has(c.e.id));
      const ya = Math.min(...CT.map((c) => Number(c.d.slice(0, 4)) || majY));
      const yz = Math.min(
        majY + 10,
        Math.max(majY, ...CT.map((c) => Number((c.fin ?? "").slice(0, 4)) || 0)),
      );
      const X0 = 365;
      const X1 = 1188;
      const xOf = axe(ya, yz, X0, X1);
      const parAn = (X1 - X0) / (yz - ya + 1);
      const pasAn = Math.max(1, Math.ceil(40 / parAn));
      const rows: Record<string, unknown>[] = [];
      const seps: { y: string }[] = [];
      const labels: Record<string, unknown>[] = [];
      let yy = 30;
      groupes.forEach((g, gi) => {
        if (gi) {
          seps.push({ y: String(yy + 3) });
          yy += 10;
        }
        const href = g.b ? buyerHref(F, g.b) : null;
        labels.push({ y: String(yy + 17), l: coupeTexte(nomClient(g.b), 21), href, sans: !href });
        for (const c of g.rows) {
          const live = enCours.has(c.e.id);
          const x = xOf(c.d);
          const mods = modsDe.get(c.e.affaire) ?? [];
          const w = c.fin ? Math.max(4, xOf(c.fin) - x) : 0;
          const end = x + w;
          const droite = end + 8 + 64 <= 1240;
          const o = objet(c.e);
          rows.push({
            y: String(yy),
            ty: String(yy + 17),
            by: String(yy + 7),
            obj: coupeTexte(o, 27),
            bar: !!c.fin,
            pt: !c.fin,
            px: (x + 10).toFixed(1),
            x: x.toFixed(1),
            w: w.toFixed(1),
            cls: `${CLS[ser.de(c.b)]} ${live ? "live" : "done"}`,
            mc: mods.length ? t("entreprise_a.n_modif", { n: mods.length }) : "",
            mx: (droite ? end + 8 : x - 8).toFixed(1),
            my: String(yy + 18),
            ma: droite ? "start" : "end",
            bh: `${nomClient(c.b)} · ${c.raw ? montantA(c.raw) : "—"}`,
            bl: [
              coupeTexte(o, 80),
              c.fin
                ? t("entreprise_a.b.du_au", { a: shortDate(c.d), b: shortDate(c.fin) })
                : t("entreprise_a.b.depuis", { a: shortDate(c.d) }),
              typeof c.e.offres === "number"
                ? t("entreprise_a.b.offres", { n: c.e.offres })
                : t("entreprise_a.b.offres_np"),
              ...(mods.length ? [t("entreprise_a.b.modifs", { n: mods.length })] : []),
              ...mods.slice(0, 8).map((m) => {
                const ch = ((m.changements as string[] | undefined) ?? []).join(", ");
                return `· ${shortDate(m.date)} : ${ch || t("entreprise_a.b.rien")}`;
              }),
              ...(mods.length > 8 ? [t("entreprise_a.b.modifs_plus", { n: mods.length - 8 })] : []),
            ].join("\n"),
            bc: t("entreprise_a.b.contrat_clic"),
            go: docHref(F, c.e),
          });
          yy += 26;
        }
      });
      const bas = yy;
      const nx = xOf(maj);
      const nGauche = nx + 100 > 1240;
      const places = [...new Set(run.map((c) => c.b))];
      const ans: RichItem[] = [];
      if (run.length)
        ans.push(
          { strong: t("entreprise_a.temps_run", { n: run.length }) },
          t("entreprise_a.temps_a"),
          ...liste([
            ...places.slice(0, 5).map((b) => lienClient(b)),
            ...(places.length > 5
              ? [t("entreprise_a.temps_autres", { n: places.length - 5 })]
              : []),
          ]),
          ".",
        );
      else ans.push(t("entreprise_a.temps_aucun"));
      if (P.sans_fin) ans.push(" ", t("entreprise_a.temps_sans_fin", { n: P.sans_fin }));
      const plusMod = CT.slice().sort((a, b) => nMods(b) - nMods(a) || b.amt - a.amt)[0];
      if (plusMod && nMods(plusMod) >= 2)
        ans.push(
          t("entreprise_a.temps_mod_a"),
          lienClient(plusMod.b),
          `, ${plusMod.d.slice(0, 4)}`,
          t("entreprise_a.temps_mod_b"),
          { strong: t("entreprise_a.temps_fois", { n: nMods(plusMod) }) },
          ".",
        );
      s5 = {
        n: n5,
        ans,
        titre: t("entreprise_a.frise_titre", { n: CT.length, nom }),
        vb: `0 0 1240 ${bas + 22}`,
        h: String(bas + 22),
        yb: String(bas + 2),
        axe: Array.from({ length: yz - ya + 1 }, (_, i) => ya + i)
          .filter((an) => (an - ya) % pasAn === 0)
          .map((an) => {
            const x = xOf(`${an}-01-01`);
            return { x: x.toFixed(1), tx: (x + 4).toFixed(1), l: String(an) };
          }),
        rows,
        seps,
        labels,
        nx: nx.toFixed(1),
        ntx: (nGauche ? nx - 4 : nx + 4).toFixed(1),
        na: nGauche ? "end" : "start",
        ny: String(bas + 16),
        leg: seriesPresentes.map((s) => ({ sw: `sw ${CLS[s]}`, l: nomSerie(s) })),
        caches: caches ? t("entreprise_a.frise_caches", { n: caches }) : "",
      };
    }

    // documents: its contracts and the notices of its affaires, by kind
    const deType = (o: Onglet) => (e: Evenement) => e.t === o && !e.copie;
    const ctIds = new Set(CT.map((c) => c.e.id));
    const filtres: Record<Onglet, (e: Evenement) => boolean> = {
      con: (e) => ctIds.has(e.id),
      avis: deType("avis"),
      resultat: deType("resultat"),
      modification: deType("modification"),
      rectificatif: deType("rectificatif"),
    };
    const buyerDe = (e: Evenement) =>
      e.acheteur_siren ?? F.affaires[e.affaire]?.acheteur_siren ?? null;
    const onglets = ONGLETS.filter((o) => o === "con" || F.evenements.some(filtres[o]));
    const ong = onglets.includes(S.onglet) ? S.onglet : "con";
    const ongRows = F.evenements.filter(filtres[ong]);
    const anneesDoc = [
      ...new Set(ongRows.map((e) => String(e.date ?? "").slice(0, 4)).filter(Boolean)),
    ]
      .sort()
      .reverse();
    const parAch = new Map<string, number>();
    for (const e of ongRows) {
      const b = buyerDe(e);
      if (b) parAch.set(b, (parAch.get(b) ?? 0) + 1);
    }
    const achs = [...parAch]
      .sort((p, q) => q[1] - p[1] || nomClient(p[0]).localeCompare(nomClient(q[0]), "fr"))
      .slice(0, 40);
    const docRows = ongRows
      .filter(
        (e) =>
          (!S.annee || String(e.date ?? "").startsWith(S.annee)) &&
          (!S.ach || buyerDe(e) === S.ach),
      )
      .sort(
        S.tri === "montant"
          ? (p, q) =>
              (q.montant ?? -1) - (p.montant ?? -1) || String(q.date).localeCompare(String(p.date))
          : (p, q) => String(q.date ?? "").localeCompare(String(p.date ?? "")),
      );
    const LIM = 15;
    const montrees = S.tout ? docRows : docRows.slice(0, LIM);
    const docs = {
      r: repli(
        S.open,
        "docs",
        t("accueil.voir_detail"),
        Math.min(LIM, docRows.length),
        this.basculer,
      ),
      onglets: onglets.map((o) => ({
        l: t(`entreprise_a.onglet.${o}`),
        n: fr(F.evenements.filter(filtres[o]).length),
        on: o === ong ? "true" : "false",
        pick: (() =>
          this.setState({ onglet: o, annee: "", ach: "", menu: "", tout: false })) as Handler,
      })),
      menus: [
        this.menuDocs(
          "annee",
          t("entreprise_a.m_annee"),
          S.annee,
          anneesDoc.map((v) => ({ v, l: v })),
          (v) => ({ annee: v }),
        ),
        this.menuDocs(
          "ach",
          t("entreprise_a.m_acheteur"),
          S.ach,
          achs.map(([v, k]) => ({ v, l: `${nomClient(v)} · ${fr(k)}` })),
          (v) => ({ ach: v }),
        ),
      ],
      exporter: (() =>
        this.exporterDocs(docRows, `${siren}-${t(`entreprise_a.onglet.${ong}`)}`)) as Handler,
      triDate: S.tri === "date" ? "descending" : "none",
      triM: S.tri === "montant" ? "descending" : "none",
      parDate: (() => this.setState({ tri: "date" })) as Handler,
      parM: (() => this.setState({ tri: "montant" })) as Handler,
      rows: montrees.map((e) => {
        const b = buyerDe(e);
        const autres = (e.entreprises ?? []).filter((s) => s !== siren);
        const f0 = e.t === "attribution" ? P.fins[e.id]?.fin : null;
        const fin = f0 ? jourValide(f0) : null;
        const ch = ((e.changements as string[] | undefined) ?? []).join(", ");
        return {
          d: e.date ? shortDate(e.date) : "—",
          qui: [b ? lienClient(b) : String(e.acheteur ?? "—")] as RichItem[],
          obj: [
            { a: { href: docHref(F, e), text: objet(e), cls: "" } },
            ...(ch ? [` · ${ch}`] : []),
            ...(autres.length
              ? [t("entreprise_a.avec_qui"), ...liste(autres.map((s) => lienEnt(s)))]
              : []),
          ] as RichItem[],
          o: typeof e.offres === "number" ? fr(e.offres) : "—",
          m: e.montant ? moneyFull(e.montant) : "—",
          fin: fin ? (fin > maj ? t("entreprise_a.en_cours_f") : shortDate(fin)) : "—",
        };
      }),
      // a row's click opens its document, as its link does
      ligne: ((ev) => {
        const tgt = ev.nativeEvent.target as Element;
        if (tgt.closest("a, button")) return;
        tgt.closest("tr")?.querySelector<HTMLAnchorElement>("td:nth-child(3) a")?.click();
      }) as Handler,
      vide: !docRows.length,
      plus:
        docRows.length > LIM
          ? S.tout
            ? t("entreprise_a.reduire")
            : t("entreprise_a.voir_tous", { n: docRows.length })
          : "",
      basculerTout: (() => this.setState({ tout: !S.tout })) as Handler,
    };
    toc.push({ href: "#documents", l: t("entreprise_a.toc.documents"), go: this.allerSection });
    toc.push({ href: "#sources", l: t("entreprise_a.toc.sources"), go: this.allerSection });
    const nSec = new Map(toc.map((x) => [x.href, x.l.split(" · ")[0]]));

    const srcRows = [
      {
        cls: "ok",
        l: t("entreprise_a.src.contrats"),
        d: t("entreprise_a.src.contrats_d", { y: y0 }),
        href: "",
        lien: "",
      },
      { cls: "ok", l: t("entreprise_a.src.ao"), d: t("entreprise_a.src.ao_d"), href: "", lien: "" },
      {
        cls: "part",
        l: t("entreprise_a.src.identite"),
        d: ei ? t("entreprise_a.src.identite_ei") : t("entreprise_a.src.identite_d"),
        // a legal person's official record (the Annuaire des entreprises), never a sole trader's
        href: ei ? "" : annuaire(siren),
        lien: ei ? "" : t("entreprise_a.src.fiche_officielle"),
      },
      {
        cls: CT.length && offN >= CT.length ? "ok" : offN ? "part" : "non",
        l: t("entreprise_a.src.offres"),
        d: t("entreprise_a.src.offres_d", { a: offN, b: CT.length }),
        href: "",
        lien: "",
      },
    ];
    const contrats = (
      this.props.couverture as { sources?: { id: string; collecte_le?: string }[] } | undefined
    )?.sources?.find((s) => s.id === "contrats");
    const sirenTxt = siren.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");

    return {
      ...this.base("entreprise-a"),
      nom,
      letters: coupe(nom),
      naf:
        F.entreprise.naf && F.entreprise.naf_libelle
          ? {
              l: casseNormale(F.entreprise.naf_libelle),
              href: `/registre/entreprises?naf=${encodeURIComponent(F.entreprise.naf)}`,
              bl: t("entreprise_a.b.naf", { naf: F.entreprise.naf }),
              bc: t("entreprise_a.b.naf_clic"),
            }
          : null,
      // a sole trader: neither its name nor its number (the number names the person in SIRENE)
      meta: ei ? [t("entreprise_a.ei")] : [t("entreprise_a.siren", { siren: sirenTxt })],
      todo: ei ? null : { l: t("entreprise_a.todo"), bl: t("entreprise_a.todo_tip") },
      collecte: contrats?.collecte_le
        ? t("entreprise_a.collecte", { d: shortDate(contrats.collecte_le) })
        : "",
      lead,
      partager: ((ev) => partager(this, ev.currentTarget)) as Handler,
      citer: this.citer,
      citerL: t(S.cite ? "entreprise_a.cite" : "entreprise_a.citer"),
      exporter: (() =>
        this.exporterDocs(
          F.evenements
            .filter((e) => !e.copie)
            .sort((p, q) => String(q.date ?? "").localeCompare(String(p.date ?? ""))),
          siren,
        )) as Handler,
      comparer: `/registre/comparer?entreprises=${siren}`,
      act: {
        cls: S.actions ? "actions ouvert" : "actions",
        exp: S.actions ? "true" : "false",
        basculer: (() => this.setState({ actions: !S.actions })) as Handler,
      },
      figs: figs.map((x) => ({
        ...x,
        go: this.allerSection,
        bc: nSec.has(x.href) ? t("entreprise_a.b.section", { n: nSec.get(x.href) ?? "" }) : "",
      })),
      toc,
      s1,
      s2,
      s3,
      s4,
      s5,
      docs,
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
        signaler: CT[0] ? signalerHref(CT[0].e) : "/registre/glossaire",
      },
      pleinEcran,
    };
  }
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  const siren = r.view === "entreprise" ? r.siren : "";
  // a company outside the register has no file (404; the dev server answers its page instead,
  // not JSON): « introuvable », not a load error
  const cv = couverture().catch(() => undefined);
  try {
    return { F: await load<FichierEntreprise>(`entreprise/${siren}.json`), couverture: await cv };
  } catch (e) {
    if (e instanceof SyntaxError || /: 404$/.test(String((e as Error).message)))
      throw new Absent(siren);
    throw e;
  }
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: Entreprise as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
