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
import type { Handler, Rich } from "../dc.ts";
import {
  type BBox,
  type Calque,
  type Contour,
  calque,
  entieres,
  lireContour,
  type Site,
  TEINTES,
  type Teintes,
  zoomAuDessus,
  zoomIncline,
} from "../drones.ts";
import { count, fr, longMonth } from "../format.ts";
import { carteDuSite, laisser, seFerme } from "../hote.ts";
import { has, t } from "../i18n.ts";
import type { Miette, VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { signaler } from "../signaler.ts";
import { couleur, icone, repere as repereType } from "../types.ts";
import { arriver, type BaseState, large, Vue } from "../vue.ts";
import template from "./carte.html?raw";
import { filCommune } from "./commune-outils.ts";
import "./carte.css";
import {
  appareils,
  type Creneau,
  cles,
  dansPeriode,
  dateTxt,
  deAdresse,
  deGenre,
  drones,
  type Genre,
  genre,
  heuresTxt,
  jourTxt,
  lieux,
  mois,
  moisAxe,
  type NonDeduit,
  overlaps,
  type Periode,
  plage,
  repere,
  type Semaine,
  semaineDe,
  semaines,
  sitesHours,
  span,
  tickets,
  versAdresse,
  volLabel,
  type ZoneLue,
  zonesDe,
} from "./carte-outils.ts";

/** The tilt of the map in 3D, degrees: 50 on a wide screen (R1a's tilted map's), 35 on a phone,
 * whose narrow map at 50° showed the volumes more than the streets (v2.4, Ju). */
const inclinaison = (): number => (large() ? 50 : 35);
/** One press of a turn button, degrees. */
const TURN = 45;
/** The slow turn at the opening (v2.4): one whole turn in this many ms, by quarters (an easeTo
 * goes the shortest way: a whole turn at once would not move). */
const TOUR_MS = 90_000;
/** A hand's moves of the map (with an originalEvent): a drag, a pinch or a wheel, a turn, a tilt,
 * and the keyboard's arrows, which only start a move. */
const GESTES = ["dragstart", "zoomstart", "rotatestart", "pitchstart", "movestart"] as const;
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
  /** the week shown in the chart's tooltip (-1: none) */
  wk: number;
  /** the chart's width, CSS px */
  fw: number;
  /** the sites over the whole commune, or nearly (the build's, drones.ts entieres) */
  ent: string[];
  /** the kind of act shown: drones, algorithms, or both (null) */
  k: Genre;
  is3d: boolean;
  /** the legend and the chart unfolded (v2.3, Ju: folded by default on a wide screen, the map
   * left free) */
  leg: boolean;
  frise: boolean;
  /** the zones are on the map: a place of the act chosen can be framed (« Voir sur la carte ») */
  calque: boolean;
};

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The ticket « Quitter la vue drones » on the map, once the register is closed over the drone
 * view: it flattens the map and takes the volumes away; so does a register page opened again.
 * Styled here (it lives on the map, outside the register's stylesheet), in the board's ticket. */
function quitterPlusTard(map: MlMap, layer: Calque): void {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "rg-quitter-drones";
  b.textContent = t("carte.quitter_drones");
  b.setAttribute(
    "style",
    "position:absolute;left:16px;bottom:44px;z-index:5;min-height:44px;padding:0 14px;" +
      "background:#111;color:#f2efe6;border:2px solid #111;box-shadow:3px 3px 0 #ff48b0;" +
      "font:800 14px/1 Archivo,sans-serif;text-transform:uppercase;letter-spacing:.04em;cursor:pointer",
  );
  let fait = false;
  const finir = () => {
    if (fait) return;
    fait = true;
    layer.retirer();
    b.remove();
    laisser(null);
  };
  b.addEventListener("click", () => {
    finir();
    map.easeTo({ pitch: 0, bearing: 0, duration: reduced() ? 0 : MOVE_MS }, NOTRE);
  });
  map.getContainer().append(b);
  laisser(finir);
}

/** The camera's closest: a commune, a zone (v2.3: « Voir sur la carte » never enters a volume). */
const ZOOM_MAX = 15.5;
const ZOOM_ZONE = 14.5;
/** The part of the screen the map shows free (v2.3): what the panel, « ← Le registre » and its
 * legend, the commands and the chart leave, measured where they are (folded or not), 24 px
 * around. On a phone the sheet below. */
function libre(): { top: number; left: number; right: number; bottom: number } {
  const W = innerWidth;
  const H = innerHeight;
  const r = (s: string) => document.querySelector(`.rg ${s}`)?.getBoundingClientRect() ?? null;
  if (!large()) {
    // the sheet where it goes (its yellow band in it: its top as the frame sets it, « 50% » or
    // px, not where its move has got to), the commands' column on the right
    const el = document.querySelector<HTMLElement>(".rg > .th > .sheet");
    const want = el?.style.getPropertyValue("top") ?? "";
    const top = /%$/.test(want)
      ? (H * Number.parseFloat(want)) / 100
      : /px$/.test(want)
        ? Number.parseFloat(want)
        : (el?.getBoundingClientRect().top ?? H / 2);
    const ctl = r(".v-carte .ctl");
    const bottom = H - top + 16;
    return {
      top: 16,
      left: 16,
      right: ctl && ctl.width ? Math.max(16, W - ctl.left + 8) : 64,
      bottom: Math.min(bottom, H - 120),
    };
  }
  const panel = r("> .th > .side");
  const tag = r(".v-carte .maptag");
  const ctl = r(".v-carte .ctl");
  const frise = r(".v-carte .frise");
  const right = panel ? W - panel.left + 24 : 24;
  const pad = {
    top: Math.max(tag?.bottom ?? 0, 24) + 24,
    left: 24,
    right: Math.max(right, ctl ? W - ctl.left + 16 : 0),
    bottom: frise ? H - frise.top + 24 : 24,
  };
  // a screen too small for those margins: the map keeps half its width and height at least
  pad.right = Math.min(pad.right, W / 2);
  pad.bottom = Math.min(pad.bottom, H / 2);
  pad.top = Math.min(pad.top, H / 3);
  return pad;
}
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
    if (!this.parti || e.rgcd || e.originalEvent || this.refait || this.dead || !this.map) return;
    if (performance.now() - this.parti > REFAIRE_MS) return;
    this.refait = true;
    this.voler(this.map);
  };
  private readonly onPitch = () => {
    const on = (this.map?.getPitch() ?? 0) > 5;
    if (on !== this.state.is3d) this.setState({ is3d: on });
  };

  protected init(p: Props): Partial<State> {
    const q = new URLSearchParams(typeof location === "object" ? location.search : "");
    const r = mois(p.mois) ?? semaineDe(q.get("semaine"));
    return {
      r0: r?.[0] ?? null,
      r1: r?.[1] ?? null,
      sel: deAdresse(q.get("acte"), q.get("creneau")),
      wk: -1,
      fw: large() ? 868 : 340,
      ent: [],
      k: genre(q.get("genre")),
      is3d: true,
      leg: false,
      frise: false,
      calque: false,
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
    return filCommune(this.props.d);
  }
  etape(): string {
    return t("commune.carte_et_drones");
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
  /** The chart's width followed (its bars drawn to it), from when it is unfolded. */
  private friseVue: Element | null = null;
  private observerFrise(): void {
    const g = document.querySelector<HTMLElement>(".v-carte .frise-g");
    if (!g || g === this.friseVue || typeof ResizeObserver !== "function") return;
    this.ro?.disconnect();
    this.friseVue = g;
    this.ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w > 100 && Math.abs(w - this.state.fw) > 1) this.setState({ fw: w });
    });
    this.ro.observe(g);
  }
  /** A click on the map folds the legend back (v2.3). */
  private readonly onCarte = () => {
    if (this.state.leg) this.setState({ leg: false });
  };
  /** The map's padding follows the part of the map left free (v2.4 point 2): the panel or the
   * sheet, its band, « ← Le registre », the legend and the chart; measured again once they have
   * stopped changing (a sheet lowered or raised, a window resized, the chart unfolded), and set
   * once the map is not moving. */
  private tMarge = 0;
  private roMarge: ResizeObserver | null = null;
  private readonly suivreMarge = () => {
    clearTimeout(this.tMarge);
    this.tMarge = window.setTimeout(this.poserMarge, 180);
  };
  private readonly poserMarge = () => {
    const map = this.map;
    if (!map || this.dead || !this.cadree) return;
    // a flight waits; the turn does not (the padding's ease pauses it, it goes on after)
    if (map.isMoving() && !this.quart) {
      map.once("moveend", this.suivreMarge);
      return;
    }
    const p = libre();
    const cur = map.getPadding();
    const k = ["top", "bottom", "left", "right"] as const;
    if (k.every((x) => Math.abs((cur[x] ?? 0) - p[x]) < 2)) return;
    map.easeTo({ padding: p, duration: reduced() ? 0 : 300 }, NOTRE);
  };
  private observerMarge(): void {
    if (typeof ResizeObserver !== "function") return;
    this.roMarge ??= new ResizeObserver(this.suivreMarge);
    for (const sel of ["> .th > :is(.side, .sheet)", ".v-carte .frise", ".v-carte .maptag"]) {
      const el = document.querySelector(`.rg ${sel}`);
      if (el) this.roMarge.observe(el);
    }
  }
  componentDidMount(): void {
    addEventListener("themechange", this.onTheme);
    addEventListener("resize", this.suivreMarge);
    this.observerFrise();
    this.observerMarge();
    const map = carteDuSite();
    if (!map) return;
    this.map = map;
    map.on("pitchend", this.onPitch);
    map.on("moveend", this.onMove);
    map.on("click", this.onCarte);
    // the commune first, from its box (v2.4: every commune file has one), before the map's style
    // and the zones: a commune without zones, without acts or outside the collection is framed
    // the same, opened by its address or reached in the site
    // (once the frame has set itself as a panel or a sheet: modale.ts regler, after the mount)
    const box = this.props.d.f.commune.bbox;
    if (box)
      queueMicrotask(() => {
        if (!this.dead && !this.cadree) this.voler(map, box, true);
      });
    void this.poser(map);
  }
  /** The outline (it says which zones are the whole commune), then the layers once the map's style
   * is there, then the flight to the commune if its box did not frame it already. */
  private async poser(map: MlMap): Promise<void> {
    // after the frame has set itself (modale.ts regler) and the box's framing, as in the mount
    await Promise.resolve();
    const d = this.props.d;
    const used = new Set(this.T.flatMap((c) => c.sites));
    const sites = d.f.zones.sites.filter((s) => used.has(s.id)) as unknown as Site[];
    const ent = [...entieres(sites)];
    if (ent.length) this.setState({ ent });
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
    const make = (): boolean => {
      if (this.dead || this.layer) return true;
      try {
        this.layer = calque(map, {
          insee: d.insee,
          sites,
          teintes: this.teintes(),
          groupe: (n) => t("carte.vol_groupe", { n }),
          boite: d.f.commune.bbox,
          inclinaison: inclinaison(),
          onChoix: (id) => {
            const i = this.slotOf(id);
            if (i >= 0) {
              this.setState({ sel: this.K[i], vu: null });
              this.arrivee();
            }
          },
        });
        if (contour) this.layer.contour(contour);
        this.synced = "";
        this.syncMap();
        // an act opened by its address rendered its panel before the zones were there: its
        // places' « Voir sur la carte » now
        this.setState({ calque: true });
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
    if (!this.cadree) this.voler(map);
  }
  /** Whether the commune was framed: once, then the view moves the camera only when asked. */
  private cadree = false;
  /** To the commune (its box, else the outline's or the zones'), or to a zone, tilted, in the part
   * of the map the panel and the chart leave free. */
  private voler(map: MlMap, zone?: BBox, commune = !zone): void {
    const box = zone ?? this.props.d.f.commune.bbox ?? this.layer?.cadre();
    if (commune && box) this.cadree = true;
    const pitch = this.state.is3d ? inclinaison() : 0;
    const duration = reduced() ? 0 : MOVE_MS * 1.6;
    this.parti = performance.now();
    if (!box) {
      map.easeTo({ pitch, duration }, NOTRE);
      return;
    }
    // the box's middle at the middle of the part of the map left free: that part is the map's
    // padding (MapLibre keeps it), so that the map's centre is the commune's
    const padding = libre();
    const W = map.getCanvas().clientWidth;
    const H = map.getCanvas().clientHeight;
    const center: [number, number] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const bearing = map.getBearing();
    // the zoom at which the box holds there, tilted (MapLibre's cameraForBounds fits it flat);
    // close enough to read a zone, never inside a volume (drones.ts volumeHeight)
    const zoom = Math.min(
      zoomIncline(
        box,
        center,
        20,
        pitch,
        bearing,
        H,
        (W - padding.left - padding.right) / 2,
        (H - padding.top - padding.bottom) / 2,
      ),
      commune ? ZOOM_MAX : ZOOM_ZONE,
      // the camera high above the tallest volume (« Voir sur la carte » too)
      zoomAuDessus(this.layer?.plusHaut() ?? 0, pitch, H, center[1]),
    );
    const cam = { center, zoom, pitch, bearing, padding };
    // from far away, or over a map still loading (a cold open: the map starts at its default
    // place) a jump, not a flight that would load every tile on its way
    // the commune framed: the slow turn from there
    if (commune) map.once("moveend", () => this.demarrerTour());
    if (!map.isStyleLoaded() || loin(map, center)) map.jumpTo(cam, NOTRE);
    else map.flyTo({ ...cam, duration, essential: true }, NOTRE);
  }
  componentWillUnmount(): void {
    this.dead = true;
    this.abort.abort();
    removeEventListener("themechange", this.onTheme);
    removeEventListener("resize", this.suivreMarge);
    clearTimeout(this.tMarge);
    // still turning by itself: nobody chose that bearing (v2.4 survey: the site's map was left
    // turned by 38°); turned by a hand, it stays
    const auto = this.tourne;
    this.arreterTour();
    this.roMarge?.disconnect();
    this.ro?.disconnect();
    const map = this.map;
    if (!map) return;
    map.off("pitchend", this.onPitch);
    map.off("moveend", this.onMove);
    map.off("click", this.onCarte);
    // the register closed over this view (✕, Escape): the map stays tilted on the commune with its
    // volumes and the period chosen (v2.2 point 3), a ticket on it to leave them; any other page
    // of the register, the volumes go
    if (seFerme() && this.layer) quitterPlusTard(map, this.layer);
    else this.layer?.retirer();
    // the map's padding was the view's free part: the site frames with none (main.ts freePadding)
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }, NOTRE);
    if (auto) map.easeTo({ bearing: 0, duration: reduced() ? 0 : MOVE_MS }, NOTRE);
    this.layer = null;
    // the map stays where the view left it: on the commune (v2.1 A5), north up unless a hand
    // turned it
    this.map = null;
  }
  componentDidUpdate(): void {
    this.syncMap();
    this.adresse();
    this.observerFrise();
    this.observerMarge();
    // the legend or the chart folded or unfolded: the free part again
    this.suivreMarge();
  }
  /** The view's state in its address (A4): the period, the kind, the act chosen, so that a step
   * back to it, or the link copied, shows the same; replaced, never a new step. */
  private adresse(): void {
    if (typeof history !== "object" || !/\/carte$/.test(location.pathname)) return;
    const want = this.requete(this.state.sel);
    if (want === location.search) return;
    history.replaceState(history.state, "", `${location.pathname}${want}${location.hash}`);
  }
  /** The query of the view's state with `sel` chosen (« ?mois=2026-10&acte=… »). */
  private requete(sel: string | null): string {
    const S = this.state;
    const q = new URLSearchParams();
    const r = this.periode();
    if (r) {
      const a = new Date(r[0]).toISOString();
      if (r[1] - r[0] === 7 * DAY) q.set("semaine", a.slice(0, 10));
      else q.set("mois", a.slice(0, 7));
    }
    if (S.k) q.set("genre", S.k);
    if (sel) {
      const x = versAdresse(sel);
      q.set("acte", x.acte);
      if (x.creneau) q.set("creneau", x.creneau);
    }
    const s = q.toString();
    return s ? `?${s}` : "";
  }
  /** The slots' keys (carte-outils cles), the same order as T. */
  private get K(): string[] {
    const T = this.T;
    if (this.kT !== T) {
      this.kT = T;
      this.kK = cles(T);
    }
    return this.kK;
  }
  private kT: Creneau[] | null = null;
  private kK: string[] = [];
  /** A key's slot (-1: none, or an act without a slot). */
  private idx(k: string | null | undefined): number {
    return k ? this.K.indexOf(k) : -1;
  }
  /** The panel's arrival, after the render that fills it (vue.ts arriver). */
  private arrivee(): void {
    queueMicrotask(() => {
      const root = document.querySelector(".rg .v-carte")?.closest(".rg");
      if (root) requestAnimationFrame(() => arriver(root));
    });
  }
  /** The first slot over a site: the chosen one if it is, else the latest in the period. */
  private slotOf(site: string): number {
    const S = this.state;
    const T = this.T;
    const cur = this.idx(S.sel);
    if (cur >= 0 && T[cur].sites.includes(site)) return cur;
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
    const hoursKey = `${S.r0}|${S.r1}|${S.k}`;
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
    const hov = this.idx(S.vu);
    const cur = this.idx(S.sel);
    L.survoler(hov >= 0 ? T[hov].sites : []);
    L.choisir(cur >= 0 ? T[cur].sites : []);
  }

  // --- the page --------------------------------------------------------------------------------
  /** A row or a slot of the panel chosen (a click, Enter, a tap): its link (`a.rl`) is the view's
   * own address with the act, so that it opens in a new tab too; here the view stays and its
   * panel fills (A4): the click is the view's, not the shell's (hote.ts). */
  private choix(k: string): Handler {
    const f = this.choisir(k);
    return (e) => {
      // a modified click opens the act's address elsewhere, as the comment above promises
      const n = e.nativeEvent as MouseEvent;
      if (n.metaKey || n.ctrlKey || n.shiftKey || n.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (a && !a.classList.contains("rl")) return;
      e.preventDefault();
      f(e);
    };
  }
  private setPeriode(r: Periode): void {
    this.setState({ r0: r?.[0] ?? null, r1: r?.[1] ?? null, sel: null, vu: null });
  }
  /** « Voir sur la carte »: the zone framed, as the commune is at the opening. */
  private voir(site: string): Handler {
    return () => {
      const b = this.layer?.boite(site);
      if (this.map && b) this.voler(this.map, b);
    };
  }
  /** A command of the map's (3D, ↺, ↻, N): a hand on the map, the turn stops for good. */
  private ease(o: { pitch?: number; bearing?: number }): void {
    this.arreterTour();
    this.map?.easeTo({ ...o, duration: reduced() ? 0 : MOVE_MS }, NOTRE);
  }

  // --- the slow turn (v2.4 point 3) ---------------------------------------------------------------
  /** Turning: from the commune's framing until a hand moves the map (a drag, a pinch, a zoom, a
   * turn, a tilt, one of the commands); a tap on a zone is no such move; never again after, never
   * under reduced motion. A flight of the view's own (a zone, the padding) pauses it. */
  private tourne = false;
  /** A quarter of the turn under way (its easeTo), else false. */
  private quart = false;
  private demarrerTour(): void {
    const map = this.map;
    if (!map || this.dead || reduced() || this.tourne || this.finTour) return;
    this.tourne = true;
    for (const e of GESTES) map.on(e, this.main);
    for (const e of ["mousedown", "touchstart"] as const) map.on(e, this.appuye);
    for (const e of ["mouseup", "touchend", "touchcancel"] as const) map.on(e, this.releve);
    map.on("moveend", this.reprendre);
    this.reprendre();
  }
  /** A finger or a button down on the map: its press stops the quarter under way (MapLibre), and
   * a quarter started again under it would take the drag away; up, a tap (a zone chosen) lets it
   * turn on, a gesture has stopped it (main). */
  private appui = false;
  private readonly appuye = () => {
    this.appui = true;
  };
  private readonly releve = () => {
    this.appui = false;
    this.reprendre();
  };
  /** Stopped once: never again. */
  private finTour = false;
  // (the gesture itself stops the quarter under way: Camera.stop would stop the gesture too)
  private readonly main = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) this.arreterTour(false);
  };
  private readonly reprendre = () => {
    const map = this.map;
    if (!map || !this.tourne || this.dead) return;
    this.quart = false;
    // once the view's own flight, or the quarter just ended, is over
    requestAnimationFrame(() => {
      if (!this.tourne || this.dead || this.quart || this.appui || !this.map || this.map.isMoving())
        return;
      this.quart = true;
      this.map.easeTo(
        {
          bearing: this.map.getBearing() - 90,
          duration: TOUR_MS / 4,
          easing: (t) => t,
          essential: true,
        },
        { ...NOTRE, tour: true },
      );
    });
  };
  private arreterTour(stop = true): void {
    this.finTour = true;
    if (!this.tourne) return;
    this.tourne = false;
    const map = this.map;
    if (!map) return;
    for (const e of GESTES) map.off(e, this.main);
    for (const e of ["mousedown", "touchstart"] as const) map.off(e, this.appuye);
    for (const e of ["mouseup", "touchend", "touchcancel"] as const) map.off(e, this.releve);
    map.off("moveend", this.reprendre);
    if (this.quart && stop) map.stop();
    this.quart = false;
  }

  renderVals() {
    const S = this.state;
    const d = this.props.d;
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
    const cur = this.idx(S.sel);
    const hov = this.idx(S.vu);
    const focus = hov >= 0 ? hov : cur;
    const weekOf = (i: number) =>
      i >= 0 ? weeks.findIndex((w) => T[i].t0 >= w.t0 && T[i].t0 < w.t1) : -1;
    const selWeek = weekOf(focus);
    // chosen: the week of the slot chosen, or the week the period is; hovered: the week of the row
    // hovered or the bar pointed at (v2.1 A1: ink, never yellow)
    const choisie = weekOf(cur);
    const pointee = hov >= 0 ? weekOf(hov) : S.wk;
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

    // the detail (A8, B3): the slot chosen or the act chosen without a slot, all its act says;
    // by default the panel only says what to hover or choose. A hover fills it not (B3: « il ne se
    // remplit qu'à la sélection »): the panel stands above the list, a hover that changed its
    // height would move the row under the pointer, again and again; a hover shows the zone on the
    // map and the week in the chart.
    const shownKey = S.sel;
    const shownNd = shownKey && cur < 0 ? (ND.find((a) => a.acte === shownKey) ?? null) : null;
    const zones = d.f.zones.zones as unknown as ZoneLue[];
    type Lien = { l: string; href: string; cls: string; c: string };
    const aut = repereType("aut");
    const voirArrete = (url: string | null | undefined): Lien[] =>
      url ? [{ l: t("arretes.voir"), href: url, cls: "lk", c: `--c: ${couleur("aut")}` }] : [];
    const ligne = (k: string, v: string | null | undefined) => (v ? [{ k: t(k), v }] : []);
    let det: {
      c: string;
      i: string;
      k: string;
      title: string;
      sub: string;
      lieux: { l: string; voir: Handler | null; has: boolean }[];
      hasLieux: boolean;
      creneaux: { l: string; cur: string; href: string; pick: Handler }[];
      hasCreneaux: boolean;
      rows: { k: string; v: string }[];
      note: string;
      links: Lien[];
    } | null = null;
    if (cur >= 0 || shownNd) {
      const c = cur >= 0 ? T[cur] : null;
      const a = shownNd;
      const acte = c ? c.actes[0] : (a?.acte ?? "");
      const e = d.ev.get(acte);
      const vsa = (c?.kind ?? a?.kind) === "vsa";
      const zs = c ? zonesDe(c, zones) : zones.filter((z) => z.acte === acte);
      const n = appareils(zs, e?.cameras);
      const statut = c?.sites.length ? c.statut : null;
      const uniques = (xs: (string | null | undefined)[]) =>
        [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))].join(" ; ");
      const haut = zs.find((z) => z.hauteur_lue && z.hauteur);
      const dateActe = e?.date
        ? dateTxt(Date.parse(`${e.date}T00:00:00Z`))
        : a?.date
          ? dateTxt(Date.parse(`${a.date}T00:00:00Z`))
          : null;
      const ref = e?.ref ?? a?.ref ?? null;
      const page = e?.page ?? a?.page ?? null;
      const nature = typeof e?.nature_vol === "string" ? e.nature_vol : "";
      const natureK = `carte.nature_${nature.replace(/\W+/g, "_")}`;
      const autres = (e?.partage ?? []).map((i) => d.f.communes[i]?.nom ?? i);
      const sig = signaler(e ?? { id: acte, affaire: acte });
      const freres = c
        ? T.map((x, i) => [x, i] as const)
            .filter(([x]) => x.actes[0] === acte)
            .sort(([x], [y]) => x.t0 - y.t0)
        : [];
      det = {
        c: aut.c,
        i: icone("aut"),
        k: t(vsa ? "carte.det_vsa" : "carte.det_drone"),
        title: c ? plage(c) : (dateActe ?? t("format.date_non_publiee")),
        sub: dateActe ? t("carte.det_acte_du", { date: dateActe }) : "",
        lieux: lieux(zs).map((x) => ({
          l: x.l,
          voir: x.site ? this.voir(x.site) : null,
          has: !!x.site && S.calque,
        })),
        hasLieux: false,
        creneaux:
          freres.length > 1
            ? freres.map(([x, i]) => ({
                l: plage(x),
                cur: i === cur ? "true" : "false",
                href: `${communeHref(insee, "carte")}${this.requete(this.K[i])}`,
                pick: this.choix(this.K[i]),
              }))
            : [],
        hasCreneaux: freres.length > 1,
        rows: [
          ...ligne("carte.service", c?.service ?? (e ? benefLabel(e) : null)),
          ...ligne("carte.pour_k", c?.finalite ?? e?.objet ?? t("carte.finalite_non_lue")),
          ...(vsa
            ? ligne(
                "carte.cameras_k",
                n ? count(n, "camera") : (e?.cameras_lib as string) || t("commun.non_precise"),
              )
            : ligne("carte.appareils_k", n ? t("carte.n_drones", { n }) : t("commun.non_precise"))),
          ...(nature
            ? ligne("carte.nature_k", has(`registre.${natureK}`) ? t(natureK) : nature)
            : []),
          ...(c
            ? ligne(
                "carte.duree",
                c.heures != null ? heuresTxt(c.heures) : t("carte.horaires_non_precises_arrete"),
              )
            : []),
          ...ligne(
            "carte.zone",
            statut
              ? t(
                  statut === "relu"
                    ? "carte.zone_relue"
                    : statut === "relecture"
                      ? "carte.zone_relecture"
                      : "carte.zone_indicative",
                )
              : t("arretes.zone_non_deduite"),
          ),
          ...(haut ? ligne("carte.hauteur_k", t("carte.hauteur_m", { n: haut.hauteur ?? 0 })) : []),
          ...ligne("carte.type_acte_k", e?.sous_type),
          ...ligne("carte.communes_k", autres.join(", ")),
          ...ligne(
            "carte.source",
            ref ? (page ? t("carte.ref_page", { ref, page: String(page) }) : ref) : null,
          ),
        ],
        note: c ? uniques(zs.map((z) => z.alerte)) : t("carte.nd_note"),
        links: [...voirArrete(c?.url ?? e?.url ?? a?.url), { ...sig, cls: "", c: "" }],
      };
      det.hasLieux = det.lieux.length > 0;
    }

    // the list: every slot of the period (DECISIONS 2026-10-29), newest first, the acts listed
    // without a slot among them by their date; each row's link is the view's own address with
    // its act (A4), the row the contract's (cadre.css « rows »)
    type Row = { at: number; row: Record<string, unknown> };
    const rows: Row[] = [];
    const href = (k: string) => `${communeHref(insee, "carte")}${this.requete(k)}`;
    T.forEach((c, i) => {
      if (!this.inP(c)) return;
      const k = this.K[i];
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
          ...this.ligne(k, "aut", "r zrow"),
          pick: this.choix(k),
          href: href(k),
          d: dateTxt(c.t0),
          svc: c.service ?? t("commun.non_precise"),
          fin,
          h: c.heures != null ? heuresTxt(c.heures) : t("carte.horaires_non_precises"),
        },
      });
    });
    ND.forEach((a) => {
      if (!deGenre(S.k, a.kind) || !dansPeriode(a.date, r)) return;
      const e = d.ev.get(a.acte);
      const when = a.date
        ? dateTxt(Date.parse(`${a.date}T00:00:00Z`))
        : t("format.date_non_publiee");
      rows.push({
        at: a.date ? Date.parse(`${a.date}T00:00:00Z`) : 0,
        row: {
          ...this.ligne(a.acte, "aut", "r zrow"),
          pick: this.choix(a.acte),
          href: href(a.acte),
          d: when,
          svc: e ? benefLabel(e) : t("commun.non_precise"),
          fin: [t("carte.zone_non_deduite_court"), a.ref].filter(Boolean).join(" · "),
          h: t("carte.non_dessine"),
        },
      });
    });
    rows.sort((a, b) => b.at - a.at);
    // « 57 créneaux, dans 50 arrêtés » (B2): the list's slots and the acts they come from
    const shownT = T.filter((c) => this.inP(c));
    const shownND = ND.filter((a) => deGenre(S.k, a.kind) && dansPeriode(a.date, r));
    const nSlots = shownT.length;
    const nNd = shownND.length;
    const nActes = new Set([...shownT.flatMap((c) => c.actes), ...shownND.map((a) => a.acte)]).size;

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
          if (S.k !== k && (n > 0 || k === null)) this.setState({ k, sel: null, vu: null, wk: -1 });
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
      tog3d: (() => this.ease({ pitch: S.is3d ? 0 : inclinaison() })) as Handler,
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
      nSH: String(tk.sansHoraires),
      lSH: t("carte.t_sans_horaires", { n: tk.sansHoraires }),
      hasND: tk.nonDeduites > 0,
      nND: String(tk.nonDeduites),
      lND: t("carte.t_nd", { n: tk.nonDeduites }),
      rangeL: r
        ? t("carte.du_au", { de: dateTxt(r[0]), a: dateTxt(r[1] - DAY) })
        : t("carte.du_au", { de: dateTxt(A), a: dateTxt(Math.min(lastDay, now)) }),
      allOn: r ? "false" : "true",
      allYear: (() => this.setPeriode(null)) as Handler,
      // v2.3 (Ju): the legend a ticket beside the commands, the chart a thin band, both folded by
      // default on a wide screen; folded, the chosen act's week stays in the band
      legOuverte: !isLarge || S.leg,
      legTicket: isLarge,
      legPressed: S.leg ? "true" : "false",
      togLeg: (() => this.setState({ leg: !S.leg })) as Handler,
      friseOuverte: !isLarge || S.frise,
      friseBande: isLarge,
      friseExp: S.frise ? "true" : "false",
      // the map's free part changes with it: its padding follows (suivreMarge)
      togFrise: (() => this.setState({ frise: !S.frise })) as Handler,
      friseBandeL: [
        t("carte.frise_bandeau"),
        r
          ? t("carte.du_au", { de: dateTxt(r[0]), a: dateTxt(r[1] - DAY) })
          : t("carte.du_au", { de: dateTxt(A), a: dateTxt(Math.min(lastDay, now)) }),
        ...(selWeek >= 0 && weeks[selWeek] ? [tipTxt(weeks[selWeek])] : []),
      ].join(" · "),
      friseAide: t(S.frise ? "carte.frise_replier" : "carte.frise_deplier"),
      semChoisie: selWeek >= 0,
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
      // nothing to choose: no hint about choosing (Paris, a period without a flight)
      noDet: det === null && rows.length > 0,
      hasGenres: T.length + ND.length > 0,
      hasPanel: det !== null || rows.length > 0,
      det,
      clear: (() => this.setState({ sel: null, vu: null })) as Handler,
      unhover: this.quitter(),
      listT: rows.length
        ? `${t("carte.liste_t2", { n: nSlots, arr: count(nActes, "arrete") })}${
            nNd ? t("carte.liste_nd", { n: nNd }) : ""
          }`
        : t("carte.liste_t", { n: 0 }),
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
