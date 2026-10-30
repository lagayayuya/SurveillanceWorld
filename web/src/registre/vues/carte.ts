// View 6 · Commune · Carte et drones (/registre/commune/<insee>/carte[?mois=YYYY-MM]; board
// V2-CarteDrones): the register shrinks to a panel on the right (panneau()) and draws on the site's
// map behind it (drones.ts): the commune's outline, its drone zones as volumes whose height is the
// hours authorised on the period, the map tilted; the cameras are the fields the map already shows.
// Over the map: « ← Le registre » and the legend, the map's commands (3D, turn, north), « Heures de
// vol autorisées, par semaine ». In the panel: the commune's band, three tickets, the programme's
// note, the chosen slot's detail, the slots of the period. The slots are the build's (drones.py):
// an act whose zone was not deduced is only listed, never drawn. The map, the chart and the list
// follow one state: a period (every date, ?mois=, a month or a week clicked), a chosen slot, a
// hovered one. On leaving, the map loses all it was given and goes back where it was.
import type { Map as MlMap } from "maplibre-gl";
import { etatDepartementLie } from "../collecte.ts";
import { benefLabel, commune, communeHref, type Donnees } from "../commun.ts";
import type { Lexique } from "../corpus.ts";
import type { Handler, Rich } from "../dc.ts";
import {
  type Calque,
  type Contour,
  calque,
  entieres,
  lireContour,
  type Site,
  TEINTES,
  type Teintes,
} from "../drones.ts";
import { count, fr, longMonth } from "../format.ts";
import { carteDuSite } from "../hote.ts";
import { t } from "../i18n.ts";
import { departementHref, lienDocument } from "../liens.ts";
import type { Miette, VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { signaler } from "../signaler.ts";
import { couleur, icone, repere as repereType } from "../types.ts";
import { type BaseState, large, Vue } from "../vue.ts";
import template from "./carte.html?raw";
import "./carte.css";
import {
  type Creneau,
  dansPeriode,
  dateTxt,
  deGenre,
  drones,
  type Genre,
  genre,
  heuresTxt,
  jourTxt,
  mois,
  moisAxe,
  type NonDeduit,
  overlaps,
  type Periode,
  repere,
  type Semaine,
  semaines,
  sitesHours,
  span,
  tickets,
  volLabel,
} from "./carte-outils.ts";

/** The tilt of the map in 3D, degrees (R1a's tilted map's). */
const PITCH = 50;
/** One press of a turn button, degrees. */
const TURN = 45;
const MOVE_MS = 900;
/** How long after its flight a move of the site's own undoes it and is flown over again. */
const REFAIRE_MS = 6000;
/** The mark on the view's own camera moves (maplibre passes it to their events). */
const NOTRE = { rgcd: true };
/** The chart's height in its viewBox: the axis at 104, the reference line at 14. */
const AXE = 104;
const HAUT = 14;

type Props = Extract<Route, { view: "carte" }> & { d: Donnees };
type State = BaseState & {
  r0: number | null;
  r1: number | null;
  /** the chosen slot, the hovered one, the chosen act without a slot (-1: none) */
  cur: number;
  hov: number;
  nd: number;
  /** the week shown in the chart's tooltip (-1: none) */
  wk: number;
  /** the chart's width, CSS px */
  fw: number;
  /** the sites over the whole commune, or nearly (drones.ts entieres, once the outline is read) */
  ent: string[];
  /** the kind of act shown: drones, algorithms, or both (null) */
  k: Genre;
  is3d: boolean;
};

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
const today = (): number => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const DAY = 86_400_000;
/** A place outside the view widened by its own size on each side: too far to fly to. */
function loin(map: MlMap, [lng, lat]: [number, number]): boolean {
  const b = map.getBounds();
  const dx = b.getEast() - b.getWest();
  const dy = b.getNorth() - b.getSouth();
  return (
    lng < b.getWest() - dx ||
    lng > b.getEast() + dx ||
    lat < b.getSouth() - dy ||
    lat > b.getNorth() + dy
  );
}

class CarteDrones extends Vue<Props, State> {
  private map: MlMap | null = null;
  private layer: Calque | null = null;
  private dead = false;
  private abort = new AbortController();
  /** When the flight to the commune left (performance.now()), and whether it was flown again. */
  private parti = 0;
  private refait = false;
  private ro: ResizeObserver | null = null;
  /** the period whose hours the map shows */
  private synced = "";
  /** The theme changed: the ink again, once the site has restyled its map (at once, or at its idle). */
  private readonly onTheme = () => {
    const f = () => this.layer?.encre(this.teintes());
    requestAnimationFrame(f);
    this.map?.once("idle", f);
  };
  /** A move the view did not ask for and no hand made, soon after its flight: the site's map
   * framing the commune itself (a page opened cold: main.ts ?insee=, its sheet's fitBounds at the
   * map's idle) undid the flight; once again, then never. */
  private readonly onMove = (e: { originalEvent?: unknown; rgcd?: boolean }) => {
    if (e.rgcd || e.originalEvent || this.refait || this.dead || !this.map) return;
    if (performance.now() - this.parti > REFAIRE_MS) return;
    this.refait = true;
    this.voler(this.map);
  };
  private readonly onPitch = () => {
    const on = (this.map?.getPitch() ?? 0) > 5;
    if (on !== this.state.is3d) this.setState({ is3d: on });
  };

  protected init(p: Props): Partial<State> {
    const r = mois(p.mois);
    return {
      r0: r?.[0] ?? null,
      r1: r?.[1] ?? null,
      cur: -1,
      hov: -1,
      nd: -1,
      wk: -1,
      fw: large() ? 868 : 340,
      ent: [],
      k: genre(
        new URLSearchParams(typeof location === "object" ? location.search : "").get("genre"),
      ),
      is3d: true,
    };
  }
  panneau(): boolean {
    return true;
  }
  titre(): string {
    return t("carte.titre_vue", { nom: this.props.d.f.commune.nom });
  }
  type(): "commune" {
    return "commune";
  }
  fil(): Miette[] {
    const d = this.props.d;
    const dep = d.f.commune.dep;
    return [
      { k: "registre", l: t("types.registre.l"), href: "/registre/" },
      { k: "departement", l: d.f.stats.dep.nom ?? dep, href: departementHref(dep) },
    ];
  }
  private get T(): Creneau[] {
    return drones(this.props.d).creneaux;
  }
  private get ND(): NonDeduit[] {
    return drones(this.props.d).non_deduits;
  }
  private periode(): Periode {
    const S = this.state;
    return S.r0 == null || S.r1 == null ? null : [S.r0, S.r1];
  }
  /** A slot of the kind shown, in the period. */
  private inP(c: Creneau): boolean {
    const r = this.periode();
    return deGenre(this.state.k, c.kind) && (!r || overlaps(c, r[0], r[1]));
  }
  /** The theme's ink, ground and documents' colour, as the page has them (tokens.css). */
  private teintes(): Teintes {
    const el = document.querySelector(".v-carte") ?? document.documentElement;
    const css = getComputedStyle(el);
    const v = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
    return {
      encre: v("--fg", TEINTES.encre),
      fond: v("--bg", TEINTES.fond),
      doc: v("--type-document", TEINTES.doc),
    };
  }

  // --- the site's map ---------------------------------------------------------------------------
  componentDidMount(): void {
    addEventListener("themechange", this.onTheme);
    const g = document.querySelector<HTMLElement>(".v-carte .frise-g");
    if (g && typeof ResizeObserver === "function") {
      this.ro = new ResizeObserver(([e]) => {
        const w = Math.round(e.contentRect.width);
        if (w > 100 && Math.abs(w - this.state.fw) > 1) this.setState({ fw: w });
      });
      this.ro.observe(g);
    }
    const map = carteDuSite();
    if (!map) return;
    this.map = map;
    map.on("pitchend", this.onPitch);
    map.on("moveend", this.onMove);
    void this.poser(map);
  }
  /** The outline (it says which zones are the whole commune), then the layers once the map's style
   * is there, then the flight to the commune. */
  private async poser(map: MlMap): Promise<void> {
    const d = this.props.d;
    const used = new Set(this.T.flatMap((c) => c.sites));
    const sites = d.f.zones.sites.filter((s) => used.has(s.id)) as unknown as Site[];
    // the outline from the register's map file, its head only (drones.ts lireContour), before the
    // layers: a zone over the whole commune is never drawn first as a volume
    let contour: Contour | null = null;
    if (d.f.carte.decoupee !== false) {
      try {
        contour = await lireContour(d.insee, this.abort.signal);
      } catch {
        // no outline: the site's own commune shape stays
      }
    }
    if (this.dead) return;
    if (contour) {
      const ent = [...entieres(sites, d.insee, contour.contour)];
      if (ent.length) this.setState({ ent });
    }
    const make = (): boolean => {
      if (this.dead || this.layer) return true;
      try {
        this.layer = calque(map, {
          insee: d.insee,
          sites,
          teintes: this.teintes(),
          onChoix: (id) => {
            const i = this.slotOf(id);
            if (i >= 0) this.setState({ cur: i, nd: -1, hov: -1 });
          },
        });
        if (contour) this.layer.contour(contour);
        this.synced = "";
        this.syncMap();
        return true;
      } catch {
        // the map's style is still loading: again when it is
        return false;
      }
    };
    if (!make())
      await new Promise<void>((done) => {
        const again = () => {
          if (make()) {
            map.off("styledata", again);
            done();
          }
        };
        map.on("styledata", again);
      });
    if (this.dead || !this.layer) return;
    this.voler(map);
  }
  /** To the commune, tilted, in the part of the map the panel and the chart leave free. */
  private voler(map: MlMap): void {
    const box = this.layer?.cadre();
    const pitch = this.state.is3d ? PITCH : 0;
    const duration = reduced() ? 0 : MOVE_MS * 1.6;
    this.parti = performance.now();
    if (!box) {
      map.easeTo({ pitch, duration }, NOTRE);
      return;
    }
    const W = innerWidth;
    const H = innerHeight;
    const padding = large()
      ? {
          top: 80,
          left: Math.min(380, W * 0.2),
          right: Math.min(W - 300, 24 + 470 + 90),
          bottom: Math.min(H - 300, 24 + 184 + 30),
        }
      : { top: 70, left: 16, right: 64, bottom: Math.round(H / 2) + 16 };
    const cam = map.cameraForBounds(
      [
        [box[0], box[1]],
        [box[2], box[3]],
      ],
      { padding, pitch, bearing: map.getBearing() },
    );
    if (!cam) return;
    // from far away (a cold open of the page: the map starts at its default place) a jump, not a
    // flight that would load every tile on its way
    if (loin(map, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]))
      map.jumpTo({ ...cam, pitch }, NOTRE);
    else map.flyTo({ ...cam, pitch, duration, essential: true }, NOTRE);
  }
  componentWillUnmount(): void {
    this.dead = true;
    this.abort.abort();
    removeEventListener("themechange", this.onTheme);
    this.ro?.disconnect();
    const map = this.map;
    if (!map) return;
    map.off("pitchend", this.onPitch);
    map.off("moveend", this.onMove);
    this.layer?.retirer();
    this.layer = null;
    // the map stays where the view left it: on the commune (v2.1 A5)
    this.map = null;
  }
  componentDidUpdate(): void {
    this.syncMap();
  }
  /** The first slot over a site: the chosen one if it is, else the latest in the period. */
  private slotOf(site: string): number {
    const S = this.state;
    const T = this.T;
    if (S.cur >= 0 && T[S.cur].sites.includes(site)) return S.cur;
    for (let i = T.length - 1; i >= 0; i--)
      if (T[i].sites.includes(site) && this.inP(T[i])) return i;
    return -1;
  }
  /** The map follows: each site's hours over the period (new data only when the period changes),
   * the sites of the row hovered and of the slot chosen (feature states, nothing else). */
  private syncMap(): void {
    const L = this.layer;
    if (!L) return;
    const S = this.state;
    const T = this.T;
    const hoursKey = `${S.r0}|${S.r1}`;
    if (hoursKey !== this.synced) {
      const hs = sitesHours(
        T.filter((c) => this.inP(c)),
        this.periode(),
      );
      L.heures(
        Object.fromEntries(Object.entries(hs).map(([k, v]) => [k, { ...v, mots: volLabel(v) }])),
      );
      this.synced = hoursKey;
    }
    L.survoler(S.hov >= 0 ? T[S.hov].sites : []);
    L.choisir(S.cur >= 0 ? T[S.cur].sites : []);
  }

  // --- the page --------------------------------------------------------------------------------
  private pickSlot(i: number): Handler {
    return () => {
      if (this.state.cur !== i || this.state.nd >= 0) this.setState({ cur: i, nd: -1, hov: -1 });
    };
  }
  private hoverSlot(i: number): Handler {
    return () => {
      if (this.state.hov !== i) this.setState({ hov: i });
    };
  }
  private setPeriode(r: Periode): void {
    this.setState({ r0: r?.[0] ?? null, r1: r?.[1] ?? null, cur: -1, hov: -1, nd: -1 });
  }
  private ease(o: { pitch?: number; bearing?: number }): void {
    this.map?.easeTo({ ...o, duration: reduced() ? 0 : MOVE_MS }, NOTRE);
  }

  renderVals() {
    const S = this.state;
    const d = this.props.d;
    const L: Lexique = {
      entreprises: d.f.entreprises,
      acheteurs: d.f.acheteurs,
      communes: d.f.communes,
    };
    const insee = d.insee;
    const nom = d.f.commune.nom;
    const T = this.T;
    const ND = this.ND;
    const r = this.periode();
    const now = today();
    const { A, B } = span(T, now);
    const drone = S.k === "vsa" ? [] : T.filter((c) => c.kind === "drone");

    // the tickets: the period's
    const tk = tickets(T, ND, r, S.k);

    // the chart: one bar per week, the months under it
    const W = Math.max(200, S.fw);
    const weeks = semaines(drone, A, B);
    const n = weeks.length;
    const step = (W - 4) / n;
    const bw = Math.max(2, Math.min(18, step * 0.62));
    const top = repere(Math.max(0, ...weeks.map((w) => w.heures)));
    const yOf = (h: number) => AXE - (h / top) * (AXE - HAUT);
    const xOf = (ms: number) => 2 + ((ms - A) / (B - A)) * (W - 4);
    const focus = S.hov >= 0 ? S.hov : S.cur;
    const weekOf = (i: number) =>
      i >= 0 ? weeks.findIndex((w) => T[i].t0 >= w.t0 && T[i].t0 < w.t1) : -1;
    const selWeek = weekOf(focus);
    // chosen: the week of the slot chosen, or the week the period is; hovered: the week of the row
    // hovered or the bar pointed at (v2.1 A1: ink, never yellow)
    const choisie = weekOf(S.cur);
    const pointee = S.hov >= 0 ? weekOf(S.hov) : S.wk;
    const inR = (w: Semaine) => !r || (w.t1 > r[0] && w.t0 < r[1]);
    const wk = weeks.map((w, i) => {
      const h = w.heures > 0 ? Math.max(2, AXE - yOf(w.heures)) : 0;
      const x = 2 + i * step;
      const plein = i === choisie || (!!r && r[0] === w.t0 && r[1] === w.t1);
      const fin = i === pointee;
      return {
        x: (x + (step - bw) / 2).toFixed(1),
        y: (AXE - h).toFixed(1),
        w: bw.toFixed(1),
        h: h.toFixed(1),
        hx: x.toFixed(1),
        hw: step.toFixed(1),
        st: `fill: ${plein ? "var(--fg)" : "var(--type-document)"}; stroke: ${fin ? "var(--fg)" : "var(--line)"}; stroke-width: ${h ? (fin ? 2 : 1) : 0}; opacity: ${plein || fin || inR(w) ? 1 : 0.35}`,
        hover: (() => {
          if (S.wk !== i) this.setState({ wk: i });
        }) as Handler,
        pick: (() => this.setPeriode([w.t0, w.t1])) as Handler,
      };
    });
    const tipTxt = (w: Semaine) =>
      t("carte.semaine_tip", {
        de: jourTxt(w.t0),
        h: heuresTxt(w.heures),
        n: w.actes,
      });
    const tips =
      S.wk >= 0 && weeks[S.wk]
        ? (() => {
            const txt = tipTxt(weeks[S.wk]);
            const tw = Math.round(txt.length * 6.3 + 16);
            const cx = 2 + S.wk * step + step / 2;
            const x = Math.max(0, Math.min(W - tw, cx - tw / 2));
            return [{ x: x.toFixed(1), w: tw, tx: (x + 8).toFixed(1), t: txt }];
          })()
        : [];
    const ms = moisAxe(drone, A, B);
    // the months' words as wide as the narrowest whole month allows, the same form for all:
    // « janv. 26 », else « janv », else « J » (the button's name says the month in full)
    const CH = 6.6;
    const wOf = (m: { t0: number; t1: number }) =>
      Math.max(0, xOf(Math.min(m.t1, B)) - xOf(Math.max(m.t0, A)));
    const whole = ms.filter((m) => m.t0 >= A && m.t1 <= B);
    const narrow = Math.min(...(whole.length ? whole : ms).map(wOf));
    const longest = Math.max(...ms.map((m) => m.l.length));
    const form = narrow >= longest * CH + 6 ? 2 : narrow >= 4 * CH + 4 ? 1 : 0;
    const word = (l: string) =>
      form === 2 ? l : form === 1 ? l.replace(/\..*$/, "") : l.slice(0, 1).toUpperCase();
    const months = ms.map((m) => {
      const wpx = wOf(m);
      const on = !!r && r[0] === m.t0 && r[1] === m.t1;
      const full = new Date(m.t0).toISOString().slice(0, 10);
      return {
        l: wpx < word(m.l).length * CH ? "" : word(m.l),
        aria: t("carte.mois_aria", { mois: longMonth(full), h: heuresTxt(m.heures) }),
        on: on ? "true" : "false",
        st: `width: ${wpx.toFixed(1)}px${wpx < 12 ? "; visibility: hidden" : ""}`,
        pick: (() => this.setPeriode(on ? null : [m.t0, m.t1])) as Handler,
      };
    });
    const shownWeek = (i: number) => {
      const k = Math.max(0, Math.min(n - 1, i));
      if (k !== S.wk) this.setState({ wk: k });
    };

    // the detail: the chosen (or hovered) slot, or the chosen act without a slot
    type Lien = { l: string; href: string; cls: string; c: string };
    let det: {
      c: string;
      i: string;
      k: string;
      title: Rich;
      rows: { k: string; v: string }[];
      note: string;
      links: Lien[];
    } | null = null;
    const aut = repereType("aut");
    const voir = (url: string | null): Lien[] =>
      url ? [{ l: t("arretes.voir"), href: url, cls: "lk", c: `--c: ${couleur("aut")}` }] : [];
    if (focus >= 0) {
      const c = T[focus];
      const e = d.ev.get(c.actes[0]);
      const sig = signaler(e ?? { id: c.actes[0], affaire: c.actes[0] });
      det = {
        c: aut.c,
        i: icone("aut"),
        k: t(c.kind === "vsa" ? "carte.det_vsa" : "carte.det_drone"),
        title: e ? [lienDocument(L, e, dateTxt(c.t0, true))] : dateTxt(c.t0, true),
        rows: [
          { k: t("carte.service"), v: c.service ?? t("commun.non_precise") },
          { k: t("carte.pour_k"), v: c.finalite ?? t("carte.finalite_non_lue") },
          {
            k: t("carte.duree"),
            v: c.heures != null ? heuresTxt(c.heures) : t("carte.horaires_non_precises_arrete"),
          },
          {
            k: t("carte.zone"),
            v: c.sites.length
              ? t(c.statut === "relu" ? "carte.zone_relue" : "carte.zone_indicative")
              : t("arretes.zone_non_deduite"),
          },
          ...(c.actes.length > 1 ? [{ k: t("carte.arretes"), v: String(c.actes.length) }] : []),
        ],
        note: "",
        links: [...voir(c.url), { ...sig, cls: "", c: "" }],
      };
    } else if (S.nd >= 0 && ND[S.nd]) {
      const a = ND[S.nd];
      const e = d.ev.get(a.acte);
      const sig = signaler(e ?? { id: a.acte, affaire: a.acte });
      const when = a.date
        ? dateTxt(Date.parse(`${a.date}T00:00:00Z`))
        : t("format.date_non_publiee");
      det = {
        c: aut.c,
        i: icone("aut"),
        k: t(a.kind === "vsa" ? "carte.det_vsa" : "carte.det_drone"),
        title: e ? [lienDocument(L, e, when)] : when,
        rows: [
          { k: t("carte.service"), v: e ? benefLabel(e) : t("commun.non_precise") },
          { k: t("carte.zone"), v: t("arretes.zone_non_deduite") },
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
        links: [...voir(a.url), { ...sig, cls: "", c: "" }],
      };
    }

    // the list: every slot of the period (DECISIONS 2026-10-29), newest first, the acts listed
    // without a slot among them by their date
    type Row = { at: number; row: Record<string, unknown> };
    const rows: Row[] = [];
    T.forEach((c, i) => {
      if (!this.inP(c)) return;
      const e = d.ev.get(c.actes[0]);
      const when = dateTxt(c.t0);
      const on = i === S.cur || i === S.hov;
      const toute = c.sites.length > 0 && c.sites.every((s) => S.ent.includes(s));
      const fin = [
        ...(c.sites.length ? [] : [t("carte.zone_non_deduite_court")]),
        ...(toute ? [t("carte.toute_la_commune")] : []),
        t(c.kind === "vsa" ? "carte.analyse_algorithmique" : "carte.mot_drones"),
        c.finalite ?? t("carte.finalite_non_lue"),
      ].join(" · ");
      rows.push({
        at: c.t0,
        row: {
          cls: on ? "zrow on" : "zrow",
          d: e ? [lienDocument(L, e, when, true)] : when,
          svc: c.service ?? t("commun.non_precise"),
          fin,
          h: c.heures != null ? heuresTxt(c.heures) : t("carte.horaires_non_precises"),
          hover: this.hoverSlot(i),
          pick: this.pickSlot(i),
        },
      });
    });
    ND.forEach((a, i) => {
      if (!deGenre(S.k, a.kind) || !dansPeriode(a.date, r)) return;
      const e = d.ev.get(a.acte);
      const when = a.date
        ? dateTxt(Date.parse(`${a.date}T00:00:00Z`))
        : t("format.date_non_publiee");
      rows.push({
        at: a.date ? Date.parse(`${a.date}T00:00:00Z`) : 0,
        row: {
          cls: S.nd === i && focus < 0 ? "zrow on" : "zrow",
          d: e ? [lienDocument(L, e, when, true)] : when,
          svc: e ? benefLabel(e) : t("commun.non_precise"),
          fin: [t("carte.zone_non_deduite_court"), a.ref].filter(Boolean).join(" · "),
          h: t("carte.non_dessine"),
          hover: (() => {}) as Handler,
          pick: (() => this.setState({ nd: i, cur: -1, hov: -1 })) as Handler,
        },
      });
    });
    rows.sort((a, b) => b.at - a.at);

    // nothing to list: said, with why when it is known
    let vide: Rich = "";
    if (!T.length && !ND.length) {
      const couv = d.f.couverture.departement;
      const nArr = d.all.filter((e) => /^arrete_(drone|vsa)$/.test(e.t)).length;
      if (couv.etat !== "collecte" && !nArr)
        vide = [
          { span: etatDepartementLie(d.f.commune.dep, d.f.stats.dep.nom, couv), cls: "" },
          " ",
          { a: { href: "/registre/couverture", text: t("carte.vide_couverture") } },
        ];
      else if (nArr)
        vide = [
          `${t("carte.vide_arretes", { nom, arr: count(nArr, "arrete") })} `,
          { a: { href: communeHref(insee, "autorisations"), text: t("carte.vide_autorisations") } },
        ];
      else vide = t("carte.vide_aucun", { nom });
    } else if (!rows.length) vide = t("carte.vide_periode");

    // the filter: drones, algorithms, or both, with the slots of each over the period
    const nDe = (k: Genre) =>
      T.filter((c) => deGenre(k, c.kind) && (!r || overlaps(c, r[0], r[1]))).length +
      ND.filter((a) => deGenre(k, a.kind) && dansPeriode(a.date, r)).length;
    const genres = ([null, "drone", "vsa"] as Genre[]).map((k) => {
      const n = nDe(k);
      return {
        l: t(
          k === "drone" ? "carte.f_drones" : k === "vsa" ? "carte.f_algorithmes" : "carte.f_tous",
        ),
        n: String(n),
        on: S.k === k ? "true" : "false",
        off: n === 0 && S.k !== k ? "true" : "false",
        pick: (() => {
          if (S.k !== k && (n > 0 || k === null))
            this.setState({ k, cur: -1, hov: -1, nd: -1, wk: -1 });
        }) as Handler,
      };
    });

    // the kind the tickets count: the one chosen, else the only one the commune has
    const vu: Genre = S.k ?? (genres[2].n === "0" ? "drone" : genres[1].n === "0" ? "vsa" : null);

    const isLarge = large();
    const lastDay = new Date(B - DAY).getTime();
    return {
      ...this.base("carte"),
      band: {
        r: repereType("commune"),
        nom,
        fiche: communeHref(insee),
        ici: communeHref(insee, "carte"),
        large: isLarge,
        tel: !isLarge,
      },
      hasVsa: T.some((c) => c.kind === "vsa" && c.sites.length) && S.k !== "drone",
      hasDrone: drone.some((c) => c.sites.length),
      hasEnt: S.ent.length > 0 && S.k !== "vsa",
      hasFrise: drone.length > 0,
      is3d: S.is3d ? "true" : "false",
      tog3d: (() => this.ease({ pitch: S.is3d ? 0 : PITCH })) as Handler,
      rotL: (() => this.ease({ bearing: (this.map?.getBearing() ?? 0) + TURN })) as Handler,
      rotR: (() => this.ease({ bearing: (this.map?.getBearing() ?? 0) - TURN })) as Handler,
      north: (() => this.ease({ bearing: 0 })) as Handler,
      titreLong: t("carte.titre_long"),
      genres,
      nA: String(tk.actes),
      lA: t(
        vu === "vsa" ? "carte.t_arretes_vsa" : vu ? "carte.t_arretes" : "carte.t_arretes_tous",
        {
          n: tk.actes,
        },
      ),
      nH: fr(tk.heures),
      nND: String(tk.nonDeduites),
      lND: t("carte.t_nd", { n: tk.nonDeduites }),
      rangeL: r
        ? t("carte.du_au", { de: dateTxt(r[0]), a: dateTxt(r[1] - DAY) })
        : t("carte.du_au", { de: dateTxt(A), a: dateTxt(Math.min(lastDay, now)) }),
      allOn: r ? "false" : "true",
      allYear: (() => this.setPeriode(null)) as Handler,
      fw: String(W),
      vb: `0 0 ${W} 112`,
      gridY: String(HAUT),
      gridTY: String(HAUT - 3),
      gridL: heuresTxt(top),
      wk,
      tips,
      tipLive: S.wk >= 0 && weeks[S.wk] ? tipTxt(weeks[S.wk]) : "",
      friseAlt: t("carte.frise_alt2", {
        nom,
        de: dateTxt(A),
        a: dateTxt(Math.min(lastDay, now)),
      }),
      wkFocus: (() => {
        if (S.wk < 0) shownWeek(selWeek >= 0 ? selWeek : n - 1);
      }) as Handler,
      wkLeave: (() => {
        if (S.wk >= 0 && document.activeElement?.closest(".frise-g") == null)
          this.setState({ wk: -1 });
      }) as Handler,
      wkKey: ((e) => {
        const k = e.key;
        if (k === "ArrowRight" || k === "ArrowDown") shownWeek(S.wk + 1);
        else if (k === "ArrowLeft" || k === "ArrowUp") shownWeek(S.wk < 0 ? n - 1 : S.wk - 1);
        else if (k === "Home") shownWeek(0);
        else if (k === "End") shownWeek(n - 1);
        else if ((k === "Enter" || k === " ") && weeks[S.wk])
          this.setPeriode([weeks[S.wk].t0, weeks[S.wk].t1]);
        else if (k === "Escape" && S.wk >= 0) this.setState({ wk: -1 });
        else return;
        e.preventDefault();
      }) as Handler,
      months,
      hasDet: det !== null,
      det,
      clear: (() => this.setState({ cur: -1, hov: -1, nd: -1 })) as Handler,
      unhover: (() => {
        if (S.hov >= 0) this.setState({ hov: -1 });
      }) as Handler,
      listT: t("carte.liste_t", { n: rows.length }),
      rows: rows.map((x) => x.row),
      vide,
    };
  }
}

export default {
  // its props are the route's and the commune's file (donnees), which the shell passes
  Vue: CarteDrones as unknown as VueModule["Vue"],
  template,
  donnees: async (r: Route) => ({ d: await commune((r as Props).insee) }),
} satisfies VueModule;
