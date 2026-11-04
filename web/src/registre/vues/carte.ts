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
  bboxOf,
  type Calque,
  type Contour,
  calque,
  entieres,
  lireContour,
  poseBord,
  rings,
  type Site,
  TEINTES,
  type Teintes,
  zoomAuDessus,
  zoomIncline,
} from "../drones.ts";
import { count, fr } from "../format.ts";
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
  camerasTxt,
  cles,
  DEBUT_CAL,
  dateTxt,
  deAdresse,
  deGenre,
  drones,
  enTete,
  finalitesTxt,
  type Genre,
  genre,
  grilleMois,
  grilleSemaines,
  heuresTxt,
  horairesMots,
  jourDe,
  jourIso,
  jourLong,
  jourMs,
  joursComptes,
  joursDe,
  lieux,
  lundi,
  mois,
  motifTxt,
  motsLigne,
  type NonDeduit,
  ndDans,
  niveau,
  overlaps,
  type Periode,
  phraseJour,
  plage,
  reperesCal,
  secteurPanneau,
  semaineDe,
  sitesHours,
  sumHours,
  TEINTE_JOUR,
  tickets,
  versAdresse,
  volLabel,
  type ZoneLue,
  zonePanneau,
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
/** « Jours de vol autorisés » on a wide screen, in its viewBox (board B, Drones-Paris-B-calendrier:
 * 528 × 86, a cell 2.92 × 7.6 every 3.52 × 8.2 from x 3.82, y 6.3; the marks under it from 66.4). */
const CAL_X = 3.82;
const CAL_W = 0.83;
const CAL_Y0 = 6.3;
const CAL_DY = 8.2;
const CAL_CH = 7.6;
const CAL_H = 86;
/** On a phone (the brief: a row of 31 days per month, the latest on top): the months' words'
 * column and a row's height. */
const TEL_LW = 52;
const TEL_RH = 12;

type Props = Extract<Route, { view: "carte" }> & { d: Donnees };
type State = BaseState & {
  r0: number | null;
  r1: number | null;
  /** the calendar's day under the pointer, and the one the keyboard is on (ms; -1: none) */
  jv: number;
  jf: number;
  /** the list kept to the acts without a drawn zone (the commune's dotted edge clicked) */
  sz: boolean;
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
    const r = jourDe(q.get("jour")) ?? mois(p.mois) ?? semaineDe(q.get("semaine"));
    return {
      r0: r?.[0] ?? null,
      r1: r?.[1] ?? null,
      sel: deAdresse(q.get("acte"), q.get("creneau")),
      jv: -1,
      jf: -1,
      sz: q.get("zone") === "non-lue",
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
      bleu: v("--drone-trait", TEINTES.bleu ?? ""),
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
          formes: drones(d).formes,
          onNonLue: this.basculerSz,
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
        this.poserEtiquette(map);
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
    // framed before the zones were there: the turn now, if a volume is drawn
    else if (!map.isMoving()) this.demarrerTour();
  }

  // --- the label on the commune's edge (board B) ---------------------------------------------------
  /** « zone non lue · 3 arrêtés ce jour »: set on the commune's boundary, along it, in the free
   * part of the map (never a card in its middle); a click keeps the list to the acts without a
   * drawn zone. Styled here, in the board's .edge (it lives on the map, outside the register). */
  private etiquette: HTMLButtonElement | null = null;
  private etiqI: number | null = null;
  private etiqImage = 0;
  private readonly basculerSz = () => this.setState({ sz: !this.state.sz, sel: null, vu: null });
  private poserEtiquette(map: MlMap): void {
    if (this.etiquette || typeof document !== "object") return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rg-cd-bord";
    b.setAttribute(
      "style",
      "position:absolute;left:0;top:0;z-index:2;display:none;padding:12px 4px;margin:0;border:0;" +
        "background:none;cursor:pointer;transform-origin:50% 50%",
    );
    const s = document.createElement("span");
    b.append(s);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      this.basculerSz();
    });
    map.getContainer().append(b);
    this.etiquette = b;
    map.on("move", this.suivreEtiquette);
    map.on("resize", this.suivreEtiquette);
    this.majEtiquette();
  }
  private readonly suivreEtiquette = () => {
    if (this.etiqImage) return;
    this.etiqImage = requestAnimationFrame(() => {
      this.etiqImage = 0;
      this.placerEtiquette();
    });
  };
  /** The words and the look (the theme's paper and the drones' blue, read again on each change). */
  private majEtiquette(): void {
    const b = this.etiquette;
    if (!b) return;
    const S = this.state;
    const n = tickets(this.T, this.ND, this.periode(), S.k).nonLues;
    const jour = this.jourChoisi();
    const on = n > 0 && S.k !== "vsa";
    this.layer?.nonLue(on);
    const tt = this.teintes();
    const s = b.firstElementChild as HTMLElement;
    s.textContent = t(jour != null ? "carte.bord_label_jour" : "carte.bord_label", { n });
    s.setAttribute(
      "style",
      `display:block;padding:2px 7px;background:${S.sz ? tt.bleu : tt.fond};` +
        `color:${S.sz ? tt.fond : tt.bleu};border:2px dotted ${tt.bleu};` +
        "font:800 11.5px Archivo,sans-serif;font-stretch:78%;text-transform:uppercase;" +
        "white-space:nowrap;letter-spacing:.01em",
    );
    b.setAttribute("aria-pressed", S.sz ? "true" : "false");
    b.setAttribute("aria-label", `${s.textContent}. ${t("carte.bord_aria")}`);
    b.dataset.on = on ? "1" : "";
    this.placerEtiquette();
  }
  private placerEtiquette(): void {
    const b = this.etiquette;
    const map = this.map;
    const ring = this.layer?.bordure();
    if (!b || !map || !ring?.length || !b.dataset.on) {
      if (b) b.style.display = "none";
      return;
    }
    const W = map.getContainer().clientWidth;
    const H = map.getContainer().clientHeight;
    const f = libre();
    // the label half outside the free part would cover the panel: its half-width kept in
    b.style.display = "block";
    const m = Math.min((W - f.left - f.right) / 2 - 1, (b.offsetWidth || 140) / 2 + 8);
    const pts = ring.map((p) => {
      const q = map.project(p);
      return [q.x, q.y] as [number, number];
    });
    // the cited sector's label (its words, ~280 px wide) and the edge's half-width kept apart
    const loin = (this.layer?.ancres() ?? []).map((c) => {
      const q = map.project(c);
      return { x: q.x, y: q.y, r: 150 + m };
    });
    const pose = poseBord(
      pts,
      { x0: f.left + m, y0: f.top + 16, x1: W - f.right - m, y1: H - f.bottom - 16 },
      this.etiqI,
      loin,
    );
    if (!pose) {
      b.style.display = "none";
      return;
    }
    this.etiqI = pose.i;
    b.style.display = "block";
    b.style.transform = `translate(${pose.x}px, ${pose.y}px) translate(-50%, -50%) rotate(${pose.angle.toFixed(1)}deg)`;
  }
  private retirerEtiquette(): void {
    if (this.etiqImage) cancelAnimationFrame(this.etiqImage);
    this.map?.off("move", this.suivreEtiquette);
    this.map?.off("resize", this.suivreEtiquette);
    this.etiquette?.remove();
    this.etiquette = null;
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
    this.retirerEtiquette();
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
      if (r[1] - r[0] === DAY) q.set("jour", a.slice(0, 10));
      else if (r[1] - r[0] === 7 * DAY) q.set("semaine", a.slice(0, 10));
      else q.set("mois", a.slice(0, 7));
    }
    if (S.k) q.set("genre", S.k);
    if (S.sz) q.set("zone", "non-lue");
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
    // board B: the cited sectors of the acts shown, all of them over the whole period, a chosen
    // day's only; their labels for a chosen day or act; the commune's edge and its label
    const formes = drones(this.props.d).formes;
    const r = this.periode();
    const choisi = S.sel && cur < 0 ? S.sel : null;
    const ids: string[] = [];
    const labs: { id: string; mots: string }[] = [];
    for (const a of this.ND) {
      if (!deGenre(S.k, a.kind) || !ndDans(a, r)) continue;
      for (const l of a.lieux ?? []) {
        if (!l.forme || !formes[l.forme] || ids.includes(l.forme)) continue;
        ids.push(l.forme);
        if (this.jourChoisi() != null || a.acte === choisi)
          labs.push({ id: l.forme, mots: t("carte.secteur_carte", { l: l.texte }) });
      }
    }
    L.secteurs(ids, labs);
    this.majEtiquette();
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
  private setPeriode(r: Periode, more: Partial<State> = {}): void {
    this.setState({ r0: r?.[0] ?? null, r1: r?.[1] ?? null, sel: null, vu: null, ...more });
  }
  /** « Voir sur la carte » for a cited sector: its shape framed (drones.formes). */
  private voirForme(id: string): Handler {
    return () => {
      const f = drones(this.props.d).formes[id];
      const b = f ? bboxOf(rings(f.geometry as Parameters<typeof rings>[0])) : null;
      if (this.map && b) this.voler(this.map, b);
    };
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
    // board B: the map turns by itself only around a drawn volume (Paris has none: it stays still)
    if (!this.layer || this.layer.plusHaut() <= 0) return;
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

  /** The calendar's geometry, the same for its drawing and its pointer (board B: 2.92 × 7.6 cells
   * every 3.52 × 8.2 at 528 px; the phone: a row of 31 days per month). */
  private cal(W: number) {
    const A = DEBUT_CAL;
    const B = lundi(today()) + 7 * DAY;
    if (large()) {
      const cols = Math.max(1, Math.round((B - A) / (7 * DAY)));
      const step = (W - CAL_X) / (cols - 1 + CAL_W);
      return { tel: false as const, A, B, cols, step, H: CAL_H };
    }
    const nMois =
      (new Date(B - DAY).getUTCFullYear() - 2024) * 12 + new Date(B - DAY).getUTCMonth() + 1;
    const step = (W - TEL_LW) / 31;
    return { tel: true as const, A, B, cols: 31, step, H: nMois * TEL_RH, nMois };
  }
  /** The day under a point of the calendar (its client coordinates), null for none. */
  private jourSous(e: { clientX: number; clientY: number; currentTarget: Element }): number | null {
    const g = this.cal(Math.max(200, this.state.fw));
    const b = e.currentTarget.getBoundingClientRect();
    if (!b.width || !b.height) return null;
    const W = Math.max(200, this.state.fw);
    const x = ((e.clientX - b.left) * W) / b.width;
    const y = ((e.clientY - b.top) * g.H) / b.height;
    const now = today();
    let d: number;
    if (!g.tel) {
      const col = Math.floor((x - CAL_X + (g.step * (1 - CAL_W)) / 2) / g.step);
      const row = Math.floor((y - CAL_Y0 + (CAL_DY - CAL_CH) / 2) / CAL_DY);
      if (col < 0 || col >= g.cols || row < 0 || row > 6) return null;
      d = g.A + col * 7 * DAY + row * DAY;
    } else {
      const row = Math.floor(y / TEL_RH);
      const col = Math.floor((x - TEL_LW) / g.step);
      if (row < 0 || row >= g.nMois || col < 0 || col > 30) return null;
      const last = new Date(g.B - DAY);
      const t0 = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - row, 1);
      d = t0 + col * DAY;
      if (new Date(d).getUTCMonth() !== new Date(t0).getUTCMonth()) return null;
    }
    return d < g.A || d > now ? null : d;
  }
  /** The day chosen (a period of one day), else null. */
  private jourChoisi(): number | null {
    const r = this.periode();
    return r && r[1] - r[0] === DAY ? r[0] : null;
  }

  renderVals() {
    const S = this.state;
    const d = this.props.d;
    const insee = d.insee;
    const nom = d.f.commune.nom;
    const T = this.T;
    const ND = this.ND;
    const formes = drones(d).formes;
    const r = this.periode();
    const now = today();
    const jour = this.jourChoisi();
    const kCal: Genre = "drone";
    const droneT = S.k === "vsa" ? [] : T.filter((c) => c.kind === "drone");
    const droneND = S.k === "vsa" ? [] : ND.filter((a) => a.kind === "drone");
    const ndIn = (a: NonDeduit) => deGenre(S.k, a.kind) && ndDans(a, r);

    // the tickets: the period's; a chosen day keeps the whole period's, as board B does (675
    // arrêtés on Wed. 4 Nov.), the day being said by the calendar's sentence and the edge's label
    const tk = tickets(T, ND, jour != null ? null : r, S.k);

    // « Jours de vol autorisés » (board B): one cell per day, darker by the acts of the day
    const W = Math.max(200, S.fw);
    const g = this.cal(W);
    const counts = joursComptes(droneT, droneND, kCal, g.A, g.B);
    const vu = S.jv >= 0 ? S.jv : S.jf >= 0 ? S.jf : jour;
    const style = (n: number, t0: number) => {
      const lv = niveau(n);
      const fill = lv ? `fill: var(--fg); fill-opacity: ${TEINTE_JOUR[lv]}` : "fill: var(--bg-2)";
      const stroke =
        t0 === jour
          ? "stroke: var(--type-registre); stroke-width: 2"
          : t0 === S.jf || t0 === S.jv
            ? "stroke: var(--fg); stroke-width: 1"
            : "stroke: none";
      return `${fill}; ${stroke}`;
    };
    const f2 = (x: number) => x.toFixed(2);
    type Txt = { x: string; y: string; a: string; st: string; t: string };
    type Lin = { x1: string; x2: string; y1: string; y2: string; st: string };
    const calTxt: Txt[] = [];
    const calLin: Lin[] = [];
    let cases: { x: string; y: string; w: string; h: string; st: string }[];
    const MUTED = "font: 400 9px 'Special Elite', monospace; fill: var(--muted)";
    if (!g.tel) {
      const grid = grilleSemaines(counts, g.A, g.B);
      const cw = g.step * CAL_W;
      const xOf = (col: number) => CAL_X + col * g.step;
      cases = grid.cases.map((c) => ({
        x: f2(xOf(c.col)),
        y: f2(CAL_Y0 + c.row * CAL_DY),
        w: f2(cw),
        h: f2(CAL_CH),
        st: style(c.n, c.t),
      }));
      calTxt.push(
        ...["cal_l", "cal_m", "cal_v", "cal_d"].map((k, i) => ({
          x: "-6",
          y: f2(CAL_Y0 + i * 2 * CAL_DY + 6.7),
          a: "end",
          st: MUTED,
          t: t(`carte.${k}`),
        })),
      );
      for (const m of reperesCal(g.A, g.B)) {
        const x = xOf(m.col) - 0.32;
        calLin.push({
          x1: f2(x),
          x2: f2(x),
          y1: "66.4",
          y2: m.an ? "70.4" : "69.4",
          st: m.an
            ? "stroke: var(--line); stroke-width: 1.5"
            : "stroke: var(--muted); stroke-width: 1",
        });
        calTxt.push({
          x: f2(x + 2),
          y: m.an ? "81.4" : "80.4",
          a: "start",
          st: m.an
            ? "font: 800 11px Archivo, sans-serif; fill: var(--fg)"
            : "font: 400 10px 'Special Elite', monospace; fill: var(--muted)",
          t: m.l,
        });
      }
      const sel = jour != null ? grid.cases.find((c) => c.t === jour) : undefined;
      if (sel) {
        const x = xOf(sel.col) + cw / 2;
        calLin.push({
          x1: f2(x),
          x2: f2(x),
          y1: "0",
          y2: "6",
          st: "stroke: var(--type-registre); stroke-width: 2",
        });
      }
    } else {
      const grid = grilleMois(counts, g.A, g.B);
      const cw = g.step - 1.2;
      cases = grid.cases.map((c) => ({
        x: f2(TEL_LW + c.col * g.step),
        y: f2(c.row * TEL_RH + 1),
        w: f2(cw),
        h: f2(TEL_RH - 2),
        st: style(c.n, c.t),
      }));
      calTxt.push(
        ...grid.mois.map((m, i) => ({
          x: "0",
          y: f2(i * TEL_RH + 9.5),
          a: "start",
          st: /\d/.test(m.l)
            ? "font: 800 10px Archivo, sans-serif; fill: var(--fg)"
            : "font: 400 10px 'Special Elite', monospace; fill: var(--muted)",
          t: m.l,
        })),
      );
    }
    const phrase = vu != null && vu >= 0 ? phraseJour(vu, droneT, droneND, kCal) : null;
    // the keyboard (as the weeks' chart had it): the arrows go from day to day, Enter chooses
    const bouger = (pas: number) => {
      const base = S.jf >= 0 ? S.jf : (jour ?? now);
      const x = Math.max(g.A, Math.min(now, base + pas));
      if (x !== S.jf) this.setState({ jf: x });
    };
    const moisPas = (k: number) => {
      const base = new Date(S.jf >= 0 ? S.jf : (jour ?? now));
      const x = Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + k, base.getUTCDate());
      this.setState({ jf: Math.max(g.A, Math.min(now, x)) });
    };
    const choisirJour = (x: number) =>
      this.setPeriode(x === jour ? null : [x, x + DAY], { jf: -1, jv: -1 });

    // the detail (A8, B3): the slot chosen or the act chosen without a slot, all its act says;
    // by default the panel only says what to hover or choose. A hover fills it not (B3).
    const cur = this.idx(S.sel);
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
      lieuxK: string;
      lieux: { l: string; voir: Handler | null; has: boolean }[];
      hasLieux: boolean;
      creneaux: { l: string; cur: string; href: string; pick: Handler }[];
      hasCreneaux: boolean;
      rows: { k: string; v: string }[];
      note: string;
      links: Lien[];
    } | null = null;
    if (cur >= 0) {
      const c = T[cur];
      const acte = c.actes[0];
      const e = d.ev.get(acte);
      const vsa = c.kind === "vsa";
      const zs = zonesDe(c, zones);
      const n = appareils(zs, e?.cameras);
      const statut = c.sites.length ? c.statut : null;
      const uniques = (xs: (string | null | undefined)[]) =>
        [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))].join(" ; ");
      const haut = zs.find((z) => z.hauteur_lue && z.hauteur);
      const dateA = e?.date ? dateTxt(jourMs(e.date)) : null;
      const ref = e?.ref ?? null;
      const page = e?.page ?? null;
      const nature = typeof e?.nature_vol === "string" ? e.nature_vol : "";
      const natureK = `carte.nature_${nature.replace(/\W+/g, "_")}`;
      const autres = (e?.partage ?? []).map((i) => d.f.communes[i]?.nom ?? i);
      const sig = signaler(e ?? { id: acte, affaire: acte });
      const freres = T.map((x, i) => [x, i] as const)
        .filter(([x]) => x.actes[0] === acte)
        .sort(([x], [y]) => x.t0 - y.t0);
      det = {
        c: aut.c,
        i: icone("aut"),
        k: t(vsa ? "carte.det_vsa" : "carte.det_drone"),
        title: plage(c),
        sub: dateA ? t("carte.det_acte_du", { date: dateA }) : "",
        lieuxK: t("carte.lieux_k"),
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
          ...ligne("carte.service", c.service ?? (e ? benefLabel(e) : null)),
          ...ligne("carte.pour_k", c.finalite ?? e?.objet ?? t("carte.finalite_non_lue")),
          ...(vsa
            ? ligne(
                "carte.cameras_k",
                n ? count(n, "camera") : (e?.cameras_lib as string) || t("commun.non_precise"),
              )
            : ligne("carte.appareils_k", n ? t("carte.n_drones", { n }) : t("commun.non_precise"))),
          ...(nature
            ? ligne("carte.nature_k", has(`registre.${natureK}`) ? t(natureK) : nature)
            : []),
          ...ligne(
            "carte.duree",
            c.heures != null ? heuresTxt(c.heures) : t("carte.horaires_non_precises_arrete"),
          ),
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
              : t("carte.zone_non_lue"),
          ),
          ...(haut ? ligne("carte.hauteur_k", t("carte.hauteur_m", { n: haut.hauteur ?? 0 })) : []),
          ...ligne("carte.type_acte_k", e?.sous_type),
          ...ligne("carte.communes_k", autres.join(", ")),
          ...ligne(
            "carte.source",
            ref ? (page ? t("carte.ref_page", { ref, page: String(page) }) : ref) : null,
          ),
        ],
        note: uniques(zs.map((z) => z.alerte)),
        links: [...voirArrete(c.url ?? e?.url), { ...sig, cls: "", c: "" }],
      };
    } else if (shownNd) {
      // an act without a drawn zone (panneau.png): its day and hours, who and which act, where
      // (the cited sector, the zone not read), then its reason, service, purposes and cameras
      const a = shownNd;
      const e = d.ev.get(a.acte);
      const js = joursDe(a);
      const jourA =
        jour != null && js.includes(jourIso(jour)) ? jour : js[0] ? jourMs(js[0]) : null;
      const hs = a.horaires?.length ? horairesMots(a) : "";
      const secteur = secteurPanneau(a);
      const dessine = (a.lieux ?? []).find((l) => l.forme && formes[l.forme]);
      det = {
        c: aut.c,
        i: icone("aut"),
        k: t(a.kind === "vsa" ? "carte.det_vsa" : "carte.det_drone"),
        title: [jourA != null ? jourLong(jourA) : t("format.date_non_publiee"), hs]
          .filter(Boolean)
          .join(" · "),
        sub: enTete(a),
        lieuxK: t("carte.ou_k"),
        lieux: [
          ...(secteur
            ? [
                {
                  l: secteur,
                  voir: dessine?.forme ? this.voirForme(dessine.forme) : null,
                  has: !!dessine && S.calque,
                },
              ]
            : []),
          { l: zonePanneau(a), voir: null, has: false },
        ],
        hasLieux: true,
        creneaux: [],
        hasCreneaux: false,
        rows: [
          ...ligne("carte.motif_k", motifTxt(a)),
          ...ligne("carte.service", a.service),
          ...ligne("carte.finalites_k", finalitesTxt(a).join(" ; ")),
          ...ligne("carte.cameras_drone_k", camerasTxt(a)),
          ...(hs ? [] : ligne("carte.horaires_k", horairesMots(a))),
          ...(js.length > 1
            ? ligne("carte.jours_k", js.map((j) => dateTxt(jourMs(j))).join(", "))
            : []),
        ],
        note: "",
        links: [
          ...voirArrete(a.url ?? e?.url),
          { ...signaler(e ?? { id: a.acte, affaire: a.acte }), cls: "", c: "" },
        ],
      };
    }
    if (det) det.hasLieux = det.lieux.length > 0;

    // the list: every slot of the period (DECISIONS 2026-10-29), newest first, the acts listed
    // without a slot among them by their date; each row's link is the view's own address with
    // its act (A4), the row the contract's (cadre.css « rows »). A row shows its date, hours,
    // service, reason and zone's state; a field not published is not there, nothing in its place.
    type Row = { at: number; row: Record<string, unknown> };
    const rows: Row[] = [];
    const href = (k: string) => `${communeHref(insee, "carte")}${this.requete(k)}`;
    const LONG = t("carte.horaires_non_publies");
    T.forEach((c, i) => {
      if (!this.inP(c) || (S.sz && c.sites.length)) return;
      const k = this.K[i];
      const toute = c.sites.length > 0 && c.sites.every((s) => S.ent.includes(s));
      const h = c.heures != null ? heuresTxt(c.heures) : t("carte.horaires_non_precises");
      rows.push({
        at: c.t0,
        row: {
          ...this.ligne(k, "aut", "r zrow"),
          pick: this.choix(k),
          href: href(k),
          d: dateTxt(c.t0),
          svc: c.service ?? "",
          fin: [
            ...(toute ? [t("carte.toute_la_commune")] : []),
            t(c.kind === "vsa" ? "carte.analyse_algorithmique" : "carte.mot_drones"),
            ...(c.finalite ? [c.finalite] : []),
          ].join(" · "),
          zst: c.sites.length ? "" : t("carte.zone_non_lue"),
          h,
          hc: "h num",
        },
      });
    });
    ND.forEach((a) => {
      if (!ndIn(a)) return;
      const m = motsLigne(a);
      const js = joursDe(a);
      const at = jour != null && js.includes(jourIso(jour)) ? jour : a.date ? jourMs(a.date) : 0;
      rows.push({
        at,
        row: {
          ...this.ligne(a.acte, "aut", "r zrow"),
          pick: this.choix(a.acte),
          href: href(a.acte),
          d: at ? dateTxt(at) : t("format.date_non_publiee"),
          svc: m.svc,
          fin: "",
          zst: m.zst,
          h: m.h,
          hc: m.h === LONG ? "h hl" : "h num",
        },
      });
    });
    rows.sort((a, b) => b.at - a.at);
    const shownT = T.filter((c) => this.inP(c) && !(S.sz && c.sites.length));
    const shownND = ND.filter(ndIn);
    const nSlots = shownT.length;
    const nNd = shownND.length + shownT.filter((c) => !c.sites.length).length;
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

    // the filter: drones, algorithms, or both, with the slots of each over the period (a chosen
    // day's: the whole period's, as the tickets and board B)
    const rk = jour != null ? null : r;
    const nDe = (k: Genre) =>
      T.filter((c) => deGenre(k, c.kind) && (!rk || overlaps(c, rk[0], rk[1]))).length +
      ND.filter((a) => deGenre(k, a.kind) && ndDans(a, rk)).length;
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
          if (S.k !== k && (n > 0 || k === null)) this.setState({ k, sel: null, vu: null });
        }) as Handler,
      };
    });

    // the kind the tickets count: the one chosen, else the only one the commune has
    const vuK: Genre = S.k ?? (genres[2].n === "0" ? "drone" : genres[1].n === "0" ? "vsa" : null);

    // the list's title: the day (board B: « Mer. 4 nov. 2026 · 1 arrêté · 8 h de vol »), the acts
    // without a drawn zone, or the period
    const hJour = jour != null ? sumHours(shownT, r) : 0;
    const arr = count(nActes, "arrete");
    const listT = S.sz
      ? t("carte.liste_sz", { arr })
      : jour != null
        ? `${t("carte.liste_jour", { date: jourLong(jour), arr })}${
            hJour ? t("carte.liste_h_vol", { h: heuresTxt(hJour) }) : ""
          }`
        : !rows.length
          ? t("carte.liste_t", { n: 0 })
          : nSlots
            ? `${t("carte.liste_t2", { n: nSlots, arr })}${nNd ? t("carte.liste_nd", { n: nNd }) : ""}`
            : `${t("carte.liste_arretes", { arr })}${nNd ? t("carte.liste_nd", { n: nNd }) : ""}`;

    const isLarge = large();
    const finCal = Math.min(g.B - DAY, now);
    const sousCal = t("carte.cal_sous", {
      de: String(new Date(g.A).getUTCFullYear()),
      a: String(new Date(finCal).getUTCFullYear()),
    });
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
      hasDrone: S.k !== "vsa",
      hasEnt: S.ent.length > 0 && S.k !== "vsa",
      hasFrise: droneT.length + droneND.length > 0,
      is3d: S.is3d ? "true" : "false",
      tog3d: (() => this.ease({ pitch: S.is3d ? 0 : inclinaison() })) as Handler,
      rotL: (() => this.ease({ bearing: (this.map?.getBearing() ?? 0) + TURN })) as Handler,
      rotR: (() => this.ease({ bearing: (this.map?.getBearing() ?? 0) - TURN })) as Handler,
      north: (() => this.ease({ bearing: 0 })) as Handler,
      titreLong: t("carte.titre_long"),
      genres,
      nA: fr(tk.actes),
      lA: t(
        vuK === "vsa" ? "carte.t_arretes_vsa" : vuK ? "carte.t_arretes" : "carte.t_arretes_tous",
        { n: tk.actes },
      ),
      // board B's four tickets (lot R4.2): acts, hours read, drawn zones, zones not read
      nHL: fr(tk.horairesLus),
      nTR: fr(tk.tracees),
      lTR: t("carte.t_tracees", { n: tk.tracees }),
      nNL: fr(tk.nonLues),
      lNL: t("carte.t_non_lues", { n: tk.nonLues }),
      calSous: sousCal,
      allOn: r || S.sz ? "false" : "true",
      allYear: (() => this.setPeriode(null, { sz: false })) as Handler,
      // v2.3 (Ju): the legend a ticket beside the commands, the calendar a thin band, both folded
      // by default on a wide screen (DECISIONS 2026-10-31); folded, the chosen day stays in the band
      legOuverte: !isLarge || S.leg,
      legTicket: isLarge,
      legPressed: S.leg ? "true" : "false",
      togLeg: (() => this.setState({ leg: !S.leg })) as Handler,
      friseOuverte: !isLarge || S.frise,
      friseBande: isLarge,
      friseExp: S.frise ? "true" : "false",
      togFrise: (() => this.setState({ frise: !S.frise })) as Handler,
      // unfolded, the band only folds it (the calendar's own title says the rest)
      friseBandeL: S.frise
        ? t("carte.cal_replier")
        : [
            t("carte.cal_titre"),
            ...(jour != null && phrase && vu === jour
              ? [`${phrase.date} · ${phrase.reste}`]
              : [sousCal]),
          ].join(" · "),
      friseAide: t(S.frise ? "carte.cal_replier" : "carte.cal_deplier"),
      fw: String(W),
      calH: String(g.H),
      vb: `0 0 ${W} ${g.H}`,
      calCls: g.tel ? "cal-tel" : "cal-large",
      cases,
      calTxt,
      calLin,
      calAlt: t("carte.cal_alt", { nom, de: dateTxt(g.A), a: dateTxt(finCal) }),
      calAide: t(g.tel ? "carte.cal_aide_tel" : "carte.cal_aide"),
      calLive: S.jf >= 0 && phrase ? `${phrase.date} · ${phrase.reste}` : "",
      hasSum: !!phrase,
      sum: phrase ?? { date: "", reste: "" },
      calClick: ((e) => {
        const x = this.jourSous(e);
        if (x != null) choisirJour(x);
      }) as Handler,
      calMove: ((e) => {
        const x = this.jourSous(e) ?? -1;
        if (x !== S.jv) this.setState({ jv: x });
      }) as Handler,
      calLeave: (() => {
        if (S.jv >= 0) this.setState({ jv: -1 });
      }) as Handler,
      calKey: ((e) => {
        const k = e.key;
        const [hb, gd] = g.tel ? [0, DAY] : [DAY, 7 * DAY];
        if (k === "ArrowRight") bouger(gd);
        else if (k === "ArrowLeft") bouger(-gd);
        else if (k === "ArrowDown") g.tel ? moisPas(-1) : bouger(hb);
        else if (k === "ArrowUp") g.tel ? moisPas(1) : bouger(-hb);
        else if (k === "Home") this.setState({ jf: g.A });
        else if (k === "End") this.setState({ jf: now });
        else if ((k === "Enter" || k === " ") && S.jf >= 0) choisirJour(S.jf);
        else if (k === "Escape" && S.jf >= 0) this.setState({ jf: -1 });
        else return;
        e.preventDefault();
      }) as Handler,
      hasDet: det !== null,
      // nothing to choose: no hint about choosing (Paris, a period without a flight)
      noDet: det === null && rows.length > 0,
      hasGenres: T.length + ND.length > 0,
      hasPanel: det !== null || rows.length > 0,
      det,
      clear: (() => this.setState({ sel: null, vu: null })) as Handler,
      unhover: this.quitter(),
      listT,
      hasSz: S.sz,
      szTous: (() => this.setState({ sz: false, sel: null, vu: null })) as Handler,
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
