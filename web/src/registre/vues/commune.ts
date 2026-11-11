// A commune's fiche (/registre/commune/<insee>; board Lyon-A-theme-actuel of the redesign v3, its
// behaviours Lyon-A-comportements, its phone and dark variants): the sticker « Commune » and the
// name cut out, its département and intercommunality, its identity, a sentence of its figures;
// the four figures (cameras on the map, public money per inhabitant, days of flight, competition),
// each with its rank among the communes of its size; « Vue 3D » (the live map on the commune, its
// drones); the yellow table of contents; then 1 · Combien de caméras ?, 2 · Combien ça coûte, et
// qui paie ?, 3 · Qui équipe la ville ?, 4 · Les dossiers, 5 · Drones et algorithmes, 6 ·
// Comparée à ses voisines, « Tous les documents », « D'où viennent ces chiffres ». A section with
// nothing to say is left out, the others numbered in turn. Signals and missions come later (Ju,
// 07/11): absent. Every figure is the build's: the commune's file, and listes.json (asked once the
// page is drawn) for the ranks and the neighbours.

import { allerA } from "../bulle.ts";
import {
  byDateDesc,
  commune as chargerCommune,
  communeHref,
  type Donnees,
  ess,
  lastArretes,
} from "../commun.ts";
import { entName, titre as titreDoc } from "../corpus.ts";
import type { Handler, RichItem } from "../dc.ts";
import type { Evenement } from "../donnees.ts";
import { load } from "../donnees.ts";
import { fr } from "../format.ts";
import { t } from "../i18n.ts";
import { departementHref } from "../liens.ts";
import { type Listes, publieLu, quelleDate } from "../listes.ts";
import type { VueModule } from "../modale.ts";
import { partager } from "../partage.ts";
import { documentHref, type Route } from "../routes.ts";
import { signalerHref } from "../signaler.ts";
import { axeA, coupeMots, montantA, pleinEcran, repli } from "../socle-a.ts";
import { tidy, titleCase } from "../texte.ts";
import type { TypeCle } from "../types.ts";
import { type BaseState, type Partage, partageDe, Vue } from "../vue.ts";
import { avantVol, casseNormale, type Publication } from "./accueil-outils.ts";
import { ditActes } from "./actes-mots.ts";
import {
  argentParAnnee,
  articleEpci,
  camerasAutorisees,
  classeMotif,
  contracte,
  fournisseurs,
  grandsSystemes,
  joursDeVol,
  joursPublies,
  rang,
  type Serie,
  strate,
} from "./commune-a.ts";
import { couvertureActes, horsCommune, lecture, type RowActes } from "./comparer-a.ts";
import { exportRows } from "./documents.ts";
import "./commune-a.css";
import template from "./commune.html?raw";

type Props = Extract<Route, { view: "commune" }> & { d: Donnees };
type VueArgent = "tous" | "ville" | "hab";
type Mesure = "cameras" | "eph" | "drones";
type Onglet = "con" | "ao" | "aut" | "sub";
/** « Tous les documents »'s menus (the board's Année ▾, Entreprise ▾, Montant ▾) and the filter a
 * shape's click puts there (a part of the cameras' bar, Lyon-A-comportements): read on the chips,
 * lifted in one click. */
type Part = "mairie" | "commerces" | "autres";
type Tranche = "" | "m1" | "m2" | "m3";
type State = BaseState & {
  X: Listes | null;
  argent: VueArgent;
  masque: Serie[];
  annee: string;
  entF: string;
  tranche: Tranche;
  part: Part | "";
  tri: "date" | "montant";
  motifF: string;
  volF: "" | "avant" | "jour_meme" | "apres";
  /** a year's column clicked with every buyer shown: the contracts of the whole territory */
  territoire: boolean;
  menu: string;
  /** the calendar on the next 30 days' authorised flights (« À venir ») */
  avenir: boolean;
  col: string | null;
  jour: string | null;
  mesure: Mesure;
  onglet: Onglet;
  cite: boolean;
};

const ordinal = (n: number): string =>
  n === 1 ? t("commune_a.premier") : t("commune_a.nieme", { n });
const jourCourt = (d: string): string =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`));
/** A document's date said with what it is (Ju 11/11: « signé le », « publié le », « daté du »,
 * « attribuée le », « vol le »; listes.ts quelleDate): a drone act's row is its first day of
 * flight. */
const dateDite = (e: Evenement): string => {
  if (!e.date) return "";
  if (e.t === "arrete_drone") return t("commune_a.vol_le", { d: jourCourt(e.date) });
  const k = quelleDate(e);
  return k === "annee" || k === "attribuee_an"
    ? t(`liste.date.${k}`, { an: e.date.slice(0, 4) })
    : t(`liste.date.${k}`, { date: jourCourt(publieLu(e) ?? e.date) });
};
const moisCourt = (d: string): string =>
  new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(
    new Date(`${d}T12:00:00Z`),
  );
/** « le 6 et le 8 nov. », « le 30 déc. 2025 et le 2 janv. »: days of publication, a month once
 * after its last day, a year only when it is not the build's (commune-a.ts joursPublies). */
function datesPubliees(isos: (string | null | undefined)[], an: string): string {
  const items = joursPublies(isos, an).flatMap((g) =>
    g.jours.map((j, i) => {
      const le = j === 1 ? t("commune_a.le_premier") : t("commune_a.le_jour", { d: j });
      if (i < g.jours.length - 1) return le;
      // the day and its month never apart
      return `${le}\u00a0${moisCourt(`${g.mois}-01`)}${g.an ? `\u00a0${g.an}` : ""}`;
    }),
  );
  return items.length > 1
    ? `${items.slice(0, -1).join(", ")}${t("commune_a.et_jours")}${items[items.length - 1]}`
    : (items[0] ?? "");
}
const ent = (href: string | null, text: string, cls = "ent"): RichItem =>
  href ? { a: { href, text, cls } } : text;
const nomStrate = (s: number): string => t(`commune_a.strate.${s}`);
/** The strate in a head figure's two lines: its bounds alone (« 20 000 à 100 000 hab. »). */
const nomStrateC = (s: number): string => t(`commune_a.strate_c.${s}`);
const clsSerie = (s: Serie): string =>
  s === "ville" ? "c-ville" : s === "transports" ? "c-transp" : "c-autres";

/** The days an act of the commune's zones covers (its periods, in Paris days), as a drone act's. */
function joursZones(d: Donnees): { id: string; t: string; jours: string[] }[] {
  const jour = (ms: number) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date(ms));
  return d.f.zones.autorisations
    .filter((a) => a.kind === "drone" && a.insee.includes(d.insee))
    .map((a) => {
      const js = new Set<string>();
      for (const p of a.periodes ?? []) {
        for (let ms = p.t0; ms <= p.t1 && js.size < 400; ms += 86400000) js.add(jour(ms));
        js.add(jour(p.t1));
      }
      return { id: String((a as { acte?: string }).acte ?? ""), t: "arrete_drone", jours: [...js] };
    });
}

/** Each drone act's days of flight: its own `jours`, else its zones' periods (the pilot's acts). */
function joursParActe(d: Donnees): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const z of joursZones(d)) if (z.id) m.set(z.id, [...(m.get(z.id) ?? []), ...z.jours]);
  for (const e of d.all)
    if (e.t === "arrete_drone" && ((e.jours as string[] | undefined) ?? []).length)
      m.set(e.id, e.jours as string[]);
  return m;
}

/** « Publiés quand ? »'s bar clicked: the commune's drone acts of that part (their recueil's day,
 * `publie`, against their first day of flight), the latest published first. */
function volListe(
  all: Evenement[],
  k: "avant" | "jour_meme" | "apres",
  insee: string,
  jpa: Map<string, string[]>,
): { d: string; l: RichItem[]; e: string }[] {
  const jour = 864e5;
  return all
    .filter((e) => e.t === "arrete_drone" && !(e as { fin?: string }).fin)
    .map((e) => {
      const pub = String((e as { publie?: string }).publie ?? "");
      const j0 = [...(jpa.get(e.id) ?? [])].sort()[0] ?? "";
      const ecart = pub && j0 ? Math.round((Date.parse(pub) - Date.parse(j0)) / jour) : null;
      return { e, pub, ecart };
    })
    .filter(
      (x) =>
        x.ecart != null &&
        (k === "avant" ? x.ecart < 0 : k === "jour_meme" ? x.ecart === 0 : x.ecart > 0),
    )
    .sort((a, b) => (b.ecart ?? 0) - (a.ecart ?? 0))
    .slice(0, 12)
    .map((x) => ({
      d: t("commune_a.publie", { d: datesPubliees([x.pub], "") }),
      l: [
        {
          a: {
            href: `${communeHref(insee, "autorisations")}/${encodeURIComponent(x.e.id)}`,
            text: casseNormale(String(x.e.titre ?? titreDoc(x.e))).slice(0, 90),
          },
        },
      ] as RichItem[],
      e:
        x.ecart === 0
          ? t("commune_a.b.ecart0")
          : x.ecart != null && x.ecart > 0
            ? t("commune_a.b.ecart_apres", { n: x.ecart })
            : t("commune_a.b.ecart_avant", { n: -(x.ecart ?? 0) }),
    }));
}

export class Commune extends Vue<Props, State> {
  private fini = false;

  protected init(): Partial<State> {
    return {
      X: null,
      argent: "tous",
      col: null,
      jour: null,
      mesure: "cameras",
      onglet: "con",
      cite: false,
      masque: [],
      annee: "",
      entF: "",
      tranche: "",
      part: "",
      tri: "date",
      motifF: "",
      volF: "",
      territoire: false,
      menu: "",
      avenir: false,
    };
  }

  /** A menu of « Tous les documents » (the board's Année ▾…): a chip, its values as a listbox;
   * arrows move, Enter or a click chooses, Escape closes, the focus back on the chip. */
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
      focus(`.v-commune-a .dancre.m-${k} > button`);
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
        if (!open) focus(`.v-commune-a .dancre.m-${k} [role=option]`);
      }) as Handler,
      opts: [{ v: "", l: t("commune_a.m_tous") }, ...opts].map((o) => ({
        l: o.l,
        on: o.v === cur ? "true" : "false",
        choisir: (() => {
          this.setState({ ...choisir(o.v), menu: "" });
          focus(`.v-commune-a .dancre.m-${k} > button`);
        }) as Handler,
      })),
      clavier: ((ev) => {
        const os = [
          ...document.querySelectorAll<HTMLElement>(`.v-commune-a .dancre.m-${k} [role=option]`),
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
  /** A pointer down outside the open menu closes it. */
  private dehors = (ev: Event): void => {
    if (this.state.menu && !(ev.target as Element).closest?.(".v-commune-a .dancre"))
      this.setState({ menu: "" });
  };

  /** A shape's click: « Tous les documents » filtered, then reached. */
  private versDocs(patch: Partial<State>): void {
    this.setState({
      annee: "",
      entF: "",
      tranche: "",
      part: "",
      territoire: false,
      menu: "",
      ...patch,
      open: { ...this.state.open, docs: true },
    });
    requestAnimationFrame(() => {
      const el = document.getElementById("documents");
      const doux = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      el?.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" });
    });
  }
  titre(): string {
    return this.props.d.f.commune.nom;
  }
  type(): TypeCle {
    return "commune";
  }
  partage(): Partage | null {
    return partageDe(this.props.d.f.commune.nom, this.props.d.f.partage);
  }

  componentDidMount(): void {
    document.addEventListener("pointerdown", this.dehors, true);
    // the ranks and the neighbours: listes.json once the page is drawn
    load<Listes>("listes.json").then(
      (X) => {
        if (!this.fini) this.setState({ X });
      },
      () => {},
    );
  }
  componentWillUnmount(): void {
    this.fini = true;
    document.removeEventListener("pointerdown", this.dehors, true);
  }

  private basculer = (k: string): void =>
    this.setState({ open: { ...this.state.open, [k]: !this.state.open[k] } });

  /** « Citer »: the fiche's citation, copied. */
  private citer: Handler = () => {
    const c = this.props.d.f.commune;
    const txt = t("commune_a.citation", {
      nom: c.nom,
      date: jourCourt(this.props.d.f.couverture.maj),
      url: `${location.origin}${communeHref(c.insee)}`,
    });
    void navigator.clipboard?.writeText(txt).then(() => {
      this.setState({ cite: true });
      setTimeout(() => {
        if (!this.fini) this.setState({ cite: false });
      }, 2000);
    });
  };

  /** A section's anchor followed in the frame's scroll, smoothly unless motion is reduced. */
  private allerSection: Handler = (ev) => {
    const href = (ev.currentTarget as HTMLAnchorElement).getAttribute("href") ?? "";
    if (!href.startsWith("#")) return;
    const el = document.getElementById(href.slice(1));
    if (!el) return;
    ev.preventDefault();
    // the step's address says the section, as the frame's own anchors do (hote.ts): the back
    // button from another fiche brings the commune back at it
    history.replaceState(history.state, "", href);
    const doux = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" });
  };

  renderVals() {
    const S = this.state;
    const d = this.props.d;
    const f = d.f;
    const c = f.commune;
    const insee = c.insee;
    const nom = c.nom;
    // the commune's name in a sentence, its article contracted (« des Baux-de-Provence »)
    const T = (k: string, p: Record<string, string | number> = {}) => contracte(t(k, p), nom);
    const pop = c.pop ?? 0;
    const maj = f.couverture.maj;
    const s = ess(d);
    const arr = lastArretes(d.all);
    const lus = d.arretes.collectes;
    const X = S.X;
    // which of its decrees are read: the build's reading of each family (couverture_actes, rule
    // registre_couverture@1:actes_commune), « non lu », never 0, where it is not (Ju 09/11,
    // recette 01-02); the counts are the build's (its row, its file's stats), never its documents
    const propre = f.stats.communes[insee] as (RowActes & { arr?: number }) | undefined;
    const hors = horsCommune(f.stats.dep?.depStats, f.stats.dep?.uniq);
    const couv = couvertureActes({
      insee,
      dep: c.dep,
      etat: f.couverture.departement.etat,
      X,
      propre,
      depTotal: f.stats.dep?.depStats,
    });
    const lu = lecture(couv);
    const nCam = X?.lignes.communes[insee]?.cam ?? propre?.cam ?? 0;
    const nDr = X?.lignes.communes[insee]?.dr ?? propre?.dr ?? 0;
    // each family in the words of its served state (Ju 11/11): « lu » the number alone,
    // « non_rattache » a minimum (« au moins N », « aucun encore rattaché ») with its sentence,
    // « non_lu » « Arrêtés de l'Allier pas encore lus »; a minimum has no rank
    const depN = (f.couverture.departement as { nom?: string }).nom;
    const dit = {
      cam: ditActes(couv.cam, nCam, c.dep, { nomDep: depN }),
      dr: ditActes(couv.dr, nDr, c.dep, { nomDep: depN }),
    };
    const min = { cam: couv.cam === "non_rattache", dr: couv.dr === "non_rattache" };
    const auMoins = (k: "cam" | "dr", x: string) => (min[k] ? t("socle_a.au_moins", { n: x }) : x);
    const st = strate(pop);
    const pairs = X
      ? Object.entries(X.lignes.communes).filter(
          ([k]) => strate(X.dico.communes[k]?.pop ?? 0) === st,
        )
      : [];
    const pairPop = (k: string) => X?.dico.communes[k]?.pop ?? 0;
    const nomEnt = (siren: string) => entName(f as never, siren);
    const lienEnt = (siren: string): RichItem =>
      ent(f.entreprises[siren]?.ref ? `/registre/entreprise/${siren}` : null, nomEnt(siren));
    const an0 = s.counted[0]?.date?.slice(0, 4) ?? "";
    const depNom = (f.couverture.departement as { nom?: string }).nom ?? c.dep;

    // --- the figures --------------------------------------------------------------------------
    const carteN = d.carte;
    const eur = s.eur;
    const eph = pop > 0 && eur > 0 ? eur / pop : null;
    const jours = joursDeVol([...d.all, ...joursZones(d)], maj);
    // the days of flight: the build's figure (listes.json `jv`, A's rule, one source per figure)
    // once loaded; the calendar's own count until then
    const jvServi = X?.lignes.communes[insee]?.jv;
    const nj = jvServi ?? jours.size;
    const auj = d.all.filter(
      (e) => e.t === "arrete_drone" && ((e.jours as string[] | undefined) ?? []).includes(maj),
    );
    const nAuj = auj.length;
    const pubDe = (e: Evenement) => String((e as { publie?: string }).publie ?? "");
    const pubs = auj.map(pubDe).filter(Boolean);
    const sansPub = nAuj - pubs.length;
    const aujPhrase = pubs.length
      ? T("commune_a.auj_phrase", {
          n: nAuj,
          p: pubs.length,
          dates: datesPubliees(pubs, maj.slice(0, 4)),
          sans: sansPub ? T("commune_a.auj_sans", { q: sansPub }) : "",
        })
      : T("commune_a.auj_phrase_0", { n: nAuj });
    const pubOffres = s.counted.filter((e) => typeof e.offres === "number");
    const uneOffre = d.all.filter(
      (e) => e.t === "attribution" && !e.communal && !e.copie && e.offres === 1,
    ).length;
    const rCarte = X
      ? rang(
          carteN,
          pairs.map(([, v]) => v.carte ?? -1),
        )
      : null;
    const rEph = X
      ? rang(
          eph,
          pairs.map(([k, v]) =>
            (v.amt ?? 0) > 0 && pairPop(k) > 0 ? (v.amt ?? 0) / pairPop(k) : -1,
          ),
        )
      : null;
    const rJv =
      X && nj > 0 && !min.dr
        ? rang(
            nj,
            pairs.map(([, v]) => ((v.jv ?? 0) > 0 ? (v.jv ?? 0) : -1)),
          )
        : null;
    // the rank's dots: each city of the size class, its name and value in its bubble, its fiche on
    // a click (Lyon-A-comportements, « Points de rang »)
    const dots = (
      r: { r: number; n: number } | null,
      val: (k: string, v: (typeof pairs)[number][1]) => number,
      fmt: (v: number) => string,
    ) =>
      r && r.n <= 15
        ? pairs
            .map(([k, v]) => ({ k, v: val(k, v) }))
            .filter((x) => x.v >= 0)
            .sort((a, b) => b.v - a.v)
            .map((x, i) => ({
              cls: x.k === insee ? "dot me" : "dot",
              bh: X?.dico.communes[x.k]?.nom ?? x.k,
              bl: `${fmt(x.v)} · ${ordinal(i + 1)}`,
              go: x.k === insee ? "" : communeHref(x.k),
              bc: x.k === insee ? "" : T("commune_a.b.fiche"),
              // a dot that opens a fiche is reached by Tab, Enter opens it (recette 33)
              tab: x.k === insee ? null : "0",
              role: x.k === insee ? null : "link",
              al: `${X?.dico.communes[x.k]?.nom ?? x.k} · ${fmt(x.v)} · ${ordinal(i + 1)}`,
            }))
        : null;
    // a figure's rank: its strate named on the first figure only, as the board writes it (« 2e sur
    // 11 villes de 200 000 hab. et plus », then « 2e sur 11 »), by its bounds alone to hold in two
    // lines; the full words in its bubble
    const rk = (r: { r: number; n: number } | null, extra = "", strate = "") =>
      r
        ? `${
            strate
              ? T("commune_a.rang", { r: ordinal(r.r), n: fr(r.n), strate })
              : T("commune_a.rang_c", { r: ordinal(r.r), n: fr(r.n) })
          }${extra}`
        : extra.replace(/^ · /, "");
    const tout = nomStrate(st);
    const nomEpci = f.stats.epci?.nom ?? "";
    const figs = [
      {
        // outside the map (overseas): « hors carte » and why, never « 0 » (recette 10)
        cls: carteN == null ? "fig nl" : "fig",
        k: T("commune_a.fig.cameras"),
        v: carteN == null ? T("commune_a.fig.hors_carte") : fr(carteN),
        u: "",
        l: carteN == null ? T("commune_a.fig.hors_carte_l") : T("commune_a.fig.cameras_l"),
        dots: dots(
          rCarte,
          (_k, v) => v.carte ?? -1,
          (v) => T("commune_a.b.cameras", { n: fr(v) }),
        ),
        r: rk(rCarte, "", nomStrateC(st)),
        // ranked by the number of cameras, not per inhabitant as the lists and the neighbours are:
        // its bubble says so (recette 28)
        rb: rCarte
          ? T("commune_a.rang_cam", { r: ordinal(rCarte.r), n: fr(rCarte.n), strate: tout })
          : "",
        tip: T("commune_a.fig.cameras_tip", { nom }),
        href: "#cameras",
      },
      {
        cls: eph == null ? "fig nl" : "fig",
        k: T("commune_a.fig.argent"),
        v: eph == null ? T("commune_a.fig.argent_aucun") : fr(eph),
        u: eph == null ? "" : T("commune_a.fig.argent_u"),
        l:
          eph == null
            ? T("commune_a.fig.argent_l0")
            : T("commune_a.fig.argent_l", { m: montantA(eur), y: an0 }),
        dots: dots(
          rEph,
          (k, v) => ((v.amt ?? 0) > 0 && pairPop(k) > 0 ? (v.amt ?? 0) / pairPop(k) : -1),
          (v) => T("commune_a.b.eph", { n: fr(Math.round(v)) }),
        ),
        r: rk(rEph),
        rb: rk(rEph, "", tout),
        tip: T("commune_a.fig.argent_tip"),
        href: "#argent",
      },
      {
        cls: (!lu.dr || min.dr) && !nj ? "fig nl" : "fig",
        k: T("commune_a.fig.drones"),
        // a minimum's « au moins » small before its number, in the unit's size
        pre: min.dr && nj ? t("socle_a.au_moins_pre") : "",
        v: (!lu.dr || min.dr) && !nj ? ditActes(couv.dr, 0, c.dep, { nomDep: depN }).v : fr(nj),
        u: (!lu.dr || min.dr) && !nj ? "" : t("carte_a.jours_u", { n: nj }),
        l: (!lu.dr || min.dr) && !nj ? dit.dr.phrase : T("commune_a.fig.drones_l"),
        dots: dots(
          rJv,
          (_k, v) => ((v.jv ?? 0) > 0 ? (v.jv ?? 0) : -1),
          (v) => T("commune_a.b.jours", { n: v }),
        ),
        r: rk(rJv, nAuj ? ` · ${T("commune_a.fig.auj", { n: nAuj })}` : ""),
        rb: rk(rJv, nAuj ? ` · ${T("commune_a.fig.auj", { n: nAuj })}` : "", tout),
        tip:
          min.dr && nj
            ? `${dit.dr.phrase}.\n${T("commune_a.fig.drones_tip", { nom })}`
            : T("commune_a.fig.drones_tip", { nom }),
        href: "#drones",
      },
      {
        cls: pubOffres.length ? "fig" : "fig nl",
        k: T("commune_a.fig.concurrence"),
        v: pubOffres.length
          ? T("commune_a.fig.offres_v", {
              n: pubOffres.filter((e) => e.offres === 1).length,
              m: pubOffres.length,
            })
          : T("commune_a.fig.non_publiee"),
        u: "",
        l: pubOffres.length
          ? T("commune_a.fig.offres_l")
          : T("commune_a.fig.non_publiee_l", { n: s.counted.length }),
        dots: null,
        r: uneOffre ? T("commune_a.fig.territoire", { n: uneOffre }) : "",
        rb: uneOffre ? T("commune_a.fig.territoire", { n: uneOffre }) : "",
        tip: T("commune_a.fig.concurrence_tip"),
        href: "#entreprises",
      },
    ];

    // --- the lead -----------------------------------------------------------------------------
    const lead: RichItem[] = [];
    // a sentence's point, once: a size class already ends on « hab. » (recette 21, « hab.. »)
    const point = (sep: string) => {
      if (!lead.length) return;
      const last = lead[lead.length - 1];
      if (typeof last === "string" && /\.\s*$/.test(last)) {
        if (sep.endsWith(" ")) lead[lead.length - 1] = `${last.trimEnd()} `;
      } else lead.push(sep);
    };
    if (eur > 0) {
      lead.push(
        T("commune_a.lead_a", { nom }),
        { strong: montantA(eur) },
        T("commune_a.lead_b", { y: an0 }),
      );
      if (eph != null) lead.push({ strong: T("commune_a.lead_eph", { n: fr(eph) }) });
      if (rEph)
        lead.push(
          T("commune_a.lead_rang", { r: ordinal(rEph.r), n: rEph.n, strate: nomStrate(st) }),
        );
      point(". ");
    }
    if (carteN != null)
      lead.push({ strong: T("commune_a.lead_cam", { n: fr(carteN) }) }, T("commune_a.lead_cam_b"));
    if (nj)
      lead.push(
        T("commune_a.lead_dr_a"),
        { strong: auMoins("dr", T("commune_a.lead_dr", { n: nj })) },
        T("commune_a.lead_dr_b"),
      );
    point(".");

    // --- the sections, numbered in turn ---------------------------------------------------------
    let n = 0;
    const num = () => String(++n);
    const toc: { href: string; l: string; cls: string; go: Handler }[] = [];
    const entree = (id: string, l: string) =>
      toc.push({ href: `#${id}`, l, cls: "", go: this.allerSection });

    // 1 · cameras
    const parts = camerasAutorisees(arr);
    const systemes = grandsSystemes(arr);
    const camN = num();
    entree("cameras", `${camN} · ${T("commune_a.toc.cameras")}`);
    // the first year of the decrees read (not the day their collection began)
    const depuis =
      arr
        .map((e) => (e.date ?? "").slice(0, 4))
        .filter(Boolean)
        .sort()[0] ?? "2024";
    const pct = (v: number) => Math.round((100 * v) / Math.max(1, parts.total));
    // five cases (recette 02, Ju 11/11): the cameras its decrees authorise; its decrees counted,
    // their cameras not read; none, read (a true 0); none attached yet where its département's are
    // not all (« non_rattache »: the others are minimums); its decrees not read
    const camCas = !lu.cam ? "nl" : parts.total ? "lus" : nCam ? "nb" : min.cam ? "nr0" : "aucun";
    const voirArretes: Handler = (ev) => {
      ev.preventDefault();
      this.versDocs({ onglet: "aut" });
    };
    const cam = {
      n: camN,
      ans: [
        ...(camCas === "lus"
          ? [
              T("commune_a.cam_ans_a", { y: depuis }),
              { strong: auMoins("cam", T("commune_a.cam_ans_n", { n: fr(parts.total) })) },
              T("commune_a.cam_ans_b", { nom }),
            ]
          : camCas === "nb"
            ? [
                { strong: auMoins("cam", T("commune_a.cam_ans_nb", { n: nCam, y: depuis })) },
                T("commune_a.cam_ans_nb_b", { nom }),
              ]
            : camCas === "aucun"
              ? [T("commune_a.cam_ans_aucun", { nom, y: depuis })]
              : camCas === "nr0"
                ? [T("commune_a.cam_ans_nr0", { nom })]
                : [dit.cam.phrase]),
        ...(carteN != null ? [T("commune_a.cam_ans_c"), { strong: fr(carteN) }, "."] : ["."]),
      ] as RichItem[],
      kAut: T("commune_a.cam_k", { y: depuis }),
      parts:
        lu.cam && parts.total
          ? (
              [
                ["mairie", "c-ville", parts.mairie],
                ["commerces", "c-comm", parts.commerces],
                ["autres", "c-autres", parts.autres],
              ] as const
            )
              .filter(([, , v]) => v > 0)
              .map(([k, cls, v]) => ({
                // a narrow part's number lives in the legend on a phone (pt: under a tenth)
                cls: `seg ${cls}${pct(v) < 10 ? " pt" : ""}`,
                sw: `sw ${cls}`,
                st: `flex: ${v}`,
                v: fr(v),
                l: t(`commune_a.part.${k}`),
                bl: `${fr(v)} · ${pct(v)} %`,
                pick: (() => this.versDocs({ onglet: "aut", part: k })) as Handler,
              }))
          : null,
      etat: camCas === "nl" ? dit.cam.v : "",
      // a minimum says why, once (« Une partie des arrêtés du département… »)
      nonLu: [
        camCas === "nb" ? T("commune_a.cam_nb_nl", { n: nCam }) : "",
        min.cam ? `${dit.cam.phrase}.` : "",
        camCas === "nr0" && hors?.cam ? T("commune_a.cam_non_lu_hors", { n: hors.cam, nom }) : "",
        camCas !== "nl" ? "" : !lus ? T("commune_a.cam_non_lu") : T("commune_a.cam_non_lu_c"),
      ]
        .filter(Boolean)
        .join(" "),
      aucun: camCas === "aucun" ? T("commune_a.cam_aucun_lu", { y: depuis }) : "",
      voir: camCas === "nb" ? { l: T("commune_a.cam_voir", { n: nCam }), pick: voirArretes } : null,
      osm: carteN ? fr(carteN) : "",
      osmNon: carteN === 0,
      osmHors: carteN == null ? T("commune_a.releves_hors", { nom }) : "",
      carteHref: communeHref(insee, "carte"),
      osmB: T("commune_a.b.osm_clic", { nom }),
      note: T("commune_a.cam_note", { y: depuis }),
      systemes: systemes.length
        ? systemes.map((x) => ({
            nom: [
              x.siren && f.entreprises[x.siren]?.ref ? lienEnt(x.siren) : tidy(titleCase(x.nom)),
            ] as RichItem[],
            n: T("commune_a.arretes_n", { n: x.arretes }),
            cams: fr(x.cameras),
          }))
        : null,
    };

    // 2 · money: every counted contract on its territory, by year and by buyer
    const territoire = d.all.filter((e) => e.t === "attribution" && e.compte && !e.copie);
    const serie = (e: Evenement): Serie => {
      if (e.communal) return "ville";
      const b = d.buyer(e);
      return b && f.acheteurs[b]?.categorie === "transports" ? "transports" : "autres";
    };
    const vue = S.argent;
    const tousPris = vue === "tous" ? territoire : territoire.filter((e) => e.communal);
    // a series hidden from its legend leaves the bars (Lyon-A-comportements, « Légende »)
    const pris = tousPris.filter((e) => !S.masque.includes(serie(e)));
    const { annees } = argentParAnnee(pris, serie as never);
    const { totaux } = argentParAnnee(tousPris, serie as never);
    const subs = s.subs.length;
    let arg = null;
    if (territoire.length) {
      const argN = num();
      entree("argent", `${argN} · ${T("commune_a.toc.argent")}`);
      // euros, or euros per inhabitant: the axis's unit and round graduations (socle-a.ts axeA)
      const k = vue === "hab" && pop > 0 ? 1 / pop : 1;
      const tot = (a: (typeof annees)[number]) => (a.ville + a.transports + a.autres) * k;
      const ax = axeA(Math.max(0, ...annees.map(tot)), vue === "hab" ? "reel" : "eur");
      const haut = ax.haut || 1;
      const y = (v: number) => 226 - (196 * v) / haut;
      const slot = 900 / Math.max(1, annees.length);
      const w = Math.min(70, slot - 24);
      const v1 = ax.val;
      const cols = annees.map((a, i) => {
        const x = 70 + i * slot + (slot - w) / 2;
        let base = 226;
        const rects = (["ville", "transports", "autres"] as const)
          .filter((s2) => a[s2] > 0)
          .map((s2) => {
            const h = (196 * a[s2] * k) / haut;
            base -= h;
            return { cls: clsSerie(s2), y: base.toFixed(1), h: h.toFixed(1) };
          });
        const tv = tot(a);
        const parSerie = (["ville", "transports", "autres"] as const).filter((s2) => a[s2] > 0);
        const nb = (s2: Serie) =>
          pris.filter((e) => (e.date ?? "").startsWith(a.an) && serie(e) === s2).length;
        return {
          bh: `${a.an} · ${vue === "hab" ? T("commune_a.tip_hab", { n: fr(tv) }) : montantA(a.ville + a.transports + a.autres)}`,
          bl: parSerie
            .map(
              (s2) =>
                `§${clsSerie(s2)}§${t(`commune_a.serie.${s2}`, { nom })} · ${montantA(a[s2])} · ${T("commune_a.b.contrats", { n: nb(s2) })}`,
            )
            .join("\n"),
          bc: tv > 0 ? T("commune_a.b.col_clic") : "",
          tab: tv > 0 ? "0" : "-1",
          pick: (() => {
            if (tv > 0) this.versDocs({ onglet: "con", annee: a.an, territoire: vue === "tous" });
          }) as Handler,
          an: a.an,
          x: x.toFixed(1),
          w: w.toFixed(1),
          cx: (x + w / 2).toFixed(1),
          hx: (x - 10).toFixed(1),
          hw: (w + 20).toFixed(1),
          vy: (y(tv) - 6).toFixed(1),
          v: tv > 0 ? v1(tv) : "",
          rects,
        };
      });
      arg = {
        n: argN,
        ans: [
          ...(eur > 0
            ? [
                T("commune_a.arg_ans_a"),
                { strong: montantA(eur) },
                T("commune_a.arg_ans_b", { n: s.counted.length }),
                T("commune_a.arg_ans_y", { y: an0 }),
              ]
            : [T("commune_a.arg_ans_0", { nom })]),
          ...(totaux.transports > 0 && vue === "tous"
            ? [T("commune_a.arg_ans_tr"), { strong: montantA(totaux.transports) }, "."]
            : []),
          " ",
          subs ? T("commune_a.arg_ans_sub", { n: subs }) : T("commune_a.arg_ans_nosub"),
        ] as RichItem[],
        titre: T("commune_a.argent_titre", { nom }),
        vues: (["tous", "ville", "hab"] as const).map((o) => ({
          l: t(`commune_a.argent_vue.${o}`),
          on: vue === o ? "true" : "false",
          pick: (() => this.setState({ argent: o, col: null })) as Handler,
        })),
        grille: [
          ...ax.ticks.map((g) => ({
            y: y(g.v).toFixed(1),
            ty: (y(g.v) + 4).toFixed(1),
            l: g.l,
          })),
          {
            y: "-20",
            ty: "20",
            l: t(
              vue === "hab"
                ? "commune_a.unite_hab"
                : ax.u === "me"
                  ? "commune_a.unite_m"
                  : "commune_a.unite_e",
            ),
          },
        ],
        // euros take more room than millions: the axis's numbers move the drawing to the right
        vb: ax.u === "e" ? "-18 0 1018 270" : "0 0 1000 270",
        vw: ax.u === "e" ? "1018" : "1000",
        cols,
        leg: (["ville", "transports", "autres"] as const)
          .filter((s2) => totaux[s2] > 0 || s2 === "ville")
          .map((s2) => ({
            sw: `sw ${clsSerie(s2)}`,
            s: s2,
            l: t(`commune_a.serie.${s2}`, { nom }),
            v: totaux[s2] > 0 ? montantA(totaux[s2]) : T("commune_a.aucun"),
            on: S.masque.includes(s2) ? "false" : "true",
            pick: (() =>
              this.setState({
                masque: S.masque.includes(s2)
                  ? S.masque.filter((x) => x !== s2)
                  : [...S.masque, s2],
              })) as Handler,
          })),
        legSub: [
          {
            sw: "sw c-sub",
            l: T("commune_a.serie.sub"),
            v: subs ? fr(subs) : T("commune_a.aucune_trouvee"),
          },
        ],
      };
    }

    // 3 · companies: those of its own contracts
    const fs = fournisseurs(s.counted);
    let entS = null;
    if (fs.length) {
      const entN = num();
      entree("entreprises", `${entN} · ${T("commune_a.toc.entreprises")}`);
      const max = Math.max(1, fs[0].montant);
      const autres = (siren: string) => {
        const cl = X?.lignes.entreprises[siren]?.clientes;
        return cl != null ? Math.max(0, cl - 1) : null;
      };
      const top = fs.slice(0, 5);
      const part = Math.round((100 * fs[0].montant) / Math.max(1, eur));
      entS = {
        n: entN,
        ans: [
          { strong: T("commune_a.ent_ans_n", { n: fs.length }) },
          T("commune_a.ent_ans_a", { y: an0 }),
          ...(fs.length > 1 && part >= 50
            ? [" ", lienEnt(fs[0].siren), T("commune_a.ent_ans_b", { p: part })]
            : []),
        ] as RichItem[],
        r: repli(S.open, "fourn", t("accueil.voir_detail"), top.length, this.basculer),
        rows: top.map((x, i) => {
          const o = autres(x.siren);
          return {
            cls: `sup i${i}`,
            nom: [lienEnt(x.siren)] as RichItem[],
            st: `width: ${((100 * x.montant) / max).toFixed(1)}%`,
            m: montantA(x.montant),
            c: `${T("commune_a.ent_c", { n: x.contrats })} · ${x.annees.join(", ")}`,
            o: o == null ? "" : o ? T("commune_a.ent_o", { n: o }) : T("commune_a.ent_o0"),
            // « N autres acheteurs »: the graph centred on the company (Lyon-A-comportements, lot 4)
            og: o && f.entreprises[x.siren]?.ref ? `/registre/graphe/${x.siren}` : "",
            // the words without their link: no other buyer, or no fiche to centre on
            oSeul: o != null && !(o && f.entreprises[x.siren]?.ref),
          };
        }),
        g: {
          titre: T("commune_a.graphe_titre", { nom }),
          nodes: top.map((x, i) => {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / top.length;
            const r = 130;
            const nx = 300 + r * Math.cos(a);
            const ny = 204 + r * Math.sin(a) * 0.9;
            const sz = 12 + 20 * Math.sqrt(x.montant / max);
            const o = autres(x.siren);
            const mx = 300 + (r + 62) * Math.cos(a);
            const my = 204 + (r + 62) * Math.sin(a) * 0.9;
            const aFiche = !!f.entreprises[x.siren]?.ref;
            return {
              cls: `nd i${i}`,
              ci: `i${i}`,
              bh: nomEnt(x.siren),
              bl: [
                T("commune_a.b.avec", { nom, m: montantA(x.montant) }),
                o == null ? "" : T("commune_a.ent_o_b", { n: o }),
              ]
                .filter(Boolean)
                .join("\n"),
              bc: aFiche ? T("commune_a.b.graphe", { nom: nomEnt(x.siren) }) : "",
              x: nx.toFixed(0),
              y: ny.toFixed(0),
              rx: (nx - sz / 2).toFixed(1),
              ry: (ny - sz / 2).toFixed(1),
              s: sz.toFixed(1),
              ty: (ny + (Math.sin(a) > 0.2 ? -sz / 2 - 8 : sz / 2 + 18)).toFixed(0),
              l: nomEnt(x.siren),
              // a node's click recentres the graph on it (Lyon-A-comportements): the centred graph
              href: f.entreprises[x.siren]?.ref ? `/registre/graphe/${x.siren}` : "",
              sans: !f.entreprises[x.siren]?.ref,
              mo: o ? `+${fr(o)}` : "",
              // the circle holds its text: about 8 px a character at 12.5 px, 6 px of margin
              mr: o ? Math.max(15, 4 * `+${fr(o)}`.length + 6) : 15,
              mx: mx.toFixed(0),
              my: my.toFixed(0),
            };
          }),
        },
      };
    }

    // 4 · dossiers: the commune's own affairs with more than one document, the largest first
    const affs = Object.entries(f.affaires)
      .filter(([, a]) => a.kind === "contrat" && a.acheteur_communal && a.insee === insee)
      .map(([id, a]) => {
        const evs = a.events.map((x) => d.ev.get(x)).filter((e): e is Evenement => !!e && !e.copie);
        const con = evs.filter((e) => e.t === "attribution");
        return { id, a, evs, montant: con.reduce((x, e) => x + (e.montant ?? 0), 0) };
      })
      .filter((x) => x.evs.length > 1)
      .sort((p, q) => q.montant - p.montant)
      .slice(0, 3);
    let dos = null;
    if (affs.length) {
      const dosN = num();
      entree("dossiers", `${dosN} · ${T("commune_a.toc.dossiers")}`);
      dos = {
        n: dosN,
        rows: affs.map((x, i) => {
          const ans = x.evs
            .map((e) => (e.date ?? "").slice(0, 4))
            .filter(Boolean)
            .sort();
          const per = ans.length
            ? `, ${ans[0] === ans[ans.length - 1] ? ans[0] : `${ans[0]}-${ans[ans.length - 1]}`}`
            : "";
          const titre = `${casseNormale(String(x.a.titre ?? "")).replace(/…$/, "")}${per}`;
          const mods = x.evs.filter((e) => e.t === "modification").length;
          const steps = [...x.evs]
            .filter((e) => e.t !== "modification")
            .sort((p, q) => (p.date ?? "").localeCompare(q.date ?? ""))
            .map((e) => {
              const k = /^(avis|rectificatif)$/.test(e.t)
                ? "avis"
                : e.t === "attribution"
                  ? "contrat"
                  : e.t === "resultat"
                    ? "attr"
                    : "arrete";
              return {
                cls: `st ${k}`,
                k: t(`commune_a.etape.${k}`),
                d: dateDite(e),
                b:
                  k === "contrat"
                    ? ((e.entreprises ?? []).flatMap((sr, j) => [
                        ...(j ? [", "] : []),
                        lienEnt(sr),
                      ]) as RichItem[])
                    : ([String(e.ref ?? titreDoc(e)).replace(/^.*, /, "")] as RichItem[]),
                s:
                  k === "contrat"
                    ? [
                        e.montant ? T("commune_a.plafond", { m: montantA(e.montant) }) : "",
                        mods ? T("commune_a.modifs", { n: mods }) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "",
              };
            });
          return {
            r: repli(
              S.open,
              `dos${i}`,
              titre,
              steps.length,
              this.basculer,
              S.annee && ans.includes(S.annee) ? "card dos mark" : "card dos",
            ),
            titre,
            href: documentHref(x.id),
            m: x.montant ? montantA(x.montant) : "",
            steps,
          };
        }),
      };
    }

    // 5 · drones
    let dr = null;
    if (nj || nAuj) {
      const drN = num();
      entree("drones", `${drN} · ${T("commune_a.toc.drones")}`);
      // the calendar: twelve months of weeks ending on the update's day, Monday first; « À venir »:
      // the 30 days after it
      const fin = new Date(`${maj}T12:00:00Z`);
      const debut = new Date(fin);
      if (S.avenir) {
        debut.setUTCDate(debut.getUTCDate() + 1);
        fin.setUTCDate(fin.getUTCDate() + 30);
      } else debut.setUTCMonth(debut.getUTCMonth() - 12);
      debut.setUTCDate(debut.getUTCDate() - ((debut.getUTCDay() + 6) % 7));
      const finIso = fin.toISOString().slice(0, 10);
      // a motive's bar chosen: the calendar on that motive's acts only
      const jpa = joursParActe(d);
      const joursCal =
        S.motifF || S.avenir
          ? joursDeVol(
              d.all
                .filter(
                  (e) =>
                    e.t === "arrete_drone" &&
                    (!S.motifF || classeMotif((e as { motif?: unknown }).motif) === S.motifF),
                )
                .map((e) => ({ t: e.t, jours: jpa.get(e.id) ?? [] })),
              S.avenir ? finIso : maj,
              S.avenir ? 1 : 12,
            )
          : jours;
      const jourLong = (iso: string) =>
        new Intl.DateTimeFormat("fr-FR", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${iso}T12:00:00Z`));
      const cases: {
        cls: string;
        x: string;
        y: string;
        bh: string;
        bl: string;
        bc: string;
        tab: string;
        pick: Handler;
      }[] = [];
      const mois: { x: string; l: string }[] = [];
      let col = 0;
      let dernier = -1;
      for (const dt = new Date(debut); dt <= fin; dt.setUTCDate(dt.getUTCDate() + 1)) {
        const iso = dt.toISOString().slice(0, 10);
        const wd = (dt.getUTCDay() + 6) % 7;
        if (wd === 0 && dt > debut) col++;
        if (wd === 0 && dt.getUTCMonth() !== dernier) {
          dernier = dt.getUTCMonth();
          mois.push({ x: String(24 + col * 15), l: moisCourt(iso) });
        }
        const nb = joursCal.get(iso) ?? 0;
        cases.push({
          cls: `${nb >= 2 ? "c2" : nb === 1 ? "c1" : "c0"}${iso === maj ? " today" : ""}${S.avenir && iso <= maj ? " passe" : ""}`,
          x: String(24 + col * 15),
          y: String(16 + wd * 15),
          bh: jourLong(iso),
          bl: T("commune_a.b.arretes_dr", { n: nb }),
          bc: nb ? T("commune_a.b.jour_clic") : "",
          tab: nb ? "0" : "-1",
          pick: (() => {
            if (nb) allerA(`${communeHref(insee, "carte")}?jour=${iso}`);
          }) as Handler,
        });
      }
      const W = 24 + (col + 1) * 15;
      // a month's label needs about 24 units: the last one, cut at the edge, is left out
      while (mois.length && Number(mois[mois.length - 1].x) + 24 > W) mois.pop();
      // distinct days per class: two acts of one motive on one day are one day of flight
      const joursMotif = new Map<string, Set<string>>();
      const joursSans = new Set<string>();
      for (const e of d.all)
        if (e.t === "arrete_drone") {
          const m = classeMotif((e as { motif?: unknown }).motif);
          const set = m ? (joursMotif.get(m) ?? joursMotif.set(m, new Set()).get(m)) : joursSans;
          for (const j of jpa.get(e.id) ?? []) if (jours.has(j)) set?.add(j);
        }
      const motifs = new Map([...joursMotif].map(([m, s]) => [m, s.size] as const));
      const sansMotif = joursSans.size;
      const mx = Math.max(1, ...motifs.values(), sansMotif);
      const vol = avantVol((f as { drones?: { publication?: Publication } }).drones?.publication);
      const clsV = { avant: "p-ok", jour_meme: "p-mid", apres: "p-late" } as const;
      // the drone acts as every page counts them (listes.json `dr`: the flights' acts, an act that
      // ends one left out; recette 01), the first year they were read
      const anDr =
        d.all
          .filter((e) => e.t === "arrete_drone")
          .map((e) => (e.date ?? "").slice(0, 4))
          .filter(Boolean)
          .sort()[0] ?? depuis;
      dr = {
        n: drN,
        ans: [
          T("commune_a.dr_ans_a", { nom }),
          { strong: auMoins("dr", T("commune_a.lead_dr", { n: nj })) },
          T("commune_a.dr_ans_b"),
          ...(lu.dr && nDr
            ? [
                " ",
                T(min.dr ? "commune_a.dr_ans_actes_min" : "commune_a.dr_ans_actes", {
                  n: nDr,
                  y: anDr,
                }),
              ]
            : []),
          ...(nAuj
            ? [
                " ",
                { strong: T("commune_a.dr_auj", { d: jourCourt(maj) }) },
                T("commune_a.dr_auj_n", { n: nAuj }),
              ]
            : []),
        ] as RichItem[],
        titre: T("commune_a.cal_titre", { nom }),
        vb: `0 0 ${W} 124`,
        w: String(W),
        h: "124",
        mois,
        jl: [
          { y: "27", l: "L" },
          { y: "57", l: "M" },
          { y: "87", l: "V" },
          { y: "117", l: "D" },
        ],
        cases,
        fenetres: [false, true].map((v) => ({
          l: t(v ? "commune_a.cal_avenir" : "commune_a.cal_12"),
          on: S.avenir === v ? "true" : "false",
          pick: (() => this.setState({ avenir: v })) as Handler,
        })),
        motifF: S.motifF
          ? {
              l: T("commune_a.b.motif_chip", { m: t(`commune_a.motif.${S.motifF}`) }),
              lever: (() => this.setState({ motifF: "" })) as Handler,
            }
          : null,
        // which date (Ju 10/11): the flights are today's, their acts were published earlier
        aujPhrase: nAuj ? aujPhrase : "",
        auj: nAuj
          ? auj.map((e) => ({
              d: pubDe(e)
                ? t("commune_a.publie", { d: datesPubliees([pubDe(e)], maj.slice(0, 4)) })
                : t("commune_a.publie_non_lu"),
              l: [
                {
                  a: {
                    href: `${communeHref(insee, "carte")}?jour=${maj}`,
                    text: `« ${casseNormale(String(e.titre ?? titreDoc(e))).slice(0, 90)} »`,
                  },
                },
              ] as RichItem[],
            }))
          : null,
        aujVide: !nAuj,
        href: `${communeHref(insee, "carte")}${nAuj ? `?jour=${maj}` : ""}`,
        motifs: motifs.size
          ? [
              ...[...motifs]
                .sort((a, b) => b[1] - a[1])
                .map(([m, v]) => ({
                  cls: S.motifF === m ? "hb on" : "hb",
                  q: false,
                  l: t(`commune_a.motif.${m}`),
                  st: `width: ${((100 * v) / mx).toFixed(0)}%`,
                  n: fr(v),
                  bl: T("commune_a.b.jours_vol", { n: v }),
                  bc: T("commune_a.b.motif_clic"),
                  on: S.motifF === m ? "true" : "false",
                  pick: (() => this.setState({ motifF: S.motifF === m ? "" : m })) as Handler,
                })),
              ...(sansMotif
                ? [
                    {
                      cls: "hb q",
                      l: T("commune_a.motif_non_lu"),
                      st: `width: ${((100 * sansMotif) / mx).toFixed(0)}%`,
                      n: fr(sansMotif),
                      bl: T("commune_a.b.jours_vol", { n: sansMotif }),
                      bc: "",
                      on: "",
                      pick: null,
                      q: true,
                    },
                  ]
                : []),
            ]
          : null,
        motifsNonLu: !motifs.size,
        vol: vol.nonLu
          ? { lu: false, nonLu: true, parts: [], note: "", liste: null }
          : {
              lu: true,
              nonLu: false,
              parts: vol.parts.map((x) => ({
                cls: `seg ${clsV[x.k]}${S.volF === x.k ? " on" : ""}`,
                st: `flex: ${Math.max(1, x.pct)}`,
                l: x.pct >= 8 ? fr(x.n) : "",
                sw: `sw ${clsV[x.k]}`,
                leg: `${t(`accueil.vol_${x.k}`)} · ${fr(x.n)}`,
                bh: t(`accueil.vol_${x.k}`),
                bl: `${fr(x.n)} · ${x.pct} %`,
                bc: T("commune_a.b.vol_clic"),
                pick: (() => this.setState({ volF: S.volF === x.k ? "" : x.k })) as Handler,
              })),
              liste: S.volF ? volListe(d.all, S.volF, insee, jpa) : null,
              // the acts whose day of flight and recueil are read, among the commune's drone acts
              note:
                lu.dr && nDr > vol.total
                  ? T("commune_a.publies_note_sur", {
                      n: fr(vol.total),
                      t: fr(nDr),
                      p: vol.parts[2]?.pct ?? 0,
                    })
                  : T("commune_a.publies_note", { n: fr(vol.total), p: vol.parts[2]?.pct ?? 0 }),
            },
      };
    }

    // 6 · neighbours: its intercommunality's communes, its strate (listes.json)
    let vois = null;
    {
      const vN = String(n + 1);
      const m = S.mesure;
      const val = (k: string): number | null => {
        const v = X?.lignes.communes[k];
        const p = pairPop(k);
        if (!v || p <= 0) return null;
        if (m === "cameras") return v.carte != null ? (1000 * v.carte) / p : null;
        if (m === "eph") return (v.amt ?? 0) > 0 ? (v.amt ?? 0) / p : null;
        return (v.jv ?? 0) > 0 ? (v.jv ?? 0) : null;
      };
      const fmt = (v: number) =>
        m === "cameras"
          ? v.toFixed(1).replace(".", ",")
          : m === "eph"
            ? t("socle_a.e", { n: fr(v) })
            : T("commune_a.jours_n", { n: fr(v) });
      const lien = (k: string, nm: string): RichItem[] => [
        ent(X?.dico.communes[k]?.ref ? communeHref(k) : null, nm, ""),
      ];
      const membres =
        X && c.epci
          ? Object.keys(X.lignes.communes).filter((k) => X.dico.communes[k]?.epci === c.epci)
          : [];
      const classe = (ks: string[]) =>
        ks
          .map((k) => ({ k, v: val(k) }))
          .filter((x): x is { k: string; v: number } => x.v != null)
          .sort((a, b) => b.v - a.v);
      const autour = (rows: { k: string; v: number }[], nb: number, ou: string) => {
        const i = rows.findIndex((x) => x.k === insee);
        const lo = Math.max(0, Math.min(i - 2, rows.length - nb));
        // each row says its rank, the window starting where it starts (recette 17: « Lyon 7e »
        // read as 3rd without them)
        return (i < 0 ? rows.slice(0, nb) : rows.slice(lo, lo + nb)).map((x) => ({
          cls: x.k === insee ? "me" : "",
          rg: String(rows.indexOf(x) + 1),
          nom: lien(x.k, X?.dico.communes[x.k]?.nom ?? x.k),
          v: fmt(x.v),
          bh: X?.dico.communes[x.k]?.nom ?? x.k,
          bl: `${fmt(x.v)}\n${T("commune_a.b.rang_ou", { r: ordinal(rows.indexOf(x) + 1), n: rows.length, ou })}`,
          bc: x.k === insee ? "" : T("commune_a.b.fiche"),
        }));
      };
      const debut = (rows: { k: string }[], nb: number) => {
        const i = rows.findIndex((x) => x.k === insee);
        return String(i < 0 ? 1 : Math.max(0, Math.min(i - 2, rows.length - nb)) + 1);
      };
      // the rank's column holds the window's largest rank (« 1 234 » in a size class of thousands)
      const largeurRang = (rows: { k: string }[], nb: number) =>
        `rank rn${Math.max(2, String(Math.min(rows.length, Number(debut(rows, nb)) + nb - 1)).length)}`;
      const ep = classe(membres);
      const sr = classe(pairs.map(([k]) => k));
      const iE = ep.findIndex((x) => x.k === insee);
      const ml = t(`commune_a.mesure_l.${m}`);
      if (X && (ep.length > 1 || sr.length > 1)) {
        n++;
        entree("voisines", `${vN} · ${T("commune_a.toc.voisines")}`);
        vois = {
          n: vN,
          ans:
            iE >= 0 && ep.length > 1
              ? ([
                  T("commune_a.vois_ans", {
                    nom,
                    // « Dans la CC Vallée des Baux-Alpilles » (recette 21)
                    epci: articleEpci(nomEpci),
                    r: ordinal(iE + 1),
                    n: ep.length,
                    m: ml,
                  }),
                ] as RichItem[])
              : ([T("commune_a.vois_ans_strate", { nom, strate: nomStrate(st) })] as RichItem[]),
          mesures: (["cameras", "eph", "drones"] as const).map((o) => ({
            l: t(`commune_a.mesure.${o}`),
            on: m === o ? "true" : "false",
            pick: (() => this.setState({ mesure: o })) as Handler,
          })),
          epci:
            ep.length > 1
              ? {
                  titre: T("commune_a.vois_epci", { epci: nomEpci, m: ml }),
                  rows: autour(ep, 8, nomEpci),
                  start: debut(ep, 8),
                  rn: largeurRang(ep, 8),
                  note: T("commune_a.vois_epci_note", { n: membres.length, k: ep.length }),
                }
              : null,
          strate:
            sr.length > 1
              ? {
                  titre: T("commune_a.vois_strate", { strate: nomStrate(st), m: ml }),
                  rows: autour(sr, 5, nomStrate(st)),
                  start: debut(sr, 5),
                  rn: largeurRang(sr, 5),
                  // the communes that buy through their intercommunality: the money's caveat only
                  note: m === "eph",
                }
              : null,
          attente: "",
          comparer: `/registre/comparer?communes=${encodeURIComponent(insee)}`,
          comparerL: T("commune_a.comparer", { nom }),
        };
      } else if (!X) {
        vois = {
          n: vN,
          ans: [] as RichItem[],
          mesures: [],
          epci: null,
          strate: null,
          attente: T("commune_a.vois_attente"),
        };
      }
    }

    // documents: the four kinds, ten rows of the one chosen, the full list one page away
    const tabs: { k: Onglet; f: (e: Evenement) => boolean }[] = [
      // the commune's own contracts (board: « Contrats · 8 » for Lyon), as its own notices
      {
        k: "con",
        f: S.territoire
          ? (e) => e.t === "attribution" && !e.copie && !!e.compte
          : (e) => e.t === "attribution" && !e.copie && !!e.communal,
      },
      { k: "ao", f: (e) => /^(avis|resultat|rectificatif)$/.test(e.t) },
      { k: "aut", f: (e) => e.t.startsWith("arrete") },
      { k: "sub", f: (e) => e.t.startsWith("subvention") },
    ];
    const ong = tabs.find((x) => x.k === S.onglet) ?? tabs[0];
    const aut = ong.k === "aut";
    const argentDoc = ong.k === "con" || ong.k === "ao" || ong.k === "sub";
    const ongRows = d.all.filter(ong.f);
    // the menus' values: those the kind's documents have
    const anneesDoc = [...new Set(ongRows.map((e) => (e.date ?? "").slice(0, 4)).filter(Boolean))]
      .sort()
      .reverse();
    const parEnt = new Map<string, number>();
    for (const e of ongRows)
      for (const sr of e.entreprises ?? []) parEnt.set(sr, (parEnt.get(sr) ?? 0) + 1);
    const entsDoc = [...parEnt]
      .sort((p, q) => q[1] - p[1] || nomEnt(p[0]).localeCompare(nomEnt(q[0]), "fr"))
      .slice(0, 40);
    const TRANCHES: Record<Exclude<Tranche, "">, [number, number]> = {
      m1: [0, 1e5],
      m2: [1e5, 1e6],
      m3: [1e6, Number.POSITIVE_INFINITY],
    };
    const partDe = (e: Evenement): Part =>
      e.communal
        ? "mairie"
        : /^(commerce|banque)$/.test(String(e.type_beneficiaire ?? ""))
          ? "commerces"
          : "autres";
    const docRows = ongRows
      .filter(
        (e) =>
          (!S.annee || (e.date ?? "").startsWith(S.annee)) &&
          (!S.entF || (e.entreprises ?? []).includes(S.entF)) &&
          (!S.tranche ||
            (e.montant != null &&
              e.montant >= TRANCHES[S.tranche][0] &&
              e.montant < TRANCHES[S.tranche][1])) &&
          (!S.part || (aut && e.t === "arrete" && !e.copie && partDe(e) === S.part)),
      )
      .sort(
        S.tri === "montant"
          ? (p, q) =>
              (aut
                ? (q.cameras ?? -1) - (p.cameras ?? -1)
                : (q.montant ?? -1) - (p.montant ?? -1)) || byDateDesc(p, q)
          : byDateDesc,
      );
    // the filters a shape's click put, each lifted from its chip
    const actifs = [
      ...(S.part
        ? [
            {
              l: t(`commune_a.part.${S.part}`),
              lever: (() => this.setState({ part: "" })) as Handler,
            },
          ]
        : []),
      ...(S.territoire
        ? [
            {
              l: T("commune_a.argent_vue.tous"),
              lever: (() => this.setState({ territoire: false })) as Handler,
            },
          ]
        : []),
    ];
    const docs = {
      r: repli(
        S.open,
        "docs",
        t("accueil.voir_detail"),
        Math.min(10, docRows.length),
        this.basculer,
      ),
      onglets: tabs.map((x) => ({
        l: t(`commune_a.onglet.${x.k}`),
        n: fr(d.all.filter(x.f).length),
        on: x.k === S.onglet ? "true" : "false",
        pick: (() =>
          this.setState({
            onglet: x.k,
            annee: "",
            entF: "",
            tranche: "",
            part: "",
            territoire: false,
            menu: "",
          })) as Handler,
      })),
      menus: [
        this.menuDocs(
          "annee",
          T("commune_a.m_annee"),
          S.annee,
          anneesDoc.map((v) => ({ v, l: v })),
          (v) => ({ annee: v }),
        ),
        ...(argentDoc && entsDoc.length
          ? [
              this.menuDocs(
                "ent",
                T("commune_a.m_ent"),
                S.entF,
                entsDoc.map(([v, n2]) => ({ v, l: `${nomEnt(v)} · ${fr(n2)}` })),
                (v) => ({ entF: v }),
              ),
            ]
          : []),
        ...(argentDoc
          ? [
              this.menuDocs(
                "montant",
                T("commune_a.m_montant"),
                S.tranche,
                (["m1", "m2", "m3"] as const).map((v) => ({ v, l: t(`commune_a.tranche.${v}`) })),
                (v) => ({ tranche: v as Tranche }),
              ),
            ]
          : []),
      ],
      actifs,
      exporter: (() =>
        exportRows(d, docRows, "csv", `${insee}-${t(`commune_a.onglet.${ong.k}`)}`)) as Handler,
      col3: t(aut ? "commune_a.col_beneficiaire" : "commune_a.col_entreprise"),
      col4: t(aut ? "commune_a.col_cameras" : "commune_a.col_montant"),
      // the columns' sort (Lyon-A-comportements, « En-tête de colonne »): the date, the amount
      triDate: S.tri === "date" ? "descending" : "none",
      triM: S.tri === "montant" ? "descending" : "none",
      parDate: (() => this.setState({ tri: "date" })) as Handler,
      parM: (() => this.setState({ tri: "montant" })) as Handler,
      rows: docRows.slice(0, 10).map((e) => ({
        // a drone act's date is its first day of flight, not its publication (Ju 10/11): said
        d: dateDite(e),
        doc: [
          {
            a: {
              href:
                e.t.startsWith("arrete") && e.insee === insee
                  ? `${communeHref(insee, "autorisations")}/${encodeURIComponent(e.id)}`
                  : documentHref(e.affaire),
              text: casseNormale(titreDoc(e)),
            },
          },
        ] as RichItem[],
        qui: aut
          ? ([
              e.beneficiaire && !String(e.beneficiaire).startsWith("[") && e.nom_publie !== false
                ? casseNormale(String(e.beneficiaire))
                : t("commun.nom_non_publie"),
            ] as RichItem[])
          : ((e.entreprises ?? []).flatMap((sr, j) => [
              ...(j ? [", "] : []),
              lienEnt(sr),
            ]) as RichItem[]),
        m: aut ? (e.cameras != null ? fr(e.cameras) : "—") : e.montant ? montantA(e.montant) : "—",
        dos:
          (f.affaires[e.affaire]?.events?.length ?? 0) > 1
            ? ([
                { a: { href: documentHref(e.affaire), text: T("commune_a.dossier") } },
              ] as RichItem[])
            : (["—"] as RichItem[]),
      })),
      // a row's click opens its document, as its link does (« Ligne · Ouvre le document »)
      ligne: ((ev) => {
        const tgt = ev.nativeEvent.target as Element;
        if (tgt.closest("a, button")) return;
        tgt.closest("tr")?.querySelector<HTMLAnchorElement>("td a")?.click();
      }) as Handler,
      vide: !docRows.length,
      plus: docRows.length > 10 ? T("commune_a.documents_plus", { n: fr(docRows.length) }) : "",
      tout: communeHref(insee, "documents"),
    };
    const srcRows = [
      { cls: "ok", l: t("accueil.src.contrats"), d: T("commune_a.src.contrats") },
      { cls: "ok", l: t("accueil.src.ao"), d: T("commune_a.src.ao") },
      {
        cls: lu.cam || lu.dr ? "part" : "non",
        l: T("commune_a.src.arretes"),
        d:
          lu.cam || lu.dr
            ? [
                T("commune_a.src.arretes_d", { y: depuis }),
                min.cam || min.dr ? `${(min.cam ? dit.cam : dit.dr).phrase}.` : "",
              ]
                .filter(Boolean)
                .join(". ")
            : dit.cam.phrase,
      },
      { cls: "part", l: t("accueil.src.subventions"), d: T("commune_a.src.subventions") },
      { cls: "ok", l: t("accueil.src.carte"), d: t("accueil.src.carte_d") },
    ];
    toc.push({
      href: "#documents",
      l: T("commune_a.toc.documents"),
      cls: "",
      go: this.allerSection,
    });
    toc.push({ href: "#sources", l: T("commune_a.toc.sources"), cls: "", go: this.allerSection });
    // the 3D view's doors open on its Fiche tab; its drones' doors (a day, today) on Drones (Ju 09/11,
    // choice 5)
    const vue3d = `${communeHref(insee, "carte")}?onglet=fiche`;
    toc.push({
      href: vue3d,
      l: T("commune_a.toc.vue3d"),
      cls: "t3d",
      go: (() => {}) as Handler,
    });
    // a head figure's click goes to its section, by the number the section has here; its bubble
    // holds its words in full (two lines at most on the card, Ju 09/11) and its rank's strate
    const nSec = new Map(toc.map((x) => [x.href, x.l.split(" · ")[0]]));
    const figsB = figs.map((x) => ({
      ...x,
      tip: [x.l, x.rb, x.tip].filter(Boolean).join("\n"),
      sr: x.tip,
      dotsL: x.rb,
      bc: nSec.has(x.href) ? T("commune_a.b.section", { n: nSec.get(x.href) ?? "" }) : "",
    }));

    return {
      ...this.base("commune-a"),
      nom,
      letters: coupeMots(nom),
      chips: [
        { l: `${depNom} (${c.dep})`, href: departementHref(c.dep) },
        ...(nomEpci && c.epci_ref ? [{ l: nomEpci, href: `/registre/${c.epci_ref}` }] : []),
      ],
      meta: [
        ...(pop ? [T("commune_a.habitants", { n: fr(pop) })] : []),
        T("commune_a.insee", { insee }),
        ...(f.couverture.departement.dernier_recueil
          ? [T("commune_a.collecte", { d: jourCourt(f.couverture.departement.dernier_recueil) })]
          : []),
      ],
      lead,
      partager: ((ev) => partager(this, ev.currentTarget)) as Handler,
      citer: this.citer,
      citerL: t(S.cite ? "commune_a.cite" : "commune_a.citer"),
      figs: figsB,
      v3: {
        titre: T("commune_a.v3_titre", { nom }),
        items: [
          {
            b: T("commune_a.v3_cameras"),
            s:
              carteN != null
                ? T("commune_a.v3_cameras_s", { n: fr(carteN) })
                : T("commune_a.v3_cameras_hors"),
          },
          {
            b: T("commune_a.v3_drones"),
            s: nAuj ? T("commune_a.v3_drones_auj", { n: nAuj }) : T("commune_a.v3_drones_s"),
          },
        ],
        href: vue3d,
        jour: nAuj ? `${communeHref(insee, "carte")}?jour=${maj}` : "",
      },
      toc,
      cam,
      arg,
      ent: entS,
      dos,
      dr,
      vois,
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
        signaler: s.all[0] ? signalerHref(s.all[0]) : "/registre/glossaire",
      },
      pleinEcran,
    };
  }
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  if (r.view !== "commune") return {};
  return { d: await chargerCommune(r.insee) };
}

export default {
  Vue: Commune as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
