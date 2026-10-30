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
import { etatDepartement } from "../collecte.ts";
import { benefLabel, commune, communeHref, type Donnees } from "../commun.ts";
import type { Lexique } from "../corpus.ts";
import type { Handler, Rich } from "../dc.ts";
import { type Calque, calque, lireContour, type Site } from "../drones.ts";
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
  drones,
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
/** The board's sky blue and yellow: the measure and the selection. */
const BLEU = "#7fd4ff";
const JAUNE = "#ffe800";
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
  /** the site pointed at on the map */
  site: string | null;
  /** the week shown in the chart's tooltip (-1: none) */
  wk: number;
  /** the chart's width, CSS px */
  fw: number;
  is3d: boolean;
};

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
const today = (): number => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const DAY = 86_400_000;

class CarteDrones extends Vue<Props, State> {
  private map: MlMap | null = null;
  private layer: Calque | null = null;
  private dead = false;
  private abort = new AbortController();
  private saved: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null =
    null;
  private ro: ResizeObserver | null = null;
  /** the period whose hours the map shows */
  private synced = "";
  private readonly onTheme = () => requestAnimationFrame(() => this.layer?.encre(this.ink()));
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
      site: null,
      wk: -1,
      fw: large() ? 868 : 340,
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
  private inP(c: Creneau): boolean {
    const r = this.periode();
    return !r || overlaps(c, r[0], r[1]);
  }
  private ink(): string {
    const el = document.querySelector(".v-carte") ?? document.documentElement;
    return getComputedStyle(el).getPropertyValue("--fg").trim() || "#111111";
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
    const c = map.getCenter();
    this.saved = {
      center: [c.lng, c.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
    map.on("pitchend", this.onPitch);
    void this.poser(map);
  }
  /** Its layers once the map's style is there, then the outline, then the flight to the commune. */
  private async poser(map: MlMap): Promise<void> {
    const d = this.props.d;
    const used = new Set(this.T.flatMap((c) => c.sites));
    const sites = d.f.zones.sites.filter((s) => used.has(s.id)) as unknown as Site[];
    const make = (): boolean => {
      if (this.dead || this.layer) return true;
      try {
        this.layer = calque(map, {
          insee: d.insee,
          sites,
          encre: this.ink(),
          onSurvol: (id) => {
            if (id !== this.state.site) this.setState({ site: id });
          },
          onChoix: (id) => {
            const i = this.slotOf(id);
            if (i >= 0) this.setState({ cur: i, nd: -1, hov: -1 });
          },
        });
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
    // the outline from the register's map file, its head only (drones.ts lireContour)
    if (d.f.carte.decoupee !== false) {
      try {
        const c = await lireContour(d.insee, this.abort.signal);
        if (c && !this.dead) this.layer.contour(c);
      } catch {
        // no outline: the site's own commune shape stays
      }
    }
    if (this.dead) return;
    this.voler(map);
  }
  /** To the commune, tilted, in the part of the map the panel and the chart leave free. */
  private voler(map: MlMap): void {
    const box = this.layer?.cadre();
    const pitch = this.state.is3d ? PITCH : 0;
    const duration = reduced() ? 0 : MOVE_MS * 1.6;
    if (!box) {
      map.easeTo({ pitch, duration });
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
    map.flyTo({ ...cam, pitch, duration, essential: true });
  }
  componentWillUnmount(): void {
    this.dead = true;
    this.abort.abort();
    removeEventListener("themechange", this.onTheme);
    this.ro?.disconnect();
    const map = this.map;
    if (!map) return;
    map.off("pitchend", this.onPitch);
    this.layer?.retirer();
    this.layer = null;
    if (this.saved) map.easeTo({ ...this.saved, duration: reduced() ? 0 : MOVE_MS });
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
  /** The map follows: each site's hours over the period, the hovered and chosen ones in yellow. */
  private syncMap(): void {
    const L = this.layer;
    if (!L) return;
    const S = this.state;
    const r = this.periode();
    const T = this.T;
    const shown = T.filter((c) => this.inP(c));
    const hs = sitesHours(shown, r);
    const focus = S.hov >= 0 ? S.hov : S.cur;
    const chosen = focus >= 0 ? (T[focus].sites[0] ?? null) : null;
    const survol = S.site;
    const words = survol
      ? hs[survol]
        ? volLabel(hs[survol])
        : null
      : focus >= 0 && chosen
        ? volLabel({ heures: T[focus].heures ?? 0, n: T[focus].actes.length })
        : null;
    const hoursKey = `${S.r0}|${S.r1}`;
    if (hoursKey !== this.synced) L.heures(hs);
    this.synced = hoursKey;
    L.marquer(survol, chosen, words);
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
    this.map?.easeTo({ ...o, duration: reduced() ? 0 : MOVE_MS });
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
    const drone = T.filter((c) => c.kind === "drone");

    // the tickets: the period's
    const tk = tickets(T, ND, r);

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
    const selWeek =
      focus >= 0 ? weeks.findIndex((w) => T[focus].t0 >= w.t0 && T[focus].t0 < w.t1) : -1;
    const inR = (w: Semaine) => !r || (w.t1 > r[0] && w.t0 < r[1]);
    const wk = weeks.map((w, i) => {
      const h = w.heures > 0 ? Math.max(2, AXE - yOf(w.heures)) : 0;
      const x = 2 + i * step;
      const sel = i === selWeek;
      return {
        x: (x + (step - bw) / 2).toFixed(1),
        y: (AXE - h).toFixed(1),
        w: bw.toFixed(1),
        h: h.toFixed(1),
        hx: x.toFixed(1),
        hw: step.toFixed(1),
        st: `fill: ${sel ? JAUNE : BLEU}; stroke: var(--line); stroke-width: ${h ? 1 : 0}; opacity: ${sel || inR(w) ? 1 : 0.35}`,
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
    const months = ms.map((m) => {
      const x0 = xOf(Math.max(m.t0, A));
      const x1 = xOf(Math.min(m.t1, B));
      const wpx = Math.max(0, x1 - x0);
      const on = !!r && r[0] === m.t0 && r[1] === m.t1;
      const full = new Date(m.t0).toISOString().slice(0, 10);
      return {
        l: wpx < m.l.length * 6.6 + 6 ? m.l.slice(0, 1).toUpperCase() : m.l,
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
      const fin = [
        ...(c.sites.length ? [] : [t("carte.zone_non_deduite_court")]),
        ...(c.kind === "vsa" ? [t("carte.analyse_algorithmique")] : []),
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
      if (!dansPeriode(a.date, r)) return;
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
          `${etatDepartement(d.f.commune.dep, d.f.stats.dep.nom, couv)} `,
          { a: { href: "/registre/couverture", text: t("carte.vide_couverture") } },
        ];
      else if (nArr)
        vide = [
          `${t("carte.vide_arretes", { nom, arr: count(nArr, "arrete") })} `,
          { a: { href: communeHref(insee, "autorisations"), text: t("carte.vide_autorisations") } },
        ];
      else vide = t("carte.vide_aucun", { nom });
    } else if (!rows.length) vide = t("carte.vide_periode");

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
      hasVsa: T.some((c) => c.kind === "vsa" && c.sites.length),
      is3d: S.is3d ? "true" : "false",
      tog3d: (() => this.ease({ pitch: S.is3d ? 0 : PITCH })) as Handler,
      rotL: (() => this.ease({ bearing: (this.map?.getBearing() ?? 0) + TURN })) as Handler,
      rotR: (() => this.ease({ bearing: (this.map?.getBearing() ?? 0) - TURN })) as Handler,
      north: (() => this.ease({ bearing: 0 })) as Handler,
      nA: String(tk.actes),
      lA: t("carte.t_arretes", { n: tk.actes }),
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
