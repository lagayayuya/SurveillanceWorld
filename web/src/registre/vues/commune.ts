// View 3 · Commune · L'essentiel (/registre/commune/<insee>; mockup Commune-grand, the prototype's
// vues/commune.js). The figures are the build's (commune/<insee>.json, its flags read through commun.ts):
// the sentences the mockup wrote for Mions are rules, each one hidden where it does not hold. Every
// sentence that holds a figure in bold or a link is a Rich value, never markup. The tilted map
// (carte3d.ts) comes after the page: its code, its layers and the basemap are asked for once the
// content is drawn, and a commune whose map is not cut says so in the map's frame.
import type { Carte, Site as CarteSite, Translate } from "../carte3d.ts";
import {
  benefLabel,
  byDateAsc,
  commune,
  communeHref,
  type Donnees,
  depArt,
  ess,
  filCommune,
  isCam,
  isDrone,
  tete,
} from "../commun.ts";
import { type Handler, type Rich, type RichItem, richText } from "../dc.ts";
import type { Affaire, Evenement, Stats } from "../donnees.ts";
import {
  addMonths,
  count,
  fr,
  longDate,
  longMonth,
  money,
  shortDate,
  shortMonth,
} from "../format.ts";
import { has, t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import type { Route } from "../routes.ts";
import { signaler } from "../signaler.ts";
import { calm, capital, proper, sentence } from "../texte.ts";
import { type BaseState, Vue } from "../vue.ts";
import template from "./commune.html?raw";
import { demander, partagerImage } from "./commune-outils.ts";

const TODAY = new Date().toISOString().slice(0, 10);
const ELUS = "https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1";
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const NBSP = " ";

// the markers of « Ce qui s'est passé » (the mockup's)
const MK = {
  dossier:
    "display: inline-block; width: 12px; height: 12px; border: 3px solid var(--fg); border-radius: 50%",
  contrat: "display: inline-block; width: 14px; height: 14px; background: var(--fg)",
  aut: "display: inline-block; width: 13px; height: 13px; border: 3px solid var(--fg); transform: rotate(45deg); box-sizing: border-box",
  ao: "display: inline-block; width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 14px solid var(--ao)",
  vote: "display: inline-block; width: 14px; height: 3px; background: var(--muted); vertical-align: middle",
  sub: "display: inline-block; width: 14px; height: 14px; background: var(--sub)",
  an: "display: inline-block; width: 14px; height: 3px; background: var(--fg); vertical-align: middle",
};

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
const link = (href: string, text: Rich): RichItem => ({ a: { href, text } });
/** The number in words up to twelve (« Trois arrêtés en sept mois »), in figures above. */
const words = (n: number) => t("commune.nombres").split(",")[n] ?? fr(n);
const dossierNo = (id: string) => {
  const n = String(id).split("-").slice(1).join("-");
  return /^\d{8}$/.test(n) ? `${n.slice(0, 4)}-${n.slice(4)}` : n;
};

/** A catalogue message whose placeholders may be rich (bold, a link): the message is the
 * catalogue's, the rich parts are put back in place of their placeholder. */
type Param = string | number | Exclude<RichItem, string>;
function rt(key: string, params: Record<string, Param> = {}): RichItem[] {
  const holes: RichItem[] = [];
  const flat: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "object") {
      flat[k] = `\uE000${holes.length}\uE000`;
      holes.push(v);
    } else flat[k] = v;
  }
  return t(key, flat)
    .split(/\uE000(\d+)\uE000/)
    .map((x, i) => (i % 2 ? holes[Number(x)] : x))
    .filter((x) => x !== "");
}
const join = (...parts: (RichItem[] | null | false | undefined)[]): RichItem[] =>
  parts.filter((p): p is RichItem[] => !!p).flatMap((p, i) => (i ? [" ", ...p] : p));

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
type State = BaseState & { playing: boolean; carte: "attente" | "ok" | "absente"; source: string };

class Commune extends Vue<Props, State> {
  private p?: Prep;
  private map: Carte | null = null;
  private dead = false;
  private timer = 0;
  private readonly onTheme = () => this.map?.setTheme(theme());

  protected init(): Partial<State> {
    return { playing: !/[?&]rotation=0\b/.test(location.search), carte: "attente", source: "" };
  }
  titre(): string {
    return this.props.d.f.commune.nom;
  }
  private get prep(): Prep {
    this.p ??= prepare(this.props.d);
    return this.p;
  }

  // --- the map, after the page -------------------------------------------------------------------
  componentDidMount(): void {
    addEventListener("themechange", this.onTheme);
    setTimeout(() => void this.mountMap(), 0);
  }
  componentWillUnmount(): void {
    this.dead = true;
    removeEventListener("themechange", this.onTheme);
    clearInterval(this.timer);
    this.map?.destroy();
    this.map = null;
    // left while the map is being made: its frame waits off screen, at its size, until carte()
    // returns and the map is destroyed (MapLibre in a detached, sizeless frame throws)
    const el = this.making;
    if (el) {
      const park = document.createElement("div");
      park.className = "th";
      park.setAttribute("aria-hidden", "true");
      park.inert = true;
      park.style.cssText = `position: fixed; top: 0; left: -${el.offsetWidth + 50}px; width: ${el.offsetWidth}px; height: ${el.offsetHeight}px; overflow: hidden; visibility: hidden`;
      park.append(el);
      document.body.append(park);
      this.park = park;
    }
  }
  private making: HTMLElement | null = null;
  private park: HTMLElement | null = null;
  private async mountMap(): Promise<void> {
    const { d, insee, nom } = this.prep;
    const el = document.getElementById("carte-ess");
    if (!el || this.dead) return;
    // an uncut map: said at once, nothing asked (neither MapLibre nor a file that is not there)
    if (d.f.carte.decoupee === false) {
      this.absent(el, nom);
      return;
    }
    try {
      const { carte, carteUrl } = await import("../carte3d.ts");
      if (this.dead) return;
      const r = await fetch(carteUrl(insee));
      // a commune whose map is not cut has no file (a 404; the dev server answers its page)
      const data = r.ok && /json/.test(r.headers.get("content-type") ?? "") ? await r.json() : null;
      if (this.dead || !el.isConnected) return;
      if (!data?.contour) {
        this.absent(el, nom);
        return;
      }
      this.setState({ carte: "ok", source: typeof data.source === "string" ? data.source : "" });
      const sites = carteSites(d);
      const tr: Translate = (k, p) => t(k.replace(/^registre\./, ""), p);
      this.making = el;
      let m: Carte;
      try {
        m = await carte(el, {
          data,
          t: tr,
          theme: theme(),
          fixe: true,
          sites,
          couches: { cams: true, vsa: true, drones: true },
          play: this.state.playing,
          slowStop: !/[?&]perf=1\b/.test(location.search),
          capture: /[?&]capture=1\b/.test(location.search),
          label: this.carteAlt(),
        });
      } finally {
        this.making = null;
      }
      if (this.dead) {
        m.destroy();
        this.park?.remove();
        return;
      }
      this.map = m;
      m.setHeures(heures(d, sites));
      el.dataset.prete = "1";
      document.dispatchEvent(new Event("carteprete"));
      // the map stops its turn by itself on a slow device: the button follows
      const sync = () => this.setState({ playing: m.playing() });
      sync();
      this.timer = window.setInterval(sync, 1000);
    } catch (e) {
      // a device that cannot draw it (no WebGL2): said in the frame, the page stays whole
      this.park?.remove();
      if (this.dead) return;
      console.warn(e);
      if (el.isConnected && !this.map) this.absent(el, nom, "commune.carte_erreur");
    }
  }
  /** No map cut for this commune (the prototype's sentence), or none drawn: the frame says so. */
  private absent(el: HTMLElement, nom: string, key = "commune.carte_absente"): void {
    const p = document.createElement("p");
    p.textContent = t(key, { nom });
    p.style.cssText = "margin: 0; padding: 20px; color: var(--muted)";
    el.classList.remove("c3");
    el.replaceChildren(p);
    el.style.setProperty("height", "auto", "important");
    this.setState({ carte: "absente" });
  }
  private toggle: Handler = () => {
    const m = this.map;
    if (!m) {
      this.setState({ playing: !this.state.playing });
      return;
    }
    if (m.playing()) m.stop(true);
    else m.play();
    this.setState({ playing: m.playing() });
  };

  /** The map's accessible name (its frame is an image). */
  private carteAlt(): string {
    const { nom, n } = this.prep;
    const { hasDr, hasVsa } = this.layers();
    const quoi = n ? t("commune.carte_alt_cameras", { n }) : t("commune.carte_alt_aucune");
    const dr = hasDr
      ? t("commune.carte_alt_drones")
      : t(hasVsa ? "commune.carte_alt_sans_drones" : "commune.carte_alt_sans_rien", { nom });
    return t("commune.carte_alt", { nom, quoi, dr });
  }
  private layers() {
    const { d, s, insee } = this.prep;
    const acts = d.f.zones.autorisations.filter((a) => a.insee.includes(insee));
    return {
      hasDr: s.all.some(isDrone) || acts.some((a) => a.kind === "drone"),
      hasVsa: s.all.some((e) => e.t === "arrete_vsa") || acts.some((a) => a.kind === "vsa"),
    };
  }

  // --- the page ----------------------------------------------------------------------------------
  renderVals() {
    const S = this.state;
    const P = this.prep;
    const { d, s, insee, nom, dep, n, pub, counted, cs, y0, total } = P;
    const sel = (k: string) => this.pick(k);
    const on = (k: string) => this.on(k);
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
    DET.sum = {
      kicker: t("commune.sum_kicker", { nom }),
      title: t("commune.sum_titre"),
      rows: [
        s.camAut ? ([t("commune.sum_aut"), fr(s.camAut)] as [string, string]) : null,
        s.vpAut != null ? ([t("commune.sum_rue"), fr(s.vpAut)] as [string, string]) : null,
        [t("commune.sum_carte"), n == null ? "—" : fr(n)] as [string, string],
        [
          counted.length ? t("commune.sum_contrats_depuis", { y0 }) : t("commune.sum_contrats"),
          counted.length ? money(total) : t("commune.sum_aucun"),
        ] as [string, string],
        [t("commune.sum_documents"), fr(s.all.length)] as [string, string],
      ].filter((r): r is [string, string] => !!r),
      links: [{ l: t("commune.sum_lien"), href: docs }],
    };

    // the map's legend: an absent layer says « aucune à <commune> »; a shared act says so (12th pass)
    const { hasDr, hasVsa } = this.layers();
    const ls = "display: flex; align-items: center; gap: 8px";
    const lsm = `${ls}; color: var(--muted)`;
    const drOwn = s.all.filter((e) => isDrone(e) && !e.insee0);
    const drSh = s.all.filter((e) => isDrone(e) && e.insee0);
    const leg = {
      dr: drOwn.length
        ? t("commune.leg_drones")
        : drSh.length
          ? t("commune.leg_drones_partages", { n: drSh.length })
          : hasDr
            ? t("commune.leg_drones")
            : t("commune.leg_drones_aucune", { nom }),
      drStyle: hasDr ? ls : lsm,
      vsa: hasVsa ? t("commune.leg_vsa") : t("commune.leg_vsa_aucune", { nom }),
      vsaStyle: hasVsa ? ls : lsm,
    };
    const absente = S.carte === "absente";
    const vueTitre =
      absente || n == null
        ? t("commune.vue_carte_de", { nom })
        : n
          ? t("commune.vue_filment", { n })
          : t("commune.vue_aucune");
    const attrib: RichItem[] = absente
      ? []
      : [
          ...(S.source ? [`${S.source}. `] : []),
          ...rt("carte.attribution", { osm: link(OSM_COPYRIGHT, t("carte.attribution_osm")) }),
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

    const aut = this.autorise(DET, sel, on);
    const prv = this.prives(DET, sel, on);
    const arg = this.argent(DET, sel, on);
    const chrono = this.chrono(DET, sel, on);
    const ter = this.territoires(DET, sel, on);

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
            contrat: link(
              `/registre/contrat/${encodeURIComponent(e.affaire)}`,
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

    const d0 = (S.sel && DET[S.sel]) || DET.sum;
    const det = {
      kicker: d0.kicker,
      title: d0.title,
      rows: d0.rows.map(([k, v]) => ({ k, v })),
      note: d0.note ?? "",
      links: d0.links ?? [],
      hint: t("commune.panneau_aide"),
    };
    const com = tete(d, "ess");
    return {
      ...this.base("commune"),
      ...this.info("arg", "met", "ou"),
      ...filCommune(d),
      com,
      lead,
      kpis,
      vueTitre,
      carteAlt: absente ? "" : this.carteAlt(),
      carteRole: absente ? "" : "img",
      ctlShow: !absente,
      attrib: attrib.length ? attrib : "",
      leg,
      ou,
      aut,
      arr: aut.arr,
      prv,
      priv: prv.priv,
      arg,
      rows: arg.rows,
      ticks: arg.ticks,
      friseAlt: arg.alt,
      chrono,
      ter,
      terr: ter.terr,
      veille,
      introuvables,
      det,
      nDocs: s.all.length,
      lien: {
        carte: `/?insee=${encodeURIComponent(insee)}`,
        dossier: P.main
          ? communeHref(insee, `autorisations/${encodeURIComponent(P.main.id)}`)
          : auts,
        prives: `${docs}?qui=p,n&t=aut`,
        documents: docs,
        sources: "/registre/couverture",
      },
      playing: S.playing,
      paused: !S.playing,
      pressed: S.playing ? "false" : "true",
      toggleLabel: t(S.playing ? "carte.arreter" : "carte.reprendre"),
      toggle: this.toggle,
      partager: (() =>
        void partagerImage({
          nom,
          ligne: com.ligneLongue,
          lead: richText(lead),
          kpis,
          url: `${location.origin}${communeHref(insee)}`,
          scope: document.querySelector(".v-commune") ?? document.documentElement,
          fichier: t("commune.image_fichier", { insee }),
        })) as Handler,
    };
  }

  /** A company's name, a link to its page. */
  private entA(siren: string): RichItem {
    return link(`/registre/entreprise/${siren}`, this.prep.d.entName(siren));
  }

  /** What the préfecture authorises: the last act of the mairie's main dossier. */
  private autorise(
    DET: Record<string, Det>,
    sel: (k: string) => Handler,
    on: (k: string) => boolean,
  ) {
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
    const arr = acts.map((e, i) => {
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
        hover: sel(key),
        cls: `hv${on(key) ? " on" : ""}`,
        style: `padding: 12px 14px; ${i ? "border-left: 1px solid var(--rule); " : ""}${on(key) ? "box-shadow: inset 0 -5px 0 var(--accent-fill)" : ""}`,
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
      arr,
      hist:
        pts.length > 1
          ? t("commune.historique_suite", { suite: seq.join(" → ") })
          : t("commune.historique_autorisation"),
    };
  }

  /** « Aussi à <commune> »: the shops' and companies' cameras (the last act of each dossier). */
  private prives(
    DET: Record<string, Det>,
    sel: (k: string) => Handler,
    on: (k: string) => boolean,
  ) {
    const { s, nom, insee } = this.prep;
    const base = { show: s.prv.length > 0, hover: sel("prv"), cls: `hv${on("prv") ? " on" : ""}` };
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
        .map((e) => ({ d: shortDate(e.date), who: who(e), n: fr(e.cameras ?? 0) })),
      nom,
    };
  }

  /** L'argent: the total, the frieze of contracts and calls for tenders, what to keep in mind. */
  private argent(
    DET: Record<string, Det>,
    sel: (k: string) => Handler,
    on: (k: string) => boolean,
  ) {
    const { d, s, cs, counted, y0, total, pop, dep, aos, insee } = this.prep;
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

    const sources = new Set(d.f.couverture.sources.map((x) => x.id));
    const rs = regionSource(dep);
    const region = !!rs && sources.has(rs);
    const etat = sources.has(`subventions_etat_${dep}`);
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

    // the frieze: from (first year − 1) to today, « auj. » at the right edge; an arrow when a contract runs on
    const first = cs[0]?.dl || String(aos[0]?.debut ?? "") || TODAY;
    const M0 = (+first.slice(0, 4) - 1) * 12;
    const NOW = ym(TODAY) + +TODAY.slice(8, 10) / 31;
    const X = (dd: string) =>
      Math.max(
        0,
        Math.min(100, ((ym(dd) + ((+dd.slice(8, 10) || 1) - 1) / 31 - M0) / (NOW - M0)) * 100),
      );
    const bar = (a: number, b: number, k: string) => ({
      style: `position: absolute; top: 0; bottom: 0; left: ${a.toFixed(2)}%; width: ${Math.max(0.6, b - a).toFixed(2)}%; background: ${on(k) ? "var(--accent-fill)" : "var(--fg)"}`,
    });
    const arrowStyle = (k: string) =>
      `position: absolute; top: -3px; right: -16px; width: 0; height: 0; border-top: 15px solid transparent; border-bottom: 15px solid transparent; border-left: 16px solid ${on(k) ? "var(--accent-fill)" : "var(--fg)"}`;
    const endOf = (e: Contrat) => (e.duree ? addMonths(e.dl, Number(e.duree)) : null);
    const flagged = (e: Evenement) => !!e.date_lue && e.date_lue !== e.date;
    const names = (e: Evenement) =>
      e.entreprises?.length
        ? e.entreprises.map((x) => d.entName(x)).join(", ")
        : t("commune.entreprise_non_publiee");
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
        links: [
          {
            l: t("commune.historique_contrat"),
            href: `/registre/contrat/${encodeURIComponent(e.affaire)}`,
          },
        ],
      };
    };
    type Row = {
      l1: RichItem[];
      l2: string;
      rep: boolean;
      l2b: string;
      bars: { style: string }[];
      arrow: boolean;
      arrowStyle: string;
      tris: { hover: Handler; style: string }[];
      cls: string;
      hover: Handler;
    };
    let rows: Row[];
    if (cs.length < 6)
      rows = cs.map((e, i) => {
        const k = `c${i}`;
        const end = endOf(e);
        cDet(e, k);
        return {
          l1: [
            t("commune.frise_contrat", { i: i + 1, eur: money(e.montant) }) +
              (e.lots
                ? t("commune.frise_lots", { n: e.lots.length })
                : e.copies
                  ? t("commune.frise_copies", { n: e.copies })
                  : ""),
          ],
          l2: shortMonth(e.dl),
          rep: flagged(e),
          l2b: ` → ${end ? shortMonth(end) : t("commune.fin_a_lire")}`,
          bars: [bar(X(e.dl), end ? X(end) : 100, k)],
          arrow: !end || end > TODAY,
          arrowStyle: arrowStyle(k),
          tris: [],
          cls: `hv${on(k) ? " on" : ""}`,
          hover: sel(k),
        };
      });
    else {
      const by = new Map<string, [Contrat, number][]>();
      cs.forEach((e, i) => {
        const k0 = e.entreprises?.[0] ?? "?";
        by.set(k0, [...(by.get(k0) ?? []), [e, i]]);
      });
      rows = [...by.entries()]
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
              k0 === "?"
                ? []
                : [{ l: t("commune.page_entreprise"), href: `/registre/entreprise/${k0}` }],
          };
          return {
            l1: [
              k0 === "?" ? t("commune.entreprise_non_publiee") : this.entA(k0),
              ` · ${count(es.length, "contrat")}`,
            ],
            l2: `${[...new Set(es.map(([e]) => e.dl.slice(0, 4)))].join(", ")} · ${money(sum)}`,
            rep: false,
            l2b: "",
            bars: es.map(([e]) => {
              const end = endOf(e);
              return bar(X(e.dl), end ? X(end) : 100, k);
            }),
            arrow: es.some(([e]) => {
              const end = endOf(e);
              return !end || end > TODAY;
            }),
            arrowStyle: arrowStyle(k),
            tris: [],
            cls: `hv${on(k) ? " on" : ""}`,
            hover: sel(k),
          };
        });
    }
    const triStyle = (date: string, k: string) =>
      `position: absolute; top: 4px; left: calc(${X(date).toFixed(2)}% - 9px); width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-bottom: 16px solid ${on(k) ? "var(--accent-fill)" : "var(--ao)"}; cursor: pointer`;
    const tris: { hover: Handler; style: string; id: string; debut: string }[] = [];
    for (const a of aos) {
      const debut = String(a.debut);
      if (ym(debut) < M0) continue;
      const k = `o${a.id}`;
      const e0 = d.ev.get(a.events[0]);
      const cp = a.contrat_probable ? String(a.contrat_probable) : "";
      const cpEv = cp ? d.ev.get(d.affaire(cp)?.events?.[0] ?? "") : undefined;
      const results = a.events
        .map((i) => d.ev.get(i))
        .filter((x): x is Evenement => x?.t === "resultat");
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
          [
            t("commune.ao_suite"),
            cp
              ? `${t("commune.ao_contrat_de", { y: cpEv ? d.dateLue(cpEv).slice(0, 4) : "?" })} ~`
              : ym(debut) > ym(TODAY) - 18
                ? t("commune.ao_pas_encore")
                : t("commune.ao_non_retrouve"),
          ],
        ],
        note: cp ? t("commune.note_lien") : undefined,
        links: [
          { l: t("commune.historique_ao"), href: `/registre/contrat/${encodeURIComponent(a.id)}` },
        ],
      };
      tris.push({ hover: sel(k), style: triStyle(debut, k), id: k, debut });
    }
    // the contracts' own notices, as triangles too (the 2024 notice of Mions' 2025 contract)
    for (const e of cs)
      for (const i of d.affaire(e.affaire)?.events ?? []) {
        const x = d.ev.get(i);
        if (x?.t !== "avis" || !x.date || ym(x.date) < M0) continue;
        const k = `o${x.id}`;
        DET[k] = {
          kicker: t("commune.ao_kicker", { date: shortDate(x.date) }),
          title: this.titreAff(e.affaire, x),
          rows: [
            [t("commune.ao_ref"), x.ref ?? "—"],
            [t("commune.ao_suite"), t("commune.ao_contrat_du", { date: shortDate(e.dl) })],
          ],
          links: [
            {
              l: t("commune.historique_contrat"),
              href: `/registre/contrat/${encodeURIComponent(e.affaire)}`,
            },
          ],
        };
        tris.push({ hover: sel(k), style: triStyle(x.date, k), id: k, debut: x.date });
      }
    tris.sort((a, b) => a.debut.localeCompare(b.debut));
    if (tris.length) {
      const last = tris[tris.length - 1];
      const ys = [...new Set(tris.map((x) => x.debut.slice(0, 4)))];
      rows.push({
        l1: [t("commune.frise_aos")],
        l2: ys
          .map((y, i) =>
            i === ys.length - 1 && last.debut.slice(0, 4) === y && ym(last.debut) > ym(TODAY) - 6
              ? longMonth(last.debut)
              : y,
          )
          .join(" · "),
        rep: false,
        l2b: "",
        bars: [],
        arrow: false,
        arrowStyle: "",
        tris,
        cls: "",
        hover: sel(last.id),
      });
    }
    const yrs: number[] = [];
    for (let y = M0 / 12; y <= +TODAY.slice(0, 4); y++) yrs.push(y);
    const stepY = yrs.length > 9 ? 2 : 1;
    const ticks = yrs
      .filter((y, i) => i % stepY === 0 && X(`${y}-01-01`) < 94)
      .map((y, i) => ({
        l: String(y),
        cls: i % 2 || X(`${y}-01-01`) > 80 ? "tk-o" : "",
        style: `position: absolute; top: 2px; left: ${X(`${y}-01-01`).toFixed(2)}%; transform: translateX(${y === M0 / 12 ? "0" : "-50%"})`,
      }))
      .concat([
        {
          l: t("commune.aujourdhui"),
          cls: "",
          style: "position: absolute; top: 2px; right: 0; color: var(--fg); font-weight: 700",
        },
      ]);
    const alt = [
      ...cs.map((e, i) => {
        const end = endOf(e);
        return t("commune.frise_alt", {
          i: i + 1,
          qui: names(e),
          eur: money(e.montant).replace("€", t("commune.euros")),
          de: longMonth(e.dl),
          a: end ? longMonth(end) : t("commune.une_date_a_lire"),
          cours: end && end > TODAY ? t("commune.frise_alt_cours") : "",
        });
      }),
      tris.length
        ? t("commune.frise_alt_aos", { mois: tris.map((x) => longMonth(x.debut)).join(", ") })
        : "",
    ]
      .filter(Boolean)
      .join(" ");

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
    void insee;
    return {
      total: counted.length ? money(total) : "—",
      phrase,
      note: t("commune.arg_note", { couv }),
      friseTitre: t(cs.length >= 6 ? "commune.frise_titre_ent" : "commune.frise_titre"),
      retenir,
      dl,
      rows,
      ticks,
      alt,
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

  /** « Ce qui s'est passé »: the mockup's chronology; a big city keeps each year's notable facts. */
  private chrono(
    DET: Record<string, Det>,
    sel: (k: string) => Handler,
    on: (k: string) => boolean,
  ) {
    const { d, s, insee, nom, cs, aos } = this.prep;
    type It = { k: string; d: string; mark: string; t: RichItem[]; flag?: boolean; key?: string };
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
              eur: money(top.montant),
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
        DET[k] = {
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
        it.push({ k: y, d: y, mark: MK.an, t: tx, key: k });
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
            mark: MK.dossier,
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
            mark: MK.aut,
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
            mark: MK.aut,
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
          mark: MK.contrat,
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
          mark: MK.ao,
          t: [t(pend ? "commune.chrono_ao_nouveau" : "commune.chrono_ao", { what })],
          key: `o${a.id}`,
        });
      }
      for (const e of s.subs)
        it.push({
          k: e.date ?? "",
          d: e.date_annee ? year(e) : longMonth(e.date ?? ""),
          mark: MK.sub,
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
          mark: MK.aut,
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
        mark: MK.vote,
        t: [t("commune.elections_point")],
        key: k,
      });
    }
    it.sort((a, b) => a.k.localeCompare(b.k));
    return it.map((x) => ({
      d: x.d,
      t: x.t,
      flag: !!x.flag,
      mark: x.mark,
      hover: x.key ? sel(x.key) : ((() => {}) as Handler),
      cls: `hv${x.key && on(x.key) ? " on" : ""}`,
    }));
  }

  /** « Dans <intercommunalité> et <département> »: the build's per-commune stats, each document once. */
  private territoires(
    DET: Record<string, Det>,
    sel: (k: string) => Handler,
    on: (k: string) => boolean,
  ) {
    const { d, insee, nom, dep, pop, collectes } = this.prep;
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
    const epHref = epci ? `/registre/departement/${dep}?ic=${epci.code}` : "";
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
      links: [{ l: `${capital(da)} →`, href: `/registre/departement/${dep}` }],
    };
    const row = (k: string, nomR: string, sub: string, x: Stats, href: string) => ({
      nom: nomR,
      sub,
      n: v(x, "docs"),
      con: v(x, "con"),
      aut: v(x, "cam"),
      dr: v(x, "dr"),
      href,
      hover: sel(k),
      cls: `r${on(k) ? " on" : ""}`,
    });
    const terr = [
      row("m0", nom, t("commune.ter_sub_commune", { pop: fr(pop) }), me, communeHref(insee)),
      ...(epci
        ? [row("m1", en, t("commune.ter_sub_epci", { r: reg.length, n: all.length }), ep, epHref)]
        : []),
      row("m2", depNom, t("commune.ter_sub_dep", { n: nDep }), dp, `/registre/departement/${dep}`),
    ];
    const achat = epci?.achat;
    const au = da.replace(/^le /, "au ").replace(/^les /, "aux ");
    return {
      titre: epci
        ? t("commune.ter_titre", { ter: `${epA}${en}`, dep: da })
        : t("commune.ter_titre_dep", { dep: da }),
      de: epA,
      epci: en,
      nCom: all.length,
      nReg: reg.length,
      caption: epci
        ? t("commune.ter_caption", { nom, ter: `${epA}${en}`, dep: au })
        : t("commune.ter_caption_dep", { nom, dep: au }),
      couv: collectes
        ? t("commune.ter_couv", { mois: longMonth(d.arretes.depuis ?? "") })
        : t("commune.ter_couv_non"),
      achat: achat?.n
        ? `${count(achat.n, "contrat")}${achat.montant ? `, ${money(achat.montant)}` : ""}`
        : "",
      achatQui: capital(`${epA}${en.split(" ")[0]}`),
      achatHref: epci ? d.buyerHref(epci.code) : "",
      hrefEpci: epHref,
      lienEpci: t("commune.ter_lien_communes", {
        ter: `${epA}${en.split(" ")[0] === "Métropole" ? "Métropole" : en}`,
      }),
      hrefDep: `/registre/departement/${dep}`,
      lienDep: `${capital(da)} →`,
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

const theme = (): "light" | "dark" =>
  document.documentElement.dataset.mode === "dark" ? "dark" : "light";

/** The drone and algorithmic-analysis sites drawn on the commune: those of the acts naming it,
 * never a zone the build could not deduce from its act (zone_non_deduite, statut « relecture »). */
function carteSites(d: Donnees): CarteSite[] {
  const Z = d.f.zones;
  const insee = d.insee;
  const zid = new Map(Z.zones.map((z) => [z.id, z]));
  const keep = new Set<string>();
  for (const a of Z.autorisations) {
    if (!a.insee.includes(insee) || nonDeduite(d, a.acte)) continue;
    for (const id of a.zones) {
      const z = zid.get(id);
      if (z?.site && z.statut !== "relecture") keep.add(String(z.site));
    }
  }
  return Z.sites.filter((u) => keep.has(u.id) && u.parts?.[insee]) as unknown as CarteSite[];
}
const nonDeduite = (d: Donnees, acte: string) =>
  !!d.ev.get(acte)?.non_lu?.includes("zone_non_deduite");

/** The hours of each site (the prototype's heuresSites, every period): distinct (act, period)
 * pairs, never counted twice for two zones of one site. */
function heures(d: Donnees, sites: CarteSite[]): Record<string, { heures: number; n: number }> {
  const Z = d.f.zones;
  const insee = d.insee;
  const sit = new Set(sites.map((u) => u.id));
  const zid = new Map(Z.zones.map((z) => [z.id, z]));
  const out = new Map<string, { heures: number; actes: Set<string>; seen: Set<string> }>();
  for (const a of Z.autorisations) {
    if (!a.insee.includes(insee) || !["drone", "vsa"].includes(a.kind) || nonDeduite(d, a.acte))
      continue;
    const ss = new Set(
      a.zones
        .map((id) => zid.get(id))
        .filter((z) => z && z.statut !== "relecture")
        .map((z) => String(z?.site ?? ""))
        .filter((s) => sit.has(s)),
    );
    for (const p of a.periodes)
      for (const s of ss) {
        const x = out.get(s) ?? { heures: 0, actes: new Set<string>(), seen: new Set<string>() };
        const k = `${a.acte}|${p.t0}|${p.t1}`;
        if (!x.seen.has(k)) {
          x.seen.add(k);
          x.heures += p.heures ?? 0;
        }
        x.actes.add(a.acte);
        out.set(s, x);
      }
  }
  return Object.fromEntries([...out].map(([k, x]) => [k, { heures: x.heures, n: x.actes.size }]));
}

export default {
  Vue: Commune,
  template,
  donnees: async (r: Route) => ({ d: await commune((r as Props).insee) }),
} as unknown as VueModule;
