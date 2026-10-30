// View 3 · Commune (/registre/commune/<insee>; R1's mockup Commune-grand for the content, the v2
// skeleton of V2-Entreprise for the frame). One fiche per collectivité, its territory and its
// purchases together: the head (its type, its name, its identity line), the band (its sections,
// « Carte et drones », « Partager »), then L'essentiel, Dans le temps, Avec qui, Documents, Sources.
// The figures are the build's (commune/<insee>.json, its flags read through commun.ts): the
// sentences the mockup wrote for Mions are rules, each one hidden where it does not hold. Every
// sentence that holds a figure in bold or a link is a Rich value, never markup; every mention that
// has its fiche is a typed link (liens.ts). R1's tilted map is gone: a link opens « Carte et
// drones », or the commune on the site's map.

import { etatDepartement } from "../collecte.ts";
import {
  benefLabel,
  byDateAsc,
  commune,
  communeHref,
  type Donnees,
  depArt,
  ess,
  isCam,
  isDrone,
  tete,
} from "../commun.ts";
import { docHref } from "../corpus.ts";
import type { Handler, Rich, RichItem } from "../dc.ts";
import type { Affaire, Couverture, Evenement, Stats } from "../donnees.ts";
import { EI } from "../donnees.ts";
import {
  addMonths,
  count,
  docDate,
  fr,
  longDate,
  longMonth,
  money,
  shortDate,
  shortMonth,
} from "../format.ts";
import { has, t } from "../i18n.ts";
import {
  lien,
  lienAcheteur,
  lienCommune,
  lienDepartement,
  lienDocument,
  lienEntreprise,
} from "../liens.ts";
import type { VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { signaler } from "../signaler.ts";
import { type Source, sources } from "../sources.ts";
import { calm, capital, proper, sentence } from "../texte.ts";
import { couleur, icone, type TypeCle, typeDocument } from "../types.ts";
import { type BaseState, large, type Partage, partageDe, Vue } from "../vue.ts";
import "./commune.css";
import template from "./commune.html?raw";
import {
  demander,
  epciHref,
  lexique,
  liensBande,
  ligneCommune,
  quiDocument,
  titreDocument,
  typeLabel,
} from "./commune-outils.ts";
import { enLigne } from "./departement-outils.ts";

const TODAY = new Date().toISOString().slice(0, 10);
const ELUS = "https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1";
const NBSP = "\u00a0";
/** At most this many bars carry their value written; beyond, the tooltip and the panel (v2 § 8). */
const ECRITES = 12;

// The subsidy sources by département (couverture.json's rows carry no département):
// rule:registre_couverture@1:source_subventions_region_idf (Île-de-France),
// rule:registre_couverture@1:source_subventions_region_sud (the Bouches-du-Rhône),
// rule:registre_couverture@1:source_subventions_etat_<dep> (a préfecture's DETR list).
const IDF = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
const regionSource = (dep: string) =>
  IDF.has(dep) ? "subventions_region_idf" : dep === "13" ? "subventions_region_sud" : null;

// --- helpers -------------------------------------------------------------------------------------
const ym = (d: string) => +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1);
const year = (e: Evenement) => (e.date ?? "").slice(0, 4);
/** « 30/06/2031 » (the mockup's « À surveiller »). */
const numDate = (d: string) => d.split("-").reverse().join("/");
/** « 6 mars », « 1er oct. ». */
const dayMonth = (d: string) => {
  const day = +d.slice(8, 10);
  return `${day === 1 ? t("format.premier") : day}${NBSP}${shortDate(d).split(NBSP)[1]}`;
};
const strong = (s: Rich): RichItem => ({ strong: s });
/** The number in words up to twelve (« Trois arrêtés en sept mois »), in figures above. */
const words = (n: number) => t("commune.nombres").split(",")[n] ?? fr(n);
const dossierNo = (id: string) => {
  const n = String(id).split("-").slice(1).join("-");
  return /^\d{8}$/.test(n) ? `${n.slice(0, 4)}-${n.slice(4)}` : n;
};
/** An amount on a bar, as Entreprise writes them: « 5,2 M€ », below 100 000 € in euros. */
const meur = (n: number): string =>
  !n ? "—" : n < 1e5 ? money(n) : t("format.meur", { n: (n / 1e6).toFixed(1).replace(".", ",") });
/** A document type's pictogram and colour, as a template's `.mini` reads them. */
const picto = (k: TypeCle) => ({ c: `--c: ${couleur(k)}`, i: icone(k) });
const affHref = (id: string) => `/registre/contrat/${encodeURIComponent(id)}`;

/** A catalogue message whose placeholders may be rich (bold, a link): the message is the
 * catalogue's, the rich parts are put back in place of their placeholder. */
type Param = string | number | Exclude<RichItem, string>;
function rt(key: string, params: Record<string, Param> = {}): RichItem[] {
  const holes: RichItem[] = [];
  const flat: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "object") {
      flat[k] = `${holes.length}`;
      holes.push(v);
    } else flat[k] = v;
  }
  return t(key, flat)
    .split(/(\d+)/)
    .map((x, i) => (i % 2 ? holes[Number(x)] : x))
    .filter((x) => x !== "");
}
const join = (...parts: (RichItem[] | null | false | undefined)[]): RichItem[] =>
  parts.filter((p): p is RichItem[] => !!p).flatMap((p, i) => (i ? [" ", ...p] : p));

/** A row's attributes under v2.1's contract (vue.ts `ligne`): its class, `aria-selected`, its
 * type's colour, hovered (shown) and chosen. */
type Row = { cls: string; sel: string; c: string; hover: Handler; pick: Handler };
type Sel = (k: string, type?: TypeCle, cls?: string) => Row;

type Det = {
  kicker: string;
  title: string;
  rows: [string, string][];
  note?: string;
  links?: { l: string; href: string }[];
};
type Contrat = Evenement & { lots?: Evenement[]; copies?: number; dl: string };
type Aff = Affaire & { id: string };
type Mandat = { mandat: string; premier_tour: string; second_tour: string };

/** What the page computes once from the commune's file. */
type Prep = {
  d: Donnees;
  s: ReturnType<typeof ess>;
  insee: string;
  nom: string;
  dep: string;
  pop: number;
  cs: Contrat[];
  counted: Contrat[];
  y0: string;
  total: number;
  aos: Aff[];
  main: Aff | null;
  mainActs: Evenement[];
  aosPending: Aff[];
  n: number | null;
  pub: number | null;
  collectes: boolean;
};

function prepare(d: Donnees): Prep {
  const s = ess(d);
  const c = d.f.commune;
  const insee = d.insee;
  const ev = (id: string) => d.ev.get(id);
  const affs: Aff[] = Object.entries(d.f.affaires).map(([id, a]) => ({ ...a, id }));
  // the contracts: a copy once, the lots of one procedure in one row, placed at the reviewed date
  const cs = d
    .mergeLots(s.contrats.filter((e) => !e.copie))
    .map((e) => ({ ...e, dl: d.dateLue(e) }))
    .sort((a, b) => a.dl.localeCompare(b.dl));
  const counted = cs.filter((e) => e.compte);
  const y0 = (counted[0] ?? cs[0])?.dl.slice(0, 4) ?? "";
  const aos = affs
    .filter(
      (a) =>
        a.insee === insee &&
        a.kind === "contrat_non_retrouve" &&
        // a notice the export left undated cannot be placed in time (the CI extract keeps no `debut`)
        typeof a.debut === "string" &&
        a.events.some((i) => ev(i)?.t === "avis"),
    )
    .sort((a, b) => String(a.debut).localeCompare(String(b.debut)));
  const main = s.com[0] ? (affs.find((a) => a.id === s.com[0].affaire) ?? null) : null;
  const mainActs = main
    ? main.events
        .map(ev)
        .filter((e): e is Evenement => !!e && e.cameras != null)
        .sort(byDateAsc)
    : [];
  const since = addMonths(TODAY, -18);
  const aosPending = aos.filter((a) => !a.contrat_probable && String(a.debut) >= since);
  return {
    d,
    s,
    insee,
    nom: c.nom,
    dep: c.dep,
    pop: c.pop ?? 0,
    cs,
    counted,
    y0,
    total: s.eur,
    aos,
    main,
    mainActs,
    aosPending,
    n: d.f.carte.n ?? null,
    pub: d.f.carte.pub ?? null,
    collectes: d.arretes.collectes,
  };
}

type Props = Extract<Route, { view: "commune" }> & { d: Donnees };
type State = BaseState & { allVois: boolean };

export class Commune extends Vue<Props, State> {
  private p?: Prep;

  protected init(): Partial<State> {
    return { allVois: false };
  }
  titre(): string {
    return this.props.d.f.commune.nom;
  }
  type() {
    return "commune" as const;
  }
  partage(): Partage | null {
    return partageDe(this.titre(), this.props.d.f.partage);
  }
  private get prep(): Prep {
    this.p ??= prepare(this.props.d);
    return this.p;
  }
  private get L() {
    return lexique(this.props.d);
  }

  // --- the page ----------------------------------------------------------------------------------
  renderVals() {
    const S = this.state;
    const P = this.prep;
    const { d, s, insee, nom, dep, n, pub, counted, cs, y0, total } = P;
    const sel: Sel = (k, type, cls) => this.ligne(k, type, cls);
    const DET: Record<string, Det> = {};
    const docs = communeHref(insee, "documents");
    const auts = communeHref(insee, "autorisations");

    // the lead (one sentence) and the four figures
    let lead: RichItem[];
    const carteSentence = () =>
      n == null
        ? null
        : n
          ? rt("commune.lead_carte_connait", { n: strong(count(n, "camera")) })
          : rt("commune.lead_carte_aucune");
    if (s.camAut && s.complet) {
      const qui =
        s.com[0].type_beneficiaire === "epci"
          ? t("commune.lead_qui_epci")
          : t("commune.lead_qui_mairie", { nom });
      lead = join(
        rt("commune.lead_aut", {
          mois: longMonth(s.dateAut ?? ""),
          cam: strong(count(s.camAut, "camera")),
          qui,
        }),
        s.vpAut != null && rt("commune.lead_rue", { n: strong(fr(s.vpAut)), v: s.vpAut }),
        n != null &&
          (n === 0
            ? rt("commune.lead_carte_aucune_en")
            : rt(n < s.camAut ? "commune.lead_carte_que" : "commune.lead_carte_en", {
                n: strong(fr(n)),
              })),
      );
    } else if (s.camAut)
      lead = rt("commune.lead_dossiers", {
        depuis: longMonth(d.arretes.depuis ?? s.dateAut ?? ""),
        dossiers: count(s.com.length, "dossier"),
        cam: strong(count(s.camAut, "camera")),
      });
    else if (counted.length)
      lead = join(
        rt("commune.lead_contrats", {
          y0,
          nom,
          n: strong(count(counted.length, "contrat")),
          eur: strong(money(total)),
        }),
        carteSentence(),
      );
    else if (s.all.length)
      lead = join(rt("commune.lead_documents", { n: s.all.length, nom }), carteSentence());
    else lead = rt("commune.lead_aucun", { nom });
    if (!P.collectes)
      lead = join(
        lead,
        rt(dep === "75" ? "commune.lead_arretes_paris" : "commune.lead_arretes_non_collectes"),
      );

    const kpis = [
      s.camAut
        ? { v: fr(s.camAut), l: t("commune.kpi_aut_mairie", { n: s.camAut }) }
        : { v: fr(cs.length), l: t("commune.kpi_contrats_signes", { n: cs.length }) },
      { v: n == null ? "—" : fr(n), l: t("commune.kpi_carte", { n: n ?? 0 }) },
      counted.length
        ? { v: money(total), l: t("commune.kpi_depuis", { y0 }) }
        : { v: "—", l: t("commune.kpi_aucun_contrat") },
      { v: fr(s.all.length), l: t("commune.kpi_documents", { n: s.all.length }) },
    ];
    // in place of R1's tilted map: « Drones et algorithmes » (v2.1 A5: no link to the site's map,
    // nor the frame that carried it)
    const carteLiens: RichItem[] = [
      lien("commune", communeHref(insee, "carte"), t("commune.carte_et_drones")),
    ];

    // « Où sont les N autres ? » (10th pass: the public cameras of the map only)
    const ou: Record<string, unknown> = {
      show: !!(s.complet && s.vpAut != null && pub != null && pub < s.vpAut),
    };
    if (ou.show && s.vpAut != null && pub != null)
      Object.assign(ou, {
        k: s.vpAut - pub,
        vp: s.vpAut,
        pub,
        note: t("commune.ou_note", { vp: s.vpAut, pub, k: s.vpAut - pub, n: n ?? 0, nom }),
        demander: (() =>
          demander(
            t("commune.demande_objet_liste", {
              nom,
              date: longDate(s.dateAut ?? ""),
            }),
            "mairie",
            nom,
            dep,
          )) as Handler,
      });

    const aut = this.autorise(DET, sel);
    const prv = this.prives(DET, sel);
    const arg = this.argent(DET, sel);
    const chrono = this.chrono(DET, sel);
    const ter = this.territoires(DET, sel);
    const ents = this.entreprises(DET, sel);
    const docsL = this.documents(DET, sel);
    const drones = this.drones();

    // to watch, and the documents to ask for
    const veille: { k: string; w: string; t: RichItem[] }[] = [];
    for (const a of P.aosPending)
      veille.push({
        k: "0",
        w: t("commune.veille_bientot"),
        t: [
          strong(t("commune.veille_signer", { nom })),
          " ",
          ...rt("commune.veille_signer_texte", { mois: longMonth(String(a.debut)) }),
        ],
      });
    for (const e of cs) {
      const end = e.duree ? addMonths(e.dl, Number(e.duree)) : null;
      if (end && end >= TODAY)
        veille.push({
          k: end,
          w: shortMonth(end),
          t: rt("commune.veille_fin_contrat", {
            contrat: lienDocument(
              this.L,
              e,
              t("commune.veille_contrat_de", { y: e.dl.slice(0, 4) }),
            ),
            ent: e.entreprises?.length
              ? this.entA(e.entreprises[0])
              : t("commune.entreprise_non_publiee_une"),
            mois: Number(e.duree),
          }),
        });
    }
    // the mairie's authorisations that end: one row (a big city has dozens of dossiers)
    const ends = s.com
      .map((e) => d.affaire(e.affaire)?.echeance ?? "")
      .filter((x) => x >= TODAY)
      .sort();
    if (ends.length)
      veille.push({
        k: ends[0],
        w: numDate(ends[0]),
        t: [
          ends.length > 1
            ? t("commune.veille_fin_autorisations", {
                n: ends.length,
                date: numDate(ends[ends.length - 1]),
              })
            : t("commune.veille_fin_autorisation"),
        ],
      });
    veille.sort((a, b) => a.k.localeCompare(b.k));
    const introuvables = this.manquants()
      .slice(0, 2)
      .map(([q, qui, objet]) => ({
        q,
        l: t(qui === "mairie" ? "commune.demander_mairie" : "commune.demander_prefecture"),
        act: (() => demander(objet, qui, nom, dep)) as Handler,
      }));

    // at rest the panel says only what to hover or choose, never the figures beside it (B3)
    // the panel: the row hovered or focused, else the one chosen (A3)
    const vu = this.affiche();
    const d0 = vu ? DET[vu] : undefined;
    const det = d0
      ? {
          kicker: d0.kicker,
          title: d0.title,
          rows: d0.rows.map(([k, v]) => ({ k, v })),
          note: d0.note ?? "",
          links: d0.links ?? [],
          hint: t("commune.panneau_aide"),
        }
      : {
          kicker: t("commune.det_detail"),
          title: t("commune.det_survolez"),
          rows: [],
          note: "",
          links: [],
          hint: "",
        };
    const com = tete(d, "ess");
    const secs = this.sections({
      essentiel: true,
      temps: arg.years.length > 0 || chrono.length > 0 || veille.length > 0 || drones.show,
      avecqui: true,
      documents: s.all.length > 0 || introuvables.length > 0,
      sources: true,
    });
    const band = this.bandeau("commune", nom, secs);
    const wide = large();
    const nArr = s.all.filter((e) => e.t.startsWith("arrete")).length;
    return {
      ...this.base("commune"),
      ...this.info("arg", "met", "ou"),
      tete: this.tete("commune", nom, ligneCommune(d)),
      band: { ...band, secs: liensBande(band.secs, insee, true) },
      secs,
      lay: {
        inner: wide ? "inner" : "tin",
        tickets: wide ? "tickets" : "tickets t2",
        deux: wide ? "deux" : "deux un",
        yb: wide ? "yb" : "yb t",
        yl: wide ? "yl" : "yl t",
      },
      com,
      lead,
      kpis,
      carteLiens,
      ou,
      aut,
      arr: aut.arr,
      prv,
      priv: prv.priv,
      arg,
      years: arg.years,
      ctr: arg.ctr,
      aoL: arg.aoL,
      chrono,
      drones,
      ter,
      terr: ter.terr,
      vois: S.allVois ? ter.vois : ter.vois.slice(0, 12),
      voisMore: ter.vois.length > 12,
      voisLabel: S.allVois
        ? t("entreprise.reduire")
        : t("commune.vois_toutes", { n: ter.vois.length }),
      togVois: (() => this.setState({ allVois: !S.allVois })) as Handler,
      ents,
      veille,
      introuvables,
      // the most recent; all of them, filtered, on the Documents page
      docsL: docsL.slice(0, 8),
      docsPhrase: t(s.all.length > 8 ? "commune.docs_phrase" : "commune.docs_tous", {
        n: s.all.length,
      }),
      tous: [
        lien("commune", docs, t("commune.tous_documents", { n: s.all.length })),
        lien("commune", auts, t("commune.toutes_autorisations", { n: nArr })),
      ],
      sources: this.sources(),
      maj: t("commune.maj", { date: longDate(d.f.couverture.maj) }),
      signalerPhrase: [
        t("commune.signaler_phrase"),
        " ",
        lien("commune", docs, t("commune.signaler_lien")),
      ] as RichItem[],
      det,
      quitter: this.quitter(),
      nDocs: s.all.length,
      lien: {
        dossier: P.main
          ? communeHref(insee, `autorisations/${encodeURIComponent(P.main.id)}`)
          : auts,
        prives: `${docs}?qui=p,n&t=aut`,
        documents: docs,
      },
    };
  }

  /** A company's name, a link to its fiche (a sole trader, its words only). */
  private entA(siren: string): RichItem {
    return lienEntreprise(this.L, siren, this.prep.d.entName(siren));
  }

  /** What the préfecture authorises: the last act of the mairie's main dossier. */
  private autorise(DET: Record<string, Det>, sel: Sel) {
    const { d, s, insee, mainActs, main } = this.prep;
    if (!s.com.length) return { show: false, arr: [] as unknown[] };
    const last = s.com[0];
    const a = d.affaire(last.affaire);
    const src = a?.echeance_source ? d.ev.get(String(a.echeance_source)) : undefined;
    const lastId = a?.events[a.events.length - 1];
    const items = [
      last.videoverbalisation
        ? { a: t("commune.aut_vv"), b: t("commune.aut_vv_texte") }
        : { a: t("commune.aut_vv_non"), b: t("commune.non_mentionnee") },
      last.deport_forces
        ? { a: t("commune.aut_deport"), b: t("commune.aut_deport_texte") }
        : { a: t("commune.aut_deport_non"), b: t("commune.non_mentionnee") },
      a?.echeance
        ? {
            a: t("commune.aut_jusqu", { date: longDate(a.echeance) }),
            b: t(src?.date && src.id !== lastId ? "commune.aut_duree_du" : "commune.aut_duree", {
              date: numDate(src?.date ?? ""),
            }),
          }
        : { a: t("commune.aut_fin"), b: t("commune.aut_fin_non") },
    ];
    const acts = mainActs.slice(-4);
    const k = acts.length;
    const mo = k > 1 ? ym(acts[k - 1].date ?? "") - ym(acts[0].date ?? "") : 0;
    const h3 =
      k > 1
        ? capital(t(mo ? "commune.aut_h3" : "commune.aut_h3_mois", { k: words(k), mo: words(mo) }))
        : t("commune.aut_h3_un");
    const arr = acts.map((e) => {
      const key = `a${e.id}`;
      DET[key] = {
        kicker: t("commune.arrete_kicker", { date: shortDate(e.date) }),
        title: t("commune.arrete_titre", { n: e.cameras ?? 0 }),
        rows: [
          [
            t("commune.arrete_vp"),
            e.cameras_vp != null ? fr(e.cameras_vp) : t("commune.non_precise"),
          ],
          [t("commune.arrete_int"), e.cameras_int != null ? fr(e.cameras_int) : "—"],
          [t("commune.arrete_ext"), e.cameras_ext != null ? fr(e.cameras_ext) : "—"],
          [t("commune.arrete_duree"), e.duree || t("commune.non_precisee")],
          [t("commune.arrete_ref"), t("commune.arrete_acte", { id: e.id })],
        ],
        links: [
          {
            l: t("commune.historique_autorisation"),
            href: communeHref(insee, `autorisations/${encodeURIComponent(e.affaire)}`),
          },
          ...(e.url ? [{ l: t("arretes.voir"), href: e.url }] : []),
          signaler(e),
        ],
      };
      return {
        n: fr(e.cameras ?? 0),
        d: shortDate(e.date),
        label: t("commune.arrete_cellule", { date: shortDate(e.date), n: e.cameras ?? 0 }),
        ...sel(key, "aut", "cell"),
      };
    });
    const pts = ((main?.cameras ?? []) as { n: number | null; groupe?: boolean }[])
      .filter((p) => p.n != null && !p.groupe)
      .map((p) => fr(p.n ?? 0));
    const seq = pts.length > 5 ? [pts[0], "…", pts[pts.length - 1]] : pts;
    return {
      show: true,
      items,
      h3,
      n: Math.max(1, k),
      cols: `grid-template-columns: repeat(${Math.max(1, k)}, minmax(0, 1fr))`,
      arr,
      hist: lien(
        "aut",
        main ? communeHref(insee, `autorisations/${encodeURIComponent(main.id)}`) : null,
        pts.length > 1
          ? t("commune.historique_suite", { suite: seq.join(" → ") })
          : t("commune.historique_autorisation"),
      ),
    };
  }

  /** « Aussi à <commune> »: the shops' and companies' cameras (the last act of each dossier). */
  private prives(DET: Record<string, Det>, sel: Sel) {
    const { s, nom, insee } = this.prep;
    const base = { show: s.prv.length > 0, ...sel("prv", "aut", "prv") };
    if (!base.show) return { ...base, priv: [] as unknown[] };
    const ncam = s.prv.reduce((x, e) => x + (e.cameras ?? 0), 0);
    const kind = (e: Evenement) =>
      /pharmacie/i.test(e.beneficiaire ?? "")
        ? "pharmacie"
        : ["banque", "commerce", "entreprise"].includes(e.type_beneficiaire ?? "")
          ? (e.type_beneficiaire as string)
          : "";
    const late = (k: string) => (k === "commerce" || k === "entreprise" ? 1 : 0);
    const kinds = [...new Set(s.prv.map(kind))]
      .filter(Boolean)
      .sort((a, b) => late(a) - late(b))
      .map((k) => t(`commune.type_${k}`));
    const who = (e: Evenement) => proper(benefLabel(e));
    const byK = new Map<string, { n: number; a: number }>();
    for (const e of s.prv) {
      const x = byK.get(who(e)) ?? { n: 0, a: 0 };
      x.n += e.cameras ?? 0;
      x.a++;
      byK.set(who(e), x);
    }
    const href = `${communeHref(insee, "documents")}?qui=p,n&t=aut`;
    DET.prv = {
      kicker: t("commune.prv_kicker", { ans: [...new Set(s.prv.map(year))].sort().join(", ") }),
      title: `${count(ncam, "camera")}, ${count(s.prv.length, "arrete")}`,
      rows: [...byK.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 5)
        .map(([k, x]) => [
          x.a > 1 ? t("commune.prv_ligne", { qui: k, n: x.a }) : k,
          count(x.n, "camera"),
        ]),
      links: [{ l: t("commune.les_voir_dans_les_documents"), href }],
    };
    return {
      ...base,
      cam: count(ncam, "camera"),
      arr: count(s.prv.length, "arrete"),
      kinds: kinds.length ? ` (${kinds.slice(0, 2).join(", ")}${kinds.length > 2 ? "…" : ""})` : "",
      priv: s.prv
        .slice()
        .sort(byDateAsc)
        .slice(-6)
        .map((e) => ({
          d: lienDocument(this.L, e, shortDate(e.date)),
          who: who(e),
          n: fr(e.cameras ?? 0),
        })),
      voir: lien("commune", href, t("commune.les_voir_dans_les_documents")),
      nom,
    };
  }

  /** The money (L'essentiel), the contracts by year and each one's run (Dans le temps). R1's
   * frieze of contracts and calls for tenders, in lanes, is gone (v2 § 8): one measure by year on
   * an axis from zero, and the same facts as lists. */
  private argent(DET: Record<string, Det>, sel: Sel) {
    const { d, s, insee, cs, counted, y0, total, pop, dep, aos } = this.prep;
    const L = this.L;
    const ents = [...new Set(counted.flatMap((e) => e.entreprises ?? []))];
    const hors = (e: Evenement) =>
      e.national && !e.hors_totaux
        ? t("commune.hors_national")
        : e.hors_totaux && has(`registre.commune.hors_${e.hors_totaux}`)
          ? t(`commune.hors_${e.hors_totaux}`)
          : "";
    let phrase: RichItem[];
    if (counted.length) {
      phrase = rt("commune.arg_depuis", { y0 });
      if (pop)
        phrase.push(
          ...rt("commune.arg_habitant", {
            eur: strong(t("commune.arg_habitant_eur", { eur: money(Math.round(total / pop)) })),
          }),
        );
      if (ents.length === 1)
        phrase.push(
          ...rt("commune.arg_une_entreprise", {
            une: strong(t("commune.arg_une_seule")),
            ent: this.entA(ents[0]),
          }),
        );
      else if (ents.length) {
        const list: RichItem[] = ents
          .slice(0, 4)
          .flatMap((x, i) => (i ? [", ", this.entA(x)] : [this.entA(x)]));
        if (ents.length > 4) list.push(t("commune.et_autres", { n: ents.length - 4 }));
        phrase.push(
          ...rt("commune.arg_entreprises", {
            n: strong(count(ents.length, "entreprise")),
          }),
          ...list,
        );
      }
    } else if (cs.length) {
      const raisons = [...new Set(cs.map(hors))].filter(Boolean).join(", ");
      phrase = raisons
        ? rt("commune.arg_aucun_compte", { raisons })
        : rt("commune.arg_aucun_compte_seul");
    } else phrase = rt("commune.arg_aucun");

    const srcs = new Set(d.f.couverture.sources.map((x) => x.id));
    const rs = regionSource(dep);
    const region = !!rs && srcs.has(rs);
    const etat = srcs.has(`subventions_etat_${dep}`);
    const couv =
      !region && etat
        ? t(
            has(`registre.commune.couv_region_${dep}`)
              ? `commune.couv_region_${dep}`
              : "commune.couv_region",
          )
        : region && !etat
          ? t("commune.couv_etat")
          : "";

    const endOf = (e: Contrat) => (e.duree ? addMonths(e.dl, Number(e.duree)) : null);
    const flagged = (e: Evenement) => !!e.date_lue && e.date_lue !== e.date;
    const names = (e: Evenement) =>
      e.entreprises?.length
        ? e.entreprises.map((x) => d.entName(x)).join(", ")
        : t("commune.entreprise_non_publiee");
    const who = (e: Evenement): RichItem[] =>
      e.entreprises?.length
        ? e.entreprises.flatMap((x, i) => (i ? [", ", this.entA(x)] : [this.entA(x)]))
        : [t("commune.entreprise_non_publiee")];
    const cDet = (e: Contrat, k: string) => {
      const end = endOf(e);
      const mods = d.f.evenements.filter((x) => x.affaire === e.affaire && x.t === "modification");
      const lastMod = mods[mods.length - 1];
      DET[k] = {
        kicker: t("commune.contrat_kicker", {
          date: flagged(e) ? `${shortMonth(e.dl)} ?` : shortDate(e.dl),
        }),
        title: names(e),
        rows: [
          [
            t("commune.contrat_objet"),
            d.f.libelles[e.affaire]?.court || calm(e.objet ?? "").toLowerCase(),
          ],
          [t("commune.contrat_montant"), money(e.montant)],
          [
            t("commune.contrat_duree"),
            e.duree ? t("commune.mois", { n: Number(e.duree) }) : t("commune.non_publiee"),
          ],
          [t("commune.contrat_fin"), end ? shortMonth(end) : "—"],
          [
            t("commune.contrat_offres"),
            e.offres != null ? String(e.offres) : t("commune.non_publie"),
          ],
          ...(lastMod
            ? [
                [
                  t("commune.contrat_modifie"),
                  `${shortDate(lastMod.date)}${mods.every((m) => m.montant === e.montant) ? t("commune.montant_inchange") : ""}`,
                ] as [string, string],
              ]
            : []),
        ],
        note: flagged(e)
          ? t("commune.note_date", { publiee: shortDate(e.date), lue: shortDate(e.date_lue) })
          : undefined,
        links: [{ l: t("commune.historique_contrat"), href: affHref(e.affaire) }],
      };
    };

    // the contracts, from signature to end: each one (up to five), or each company's (six and more)
    type Ligne = {
      l1: RichItem[];
      l2: string;
      rep: boolean;
      l2b: string;
      cours: string;
      p: { c: string; i: string };
    } & Row;
    let ctr: Ligne[];
    if (cs.length < 6)
      ctr = cs.map((e, i) => {
        const k = `c${i}`;
        const end = endOf(e);
        cDet(e, k);
        return {
          l1: [
            lienDocument(
              L,
              e,
              t("commune.frise_contrat", { i: i + 1, eur: money(e.montant) }) +
                (e.lots
                  ? t("commune.frise_lots", { n: e.lots.length })
                  : e.copies
                    ? t("commune.frise_copies", { n: e.copies })
                    : ""),
              true,
            ),
            " · ",
            ...who(e),
          ],
          l2: shortMonth(e.dl),
          rep: flagged(e),
          l2b: ` → ${end ? shortMonth(end) : t("commune.fin_a_lire")}`,
          cours: !end || end > TODAY ? t("commune.en_cours") : "",
          ...sel(k, "con", "ct r"),
          p: picto("con"),
        };
      });
    else {
      const by = new Map<string, [Contrat, number][]>();
      cs.forEach((e, i) => {
        const k0 = e.entreprises?.[0] ?? "?";
        by.set(k0, [...(by.get(k0) ?? []), [e, i]]);
      });
      ctr = [...by.entries()]
        .sort((a, b) => a[1][0][0].dl.localeCompare(b[1][0][0].dl))
        .map(([k0, es]) => {
          const k = `e${k0}`;
          const sum = es.reduce((x, [e]) => x + (e.compte ? (e.montant ?? 0) : 0), 0);
          for (const [e, i] of es) cDet(e, `c${i}`);
          DET[k] = {
            kicker: t("commune.ent_kicker", { n: es.length }),
            title: k0 === "?" ? t("commune.entreprise_non_publiee") : d.entName(k0),
            rows: es.slice(-5).map(([e]) => [shortDate(e.dl), money(e.montant)]),
            links:
              k0 === "?" || k0 === EI
                ? []
                : [{ l: t("commune.page_entreprise"), href: `/registre/entreprise/${k0}` }],
          };
          return {
            l1: [
              k0 === "?" ? t("commune.entreprise_non_publiee") : enLigne(this.entA(k0)),
              ` · ${count(es.length, "contrat")}`,
            ],
            l2: `${[...new Set(es.map(([e]) => e.dl.slice(0, 4)))].join(", ")} · ${money(sum)}`,
            rep: false,
            l2b: "",
            cours: es.some(([e]) => {
              const end = endOf(e);
              return !end || end > TODAY;
            })
              ? t("commune.en_cours")
              : "",
            ...sel(k, "entreprise", "ct r"),
            p: picto("entreprise"),
          };
        });
    }

    // the calls for tenders: those without a contract found, and the contracts' own notices
    type Ao = { k: string; debut: string; l: RichItem; suite: string } & Row;
    const aoL: Ao[] = [];
    for (const a of aos) {
      const debut = String(a.debut);
      const k = `o${a.id}`;
      const e0 = d.ev.get(a.events[0]);
      const cp = a.contrat_probable ? String(a.contrat_probable) : "";
      const cpEv = cp ? d.ev.get(d.affaire(cp)?.events?.[0] ?? "") : undefined;
      const results = a.events
        .map((i) => d.ev.get(i))
        .filter((x): x is Evenement => x?.t === "resultat");
      const suite = cp
        ? `${t("commune.ao_contrat_de", { y: cpEv ? d.dateLue(cpEv).slice(0, 4) : "?" })} ~`
        : ym(debut) > ym(TODAY) - 18
          ? t("commune.ao_pas_encore")
          : t("commune.ao_non_retrouve");
      DET[k] = {
        kicker: t("commune.ao_kicker", { date: shortDate(debut) }),
        title: this.titreAff(a.id, e0),
        rows: [
          [t("commune.ao_ref"), e0?.ref ?? "—"] as [string, string],
          ...results.map(
            (x) =>
              [t("commune.ao_resultat"), `${shortDate(x.date)} (${x.ref ?? ""})`] as [
                string,
                string,
              ],
          ),
          [t("commune.ao_suite"), suite],
        ],
        note: cp ? t("commune.note_lien") : undefined,
        links: [{ l: t("commune.historique_ao"), href: affHref(a.id) }],
      };
      aoL.push({
        k,
        debut,
        l: lien("ao", affHref(a.id), this.titreAff(a.id, e0), true),
        suite,
        ...sel(k, "ao", "ao r"),
      });
    }
    for (const e of cs)
      for (const i of d.affaire(e.affaire)?.events ?? []) {
        const x = d.ev.get(i);
        if (x?.t !== "avis" || !x.date) continue;
        const k = `o${x.id}`;
        const suite = t("commune.ao_contrat_du", { date: shortDate(e.dl) });
        DET[k] = {
          kicker: t("commune.ao_kicker", { date: shortDate(x.date) }),
          title: this.titreAff(e.affaire, x),
          rows: [
            [t("commune.ao_ref"), x.ref ?? "—"],
            [t("commune.ao_suite"), suite],
          ],
          links: [{ l: t("commune.historique_contrat"), href: affHref(e.affaire) }],
        };
        aoL.push({
          k,
          debut: x.date,
          l: lienDocument(L, x, this.titreAff(e.affaire, x), true),
          suite,
          ...sel(k, "ao", "ao r"),
        });
      }
    aoL.sort((a, b) => a.debut.localeCompare(b.debut));

    // the contracts signed each year, from the first one to this year: the amount a total adds
    const first = cs[0]?.dl.slice(0, 4);
    const last = +TODAY.slice(0, 4);
    const yrs = first
      ? Array.from({ length: last - +first + 1 }, (_, i) => String(+first + i))
      : [];
    const ya = yrs.map((y) => cs.filter((e) => e.dl.startsWith(y)));
    const sums = ya.map((l) => l.reduce((x, e) => x + (e.compte ? (e.montant ?? 0) : 0), 0));
    const mxs = Math.max(1, ...sums);
    const ecrites = yrs.length <= ECRITES;
    const years = yrs.map((y, i) => {
      const k = `y${y}`;
      const r = sel(k);
      DET[k] = {
        kicker: t("commune.annee"),
        title: y,
        rows: [
          [t("commune.annee_contrats"), fr(ya[i].length)],
          [t("commune.annee_montant"), sums[i] ? money(sums[i]) : "—"],
          [t("commune.annee_aos"), fr(aoL.filter((a) => a.debut.startsWith(y)).length)],
        ],
        links: [
          {
            l: t("commune.les_documents_lien"),
            href: `${communeHref(insee, "documents")}?y=${y}`,
          },
        ],
      };
      return {
        y,
        v: ecrites ? meur(sums[i]) : "",
        n: count(ya[i].length, "contrat"),
        label: t("commune.annee_label", { y, v: meur(sums[i]), n: ya[i].length }),
        on: r.sel,
        bar: `height: ${sums[i] ? Math.max(3, Math.round((sums[i] / mxs) * 150)) : 0}px; background: var(--fg)`,
        hover: r.hover,
        pick: r.pick,
      };
    });

    // what to keep in mind (the mockup's sentence)
    let retenir: RichItem[] | "" = "";
    if (cs.length) {
      const all = [...new Set(cs.flatMap((e) => e.entreprises ?? []))];
      if (all.length === 1 && cs.length > 1) {
        const gaps: [string, string][] = [];
        for (let i = 1; i < cs.length; i++) {
          const end = endOf(cs[i - 1]);
          if (end && ym(cs[i].dl) - ym(end) > 3) gaps.push([end, cs[i].dl]);
        }
        retenir = gaps.length
          ? rt("commune.retenir_trous", {
              y0,
              n: gaps.length,
              mois: ym(gaps[0][1]) - ym(gaps[0][0]),
              de: longMonth(gaps[0][0]),
              a: longMonth(gaps[0][1]),
            })
          : rt("commune.retenir_suite", { n: words(cs.length), y0 });
      } else if (all.length === 1) retenir = rt("commune.retenir_un", { ent: this.entA(all[0]) });
      else if (all.length > 1)
        retenir = rt("commune.retenir_plusieurs", {
          n: all.length,
          y0,
          ent: this.entA(cs[cs.length - 1].entreprises?.[0] ?? all[0]),
        });
    }
    const offre = cs.filter((e) => e.offres != null).pop();
    const subRow = s.subs.length
      ? money(s.subs.reduce((x, e) => x + (e.montant ?? 0), 0))
      : region || etat
        ? t("commune.aucune")
        : t("commune.pas_encore_collectees");
    const dl = cs.length
      ? [
          {
            k: t("commune.dl_entreprises", { y0: y0 || "—" }),
            v: String(new Set(cs.flatMap((e) => e.entreprises ?? [])).size),
          },
          ...(offre
            ? [{ k: t("commune.dl_offres", { y: offre.dl.slice(0, 4) }), v: String(offre.offres) }]
            : []),
          { k: t("commune.dl_subventions"), v: subRow },
        ]
      : [{ k: t("commune.dl_subventions"), v: subRow }];
    return {
      total: counted.length ? money(total) : "—",
      phrase,
      note: t("commune.arg_note", { couv }),
      ctrTitre: t(cs.length >= 6 ? "commune.ctr_titre_ent" : "commune.ctr_titre"),
      retenir,
      dl,
      ctr,
      aoL: aoL.map((o) => ({ ...o, date: shortDate(o.debut) })),
      years,
      yearAlt: yrs.length ? t("commune.annees_alt", { de: yrs[0], a: yrs[yrs.length - 1] }) : "",
    };
  }

  private titreAff(id: string, e?: Evenement): string {
    const { d } = this.prep;
    return (
      d.f.libelles[id]?.titre ||
      sentence(e?.objet || d.affaire(id)?.titre || "") ||
      t("commune.objet_non_publie")
    );
  }

  /** « Ce qui s'est passé »: the mockup's chronology; a big city keeps each year's notable facts.
   * Each fact's mark is its document's type (pictogram and colour), R1's colours by kind gone. */
  private chrono(DET: Record<string, Det>, sel: Sel) {
    const { d, s, insee, nom, cs, aos } = this.prep;
    type Mk = TypeCle | "vote" | "an";
    type It = { k: string; d: string; mk: Mk; t: RichItem[]; flag?: boolean; key?: string };
    const it: It[] = [];
    const mine = s.mine.filter((e) => !/^arrete_(drone|vsa)$/.test(e.t));
    const big = mine.length > 30;
    if (big) {
      const seen = new Set<string>();
      const ys = [...new Set(mine.map(year))].filter(Boolean).sort();
      const firstDrone = s.all.filter(isDrone).sort(byDateAsc)[0];
      for (const y of ys) {
        const rs = mine.filter((e) => year(e) === y);
        const cy = rs.filter((e) => e.t === "attribution" && !e.copie);
        const facts: RichItem[][] = [];
        const neu = [...new Set(cy.flatMap((e) => e.entreprises ?? []))].filter(
          (x) => !seen.has(x),
        );
        for (const e of cy) for (const x of e.entreprises ?? []) seen.add(x);
        if (neu.length && y > ys[0]) {
          const list: RichItem[] = neu
            .slice(0, 3)
            .flatMap((x, i) => (i ? [", ", this.entA(x)] : [this.entA(x)]));
          if (neu.length > 3) list.push(t("commune.et_autres", { n: neu.length - 3 }));
          facts.push([t("commune.fait_nouvelle"), ...list]);
        }
        const top = cy
          .filter((e) => e.compte)
          .sort((a, b) => (b.montant ?? 0) - (a.montant ?? 0))[0];
        if (top)
          facts.push(
            rt("commune.fait_gros", {
              eur: lienDocument(this.L, top, money(top.montant)),
              ent: top.entreprises?.length
                ? this.entA(top.entreprises[0])
                : t("commune.entreprise_non_publiee_une"),
            }),
          );
        if (firstDrone && year(firstDrone) === y)
          facts.push(rt("commune.fait_drone", { date: dayMonth(firstDrone.date ?? "") }));
        const na = rs.filter(isCam).length;
        if (!facts.length) continue;
        const k = `y${y}`;
        DET[`h${k}`] = {
          kicker: t("commune.annee"),
          title: y,
          rows: [
            [t("commune.annee_contrats"), String(cy.length)],
            [t("commune.annee_autorisations"), String(na)],
            [t("commune.annee_documents"), String(rs.length)],
          ],
          links: [
            {
              l: t("commune.les_documents_lien"),
              href: `${communeHref(insee, "documents")}?y=${y}`,
            },
          ],
        };
        const tx: RichItem[] = [];
        facts.forEach((f, i) => {
          const first = f[0];
          const head = typeof first === "string" ? [capital(first), ...f.slice(1)] : f;
          tx.push(...(i ? [". "] : []), ...head);
        });
        tx.push(".");
        it.push({ k: y, d: y, mk: "an", t: tx, key: `h${k}` });
      }
    } else {
      const dossiers = Object.entries(d.f.affaires)
        .map(([id, a]): Aff => ({ ...a, id }))
        .filter((a) => {
          const lastEv = d.ev.get(a.events[a.events.length - 1]);
          return a.insee === insee && a.kind === "dossier" && !!lastEv?.communal;
        });
      for (const a of dossiers) {
        const orig = Number(a.origine_annee ?? 0);
        const debutY = +String(a.debut).slice(0, 4);
        if (orig && orig < debutY) {
          const k = `h${a.id}`;
          DET[k] = {
            kicker: String(orig),
            title: t("commune.dossier_titre"),
            rows: [
              [
                t("commune.dossier_prefectoral"),
                t("commune.dossier_no", { no: a.id.split("-")[1] ?? a.id }),
              ],
              [
                t("commune.dossier_arretes", { de: String(orig), a: String(debutY - 1) }),
                t("commune.dossier_non_publies"),
              ],
            ],
            links: [
              {
                l: t("commune.demander_prefecture_lien"),
                href: communeHref(insee, `autorisations/${encodeURIComponent(a.id)}`),
              },
            ],
          };
          it.push({
            k: `${orig}-00`,
            d: String(orig),
            mk: "aut",
            t: [
              dossiers.length > 1
                ? t("commune.chrono_dossier_no", { no: dossierNo(a.id) })
                : t("commune.chrono_dossier"),
            ],
            key: k,
          });
        }
        const pts = (
          (a.cameras ?? []) as { n: number | null; groupe?: boolean; date: string }[]
        ).filter((p) => p.n != null && !p.groupe);
        const evs = a.events
          .map((i) => d.ev.get(i))
          .filter((e): e is Evenement => e?.cameras != null);
        const kLast = evs.length ? `a${evs[evs.length - 1].id}` : "";
        if (evs.length) {
          // the cells of « Ce que la préfecture autorise » hold the main dossier's; the others here
          const e = evs[evs.length - 1];
          DET[kLast] ??= {
            kicker: t("commune.arrete_kicker", { date: shortDate(e.date) }),
            title: t("commune.arrete_titre", { n: e.cameras ?? 0 }),
            rows: [[t("commune.arrete_ref"), t("commune.arrete_acte", { id: e.id })]],
            links: [
              {
                l: t("commune.historique_autorisation"),
                href: communeHref(insee, `autorisations/${encodeURIComponent(a.id)}`),
              },
            ],
          };
        }
        if (pts.length > 1) {
          const m = ym(pts[pts.length - 1].date) - ym(pts[0].date);
          const dl = (pts[pts.length - 1].n ?? 0) - (pts[0].n ?? 0);
          it.push({
            k: pts[0].date,
            d: `${shortMonth(pts[0].date)} → ${shortMonth(pts[pts.length - 1].date)}`,
            mk: "aut",
            t: [
              t("commune.chrono_autorise_suite", {
                suite: pts.map((p) => fr(p.n ?? 0)).join(t("commune.puis")),
                delta: dl > 0 ? `+${fr(dl)}` : dl < 0 ? `−${fr(-dl)}` : "±0",
                m,
              }),
            ],
            key: kLast,
          });
        } else if (pts.length)
          it.push({
            k: pts[0].date,
            d: longMonth(pts[0].date),
            mk: "aut",
            t: [t("commune.chrono_autorise", { cam: count(pts[0].n ?? 0, "camera") })],
            key: kLast,
          });
      }
      cs.forEach((e, i) => {
        const mods = d.f.evenements.filter(
          (x) => x.affaire === e.affaire && x.t === "modification",
        );
        const who: RichItem = e.entreprises?.length
          ? this.entA(e.entreprises[0])
          : t("commune.entreprise_non_publiee_une");
        const what = d.f.libelles[e.affaire]?.court || calm(e.objet ?? "").toLowerCase();
        const flag = !!e.date_lue && e.date_lue !== e.date;
        const modTxt = mods.length
          ? mods.length > 1
            ? t("commune.modifie_fois", { n: mods.length })
            : t("commune.modifie_en", { mois: longMonth(mods[0].date ?? "").split(" ")[0] })
          : "";
        it.push({
          k: e.dl,
          d: flag ? e.dl.slice(0, 4) : longMonth(e.dl),
          mk: "con",
          flag,
          key: `c${i}`,
          t: i
            ? rt("commune.chrono_nouveau", { who, mod: modTxt })
            : rt("commune.chrono_premier", { who, what }),
        });
      });
      for (const a of aos) {
        const debut = String(a.debut);
        const e0 = d.ev.get(a.events[0]);
        const c0 = d.f.libelles[a.id]?.court;
        const pend = !a.contrat_probable && ym(debut) > ym(TODAY) - 18;
        const what = c0
          ? c0.startsWith("pour ")
            ? ` ${c0}`
            : ` : ${c0}`
          : ` : ${calm(e0?.objet ?? "").toLowerCase()}`;
        it.push({
          k: debut,
          d: longMonth(debut),
          mk: "ao",
          t: [t(pend ? "commune.chrono_ao_nouveau" : "commune.chrono_ao", { what })],
          key: `o${a.id}`,
        });
      }
      for (const e of s.subs)
        it.push({
          k: e.date ?? "",
          d: e.date_annee ? year(e) : longMonth(e.date ?? ""),
          mk: "sub",
          t: [
            t(
              e.t === "subvention_region" ? "commune.chrono_sub_region" : "commune.chrono_sub_etat",
              {
                eur: money(e.montant),
                pour: e.cameras
                  ? t("commune.chrono_sub_pour", { cam: count(e.cameras, "camera") })
                  : "",
              },
            ),
          ],
        });
      const dr = s.all.filter(isDrone).sort(byDateAsc);
      if (dr.length)
        it.push({
          k: dr[0].date ?? "",
          d:
            dr.length > 1
              ? `${shortMonth(dr[0].date ?? "")} → ${shortMonth(dr[dr.length - 1].date ?? "")}`
              : longMonth(dr[0].date ?? ""),
          mk: "aut",
          t: [t("commune.chrono_drones", { nom, n: dr.length })],
        });
    }
    if (!it.length) return [];
    const k0 = it.map((x) => x.k).sort()[0];
    for (const m of d.f.mandats as Mandat[]) {
      if (!(m.second_tour >= k0 && m.second_tour <= TODAY)) continue;
      const k = `el${m.mandat}`;
      DET[k] = {
        kicker: capital(longMonth(m.premier_tour)),
        title: t("commune.elections"),
        rows: [
          [t("commune.elections_mandat"), m.mandat],
          [t("commune.elections_elus"), t("commune.elections_source")],
        ],
        links: [{ l: t("commune.elections_lien"), href: ELUS }],
      };
      it.push({
        k: big ? `${m.second_tour.slice(0, 4)}~` : m.second_tour,
        d: longMonth(m.premier_tour),
        mk: "vote",
        t: [t("commune.elections_point")],
        key: k,
      });
    }
    it.sort((a, b) => a.k.localeCompare(b.k));
    // a fact without a detail (an election): neither shown nor chosen
    const noop = (() => {}) as Handler;
    const rien: Row = { cls: "ch", sel: "false", c: "", hover: noop, pick: noop };
    return it.map((x) => {
      const doc = x.mk !== "vote" && x.mk !== "an";
      return {
        d: x.d,
        t: x.t,
        flag: !!x.flag,
        doc,
        p: doc ? picto(x.mk as TypeCle) : { c: "", i: "" },
        mark: doc ? "" : x.mk === "vote" ? "mk vote" : "mk an",
        ...(x.key ? sel(x.key, doc ? (x.mk as TypeCle) : undefined, "ch r") : rien),
      };
    });
  }

  /** The drones: how many decrees, when, and the way to their frieze (Carte et drones); the
   * weekly hours themselves are drawn there, from the build's slots. */
  private drones() {
    const { d, s, insee, nom } = this.prep;
    // the acts of the commune, and those naming it among others (its zones' acts)
    const of = (kind: "drone" | "vsa") => {
      const own = s.all.filter((e) => e.t === `arrete_${kind}`);
      const zones = d.f.zones.autorisations.filter(
        (a) => a.kind === kind && a.insee.includes(insee),
      );
      const actes = new Set([...own.map((e) => e.id), ...zones.map((a) => a.acte)]);
      const dates = [...own.map((e) => e.date ?? ""), ...zones.map((a) => a.date_acte)]
        .filter(Boolean)
        .sort();
      return { n: actes.size, dates };
    };
    const phrase = (kind: "drones" | "vsa", x: { n: number; dates: string[] }) =>
      !x.n
        ? ""
        : x.dates.length > 1 && x.dates[0].slice(0, 7) !== x.dates[x.dates.length - 1].slice(0, 7)
          ? t(`commune.${kind}_phrase`, {
              n: x.n,
              nom,
              de: longMonth(x.dates[0]),
              a: longMonth(x.dates[x.dates.length - 1]),
            })
          : t(`commune.${kind}_phrase_un`, { n: x.n, nom, mois: longMonth(x.dates[0] ?? "") });
    const dr = of("drone");
    const vsa = of("vsa");
    if (!dr.n && !vsa.n) return { show: false, titre: "", phrase: "", lien: "" as RichItem };
    return {
      show: true,
      titre: t(vsa.n ? "commune.drones_vsa_titre" : "commune.drones_titre"),
      phrase: [phrase("drones", dr), phrase("vsa", vsa)].filter(Boolean).join(" "),
      lien: lien(
        "commune",
        communeHref(insee, "carte"),
        t(dr.n ? "commune.drones_lien" : "commune.vsa_lien"),
      ) as RichItem,
    };
  }

  /** Its companies (Avec qui): each one's contracts with the commune and what a total adds. */
  private entreprises(_DET: Record<string, Det>, sel: Sel) {
    const { cs, d } = this.prep;
    const by = new Map<string, Contrat[]>();
    for (const e of cs) {
      const k0 = e.entreprises?.[0] ?? "?";
      by.set(k0, [...(by.get(k0) ?? []), e]);
    }
    return [...by.entries()]
      .map(([k0, es]) => ({
        k0,
        es,
        sum: es.reduce((x, e) => x + (e.compte ? (e.montant ?? 0) : 0), 0),
      }))
      .sort((a, b) => b.sum - a.sum || b.es.length - a.es.length)
      .map(({ k0, es, sum }) => {
        // the frieze's per-company detail when it groups by company, else the first contract's
        const k = cs.length >= 6 ? `e${k0}` : `c${cs.indexOf(es[0])}`;
        const ys = [...new Set(es.map((e) => e.dl.slice(0, 4)))];
        return {
          nom: k0 === "?" ? t("commune.entreprise_non_publiee") : enLigne(this.entA(k0)),
          n: count(es.length, "contrat"),
          ans: ys.length > 1 ? `${ys[0]} → ${ys[ys.length - 1]}` : ys[0],
          amt: sum ? money(sum) : "—",
          ...sel(k, "entreprise", "drow ent r"),
          p: picto("entreprise"),
          seul: k0 === EI || !!d.f.entreprises[k0]?.entrepreneur_individuel,
        };
      });
  }

  /** Its documents, the most recent first (V2-Entreprise's list): each its record. */
  private documents(DET: Record<string, Det>, sel: Sel) {
    const { d } = this.prep;
    return d.all.map((e) => {
      const k = `d${e.id}`;
      const amt =
        e.t === "attribution" || e.t === "modification" || e.t.startsWith("subvention")
          ? (e.montant ?? null)
          : null;
      const fig =
        amt != null
          ? money(amt)
          : e.t === "arrete" && e.cameras != null
            ? count(e.cameras, "camera")
            : "";
      DET[k] ??= {
        kicker: `${typeLabel(e)} · ${docDate(e.date, e.date_annee)}`,
        title: titreDocument(e),
        rows: [
          [t("documents.p_date"), docDate(e.date, e.date_annee)],
          [t("documents.p_type"), typeLabel(e)],
          ...(fig
            ? [
                [t(amt != null ? "documents.p_montant" : "documents.p_cameras"), fig] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(e.ref ? [[t("documents.p_reference"), e.ref] as [string, string]] : []),
        ],
        links: [
          { l: t("commune.doc_fiche"), href: docHref(this.L, e) },
          ...(e.url
            ? [
                {
                  l: t(e.t.startsWith("arrete") ? "arretes.voir" : "documents.lien_source"),
                  href: e.url,
                },
              ]
            : []),
          signaler(e),
        ],
      };
      const q = quiDocument(d, e, true);
      return {
        qui: q.entR || q.quiR,
        quiStyle: q.qk === "n" ? "font-style: italic; color: var(--muted)" : "",
        ...sel(k, typeDocument(e), "drow r"),
        p: picto(typeDocument(e)),
        d: docDate(e.date, e.date_annee),
        titre: lienDocument(this.L, e, titreDocument(e), true),
        fig,
      };
    });
  }

  /** « Sources »: each source the fiche reads, with how far it was read; the map's cameras; a
   * département whose decrees are not collected says so (a figure that is missing is not zero). */
  private sources(): Source[] {
    const { d, dep } = this.prep;
    const c = d.f.couverture as unknown as Couverture;
    const rs = regionSource(dep);
    const out = sources(
      c,
      ["contrats", "avis", ...(rs ? [rs] : []), `subventions_etat_${dep}`, `arretes_${dep}`],
      true,
    );
    if (!d.arretes.collectes)
      out.push({
        l: t("commune.source_arretes"),
        ed: etatDepartement(dep, d.f.stats.dep.nom, d.f.couverture.departement),
        date: "",
      });
    out.push({ l: t("commune.source_osm"), ed: t("commune.source_osm_ed"), date: "" });
    return out;
  }

  /** The territories (Avec qui): the build's per-commune stats, each document once, the
   * intercommunality and the département as links; the other communes of its intercommunality. */
  private territoires(DET: Record<string, Det>, sel: Sel) {
    const { d, insee, nom, dep, pop, collectes } = this.prep;
    const L = this.L;
    const st = d.f.stats;
    const epci = st.epci as
      | (typeof st.epci & { achat?: { n: number; montant: number } | null })
      | null;
    const dp0 = st.dep as typeof st.dep & { communes_registre?: number };
    const en = epci?.nom ?? (epci ? t("commune.intercommunalite", { code: epci.code }) : "");
    const all = epci?.communes ?? [];
    const reg = all.filter((k) => (st.communes[k]?.docs ?? 0) > 0);
    const zero = { docs: 0, con: 0, cam: 0, dr: 0, arr: 0, montant: 0 } as Stats;
    const me = st.communes[insee] ?? zero;
    const ep = (epci?.uniq ?? zero) as Stats;
    const dp = dp0.uniq as unknown as Stats;
    const nDep = dp0.communes_registre ?? 0;
    const rank =
      reg
        .map((k) => ({ k, docs: st.communes[k]?.docs ?? 0 }))
        .sort((a, b) => b.docs - a.docs)
        .findIndex((x) => x.k === insee) + 1;
    const v = (x: Stats, k: keyof Stats) =>
      k === "cam" || k === "dr" ? (collectes ? fr(Number(x[k] ?? 0)) : "—") : fr(Number(x[k] ?? 0));
    const epA =
      /^(métropole|communauté|ca |cc |cu |eurométropole|établissement)/i.test(en) ||
      /^(CA|CC|CU)\b/.test(en)
        ? t("commune.article_la")
        : "";
    const depNom = dp0.nom ?? dep;
    const da = depArt(dep, dp0.nom);
    const rows4 = (x: Stats): [string, string][] => [
      [t("commune.ter_documents"), v(x, "docs")],
      [t("commune.ter_contrats"), v(x, "con")],
      [t("commune.ter_autorisations"), v(x, "cam")],
      [t("commune.ter_drones"), v(x, "dr")],
    ];
    const epHref = epci ? epciHref(dep, epci.code) : "";
    const depHref = `/registre/departement/${dep}`;
    DET.m0 = {
      kicker: t("commune.commune"),
      title: nom,
      rows: [
        ...rows4(me),
        ...(rank && epci
          ? [
              [
                t("commune.ter_rang", { ter: epA ? `${epA}${en.replace(/^la /, "")}` : en }),
                t("commune.ter_rang_v", { r: rank, n: reg.length }),
              ] as [string, string],
            ]
          : []),
      ],
      links: [
        {
          l: t("commune.les_documents", { nDocs: me.docs }),
          href: communeHref(insee, "documents"),
        },
      ],
    };
    if (epci)
      DET.m1 = {
        kicker: t("commune.ter_intercommunalite"),
        title: en,
        rows: [
          [
            t("commune.ter_communes"),
            t("commune.ter_communes_v", { n: all.length, r: reg.length }),
          ],
          ...rows4(ep),
        ],
        links: [{ l: t("commune.ter_lien_communes", { ter: `${epA}${en}` }), href: epHref }],
      };
    DET.m2 = {
      kicker: t("commune.ter_departement"),
      title: depNom,
      rows: [[t("commune.ter_communes_registre"), fr(nDep)], ...rows4(dp)],
      links: [{ l: `${capital(da)} →`, href: depHref }],
    };
    const TER: Record<string, TypeCle> = { m0: "commune", m1: "epci", m2: "departement" };
    const row = (k: string, nomR: RichItem, sub: string, x: Stats) => ({
      nom: nomR,
      sub,
      n: v(x, "docs"),
      con: v(x, "con"),
      aut: v(x, "cam"),
      dr: v(x, "dr"),
      ...sel(k, TER[k]),
    });
    const terr = [
      // the fiche's own name is not a link to itself
      row("m0", { strong: nom }, t("commune.ter_sub_commune", { pop: fr(pop) }), me),
      ...(epci
        ? [
            row(
              "m1",
              lien("epci", epHref, en, true),
              t("commune.ter_sub_epci", { r: reg.length, n: all.length }),
              ep,
            ),
          ]
        : []),
      row("m2", lienDepartement(dep, depNom, true), t("commune.ter_sub_dep", { n: nDep }), dp),
    ];
    const achat = epci?.achat;
    const au = da.replace(/^le /, "au ").replace(/^les /, "aux ");
    // its neighbours: the other communes of its intercommunality the register holds, the most
    // documented first
    const vois = reg
      .filter((k) => k !== insee && L.communes[k])
      .sort(
        (a, b) =>
          (st.communes[b]?.docs ?? 0) - (st.communes[a]?.docs ?? 0) ||
          L.communes[a].nom.localeCompare(L.communes[b].nom, "fr"),
      )
      .map((k) => ({
        lien: lienCommune(L, k, undefined, true),
        n: count(st.communes[k]?.docs ?? 0, "document"),
      }));
    // a territory named in a sentence is a link to its fiche, its article words (« la », « au »)
    const terL: RichItem = { span: [epA, lien("epci", epHref, en)], cls: "" };
    const depL = (art: string): RichItem =>
      art.endsWith(depNom)
        ? {
            span: [art.slice(0, art.length - depNom.length), lienDepartement(dep, depNom)],
            cls: "",
          }
        : lienDepartement(dep, art);
    return {
      titre: epci
        ? rt("commune.ter_titre", { ter: terL, dep: depL(da) })
        : rt("commune.ter_titre_dep", { dep: depL(da) }),
      de: epA,
      epci: en,
      epciLien: epci ? lien("epci", epHref, en) : "",
      nCom: all.length,
      nReg: reg.length,
      caption: epci
        ? rt("commune.ter_caption", { nom, ter: terL, dep: depL(au) })
        : rt("commune.ter_caption_dep", { nom, dep: depL(au) }),
      couv: collectes
        ? t("commune.ter_couv", { mois: longMonth(d.arretes.depuis ?? "") })
        : t("commune.ter_couv_non"),
      achat: achat?.n
        ? `${count(achat.n, "contrat")}${achat.montant ? `, ${money(achat.montant)}` : ""}`
        : "",
      achatQui: capital(`${epA}${en.split(" ")[0]}`),
      achatLien: epci ? lienAcheteur(L, epci.code, t("commune.acheteur_public")) : "",
      liens: [
        ...(epci
          ? [
              lien(
                "epci",
                epHref,
                t("commune.ter_lien_communes", {
                  ter: `${epA}${en.split(" ")[0] === "Métropole" ? "Métropole" : en}`,
                }),
              ),
            ]
          : []),
        lienDepartement(dep, capital(da)),
      ],
      voisTitre: epci ? rt("commune.vois_titre", { ter: terL }) : "",
      vois,
      terr,
    };
  }

  /** The documents that exist but are not published (the prototype's missingItems): [question,
   * whom to ask, what to ask for]. */
  private manquants(): [string, "mairie" | "prefecture", string][] {
    const { d, s, insee, nom, aos, collectes } = this.prep;
    const out: [string, "mairie" | "prefecture", string][] = [];
    for (const [id, a] of Object.entries(d.f.affaires)) {
      if (a.insee !== insee) continue;
      const orig = Number(a.origine_annee ?? 0);
      const debutY = +String(a.debut).slice(0, 4);
      const lastEv = d.ev.get(a.events[a.events.length - 1]);
      if (a.kind === "dossier" && orig && orig < debutY - 1 && lastEv?.communal)
        out.push([
          t("commune.manque_dossier", { de: String(orig), a: String(debutY - 1) }),
          "prefecture",
          t("commune.manque_dossier_objet", {
            nom,
            no: id.split("-")[1] ?? id,
            de: String(orig),
            a: String(debutY - 1),
          }),
        ]);
      if (
        a.kind === "subvention" &&
        id.startsWith("sub-") &&
        !a.contrat_probable &&
        String(a.debut) >= "2019"
      ) {
        const e0 = d.ev.get(a.events[0]);
        out.push([
          t("commune.manque_sub", { date: numDate(String(a.debut)) }),
          "mairie",
          t("commune.manque_sub_objet", { date: numDate(String(a.debut)), ref: e0?.ref ?? "" }),
        ]);
      }
    }
    for (const a of aos) {
      if (a.contrat_probable || String(a.debut) < "2019") continue;
      const e0 = d.ev.get(a.events[0]);
      out.push([
        t("commune.manque_ao", { nom, mois: longMonth(String(a.debut)) }),
        "mairie",
        t("commune.manque_ao_objet", { date: numDate(String(a.debut)), ref: e0?.ref ?? "" }),
      ]);
    }
    if (!s.all.some((e) => e.t.startsWith("arrete")) && !collectes)
      out.push([
        t("commune.manque_arretes", { nom }),
        "prefecture",
        t("commune.manque_arretes_objet", { nom }),
      ]);
    return out;
  }
}

export default {
  Vue: Commune,
  template,
  donnees: async (r: Route) => ({ d: await commune((r as Props).insee) }),
} as unknown as VueModule;
