// View 10 · Département (/registre/departement/<code>): board Departement-Rhone-A of the redesign v3
// (lot 3), its phone and dark variants. The sticker « Département » and the name cut out, its
// code, its communes with documents, its prefecture's last recueil read; a sentence of its
// figures; the four figures (public money, cameras on the map, camera decrees, drone decrees),
// each with its rank among the départements; the yellow table of contents; then 1 · Où sont les
// caméras ? (the communes on the département's IGN outline, the best equipped), 2 · Combien, et
// qui paie ?, 3 · Qui vend ?, 4 · Qu'a autorisé la préfecture ?, 5 · Comparé aux autres
// départements, « Toutes les communes », « D'où viennent ces chiffres ». A section with nothing to
// say is left out, the others numbered in turn; signals and missions come later (Ju, 07/11).
// Every figure is the build's: the département's file, listes.json and the outlines asked once
// the page is drawn (the ranks, the communes' points).
//
// An intercommunality's fiche (`?ic=<its code>`, a row of the file) has no board yet: it stays
// v2's (design/registre/v2, V2-Entreprise), its territory and its own purchases together, drawn by
// the class `Intercommunalite` below and the second template of departement.html.

import { departementArt, etatDepartement } from "../collecte.ts";
import { communeHref, depArt } from "../commun.ts";
import { buyerHref, depGroup, entName, type Lexique, buyerNom as nomAcheteur } from "../corpus.ts";
import type { Handler, RichItem } from "../dc.ts";
import type { Couverture } from "../donnees.ts";
import { Absent, load } from "../donnees.ts";
import { count, fr, longMonth, money, moneyFull, shortDate } from "../format.ts";
import { has, t } from "../i18n.ts";
import {
  departementHref,
  lien,
  lienAcheteur,
  lienCommune,
  lienDepartement,
  lienDocument,
  lienEntreprise,
} from "../liens.ts";
import { etapeListe, type Listes } from "../listes.ts";
import type { Miette, VueModule } from "../modale.ts";
import { partager } from "../partage.ts";
import type { Route } from "../routes.ts";
import { axeA, type Coupe, coupe, montantA, pleinEcran, repli } from "../socle-a.ts";
import { couverture, sources } from "../sources.ts";
import { capital } from "../texte.ts";
import { ICONE_DRONES, type TypeCle } from "../types.ts";
import {
  type BaseState,
  type Col,
  large,
  type Partage,
  type Porte,
  partageDe,
  sansTiret,
  Vue,
} from "../vue.ts";
import { nomAcheteur as nomAcheteurA } from "./accueil-outils.ts";
import {
  appels,
  buyerNom,
  type Contrat,
  contrats,
  type FichierAcheteur,
  lexique,
  parAnnee,
  titreCourt,
  total,
  vendeurs,
} from "./acheteur-outils.ts";
import { type EtatActes, etatActes, horsCommune, lecture, type RowActes } from "./comparer-a.ts";
import { deArt } from "./entreprise-a.ts";
import "./departement.css";
import "./departement-a.css";
import { documentHref } from "../routes.ts";
import templates from "./departement.html?raw";
import {
  boite,
  cadrer,
  classe,
  csv,
  facteurDrones,
  fraction,
  MESURES,
  type Mesure,
  type Payeur,
  plusEquipees,
  projection,
  quiPaie,
  type Rang,
  rangDep,
  recadrer,
  SEUILS,
  tete,
  valeur,
} from "./departement-a.ts";
import {
  achatsPropres,
  aides,
  annees,
  type ComRow,
  communes,
  type EtatCollecte,
  enLigne,
  epciDe,
  epciHref,
  epciLa,
  type FichierDepartement,
  filtrer,
  intercommunalites,
  type Ligne,
  lienEpci,
  montant,
  nomEpci,
  noms,
  part,
  sourcesIds,
  trier,
  typeDe,
  vide,
} from "./departement-outils.ts";

/** departement.html holds two templates: the département's (theme A), then, after this marker,
 * an intercommunality's (v2). */
const [templateA, templateV2] = templates.split("<!-- intercommunalite -->");

// --- the département's fiche in theme A (board Departement-Rhone-A) ------------------------------

/** The IGN outlines (geo/departements.json): France's and each metropolitan département's path. */
type Geo = {
  attribution: string;
  france: string;
  departements: Record<string, { nom: string; d: string }>;
};
type PropsA = { dep: string; f: FichierDepartement; couverture?: Couverture };
type Filtre = "tous" | "in" | "hors";
type Tri = "nom" | "pop" | "con" | "montant" | "cam" | "dr" | "carte";
type StateA = BaseState & {
  X: Listes | null;
  G: Geo | null;
  /** the outlines did not come (a build without the IGN's layers): no map */
  geoNon: boolean;
  mesure: Mesure;
  filtre: Filtre;
  epciF: string;
  menu: string;
  tri: Tri;
  cite: boolean;
};
/** « Toutes les communes »: twelve rows, the board's (« 12 premières par montant »). */
const LIGNES = 12;
const TRIS: Tri[] = ["nom", "pop", "con", "montant", "cam", "dr", "carte"];
const jourA = (d: string): string =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`));
const jourMois = (d: string): string =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${d.slice(0, 10)}T12:00:00Z`),
  );
const ordinalA = (n: number) => (n === 1 ? { r: "1", sup: "er" } : { r: String(n), sup: "e" });
const ordinalTxt = (n: number) =>
  n === 1 ? t("departement_a.premier") : t("departement_a.nieme", { n });
/** An amount as the head figure writes it: « 106,7 » and « M€ » apart. */
function montantFig(n: number): { v: string; u: string } {
  const d = (x: number) => x.toFixed(1).replace(".", ",");
  if (n >= 1e9) return { v: d(n / 1e9), u: t("departement_a.u_mde") };
  if (n >= 1e6) return { v: d(n / 1e6), u: t("departement_a.u_me") };
  return { v: fr(n), u: "€" };
}
/** A list of words joined as French does: « a, b et c ». */
function enumerer<T>(xs: T[], et: T, virgule: T): T[] {
  return xs.flatMap((x, i) => (i === 0 ? [x] : [i === xs.length - 1 ? et : virgule, x]));
}
const lienA = (href: string | null, text: string, cls = "ent"): RichItem =>
  href ? { a: { href, text, cls } } : text;
/** The board's « Qui paie » colours, one per class. */
const CLS_PAYEUR: Record<Payeur, string> = {
  commune: "c-ville",
  transports: "c-transp",
  bailleur: "c-comm",
  etat: "c-autres",
  departement: "c-osm",
  autres: "c-autres2",
};

/** A commune's (or an intercommunality's) reading of the acts: the build's when served on its
 * figures, else the rule every page applies until then (comparer-a.ts `couvertureActes`: a count
 * above 0 shown, a 0 read only where the département has no act of the family). */
function couvC(
  f: FichierDepartement,
  collecte: boolean,
  c: { insee?: string; aut: number; dr?: number },
): { cam: EtatActes; dr: EtatActes } {
  const servi = (c.insee ? (f.stats.communes[c.insee] as RowActes | undefined) : undefined)
    ?.couverture_actes;
  const tot = f.stats.depStats;
  return {
    cam: servi?.cam ?? etatActes(collecte, tot.cam ?? 0, c.aut),
    dr: servi?.dr ?? etatActes(collecte, tot.dr ?? 0, c.dr ?? 0),
  };
}

class DepartementA extends Vue<PropsA, StateA> {
  private fini = false;

  protected init(): Partial<StateA> {
    return {
      X: null,
      G: null,
      geoNon: false,
      mesure: "cameras",
      filtre: "tous",
      epciF: "",
      menu: "",
      tri: "montant",
      cite: false,
    };
  }
  private noms() {
    return noms(this.props.dep, this.props.f.departement.nom);
  }
  titre(): string {
    return this.noms().nom;
  }
  type(): TypeCle {
    return "departement";
  }
  fil(): Miette[] {
    return [
      { k: "registre", l: t("types.registre.l"), href: "/registre/" },
      etapeListe("departement", this.props.dep),
    ];
  }
  partage(): Partage | null {
    return partageDe(this.noms().nom, this.props.f.partage);
  }

  componentDidMount(): void {
    document.addEventListener("pointerdown", this.dehors, true);
    // the ranks, the communes' points and the outline: asked once the page is drawn
    load<Listes>("listes.json").then(
      (X) => {
        if (!this.fini) this.setState({ X });
      },
      () => {},
    );
    load<Geo>("geo/departements.json").then(
      (G) => {
        if (!this.fini) this.setState({ G });
      },
      () => {
        if (!this.fini) this.setState({ geoNon: true });
      },
    );
  }
  componentWillUnmount(): void {
    this.fini = true;
    document.removeEventListener("pointerdown", this.dehors, true);
  }
  private dehors = (ev: Event): void => {
    if (this.state.menu && !(ev.target as Element).closest?.(".v-departement-a .dancre"))
      this.setState({ menu: "" });
  };
  private basculer = (k: string): void =>
    this.setState({ open: { ...this.state.open, [k]: !this.state.open[k] } });

  /** « Citer »: the fiche's citation, copied. */
  private citer: Handler = () => {
    const txt = t("departement_a.citation", {
      du: this.noms().du,
      date: jourA(this.props.f.maj),
      url: `${location.origin}${departementHref(this.props.dep)}`,
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
    const el = href.startsWith("#") ? document.getElementById(href.slice(1)) : null;
    if (!el) return;
    ev.preventDefault();
    const doux = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" });
  };

  /** « Intercommunalité ▾ »: a chip, the intercommunalities as a listbox; arrows move, Enter or a
   * click chooses, Escape closes, the focus back on the chip (the commune fiche's menus). */
  private menuEpci(opts: { v: string; l: string }[]) {
    const k = "epci";
    const cur = this.state.epciF;
    const open = this.state.menu === k;
    const sel = `.v-departement-a .dancre.m-${k}`;
    const focus = (s: string) =>
      requestAnimationFrame(() => document.querySelector<HTMLElement>(s)?.focus());
    return {
      cls: `dancre m-${k}`,
      chip: cur ? "chip f on" : "chip f",
      l: cur ? (opts.find((o) => o.v === cur)?.l ?? cur) : t("departement_a.m_epci"),
      lab: t("departement_a.m_epci"),
      ouvert: open ? "true" : "false",
      menu: open,
      basculer: (() => {
        this.setState({ menu: open ? "" : k });
        if (!open) focus(`${sel} [role=option]`);
      }) as Handler,
      opts: [{ v: "", l: t("departement_a.m_toutes") }, ...opts].map((o) => ({
        l: o.l,
        on: o.v === cur ? "true" : "false",
        choisir: (() => {
          this.setState({ epciF: o.v, filtre: "tous", menu: "" });
          focus(`${sel} > button`);
        }) as Handler,
      })),
      clavier: ((ev) => {
        const os = [...document.querySelectorAll<HTMLElement>(`${sel} [role=option]`)];
        const i = os.indexOf(document.activeElement as HTMLElement);
        if (ev.key === "Escape") {
          this.setState({ menu: "" });
          focus(`${sel} > button`);
        } else if (ev.key === "ArrowDown") os[Math.min(os.length - 1, i + 1)]?.focus();
        else if (ev.key === "ArrowUp") (i > 0 ? os[i - 1] : os[0])?.focus();
        else if ((ev.key === " " || ev.key === "Enter") && i >= 0) os[i].click();
        else return;
        ev.nativeEvent.preventDefault();
        ev.stopPropagation();
      }) as Handler,
    };
  }

  renderVals() {
    const S = this.state;
    const { f, dep } = this.props;
    const X = S.X;
    const N = this.noms();
    const nom = N.nom;
    const st = f.stats.depStats;
    const stD = st as typeof st & { dr_commune?: number; dr_autorite?: number };
    const drC = stD.dr_commune ?? st.dr ?? 0;
    const drA = stD.dr_autorite ?? null;
    const L: Lexique = { entreprises: f.entreprises, acheteurs: f.acheteurs, communes: f.communes };
    const coms = communes(f);
    const cv = this.props.couverture;
    const lu = f.couverture.etat === "collecte";
    // a commune's decrees read: the build's reading (couverture_actes, rule
    // registre_couverture@1:actes_commune), else the same rule on this file's acts placed in no
    // commune (depStats less uniq); « non lu », never 0 (Ju 09/11, recette 01)
    const hors = horsCommune(st, f.stats.uniq) ?? { cam: 0, dr: 0 };
    const luC = (c: { insee?: string; aut: number; dr?: number }) => lecture(couvC(f, lu, c));
    // collected, a commune's family « non lu » means its acts are read but placed in no commune
    // yet: said so (comparer-a.ts nonRattache, Ju 10/11, Vichy), « non lu » only when not collected
    const rattache = t("socle_a.non_rattache", { de: deArt(depArt(dep, N.nom)) });
    const nonLuC = lu ? t("socle_a.non_rattache_court") : t("liste.non_lu");
    const places = { cam: f.stats.uniq?.cam ?? 0, dr: f.stats.uniq?.dr ?? 0 };
    const an = (k: "con" | "cam") =>
      Object.keys(f.stats.annees)
        .filter((y) => (f.stats.annees[y]?.[k] ?? 0) > 0)
        .sort()[0] ?? "";
    const an0 = an("con") || "2018";
    const anA = an("cam") || (f.couverture.depuis ?? "").slice(0, 4);
    const lienCom = (insee: string, txt?: string): RichItem =>
      lienA(
        f.communes[insee]?.ref ? communeHref(insee) : null,
        txt ?? f.communes[insee]?.nom ?? insee,
        "ent com",
      );
    const lienDep = (code: string): RichItem =>
      code === dep
        ? noms(code, cv?.departements[code]?.nom).nom
        : lienA(departementHref(code), noms(code, cv?.departements[code]?.nom).nom, "ent com");
    const nomDep = (code: string) => noms(code, cv?.departements[code]?.nom).nom;
    // an intercommunality's fiche (`?ic=`, v2's until its board): a theme A link
    const lienEpciA = (code: string, txt: string): RichItem =>
      lienA(f.stats.epcis[code] ? epciHref(dep, code) : null, txt, "ent com");
    const artDep = (code: string) => departementArt(code, nomDep(code));
    // the intercommunality with its own drawing on the board: a métropole of several communes here,
    // some outside it (« Métropole de Lyon · 51 », « Hors Métropole · 90 »)
    const metro = Object.entries(f.stats.epcis)
      .filter(([, e]) => /^Métropole/.test(e.nom ?? "") && e.communes.length > 1)
      .sort((a, b) => b[1].communes.length - a[1].communes.length)[0];
    const metroK = metro && metro[1].communes.length < coms.length ? metro[0] : "";
    const membres = new Set(metroK ? f.stats.epcis[metroK].communes : []);

    // --- the ranks among the départements (listes.json, one source for every row) ---------------
    const U = Object.entries(cv?.departements ?? {})
      .filter(([, d]) => !!d.nom)
      .map(([k]) => k);
    const LUS = U.filter((k) => cv?.departements[k]?.etat === "collecte" && !k.startsWith("98"));
    const vals = (k: "amt" | "con" | "carte" | "cam" | "dr"): Record<string, number> =>
      Object.fromEntries(
        Object.entries(X?.lignes.departements ?? {}).map(([c, v]) => [
          c,
          Number((v as Record<string, number | undefined>)[k] ?? 0),
        ]),
      );
    // the map covers the départements where a commune has its count (overseas: none, every
    // commune's `carte` null): a département outside it has no 0 and no rank (recette 10)
    const couverts = new Set(
      Object.entries(X?.lignes.communes ?? {})
        .filter(([, v]) => v.carte != null)
        .map(([k]) => X?.dico.communes[k]?.dep ?? ""),
    );
    const MES = {
      amt: { u: U, fmt: (v: number) => montantA(v) },
      con: { u: U, fmt: (v: number) => fr(v) },
      carte: { u: U.filter((k) => couverts.has(k)), fmt: (v: number) => fr(v) },
      cam: { u: LUS, fmt: (v: number) => fr(v) },
      dr: { u: LUS, fmt: (v: number) => fr(v) },
    } as const;
    type Cle = keyof typeof MES;
    const rangs = Object.fromEntries(
      (Object.keys(MES) as Cle[]).map((k) => [
        k,
        X && !(k !== "amt" && k !== "con" && k !== "carte" && !lu)
          ? rangDep(dep, vals(k), MES[k].u)
          : null,
      ]),
    ) as Record<Cle, Rang | null>;
    /** The board's « 3e sur 105 départements et collectivités · derrière les Alpes-Maritimes et le
     * Nord », « 16e sur 83 · Paris en compte 772 ». */
    const rk = (k: Cle, long: boolean) => {
      const r = rangs[k];
      if (!r) return null;
      const sur = t(
        MES[k].u === LUS
          ? long
            ? "departement_a.sur_lus"
            : "departement_a.sur"
          : long
            ? "departement_a.sur_tous"
            : "departement_a.sur",
        { n: r.n },
      );
      const autour =
        r.r === 1
          ? t("departement_a.rk_tete")
          : r.r === 2
            ? t("departement_a.rk_apres", { d: artDep(r.devant[0]) })
            : r.r === 3
              ? t("departement_a.rk_derriere", {
                  a: artDep(r.devant[0]),
                  b: artDep(r.devant[1]),
                })
              : t("departement_a.rk_tete_en", {
                  d: nomDep(r.tete),
                  v: MES[k].fmt(vals(k)[r.tete] ?? 0),
                });
      return { ...ordinalA(r.r), t: `${sur} · ${autour}` };
    };

    // --- the figures ------------------------------------------------------------------------------
    const horsCarte = coms.length > 0 && coms.every((c) => c.cams == null);
    const carteDep = horsCarte ? null : X ? (X.lignes.departements[dep]?.carte ?? null) : undefined;
    const drComs = coms.filter((c) => c.dr > 0).length;
    const mf = montantFig(st.montant);
    const figs = [
      {
        cls: st.con ? "fig" : "fig nl",
        k: t("departement_a.fig.argent"),
        v: st.con ? mf.v : t("departement_a.fig.aucun"),
        u: st.con ? mf.u : "",
        l: st.con ? t("departement_a.fig.argent_l", { n: st.con, y: an0 }) : "",
        rk: st.con ? rk("amt", true) : null,
        tip: t("departement_a.fig.argent_tip"),
        href: "#combien",
      },
      {
        cls: carteDep == null ? "fig nl" : "fig",
        k: t("departement_a.fig.carte"),
        v: horsCarte
          ? t("departement_a.fig.hors_carte")
          : carteDep === undefined
            ? "…"
            : carteDep == null
              ? t("liste.non_lu")
              : fr(carteDep),
        u: "",
        l: horsCarte ? t("departement_a.fig.hors_carte_l") : t("departement_a.fig.carte_l"),
        rk: horsCarte ? null : rk("carte", false),
        tip: t("departement_a.fig.carte_tip"),
        href: "#ou",
      },
      {
        cls: lu ? "fig" : "fig nl",
        k: t("departement_a.fig.cam"),
        v: lu ? fr(st.cam) : t("liste.non_lu"),
        u: "",
        // the acts the département counts and those placed in a commune: one truth on both pages
        // (recette 01: Paris's 222 camera acts name no commune, the fiche of Paris says « non lu »)
        l:
          lu && anA
            ? hors.cam
              ? t("departement_a.fig.cam_places", { y: anA, p: places.cam })
              : t("departement_a.fig.depuis", { y: anA })
            : "",
        rk: rk("cam", true),
        tip: t("departement_a.fig.cam_tip", { y: anA }),
        href: "#autorise",
      },
      {
        cls: lu ? "fig" : "fig nl",
        // two named counts (A, 09/11): the acts that fly in its communes, the figure; those its
        // authorities signed, wherever they fly, its line (the police prefecture's for Paris)
        k: t("departement_a.fig.dr"),
        v: lu ? fr(drC) : t("liste.non_lu"),
        u: lu ? t("departement_a.fig.arretes_communes", { n: drC }) : "",
        l: lu
          ? drA != null && drA !== drC
            ? t(
                dep === "75" ? "departement_a.fig.dr_autorite_pp" : "departement_a.fig.dr_autorite",
                {
                  n: drA,
                },
              )
            : hors.dr
              ? t("departement_a.fig.dr_places", { p: places.dr, n: drComs })
              : t("departement_a.fig.dr_l", { n: drComs })
          : "",
        rk: rk("dr", false),
        tip: t("departement_a.fig.dr_tip", { y: anA }),
        href: "#autorise",
      },
    ];

    // --- who pays (the buyers' counted amounts by category: Σ = depStats.montant) ----------------
    const parts = quiPaie(f.stats.acheteurs, (s) => f.acheteurs[s]?.categorie);
    const pComm = parts.find((p) => p.k === "commune");
    const acheteurs = f.stats.acheteurs
      .filter((a) => a.montant > 0)
      .sort((a, b) => b.montant - a.montant || b.n - a.n);
    const nomAch = (s: string): RichItem => {
      const a = f.acheteurs[s];
      if (a?.categorie === "commune" && a.insee_siege && f.communes[a.insee_siege])
        return lienCom(a.insee_siege);
      const txt = nomAcheteurA(a, L, nomDep, s);
      if (metroK && s === metroK) return lienEpciA(s, txt);
      const href = buyerHref(L, s);
      return lienA(href, txt, href?.startsWith("/registre/commune/") ? "ent com" : "ent ach");
    };

    // --- the lead ------------------------------------------------------------------------------------
    const lead: RichItem[] = [];
    const morceaux: RichItem[][] = [];
    if (st.con)
      morceaux.push([
        { strong: t("departement_a.lead_con", { n: st.con }) },
        t("departement_a.lead_con_b", { y: an0 }),
        ...(st.montant > 0
          ? [{ strong: montantA(st.montant) }, t("departement_a.lead_plafonds")]
          : []),
      ]);
    if (lu && st.cam)
      morceaux.push([
        { strong: t("departement_a.lead_cam", { n: st.cam }) },
        t("departement_a.lead_cam_b", { y: anA }),
      ]);
    if (lu && (drC || drA))
      morceaux.push([
        { strong: t("departement_a.lead_dr_communes", { n: drC }) },
        ...(drA != null && drA !== drC
          ? [
              t(
                dep === "75"
                  ? "departement_a.lead_dr_autorite_pp"
                  : "departement_a.lead_dr_autorite",
                { n: drA },
              ),
            ]
          : []),
      ]);
    if (morceaux.length) {
      lead.push(`${capital(N.dans)}, `);
      for (const [i, m] of morceaux.entries()) {
        if (i) lead.push(i === morceaux.length - 1 ? t("departement_a.et") : ", ");
        lead.push(...m);
      }
      lead.push(".");
    } else lead.push(t("departement_a.lead_rien", { dans: N.dans }));
    const fc = pComm ? fraction(pComm.montant / Math.max(1, st.montant)) : null;
    if (fc && pComm) {
      const top = acheteurs[0];
      const a = top ? f.acheteurs[top.siren] : undefined;
      const f2 = top ? fraction(top.montant / Math.max(1, st.montant)) : null;
      const com = a?.categorie === "commune" && a.insee_siege && f.communes[a.insee_siege];
      // one commune paying nearly all the communes' share (Paris): it is named alone
      if (com && a?.insee_siege && top.montant >= 0.9 * pComm.montant)
        lead.push(
          " ",
          { strong: [lienCom(a.insee_siege)] },
          t("departement_a.lead_paie", { f: t(`departement_a.frac.${fc}`) }),
        );
      else {
        lead.push(" ", t("departement_a.lead_communes", { f: t(`departement_a.frac.${fc}`) }));
        if (com && a?.insee_siege && f2)
          lead.push(
            " ; ",
            { strong: [lienCom(a.insee_siege)] },
            t("departement_a.lead_seule", { f: t(`departement_a.frac.${f2}`) }),
          );
        lead.push(".");
      }
    }

    // --- the sections, numbered in turn ------------------------------------------------------------
    let n = 0;
    const num = () => String(++n);
    const toc: { href: string; l: string; go: Handler }[] = [];
    const entree = (id: string, l: string) =>
      toc.push({ href: `#${id}`, l, go: this.allerSection });

    // 1 · where: the communes on the map (two at least: Paris's département is one commune)
    let ou = null;
    // the map needs the IGN outline (metropolitan départements only); the best equipped, cameras
    const eq = plusEquipees(coms);
    const mapCard = !dep.startsWith("97") && !S.geoNon;
    if (coms.length > 1 && (mapCard || eq.rows.length)) {
      const ouN = num();
      entree("ou", `${ouN} · ${t("departement_a.toc.ou")}`);
      const parEpci = new Map<string, number>();
      for (const c of coms)
        if (c.epci) parEpci.set(c.epci, (parEpci.get(c.epci) ?? 0) + (c.cams ?? 0));
      const totCam = coms.reduce((s, c) => s + (c.cams ?? 0), 0);
      const [ep, epN] = [...parEpci].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
      const parCam = [...coms]
        .filter((c) => (c.cams ?? 0) > 0)
        .sort((a, b) => (b.cams ?? 0) - (a.cams ?? 0));
      const ans: RichItem[] = [];
      if (totCam > 0) {
        const epList = ep ? (f.stats.epcis[ep]?.communes.length ?? 0) : 0;
        if (ep && epN / totCam >= 0.5 && epList > 1) {
          const hors = parCam.find((c) => c.epci !== ep);
          ans.push(t("departement_a.ou_surtout_dans"), {
            strong: [lienEpciA(ep, epciLa(nomEpci(ep, f.stats.epcis[ep]?.nom)))],
          });
          if (hors) ans.push(t("departement_a.ou_et_a"), { strong: [lienCom(hors.insee)] });
        } else {
          ans.push(t("departement_a.ou_surtout_a"), { strong: [lienCom(parCam[0].insee)] });
          if (parCam[1])
            ans.push(t("departement_a.ou_et_a"), { strong: [lienCom(parCam[1].insee)] });
        }
        ans.push(". ");
      }
      ans.push(
        t("departement_a.ou_ans", {
          n: coms.length,
          k: coms.filter((c) => (c.cams ?? 0) > 0).length,
        }),
      );
      // the map: a point per commune at its town hall, on the département's IGN outline
      const m = S.mesure;
      const outline = S.G?.departements[dep]?.d;
      let carte = null;
      if (S.G && X && outline) {
        const proj = projection(boite(S.G.france));
        const cadre = cadrer(boite(outline), 520, 600, 14);
        const pts = coms
          .map((c) => {
            const ll = X.dico.communes[c.insee]?.ll;
            if (!ll) return null;
            const s = f.stats.communes[c.insee];
            const v = valeur(m, {
              pop: c.pop,
              carte: c.cams,
              montant: s?.montant ?? 0,
              cam: c.aut,
              dr: c.dr,
            });
            const q = classe(v, SEUILS[m]);
            const [x, y] = cadre.f(proj(ll));
            const href = f.communes[c.insee]?.ref ? communeHref(c.insee) : "";
            const lignes = [
              c.pop ? t("departement_a.b.habitants", { n: c.pop }) : "",
              m === "cameras"
                ? c.cams != null
                  ? t("departement_a.b.cameras", {
                      n: c.cams,
                      v: v == null ? "—" : v.toFixed(1).replace(".", ","),
                    })
                  : t("departement_a.b.cameras_nl")
                : m === "eph"
                  ? t("departement_a.b.eph", {
                      m: montantA(s?.montant ?? 0),
                      v: v == null ? "—" : fr(v),
                    })
                  : m === "aut"
                    ? luC(c).cam
                      ? t("departement_a.b.aut", { n: c.aut })
                      : lu
                        ? rattache
                        : t("liste.non_lu")
                    : luC(c).dr
                      ? t("departement_a.b.dr", { n: c.dr })
                      : lu
                        ? rattache
                        : t("liste.non_lu"),
              t("departement_a.b.docs", { n: c.docs }),
            ].filter(Boolean);
            return {
              pop: c.pop,
              cls: `pt ${q == null ? "nd" : `q${q}`}${membres.has(c.insee) ? " metro" : ""}`,
              x: x.toFixed(1),
              y: y.toFixed(1),
              r: "6",
              href,
              sans: !href,
              bh: c.nom,
              bl: lignes.join("\n"),
              nom: c.nom,
              px: x,
              py: y,
            };
          })
          .filter((p): p is NonNullable<typeof p> => !!p)
          // the larger first: a small commune's point drawn over its neighbour's
          .sort((a, b) => b.pop - a.pop);
        // five names, the most populous first, each 70 units at least from a named point (the
        // board names a town in each part: Lyon, Villefranche, Givors, Tarare, Belleville), a
        // name that would cross another or the edge left out
        const pris: [number, number, number, number][] = [];
        const noms5: { px: number; py: number }[] = [];
        const labels: { x: string; y: string; a: string; t: string }[] = [];
        for (const p of pts) {
          if (labels.length >= 5) break;
          if (noms5.some((o) => Math.hypot(o.px - p.px, o.py - p.py) < 70)) continue;
          const w = p.nom.length * 7;
          const droite = p.px + 10 + w <= cadre.W - 2;
          const x0 = droite ? p.px + 10 : p.px - 10 - w;
          const b: [number, number, number, number] = [x0, p.py - 10, x0 + w, p.py + 6];
          if (x0 < 2 || b[1] < 2 || b[3] > cadre.H - 2) continue;
          if (pris.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
          pris.push(b);
          noms5.push(p);
          labels.push({
            x: (droite ? p.px + 10 : p.px - 10).toFixed(1),
            y: (p.py + 5).toFixed(1),
            a: droite ? "start" : "end",
            t: p.nom,
          });
        }
        if (pts.length > 1)
          carte = {
            vb: `0 0 ${cadre.W} ${cadre.H}`,
            w: String(cadre.W),
            h: String(cadre.H),
            titre: t("departement_a.carte_titre", {
              du: N.du,
              m: t(`departement_a.mesure_titre.${m}`),
            }),
            d: recadrer(outline, cadre.f),
            pts,
            labels,
            note: t("departement_a.carte_note", { n: pts.length, attr: S.G.attribution }),
          };
      }
      ou = {
        n: ouN,
        ans,
        titre: t(`departement_a.mesure_titre.${m}`),
        mesures: MESURES.map((o) => ({
          l: t(`departement_a.mesure.${o}`),
          on: m === o ? "true" : "false",
          pick: (() => this.setState({ mesure: o })) as Handler,
        })),
        mapCard,
        eqCard: eq.rows.length > 0,
        row: mapCard && eq.rows.length ? "row2 wide" : "row2 seul",
        carte,
        attente: carte
          ? ""
          : S.geoNon || (S.G && !outline)
            ? t("departement_a.carte_absente")
            : S.G && X
              ? t("departement_a.carte_absente")
              : t("departement_a.carte_attente"),
        leg: [
          ...[0, 1, 2, 3, 4].map((k) => ({ sw: `sw q${k}`, l: t(`departement_a.leg.${m}.${k}`) })),
          ...(metroK ? [{ sw: "sw metro", l: nomEpci(metroK, f.stats.epcis[metroK]?.nom) }] : []),
        ],
        r: repli(S.open, "equipees", t("departement_a.equipees"), eq.rows.length, this.basculer),
        equipeesNote: t(eq.seuil ? "departement_a.equipees_s" : "departement_a.equipees_s0", {
          n: eq.seuil,
        }),
        equipees: eq.rows.map((c) => ({
          nom: [lienCom(c.insee)] as RichItem[],
          s: t("departement_a.equipees_l", { c: c.cams ?? 0, p: c.pop }),
          v: c.v.toFixed(1).replace(".", ","),
        })),
      };
    }

    // 2 · who pays
    let paie = null;
    if (st.montant > 0) {
      const pN = num();
      entree("combien", `${pN} · ${t("departement_a.toc.paie")}`);
      // the sentence names the two largest classes, « autres » among them
      const [p1, p2] = [...parts].sort((a, b) => b.montant - a.montant);
      const ansP: RichItem[] = [
        { strong: montantA(st.montant) },
        t("departement_a.paie_ans_a", { y: an0 }),
        t(`departement_a.paie_art.${p1.k}`),
        { strong: t(`departement_a.paie_nom.${p1.k}`) },
        t("departement_a.paie_ans_p", { p: p1.pct }),
        ...(p2 && p2.pct > 0
          ? [
              t("departement_a.paie_ans_p2", {
                art: t(`departement_a.paie_art.${p2.k}`).toLowerCase(),
                nom: t(`departement_a.paie_nom.${p2.k}`),
                p: p2.pct,
              }),
            ]
          : []),
        ".",
      ];
      // a métropole that buys almost nothing beside its communes (« ce sont ses communes qui
      // achètent »)
      const mMetro = f.stats.acheteurs
        .filter((a) => f.acheteurs[a.siren]?.categorie === "metropole")
        .reduce((s, a) => s + a.montant, 0);
      if (metroK && p1.k === "commune" && mMetro / st.montant < 0.02)
        ansP.push(
          " ",
          {
            strong: [
              lienEpciA(metroK, capital(epciLa(nomEpci(metroK, f.stats.epcis[metroK]?.nom)))),
            ],
          },
          mMetro > 0
            ? t("departement_a.paie_metro", { m: montantA(mMetro) })
            : t("departement_a.paie_metro0"),
        );
      // the years: the nine the chart shows, the last the build's (in progress)
      const ans9 = annees(f.maj);
      const Y = (y: string) =>
        f.stats.annees[y] ?? { con: 0, ao: 0, mod: 0, sub: 0, cam: 0, dr: 0 };
      // round graduations, multiples of one step (socle-a.ts axeA, Ju 10/11)
      const ax = axeA(Math.max(1, ...ans9.map((y) => Y(y).con)), "nb");
      const haut = ax.haut;
      const yv = (v: number) => 210 - (186 * v) / haut;
      const slot = 64.5;
      const W = Math.ceil(49.8 + ans9.length * slot + 4);
      const jusqu = cv?.sources.find((s) => s.id === "contrats")?.jusqu_au ?? f.maj;
      const avant = Object.keys(f.stats.annees)
        .filter((y) => y < ans9[0])
        .reduce((x, y) => x + (f.stats.annees[y]?.con ?? 0), 0);
      paie = {
        n: pN,
        ans: ansP,
        parts: parts.map((p) => {
          const tops = p.acheteurs
            .map((s) => ({ s, m: f.stats.acheteurs.find((a) => a.siren === s)?.montant ?? 0 }))
            .sort((a, b) => b.m - a.m)
            .slice(0, 3);
          return {
            cls: `seg ${CLS_PAYEUR[p.k]}${p.pct < 6 ? " pt" : ""}`,
            sw: `sw ${CLS_PAYEUR[p.k]}`,
            st: `flex: ${Math.max(p.montant, st.montant / 200).toFixed(0)}`,
            l: t(`departement_a.payeur.${p.k}`),
            v: montantA(p.montant),
            p: p.pct >= 2 ? t("departement_a.pct", { p: p.pct }) : "",
            bl: [
              t("departement_a.b.part", { m: montantA(p.montant), p: p.pct }),
              ...tops.map(
                (x) => `${nomAcheteurA(f.acheteurs[x.s], L, nomDep, x.s)} · ${montantA(x.m)}`,
              ),
            ].join("\n"),
          };
        }),
        r: repli(
          S.open,
          "acheteurs",
          t("departement_a.acheteurs_k"),
          Math.min(8, acheteurs.length),
          this.basculer,
        ),
        acheteurs: acheteurs.slice(0, 8).map((a) => {
          const c = f.acheteurs[a.siren]?.categorie ?? "";
          return {
            nom: [nomAch(a.siren)] as RichItem[],
            s: `${t("departement_a.contrats_n", { n: a.n })}${c && has(`registre.departement.cat_${c}`) ? ` · ${t(`departement.cat_${c}`)}` : ""}`,
            v: montantA(a.montant),
          };
        }),
        ch: {
          w: String(W),
          titre: t("departement_a.annees_titre", { dans: N.dans }),
          grille: ax.ticks.map((g) => ({
            y: yv(g.v).toFixed(1),
            ty: (yv(g.v) + 4).toFixed(1),
            l: g.l,
          })),
          cols: ans9.map((y, i) => {
            const a = Y(y);
            const x = 49.8 + i * slot;
            const h = (186 * a.con) / haut;
            return {
              an: y,
              hx: x.toFixed(1),
              hw: slot.toFixed(1),
              x: (x + 10.2).toFixed(1),
              w: "44",
              y: (210 - h).toFixed(1),
              h: a.con ? h.toFixed(1) : "",
              cx: (x + 32.2).toFixed(1),
              vy: (210 - h - 6).toFixed(1),
              v: fr(a.con),
              tab: a.con ? "0" : "-1",
              bh: y,
              bl: [
                t("departement_a.b.con", { n: a.con }),
                t("departement_a.b.ao_mod", { a: a.ao, m: a.mod }),
              ].join("\n"),
              bc: a.con ? t("departement_a.b.con_clic") : "",
              go: a.con ? `/registre/contrats?dep=${encodeURIComponent(dep)}&annee=${y}` : "",
            };
          }),
          // the contracts before the chart's first year (an older notice): counted in the total,
          // said under the chart rather than hidden
          note: [
            t("departement_a.annees_note", { y: ans9[ans9.length - 1], d: jourMois(jusqu) }),
            avant > 0 ? t("departement_a.annees_avant", { n: avant }) : "",
          ]
            .filter(Boolean)
            .join(" "),
        },
      };
    }

    // 3 · who sells
    let vend = null;
    const vs = [...f.stats.vendeurs].sort((a, b) => b.montant - a.montant || b.n - a.n);
    if (vs.length) {
      const vN = num();
      entree("vend", `${vN} · ${t("departement_a.toc.vend")}`);
      const lienV = (s: string): RichItem => {
        const e = f.entreprises[s];
        return lienA(
          e?.ref && !e.entrepreneur_individuel ? `/registre/entreprise/${s}` : null,
          entName(L, s),
        );
      };
      const parN = [...vs].sort((a, b) => b.n - a.n || b.montant - a.montant)[0];
      const max = Math.max(1, vs[0].montant);
      const ansV: RichItem[] = [
        { strong: t("departement_a.vend_n", { n: vs.length }) },
        t("departement_a.vend_ans", { dans: N.dans, n: vs.length }),
      ];
      if (vs[0].montant > 0 && parN.siren !== vs[0].siren && parN.n > vs[0].n)
        ansV.push(
          t("departement_a.vend_deux"),
          { strong: [lienV(vs[0].siren)] },
          t("departement_a.vend_montant", { m: montantA(vs[0].montant) }),
          { strong: [lienV(parN.siren)] },
          t("departement_a.vend_plus", { n: parN.n }),
        );
      else if (vs[0].montant > 0)
        ansV.push(
          " ",
          { strong: [lienV(vs[0].siren)] },
          t("departement_a.vend_tete", { m: montantA(vs[0].montant), n: vs[0].n }),
        );
      vend = {
        n: vN,
        ans: ansV,
        r: repli(S.open, "vend", t("accueil.voir_detail"), Math.min(8, vs.length), this.basculer),
        rows: vs.slice(0, 8).map((o) => ({
          nom: [lienV(o.siren)] as RichItem[],
          st: `width: ${((100 * o.montant) / max).toFixed(1)}%`,
          m: o.montant > 0 ? montantA(o.montant) : montant(o),
          c: t("departement_a.contrats_n", { n: o.n }),
        })),
      };
    }

    // 4 · the prefecture's decrees
    let aut = null;
    {
      const aN = num();
      entree("autorise", `${aN} · ${t("departement_a.toc.aut")}`);
      if (!lu)
        aut = {
          n: aN,
          ans: [etatDepartement(dep, nom, f.couverture)] as RichItem[],
          lu: false,
        };
      else {
        const ys = annees(f.maj).filter(
          (y) => (f.stats.annees[y]?.cam ?? 0) + (f.stats.annees[y]?.dr ?? 0) > 0,
        );
        const maxC = Math.max(1, ...ys.map((y) => f.stats.annees[y]?.cam ?? 0));
        const maxD = Math.max(0, ...ys.map((y) => f.stats.annees[y]?.dr ?? 0));
        const k = facteurDrones(maxC, maxD);
        const hb = [
          ...ys.map((y) => ({ y, v: f.stats.annees[y]?.cam ?? 0, dr: false })),
          ...ys.map((y) => ({ y, v: f.stats.annees[y]?.dr ?? 0, dr: true })),
        ].map((x) => ({
          cls: x.dr ? "hb dr" : "hb",
          l: t(x.dr ? "departement_a.hb_dr" : "departement_a.hb_cam", { y: x.y }),
          st: `width: ${Math.min(100, (100 * x.v * (x.dr ? k : 1)) / maxC).toFixed(1)}%`,
          v: fr(x.v),
        }));
        const parCam = [...coms]
          .filter((c) => c.aut > 0)
          .sort((a, b) => b.aut - a.aut || b.dr - a.dr);
        const parDr = [...coms].filter((c) => c.dr > 0).sort((a, b) => b.dr - a.dr);
        const ansA: RichItem[] = [];
        if (st.cam)
          ansA.push(
            { strong: t("departement_a.lead_cam", { n: st.cam }) },
            hors.cam
              ? t("departement_a.aut_ans_cam_places", { y: anA, p: places.cam })
              : t("departement_a.aut_ans_cam", { y: anA }),
          );
        if (st.dr) {
          ansA.push(
            ...(st.cam ? [" "] : []),
            { strong: t("departement_a.lead_cam", { n: st.dr }) },
            hors.dr
              ? t("departement_a.aut_ans_dr_places", { p: places.dr, n: drComs })
              : t("departement_a.aut_ans_dr", { n: drComs }),
          );
          if (parDr[0] && drComs > 1)
            ansA.push(
              t("departement_a.aut_dont"),
              { strong: [lienCom(parDr[0].insee)] },
              ` (${fr(parDr[0].dr)})`,
            );
          ansA.push(".");
        }
        if (!st.cam && !st.dr) ansA.push(t("departement_a.aut_aucun", { dans: N.dans }));
        aut = {
          n: aN,
          ans: ansA,
          lu: ys.length > 0,
          hb,
          note: [
            k > 1 ? t("departement_a.aut_note_k", { k }) : "",
            t("departement_a.aut_note", { y: anA }),
          ]
            .filter(Boolean)
            .join(" "),
          r: repli(
            S.open,
            "autou",
            t("departement_a.aut_ou_k"),
            Math.min(8, parCam.length),
            this.basculer,
          ),
          // a département whose decrees name no commune (Paris's prefecture, the Creuse): no list
          ouVide: !parCam.length,
          row: parCam.length ? "row2" : "row2 seul",
          ou: parCam.slice(0, 8).map((c) => ({
            nom: [lienCom(c.insee)] as RichItem[],
            s: t("departement_a.aut_dr_n", { n: c.dr }),
            v: fr(c.aut),
          })),
          drones: st.dr ? `/registre/arretes?dep=${encodeURIComponent(dep)}&disp=dr` : "",
          dronesL: t("departement_a.aut_drones", { du: N.du }),
        };
      }
    }

    // 5 · compared with the other départements (listes.json)
    let cmp = null;
    if (U.includes(dep)) {
      const cN = num();
      entree("compare", `${cN} · ${t("departement_a.toc.cmp")}`);
      if (!X) cmp = { n: cN, ans: null, cartes: null, attente: t("departement_a.cmp_attente") };
      else {
        const cartes = (["amt", "con", "cam", "dr"] as const)
          .filter((k) => k === "amt" || k === "con" || lu)
          .map((k) => ({
            titre: t(`departement_a.cmp.${k}`),
            rows: tete(dep, vals(k), MES[k].u).map((r) => ({
              cls: r.gap ? "gap" : r.me ? "me" : "",
              r: r.gap ? "" : String(r.r),
              nom: (r.gap ? ["…"] : [lienDep(r.k)]) as RichItem[],
              v: r.gap ? "" : MES[k].fmt(r.v),
            })),
            note: t(MES[k].u === LUS ? "departement_a.sur_lus" : "departement_a.sur_deps", {
              n: MES[k].u.length,
            }),
          }));
        // the sentence: the measures where it is in the first three, then the others' rank (a
        // measure where it has nothing is no rank)
        const ks = (["amt", "con", "cam", "carte", "dr"] as const).filter(
          (k) => rangs[k] && (vals(k)[dep] ?? 0) > 0,
        );
        const trio = ks.filter((k) => (rangs[k]?.r ?? 99) <= 3);
        const loin = ks.filter((k) => (rangs[k]?.r ?? 0) > 3);
        const ansC: RichItem[] = [];
        if (trio.length)
          ansC.push(
            t("departement_a.cmp_ans_a", {
              art: capital(N.art),
              v: t(/^les /i.test(N.art) ? "departement_a.sont" : "departement_a.est"),
            }),
            { strong: t("departement_a.cmp_trio") },
            t("departement_a.cmp_ans_pour"),
            ...enumerer(
              trio.map((k) => t(`departement_a.cmp_mes.${k}`)),
              t("departement_a.et"),
              ", ",
            ),
            ".",
          );
        if (loin.length === 1 && trio.length) {
          const r = rangs[loin[0]] as Rang;
          ansC.push(
            " ",
            t("departement_a.cmp_ans_un", {
              m: t(`departement_a.cmp_mes.${loin[0]}`),
              r: ordinalTxt(r.r),
              n: r.n,
              d: artDep(r.tete),
            }),
          );
        } else if (loin.length)
          ansC.push(
            trio.length
              ? t("departement_a.cmp_ailleurs")
              : t("departement_a.cmp_est", {
                  art: capital(N.art),
                  v: t(/^les /i.test(N.art) ? "departement_a.sont" : "departement_a.est"),
                }),
            ...enumerer(
              loin.map((k) =>
                t("departement_a.cmp_rang_pour", {
                  r: ordinalTxt((rangs[k] as Rang).r),
                  m: t(`departement_a.cmp_mes.${k}`),
                }),
              ),
              t("departement_a.et"),
              ", ",
            ),
            ".",
          );
        cmp = { n: cN, ans: ansC.length ? ansC : null, cartes, attente: "" };
      }
    }

    // « Toutes les communes »: the chips (a métropole, the others), « Intercommunalité ▾», the sort
    const montantC = (insee: string) => f.stats.communes[insee]?.montant ?? 0;
    const pris = coms.filter(
      (c) =>
        (S.filtre === "tous" || (S.filtre === "in") === membres.has(c.insee)) &&
        (!S.epciF || c.epci === S.epciF),
    );
    const cle = (c: ComRow): number | string =>
      S.tri === "nom"
        ? c.nom
        : S.tri === "pop"
          ? c.pop
          : S.tri === "con"
            ? c.con
            : S.tri === "montant"
              ? montantC(c.insee)
              : S.tri === "cam"
                ? c.aut
                : S.tri === "dr"
                  ? c.dr
                  : (c.cams ?? -1);
    const tries = [...pris].sort((a, b) => {
      const va = cle(a);
      const vb = cle(b);
      return typeof va === "string"
        ? va.localeCompare(String(vb), "fr")
        : Number(vb) - Number(va) || b.docs - a.docs;
    });
    const nMetro = coms.filter((c) => membres.has(c.insee)).length;
    const epcisOpts = Object.entries(f.stats.epcis)
      .filter(([k]) => coms.some((c) => c.epci === k))
      .map(([k, e]) => ({
        v: k,
        l: `${nomEpci(k, e.nom)} · ${fr(coms.filter((c) => c.epci === k).length)}`,
      }))
      .sort((a, b) => a.l.localeCompare(b.l, "fr"));
    const montre = tries.slice(0, LIGNES);
    const colL = (k: Tri) => t(`departement_a.col.${k}`);
    const comsV = {
      r: repli(S.open, "coms", t("accueil.voir_detail"), montre.length, this.basculer),
      onglets: [
        { k: "tous" as const, l: t("departement_a.onglet_tous", { n: coms.length }) },
        ...(metroK
          ? [
              {
                k: "in" as const,
                l: `${nomEpci(metroK, f.stats.epcis[metroK]?.nom)} · ${fr(nMetro)}`,
              },
              {
                k: "hors" as const,
                l: t("departement_a.onglet_hors", {
                  m: (f.stats.epcis[metroK]?.nom ?? "").split(" ")[0],
                  n: coms.length - nMetro,
                }),
              },
            ]
          : []),
      ].map((o) => ({
        l: o.l,
        on: S.filtre === o.k && !S.epciF ? "true" : "false",
        pick: (() => this.setState({ filtre: o.k, epciF: "", menu: "" })) as Handler,
      })),
      menu: epcisOpts.length > 1 ? this.menuEpci(epcisOpts) : null,
      exporter: (() => {
        const corps = csv(
          [
            colL("nom"),
            "INSEE",
            colL("pop"),
            colL("con"),
            colL("montant"),
            colL("cam"),
            colL("dr"),
            colL("carte"),
          ],
          tries.map((c) => [
            c.nom,
            c.insee,
            c.pop || "",
            c.con,
            montantC(c.insee),
            luC(c).cam ? c.aut : "",
            luC(c).dr ? c.dr : "",
            c.cams ?? "",
          ]),
        );
        const url = URL.createObjectURL(new Blob([corps], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `registre-departement-${dep}-communes.csv`;
        a.hidden = true;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }) as Handler,
      cols: TRIS.map((k) => ({
        l: colL(k),
        cls: k === "nom" ? "" : "n",
        sort: S.tri === k ? (k === "nom" ? "ascending" : "descending") : "none",
        pick: (() => this.setState({ tri: k })) as Handler,
      })),
      rows: montre.map((c) => {
        const mt = montantC(c.insee);
        return {
          nom: [lienCom(c.insee)] as RichItem[],
          pop: c.pop ? fr(c.pop) : "—",
          con: fr(c.con),
          montant: mt > 0 ? t("departement_a.euros", { n: fr(mt) }) : "—",
          cam: !luC(c).cam ? nonLuC : c.aut ? fr(c.aut) : "—",
          dr: !luC(c).dr ? nonLuC : c.dr ? fr(c.dr) : "—",
          // outside the map (overseas), never « — » read as none (recette 10)
          carte: c.cams == null ? t("departement_a.fig.hors_carte") : fr(c.cams),
        };
      }),
      // a row's click opens its commune, as its link does
      ligne: ((ev) => {
        const tgt = ev.nativeEvent.target as Element;
        if (tgt.closest("a, button")) return;
        tgt.closest("tr")?.querySelector<HTMLAnchorElement>("td a")?.click();
      }) as Handler,
      vide: !pris.length,
      note: [
        tries.length > LIGNES
          ? t("departement_a.communes_note", { n: LIGNES, tri: colL(S.tri).toLowerCase() })
          : t("departement_a.communes_note_toutes", { n: tries.length }),
        // « pas rattachés » in a cell: what it means, once
        lu && montre.some((c) => !luC(c).cam || !luC(c).dr)
          ? t("departement_a.note_rattache", { phrase: rattache })
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      tout: coms.length > LIGNES ? `/registre/communes?dep=${encodeURIComponent(dep)}` : "",
      toutL: t("departement_a.communes_tout", { du: N.du }),
    };

    // the sources
    const srcRows = [
      { cls: "ok", l: t("departement_a.src.contrats"), d: t("departement_a.src.contrats_d") },
      { cls: "ok", l: t("departement_a.src.ao"), d: t("departement_a.src.ao_d") },
      {
        cls: lu ? "part" : "non",
        l: t("departement_a.src.arretes", { du: N.du }),
        d: lu ? t("departement_a.src.arretes_d", { y: anA }) : t("liste.non_lu"),
      },
      {
        cls: "part",
        l: t("departement_a.src.subventions"),
        d: t("departement_a.src.subventions_d"),
      },
      { cls: "ok", l: t("departement_a.src.carte"), d: t("departement_a.src.carte_d") },
    ];
    toc.push({ href: "#communes", l: t("departement_a.toc.communes"), go: this.allerSection });
    toc.push({ href: "#sources", l: t("departement_a.toc.sources"), go: this.allerSection });
    // a head figure's click goes to its section, by the number the section has here
    const nSec = new Map(toc.map((x) => [x.href, x.l.split(" · ")[0]]));
    const figsB = figs.map((x) => ({
      ...x,
      bc: nSec.has(x.href) ? t("departement_a.b.section", { n: nSec.get(x.href) ?? "" }) : "",
      href: nSec.has(x.href) ? x.href : "#communes",
    }));

    return {
      ...this.base("departement-a"),
      nom,
      code: dep,
      // the name cut out word by word: a long one (« Alpes-de-Haute-Provence ») wraps after a
      // hyphen or a space, never inside a word
      mots: coupe(nom).reduce<Coupe[][]>(
        (ws, x, i, all) => {
          ws[ws.length - 1].push(x);
          if ((x.ch === "-" || x.cls === "sp") && i < all.length - 1) ws.push([]);
          return ws;
        },
        [[]],
      ),
      meta: [
        t("departement_a.meta_communes", { n: coms.length }),
        ...(f.couverture.dernier_recueil
          ? [t("departement_a.collecte", { d: jourA(f.couverture.dernier_recueil) })]
          : []),
      ],
      lead,
      partager: ((ev) => partager(this, ev.currentTarget)) as Handler,
      citer: this.citer,
      citerL: t(S.cite ? "departement_a.cite" : "departement_a.citer"),
      figs: figsB,
      toc,
      ou,
      paie,
      vend,
      aut,
      cmp,
      coms: comsV,
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
        note: st.sansCommune ? t("departement_a.sources_note", { n: st.sansCommune }) : "",
      },
      pleinEcran,
    };
  }
}

type Props = {
  dep: string;
  f: FichierDepartement;
  ic: string;
  achats: FichierAcheteur[];
  couverture?: Couverture;
};
type State = BaseState & {
  sortI: string;
  dirI: number;
  sortC: string;
  dirC: number;
  q: string;
  allC: boolean;
  sortV: "n" | "amt";
  sortB: "n" | "amt";
  yt: "con" | "ao" | "cam";
  allD: boolean;
};
type Detail = {
  kicker: string;
  title: string;
  rows: [string, string][];
  /** rows that name a company or a territory: rich, each mention a link */
  corr?: [string, RichItem[]][];
  link?: [string, string];
  foot?: string;
};

const SHOWN = 15;
const DOCS = 8;
const nameFirst = (k: string) => (k === "nom" ? 1 : -1);
const SIREN = (s: string) => s.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
const TODAY = new Date().toISOString().slice(0, 10);
// one colour for the measure: a territory's own colour is yellow, so its measure is the ink, as a
// commune's (DECISIONS 2026-10-30); the mark chosen is full of ink with a thick outline (v2.1: yellow
// never says the selection), the outline the kit's (cadre.css .yb)
const BAR = "var(--fg)";
const ON = "var(--fg)";
/** An amount in millions, one decimal, as the bars write them; below 100 000 € in euros. */
const meur = (n: number): string =>
  !n
    ? money(0)
    : n < 1e5
      ? money(n)
      : t("format.meur", { n: (n / 1e6).toFixed(1).replace(".", ",") });

/** A contract of the territory's own purchases, with the buyer file that holds it. */
type Achat = { c: Contrat; f: FichierAcheteur };

class Intercommunalite extends Vue<Props, State> {
  private cache?: ReturnType<Intercommunalite["build"]>;

  protected init(): Partial<State> {
    return {
      sortI: "docs",
      dirI: -1,
      sortC: "docs",
      dirC: -1,
      q: "",
      allC: false,
      sortV: "n",
      sortB: "n",
      yt: "con",
      allD: false,
    };
  }

  private build() {
    const { f, dep, ic: asked, achats } = this.props;
    const ic = epciDe(f, asked);
    const coms = communes(f);
    const L: Lexique = { entreprises: f.entreprises, acheteurs: f.acheteurs, communes: f.communes };
    const IC = intercommunalites(f, coms);
    const N = noms(dep, f.departement.nom);
    // its own purchases: every contract of its buyer files, the most recent first
    const A: Achat[] = achats
      .flatMap((x) => contrats(x, x.stats).map((c) => ({ c, f: x })))
      .sort((a, b) => b.c.d.localeCompare(a.c.d));
    const ep = ic ? IC.find((o) => o.code === ic) : undefined;
    return { ic, coms, L, IC, N, A, ep };
  }
  private data() {
    if (!this.cache) this.cache = this.build();
    return this.cache;
  }

  titre(): string {
    const { N, ep } = this.data();
    return ep ? ep.nom : N.nom;
  }
  type() {
    return this.data().ic ? ("epci" as const) : ("departement" as const);
  }
  /** Registre › Départements (or Intercommunalités, for an intercommunality) › the page itself. */
  fil(): Miette[] {
    const { ic } = this.data();
    // an intercommunality's fiche is drawn by its département's view (?ic=): its list is theirs
    return [
      { k: "registre", l: t("types.registre.l"), href: "/registre/" },
      ic ? etapeListe("epci", ic) : etapeListe("departement", this.props.dep),
    ];
  }
  /** Its door to the drones (v2.3): with drone decrees, the list of decrees on its drones (no 3D
   * view of a département, by default in this lot). */
  private portes(): Porte[] {
    const n = this.props.f.stats.depStats.dr ?? 0;
    if (!n) return [];
    const href = `/registre/arretes?dep=${encodeURIComponent(this.props.dep)}&disp=dr`;
    return [{ l: t("commune.carte_et_drones"), href, i: ICONE_DRONES, cur: null }];
  }
  partage(): Partage | null {
    return partageDe(this.titre(), this.props.f.partage);
  }

  renderVals() {
    const S = this.state;
    const { f, dep } = this.props;
    const { ic, coms: allComs, L, IC, N, A, ep } = this.data();
    const st = f.stats.depStats;
    const couv = f.couverture;
    const col = couv.etat === "collecte";
    const etat = col ? "" : etatDepartement(dep, N.nom, couv);
    const DET: Record<string, Detail> = {};
    const v = (n: number) => (col ? fr(n) : "—");
    // a row's decrees as `lecture` reads them: its camera decrees, its drone decrees
    const vA = (o: { insee?: string; aut: number; dr: number }) =>
      lecture(couvC(f, col, o)).cam ? fr(o.aut) : "—";
    const vD = (o: { insee?: string; aut: number; dr: number }) =>
      lecture(couvC(f, col, o)).dr ? fr(o.dr) : "—";
    const carte = (n: number | null) => (n == null ? "—" : fr(n));
    const wide = large();
    const nom = ep ? ep.nom : N.nom;
    // the communes of the fiche: the intercommunality's, or every one of the département
    const coms = ep ? ep.list : allComs;

    // --- Avec qui: the intercommunalities (the département's fiche), each a link to its fiche
    const ics = ic
      ? []
      : trier(IC, S.sortI, S.dirI).map((o) => {
          const k = `i${o.code}`;
          DET[k] = {
            kicker: t("departement.k_intercommunalite"),
            title: o.nom,
            rows: [
              [t("departement.p_communes"), fr(o.n)],
              [t("departement.p_documents"), fr(o.docs)],
              [t("departement.p_contrats"), fr(o.con)],
              [t("departement.p_autorisations"), vA(o)],
              [t("departement.p_drones"), vD(o)],
              [t("departement.p_carte"), carte(o.cams)],
            ],
            link: o.code
              ? [t("departement.voir_intercommunalite"), epciHref(dep, o.code)]
              : undefined,
          };
          return {
            nom: o.code ? lienEpci(f, o.code, o.nom, true) : o.nom,
            n: fr(o.n),
            docs: fr(o.docs),
            con: fr(o.con),
            aut: vA(o),
            dr: vD(o),
            cams: carte(o.cams),
            ...this.ligne(k, "epci"),
          };
        });
    const icCols = aides(
      this.cols(
        [
          ["nom", t("departement.col_intercommunalite"), "", "width: 38%"],
          ["n", t("departement.col_communes"), "num"],
          ["docs", t("departement.col_documents"), "num"],
          ["con", t("departement.col_contrats"), "num"],
          ["aut", t("departement.col_autorisations"), "num"],
          ["dr", t("departement.col_drones"), "num"],
          ["cams", t("departement.col_carte"), "num"],
        ] as Col[],
        "sortI",
        "dirI",
        nameFirst,
      ),
      [
        undefined,
        t("departement.aide_communes"),
        t("departement.aide_documents"),
        t("departement.aide_contrats"),
        t("departement.aide_autorisations"),
        t("departement.aide_drones"),
        t("departement.aide_carte"),
      ],
    );

    // --- every commune, filtered by name; each a link, its intercommunality a link under it
    for (const c of coms)
      DET[`c${c.insee}`] = {
        kicker: t("departement.k_commune"),
        title: c.nom,
        rows: [
          [t("departement.p_habitants"), c.pop ? fr(c.pop) : "—"],
          [t("departement.p_documents"), fr(c.docs)],
          [t("departement.p_contrats"), fr(c.con)],
          [t("departement.p_autorisations"), vA(c)],
          [t("departement.p_drones"), vD(c)],
          [t("departement.p_carte"), carte(c.cams)],
        ],
        // its intercommunality, a link to its fiche (the panel's rich line)
        corr: c.epci
          ? [[t("departement.k_intercommunalite"), [lienEpci(f, c.epci, c.ep, true)]]]
          : undefined,
        link: [t("departement.voir_commune"), `/registre/commune/${c.insee}`],
      };
    const q = S.q.trim();
    const filtered = trier(filtrer(coms, q), S.sortC, S.dirC);
    const shown = q || S.allC ? filtered : filtered.slice(0, SHOWN);
    const mxd = Math.max(1, ...coms.map((c) => c.docs));
    const comsV = shown.map((c: ComRow) => ({
      nom: lienCommune(L, c.insee, c.nom, true),
      // on an intercommunality's fiche its own name is not repeated under each commune
      ep: c.epci && !ic ? lienEpci(f, c.epci, c.ep, true) : "",
      docs: fr(c.docs),
      con: fr(c.con),
      aut: vA(c),
      dr: vD(c),
      cams: carte(c.cams),
      ...this.ligne(`c${c.insee}`, "commune"),
      // linear (R1's was a square root, a hidden scale: v2 § 8)
      bar: `display: inline-block; height: 10px; width: ${Math.max(2, Math.round((c.docs / mxd) * 110))}px; background: ${this.on(`c${c.insee}`) ? ON : BAR}; border: 1px solid #111`,
    }));
    const comCols = aides(
      this.cols(
        [
          ["nom", t("departement.col_commune"), "", "width: 34%"],
          ["docs", t("departement.col_documents"), "num"],
          ["con", t("departement.col_contrats"), "num"],
          ["aut", t("departement.col_autorisations"), "num"],
          ["dr", t("departement.col_drones"), "num"],
          ["cams", t("departement.col_carte"), "num"],
        ] as Col[],
        "sortC",
        "dirC",
        nameFirst,
      ),
      [
        undefined,
        t("departement.aide_documents"),
        t("departement.aide_contrats"),
        t("departement.aide_autorisations"),
        t("departement.aide_drones"),
        t("departement.aide_carte"),
      ],
    );
    const nC = coms.length;
    const comCount = q
      ? t("departement.com_trouvees", { n: filtered.length })
      : S.allC || nC <= SHOWN
        ? t("n.commune", { n: nC })
        : t("departement.com_sur", { k: SHOWN, communes: t("n.commune", { n: nC }) });

    // --- who sells, who buys: the contracts placed in the département (its fiche)
    const lignes = (rows: Ligne[], k: "n" | "amt") =>
      rows
        .slice()
        .sort((a, b) =>
          k === "n" ? b.n - a.n || b.montant - a.montant : b.montant - a.montant || b.n - a.n,
        )
        .slice(0, 10);
    const moneyRows = (o: Ligne): [string, string][] => [
      [t("departement.p_contrats_dans", { dans: N.dans }), fr(o.n)],
      [t("departement.p_montant"), montant(o)],
      ...(o.hors_totaux
        ? [[t("departement.p_hors_totaux"), fr(o.hors_totaux)] as [string, string]]
        : []),
    ];
    /** A link's address, when the mention is one (a sole trader's is not). */
    const hrefDe = (x: RichItem): string | undefined =>
      typeof x === "object" && "a" in x ? x.a.href : undefined;
    const sellers = ic
      ? []
      : lignes(f.stats.vendeurs, S.sortV).map((o) => {
          const k = `s${o.siren}`;
          const lk = lienEntreprise(L, o.siren);
          const ei = !!L.entreprises[o.siren]?.entrepreneur_individuel;
          const href = hrefDe(lk);
          DET[k] = {
            kicker: ei
              ? t("departement.k_entreprise")
              : t("departement.k_entreprise_siren", { siren: SIREN(o.siren) }),
            title: typeof lk === "object" && "a" in lk ? String(lk.a.text) : String(lk),
            rows: moneyRows(o),
            link: href ? [t("departement.voir_entreprise"), href] : undefined,
          };
          return {
            nom: enLigne(lk),
            n: fr(o.n),
            amt: montant(o),
            ...this.ligne(k, "entreprise"),
          };
        });
    const heads = (cur: "n" | "amt", key: "sortV" | "sortB") =>
      (
        [
          ["n", t("departement.col_contrats")],
          ["amt", t("departement.col_montant")],
        ] as const
      ).map(([k, l]) => ({
        l,
        ac: k === "amt" ? "aide" : "",
        aide: k === "amt" ? t("departement.aide_montant") : "",
        sort: cur === k ? "descending" : "none",
        arrow: cur === k ? "↓" : "",
        pick: (() => this.setState({ [key]: k } as Partial<State>)) as Handler,
      }));
    const cat = (o: Ligne) => {
      const c = f.acheteurs[o.siren]?.categorie;
      if (o.centrale) return t("departement.cat_centrale");
      return c && has(`registre.departement.cat_${c}`)
        ? t(`departement.cat_${c}`)
        : t("departement.cat_acheteur");
    };
    // a buyer named here: the département itself is not a link to its own fiche, an
    // intercommunality with its row links to its fiche, any other buyer to its own
    const propres = new Set(achatsPropres(f, ""));
    const lienBuyer = (s: string): RichItem =>
      propres.has(s)
        ? { strong: nomAcheteur(L, s) }
        : f.stats.epcis[s]
          ? lienEpci(f, s, nomAcheteur(L, s))
          : lienAcheteur(L, s);
    const buyers = ic
      ? []
      : lignes(f.stats.acheteurs, S.sortB).map((o) => {
          const k = `b${o.siren}`;
          const lk = lienBuyer(o.siren);
          const href = hrefDe(lk);
          DET[k] = {
            kicker: t("departement.k_acheteur", { cat: cat(o) }),
            title: nomAcheteur(L, o.siren),
            rows: moneyRows(o),
            link: href
              ? [
                  t(
                    href.startsWith("/registre/commune/")
                      ? "departement.voir_commune"
                      : f.stats.epcis[o.siren]
                        ? "departement.voir_intercommunalite"
                        : "departement.voir_acheteur",
                  ),
                  href,
                ]
              : undefined,
          };
          return {
            nom: enLigne(lk),
            cat: cat(o),
            n: fr(o.n),
            amt: montant(o),
            ...this.ligne(k, typeDe(lk)),
          };
        });

    // --- its own purchases (an intercommunality's, a département's buyer files)
    const C = A.map((a) => a.c);
    const T = total(C);
    const nomPropre = (x: FichierAcheteur) => titreCourt(buyerNom(x, x.acheteur.siren));
    for (const [i, a] of A.entries())
      DET[`a${i}`] = {
        kicker: t("departement.k_achat", { date: shortDate(a.c.d) }),
        title: a.c.objet,
        rows: [
          [t("departement.p_acheteur"), nomPropre(a.f)],
          [t("departement.p_montant"), moneyFull(a.c.m0)],
          [t("departement.p_offres"), a.c.off == null ? t("format.non_publie") : fr(a.c.off)],
        ],
        // its companies, each a link (the panel's rich line)
        corr: [
          [
            t("departement.p_entreprises"),
            a.c.ents.length
              ? a.c.ents.flatMap((s, j) => {
                  const lk = lienEntreprise(lexique(a.f), s);
                  return j ? [" + ", lk] : [lk];
                })
              : [t("acheteur.ent_non_publiee")],
          ],
        ],
        link: [t("departement.voir_contrat"), documentHref(a.c.affaire)],
      };
    const docs = (S.allD ? A : A.slice(0, DOCS)).map((a, i) => {
      const k = `a${i}`;
      const lx = lexique(a.f);
      return {
        ...this.ligne(k, "con", "drow r"),
        d: shortDate(a.c.d),
        objet: lienDocument(lx, a.c.e, a.c.label, true),
        ents: a.c.ents.length
          ? a.c.ents.flatMap((s, j) =>
              j ? [" + ", lienEntreprise(lx, s)] : [lienEntreprise(lx, s)],
            )
          : [t("acheteur.ent_non_publiee")],
        amt: money(a.c.m0),
      };
    });
    // its calls for tenders (its buyer files'): those of its contracts and those no contract was
    // found for, each a link to its record, the contract that followed a link too
    const { achats } = this.props;
    const AO = achats
      .flatMap((x) => appels(x, contrats(x, x.stats)).map((o) => ({ o, f: x })))
      .sort((a, b) => b.o.d.localeCompare(a.o.d));
    const RECENT = (() => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - 18);
      return d.toISOString().slice(0, 10);
    })();
    const aos = AO.map(({ o, f: x }, i) => {
      const k = `o${i}`;
      const lx = lexique(x);
      const suite: RichItem[] = o.contrat
        ? [
            lien("con", documentHref(o.contrat), shortDate(o.dContrat), true),
            ...o.ents.flatMap((s) => [" · ", lienEntreprise(lx, s)]),
          ]
        : [o.d >= RECENT ? t("acheteur.pas_encore_publie") : t("acheteur.non_retrouve")];
      DET[k] = {
        kicker: t("acheteur.o_kicker", { date: shortDate(o.d) }),
        title: o.objet,
        rows: [[t("acheteur.publications"), o.refs || "—"]],
        corr: [[t("acheteur.contrat"), suite]],
        link: [t("departement.voir_appel"), o.href],
      };
      return {
        ...this.ligne(k, "ao", "drow r"),
        d: shortDate(o.d),
        objet: lien("ao", o.href, o.objet, true),
        suite,
      };
    });
    // who sold to the intercommunality (its own purchases): each company a link
    const SE = ic && A.length ? vendeurs(C) : [];
    const ventes = SE.map((x, i) => {
      const k = `v${i}`;
      const fx = A.find((a) => a.c.ents.includes(x.s))?.f ?? A[0].f;
      const lk = lienEntreprise(lexique(fx), x.s);
      const href = hrefDe(lk);
      DET[k] = {
        kicker: t("departement.k_entreprise"),
        title: buyerEnt(fx, x.s),
        rows: [
          [t("departement.p_contrats_avec", { nom }), fr(x.n)],
          [t("departement.p_montant"), x.montant ? moneyFull(x.montant) : "—"],
        ],
        link: href ? [t("departement.voir_entreprise"), href] : undefined,
      };
      return {
        nom: enLigne(lk),
        n: fr(x.n),
        amt: x.montant ? money(x.montant) : "—",
        ...this.ligne(k, "entreprise"),
      };
    });

    // --- Dans le temps. The département: its documents each year, one kind at a time (R1's,
    // recoloured); the decrees before their collection absent. An intercommunality: the planned
    // amount of the contracts it signed each year (the build has no yearly figures of its
    // territory: lot R3)
    const yrs = annees(f.maj);
    const last = yrs[yrs.length - 1];
    const AN = f.stats.annees;
    const y0col = (couv.depuis ?? "9999").slice(0, 4);
    const absent = (y: string) => S.yt === "cam" && (!col || y < y0col);
    const vals = yrs.map((y) => AN[y]?.[S.yt] ?? 0);
    const mx = Math.max(1, ...vals.filter((_, i) => !absent(yrs[i])));
    const years = ic
      ? []
      : yrs.map((y, i) => {
          const k = `y${y}`;
          const on = this.on(k);
          const fill = on ? ON : BAR;
          const o = AN[y];
          const h = absent(y) ? 0 : Math.max(vals[i] ? 3 : 0, Math.round((vals[i] / mx) * 150));
          DET[k] = {
            kicker: t(y === last ? "departement.k_annee_en_cours" : "departement.k_annee"),
            title: y,
            rows: [
              [t("departement.p_contrats"), fr(o?.con ?? 0)],
              [t("departement.p_modifications"), fr(o?.mod ?? 0)],
              [t("departement.p_appels"), fr(o?.ao ?? 0)],
              [
                t("departement.p_autorisations"),
                !col || y < y0col ? t("departement.non_collectees") : fr(o?.cam ?? 0),
              ],
              [
                t("departement.p_drones"),
                !col || y < y0col ? t("departement.non_collectes") : fr(o?.dr ?? 0),
              ],
              [t("departement.p_subventions"), fr(o?.sub ?? 0)],
            ],
            link: [
              t("departement.documents_de", { y }),
              `/registre/?d=${depGroup(dep)}&y=${encodeURIComponent(y)}`,
            ],
          };
          return {
            y: y === last ? t("departement.annee_en_cours", { y }) : y,
            v: absent(y) ? "—" : fr(vals[i]),
            label: absent(y)
              ? t("departement.annee_alt_absente", { y })
              : t("departement.annee_alt", { y, n: vals[i] }),
            on: String(on),
            hover: this.survol(k),
            pick: this.choisir(k),
            // the year in progress hatched, its one mark (« * » under it says so)
            bar: !h
              ? "height: 0; border-width: 0"
              : y === last
                ? `height: ${h}px; background: repeating-linear-gradient(45deg, ${fill} 0 3px, transparent 3px 7px)`
                : `height: ${h}px; background: ${fill}`,
          };
        });
    const yearTypes = (["con", "ao", "cam"] as const).map((k) => ({
      l: t(`departement.an_${k}`),
      pressed: S.yt === k ? "true" : "false",
      pick: (() => this.setState({ yt: k })) as Handler,
    }));
    const aoAvant = Object.entries(AN)
      .filter(([y]) => y < yrs[0])
      .reduce((s, [, o]) => s + o.ao, 0);
    const anNote = [
      col
        ? t("departement.an_note_collecte", { mois: longMonth(couv.depuis ?? f.maj) })
        : `${etat} ${t("departement.an_note_absente")}`,
      t("departement.an_note_en_cours", { y: last }),
      aoAvant ? t("departement.an_note_ao", { n: aoAvant, y: yrs[0] }) : "",
    ]
      .filter(Boolean)
      .join(" ");
    const conY0 = Object.keys(AN).find((y) => AN[y].con > 0) ?? yrs[0];
    // the intercommunality's own purchases, by year
    const Y = ic ? parAnnee(C, Number(TODAY.slice(0, 4))) : [];
    const mxa = Math.max(1, ...Y.map((y) => y.montant));
    const achatsAn = Y.map((a) => {
      const k = `y${a.y}`;
      const on = this.on(k);
      DET[k] = {
        kicker: t("departement.k_annee"),
        title: a.y,
        rows: [
          [t("departement.p_contrats"), fr(a.cs.length)],
          [t("departement.p_montant"), a.montant ? money(a.montant) : "—"],
        ],
      };
      return {
        y: a.y,
        v: Y.length <= 12 ? meur(a.montant) : "",
        n: count(a.cs.length, "contrat"),
        label: t("departement.achat_annee_label", { y: a.y, v: meur(a.montant), n: a.cs.length }),
        on: String(on),
        hover: this.survol(k),
        pick: this.choisir(k),
        bar: a.montant
          ? `height: ${Math.max(3, Math.round((a.montant / mxa) * 150))}px; background: ${on ? ON : BAR}`
          : "height: 0; border-width: 0",
      };
    });

    // --- L'essentiel
    let lead: RichItem[];
    if (ic && ep) {
      lead = [
        t("departement.ic_lead", { n: ep.n }),
        {
          strong: col
            ? t("departement.n_autorisation", { n: ep.aut })
            : t("departement.autorisations_nc"),
        },
        t("departement.lead_et"),
        { strong: t("departement.n_contrat_video", { n: ep.con, dans: "" }).trim() },
        t("departement.lead_fin"),
      ];
      if (C.length)
        lead.push(
          " ",
          t("departement.ic_achats", {
            nom: capital(epciLa(ep.nom)),
            contrats: count(C.length, "contrat"),
          }),
        );
    } else if (col) {
      const top = IC.filter((o) => o.code).sort((a, b) => b.aut - a.aut || b.dr - a.dr)[0];
      const pa = top && st.cam ? part(top.aut / st.cam) : null;
      const pd = top && st.dr ? part(top.dr / st.dr) : null;
      lead = [
        t("departement.lead_depuis", { mois: longMonth(couv.depuis ?? f.maj) }),
        { strong: t("departement.n_autorisation", { n: st.cam }) },
        t("departement.lead_et"),
        { strong: t("departement.n_arrete_drone", { n: st.dr }) },
        t("departement.lead_dans", { dans: N.dans }),
        ...(pa
          ? [
              t("departement.lead_part", {
                parts: pd
                  ? t("departement.lead_parts", {
                      aut: t(`departement.part_aut_${pa}`),
                      dr: t(`departement.part_dr_${pd}`),
                    })
                  : t(`departement.part_aut_${pa}`),
              }),
              { strong: [lienEpci(f, top.code, epciLa(top.nom))] },
            ]
          : []),
        t("departement.lead_fin"),
      ];
    } else {
      const contrats_ = t("departement.n_contrat_video", { n: st.con, dans: N.dans });
      lead = !st.con
        ? [t("departement.lead_aucun_contrat", { dans: N.dans, etat })]
        : st.montant > 0
          ? [
              t("departement.lead_contrats_pour", { contrats: contrats_, dans: N.dans }),
              { strong: montant({ montant: st.montant, hors_totaux: 0 }) },
              t("departement.lead_contrats_fin", { etat }),
            ]
          : [t("departement.lead_contrats", { contrats: contrats_, dans: N.dans, etat })];
    }
    // caméras (their authorisations), arrêtés (of drones), contrats, montants
    const kpis =
      ic && ep
        ? [
            { v: vA(ep), l: t("departement.kpi_autorisations", { n: col ? ep.aut : 2 }) },
            { v: vD(ep), l: t("departement.kpi_drones", { n: col ? ep.dr : 2 }) },
            { v: fr(ep.con), l: t("departement.kpi_contrats", { n: ep.con }) },
            ...(C.length
              ? [
                  {
                    v: T.comptes ? money(T.montant) : "—",
                    l: t("departement.kpi_montant_achats", { n: C.length }),
                  },
                ]
              : [{ v: carte(ep.cams), l: t("departement.kpi_carte") }]),
          ]
        : [
            { v: v(st.cam), l: t("departement.kpi_autorisations", { n: col ? st.cam : 2 }) },
            { v: v(st.dr), l: t("departement.kpi_drones", { n: col ? st.dr : 2 }) },
            { v: fr(st.con), l: t("departement.kpi_contrats", { n: st.con }) },
            {
              v: st.montant > 0 ? money(st.montant) : "—",
              l: t("departement.kpi_montant"),
            },
          ];
    const etatLigne = col
      ? t("departement.sous_collecte", { mois: longMonth(couv.depuis ?? f.maj) })
      : t(
          couv.etat === "impossible"
            ? "departement.sous_impossible"
            : "departement.sous_non_collecte",
        );
    const ligne: RichItem[] =
      ic && ep
        ? [
            t("departement.ic_sous", { siren: SIREN(ic) }),
            " · ",
            t("departement.sous_communes", { communes: t("n.commune", { n: ep.n }) }),
            " · ",
            lienDepartement(dep, N.nom),
          ]
        : [
            dep,
            " · ",
            t("departement.sous_communes", { communes: t("n.commune", { n: nC }) }),
            " · ",
            etatLigne,
          ];

    // --- the panel: the row hovered or focused, else the one chosen (A3); at rest, what to choose
    const vu = this.affiche();
    const d0 = vu ? DET[vu] : undefined;
    const det = d0
      ? {
          kicker: d0.kicker,
          title: d0.title,
          rows: d0.rows.map(([k, x]) => ({ k, v: x })),
          corr: (d0.corr ?? []).map(([k, x]) => ({ k, v: x })),
          links: d0.link ? [{ l: d0.link[0], href: d0.link[1] }] : [],
          foot: d0.foot ?? "",
        }
      : {
          // at rest: what to hover or choose, never the figures beside it (B3)
          kicker: t("departement.det_detail"),
          title: t("departement.repos_titre"),
          rows: [],
          corr: [],
          links: [],
          foot: "",
        };

    const sans = st.sansCommune;
    const nDocs = ic && ep ? ep.docs : st.docs;
    const secs = this.sections({
      essentiel: true,
      temps: ic ? Y.length > 0 : true,
      avecqui: nC > 0 || sellers.length > 0 || buyers.length > 0 || ventes.length > 0,
      // an intercommunality without a contract or a notice of its own: its documents are its
      // communes' (their fiches, listed above), no section of their own
      documents: ic ? A.length > 0 || aos.length > 0 : nDocs > 0 || A.length > 0 || aos.length > 0,
      sources: true,
    });
    const k = ic ? ("epci" as const) : ("departement" as const);
    return {
      ...this.base("departement"),
      ...this.info("ic", "qui", "an"),
      tete: this.tete(k, nom, ligne),
      band: this.bandeau(k, nom, secs, ic ? [] : this.portes()),
      secs,
      modeDep: !ic,
      modeIc: !!ic,
      lay: {
        inner: wide ? "inner" : "tin",
        tickets: wide ? "tickets" : "tickets t2",
        yb: wide ? "yb" : "yb t",
        yl: wide ? "yl" : "yl t",
        deux: wide ? "deux" : "deux un",
      },
      sources: sources(this.props.couverture, sourcesIds(dep), sellers.length + ventes.length > 0),
      nom,
      dans: N.dans,
      du: ic ? t("departement.de_ic", { nom: epciLa(nom) }) : N.du,
      lead,
      kpis: sansTiret(kpis),
      nIc: fr(IC.filter((o) => o.code).length),
      nCom: fr(nC),
      icNote: [
        t("departement.ic_note"),
        sans ? t("departement.ic_note_sans", { n: sans, du: N.du }) : "",
        t("departement.ic_note_carte"),
      ]
        .filter(Boolean)
        .join(" "),
      icCols,
      ics,
      noCom: nC === 0,
      comCols,
      coms: comsV,
      comCount,
      q: S.q,
      onQ: ((e: { value: string }) => this.setState({ q: e.value })) as Handler,
      showMore: !q && nC > SHOWN,
      filtre: nC > SHOWN,
      noMatch: !!q && filtered.length === 0,
      more: (() => this.setState({ allC: !S.allC })) as Handler,
      moreLabel: S.allC ? t("departement.reduire") : t("departement.les_n_communes", { n: nC }),
      sellers,
      vCols: heads(S.sortV, "sortV"),
      buyers,
      bCols: heads(S.sortB, "sortB"),
      noMoney: !ic && f.stats.vendeurs.length === 0 && f.stats.acheteurs.length === 0,
      ventes,
      conY0,
      enveloppe: t("argent.enveloppe"),
      years,
      yearTypes,
      yearTitre: t(`departement.an_titre_${S.yt}`),
      yearAlt: t("departement.annees_alt", {
        quoi: t(`departement.an_quoi_${S.yt}`),
        dans: N.dans,
        a: yrs[0],
        b: last,
      }),
      anNote,
      achatsAn,
      achatsAlt: Y.length ? t("departement.achats_alt", { de: Y[0].y, a: Y[Y.length - 1].y }) : "",
      docsPhrase: ic
        ? t("departement.ic_docs", { docs: count(nDocs, "document") })
        : t("departement.dep_docs", { docs: count(nDocs, "document"), dans: N.dans }),
      parcourir: ic ? "" : `/registre/?d=${depGroup(dep)}`,
      achatsSous: A.length
        ? t("departement.achats_sous", {
            contrats: count(A.length, "contrat"),
            nom: [...new Set(A.map((a) => nomPropre(a.f)))].join(", "),
          })
        : "",
      docs,
      aos,
      docsMore: A.length > DOCS,
      docsLabel: S.allD
        ? t("departement.reduire")
        : t("departement.les_n_contrats", { n: A.length }),
      togDocs: (() => this.setState({ allD: !S.allD })) as Handler,
      det,
      quitter: this.quitter(),
    };
  }
}

/** A company's name in a buyer's file (a sole trader is never named). */
function buyerEnt(f: FichierAcheteur, s: string): string {
  const L = lexique(f);
  const lk = lienEntreprise(L, s);
  return typeof lk === "object" && "a" in lk ? String(lk.a.text) : typeof lk === "string" ? lk : "";
}

/** The fiche the path asks for: an intercommunality's (`?ic=` a row of the file) or the
 * département's; set by `donnees`, read by the frame right after it (modale.ts) to pick the class
 * and the template. */
let epci = false;

async function donnees(r: Route): Promise<Record<string, unknown>> {
  const dep = r.view === "departement" ? r.dep : "";
  const ic = new URLSearchParams(location.search).get("ic") ?? "";
  const cv = couverture().catch(() => undefined);
  let f: FichierDepartement;
  try {
    f = await load<FichierDepartement>(`departement/${encodeURIComponent(dep)}.json`);
  } catch (e) {
    // a département of the coverage with no document has no file (404; the dev server answers
    // its page instead, not JSON): its page says so all the same
    const couv = await load<Couverture & { departements: Record<string, EtatCollecte> }>(
      "couverture.json",
    );
    const row = couv.departements[dep];
    const absent = e instanceof SyntaxError || /: 404$/.test(String((e as Error).message));
    if (!absent) throw e;
    if (!row) throw new Absent(dep);
    f = vide(dep, couv.maj, row);
  }
  epci = !!epciDe(f, ic);
  // an intercommunality's own purchases: its buyer file (none read: none shown)
  const achats = epci
    ? (
        await Promise.all(
          achatsPropres(f, epciDe(f, ic)).map((s) =>
            load<FichierAcheteur>(`acheteur/${s}.json`).catch(() => null),
          ),
        )
      ).filter((x): x is FichierAcheteur => !!x)
    : [];
  return { dep, f, ic, achats, couverture: await cv };
}

export default {
  // the shell gives every view its route and its data as one record; the class and the template
  // follow the fiche `donnees` found
  get Vue() {
    return (epci ? Intercommunalite : DepartementA) as unknown as VueModule["Vue"];
  },
  get template() {
    return epci ? templateV2 : templateA;
  },
  donnees,
} satisfies VueModule;
