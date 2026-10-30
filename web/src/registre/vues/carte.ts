// View 6 · Commune · Carte et drones (/registre/commune/<insee>/carte[?mois=YYYY-MM]; mockup
// CarteTemps-grand, the prototype's vues/carte.js): the tilted map (carte3d.ts) in the mockup's frame,
// its layers and its panel, the frieze of the slots of flight with its brush, the list. The slots are
// the build's (the commune file's `drones`, pipeline drones.py): the hours the acts state, grouped by
// period and sites; an act whose zone was not deduced is only listed, with its source, never drawn.
// The map, the frieze and the list follow one state: a period (all dates, ?mois= or the brush), a
// chosen slot, a hovered one.
import type { Carte, Site as CarteSite, Translate, Unit } from "../carte3d.ts";
import { etatDepartement } from "../collecte.ts";
import { benefLabel, commune, communeHref, type Donnees, filCommune, tete } from "../commun.ts";
import type { Handler, Rich } from "../dc.ts";
import { count, longMonth } from "../format.ts";
import { t } from "../i18n.ts";
import type { VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { signaler } from "../signaler.ts";
import { type BaseState, Vue } from "../vue.ts";
import template from "./carte.html?raw";
import {
  attribution,
  bars,
  type Creneau,
  dateTxt,
  drones,
  heuresTxt,
  mois,
  months,
  msOf,
  type NonDeduit,
  overlaps,
  sitesHours,
  span,
  sumHours,
  xOf,
} from "./carte-outils.ts";

const PLAY_MS = 1400;
const ROW =
  "all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 210px 180px minmax(0, 1fr) minmax(110px, auto); gap: 14px; align-items: center; min-height: 46px; padding: 0 8px; border-bottom: 1px solid var(--rule); ";
const ROW_ON = "background: var(--soft); box-shadow: inset 4px 0 0 var(--accent-fill)";
// the layers' chips: the mockup's swatches (a camera: a dark ringed point)
const LAYERS: [keyof Couches, string, string][] = [
  ["cams", "carte.couche_cams", "background: #111; box-shadow: 0 0 0 2px #f2efe6, 0 0 0 3px #111"],
  [
    "vsa",
    "carte.couche_vsa",
    "background: repeating-linear-gradient(45deg, #ffe800 0 3px, #111 3px 6px)",
  ],
  ["drones", "carte.couche_drones", "background: #7fd4ff"],
];

type Couches = { cams: boolean; vsa: boolean; drones: boolean };
type Props = Extract<Route, { view: "carte" }> & { d: Donnees };
type State = BaseState &
  Couches & {
    r0: number | null;
    r1: number | null;
    /** the chosen slot, the hovered one, the chosen act without a zone (-1: none) */
    cur: number;
    hov: number;
    nd: number;
    playing: boolean;
    info: boolean;
    carte: "attente" | "ok" | "absente";
    /** the map file's credit for its cameras (OpenStreetMap, ODbL) */
    source: string;
  };

const theme = (): "light" | "dark" =>
  document.documentElement.dataset.mode === "dark" ? "dark" : "light";
const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
const today = (): number => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

class CarteDrones extends Vue<Props, State> {
  private map: Carte | null = null;
  private dead = false;
  private player = 0;
  private drag: number | null = null;
  private synced = "";
  private making: HTMLElement | null = null;
  private park: HTMLElement | null = null;
  private readonly onTheme = () => this.map?.setTheme(theme());

  protected init(p: Props): Partial<State> {
    const r = mois(p.mois);
    return {
      r0: r?.[0] ?? null,
      r1: r?.[1] ?? null,
      cur: -1,
      hov: -1,
      nd: -1,
      playing: false,
      info: false,
      cams: true,
      vsa: true,
      drones: true,
      carte: "attente",
      source: "",
    };
  }
  titre(): string {
    return t("carte.titre_vue", { nom: this.props.d.f.commune.nom });
  }
  private get T(): Creneau[] {
    return drones(this.props.d).creneaux;
  }
  private get ND(): NonDeduit[] {
    return drones(this.props.d).non_deduits;
  }
  private range() {
    const { A, B } = span(this.T, today());
    const S = this.state;
    return { A, B, r0: S.r0 ?? A, r1: S.r1 ?? B, all: S.r0 == null };
  }
  private shownKind(c: Creneau): boolean {
    return (c.kind === "drone" && this.state.drones) || (c.kind === "vsa" && this.state.vsa);
  }

  // --- the map ---------------------------------------------------------------------------------
  componentDidMount(): void {
    addEventListener("themechange", this.onTheme);
    this.player = window.setInterval(() => {
      const n = this.T.length;
      if (this.state.playing && n && !reduced())
        this.setState({ cur: (this.state.cur + 1) % n, hov: -1, nd: -1 });
      else if (this.state.playing) this.setState({ playing: false });
    }, PLAY_MS);
    setTimeout(() => void this.mountMap(), 0);
  }
  componentWillUnmount(): void {
    this.dead = true;
    removeEventListener("themechange", this.onTheme);
    clearInterval(this.player);
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
  componentDidUpdate(): void {
    this.syncMap();
  }
  private async mountMap(): Promise<void> {
    const d = this.props.d;
    const nom = d.f.commune.nom;
    const el = document.getElementById("carte-tps");
    if (!el || this.dead) return;
    // an uncut map: said at once, nothing asked (neither MapLibre nor a file that is not there)
    if (d.f.carte.decoupee === false) {
      this.absent(el, nom);
      return;
    }
    try {
      const { carte, carteUrl } = await import("../carte3d.ts");
      if (this.dead) return;
      const r = await fetch(carteUrl(d.insee));
      const data = r.ok && /json/.test(r.headers.get("content-type") ?? "") ? await r.json() : null;
      if (this.dead || !el.isConnected) return;
      if (!data?.contour) {
        this.absent(el, nom);
        return;
      }
      this.setState({ carte: "ok", source: typeof data.source === "string" ? data.source : "" });
      const tr: Translate = (k, p) => t(k.replace(/^registre\./, ""), p);
      this.making = el;
      let m: Carte;
      try {
        m = await carte(el, {
          data,
          t: tr,
          theme: theme(),
          sites: this.sites(),
          couches: { cams: this.state.cams, vsa: this.state.vsa, drones: this.state.drones },
          // no turn (the mockup's map turns by hand only), no control of its own: the frame has its N
          play: false,
          controles: false,
          etiquettes: "survol",
          slowStop: !/[?&]perf=1\b/.test(location.search),
          capture: /[?&]capture=1\b/.test(location.search),
          label: this.alt(),
          onZone: (u) => this.onZone(u),
          onHover: (u) => this.onHover(u),
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
      this.synced = "";
      this.syncMap();
      el.dataset.prete = "1";
      document.dispatchEvent(new Event("carteprete"));
    } catch (e) {
      // a device that cannot draw it (no WebGL2): said in the frame, the page stays whole
      this.park?.remove();
      if (this.dead) return;
      console.warn(e);
      if (el.isConnected && !this.map) this.absent(el, nom, "commune.carte_erreur");
    }
  }
  /** No map cut for this commune, or none drawn: the frame says so (L'essentiel's sentence). */
  private absent(el: HTMLElement, nom: string, key = "commune.carte_absente"): void {
    const p = document.createElement("p");
    p.textContent = t(key, { nom });
    p.style.cssText = "margin: 0; padding: 20px; color: var(--muted)";
    el.replaceChildren(p);
    this.setState({ carte: "absente" });
  }
  /** The sites the slots draw (the build's: never a zone not deduced or under review). */
  private sites(): CarteSite[] {
    const used = new Set(this.T.flatMap((c) => c.sites));
    return this.props.d.f.zones.sites.filter((s) => used.has(s.id)) as unknown as CarteSite[];
  }
  /** The first slot over a site: the chosen one if it is, else the first in the period. */
  private slotOf(site: string): number {
    const S = this.state;
    const T = this.T;
    if (S.cur >= 0 && T[S.cur].sites.includes(site)) return S.cur;
    const { r0, r1 } = this.range();
    return T.findIndex((c) => c.sites.includes(site) && this.shownKind(c) && overlaps(c, r0, r1));
  }
  private onZone(u: Unit | null): void {
    if (!u) return;
    const i = this.slotOf(u.id);
    if (i >= 0) this.setState({ cur: i, nd: -1, playing: false });
  }
  private onHover(u: Unit | null): void {
    const i = u ? this.slotOf(u.id) : -1;
    if (i !== this.state.hov) this.setState({ hov: i });
  }
  /** The map follows: the hours of each site over the period, or the chosen slot's; the layers. */
  private syncMap(): void {
    const m = this.map;
    if (!m) return;
    const S = this.state;
    const key = [S.r0, S.r1, S.cur, S.hov, S.drones, S.vsa, S.cams].join("|");
    if (key === this.synced) return;
    this.synced = key;
    const T = this.T;
    const { r0, r1 } = this.range();
    const shown =
      S.cur >= 0
        ? [T[S.cur]].filter((c) => this.shownKind(c))
        : T.filter((c) => this.shownKind(c) && overlaps(c, r0, r1));
    m.setHeures(sitesHours(shown));
    m.setCouches({ cams: S.cams, vsa: S.vsa, drones: S.drones });
    const f = S.hov >= 0 ? T[S.hov] : S.cur >= 0 ? T[S.cur] : null;
    m.select(f?.sites[0] ?? null);
    m.hover(S.hov >= 0 ? (T[S.hov].sites[0] ?? null) : null);
  }
  private alt(): string {
    const { r0, r1 } = this.range();
    const places = new Set(this.T.filter((c) => overlaps(c, r0, r1)).flatMap((c) => c.sites)).size;
    return t("carte.alt", { nom: this.props.d.f.commune.nom, n: places });
  }

  // --- the page --------------------------------------------------------------------------------
  private pickSlot(i: number): Handler {
    return () => this.setState({ cur: i, nd: -1, hov: -1, playing: false });
  }
  private hoverSlot(i: number): Handler {
    return () => {
      if (this.state.hov !== i) this.setState({ hov: i });
    };
  }

  renderVals() {
    const S = this.state;
    const d = this.props.d;
    const insee = d.insee;
    const nom = d.f.commune.nom;
    const T = this.T;
    const ND = this.ND;
    const n = T.length;
    const { A, B, r0, r1, all } = this.range();
    const allMode = all && S.cur < 0;
    const inR = (c: Creneau) => overlaps(c, r0, r1);

    // the frieze
    const placed = bars(T, A, B);
    const barVals = T.map((c, i) => {
      const on = S.cur === i || S.hov === i;
      const vis = this.shownKind(c) && (S.cur >= 0 ? S.cur === i : inR(c));
      const sure = c.heures != null;
      return {
        x: placed[i].x.toFixed(1),
        y: placed[i].y,
        w: placed[i].w.toFixed(1),
        fill: on ? "var(--accent-fill)" : c.kind === "vsa" ? "#b38f00" : "var(--drone)",
        op: vis ? 1 : 0.3,
        stroke: sure ? "none" : "var(--fg)",
        sw: sure ? 0 : 1.2,
        dash: sure ? "none" : "3 2",
        hover: this.hoverSlot(i),
        pick: ((e) => {
          e.stopPropagation();
          this.setState({ cur: i, nd: -1, playing: false });
        }) as Handler,
      };
    });
    const ticks = months(A, B).map((m) => ({ x: m.x.toFixed(1), tx: m.tx.toFixed(1), l: m.l }));
    const brush = {
      x: xOf(r0, A, B).toFixed(1),
      w: Math.max(2, xOf(r1, A, B) - xOf(r0, A, B)).toFixed(1),
    };
    const ax = Math.min(1140, xOf(today(), A, B));
    const auj = { x: ax.toFixed(1), tx: (ax - 4).toFixed(1) };
    const svgX = (e: { currentTarget: Element; clientX: number }) => {
      const r = e.currentTarget.getBoundingClientRect();
      return ((e.clientX - r.left) * 1144) / (r.width || 1144);
    };

    // the panel: a slot, an act without a zone, or the period
    const act = T.map((c, i) => ({ c, i })).filter(
      (o) => this.shownKind(o.c) && (S.cur >= 0 ? o.i === S.cur : inR(o.c)),
    );
    const rangeH = Math.round(
      sumHours(
        act.map((o) => o.c),
        S.cur >= 0 || allMode ? null : [r0, r1],
      ),
    );
    const places = new Set(act.flatMap((o) => o.c.sites)).size;
    const focus = S.hov >= 0 ? S.hov : S.cur;
    let det: {
      kicker: string;
      title: string;
      rows: { k: string; v: string }[];
      note: string;
      links: { l: string; href: string }[];
    };
    if (focus >= 0) {
      const c = T[focus];
      const kicker = [t("carte.creneau_n_sur", { i: focus + 1, n })];
      if (c.sites.length)
        kicker.push(t(c.statut === "relu" ? "carte.trace_relu" : "carte.trace_indicatif"));
      if (c.kind === "vsa") kicker.push(t("carte.analyse_algorithmique"));
      const sig = signaler(d.ev.get(c.actes[0]) ?? { id: c.actes[0], affaire: c.actes[0] });
      det = {
        kicker: kicker.join(" · "),
        title: dateTxt(c.t0, true),
        rows: [
          {
            k: t("carte.duree"),
            v: c.heures != null ? heuresTxt(c.heures) : t("carte.horaires_non_precises_arrete"),
          },
          { k: t("carte.service"), v: c.service ?? t("commun.non_precise") },
          { k: t("carte.arretes"), v: String(c.actes.length) },
          { k: t("carte.fin"), v: dateTxt(c.t1, true) },
        ],
        note: t("carte.pour", { fin: c.finalite ?? t("carte.finalite_non_lue") }),
        links: [...(c.url ? [{ l: t("arretes.voir"), href: c.url }] : []), ...(sig ? [sig] : [])],
      };
    } else if (S.nd >= 0 && ND[S.nd]) {
      const a = ND[S.nd];
      const e = d.ev.get(a.acte);
      const sig = signaler(e ?? { id: a.acte, affaire: a.acte });
      det = {
        kicker: t(a.kind === "vsa" ? "carte.nd_kicker_vsa" : "carte.nd_kicker_drone"),
        title: a.date ? dateTxt(Date.parse(`${a.date}T00:00:00Z`)) : t("format.date_non_publiee"),
        rows: [
          { k: t("carte.service"), v: e ? benefLabel(e) : t("commun.non_precise") },
          ...(a.ref
            ? [
                {
                  k: t("carte.source"),
                  v: a.page ? t("carte.ref_page", { ref: a.ref, page: String(a.page) }) : a.ref,
                },
              ]
            : []),
        ],
        note: t("carte.nd_note"),
        links: [...(a.url ? [{ l: t("arretes.voir"), href: a.url }] : []), ...(sig ? [sig] : [])],
      };
    } else if (!n)
      det = {
        kicker: t("carte.toutes_les_dates_collectees"),
        title: t("carte.aucun_creneau"),
        rows: [
          { k: t("carte.creneaux_de_vol"), v: "0" },
          ...(ND.length ? [{ k: t("carte.arretes_sans_zone"), v: String(ND.length) }] : []),
        ],
        note: ND.length ? t("carte.nd_survol") : "",
        links: [],
      };
    else
      det = {
        kicker: t(allMode ? "carte.toutes_les_dates_collectees" : "carte.periode_choisie"),
        title: `${dateTxt(r0)} → ${dateTxt(r1)}`,
        rows: [
          { k: t("carte.creneaux_de_vol"), v: String(act.length) },
          { k: t("carte.heures_autorisees"), v: heuresTxt(rangeH) },
          { k: t("carte.endroits"), v: String(places) },
        ],
        note: t("carte.survolez"),
        links: [],
      };

    // the list: the slots of the period, or the chosen one and those before, newest first; then the
    // acts whose zone was not deduced (listed, never drawn)
    const listIdx = T.map((_, i) => i)
      .filter((i) => this.shownKind(T[i]) && (S.cur >= 0 ? i <= S.cur : inR(T[i])))
      .reverse();
    const rows = listIdx.map((i) => {
      const c = T[i];
      const on = i === S.cur || i === S.hov;
      return {
        d: dateTxt(c.t0, true),
        svc: c.service ?? t("commun.non_precise"),
        fin: c.finalite ?? t("carte.finalite_non_lue"),
        h: c.heures != null ? heuresTxt(c.heures) : t("carte.horaires_non_precises"),
        hover: this.hoverSlot(i),
        pick: this.pickSlot(i),
        style: ROW + (on ? ROW_ON : ""),
      };
    });
    const ndRows = ND.map((a, i) => {
      const e = d.ev.get(a.acte);
      const on = S.nd === i && focus < 0;
      return {
        d: a.date ? dateTxt(Date.parse(`${a.date}T00:00:00Z`)) : t("format.date_non_publiee"),
        svc: e ? benefLabel(e) : t("commun.non_precise"),
        fin: [t("arretes.zone_non_deduite"), a.ref].filter(Boolean).join(" · "),
        h: t("carte.non_dessine"),
        pick: (() => this.setState({ nd: i, cur: -1, hov: -1, playing: false })) as Handler,
        style: ROW + (on ? ROW_ON : ""),
      };
    });

    // nothing to place on the frieze: said, with why when it is known
    let vide: Rich = "";
    if (!n) {
      const couv = d.f.couverture.departement;
      const nArr = d.all.filter((e) => /^arrete_(drone|vsa)$/.test(e.t)).length;
      if (couv.etat !== "collecte" && !nArr)
        vide = [
          `${etatDepartement(d.f.commune.dep, d.f.stats.dep.nom, couv)} `,
          { a: { href: "/registre/couverture", text: t("carte.vide_couverture") } },
        ];
      else if (nArr)
        vide = [
          `${t("carte.vide_arretes", { nom, arr: count(nArr, "arrete") })} `,
          { a: { href: communeHref(insee, "autorisations"), text: t("carte.vide_autorisations") } },
        ];
      else vide = t("carte.vide_aucun", { nom });
    }

    const layers = LAYERS.map(([k, l, sw]) => ({
      l: t(l),
      pressed: S[k] ? "true" : "false",
      pick: (() => this.setState({ [k]: !S[k] } as Partial<State>)) as Handler,
      sw: `display: inline-block; width: 14px; height: 14px; border-radius: 50%; margin-right: 8px; vertical-align: -2px; ${sw}${S[k] ? "" : "; opacity: .35"}`,
      style: S[k]
        ? "background: var(--fg); color: var(--bg)"
        : "background: var(--bg-2); color: var(--fg)",
    }));
    const playOff = reduced() || !n;

    return {
      ...this.base("carte"),
      ...filCommune(d, t("commun.onglet_carte")),
      com: tete(d, "carte"),
      layers,
      det,
      bars: barVals,
      months: ticks,
      brush,
      auj,
      rows,
      frise: n > 0,
      vide,
      nd: {
        show: ND.length > 0,
        title: t("carte.nd_titre", { n: ND.length }),
        rows: ndRows,
      },
      carteOk: S.carte !== "absente",
      attrib: S.carte === "ok" ? attribution(S.source) : "",
      alt: this.alt(),
      tlAlt: t("carte.frise_alt", {
        n,
        nom,
        de: longMonth(new Date(A).toISOString().slice(0, 10)),
        a: longMonth(new Date(today()).toISOString().slice(0, 10)),
      }),
      rangeLabel:
        S.cur >= 0
          ? t("carte.creneau_n_sur", { i: S.cur + 1, n })
          : allMode
            ? t("carte.range_tout", {
                creneaux: t("carte.creneaux", { n: act.length }),
                h: heuresTxt(rangeH),
              })
            : t("carte.range_periode", {
                de: dateTxt(r0),
                a: dateTxt(r1),
                creneaux: t("carte.creneaux", { n: act.length }),
                h: heuresTxt(rangeH),
              }),
      listTitle:
        S.cur >= 0
          ? t("carte.liste_choisi")
          : allMode
            ? t("carte.liste_tout", { n })
            : t("carte.liste_periode", { creneaux: t("carte.creneaux", { n: act.length }) }),
      all: (() =>
        this.setState({ r0: null, r1: null, cur: -1, hov: -1, nd: -1, playing: false })) as Handler,
      allPressed: allMode ? "true" : "false",
      allStyle: allMode ? "background: var(--fg); color: var(--bg)" : "",
      prev: (() =>
        n &&
        this.setState({
          cur: S.cur <= 0 ? n - 1 : S.cur - 1,
          nd: -1,
          hov: -1,
          playing: false,
        })) as Handler,
      next: (() =>
        n && this.setState({ cur: (S.cur + 1) % n, nd: -1, hov: -1, playing: false })) as Handler,
      // « Lire » walks the slots one by one; never under prefers-reduced-motion (the prototype's)
      play: (() => {
        if (playOff) return;
        this.setState({ playing: !S.playing, cur: S.cur < 0 ? 0 : S.cur, nd: -1, hov: -1 });
      }) as Handler,
      playOff: playOff ? "disabled" : null,
      playText: t(S.playing ? "carte.pause" : "carte.lire"),
      playPressed: S.playing ? "true" : "false",
      showInfo: S.info,
      infoOpen: S.info ? "true" : "false",
      tglInfo: (() => this.setState({ info: !S.info })) as Handler,
      tdown: ((e) => {
        // a drag chooses a period, it does not select the months' words
        e.preventDefault();
        this.drag = svgX(e);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // no capture (a synthetic event)
        }
      }) as Handler,
      tmove: ((e) => {
        if (this.drag == null) return;
        const x = svgX(e);
        const a = Math.min(this.drag, x);
        const b = Math.max(this.drag, x);
        if (b - a > 4)
          this.setState({ r0: msOf(a, A, B), r1: msOf(b, A, B), cur: -1, nd: -1, playing: false });
      }) as Handler,
      tup: (() => {
        this.drag = null;
      }) as Handler,
      north: (() => this.map?.north()) as Handler,
    };
  }
}

export default {
  // its props are the route's and the commune's file (donnees), which the shell passes
  Vue: CarteDrones as unknown as VueModule["Vue"],
  template,
  donnees: async (r: Route) => ({ d: await commune((r as Props).insee) }),
} satisfies VueModule;
