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
import type { Listes } from "../listes.ts";
import type { VueModule } from "../modale.ts";
import { partager } from "../partage.ts";
import { documentHref, type Route } from "../routes.ts";
import { signalerHref } from "../signaler.ts";
import { coupe, montantA, pleinEcran, repli } from "../socle-a.ts";
import { tidy, titleCase } from "../texte.ts";
import type { TypeCle } from "../types.ts";
import { type BaseState, large, type Partage, partageDe, Vue } from "../vue.ts";
import { avantVol, casseNormale, type Publication } from "./accueil-outils.ts";
import {
  argentParAnnee,
  camerasAutorisees,
  fournisseurs,
  grandsSystemes,
  joursDeVol,
  rang,
  type Serie,
  strate,
} from "./commune-a.ts";
import "./commune-a.css";
import template from "./commune.html?raw";

type Props = Extract<Route, { view: "commune" }> & { d: Donnees };
type VueArgent = "tous" | "ville" | "hab";
type Mesure = "cameras" | "eph" | "drones";
type Onglet = "con" | "ao" | "aut" | "sub";
type State = BaseState & {
  X: Listes | null;
  argent: VueArgent;
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
const moisCourt = (d: string): string =>
  new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(
    new Date(`${d}T12:00:00Z`),
  );
const ent = (href: string | null, text: string, cls = "ent"): RichItem =>
  href ? { a: { href, text, cls } } : text;
const nomStrate = (s: number): string => t(`commune_a.strate.${s}`);
const clsSerie = (s: Serie): string =>
  s === "ville" ? "c-ville" : s === "transports" ? "c-transp" : "c-autres";

/** The days an act of the commune's zones covers (its periods, in Paris days), as a drone act's. */
function joursZones(d: Donnees): { t: string; jours: string[] }[] {
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
      return { t: "arrete_drone", jours: [...js] };
    });
}

/** Follows a register link from a handler (the frame's router takes it, hote.ts). */
function aller(href: string): void {
  const a = document.createElement("a");
  a.href = href;
  document.getElementById("registre")?.append(a);
  a.click();
  a.remove();
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
    };
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
    const pop = c.pop ?? 0;
    const maj = f.couverture.maj;
    const s = ess(d);
    const arr = lastArretes(d.all);
    const lus = d.arretes.collectes;
    const X = S.X;
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
      X && nj > 0
        ? rang(
            nj,
            pairs.map(([, v]) => ((v.jv ?? 0) > 0 ? (v.jv ?? 0) : -1)),
          )
        : null;
    const dots = (r: { r: number; n: number } | null) =>
      r && r.n <= 15
        ? Array.from({ length: r.n }, (_, i) => (i + 1 === r.r ? "dot me" : "dot"))
        : null;
    const rk = (r: { r: number; n: number } | null, extra = "") =>
      r
        ? `${t("commune_a.rang", { r: ordinal(r.r), n: fr(r.n), strate: nomStrate(st) })}${extra}`
        : extra.replace(/^ · /, "");
    const nomEpci = f.stats.epci?.nom ?? "";
    const figs = [
      {
        cls: carteN == null ? "fig nl" : "fig",
        k: t("commune_a.fig.cameras"),
        v: carteN == null ? t("liste.non_lu") : fr(carteN),
        u: "",
        l: t("commune_a.fig.cameras_l"),
        dots: dots(rCarte),
        r: rk(rCarte),
        tip: t("commune_a.fig.cameras_tip", { nom }),
        href: "#cameras",
      },
      {
        cls: eph == null ? "fig nl" : "fig",
        k: t("commune_a.fig.argent"),
        v: eph == null ? t("commune_a.fig.argent_aucun") : fr(eph),
        u: eph == null ? "" : t("commune_a.fig.argent_u"),
        l:
          eph == null
            ? t("commune_a.fig.argent_l0")
            : t("commune_a.fig.argent_l", { m: montantA(eur), y: an0 }),
        dots: dots(rEph),
        r: rk(rEph),
        tip: t("commune_a.fig.argent_tip"),
        href: "#argent",
      },
      {
        cls: !lus && !nj ? "fig nl" : "fig",
        k: t("commune_a.fig.drones"),
        v: !lus && !nj ? t("liste.non_lu") : fr(nj),
        u: !lus && !nj ? "" : t("commune_a.fig.jours"),
        l: t("commune_a.fig.drones_l"),
        dots: dots(rJv),
        r: rk(rJv, nAuj ? ` · ${t("commune_a.fig.auj", { n: nAuj })}` : ""),
        tip: t("commune_a.fig.drones_tip", { nom }),
        href: "#drones",
      },
      {
        cls: pubOffres.length ? "fig" : "fig nl",
        k: t("commune_a.fig.concurrence"),
        v: pubOffres.length
          ? t("commune_a.fig.offres_v", {
              n: pubOffres.filter((e) => e.offres === 1).length,
              m: pubOffres.length,
            })
          : t("commune_a.fig.non_publiee"),
        u: "",
        l: pubOffres.length
          ? t("commune_a.fig.offres_l")
          : t("commune_a.fig.non_publiee_l", { n: s.counted.length }),
        dots: null,
        r: uneOffre ? t("commune_a.fig.territoire", { n: uneOffre }) : "",
        tip: t("commune_a.fig.concurrence_tip"),
        href: "#entreprises",
      },
    ];

    // --- the lead -----------------------------------------------------------------------------
    const lead: RichItem[] = [];
    if (eur > 0) {
      lead.push(
        t("commune_a.lead_a", { nom }),
        { strong: montantA(eur) },
        t("commune_a.lead_b", { y: an0 }),
      );
      if (eph != null) lead.push({ strong: t("commune_a.lead_eph", { n: fr(eph) }) });
      if (rEph)
        lead.push(
          t("commune_a.lead_rang", { r: ordinal(rEph.r), n: rEph.n, strate: nomStrate(st) }),
        );
      lead.push(". ");
    }
    if (carteN != null)
      lead.push({ strong: t("commune_a.lead_cam", { n: fr(carteN) }) }, t("commune_a.lead_cam_b"));
    if (nj)
      lead.push(
        t("commune_a.lead_dr_a"),
        { strong: t("commune_a.lead_dr", { n: nj }) },
        t("commune_a.lead_dr_b"),
      );
    lead.push(".");

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
    entree("cameras", `${camN} · ${t("commune_a.toc.cameras")}`);
    // the first year of the decrees read (not the day their collection began)
    const depuis =
      arr
        .map((e) => (e.date ?? "").slice(0, 4))
        .filter(Boolean)
        .sort()[0] ?? "2024";
    const pct = (v: number) => Math.round((100 * v) / Math.max(1, parts.total));
    const cam = {
      n: camN,
      ans: [
        ...(lus && parts.total
          ? [
              t("commune_a.cam_ans_a", { y: depuis }),
              { strong: t("commune_a.cam_ans_n", { n: fr(parts.total) }) },
              t("commune_a.cam_ans_b", { nom }),
            ]
          : [t("commune_a.cam_ans_nl", { nom })]),
        ...(carteN != null ? [t("commune_a.cam_ans_c"), { strong: fr(carteN) }, "."] : []),
      ] as RichItem[],
      kAut: t("commune_a.cam_k", { y: depuis }),
      parts:
        lus && parts.total
          ? (
              [
                ["mairie", "c-ville", parts.mairie],
                ["commerces", "c-comm", parts.commerces],
                ["autres", "c-autres", parts.autres],
              ] as const
            )
              .filter(([, , v]) => v > 0)
              .map(([k, cls, v]) => ({
                cls: `seg ${cls}`,
                sw: `sw ${cls}`,
                st: `flex: ${v}`,
                v: fr(v),
                l: t(`commune_a.part.${k}`),
                tip: `${t(`commune_a.part.${k}`)} : ${fr(v)} · ${pct(v)} %`,
              }))
          : null,
      nonLu: lus ? (parts.total ? "" : t("commune_a.cam_aucun")) : t("commune_a.cam_non_lu"),
      osm: carteN ? fr(carteN) : "",
      osmNon: carteN === 0,
      carteHref: `/?insee=${encodeURIComponent(insee)}`,
      note: t("commune_a.cam_note", { y: depuis }),
      systemes: systemes.length
        ? systemes.map((x) => ({
            nom: [
              x.siren && f.entreprises[x.siren]?.ref ? lienEnt(x.siren) : tidy(titleCase(x.nom)),
            ] as RichItem[],
            n: t("commune_a.arretes_n", { n: x.arretes }),
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
    const pris = vue === "tous" ? territoire : territoire.filter((e) => e.communal);
    const { annees, totaux } = argentParAnnee(pris, serie as never);
    const subs = s.subs.length;
    let arg = null;
    if (territoire.length) {
      const argN = num();
      entree("argent", `${argN} · ${t("commune_a.toc.argent")}`);
      const k = vue === "hab" && pop > 0 ? 1 / pop : 1e-6;
      const tot = (a: (typeof annees)[number]) => (a.ville + a.transports + a.autres) * k;
      const max = Math.max(1e-9, ...annees.map(tot));
      const pas =
        [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200].find((p) => max / p <= 4) ??
        Math.ceil(max / 4);
      const haut = Math.max(pas * Math.ceil(max / pas), pas);
      const y = (v: number) => 226 - (196 * v) / haut;
      const slot = 900 / Math.max(1, annees.length);
      const w = Math.min(70, slot - 24);
      const v1 = (v: number) =>
        vue === "hab"
          ? fr(v)
          : (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(1) : v.toFixed(2)).replace(".", ",");
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
        return {
          an: a.an,
          x: x.toFixed(1),
          w: w.toFixed(1),
          cx: (x + w / 2).toFixed(1),
          hx: (x - 10).toFixed(1),
          hw: (w + 20).toFixed(1),
          vy: (y(tv) - 6).toFixed(1),
          v: tv > 0 ? v1(tv) : "",
          rects,
          survol: (() => this.setState({ col: a.an })) as Handler,
        };
      });
      const col = annees.find((a) => a.an === S.col);
      const ci = col ? annees.indexOf(col) : -1;
      arg = {
        n: argN,
        ans: [
          ...(eur > 0
            ? [
                t("commune_a.arg_ans_a"),
                { strong: montantA(eur) },
                t("commune_a.arg_ans_b", { n: s.counted.length }),
                t("commune_a.arg_ans_y", { y: an0 }),
              ]
            : [t("commune_a.arg_ans_0", { nom })]),
          ...(totaux.transports > 0 && vue === "tous"
            ? [t("commune_a.arg_ans_tr"), { strong: montantA(totaux.transports) }, "."]
            : []),
          " ",
          subs ? t("commune_a.arg_ans_sub", { n: subs }) : t("commune_a.arg_ans_nosub"),
        ] as RichItem[],
        titre: t("commune_a.argent_titre", { nom }),
        vues: (["tous", "ville", "hab"] as const).map((o) => ({
          l: t(`commune_a.argent_vue.${o}`),
          on: vue === o ? "true" : "false",
          pick: (() => this.setState({ argent: o, col: null })) as Handler,
        })),
        grille: [
          ...[1, 2, 3, 4]
            .map((i) => (haut / 4) * i)
            .map((v) => ({
              y: y(v).toFixed(1),
              ty: (y(v) + 4).toFixed(1),
              l: vue === "hab" ? fr(v) : String(Math.round(v * 100) / 100).replace(".", ","),
            })),
          { y: "-20", ty: "20", l: t(vue === "hab" ? "commune_a.unite_hab" : "commune_a.unite_m") },
        ],
        cols,
        quitter: (() => this.setState({ col: null })) as Handler,
        tip:
          col && large()
            ? {
                an: col.an,
                total:
                  vue === "hab"
                    ? t("commune_a.tip_hab", { n: fr(tot(col)) })
                    : montantA(col.ville + col.transports + col.autres),
                rows: (["ville", "transports", "autres"] as const)
                  .filter((s2) => col[s2] > 0)
                  .map((s2) => `${t(`commune_a.serie.${s2}`, { nom })} : ${montantA(col[s2])}`),
                st: `left: ${(((70 + ci * slot + slot / 2) / 1000) * 100).toFixed(1)}%; top: ${((Math.max(40, y(tot(col))) / 270) * 100).toFixed(1)}%`,
              }
            : null,
        leg: [
          ...(["ville", "transports", "autres"] as const)
            .filter((s2) => totaux[s2] > 0 || s2 === "ville")
            .map((s2) => ({
              sw: `sw ${clsSerie(s2)}`,
              l: t(`commune_a.serie.${s2}`, { nom }),
              v: totaux[s2] > 0 ? montantA(totaux[s2]) : t("commune_a.aucun"),
            })),
          {
            sw: "sw c-sub",
            l: t("commune_a.serie.sub"),
            v: subs ? fr(subs) : t("commune_a.aucune_trouvee"),
          },
        ],
      };
    }

    // 3 · companies: those of its own contracts
    const fs = fournisseurs(s.counted);
    let entS = null;
    if (fs.length) {
      const entN = num();
      entree("entreprises", `${entN} · ${t("commune_a.toc.entreprises")}`);
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
          { strong: t("commune_a.ent_ans_n", { n: fs.length }) },
          t("commune_a.ent_ans_a", { y: an0 }),
          ...(fs.length > 1 && part >= 50
            ? [" ", lienEnt(fs[0].siren), t("commune_a.ent_ans_b", { p: part })]
            : []),
        ] as RichItem[],
        r: repli(S.open, "fourn", t("accueil.voir_detail"), top.length, this.basculer),
        rows: top.map((x) => {
          const o = autres(x.siren);
          return {
            nom: [lienEnt(x.siren)] as RichItem[],
            st: `width: ${((100 * x.montant) / max).toFixed(1)}%`,
            m: montantA(x.montant),
            c: `${t("commune_a.ent_c", { n: x.contrats })} · ${x.annees.join(", ")}`,
            o: o == null ? "" : o ? t("commune_a.ent_o", { n: o }) : t("commune_a.ent_o0"),
          };
        }),
        g: {
          titre: t("commune_a.graphe_titre", { nom }),
          nodes: top.map((x, i) => {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / top.length;
            const r = 130;
            const nx = 300 + r * Math.cos(a);
            const ny = 204 + r * Math.sin(a) * 0.9;
            const sz = 12 + 20 * Math.sqrt(x.montant / max);
            const o = autres(x.siren);
            const mx = 300 + (r + 62) * Math.cos(a);
            const my = 204 + (r + 62) * Math.sin(a) * 0.9;
            return {
              x: nx.toFixed(0),
              y: ny.toFixed(0),
              rx: (nx - sz / 2).toFixed(1),
              ry: (ny - sz / 2).toFixed(1),
              s: sz.toFixed(1),
              ty: (ny + (Math.sin(a) > 0.2 ? -sz / 2 - 8 : sz / 2 + 18)).toFixed(0),
              l: nomEnt(x.siren),
              href: f.entreprises[x.siren]?.ref ? `/registre/entreprise/${x.siren}` : "",
              sans: !f.entreprises[x.siren]?.ref,
              mo: o ? `+${o}` : "",
              mx: mx.toFixed(0),
              my: my.toFixed(0),
              mty: (my + 4).toFixed(0),
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
      entree("dossiers", `${dosN} · ${t("commune_a.toc.dossiers")}`);
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
                d: e.date ? jourCourt(e.date) : "",
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
                        e.montant ? t("commune_a.plafond", { m: montantA(e.montant) }) : "",
                        mods ? t("commune_a.modifs", { n: mods }) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "",
              };
            });
          return {
            r: repli(S.open, `dos${i}`, titre, steps.length, this.basculer, "card dos"),
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
      entree("drones", `${drN} · ${t("commune_a.toc.drones")}`);
      // the calendar: twelve months of weeks ending on the update's day, Monday first
      const fin = new Date(`${maj}T12:00:00Z`);
      const debut = new Date(fin);
      debut.setUTCMonth(debut.getUTCMonth() - 12);
      debut.setUTCDate(debut.getUTCDate() - ((debut.getUTCDay() + 6) % 7));
      const cases: { cls: string; x: string; y: string; survol: Handler; pick: Handler }[] = [];
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
        const nb = jours.get(iso) ?? 0;
        cases.push({
          cls: `${nb >= 2 ? "c2" : nb === 1 ? "c1" : "c0"}${iso === maj ? " today" : ""}`,
          x: String(24 + col * 15),
          y: String(16 + wd * 15),
          survol: (() => {
            if (large()) this.setState({ jour: iso });
          }) as Handler,
          pick: (() => {
            if (nb) aller(`${communeHref(insee, "carte")}?jour=${iso}`);
          }) as Handler,
        });
      }
      const W = 24 + (col + 1) * 15;
      const jt = S.jour;
      const motifs = new Map<string, number>();
      let sansMotif = 0;
      for (const e of d.all)
        if (e.t === "arrete_drone") {
          const m = (e as { motif?: { categorie?: string } }).motif?.categorie;
          const kk = ((e.jours as string[] | undefined) ?? []).filter((j) => jours.has(j)).length;
          if (m) motifs.set(m, (motifs.get(m) ?? 0) + kk);
          else sansMotif += kk;
        }
      const mx = Math.max(1, ...motifs.values(), sansMotif);
      const vol = avantVol((f as { drones?: { publication?: Publication } }).drones?.publication);
      const clsV = { avant: "p-ok", jour_meme: "p-mid", apres: "p-late" } as const;
      dr = {
        n: drN,
        ans: [
          t("commune_a.dr_ans_a", { nom }),
          { strong: t("commune_a.lead_dr", { n: nj }) },
          t("commune_a.dr_ans_b"),
          ...(nAuj
            ? [
                " ",
                { strong: t("commune_a.dr_auj", { d: jourCourt(maj) }) },
                t("commune_a.dr_auj_n", { n: nAuj }),
              ]
            : []),
        ] as RichItem[],
        titre: t("commune_a.cal_titre", { nom }),
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
        quitter: (() => this.setState({ jour: null })) as Handler,
        tip:
          jt && large()
            ? {
                d: jourCourt(jt),
                n: t("commune_a.cal_tip", { n: jours.get(jt) ?? 0 }),
                st: `left: ${(((24 + 15 * Math.floor((Date.parse(`${jt}T12:00:00Z`) - debut.getTime()) / 6048e5)) / W) * 100).toFixed(1)}%; top: 10%`,
              }
            : null,
        auj: nAuj
          ? auj.map((e) => ({
              d: jourCourt(maj),
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
                  cls: "hb",
                  l: t(`commune_a.motif.${m}`),
                  st: `width: ${((100 * v) / mx).toFixed(0)}%`,
                  n: fr(v),
                })),
              ...(sansMotif
                ? [
                    {
                      cls: "hb q",
                      l: t("commune_a.motif_non_lu"),
                      st: `width: ${((100 * sansMotif) / mx).toFixed(0)}%`,
                      n: fr(sansMotif),
                    },
                  ]
                : []),
            ]
          : null,
        motifsNonLu: !motifs.size,
        vol: vol.nonLu
          ? { lu: false, nonLu: true, parts: [], note: "" }
          : {
              lu: true,
              nonLu: false,
              parts: vol.parts.map((x) => ({
                cls: `seg ${clsV[x.k]}`,
                st: `flex: ${Math.max(1, x.pct)}`,
                l: x.pct >= 8 ? fr(x.n) : "",
                sw: `sw ${clsV[x.k]}`,
                leg: `${t(`accueil.vol_${x.k}`)} · ${fr(x.n)}`,
              })),
              note: t("commune_a.publies_note", { n: fr(vol.total), p: vol.parts[2]?.pct ?? 0 }),
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
            : t("commune_a.jours_n", { n: fr(v) });
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
      const autour = (rows: { k: string; v: number }[], nb: number) => {
        const i = rows.findIndex((x) => x.k === insee);
        const lo = Math.max(0, Math.min(i - 2, rows.length - nb));
        return (i < 0 ? rows.slice(0, nb) : rows.slice(lo, lo + nb)).map((x) => ({
          cls: x.k === insee ? "me" : "",
          nom: lien(x.k, X?.dico.communes[x.k]?.nom ?? x.k),
          v: fmt(x.v),
        }));
      };
      const ep = classe(membres);
      const sr = classe(pairs.map(([k]) => k));
      const iE = ep.findIndex((x) => x.k === insee);
      const ml = t(`commune_a.mesure_l.${m}`);
      if (X && (ep.length > 1 || sr.length > 1)) {
        n++;
        entree("voisines", `${vN} · ${t("commune_a.toc.voisines")}`);
        vois = {
          n: vN,
          ans:
            iE >= 0 && ep.length > 1
              ? ([
                  t("commune_a.vois_ans", {
                    nom,
                    epci: nomEpci,
                    r: ordinal(iE + 1),
                    n: ep.length,
                    m: ml,
                  }),
                ] as RichItem[])
              : ([t("commune_a.vois_ans_strate", { nom, strate: nomStrate(st) })] as RichItem[]),
          mesures: (["cameras", "eph", "drones"] as const).map((o) => ({
            l: t(`commune_a.mesure.${o}`),
            on: m === o ? "true" : "false",
            pick: (() => this.setState({ mesure: o })) as Handler,
          })),
          epci:
            ep.length > 1
              ? {
                  titre: t("commune_a.vois_epci", { epci: nomEpci, m: ml }),
                  rows: autour(ep, 8),
                  note: t("commune_a.vois_epci_note", { n: membres.length, k: ep.length }),
                }
              : null,
          strate:
            sr.length > 1
              ? {
                  titre: t("commune_a.vois_strate", { strate: nomStrate(st), m: ml }),
                  rows: autour(sr, 5),
                }
              : null,
          attente: "",
        };
      } else if (!X) {
        vois = {
          n: vN,
          ans: [] as RichItem[],
          mesures: [],
          epci: null,
          strate: null,
          attente: t("commune_a.vois_attente"),
        };
      }
    }

    // documents: the four kinds, ten rows of the one chosen, the full list one page away
    const tabs: { k: Onglet; f: (e: Evenement) => boolean }[] = [
      // the commune's own contracts (board: « Contrats · 8 » for Lyon), as its own notices
      { k: "con", f: (e) => e.t === "attribution" && !e.copie && !!e.communal },
      { k: "ao", f: (e) => /^(avis|resultat|rectificatif)$/.test(e.t) },
      { k: "aut", f: (e) => e.t.startsWith("arrete") },
      { k: "sub", f: (e) => e.t.startsWith("subvention") },
    ];
    const ong = tabs.find((x) => x.k === S.onglet) ?? tabs[0];
    const docRows = d.all.filter(ong.f).sort(byDateDesc);
    const aut = ong.k === "aut";
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
        pick: (() => this.setState({ onglet: x.k })) as Handler,
      })),
      col3: t(aut ? "commune_a.col_beneficiaire" : "commune_a.col_entreprise"),
      col4: t(aut ? "commune_a.col_cameras" : "commune_a.col_montant"),
      rows: docRows.slice(0, 10).map((e) => ({
        d: e.date ? jourCourt(e.date) : "",
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
                { a: { href: documentHref(e.affaire), text: t("commune_a.dossier") } },
              ] as RichItem[])
            : (["—"] as RichItem[]),
      })),
      vide: !docRows.length,
      plus: docRows.length > 10 ? t("commune_a.documents_plus", { n: fr(docRows.length) }) : "",
      tout: communeHref(insee, "documents"),
    };
    const srcRows = [
      { cls: "ok", l: t("accueil.src.contrats"), d: t("commune_a.src.contrats") },
      { cls: "ok", l: t("accueil.src.ao"), d: t("commune_a.src.ao") },
      {
        cls: lus ? "part" : "non",
        l: t("commune_a.src.arretes"),
        d: lus ? t("commune_a.src.arretes_d", { y: depuis }) : t("liste.non_lu"),
      },
      { cls: "part", l: t("accueil.src.subventions"), d: t("commune_a.src.subventions") },
      { cls: "ok", l: t("accueil.src.carte"), d: t("accueil.src.carte_d") },
    ];
    toc.push({
      href: "#documents",
      l: t("commune_a.toc.documents"),
      cls: "",
      go: this.allerSection,
    });
    toc.push({ href: "#sources", l: t("commune_a.toc.sources"), cls: "", go: this.allerSection });
    toc.push({
      href: communeHref(insee, "carte"),
      l: t("commune_a.toc.vue3d"),
      cls: "t3d",
      go: (() => {}) as Handler,
    });

    return {
      ...this.base("commune-a"),
      nom,
      letters: coupe(nom),
      chips: [
        { l: `${depNom} (${c.dep})`, href: departementHref(c.dep) },
        ...(nomEpci && c.epci_ref ? [{ l: nomEpci, href: `/registre/${c.epci_ref}` }] : []),
      ],
      meta: [
        ...(pop ? [t("commune_a.habitants", { n: fr(pop) })] : []),
        t("commune_a.insee", { insee }),
        ...(f.couverture.departement.dernier_recueil
          ? [t("commune_a.collecte", { d: jourCourt(f.couverture.departement.dernier_recueil) })]
          : []),
      ],
      lead,
      partager: ((ev) => partager(this, ev.currentTarget)) as Handler,
      citer: this.citer,
      citerL: t(S.cite ? "commune_a.cite" : "commune_a.citer"),
      figs,
      v3: {
        titre: t("commune_a.v3_titre", { nom }),
        items: [
          {
            b: t("commune_a.v3_cameras"),
            s:
              carteN != null
                ? t("commune_a.v3_cameras_s", { n: fr(carteN) })
                : t("commune_a.v3_cameras_s0"),
          },
          {
            b: t("commune_a.v3_drones"),
            s: nAuj ? t("commune_a.v3_drones_auj", { n: nAuj }) : t("commune_a.v3_drones_s"),
          },
        ],
        href: communeHref(insee, "carte"),
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
