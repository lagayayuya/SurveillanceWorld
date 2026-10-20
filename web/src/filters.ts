// Filter panel, with the legend in a foldable section. It follows the zoom and only shows
// what is on screen. On a phone it is a full-screen layer opened by the "Filtres" button;
// on a wide screen a side panel. The reach estimate is chosen in a bar at the top. Every row is a toggle with the number of cameras in view. Below the street level
// (z15) "who films" is a two-state switch between the two precomputed aggregate sets (all
// cameras / public only); from z15 it filters cameras by operator, and types become
// filterable too. The reach estimate (certain / probable / cautious) applies at every zoom.
// Below: the advanced filters drawer (advanced.ts).

import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MlMap,
} from "maplibre-gl";
import { AdvancedFilters, type FilterMeta } from "./advanced";
import { basemap } from "./basemap";
import { type Focus, type LabelRoom, NO_POINTS, reachLabelPoints } from "./focus";
import { t } from "./i18n";
import { areaCanvas, cameraCanvas, KINDS, type Kind, levelCanvas, MARKS } from "./icons";
import {
  anyBit,
  areaColour,
  areaCountKey,
  areaKey,
  areasEmpty,
  areasMapped,
  CITY_FADE,
  COMMUNES_MIN,
  DEFAULT_LEVEL,
  DETAIL_MIN,
  detailFilters,
  FIELD_DASH,
  FIELD_LEVELS,
  FOCUS_CAMERA,
  FOCUS_FIELD,
  FOCUS_ZONE,
  fanFilter,
  fieldPaint,
  filteredPortionColour,
  focusedPortionColour,
  focusFieldFilter,
  focusPortionFilter,
  type Level,
  MAYBE_GONE,
  type Mode,
  NO_CAMERA,
  opacities,
  PROPOSAL_HIT,
  PROPOSAL_LINK_HALO,
  PROPOSAL_TAPE,
  pictoColour,
  portionColour,
  portionFilter,
  portionOpacity,
  selectedFilter,
} from "./layers";
import { isPhone } from "./layout";
import type { MachineView } from "./machine";
import type { ParticipationMeta } from "./participate";
import { STREET_FILTER_MIN, StreetFilter } from "./streetfilter";
import { palette, ui } from "./theme";
import { readParam, writeParams } from "./url";

export const OPERATORS = ["pub", "pro", "pri", "unk"] as const;
type Op = (typeof OPERATORS)[number];
export type Meta = FilterMeta &
  ParticipationMeta & {
    /** Every estimate computed, by band index; the shown ones' indices. */
    estimates: string[];
    shown_estimates: number[];
    /** The pipeline's reference estimate (colour breaks); the map opens on another one. */
    default_estimate: number;
    opening_estimate: number;
    /** Cameras of these kinds without a direction are drawn light (rules/direction.yaml). */
    unknown_direction: { kinds: string[] };
    /** Farthest filled field (m): "Qui filme" widens the view by it. */
    max_range_m: number;
    /** Median wide field of view of PTZ cameras (catalogue), for their sheet. */
    ptz_hfov_p50: number;
    communes: Record<string, { breaks: number[]; max: number }>;
    departements: Record<string, { breaks: number[]; max: number }>;
    /** The punk map's fixed classes, in % (rules/admin.yaml area_class_breaks_pct). */
    area_classes?: number[];
  };

type AreaKind = "communes" | "departements";

// Names in links: none for "Standard" (the map opens on it), ?est=prudent for "Prudent"
// (the pipeline's `cautious`). Older links open the estimate that took their place:
// typical, probable, certain -> Standard; cautious, possible -> Prudent.
const URL_NAME: Record<string, string> = { cautious: "prudent" };
const URL_ALIAS: Record<string, string> = {
  standard: "probable",
  typical: "probable",
  certain: "probable",
  prudent: "cautious",
  possible: "cautious",
};

/** The ?est= value of estimate `i`, null for the one the map opens on. */
export function estimateParam(meta: Meta, i: number): string | null {
  if (i === meta.opening_estimate) return null;
  const name = meta.estimates[i];
  return URL_NAME[name] ?? name;
}

/** Reach estimate index from the URL (?est=probable), else the one the map opens on. */
export function initialEstimate(meta: Meta): number {
  const value = readParam("est") ?? "";
  const i = meta.estimates.indexOf(URL_ALIAS[value] ?? value);
  return meta.shown_estimates.includes(i) ? i : meta.opening_estimate;
}

/** A camera without a surveyed direction, drawn light (rules/direction.yaml). */
export function withoutDirection(meta: Meta, p: Record<string, unknown>): boolean {
  return Number(p.d ?? -1) < 0 && meta.unknown_direction.kinds.includes(String(p.k));
}

type Counts = {
  byOp: Record<string, number>;
  byKind: Record<string, number>;
  byRow: Record<string, number>;
  byOperator: number;
  approx: boolean;
  /** Cameras in view, and those the filters keep (punk counter). */
  total: number;
  shown: number;
};

export type PanelElements = { panel: HTMLElement; estimate: HTMLElement; fab: HTMLElement };

/** The punk interface's panel (machine.ts): its own DOM, patched at each render. */
export type Skin = {
  render(view: MachineView): void;
  setOpened(opened: boolean): void;
  estimateBar(bar: HTMLElement): void;
};
/** « État de la fiche » (punk, mockup 20a): what a key hides when released. */
type SheetState = "maybe_gone" | "pending";
const MAYBE_GONE_BIT = 4;
const maybeGone = (fl: number) => Math.floor(fl / MAYBE_GONE_BIT) % 2 === 1;

export class FilterPanel {
  private ops = new Set<Op>(OPERATORS);
  private kinds = new Set<Kind>(KINDS);
  /** Wide screen: side panel folded to its title. */
  private collapsed = false;
  /** Phone: full-screen layer shown. */
  opened = false;
  private legendOpen = !isPhone();
  private est: number;
  /** Called after the estimate changed (the sheet shows it). */
  onEstimate: () => void = () => {};
  /** Called after "who films" changed below the street level (an area sheet shows it). */
  onWho: () => void = () => {};
  private root: HTMLElement;
  private streets: StreetFilter;
  readonly adv: AdvancedFilters;
  /** Camera in focus (clicked): feature id, compact number (`n`) and position, or null. */
  focus: Focus | null = null;
  /** Punk: the focused camera's level the map shows, chosen by the sheet's tickets
   * (DECISIONS 2026-10-08, « Punk focus… »); identifie when a camera comes into focus. */
  level: Level = DEFAULT_LEVEL;
  /** The punk interface's panel (machine.ts), set by main.ts; null: the current panel. */
  private skin: Skin | null = null;
  /** « État de la fiche » (punk): the states whose cameras are hidden. */
  private hiddenStates = new Set<SheetState>();
  /** Cameras with a pending proposal in the loaded tiles: feature ids and compact numbers. */
  private pendingIds: number[] = [];
  private pendingNs = new Set<number>();

  constructor(
    private map: MlMap,
    private els: PanelElements,
    private meta: Meta,
  ) {
    this.root = els.panel;
    this.streets = new StreetFilter(map, window.location.origin, () => {
      this.apply();
      this.render();
    });
    els.fab.addEventListener("click", () => this.setOpened(this.skin ? !this.opened : true));
    this.est = initialEstimate(meta);
    this.adv = new AdvancedFilters(meta, ui() === "punk" ? "punk" : "classique");
    this.adv.fromParams(readParam("f"), readParam("op"));
    map.on("idle", () => this.render());
    map.on("zoomend", () => this.render());
  }

  /** The punk panel takes over the drawing (main.ts, once machine.ts is loaded). */
  setSkin(skin: Skin): void {
    this.skin = skin;
    this.els.estimate.dataset.est = "";
    this.render();
  }

  /** Phone: show or hide the full-screen filters; punk: the machine, on every screen. */
  setOpened(opened: boolean): void {
    this.opened = opened;
    this.skin?.setOpened(opened);
    this.render();
  }

  setEstimate(i: number): void {
    this.est = i;
    this.apply();
    this.render();
    this.onEstimate();
  }

  /** Whether a camera passes every active filter (who, type, advanced, operator; punk: the
   * sheet's state, a pending correction known by the camera's compact number `n`). */
  passes(
    p: { o: string; k: string; fl: number; op?: number; n?: number },
    opIds = new Set(this.adv.operatorIds()),
  ): boolean {
    return (
      this.ops.has(p.o as Op) &&
      this.kinds.has(p.k as Kind) &&
      this.adv.matches(p, this.est, opIds) &&
      !(this.hiddenStates.has("maybe_gone") && maybeGone(Number(p.fl ?? 0))) &&
      !(this.hiddenStates.has("pending") && p.n !== undefined && this.pendingNs.has(Number(p.n)))
    );
  }

  // --- what the punk machine does (machine.ts MachineActions) -----------------------------
  toggleOp(op: string, on: boolean): void {
    if (on) this.ops.add(op as Op);
    else this.ops.delete(op as Op);
    this.changed();
  }
  setPublicOnly(pub: boolean): void {
    this.ops = new Set(pub ? ["pub"] : OPERATORS);
    this.changed();
    this.onWho();
  }
  toggleKind(kind: Kind, on: boolean): void {
    if (on) this.kinds.add(kind);
    else this.kinds.delete(kind);
    this.changed();
  }
  /** A state's key pressed (`on`: its cameras shown) or released (hidden). */
  toggleState(id: SheetState, on: boolean): void {
    if (on) this.hiddenStates.delete(id);
    else this.hiddenStates.add(id);
    this.findPending();
    this.changed();
  }
  toggleAdv(id: string, on: boolean): void {
    if (on) this.adv.active.add(id);
    else this.adv.active.delete(id);
    this.changed();
  }
  setOperator(query: string): void {
    this.adv.operatorQuery = query;
    this.changed();
  }
  setAdvOpen(open: boolean): void {
    this.adv.open = open;
  }
  /** « Tout réafficher »: every filter off. */
  reset(): void {
    const below = this.mode.publicOnly;
    this.ops = new Set(OPERATORS);
    this.kinds = new Set(KINDS);
    this.adv.active.clear();
    this.adv.operatorQuery = "";
    this.hiddenStates.clear();
    this.changed();
    if (below) this.onWho();
  }
  private changed(): void {
    this.apply();
    this.render();
  }

  /** Cameras of the loaded tiles with a pending proposal (participation's source
   * "proposals": moves and « introuvable »), when their key is released; true when the set
   * changed. */
  private findPending(): boolean {
    const ids: number[] = [];
    const ns = new Set<number>();
    if (this.hiddenStates.has("pending") && this.map.getSource("proposals")) {
      const wanted = new Set(
        this.map
          .querySourceFeatures("proposals")
          .filter((f) => f.properties.k !== "add")
          .map((f) => String(f.properties.c)),
      );
      for (const f of this.map.querySourceFeatures("detail", { sourceLayer: "cameras" })) {
        if (f.id === undefined || !wanted.has(String(f.properties.id))) continue;
        if (!ids.includes(Number(f.id))) ids.push(Number(f.id));
        ns.add(Number(f.properties.n));
      }
    }
    ids.sort((a, b) => a - b);
    const same =
      ids.length === this.pendingIds.length && ids.every((v, i) => v === this.pendingIds[i]);
    this.pendingIds = ids;
    this.pendingNs = ns;
    return !same;
  }

  /** Groups of active criteria as segment-bit names: who, type, then each advanced group
   * (not the operator search). */
  private bitGroups(): string[][] {
    const groups: string[][] = [];
    if (this.ops.size < OPERATORS.length) groups.push([...this.ops].map((o) => `op:${o}`));
    if (this.kinds.size < KINDS.length) groups.push([...this.kinds].map((k) => `kind:${k}`));
    return [...groups, ...this.adv.bitGroups(this.est)];
  }

  /** Merged portions (z12-14) kept by the filters: every group has a camera of one of its
   * categories all along the portion (portions are cut where camera profiles change).
   * Exact with one group; with several, the cameras may differ (said in the panel).
   * null: no group active. */
  private lowKept(): ExpressionSpecification | null {
    const groups = this.bitGroups();
    if (!groups.length) return null;
    const bits = this.meta.segment_bits;
    const key = "fb";
    // A criterion without a segment bit (verified gone: films nothing) keeps no street.
    const tests = groups.map((g): ExpressionSpecification => {
      const ids = g.map((name) => bits[name]).filter((b) => b !== undefined);
      return ids.length ? anyBit(key, ids) : ["literal", false];
    });
    return tests.length === 1 ? tests[0] : (["all", ...tests] as ExpressionSpecification);
  }

  /** Number of active restrictions (who, type, advanced), for the button label. */
  get activeCount(): number {
    return (
      (this.ops.size < OPERATORS.length ? 1 : 0) +
      (this.kinds.size < KINDS.length ? 1 : 0) +
      this.adv.active.size +
      (this.adv.operatorQuery.trim() ? 1 : 0) +
      this.hiddenStates.size
    );
  }

  /** Active restrictions set in the street view, whose keys the machine shows from the street
   * level only (types, the four « Qui filme » keys, the sheets' state, the drawer): all but
   * « public only », which every zoom shows. */
  get streetActiveCount(): number {
    return this.activeCount - (this.mode.publicOnly ? 1 : 0);
  }

  /** Punk: what the active filters hide whole in the view (DECISIONS 2026-10-09): every
   * camera (street level, some in view), else every filmed street (from z12, some filmed in
   * view: by the filter bits below z15, by the marks from z15); null when something stays
   * or no filter is active. */
  private hiddenWhole(z: number, c: Counts): "cameras" | "streets" | null {
    if (!this.activeCount) return null;
    if (z >= DETAIL_MIN && c.total > 0 && c.shown === 0) return "cameras";
    if (z < CITY_FADE[1]) return null;
    const lowKept = this.lowKept();
    const marked = z >= STREET_FILTER_MIN && this.streets.ready;
    if (!marked && (z >= STREET_FILTER_MIN || lowKept === null)) return null;
    const any = (filter: FilterSpecification): boolean => {
      const b = this.map.getBounds();
      return this.map
        .querySourceFeatures("streets", { sourceLayer: "portions", filter })
        .some(
          (f) =>
            f.geometry.type === "LineString" &&
            f.geometry.coordinates.some(([lng, lat]) => b.contains([lng, lat])),
        );
    };
    const filmed = portionFilter(this.est);
    if (!any(filmed)) return null;
    const kept = marked
      ? this.streets.count > 0
      : any(["all", filmed, lowKept] as unknown as FilterSpecification);
    return kept ? null : "streets";
  }

  get mode(): Mode {
    return { publicOnly: this.ops.size === 1 && this.ops.has("pub"), est: this.est };
  }

  get estimateName(): string {
    return this.meta.estimates[this.est];
  }

  /** Push the current state into the map style. */
  apply(): void {
    const m = this.map;
    const mode = this.mode;
    const ck = areaCountKey(mode);
    const areas: [string, AreaKind][] = [
      ["communes", "communes"],
      ["deps", "departements"],
    ];
    for (const [id, kind] of areas) {
      m.setFilter(id, areasMapped(ck));
      m.setFilter(`${id}-none`, areasEmpty(ck));
      m.setPaintProperty(id, "fill-color", areaColour(areaKey(mode), this.breaks(kind)));
    }
    // Filmed portions follow every filter, "public only" included: from their filter bits at
    // z12-14, from the exact marks from z15 once cameras.json is in (streetfilter.ts).
    const opIds = new Set(this.adv.operatorIds());
    this.streets.set(this.activeCount ? (p) => this.passes(p, opIds) : null, this.est);
    const marked = this.streets.ready;
    const lowKept = this.lowKept();
    const filtered = marked || lowKept !== null;
    const portions = filtered ? portionOpacity(lowKept, marked) : null;
    // The punk interface dims the rest of the map only where the focused field is drawn.
    const whereFields = ui() === "punk";
    for (const [id, prop, value] of opacities(this.focus?.id ?? null, portions, whereFields)) {
      m.setPaintProperty(id, prop, value);
    }
    // Focus by style (id in filters and paint): it holds for tiles loaded later. A focused
    // camera the filters hide loses its outlines and highlight too.
    const shownFocus = this.focus && this.passes(this.focus.props) ? this.focus : null;
    if (this.skin) {
      this.applyLevel(shownFocus?.id ?? NO_CAMERA);
      for (const [id, prop, value] of fieldPaint(shownFocus?.id ?? null))
        m.setPaintProperty(id, prop, value);
    } else m.setFilter("bands-fan", fanFilter(shownFocus?.id ?? NO_CAMERA, this.est));
    m.setFilter("camera-selected", selectedFilter(shownFocus?.id ?? NO_CAMERA));
    m.setPaintProperty("cameras", "icon-color", pictoColour(this.focus?.id ?? null));
    // Punk has no casing under the focused camera's streets.
    for (const id of ["focus-streets-casing", "focus-streets"]) {
      if (m.getLayer(id)) m.setFilter(id, focusPortionFilter(shownFocus?.n ?? NO_CAMERA, this.est));
    }
    this.refreshFocus();
    // Reach labels (GeoJSON) only while a camera is focused, on wide screens (punk: the
    // chosen level's, on every screen): a source with no visible layer is "unused" and loads
    // no tiles (maplibre-gl style.ts, tile_manager.ts).
    m.setLayoutProperty(
      "focus-labels",
      "visibility",
      this.focus && (this.skin || !isPhone()) ? "visible" : "none",
    );
    m.setFilter("focus-labels", this.labelFilter());
    m.setFilter("portions", portionFilter(this.est));
    m.setPaintProperty(
      "portions",
      "line-color",
      this.skin && shownFocus
        ? focusedPortionColour(lowKept, marked)
        : filtered
          ? filteredPortionColour(lowKept, marked)
          : portionColour(),
    );
    const advanced = this.adv.expression(this.est);
    // Punk « État de la fiche »: a released key hides its cameras (the « maybe gone » flag,
    // on cameras and bands alike; a pending correction by the camera's feature id, which
    // the bands carry as `i`).
    const states = (bands: boolean): ExpressionSpecification[] => [
      ...(this.hiddenStates.has("maybe_gone")
        ? [["!", MAYBE_GONE] as ExpressionSpecification]
        : []),
      ...(this.hiddenStates.has("pending")
        ? [
            [
              "!",
              ["in", bands ? ["get", "i"] : ["id"], ["literal", this.pendingIds]],
            ] as ExpressionSpecification,
          ]
        : []),
    ];
    const byOpKind = (bands: boolean): FilterSpecification =>
      [
        "all",
        ["in", ["get", "o"], ["literal", [...this.ops]]],
        ["in", ["get", "k"], ["literal", [...this.kinds]]],
        ...(advanced ? [advanced] : []),
        ...states(bands),
      ] as FilterSpecification;
    for (const [id, base] of Object.entries(detailFilters(this.est, this.adv.active.has("gone")))) {
      const own = byOpKind(id.startsWith("bands") || id.startsWith("field"));
      const filter = base ? (["all", base, own] as unknown as FilterSpecification) : own;
      m.setFilter(id, filter);
    }
    // The proposals' marks and ghosts follow « Correction en attente » (punk).
    if (this.skin) {
      const shown = this.hiddenStates.has("pending") ? "none" : "visible";
      for (const id of [
        "proposal-ghost",
        "proposal-link",
        PROPOSAL_LINK_HALO,
        PROPOSAL_TAPE,
        PROPOSAL_HIT,
      ])
        if (m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== shown)
          m.setLayoutProperty(id, "visibility", shown);
    }
    writeParams({ est: estimateParam(this.meta, this.est), ...this.adv.toParams() });
  }

  /** Wide screens: every level's label while the focused field is hovered (the classique;
   * punk shows the chosen level's alone). */
  allLabels = false;
  setAllLabels(all: boolean): void {
    if (all === this.allLabels) return;
    this.allLabels = all;
    this.map.setFilter("focus-labels", this.labelFilter());
  }

  private labelFilter(): FilterSpecification | null {
    if (this.skin) return ["==", ["get", "lv"], this.level];
    return this.allLabels ? null : ["==", ["get", "lv"], 3];
  }

  /** Punk: show the focused camera's level `lv` alone (the sheet's tickets). */
  setLevel(lv: Level): void {
    if (lv === this.level) return;
    this.level = lv;
    if (!this.skin) return;
    const shown = this.focus && this.passes(this.focus.props) ? this.focus : null;
    this.applyLevel(shown?.id ?? NO_CAMERA);
    this.map.setFilter("focus-labels", this.labelFilter());
  }

  /** The focused camera's whole zone, and its chosen level on top: its pattern and its
   * outline's dash (punk). */
  private applyLevel(id: number): void {
    const m = this.map;
    for (const zone of FIELD_LEVELS) {
      const f = focusFieldFilter(id, this.est, zone);
      m.setFilter(`${FOCUS_ZONE}-${zone}`, f);
      m.setFilter(`${FOCUS_ZONE}-${zone}-line`, f);
    }
    const lv = this.level;
    const filter = focusFieldFilter(id, this.est, lv);
    m.setFilter(FOCUS_FIELD, filter);
    m.setFilter("bands-fan", filter);
    m.setPaintProperty(FOCUS_FIELD, "fill-pattern", MARKS.fields[lv - 1]);
    const dash = FIELD_DASH[lv];
    m.setPaintProperty("bands-fan", "line-dasharray", dash ? ["literal", dash] : undefined);
    m.setLayoutProperty("bands-fan", "line-cap", dash?.[0] === 0 ? "round" : "butt");
  }

  /** Punk: where the level's label may go (main.ts: the free part of the map, minus the
   * floating buttons); null: at the farthest vertex wherever it is (the classique). */
  labelRoom: (() => LabelRoom) | null = null;

  private focusData: Record<string, string> = {};
  /** Reach label points of the focused camera, and its marker below the street level (a
   * source of the punk interface only); set only when they change (called on every idle:
   * setting unchanged data would re-render and fire idle again). */
  refreshFocus(): void {
    const f = this.focus;
    const put = (source: string, data: object) => {
      const target = this.map.getSource(source) as GeoJSONSource | undefined;
      const json = JSON.stringify(data);
      if (!target || json === this.focusData[source]) return;
      this.focusData[source] = json;
      target.setData(data as Parameters<GeoJSONSource["setData"]>[0]);
    };
    put(
      "focus-points",
      f ? reachLabelPoints(this.map, f, this.est, this.labelRoom?.()) : NO_POINTS,
    );
    // Like its outlines, the marker of a camera the filters hide is not drawn.
    const shown = f && this.passes(f.props) ? f : null;
    put(FOCUS_CAMERA, {
      type: "FeatureCollection",
      features: shown
        ? [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: shown.lngLat },
              properties: { k: shown.props.k },
            },
          ]
        : [],
    });
  }

  /** Colour breaks of one kind of area: on the high end of its "between X % and Y %",
   * whatever the estimate chosen. Punk: fixed classes, the same for both kinds of area
   * and for « Publiques » (DECISIONS 2026-10-09, « Fixed classes… »); the classique keeps
   * its quantiles (tiles.share_breaks). */
  breaks(kind: AreaKind): number[] {
    if (ui() === "punk" && this.meta.area_classes) return this.meta.area_classes;
    return this.meta[kind]?.[this.mode.publicOnly ? "hi_pub" : "hi"]?.breaks ?? [];
  }

  /** The kind of area drawn at zoom `z` (below the street level). */
  areaKind(z: number): AreaKind {
    return z < COMMUNES_MIN ? "departements" : "communes";
  }

  private counts(): Counts {
    const m = this.map;
    // The view widened by the farthest filled field: a camera just outside reaches in.
    const b = m.getBounds();
    const pad = this.meta.max_range_m / 111_320;
    const padLng = pad / Math.cos((b.getCenter().lat * Math.PI) / 180);
    b.extend([b.getWest() - padLng, b.getSouth() - pad]).extend([
      b.getEast() + padLng,
      b.getNorth() + pad,
    ]);
    const byOp: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    const byRow: Record<string, number> = {};
    let byOperator = 0;
    let [total, shown] = [0, 0];
    if (m.getZoom() >= DETAIL_MIN) {
      const seen = new Set<string | number>();
      const opIds = new Set(this.adv.operatorIds());
      const goneShown = this.adv.active.has("gone");
      for (const f of m.querySourceFeatures("detail", { sourceLayer: "cameras" })) {
        if (f.geometry.type !== "Point" || f.id === undefined || seen.has(f.id)) continue;
        const [lng, lat] = f.geometry.coordinates;
        if (!b.contains([lng, lat])) continue;
        seen.add(f.id);
        const p = f.properties;
        // A camera verified gone counts only in its own row (it is hidden otherwise).
        // The punk counter: what is in view, what the filters keep.
        const tally = () => {
          if (!this.skin) return;
          total++;
          if (this.passes(p as Focus["props"], opIds)) shown++;
        };
        if (p.gm !== undefined) {
          byRow.gone = (byRow.gone ?? 0) + 1;
          if (goneShown) tally();
          continue;
        }
        tally();
        byOp[p.o] = (byOp[p.o] ?? 0) + 1;
        byKind[p.k] = (byKind[p.k] ?? 0) + 1;
        // Advanced rows count the cameras in view having the property, whatever the filters.
        for (const row of this.adv.rows) {
          if (row.test(p, this.est)) byRow[row.id] = (byRow[row.id] ?? 0) + 1;
        }
        if (this.adv.matchesOperator(p, opIds)) byOperator++;
      }
      return { byOp, byKind, byRow, byOperator, approx: false, total, shown };
    }
    // Lower zooms: sum the communes (départements in the wide view) whose inner point is in
    // view (approximate at the screen's edges).
    const seen = new Set<string>();
    const layer = this.areaKind(m.getZoom());
    for (const f of m.querySourceFeatures("admin", { sourceLayer: layer })) {
      const p = f.properties;
      if (seen.has(p.c) || !b.contains([Number(p.lx), Number(p.ly)])) continue;
      seen.add(p.c);
      for (const op of OPERATORS) byOp[op] = (byOp[op] ?? 0) + Number(p[`n_${op}`] ?? 0);
    }
    total = OPERATORS.reduce((a, op) => a + (byOp[op] ?? 0), 0);
    shown = this.mode.publicOnly ? (byOp.pub ?? 0) : total;
    return { byOp, byKind, byRow, byOperator, approx: true, total, shown };
  }

  render(): void {
    this.streets.refresh();
    const z = this.map.getZoom();
    if (this.skin) {
      // The pending corrections in view may have changed (proposals refreshed, tiles in).
      if (this.findPending()) this.apply();
      this.renderEstimateBar();
      this.skin.render(this.machineView(z, this.counts()));
      return;
    }
    const c = this.counts();
    const root = this.root;
    // The panel is redrawn on every map idle: keep the operator search focused while typing.
    const typing = document.activeElement?.id === "adv-operator";
    const caret = typing ? (document.activeElement as HTMLInputElement).selectionStart : null;
    this.renderEstimateBar();
    const n = this.activeCount;
    const fabText = n ? t("fab.filters_n", { n }) : t("fab.filters");
    if (this.els.fab.textContent !== fabText) this.els.fab.textContent = fabText;
    if (this.els.fab.hidden !== this.opened) this.els.fab.hidden = this.opened;
    root.replaceChildren();
    const phone = isPhone();
    root.classList.toggle("collapsed", !phone && this.collapsed);
    root.classList.toggle("open", phone && this.opened);

    let head: HTMLElement;
    if (phone) {
      head = el("div", { class: "panel-head" });
      const close = el("button", { class: "panel-close" }, t("filters.close"));
      close.addEventListener("click", () => this.setOpened(false));
      head.append(el("span", {}, t("legend.title")), close);
    } else {
      head = el("button", { class: "panel-head", "aria-expanded": String(!this.collapsed) });
      head.append(el("span", {}, t("legend.title")), el("span", { class: "chevron" }, "▾"));
      head.addEventListener("click", () => {
        this.collapsed = !this.collapsed;
        this.render();
      });
    }
    const body = el("div", { class: "panel-body" });
    root.append(head, body);

    // The legend: what the chosen estimate means and what the colours mean at this zoom.
    const legend = el("details", { class: "legend" }) as HTMLDetailsElement;
    legend.open = this.legendOpen;
    legend.addEventListener("toggle", () => {
      this.legendOpen = legend.open;
    });
    legend.append(el("summary", {}, t("legend.section")));
    // The subtitle already names the zone ("Zone possible : ...").
    legend.append(el("p", { class: "small" }, t(`estimate.${this.estimateName}.sub`)));
    if (z < CITY_FADE[1]) legend.append(this.areaScale(this.areaKind(z)));
    else if (z < DETAIL_MIN) {
      legend.append(this.streetScale(z));
      if (z >= (this.meta.participation.proposals_min_zoom ?? 13))
        legend.append(...proposalRows(false));
    } else legend.append(this.streetScale(z), this.levelScale());
    body.append(legend);

    // Who films.
    body.append(el("h4", {}, t("legend.who")));
    const total = OPERATORS.reduce((a, op) => a + (c.byOp[op] ?? 0), 0);
    const fmt = (n: number) => (c.approx ? t("filter.approx", { n }) : t("filter.count", { n }));
    if (z < DETAIL_MIN) {
      for (const pub of [false, true]) {
        const n = pub ? (c.byOp.pub ?? 0) : total;
        const row = toggle(
          "radio",
          pub ? t("filter.public_only") : t("filter.all"),
          fmt(n),
          this.mode.publicOnly === pub,
          () => {
            this.ops = new Set(pub ? ["pub"] : OPERATORS);
            this.apply();
            this.render();
            this.onWho();
          },
        );
        body.append(row);
      }
    } else {
      for (const op of OPERATORS) {
        const n = c.byOp[op] ?? 0;
        if (!n) continue;
        body.append(
          toggle("checkbox", t(`op.${op}`), fmt(n), this.ops.has(op), (on) => {
            if (on) this.ops.add(op);
            else this.ops.delete(op);
            this.apply();
            this.render();
          }),
        );
      }
      // Types, drawn with the map's own pictograms.
      body.append(el("h4", {}, t("legend.type")));
      for (const kind of KINDS) {
        const n = c.byKind[kind] ?? 0;
        if (!n) continue;
        const sample = cameraCanvas(kind);
        sample.className = "sample";
        body.append(
          toggle(
            "checkbox",
            t(`kind.${kind}`),
            fmt(n),
            this.kinds.has(kind),
            (on) => {
              if (on) this.kinds.add(kind);
              else this.kinds.delete(kind);
              this.apply();
              this.render();
            },
            sample,
          ),
        );
      }
    }
    if (c.approx) body.append(el("p", { class: "small" }, t("filter.approx_note")));
    if (this.activeCount) {
      const line =
        z < STREET_FILTER_MIN
          ? t("filter.streets_zoom")
          : t("filter.streets_n", { n: this.streets.count });
      body.append(el("p", { class: "streets-count" }, line));
      if (z < STREET_FILTER_MIN && this.bitGroups().length > 1) {
        body.append(el("p", { class: "small filter-approx" }, t("filter.combined_approx")));
      }
      if (z < STREET_FILTER_MIN && this.adv.operatorQuery.trim()) {
        body.append(el("p", { class: "small" }, t("filter.operator_street_zoom")));
      }
    }
    body.append(this.advancedDrawer(c, z >= DETAIL_MIN));
    if (typing) {
      const input = document.getElementById("adv-operator") as HTMLInputElement | null;
      input?.focus();
      if (input && caret !== null) input.setSelectionRange(caret, caret);
    }
  }

  /** The advanced filters drawer, collapsed by default. */
  private advancedDrawer(c: Counts, street: boolean): HTMLElement {
    const wrap = el("div", { class: "advanced" });
    const drawer = el("details") as HTMLDetailsElement;
    drawer.open = this.adv.open;
    drawer.addEventListener("toggle", () => {
      this.adv.open = drawer.open;
    });
    const n = this.adv.active.size + (this.adv.operatorQuery.trim() ? 1 : 0);
    drawer.append(el("summary", {}, n ? t("adv.title_n", { n }) : t("adv.title")));
    const fmt = (id: string) => (street ? t("filter.count", { n: c.byRow[id] ?? 0 }) : "—");
    for (const group of this.adv.groups) {
      drawer.append(el("h4", {}, t(`adv.group.${group}`)));
      if (group === "who") {
        const row = el("div", { class: "row" });
        const input = el("input", {
          id: "adv-operator",
          type: "search",
          list: "adv-operators",
          placeholder: t("adv.operator_placeholder"),
          "aria-label": t("adv.operator_placeholder"),
        }) as HTMLInputElement;
        input.value = this.adv.operatorQuery;
        input.addEventListener("input", () => {
          this.adv.operatorQuery = input.value;
          this.apply();
        });
        const list = el("datalist", { id: "adv-operators" });
        for (const name of this.meta.operators) list.append(el("option", { value: name }));
        const count = el(
          "span",
          { class: "count" },
          street && this.adv.operatorQuery.trim() ? String(c.byOperator) : street ? "" : "—",
        );
        row.append(input, count);
        drawer.append(row, list);
        continue;
      }
      if (group === "uptodate") drawer.append(el("p", { class: "small" }, t("adv.fresh_note")));
      for (const r of this.adv.rows.filter((x) => x.group === group)) {
        // Capabilities absent from the view are not listed (unless active).
        if (street && group === "can" && !c.byRow[r.id] && !this.adv.active.has(r.id)) continue;
        drawer.append(
          toggle(
            "checkbox",
            r.label,
            fmt(r.id),
            this.adv.active.has(r.id),
            (on) => {
              if (on) this.adv.active.add(r.id);
              else this.adv.active.delete(r.id);
              this.apply();
              this.render();
            },
            undefined,
          ),
        );
      }
    }
    wrap.append(drawer, el("p", { class: "small" }, t("adv.scope")));
    if (!street) wrap.append(el("p", { class: "small" }, t("adv.zoom_in")));
    return wrap;
  }

  /** The estimate bar at the top: one button per shown zone, the chosen one pressed. */
  private renderEstimateBar(): void {
    const bar = this.els.estimate;
    // Rebuilt only when the choice changes: render() runs on every idle, and iOS drops a
    // tap's click when visible content changes between its mousemove and click.
    const key = String(this.est);
    if (bar.dataset.est === key && bar.childElementCount) return;
    // Punk: the pastilles change state in place, so that 17a's spring plays between them.
    if (this.skin && bar.dataset.est && bar.childElementCount) {
      bar.dataset.est = key;
      [...bar.children].forEach((b, n) => {
        b.setAttribute("aria-pressed", String(this.meta.shown_estimates[n] === this.est));
      });
      return;
    }
    bar.dataset.est = key;
    bar.replaceChildren();
    this.meta.shown_estimates.forEach((i) => {
      const name = this.meta.estimates[i];
      const b = el(
        "button",
        {
          "aria-pressed": String(i === this.est),
          title: t(`estimate.${name}.sub`),
        },
        t(`estimate.${name}.short`),
      );
      b.addEventListener("click", () => {
        if (i !== this.est) this.setEstimate(i);
      });
      bar.append(b);
    });
    this.skin?.estimateBar(bar);
  }

  /** What the punk machine draws (machine.ts), from the same counts and state as the
   * current panel. */
  private machineView(z: number, c: Counts): MachineView {
    const street = z >= DETAIL_MIN;
    const pub = c.byOp.pub ?? 0;
    const all = OPERATORS.reduce((a, op) => a + (c.byOp[op] ?? 0), 0);
    const opQuery = this.adv.operatorQuery.trim();
    const notes: MachineView["notes"] = [];
    if (this.activeCount) {
      notes.push({
        cls: "streets-count",
        text:
          z < STREET_FILTER_MIN
            ? t("filter.streets_zoom")
            : t("filter.streets_n", { n: this.streets.count }),
      });
      if (z < STREET_FILTER_MIN && this.bitGroups().length > 1)
        notes.push({ cls: "filter-approx", text: t("filter.combined_approx") });
      if (z < STREET_FILTER_MIN && opQuery)
        notes.push({ cls: "operator-street", text: t("filter.operator_street_zoom") });
    }
    if (c.approx) notes.push({ cls: "approx", text: t("filter.approx_note") });
    if (!street) notes.push({ cls: "zoom-in", text: t("adv.zoom_in") });
    const pct = (v: number) => t("filter.pct", { v });
    let legend: MachineView["legend"];
    if (z < CITY_FADE[1]) {
      const kind = this.areaKind(z);
      const breaks = this.breaks(kind);
      const labels = [
        `< ${pct(breaks[0] ?? 0)}`,
        ...breaks.slice(0, -1).map((b, i) => `${pct(b)} – ${pct(breaks[i + 1])}`),
        `≥ ${pct(breaks[breaks.length - 1] ?? 0)}`,
      ];
      legend = {
        kind: "areas",
        title: t(`legend.${kind}`),
        swatches: labels.map((label, i) => ({ colour: palette().area[i], label })),
      };
    } else
      legend = {
        kind: "streets",
        unfilmed: z >= 14,
        street,
      };
    return {
      street,
      approx: c.approx,
      publicOnly: this.mode.publicOnly,
      ops: OPERATORS.map((op) => ({ op, n: c.byOp[op] ?? 0, on: this.ops.has(op) })),
      pub: { all, pub },
      kinds: KINDS.map((kind) => ({ kind, n: c.byKind[kind] ?? 0, on: this.kinds.has(kind) })),
      states: (["maybe_gone", "pending"] as const).map((id) => ({
        id,
        on: !this.hiddenStates.has(id),
      })),
      adv: this.adv.rows.map((r) => ({
        id: r.id,
        group: r.group,
        label: t(`adv.chip.${r.id}`, { m: this.meta.identify_beyond_m }),
        n: street ? (c.byRow[r.id] ?? 0) : null,
        on: this.adv.active.has(r.id),
      })),
      groups: this.adv.groups,
      operatorQuery: this.adv.operatorQuery,
      operatorCount: street ? (opQuery ? String(c.byOperator) : "") : "—",
      operators: this.meta.operators,
      shown: c.shown,
      total: c.total,
      active: this.activeCount,
      streetActive: this.streetActiveCount,
      hiddenWhole: this.hiddenWhole(z, c),
      advActive: this.adv.active.size + (opQuery ? 1 : 0),
      notes,
      legend,
      estimateName: t(`estimate.${this.estimateName}.short`),
      estimateSub: t(`estimate.${this.estimateName}.sub`),
      ground: basemap().flavor.earth,
    };
  }

  private areaScale(kind: AreaKind): HTMLElement {
    const box = el("div");
    box.append(el("h4", {}, t(`legend.${kind}`)));
    const breaks = this.breaks(kind);
    const pct = (v: number) => t("filter.pct", { v });
    const labels = [
      `< ${pct(breaks[0] ?? 0)}`,
      ...breaks.slice(0, -1).map((b, i) => `${pct(b)} – ${pct(breaks[i + 1])}`),
      `≥ ${pct(breaks[breaks.length - 1] ?? 0)}`,
    ];
    labels.forEach((label, i) => {
      box.append(swatchRow(palette().area[i], label));
    });
    box.append(swatchRow("hatch", t("legend.none")));
    box.append(el("p", { class: "small" }, t("legend.quantiles")));
    return box;
  }

  private streetScale(z: number): HTMLElement {
    const box = el("div");
    // The portions' colours (layers.levelColour), the same at every zoom.
    box.append(el("h4", {}, t("legend.streets")));
    for (const lv of [3, 2, 1])
      box.append(swatchRow(palette().level[lv - 1], t(`legend.street.${lv}`)));
    if (z >= 14) box.append(swatchRow(palette().streetNone, t("legend.unfilmed")));
    else box.append(el("p", { class: "small" }, t("legend.only_filmed")));
    return box;
  }

  private levelScale(): HTMLElement {
    const box = el("div");
    box.append(el("h4", {}, t("legend.levels")));
    const levels: HTMLElement[] = [];
    if (ui() === "punk") {
      // One sample per level with its name, its bands stacked as on the map's ground (on a
      // dark map the most covered band is the brightest: the samples show it).
      const ground = basemap().flavor.earth;
      for (const lv of [3, 2, 1] as const) {
        const row = el("div", { class: "row" });
        // 28 CSS px at the pictograms' ratio (2), as #filters .sample.
        const sample = levelCanvas(lv, 56, ground);
        sample.className = "sample level";
        row.append(sample, el("span", {}, t(`legend.street.${lv}`)));
        levels.push(row);
      }
    } else {
      const row = el("div", { class: "row" });
      const sample = levelCanvas(3);
      sample.className = "sample";
      row.append(sample, el("span", {}, t("legend.levels_line")));
      levels.push(row);
    }
    const hatch = el("div", { class: "row" });
    const hs = areaCanvas(true);
    hs.className = "sample";
    hatch.append(hs, el("span", {}, t("legend.dir_unknown")));
    const gone = el("div", { class: "row" });
    gone.append(el("span", { class: "sw gone" }), el("span", {}, t("legend.maybe_gone")));
    const verified = el("div", { class: "row" });
    const grey = cameraCanvas("dome", palette().gone);
    grey.className = "sample";
    verified.append(grey, el("span", {}, t("legend.gone")));
    box.append(...levels, hatch, gone, verified, ...proposalRows(true));
    box.append(el("p", { class: "small" }, t("legend.norm")));
    return box;
  }
}

function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Proposals (participation): the badge (a dot below the street zoom) and, at street zoom,
 * the pale pictogram of a proposed move. */
export function proposalRows(street: boolean): HTMLElement[] {
  const badge = el("div", { class: "row" });
  badge.append(el("span", { class: "sw proposal" }), el("span", {}, t("legend.proposal")));
  if (!street) return [badge];
  const ghost = el("div", { class: "row" });
  ghost.append(el("span", { class: "sw ghost" }), el("span", {}, t("legend.proposal_move")));
  return [badge, ghost];
}

function swatchRow(colour: string, label: string): HTMLElement {
  const row = el("div", { class: "row" });
  const sw = el("span", { class: colour === "hatch" ? "sw hatch" : "sw" });
  if (colour !== "hatch") sw.style.background = colour;
  row.append(sw, el("span", {}, label));
  return row;
}

function toggle(
  type: "radio" | "checkbox",
  label: string,
  count: string,
  checked: boolean,
  onChange: (on: boolean) => void,
  sample?: HTMLElement,
  group = "who",
): HTMLElement {
  const row = el("label", { class: "row toggle" });
  const input = el("input", { type, name: type === "radio" ? group : "" }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  row.append(input);
  if (sample) row.append(sample);
  row.append(el("span", { class: "label" }, label), el("span", { class: "count" }, count));
  return row;
}
