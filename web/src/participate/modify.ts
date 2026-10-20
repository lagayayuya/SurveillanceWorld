// Adding a camera and « Modifier » (the punk interface): one component (DECISIONS
// 2026-10-08, « Adding and « Modifier » are one component… » and « The add / « Modifier »
// sheet shows each line's choices under it… », mockups 3a on a wide screen and 4a on a
// phone). Its sheet holds the Position ticket, then the lines Forme, Direction, Hauteur,
// Inclinaison (a tube or a small dome) and Exploitant, each with its answer (the summary
// before « Envoyer ») and its choices directly under it, « Je ne sais pas » on every line:
// - Position: the ticket names the nearest street and its commune (place.ts, from the
//   loaded tiles: the basemap's roads, our communes kept loaded by an invisible layer
//   while the component is open), « Position posée » when none; it opens a small map,
//   the camera as a pin at its centre, the map sliding under it; always free (no magnet,
//   no « façade / libre »: « Placing a camera is always free… »), the server's position
//   asked as soon as the pin stops; « Ici » keeps it. An add starts here and, before its
//   sheet, lists the cameras within duplicate_m (« Est-ce l'une de celles-ci ? »).
// « Je ne sais pas » comes first on every line, checked when nothing else is (DECISIONS
// 2026-10-09, « « Je ne sais pas » comes first… »).
// - Forme: 3a's tiles with 16a's stickers (je ne sais pas, petit dôme, tube, grosse boule).
// - Direction: « Je ne sais pas » and « Viser sur la carte › », the one choice that opens
//   the map, the aim a dotted line from the camera to a crosshair. With a mouse (a wide
//   screen) the crosshair follows the pointer until a click poses it, a drag on it moves
//   it; on a phone it is fixed at the free map's centre and the map slides under it, a
//   tap brings the point tapped there (DECISIONS 2026-10-09; WCAG 2.5.7, a drag's
//   single-pointer alternative); the field follows, « Valider » waits for a target
//   direction.min_target_px from the camera on the screen (the author's point 4 of
//   2026-10-12: 5 m refused a target clearly away at z21); the arrows move it from the
//   keyboard. Whatever leaves no field (too close, out of the region, offline, the server
//   failing, busy or slow, a wall in the way) is said under the target and in the paper.
// - Hauteur: ~2 m, ~4 m, 6 m et + (the classes ground, first, upper; the author's point 5
//   of 2026-10-12: no « Poteau », which did not say the height), for every shape but the
//   big ball (rules/questions.yaml height.modify_excludes); Inclinaison on the line under
//   it for a tube or a small dome (tilt.kinds, questions@5), absent otherwise.
// - Exploitant: Public, Commerce ou entreprise, Particulier, then (but after
//   « Particulier ») 20a's search over every listed name (POST /api/operators without
//   `class`), the names around first: a name sets its class; a name not listed is proposed
//   after « Public » or « Commerce ou entreprise » only, checked as the API checks it, sent
//   as `operator_proposed` and shown nowhere before review (the author's point 6 of
//   2026-10-12).
// An add shows every line's choices; « Modifier » only the lines the camera assumes
// (questions.ts editorAssumed: 4a-f4's height) and the ones touched, a tap on another line
// unfolds it.
// « Modifier » on an existing camera: each row says what the camera is today with its
// source, a changed row gets « modifié » and 3a's « Corrigé » stamp; its choices show the
// camera's value pressed when one says it; « Je ne sais pas » sends nothing and never
// overwrites what the camera has; each changed piece is the contribution of its kind sharing the send's
// uuid (`batch`), queued together (IndexedDB, offline, resent, idempotent); the review takes
// one decision for the send. An add: its uuid chosen at the start, its answers name the
// camera it creates, a line left on « Je ne sais pas » sent as such (the absence of
// information, for the statistics); the add and its answers enter the queue in one
// transaction (as « Compléter » sent an add).
// While it is open the cameras, fields and filmed streets around stay, dimmed as in focus
// (slide.ts dimAround; DECISIONS 2026-10-09), the proposals hidden; this camera is its pin,
// with the field the send gives (POST /api/modify/preview) in the map's field tokens,
// lighter, under the streets and their names, once its direction is known (the author's
// point 3 of 2026-10-12: no star around a pin not aimed yet); until then, the pin being
// placed or its direction not chosen, only the field it could have — the outline of the
// preview's « détecte », thin and dotted, over a very light fill, under the streets and
// their names too (the author's point 4 of the return on Temps 1).
import type { GeoJSONSource, LayerSpecification, Map as MlMap } from "maplibre-gl";
import { motion } from "../cannon";
import { debugEvent } from "../debug";
import { t } from "../i18n";
import { cameraCanvas, KINDS, type Kind } from "../icons";
import { isPhone } from "../layout";
import { onTheme, palette } from "../theme";
import type { Nearby } from "./add";
import { ApiError, call, isNetworkError, type Preview } from "./api";
import { bearing, type CompleteTarget, type OperatorClass } from "./complete";
import type { Rules } from "./move";
import { metresBetween, onSite } from "./onsite";
import { communeAt, nearestStreet } from "./place";
import {
  editorAssumed,
  editorParts,
  type Listed,
  listedAs,
  type Operators,
  proposedProblem,
  type Questions,
  searchOperators,
  tidy,
} from "./questions";
import { addedId, type Contribution, type Queue, today } from "./queue";
import { cubicBezier, LAND, Score, type Ticket } from "./score";
import { type Height, type Shape, TILTS, type Tilt } from "./shapes";
import { dimAround, paddingFollower, slideMode } from "./slide";

/** The camera's tile attributes the rows read (the sheet's own facts: sheet.ts chips). */
type Props = Record<string, string | number | undefined>;
/** The sheet's lines; "mount" is the height's (its data-field since « Hauteur et
 * inclinaison »). */
type Field = "shape" | "direction" | "mount" | "tilt" | "operator";
const FIELDS: Field[] = ["shape", "direction", "mount", "tilt", "operator"];
/** What a choice answers. */
type Part = "shape" | "direction" | "height" | "tilt" | "operator";
type View = "position" | "duplicates" | "sheet" | "aim" | "sent";
/** Where the views on the map are: the paper at the bottom, the map above it. */
const ON_MAP: View[] = ["position", "aim"];
type Unknown = "unknown";
type Moved = {
  /** The requested point (the server places it again on receipt). */
  lon: number;
  lat: number;
  /** Where the camera goes: the server's position at rest, else the phone's. */
  at: [number, number];
  m: number;
};
type Changes = {
  move?: Moved;
  shape?: Shape | Unknown;
  direction?: number | "not_visible";
  height?: Height | Unknown;
  tilt?: Tilt | Unknown;
  /** `name`: a listed name (its class the answer); `proposed`: a name not listed. */
  operator?: { answer: OperatorClass | Unknown; name?: string; proposed?: string };
};
const CHANGED: Record<Field, (keyof Changes)[]> = {
  shape: ["shape"],
  direction: ["direction"],
  mount: ["height"],
  tilt: ["tilt"],
  operator: ["operator"],
};
/** The four tiles, 16a's sticker of the kind each answer gives; « Je ne sais pas » first
 * (DECISIONS 2026-10-09, « « Je ne sais pas » comes first… »). */
const TILES: { answer: Shape | Unknown; kind: Kind }[] = [
  { answer: "unknown", kind: "unknown" },
  { answer: "dome", kind: "dome" },
  { answer: "bullet", kind: "fixed" },
  { answer: "ptz", kind: "ptz" },
];
/** A shape answer's camera kind -> the shape it is drawn as (the served kind's row). */
const SHAPE_OF_KIND: Record<string, Shape> = { dome: "dome", fixed: "bullet", ptz: "ptz" };
const OPERATORS: (OperatorClass | Unknown)[] = ["unknown", "public", "business", "household"];
/** The heights offered, in metres on the screen (fr.json modify.height.*); the classique
 * keeps shapes.ts HEIGHTS and its « Poteau », which the API stores as `first`. */
const HEIGHTS: Height[] = ["ground", "first", "upper"];
/** A height class as this editor says it: a tile built before migration 017 may still say
 * `pole`, now `first` (the API's height.legacy). */
const heightClass = (hk: string) => (hk === "pole" ? "first" : hk);
/** The names shown under the search at once. */
const NAMES_MAX = 8;
/** The listed names last received in this session: offline, the search still has them. */
let lastAll: Listed[] = [];
/** The camera's operator in the tiles (`o`, then `ok` for a private one) -> its choice. */
const OPERATOR_OF: Record<string, OperatorClass> = { pub: "public", h: "household", b: "business" };
const MAP_ZOOM = 19;
const SHEET_ZOOM = 18;
const DEBOUNCE_MS = 150;
/** A position less than this from the served one is no move. */
const SAME_M = 0.1;
/** The target posed by default along a known direction, and its keyboard steps (px). */
const TARGET_M = 20;
const KEY_STEP = 8;
/** A tap or a click on the map: a press that moves less than this and ends sooner. */
const TAP_PX = 8;
const TAP_MS = 600;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
/** The room the bearing's tag needs on the target's right (px). */
const TAG_ROOM = 170;
/** Why there is no field, this far under the target's centre (px). */
const WARN_BELOW = 30;
/** A field asked this long ago is said slow (the answer is still drawn when it comes). */
const SLOW_MS = 3000;
/** Why the aim shows no field (fr.json modify.field.*): the region's edge, the network,
 * the server failing or refusing so many previews, the answer slow, nothing to draw (a wall
 * in the way; the camera inside a building). */
type Problem = "outside" | "offline" | "error" | "busy" | "slow" | "blocked" | "inside";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["edit-field", "edit-possible", "edit-line"] as const;
const LEVELS = [1, 2, 3] as const;
/** Each level's outline, as the map draws it (DECISIONS 2026-10-08, « One palette… »):
 * détecte dotted, reconnaît dashed, identifie solid. */
const DASH: Record<1 | 2 | 3, number[] | null> = { 1: [0, 2], 2: [3, 2], 3: null };
/** The field goes where the map draws its own (layers.ts: under the buildings, our streets
 * and every label), so that the streets and their names stay readable over it: before the
 * first of these the style has. */
const UNDER = ["buildings", "streets", "portions"];
/** The field's fill, lighter than the map's; its outline kept as is. [TO ADJUST] */
const FILL_OPACITY = 0.55;
/** The possible field while no direction is chosen: a very light fill of the fields' pink
 * and a thin dotted outline (dots of its width, every 2.5 widths). [TO ADJUST] */
const POSSIBLE_OPACITY = 0.1;
const POSSIBLE_WIDTH = 1.5;
const POSSIBLE_DASH = [0, 2.5];

const known = <T>(v: T | Unknown | undefined): T | undefined => (v === "unknown" ? undefined : v);

export class ModifyMode {
  active = false;
  /** An add (its uuid), or « Modifier » on an existing camera (null). */
  private adding: ReturnType<typeof crypto.randomUUID> | null = null;
  private cam!: CompleteTarget & { label: string };
  private props: Props = {};
  private changes: Changes = {};
  /** « Modifier »: the lines unfolded by a tap or answered (they stay unfolded). */
  private touched = new Set<Field>();
  /** « Modifier »: the « Je ne sais pas » said (shown pressed, sent nothing). */
  private dunno = new Set<Part>();
  private view: View = "sheet";
  /** The add's first position: « Ici » goes on to the duplicates, « Annuler » leaves. */
  private placing = false;
  private panel!: HTMLElement;
  private pin: HTMLElement | null = null;
  private float: HTMLButtonElement | null = null;
  private restore: (() => void)[] = [];
  private slide: (() => void) | null = null;
  private sent = 0;
  /** Who films: the names (null until received, or offline: the session's last). */
  private operators: Operators | null = null;
  private operatorsAsked = false;
  /** Why the list did not come: the network, or the server (said apart). */
  private operatorsFailed: "offline" | "error" | null = null;
  /** What is typed in the operator search. */
  private query = "";
  private timer = 0;
  private inflight: AbortController | null = null;
  /** 8a: the points scored at the send, until put away. */
  private scene: Score | null = null;
  /** The field the send gives, as last drawn (the send turns it on the map). */
  private field: GeoJSON.FeatureCollection = EMPTY;
  /** The possible field: the last preview without a direction, its « détecte » only. */
  private possible: GeoJSON.FeatureCollection = EMPTY;
  private raf = 0;
  /** 8a: the bearing's yellow tag beside the field while it turns. */
  private turnTag: HTMLElement | null = null;
  private unturn: () => void = () => {};
  /** Why the last field asked is not drawn (null: drawn, or nothing to say). */
  private problem: Problem | null = null;
  /** The position view's last answer from the server (null: offline, or not yet). */
  private placed: Preview | null = null;
  private aim: {
    target: HTMLElement;
    tag: HTMLElement;
    /** Why there is no field, under the target (said by the paper's status line too). */
    warn: HTMLElement;
    at: [number, number] | null;
    /** The crosshair follows the mouse until a click poses it. */
    following: boolean;
    /** A phone: the crosshair is the map's centre, the map slides under it. */
    centred: boolean;
    undo: () => void;
  } | null = null;
  private onMove = () => {
    if (this.view === "position") this.positionMoved();
    else this.placePin(this.origin());
    if (this.view !== "aim" || !this.aim) return;
    if (this.aim.centred) this.aimAt(this.centre());
    else {
      this.drawAim();
      this.aimStatus(); // a zoom changes the target's distance on the screen
    }
  };

  constructor(
    private map: MlMap,
    private rules: Rules,
    private q: Questions,
    private ctx: {
      queue: Queue;
      buildId: string;
      est: () => number;
      /** The camera's sheet again (« ← »), or the sheet of a camera said a duplicate. */
      reopen: (id: string) => void;
      onExit: (sent: number) => void;
      /** Cameras within `m` metres of a point, nearest first (the add's duplicates). */
      nearby: (at: [number, number], m: number) => Nearby[];
    },
  ) {}

  /** « Modifier » on a camera of the map. */
  start(cam: CompleteTarget & { label: string }): void {
    this.adding = null;
    this.cam = cam;
    this.props = this.tileProps(cam.id);
    this.begin();
    debugEvent(`modify start ${cam.id}`);
    this.enterSheet();
  }

  /** « Ajouter »: a camera the map does not have, placed first at the map's centre. */
  startAdd(): void {
    const uuid = crypto.randomUUID();
    this.adding = uuid;
    const c = this.map.getCenter();
    this.cam = {
      id: addedId(uuid),
      fid: -1,
      lngLat: [c.lng, c.lat],
      mg: "",
      k: "unknown",
      kc: 0,
      d: -1,
      o: "unk",
      added: true,
      label: "",
    };
    this.props = { k: "unknown", kc: 0, d: -1, o: "unk", hc: 0 };
    this.begin();
    debugEvent("add start");
    this.placing = true;
    this.enterPosition();
  }

  private begin(): void {
    this.changes = {};
    this.touched.clear();
    this.dunno.clear();
    this.operators = null;
    this.operatorsAsked = false;
    this.operatorsFailed = null;
    this.query = "";
    this.sent = 0;
    this.placing = false;
    this.active = true;
    this.possible = EMPTY;
    this.panel = el("section", "");
    this.panel.id = "modify-panel";
    this.panel.setAttribute("aria-labelledby", "modify-title");
    document.body.append(this.panel);
    document.body.classList.add("moving", "modifying");
    this.restore = [dimAround(this.map)];
    this.addLayers();
    this.pin = this.pinElement();
    document.body.append(this.pin);
    this.map.on("move", this.onMove);
    new ResizeObserver(
      // Sent (8a): the scene frames the camera itself; the sheet hidden must not move it.
      paddingFollower(this.map, () =>
        this.active && this.view !== "sent" ? this.padding() : null,
      ),
    ).observe(this.panel);
  }

  /** The camera's attributes in the loaded tiles (the sheet's), else the sheet's target. */
  private tileProps(id: string): Props {
    const f = this.map
      .querySourceFeatures("detail", { sourceLayer: "cameras" })
      .find((c) => String(c.properties.id) === id);
    const cam = this.cam;
    return f
      ? (f.properties as Props)
      : { id, k: cam.k, kc: cam.kc, d: cam.d, o: cam.o, hc: cam.hc, t: cam.t, ok: cam.ok };
  }

  // --- what the camera is, and what the send makes it -----------------------------------

  private kindNow(): string {
    const shape = known(this.changes.shape);
    return shape ? this.q.shape_kinds[shape] : String(this.props.k ?? "unknown");
  }

  private aims(kind = this.kindNow()): boolean {
    return this.q.direction_kinds.includes(kind);
  }

  private heights(kind = this.kindNow()): boolean {
    return editorParts(this.q, kind).height;
  }

  private tilts(kind = this.kindNow()): boolean {
    return editorParts(this.q, kind).tilt;
  }

  private origin(): [number, number] {
    return this.changes.move?.at ?? this.cam.lngLat;
  }

  /** The pieces the send holds: a piece by changed kind (an add: by answer). */
  private count(): number {
    const c = this.changes;
    return (["move", "shape", "direction", "height", "tilt", "operator"] as const).filter(
      (k) => c[k] !== undefined,
    ).length;
  }

  private changed(f: Field): boolean {
    return CHANGED[f].some((k) => this.changes[k] !== undefined);
  }

  /** A shape whose kind takes no direction, no height or no tilt drops them (they would
   * be conflicts in the build: rules/questions.yaml). */
  private setShape(shape: Shape | Unknown | undefined): void {
    if (shape === undefined) delete this.changes.shape;
    else this.changes.shape = shape;
    const drop = (part: "direction" | "height" | "tilt") => {
      delete this.changes[part];
      this.dunno.delete(part);
    };
    if (!this.aims()) drop("direction");
    if (!this.heights()) drop("height");
    if (!this.tilts()) drop("tilt");
  }

  // --- the views --------------------------------------------------------------------------

  /** Leaves what a view put on the map: the target, the sliding. */
  private leaveMapView(): void {
    if (this.aim) {
      this.aim.target.remove();
      this.aim.tag.remove();
      this.aim.warn.remove();
      this.aim.undo();
      this.aim = null;
      this.set("edit-line", EMPTY);
    }
    this.slide?.();
    this.slide = null;
    this.float?.remove();
    this.float = null;
    clearTimeout(this.timer);
  }

  private show(view: View): void {
    this.leaveMapView();
    this.view = view;
    this.panel.dataset.view = view;
    document.body.dataset.editView = view;
    this.panel.replaceChildren();
  }

  /** The sheet; back from the position or the direction's map, the focus on what opened it. */
  private enterSheet(from?: "position" | "aim"): void {
    this.show("sheet");
    this.renderSheet();
    this.map.setPadding(this.padding());
    this.map.jumpTo({ center: this.origin(), zoom: Math.max(this.map.getZoom(), SHEET_ZOOM) });
    this.pinSticker();
    this.placePin(this.origin());
    this.map.once("idle", () => this.namePlace());
    void this.preview();
    const focus = this.panel.querySelector<HTMLElement>(
      from === "position"
        ? "#modify-position"
        : from === "aim"
          ? "#modify-aim-open"
          : "#modify-title",
    );
    focus?.focus();
  }

  private renderSheet(): void {
    const paper = el("div", "modify-paper");
    paper.append(this.head(), this.positionTicket());
    paper.append(el("p", "modify-hint", t(this.adding ? "modify.add.hint" : "modify.hint")));
    const rows = el("div", "modify-rows");
    for (const f of FIELDS) if (f !== "tilt" || this.tilts()) rows.append(this.row(f));
    paper.append(rows);
    const foot = el("div", "modify-foot");
    const n = this.count();
    const send = el(
      "button",
      "part-btn primary",
      this.adding ? t("modify.add.send") : t("modify.send", { n }),
    );
    send.id = "modify-send";
    send.disabled = !this.adding && n === 0;
    send.addEventListener("click", () => void this.send());
    foot.append(send);
    this.panel.append(paper, foot);
  }

  /** The sheet drawn again in place after an answer or a line unfolded: its scroll kept,
   * the focus on `focus` (a selector: the choice just made, or the line's first one). */
  private refresh(focus: string): void {
    if (this.view !== "sheet" || !this.active) return;
    const top = this.panel.querySelector<HTMLElement>(".modify-paper")?.scrollTop ?? 0;
    this.panel.replaceChildren();
    this.renderSheet();
    const paper = this.panel.querySelector<HTMLElement>(".modify-paper");
    if (paper) paper.scrollTop = top;
    this.pinSticker();
    this.panel.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  /** ←, 16a's sticker whole (« Modifier »), the title and the camera's line, ×. */
  private head(): HTMLElement {
    const head = el("div", "modify-head");
    const back = el("button", "modify-back", "←");
    back.setAttribute("aria-label", t(this.adding ? "modify.add.back" : "modify.back"));
    back.addEventListener("click", () => (this.adding ? this.enterPosition() : this.leave(true)));
    const titles = el("div", "modify-titles");
    const h2 = el("h2", "modify-title", t(this.adding ? "modify.add.title" : "modify.title"));
    h2.id = "modify-title";
    h2.tabIndex = -1;
    titles.append(h2);
    if (!this.adding) titles.append(el("p", "modify-sub", this.subtitle()));
    const close = el("button", "modify-close", "×");
    close.setAttribute("aria-label", t(this.adding ? "part.add.abandon" : "modify.close"));
    close.addEventListener("click", () => this.leave(false));
    head.append(back);
    if (!this.adding) head.append(this.sticker("modify-picto"));
    head.append(titles, close);
    return head;
  }

  /** « Dôme public · Préfecture de police » (3a): the sheet's line and the OSM name. */
  private subtitle(): string {
    const name = this.cam.opName;
    return name ? `${this.cam.label} · ${name}` : this.cam.label;
  }

  /** 16a's sticker of the kind the send makes, whole, redrawn with the theme. */
  private sticker(cls: string): HTMLCanvasElement {
    const kind = (KINDS as readonly string[]).includes(this.kindNow())
      ? (this.kindNow() as Kind)
      : "unknown";
    let picto = cameraCanvas(kind);
    picto.className = cls;
    picto.setAttribute("aria-hidden", "true");
    onTheme(
      () => {
        const fresh = cameraCanvas(kind);
        fresh.className = cls;
        fresh.setAttribute("aria-hidden", "true");
        picto.replaceWith(fresh);
        picto = fresh;
      },
      () => picto.isConnected,
    );
    return picto;
  }

  /** 4a's position ticket: the sticker, where the camera is (the street, then « Position
   * posée » or what the send does to it and the commune), « Modifier » (wavy). */
  private positionTicket(): HTMLElement {
    const b = el("button", "modify-position");
    b.dataset.field = "position";
    b.id = "modify-position";
    const text = el("span", "modify-position-text");
    text.append(el("span", "modify-position-title"));
    if (!this.adding && this.changes.move) {
      const tag = el("span", "chip-tag changed");
      tag.append(said(t("chip.punk.source")), t("modify.tag.changed"));
      text.append(tag);
    }
    text.append(el("span", "modify-position-sub"));
    b.append(this.sticker("modify-position-picto"), text);
    b.append(el("span", "modify-position-go", t("modify.position.edit")));
    b.addEventListener("click", () => this.enterPosition());
    this.namePlace(b);
    const wrap = el("div", "modify-row position");
    wrap.append(b);
    if (!this.adding && this.changes.move)
      wrap.append(el("span", "modify-stamp", t("modify.stamp")));
    return wrap;
  }

  /** The position ticket's words: the nearest street as its title, under it the state
   * (« Position posée », « Position actuelle », « Déplacée de 3 m ») and the commune; no
   * street, the state as the title. Drawn again in place once the tiles are in. */
  private namePlace(b = this.panel.querySelector<HTMLElement>("#modify-position")): void {
    if (!b || !this.active) return;
    const at = this.origin();
    const street = nearestStreet(
      this.map.querySourceFeatures("protomaps", { sourceLayer: "roads" }),
      at,
    );
    const commune = communeAt(
      this.map.querySourceFeatures("admin", { sourceLayer: "communes" }),
      at,
    );
    const m = this.changes.move?.m;
    const state = this.adding
      ? t("modify.position.placed")
      : m !== undefined
        ? t("modify.value.moved", { m: Math.round(m * 10) / 10 })
        : t("modify.position.current");
    const title = street ?? state;
    const sub = [street ? state : undefined, commune].filter(Boolean).join(" · ");
    const titleEl = b.querySelector<HTMLElement>(".modify-position-title");
    const subEl = b.querySelector<HTMLElement>(".modify-position-sub");
    if (titleEl) titleEl.textContent = title;
    if (subEl) {
      subEl.textContent = sub;
      subEl.hidden = !sub;
    }
    b.setAttribute(
      "aria-label",
      `${t("modify.field.position")} : ${sub ? `${title}, ${sub}` : title}`,
    );
  }

  /** One line: its label, source tag, leader and value (the summary), its choices under it
   * when unfolded; in « Modifier » a folded line is a button that unfolds it. */
  private row(f: Field): HTMLElement {
    const row = el("div", "modify-row");
    row.dataset.row = f;
    const open = this.unfolded(f);
    const folded = !open && this.opens(f);
    const changed = !this.adding && this.changed(f);
    const { value, tag } = this.current(f);
    const line = el(folded ? "button" : "div", "modify-line");
    line.dataset.field = f;
    const label = el("span", "modify-label", this.label(f));
    label.id = `modify-label-${f}`;
    line.append(label);
    const shownTag = changed ? { cls: "changed", text: t("modify.tag.changed") } : tag;
    if (shownTag && !this.adding) {
      const span = el("span", `chip-tag ${shownTag.cls}`);
      span.append(said(t("chip.punk.source")), shownTag.text);
      line.append(span);
    }
    // A height in metres keeps its lower-case m (the CSS writes values in capitals).
    const metric = f === "mount" && /\d/.test(value);
    line.append(
      el("span", "modify-leader"),
      el("span", `modify-value${metric ? " metric" : ""}`, value),
    );
    if (folded) {
      line.setAttribute("aria-expanded", "false");
      line.addEventListener("click", () => {
        this.touched.add(f);
        this.refresh(`[data-row="${f}"] :is(.modify-tile, .modify-chip)`);
      });
    }
    row.append(line);
    if (changed) row.append(el("span", "modify-stamp", t("modify.stamp")));
    if (open) row.append(this.choices(f));
    return row;
  }

  private label(f: Field): string {
    return t(`modify.field.${f === "mount" ? "height" : f}`);
  }

  /** The line can be answered for the kind the send makes. */
  private opens(f: Field): boolean {
    if (f === "direction") return this.aims();
    if (f === "mount") return this.heights();
    if (f === "tilt") return this.tilts();
    return true;
  }

  /** Its choices show: every line of an add; in « Modifier » the lines whose value the
   * camera only assumes (questions.ts editorAssumed, for the kind the send makes) and the
   * lines touched (unfolded, answered); the tilt with an assumed height. */
  private unfolded(f: Field): boolean {
    if (!this.opens(f)) return false;
    if (this.adding || this.touched.has(f)) return true;
    const p = this.props;
    const assumed = editorAssumed(
      {
        k: this.kindNow(),
        kc: Number(p.kc ?? 0),
        d: Number(p.d ?? -1),
        o: String(p.o ?? "unk"),
        hc: Number(p.hc ?? 0),
      },
      this.q,
    );
    if (f === "tilt") return assumed.includes("mount");
    return assumed.includes(f);
  }

  /** What the camera says today (the sheet's value and source), or what the send makes it;
   * an add: its answers, « — » when not given. */
  private current(f: Field): { value: string; tag: { cls: string; text: string } | null } {
    const p = this.props;
    const c = this.changes;
    const tag = (cls: string) => ({ cls, text: t(`chip.source.${cls}`) });
    const sourced = (month: unknown, cert: number) =>
      month ? tag("answer") : cert === 0 ? tag("assumed") : tag("osm");
    const dunno = { value: t("modify.value.dunno"), tag: null };
    const none = { value: t("modify.value.none"), tag: null };
    switch (f) {
      case "shape": {
        if (c.shape === "unknown") return dunno;
        if (c.shape) return { value: t(`modify.shape.${c.shape}`), tag: null };
        if (this.adding) return dunno;
        const k = String(p.k ?? "unknown");
        const shape = SHAPE_OF_KIND[k];
        const value =
          k === "unknown"
            ? t("modify.value.unknown_f")
            : shape
              ? t(`modify.shape.${shape}`)
              : t(`kind.${k}`);
        return { value, tag: sourced(p.km, Number(p.kc ?? 0)) };
      }
      case "direction": {
        if (c.direction === "not_visible") return dunno;
        if (c.direction !== undefined) return { value: this.bearingText(c.direction), tag: null };
        if (!this.aims())
          return this.kindNow() === "ptz"
            ? { value: t("chip.value.all_directions"), tag: null }
            : none;
        if (this.adding) return dunno;
        const d = Number(p.d ?? -1);
        if (d < 0) return { value: t("chip.value.not_surveyed"), tag: tag("assumed") };
        return { value: this.bearingText(d), tag: sourced(p.dm, Number(p.dc ?? 0)) };
      }
      case "mount":
        return this.heights() ? this.heightNow() : none;
      case "tilt":
        return this.tiltNow();
      default: {
        const op = c.operator;
        if (op?.answer === "unknown") return dunno;
        if (op) {
          const value = op.proposed
            ? t("modify.operator.proposed", { name: op.proposed })
            : (op.name ?? t(`modify.operator.${op.answer}`));
          return { value, tag: null };
        }
        if (this.adding) return dunno;
        const name = this.cam.opName;
        const who = p.ok === "h" ? "household" : p.ok === "b" ? "business" : String(p.o ?? "unk");
        const value = name ?? t(`modify.operator.${who}`);
        return { value, tag: p.om ? tag("answer") : who === "unk" ? null : tag("osm") };
      }
    }
  }

  private heightNow(): { value: string; tag: { cls: string; text: string } | null } {
    const p = this.props;
    const c = this.changes;
    if (c.height === "unknown") return { value: t("modify.value.dunno"), tag: null };
    if (c.height) return { value: t(`modify.height.${c.height}`), tag: null };
    if (this.adding) return { value: t("modify.value.dunno"), tag: null };
    const tag = (cls: string) => ({ cls, text: t(`chip.source.${cls}`) });
    const hc = Number(p.hc ?? 0);
    const src = p.hm ? tag("answer") : hc === 0 ? tag("assumed") : tag("osm");
    if (p.hk) return { value: t(`modify.height.${heightClass(String(p.hk))}`), tag: src };
    const m = Number(p.h);
    const value = Number.isFinite(m)
      ? `${hc === 2 ? "" : "~"}${t("sheet.m", { v: m })}`
      : t("modify.value.unknown_f");
    return { value, tag: src };
  }

  private tiltNow(): { value: string; tag: { cls: string; text: string } | null } {
    const c = this.changes;
    if (c.tilt === "unknown") return { value: t("modify.value.dunno"), tag: null };
    if (c.tilt) return { value: t(`chip.value.tilt.${c.tilt}`), tag: null };
    const p = this.props;
    if (this.adding) return { value: t("modify.value.dunno"), tag: null };
    if (!p.t) return { value: t("modify.value.none"), tag: null };
    const cls = p.tm ? "answer" : "osm";
    return { value: t(`chip.value.tilt.${p.t}`), tag: { cls, text: t(`chip.source.${cls}`) } };
  }

  /** « 300° · nord-ouest » (3a). */
  private bearingText(deg: number): string {
    return t("modify.value.bearing", { deg, dir: t(`modify.compass.${Math.round(deg / 45) % 8}`) });
  }

  // --- the choices under the lines (3a, 4a) ------------------------------------------------

  /** A line's choices, a group named by its label. */
  private choices(f: Field): HTMLElement {
    if (f === "shape") return this.shapeTiles();
    const box = el("div", "modify-choices");
    box.setAttribute("role", "group");
    box.setAttribute("aria-labelledby", `modify-label-${f}`);
    const chips = (part: Part, answers: string[], text: (a: string) => string) => {
      for (const a of answers) {
        const b = el("button", "modify-chip");
        b.dataset.part = part;
        b.dataset.answer = a;
        b.setAttribute("aria-pressed", String(this.pressed(part, a)));
        b.append(el("span", "", a === "unknown" ? t("part.complete.unknown") : text(a)));
        b.addEventListener("click", () => void this.pick(part, a));
        box.append(b);
      }
    };
    if (f === "direction") {
      chips("direction", ["unknown"], () => "");
      // Only the direction opens the map: 3a's dashed « Viser sur la carte › ».
      const aim = el("button", "modify-chip modify-aim-open");
      aim.id = "modify-aim-open";
      aim.innerHTML =
        '<svg class="modify-aim-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="6"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>';
      const chevron = el("span", "", "›");
      chevron.setAttribute("aria-hidden", "true");
      aim.append(el("span", "", t("modify.aim.open")), chevron);
      aim.addEventListener("click", () => this.enterAim());
      box.append(aim);
    } else if (f === "mount") {
      chips("height", ["unknown", ...HEIGHTS], (a) => t(`modify.height.${a}`));
    } else if (f === "tilt") {
      chips("tilt", ["unknown", ...TILTS], (a) => t(`chip.value.tilt.${a}`));
      const hasHeight = known(this.changes.height) !== undefined || Number(this.props.hc ?? 0) > 0;
      if (!hasHeight) box.append(el("p", "modify-note", t("modify.tilt.needs_height")));
    } else {
      chips("operator", OPERATORS, (a) => t(`modify.operator.${a}`));
      // No name after « Particulier »: no private individual's name in the database.
      if (!this.pressed("operator", "household")) box.append(this.operatorSearch());
    }
    return box;
  }

  /** 20a's « Exploitant précis » search under the classes, its names under it. */
  private operatorSearch(): HTMLElement {
    const wrap = el("div", "modify-operator");
    const label = el("label", "modify-search");
    label.append(el("span", "", t("modify.operator.search.label")));
    const input = el("input", "");
    input.type = "search";
    input.id = "modify-operator-search";
    input.placeholder = t("modify.operator.search.placeholder");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = this.query;
    label.append(input);
    const names = el("div", "modify-names");
    names.setAttribute("role", "group");
    names.setAttribute("aria-label", t("modify.operator.search.results"));
    // Typing draws the names again in place (the sheet drawn again would lose the input).
    input.addEventListener("input", () => {
      this.query = input.value;
      this.fillNames(names);
    });
    wrap.append(label, names);
    this.fillNames(names);
    if (!this.operatorsAsked) void this.loadOperators();
    return wrap;
  }

  /** The names found (those around while nothing is typed), then a name not listed: its
   * « Proposer », after « Public » or « Commerce ou entreprise » only, refused here as the
   * API would refuse it; said reviewed before it shows. */
  private fillNames(box: HTMLElement): void {
    box.replaceChildren();
    const op = this.changes.operator;
    const ops = this.operators ?? { near: [], all: lastAll };
    for (const n of searchOperators(ops, this.query, NAMES_MAX)) {
      const b = el("button", "modify-chip name");
      b.dataset.operator = n.name;
      b.dataset.class = n.class;
      b.setAttribute("aria-pressed", String(op?.name === n.name));
      b.append(el("span", "", n.name));
      b.addEventListener("click", () => this.pickName(n));
      box.append(b);
    }
    const note = (key: string, params = {}, cls = "modify-note") =>
      box.append(el("p", cls, t(key, params)));
    const typed = tidy(this.query);
    if (!this.operators && this.operatorsFailed && !lastAll.length)
      note(`modify.operator.search.${this.operatorsFailed}`);
    else if (typed && !box.childElementCount) note("modify.operator.search.none");
    if (typed && !listedAs(ops, typed)) {
      const cls = op?.answer;
      if (cls !== "public" && cls !== "business") note("modify.operator.propose.class");
      else {
        const problem = proposedProblem(typed);
        const b = el("button", "modify-chip name modify-propose");
        b.id = "modify-propose";
        b.disabled = problem !== null;
        b.setAttribute("aria-pressed", String(op?.proposed === typed));
        b.append(el("span", "", t("modify.operator.propose", { name: typed })));
        b.addEventListener("click", () => this.propose(typed));
        box.append(b);
        if (problem) note(`modify.operator.invalid.${problem}`, {}, "modify-note modify-invalid");
      }
    }
    if (op?.proposed || (typed && !listedAs(ops, typed))) note("modify.operator.propose.review");
  }

  /** A listed name: its class with it (a second tap leaves the class only). */
  private pickName(n: Listed): void {
    const again = this.changes.operator?.name === n.name;
    this.touched.add("operator");
    this.dunno.delete("operator");
    this.changes.operator = again ? { answer: n.class } : { answer: n.class, name: n.name };
    this.refresh(`[data-operator="${CSS.escape(n.name)}"]`);
  }

  /** A name not listed, after « Public » or « Commerce ou entreprise » (a second tap takes
   * it back). */
  private propose(name: string): void {
    const op = this.changes.operator;
    if (!op || (op.answer !== "public" && op.answer !== "business") || proposedProblem(name))
      return;
    this.changes.operator =
      op.proposed === name ? { answer: op.answer } : { answer: op.answer, proposed: name };
    this.refresh("#modify-propose");
  }

  /** 3a's tiles with 16a's stickers. */
  private shapeTiles(): HTMLElement {
    const tiles = el("div", "modify-tiles");
    tiles.setAttribute("role", "group");
    tiles.setAttribute("aria-labelledby", "modify-label-shape");
    for (const { answer, kind } of TILES) {
      const b = el("button", "modify-tile");
      b.dataset.answer = answer;
      b.setAttribute("aria-pressed", String(this.pressed("shape", answer)));
      let picto = cameraCanvas(kind);
      picto.setAttribute("aria-hidden", "true");
      onTheme(
        () => {
          const fresh = cameraCanvas(kind);
          fresh.setAttribute("aria-hidden", "true");
          picto.replaceWith(fresh);
          picto = fresh;
        },
        () => picto.isConnected,
      );
      b.append(picto, el("span", "modify-tile-name", t(`modify.shape.${answer}`)));
      b.addEventListener("click", () => void this.pick("shape", answer));
      tiles.append(b);
    }
    return tiles;
  }

  /** A choice shows pressed (DECISIONS 2026-10-09, « « Je ne sais pas » comes first… »):
   * the answer the send holds; else « Je ne sais pas » said (in « Modifier » it changes
   * nothing, yet shows that it was heard); else, in « Modifier », the camera's own value
   * when a choice says it (none pressed when no choice does: a height in metres, a
   * bearing); else « Je ne sais pas », checked when nothing else is. */
  private pressed(part: Part, a: string): boolean {
    const c = this.changes;
    const held =
      part === "direction"
        ? c.direction === undefined
          ? undefined
          : c.direction === "not_visible"
            ? "unknown"
            : null
        : part === "operator"
          ? c.operator?.answer
          : c[part];
    if (held !== undefined) return held === a;
    if (this.dunno.has(part)) return a === "unknown";
    const own = this.adding ? undefined : this.ownChoice(part);
    return own === undefined ? a === "unknown" : own === a;
  }

  /** « Modifier »: the camera's value as the choice that says it; null: a value no choice
   * says; undefined: none (unknown, or only assumed: a default type or height). */
  private ownChoice(part: Part): string | null | undefined {
    const p = this.props;
    switch (part) {
      case "shape": {
        const k = String(p.k ?? "unknown");
        if (k === "unknown" || Number(p.kc ?? 0) === 0) return undefined;
        return SHAPE_OF_KIND[k] ?? null;
      }
      case "direction":
        return Number(p.d ?? -1) >= 0 ? null : undefined;
      case "height": {
        if (Number(p.hc ?? 0) === 0 && !p.hm) return undefined;
        const hk = heightClass(String(p.hk ?? ""));
        return (HEIGHTS as string[]).includes(hk) ? hk : null;
      }
      case "tilt": {
        const tilt = String(p.t ?? "");
        if (!tilt) return undefined;
        return (TILTS as readonly string[]).includes(tilt) ? tilt : null;
      }
      default: {
        const o = String(p.o ?? "unk");
        if (o === "unk") return undefined;
        return OPERATOR_OF[String(p.ok ?? "")] ?? OPERATOR_OF[o] ?? null;
      }
    }
  }

  /** A choice: the answer kept (an add keeps « Je ne sais pas » too, for the statistics;
   * « Modifier » does not send it), the field the send gives drawn again, the line touched. */
  private async pick(part: Part, a: string): Promise<void> {
    const dunno = a === "unknown";
    const field: Field = part === "height" ? "mount" : part;
    this.touched.add(field);
    if (dunno && !this.adding) this.dunno.add(part);
    else this.dunno.delete(part);
    const c = this.changes;
    if (part === "shape") {
      this.setShape(dunno && !this.adding ? undefined : (a as Shape | Unknown));
    } else if (part === "direction") {
      if (this.adding) c.direction = "not_visible";
      else delete c.direction;
    } else if (part === "operator") {
      // A listed name stays with its own class, a proposed one with Public or Commerce.
      const was = c.operator;
      const cls = a as OperatorClass | Unknown;
      if (dunno && !this.adding) delete c.operator;
      else
        c.operator = {
          answer: cls,
          ...(was?.name && was.answer === cls ? { name: was.name } : {}),
          ...(was?.proposed && (cls === "public" || cls === "business")
            ? { proposed: was.proposed }
            : {}),
        };
    } else if (dunno && !this.adding) {
      delete c[part];
    } else if (part === "height") {
      c.height = a as Height | Unknown;
    } else {
      c.tilt = a as Tilt | Unknown;
    }
    const at =
      part === "shape"
        ? `.modify-tile[data-answer="${a}"]`
        : `.modify-chip[data-part="${part}"][data-answer="${a}"]`;
    this.refresh(at);
    if (part !== "operator") void this.preview();
  }

  /** Every listed name and the ones around (POST /api/operators without `class`); offline
   * the session's last list, without the names around. */
  private async loadOperators(): Promise<void> {
    this.operatorsAsked = true;
    this.operatorsFailed = null;
    const at = this.changes.move;
    try {
      const r = await call<Operators>(
        "POST",
        "/api/operators",
        this.adding && at
          ? { lon: at.lon, lat: at.lat, placement: "free" }
          : { camera: this.cam.id },
      );
      // An API before the lot of 2026-10-12 answers `{names}` (or refuses no class).
      if (!Array.isArray(r?.all) || !Array.isArray(r?.near)) throw new Error("operators");
      this.operators = r;
      lastAll = r.all;
    } catch (e) {
      this.operators = null;
      this.operatorsFailed = isNetworkError(e) ? "offline" : "error";
    }
    const box = this.panel.querySelector<HTMLElement>(".modify-names");
    if (this.active && box) this.fillNames(box);
  }

  // --- the map behind -------------------------------------------------------------------

  private padding() {
    const phone = isPhone();
    const onMap = ON_MAP.includes(this.view);
    if (phone && !onMap) return { top: 0, bottom: 0, left: 0, right: 0 };
    const bottom = phone ? this.panel.offsetHeight + 8 : 0;
    const right = phone ? 0 : this.panel.offsetWidth + 30;
    return { top: 8, bottom, left: 0, right };
  }

  /** The field the send gives, by level as the map draws it: each level's outline (dotted,
   * dashed, solid, the fields' line colour) under its fill — the map's halftone pattern
   * when the theme has made it, else the level's ground token, else the field's pink —
   * détecte first, so that each point shows the highest level. */
  private addLayers(): void {
    for (const id of SOURCES)
      if (!this.map.getSource(id)) this.map.addSource(id, { type: "geojson", data: EMPTY });
    const p = palette();
    const below =
      UNDER.find((id) => this.map.getLayer(id)) ??
      this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    const style = getComputedStyle(document.documentElement);
    for (const lv of LEVELS) {
      const dash = DASH[lv];
      this.map.addLayer(
        {
          id: `edit-field-${lv}-line`,
          type: "line",
          source: "edit-field",
          filter: ["==", ["get", "lv"], lv],
          layout: { "line-join": "round", "line-cap": dash?.[0] === 0 ? "round" : "butt" },
          paint: {
            "line-color": p.fieldLine,
            "line-width": 3.2,
            ...(dash ? { "line-dasharray": ["literal", dash] } : {}),
          },
        } as LayerSpecification,
        below,
      );
      const pattern = `punk-field-${lv}`;
      const ground = style.getPropertyValue(`--map-field-${lv}`).trim();
      // fill-opacity applies to a patterned fill too (the style spec: « the opacity of the
      // entire fill layer »).
      const paint = this.map.hasImage(pattern)
        ? { "fill-pattern": pattern, "fill-opacity": FILL_OPACITY }
        : ground
          ? { "fill-color": ground, "fill-opacity": FILL_OPACITY }
          : { "fill-color": p.field, "fill-opacity": 0.1 + 0.04 * lv };
      this.map.addLayer(
        {
          id: `edit-field-${lv}`,
          type: "fill",
          source: "edit-field",
          filter: ["==", ["get", "lv"], lv],
          paint,
        } as LayerSpecification,
        below,
      );
    }
    // The possible field, under the streets and their names like the field.
    this.map.addLayer(
      {
        id: "edit-possible",
        type: "fill",
        source: "edit-possible",
        paint: { "fill-color": p.field, "fill-opacity": POSSIBLE_OPACITY },
      },
      below,
    );
    this.map.addLayer(
      {
        id: "edit-possible-line",
        type: "line",
        source: "edit-possible",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": p.fieldLine,
          "line-width": POSSIBLE_WIDTH,
          "line-dasharray": ["literal", POSSIBLE_DASH],
        },
      } as LayerSpecification,
      below,
    );
    // Invisible: keeps our communes loaded at the editor's zoom (the admin layers stop at
    // COUNT_MAX), for the position ticket's commune.
    if (this.map.getSource("admin"))
      this.map.addLayer({
        id: "edit-communes",
        type: "fill",
        source: "admin",
        "source-layer": "communes",
        paint: { "fill-opacity": 0 },
      });
    // The aim: 4a's dotted line in the ink, from the camera to the target.
    this.map.addLayer({
      id: "edit-line",
      type: "line",
      source: "edit-line",
      layout: { "line-cap": "round" },
      paint: { "line-color": p.ink, "line-width": 2.5, "line-dasharray": [1.6, 1.6] },
    });
  }

  private layerIds(): string[] {
    return [
      ...LEVELS.flatMap((lv) => [`edit-field-${lv}-line`, `edit-field-${lv}`]),
      "edit-possible",
      "edit-possible-line",
      "edit-line",
      "edit-communes",
    ];
  }

  private set(id: (typeof SOURCES)[number], data: GeoJSON.FeatureCollection): void {
    (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  }

  /** The body /api/modify/preview reads: the add or the camera, where the send puts it
   * (`at`: the pin, in the position view), its answers (`direction`: the one being aimed). */
  private previewBody(at?: [number, number], direction?: number) {
    const c = this.changes;
    const where = at ?? (c.move ? ([c.move.lon, c.move.lat] as [number, number]) : null);
    const answers = {
      shape: known(c.shape),
      direction: direction ?? (typeof c.direction === "number" ? c.direction : undefined),
      height: known(c.height),
      tilt: known(c.tilt),
    };
    if (this.adding) {
      const [lon, lat] = where ?? this.cam.lngLat;
      return { add: true, lon, lat, ...answers };
    }
    return {
      camera: this.cam.id,
      ...(where ? { lon: where[0], lat: where[1], placement: "free" } : {}),
      ...answers,
    };
  }

  /** Whether the field is drawn: its direction known (`aiming`: the one being aimed; else
   * the one chosen, or in « Modifier » the camera's own while nothing replaces it), or none
   * asked of its kind (a big ball's ring). Unknown direction, no star around a pin being
   * placed or a camera not aimed yet (DECISIONS 2026-10-08): the possible field instead,
   * dotted and light (the author's point 4 of the return on Temps 1). */
  private aimed(aiming?: number): boolean {
    if (aiming !== undefined || !this.aims()) return true;
    const c = this.changes.direction;
    if (c !== undefined) return c !== "not_visible";
    return !this.adding && Number(this.props.d ?? -1) >= 0;
  }

  /** The field the send gives, as the build would draw it once validated. */
  private async preview(at?: [number, number], direction?: number): Promise<Preview | null> {
    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    const slow = window.setTimeout(() => this.said("slow"), SLOW_MS);
    try {
      const r = await call<Preview>(
        "POST",
        "/api/modify/preview",
        this.previewBody(at, direction),
        ctrl.signal,
      );
      if (ctrl.signal.aborted || !this.active) return null;
      const est = this.ctx.est();
      this.field = {
        type: "FeatureCollection",
        features: r.bands.features.filter((f) => f.properties?.b === est),
      };
      const shown = this.aimed(direction);
      this.set("edit-field", shown ? this.field : EMPTY);
      if (!shown)
        this.possible = {
          type: "FeatureCollection",
          features: this.field.features.filter((f) => f.properties?.lv === 1),
        };
      this.set("edit-possible", shown ? EMPTY : this.possible);
      // Aimed, and nothing to draw: a wall in the way, or the camera inside a building.
      const none = shown && !this.field.features.length;
      this.said(none ? (r.inside_footprint ? "inside" : "blocked") : null);
      return r;
    } catch (e) {
      if (ctrl.signal.aborted || !this.active) return null;
      this.set("edit-field", EMPTY);
      this.set("edit-possible", EMPTY);
      const code = e instanceof ApiError ? e.code : "";
      if (code === "too_far") {
        this.problem = null;
        this.status(t("part.move.too_far", { max: this.rules.move_max_m }));
      } else
        this.said(
          code === "outside_region"
            ? "outside"
            : e instanceof ApiError && e.status === 429
              ? "busy"
              : isNetworkError(e)
                ? "offline"
                : "error",
        );
      return null;
    } finally {
      clearTimeout(slow);
    }
  }

  /** Why no field is drawn, said in the view's status line (and beside the target when
   * aiming); null: nothing to say. */
  private said(problem: Problem | null): void {
    this.problem = problem;
    this.status(problem ? t(`modify.field.${problem}`) : undefined);
  }

  /** The camera as a pin (4a): 16a's sticker whole above a stem, its tip the position. */
  private pinElement(): HTMLElement {
    const box = el("div", "");
    box.id = "edit-pin";
    box.setAttribute("aria-hidden", "true");
    box.append(el("span", "edit-pin-stem"), el("span", "edit-pin-tip"));
    this.pinSticker(box);
    return box;
  }

  private pinSticker(box = this.pin): void {
    if (!box) return;
    box.querySelector(".edit-pin-picto")?.remove();
    box.append(this.sticker("edit-pin-picto"));
  }

  private placePin(at: [number, number]): void {
    if (!this.pin) return;
    const box = this.map.getContainer().getBoundingClientRect();
    const p = this.map.project(at);
    this.pin.style.transform = `translate(${box.left + p.x}px, ${box.top + p.y}px)`;
    this.pin.dataset.lng = String(at[0]);
    this.pin.dataset.lat = String(at[1]);
  }

  /** A status line of the views on the map (said; shown only when it has something). */
  private status(text?: string): void {
    const line = this.panel.querySelector<HTMLElement>("#modify-status");
    if (line) {
      line.textContent = text ?? "";
      line.hidden = !text;
    }
    if (this.view === "position") this.positionReady();
    if (this.view === "aim") this.aimStatus();
  }

  /** × (an add's first position: it leaves) or ← (back to the sheet): in the paper's head
   * on a wide screen (3a), over the map's top left on a phone (4a; the CSS shows one). */
  private leaveButton(close: boolean, act: () => void, cls: string): HTMLButtonElement {
    const b = el("button", cls, close ? "×" : "←");
    b.setAttribute("aria-label", t(close ? "part.add.abandon" : "modify.map.back"));
    b.addEventListener("click", act);
    return b;
  }

  /** A view on the map: its paper at the bottom (a title, a tag, a sentence, a status, two
   * buttons), the way out. */
  private mapPaper(
    title: string,
    hint: string,
    buttons: [HTMLButtonElement, HTMLButtonElement],
    out: { close: boolean; act: () => void },
  ): HTMLElement {
    const paper = el("div", "modify-paper");
    const head = el("div", "modify-aim-head");
    const h2 = el("h2", "modify-title", title);
    h2.id = "modify-title";
    h2.tabIndex = -1;
    const tag = el("span", "modify-bearing");
    tag.setAttribute("aria-hidden", "true");
    tag.hidden = true;
    const inPaper = this.leaveButton(
      out.close,
      out.act,
      out.close ? "modify-close" : "modify-back",
    );
    if (out.close) head.append(h2, tag, inPaper);
    else head.append(inPaper, h2, tag);
    this.float = this.leaveButton(out.close, out.act, "edit-float");
    this.float.id = "edit-float";
    document.body.append(this.float);
    const status = el("p", "part-status");
    status.id = "modify-status";
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    const row = el("div", "modify-actions");
    row.append(...buttons);
    paper.append(head, el("p", "modify-hint", hint), status, row);
    this.panel.append(paper);
    return paper;
  }

  // --- the position (4a step 1) -----------------------------------------------------------

  private enterPosition(): void {
    this.show("position");
    const first = this.placing;
    const cancel = el("button", "part-btn quiet", t("part.cancel"));
    cancel.id = "modify-position-cancel";
    cancel.addEventListener("click", () => (first ? this.exit() : this.enterSheet("position")));
    const ok = el("button", "part-btn primary", t("modify.position.here"));
    ok.id = "modify-here";
    ok.addEventListener("click", () => this.here());
    this.mapPaper(
      t(first ? "modify.add.title" : "modify.field.position"),
      t("modify.position.hint"),
      [cancel, ok],
      { close: first, act: () => (first ? this.exit() : this.enterSheet("position")) },
    );
    this.slide = slideMode(this.map);
    this.placed = null;
    this.map.setPadding(this.padding());
    const at = this.changes.move ? [this.changes.move.lon, this.changes.move.lat] : this.cam.lngLat;
    this.map.jumpTo({
      center: at as [number, number],
      zoom: Math.max(this.map.getZoom(), MAP_ZOOM),
    });
    this.positionMoved();
    this.panel.querySelector<HTMLElement>("#modify-title")?.focus();
  }

  private centre(): [number, number] {
    const c = this.map.getCenter();
    return [c.lng, c.lat];
  }

  /** The pin follows the map; once it stops, the server places it and draws the field. */
  private positionMoved(): void {
    // An answer still on its way is about a point the pin has left: drawn, it would put
    // the pin back there while the finger rests (smoke test, Chromium).
    this.inflight?.abort();
    this.placed = null;
    this.placePin(this.centre());
    this.positionReady();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(async () => {
      const r = await this.preview(this.centre());
      if (!r || this.view !== "position") return;
      this.placed = r;
      if (r.position) this.placePin(r.position);
    }, DEBOUNCE_MS);
  }

  /** « Ici » waits only for a move too far (the move's rule, rules/participation.yaml). */
  private positionReady(): void {
    const ok = this.panel.querySelector<HTMLButtonElement>("#modify-here");
    const line = this.panel.querySelector<HTMLElement>("#modify-status");
    if (!ok || !line) return;
    const far =
      !this.adding && metresBetween(this.cam.lngLat, this.centre()) > this.rules.move_max_m;
    // Out of the region the server refuses the add or the move: « Ici » waits.
    ok.disabled = far || this.problem === "outside";
    if (far) {
      line.textContent = t("part.move.too_far", { max: this.rules.move_max_m });
      line.hidden = false;
    } else if (line.dataset.far) {
      line.textContent = "";
      line.hidden = true;
    }
    line.dataset.far = far ? "1" : "";
  }

  private here(): void {
    const [lon, lat] = this.centre();
    const at = this.placed?.position ?? ([lon, lat] as [number, number]);
    const m = metresBetween(this.cam.lngLat, at);
    if (!this.adding && m > this.rules.move_max_m) return;
    if (!this.adding && m < SAME_M) delete this.changes.move;
    else this.changes.move = { lon, lat, at, m };
    if (this.adding) {
      this.cam.lngLat = at;
      // The names around the new position.
      this.operators = null;
      this.operatorsAsked = false;
      this.operatorsFailed = null;
    }
    debugEvent(`position ${at[0].toFixed(7)},${at[1].toFixed(7)}`);
    if (!this.placing) {
      this.enterSheet("position");
      return;
    }
    this.placing = false;
    const near = this.ctx.nearby(at, this.rules.add?.duplicate_m ?? 5);
    if (near.length) this.enterDuplicates(near);
    else this.enterSheet();
  }

  /** « Est-ce l'une de celles-ci ? »: one tap opens its sheet and sends nothing. */
  private enterDuplicates(near: Nearby[]): void {
    this.show("duplicates");
    const paper = el("div", "modify-paper");
    const head = el("div", "modify-qhead");
    const back = el("button", "modify-return", t("part.add.duplicates.back"));
    back.addEventListener("click", () => {
      this.placing = true;
      this.enterPosition();
    });
    const h2 = el("h2", "modify-title", t("part.add.duplicates.title"));
    h2.id = "modify-title";
    h2.tabIndex = -1;
    head.append(back, h2);
    const list = el("div", "modify-duplicates");
    for (const c of near) {
      const b = el("button", "modify-duplicate");
      b.dataset.camera = c.id;
      const kind = ((KINDS as readonly string[]).includes(c.k) ? c.k : "unknown") as Kind;
      const picto = cameraCanvas(kind);
      picto.setAttribute("aria-hidden", "true");
      const text = el("span", "modify-duplicate-text");
      text.append(
        el("span", "", c.label),
        el("span", "modify-sub", t("part.add.duplicates.at", { m: Math.max(1, Math.round(c.m)) })),
      );
      b.append(picto, text);
      b.addEventListener("click", () => {
        this.exit();
        this.ctx.reopen(c.id);
      });
      list.append(b);
    }
    const other = el("button", "part-btn primary", t("part.add.duplicates.other"));
    other.id = "add-other";
    other.addEventListener("click", () => this.enterSheet());
    paper.append(head, list);
    const foot = el("div", "modify-foot");
    foot.append(other);
    this.panel.append(paper, foot);
    this.map.setPadding(this.padding());
    h2.focus();
  }

  // --- the direction (3a, 4a step 3) -----------------------------------------------------

  private enterAim(): void {
    this.show("aim");
    const notVisible = el("button", "part-btn quiet", t("part.complete.direction.not_visible"));
    notVisible.id = "modify-not-visible";
    notVisible.addEventListener("click", () => {
      if (this.adding) this.changes.direction = "not_visible";
      else {
        delete this.changes.direction;
        this.dunno.add("direction");
      }
      this.touched.add("direction");
      this.enterSheet("aim");
    });
    const ok = el("button", "part-btn primary", t("part.complete.direction.submit"));
    ok.id = "aim-submit";
    ok.addEventListener("click", () => {
      const deg = this.aimBearing();
      if (deg === null || !this.aimPosed()) return;
      this.changes.direction = deg;
      this.dunno.delete("direction");
      this.touched.add("direction");
      this.enterSheet("aim");
    });
    const centred = isPhone();
    const paper = this.mapPaper(
      t("modify.field.direction"),
      t(centred ? "modify.aim.hint_slide" : "modify.aim.hint"),
      [notVisible, ok],
      { close: false, act: () => this.enterSheet("aim") },
    );
    if (this.kindNow() === "dome")
      paper.append(el("p", "modify-note", t("part.complete.direction.dome")));
    const target = el("button", "");
    target.id = "edit-target";
    target.type = "button";
    target.setAttribute("aria-label", t("modify.aim.target"));
    target.innerHTML =
      '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="13"/><path d="M24 3v18M24 27v18M3 24h18M27 24h18"/></svg>';
    const tag = el("div", "");
    tag.id = "edit-tag";
    tag.setAttribute("aria-hidden", "true");
    if (centred) target.dataset.centred = "true";
    const warn = el("div", "");
    warn.id = "edit-warn";
    warn.setAttribute("aria-hidden", "true");
    warn.hidden = true;
    document.body.append(target, tag, warn);
    this.problem = null;
    this.aim = {
      target,
      tag,
      warn,
      at: null,
      following: !centred,
      centred,
      undo: () => undefined,
    };
    this.aim.undo = this.aimInput(target);
    if (centred) this.slide = slideMode(this.map);
    this.map.setPadding(this.padding());
    // A direction already said (changed, or the camera's): the target along it; a phone
    // centres the map there, else on the camera (« Visez plus loin… » until it slides).
    const c = this.changes.direction;
    const d = typeof c === "number" ? c : this.adding ? -1 : Number(this.props.d ?? -1);
    const ahead = d >= 0 ? along(this.origin(), d, TARGET_M) : null;
    const zoom = Math.max(this.map.getZoom(), MAP_ZOOM);
    this.map.jumpTo({ center: centred ? (ahead ?? this.origin()) : this.origin(), zoom });
    if (centred) this.aim.at = this.centre();
    else if (ahead) {
      this.aim.at = ahead;
      this.aim.following = false;
    }
    this.placePin(this.origin());
    this.drawAim();
    this.aimChanged();
    this.panel.querySelector<HTMLElement>("#modify-title")?.focus();
  }

  /** The pointer (a mouse: the crosshair follows it until a click poses it), the finger (a
   * tap poses it, a drag on the target moves it), the arrows (on the focused target).
   * Returns what removes the listeners. */
  private aimInput(target: HTMLElement): () => void {
    const map = this.map;
    const point = (x: number, y: number): [number, number] => {
      const box = map.getContainer().getBoundingClientRect();
      const ll = map.unproject([x - box.left, y - box.top]);
      return [ll.lng, ll.lat];
    };
    const pose = (at: [number, number]) => this.aimAt(at);
    if (this.aim?.centred) return this.centredInput(target, point);
    // Pointer events on the map's canvas, not MapLibre's mouse events: a tap's synthesized
    // mouse events would make the crosshair follow, and MapLibre fires no click for a tap
    // it handles (seen in WebKit). A press that barely moves and soon ends poses it; a
    // drag pans the map.
    const canvas = map.getCanvasContainer();
    let press: { id: number; x: number; y: number; t: number } | null = null;
    const hover = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons || !this.aim?.following) return;
      pose(point(e.clientX, e.clientY));
    };
    const pressed = (e: PointerEvent) => {
      if (e.isPrimary) press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    };
    const released = (e: PointerEvent) => {
      const p = press;
      press = null;
      if (!p || p.id !== e.pointerId || !this.aim) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_PX || e.timeStamp - p.t > TAP_MS)
        return;
      this.aim.following = false;
      pose(point(e.clientX, e.clientY));
    };
    let dragging = -1;
    // On the target (a following crosshair is under the mouse): a press poses it there, a
    // drag moves it.
    const down = (e: PointerEvent) => {
      dragging = e.pointerId;
      target.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (!this.aim) return;
      this.aim.following = false;
      pose(point(e.clientX, e.clientY));
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== dragging || !this.aim) return;
      this.aim.following = false;
      pose(point(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === dragging) dragging = -1;
    };
    const key = (e: KeyboardEvent) => {
      const s = ARROWS[e.key];
      if (!s || !this.aim) return;
      e.preventDefault();
      const n = e.shiftKey ? KEY_STEP * 5 : KEY_STEP;
      const from = map.project(this.aim.at ?? this.centre());
      const ll = map.unproject([from.x + s[0] * n, from.y + s[1] * n]);
      this.aim.following = false;
      pose([ll.lng, ll.lat]);
    };
    canvas.addEventListener("pointermove", hover);
    canvas.addEventListener("pointerdown", pressed);
    canvas.addEventListener("pointerup", released);
    target.addEventListener("pointerdown", down);
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    target.addEventListener("keydown", key);
    return () => {
      canvas.removeEventListener("pointermove", hover);
      canvas.removeEventListener("pointerdown", pressed);
      canvas.removeEventListener("pointerup", released);
    };
  }

  /** A phone: the map slides under the fixed crosshair (MapLibre's own pan and pinch); a
   * tap brings the point tapped under it, the arrows on the focused crosshair move the map
   * by a step. Returns what removes the listeners. */
  private centredInput(
    target: HTMLElement,
    point: (x: number, y: number) => [number, number],
  ): () => void {
    const map = this.map;
    const canvas = map.getCanvasContainer();
    let press: { id: number; x: number; y: number; t: number } | null = null;
    const pressed = (e: PointerEvent) => {
      if (e.isPrimary) press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    };
    const released = (e: PointerEvent) => {
      const p = press;
      press = null;
      if (!p || p.id !== e.pointerId || !this.aim) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_PX || e.timeStamp - p.t > TAP_MS)
        return;
      // A jump: MapLibre stops a camera animation on the touch events that follow the
      // pointerup (HandlerManager handleEvent, camera.stop(true) while a handler is active).
      map.jumpTo({ center: point(e.clientX, e.clientY) });
    };
    const key = (e: KeyboardEvent) => {
      const s = ARROWS[e.key];
      if (!s) return;
      e.preventDefault();
      const n = e.shiftKey ? KEY_STEP * 5 : KEY_STEP;
      map.panBy([s[0] * n, s[1] * n], { duration: 0 });
    };
    canvas.addEventListener("pointerdown", pressed);
    canvas.addEventListener("pointerup", released);
    target.addEventListener("keydown", key);
    return () => {
      canvas.removeEventListener("pointerdown", pressed);
      canvas.removeEventListener("pointerup", released);
    };
  }

  /** The target is `at`: drawn, said, the field aimed that way once it stops. */
  private aimAt(at: [number, number]): void {
    if (!this.aim) return;
    const was = this.aim.at;
    this.aim.at = at;
    this.drawAim();
    // The same point: the map padded again under the fixed target (a status line shown
    // changes the paper's height), the field asked stands; asked again, a slow answer
    // would never come.
    if (was && was[0] === at[0] && was[1] === at[1]) this.aimStatus();
    else this.aimChanged();
  }

  /** The bearing from the camera to the target; null before it is anywhere, or too close
   * (a finger's error would swing it). */
  private aimBearing(): number | null {
    const at = this.aim?.at;
    if (!at || this.tooClose(at)) return null;
    return bearing(this.origin(), at);
  }

  /** Closer to the camera than direction.min_target_px on the screen, whatever the zoom
   * (only the bearing matters); a build before it: min_target_m. */
  private tooClose(at: [number, number]): boolean {
    const px = this.q.min_target_px;
    if (px === undefined) return metresBetween(this.origin(), at) < this.q.min_target_m;
    const a = this.map.project(this.origin());
    const b = this.map.project(at);
    return Math.hypot(a.x - b.x, a.y - b.y) < px;
  }

  /** « Valider »: a target posed (a click, a tap, a drag, the arrows; on a phone wherever
   * the map rests), not one following the mouse on its way to the button, and far enough
   * from the camera. */
  private aimPosed(): boolean {
    return this.aim !== null && !this.aim.following && this.aimBearing() !== null;
  }

  /** The crosshair (the map's centre until posed), the dotted aim, the yellow tag. */
  private drawAim(): void {
    const a = this.aim;
    if (!a) return;
    const box = this.map.getContainer().getBoundingClientRect();
    const at = a.at ?? this.centre();
    const p = this.map.project(at);
    const xy = `translate(${box.left + p.x}px, ${box.top + p.y}px)`;
    a.target.style.transform = xy;
    a.target.dataset.posed = String(a.at !== null);
    // The tag beside the target, on its left near the screen's right edge (4a draws it
    // on the right).
    const left = box.left + p.x > window.innerWidth - TAG_ROOM;
    a.tag.dataset.side = left ? "left" : "right";
    a.tag.style.transform = left ? `${xy} translateX(-100%)` : xy;
    this.set(
      "edit-line",
      a.at
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: [this.origin(), a.at] },
                properties: {},
              },
            ],
          }
        : EMPTY,
    );
  }

  /** Why there is no field, centred under the target, kept on the screen. */
  private placeWarn(): void {
    const a = this.aim;
    if (!a || a.warn.hidden) return;
    const box = this.map.getContainer().getBoundingClientRect();
    const p = this.map.project(a.at ?? this.centre());
    const w = a.warn.offsetWidth;
    const x = Math.min(Math.max(box.left + p.x - w / 2, 8), window.innerWidth - w - 8);
    a.warn.style.transform = `translate(${x}px, ${box.top + p.y + WARN_BELOW}px)`;
  }

  /** The target moved: the tags, the status, the field aimed that way once it stops. */
  private aimChanged(): void {
    this.inflight?.abort(); // the field for a target left behind, and what it said
    this.problem = null;
    this.aimStatus();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const deg = this.aimBearing();
      if (deg !== null) void this.preview(undefined, deg);
      else {
        // No target yet, or too close: the possible field while no direction is chosen.
        this.set("edit-field", EMPTY);
        this.set("edit-possible", this.aimed() ? EMPTY : this.possible);
      }
    }, DEBOUNCE_MS);
  }

  private aimStatus(): void {
    if (this.view !== "aim" || !this.aim) return;
    const ok = this.panel.querySelector<HTMLButtonElement>("#aim-submit");
    const tag = this.panel.querySelector<HTMLElement>(".modify-bearing");
    const line = this.panel.querySelector<HTMLElement>("#modify-status");
    if (!ok || !tag || !line) return;
    const deg = this.aimBearing();
    const text = deg === null ? "" : this.bearingText(deg);
    tag.textContent = text;
    tag.hidden = deg === null;
    this.aim.tag.textContent = text;
    this.aim.tag.hidden = deg === null;
    ok.disabled = !this.aimPosed();
    // Why there is no field, under the target and in the paper: too close (« Valider »
    // waits), else what the last answer said (« Valider » does not: only the bearing counts).
    const why = deg === null ? (this.aim.at ? "closer" : "") : (this.problem ?? "");
    const whyText = !why
      ? ""
      : why === "closer"
        ? t("modify.aim.closer")
        : t(`modify.field.${why}`);
    // Said: the bearing (shown on the tag), and why.
    const bearingSaid =
      deg === null
        ? ""
        : t("part.complete.direction.bearing", {
            deg,
            dir: t(`compass.${Math.round(deg / 45) % 8}`),
          });
    const said = [bearingSaid, whyText].filter(Boolean).join(". ");
    line.textContent = said;
    line.hidden = !said;
    line.classList.toggle("modify-sr", !whyText);
    this.aim.warn.textContent = whyText;
    this.aim.warn.hidden = !whyText;
    this.aim.warn.dataset.why = why;
    this.placeWarn();
    this.aim.target.setAttribute(
      "aria-label",
      deg === null ? t("modify.aim.target") : `${t("modify.aim.target")} ${text}`,
    );
    this.panel.dataset.bearing = deg === null ? "" : String(deg);
  }

  // --- the send ---------------------------------------------------------------------------

  /** « Modifier »: every changed piece, the contribution of its kind, sharing the send's
   * uuid. An add: the add, then its answers on the camera it creates. One IndexedDB
   * transaction either way. */
  private async send(): Promise<void> {
    if (!this.adding && !this.count()) return;
    for (const b of this.panel.querySelectorAll("button")) b.disabled = true;
    // An add sends what was answered; a line left on its preselected « Je ne sais pas »
    // sends nothing, as an untouched line did before (a tap on it sends « je ne sais pas »).
    const c = this.changes;
    const at = this.origin();
    const base = {
      camera: this.cam.id,
      build_id: this.ctx.buildId,
      day: today(),
      on_site: await onSite(at, this.rules),
      ...(this.adding ? {} : { batch: crypto.randomUUID() }),
    };
    const shape = known(c.shape);
    const aimKind = shape ? { aim_kind: this.q.shape_kinds[shape] } : {};
    const deg = typeof c.direction === "number" ? c.direction : undefined;
    const aimDirection = deg !== undefined ? { aim_direction: deg } : {};
    const height = known(c.height);
    const pieces: Partial<Contribution>[] = [];
    if (c.move && !this.adding)
      pieces.push({ kind: "move", lon: c.move.lon, lat: c.move.lat, placement: "free" });
    if (c.shape) pieces.push({ kind: "shape", answer: c.shape });
    if (c.direction === "not_visible") pieces.push({ kind: "direction", answer: "not_visible" });
    else if (deg !== undefined)
      pieces.push({
        kind: "direction",
        direction: deg,
        ...aimKind,
        ...(c.move && !this.adding ? { from_lon: c.move.at[0], from_lat: c.move.at[1] } : {}),
      });
    if (c.height) pieces.push({ kind: "height", answer: c.height, ...aimKind, ...aimDirection });
    if (c.tilt)
      pieces.push({
        kind: "tilt",
        answer: c.tilt,
        ...aimKind,
        ...aimDirection,
        ...(height ? { aim_height: height } : {}),
      });
    if (c.operator)
      pieces.push({
        kind: "operator",
        answer: c.operator.answer,
        ...(c.operator.name
          ? { operator_name: c.operator.name }
          : c.operator.proposed
            ? { operator_proposed: c.operator.proposed }
            : {}),
      });
    const items = pieces.map((body) => ({
      uuid: crypto.randomUUID(),
      body: { ...base, ...body } as Contribution,
    }));
    if (this.adding && c.move) {
      const { camera: _, ...rest } = base;
      items.unshift({
        uuid: this.adding,
        body: {
          ...rest,
          kind: "add",
          lon: c.move.lon,
          lat: c.move.lat,
          placement: "free",
        } as Contribution,
      });
    }
    await this.ctx.queue.addAll(items);
    this.sent = items.length;
    debugEvent(`${this.adding ? "add" : "modify"} sent ${items.map((i) => i.body.kind).join(",")}`);
    this.scored(items);
  }

  /** 8a: the sheet slides down out of the way (400 ms, at once under reduced motion), the
   * field turns on the map from the camera's direction to the one sent, and a ticket per
   * piece sent falls with the points the server gives (score.ts). It stays until a touch
   * or a move on the map, or Escape: then the editor closes as « Terminer » did (the
   * old « done » view and its thanks paper are gone). */
  private scored(items: { uuid: string; body: Contribution }[]): void {
    this.leaveMapView();
    this.set("edit-possible", EMPTY);
    this.view = "sent";
    this.panel.dataset.view = "sent";
    document.body.dataset.editView = "sent";
    this.panel.inert = true;
    this.panel.classList.add("sent");
    // Hidden once slid away, unless the scene was put away and another edit opened the
    // panel meanwhile (it is then no longer « sent »).
    const panel = this.panel;
    window.setTimeout(
      () => {
        if (this.active && panel.dataset.view === "sent") panel.hidden = true;
      },
      motion() ? LAND : 0,
    );
    // The camera and its field in view once the sheet is gone (8a: above the tickets on a
    // phone, 40 % down; on a wide screen beside their column).
    this.map.easeTo({
      center: this.origin(),
      zoom: SHEET_ZOOM,
      padding: isPhone()
        ? { top: 0, bottom: Math.round(window.innerHeight * 0.2), left: 0, right: 0 }
        : { top: 0, bottom: 0, left: 380, right: 0 },
      duration: motion() ? LAND : 0,
    });
    const offline = !navigator.onLine;
    const n = this.adding ? this.sent - 1 : this.sent;
    const key = this.adding ? "modify.add.done" : "modify.done";
    const c = this.changes;
    const from = Number(this.props.d ?? -1);
    if (!this.adding && typeof c.direction === "number" && from >= 0) this.turn(from, c.direction);
    this.scene = new Score({
      tickets: items.map((i) => this.ticket(i.uuid, i.body)),
      queue: this.ctx.queue,
      offline,
      thanks: t(offline ? `${key}_offline` : key, { n }),
      map: this.map,
      add: this.adding !== null,
      batch: items.find((i) => i.body.batch)?.body.batch,
      onEnd: () => this.exit(),
    });
  }

  /** What a piece's ticket says (8a: « Direction », « 27° → 300° nord-ouest »). */
  private ticket(uuid: string, b: Contribution): Ticket {
    const dunno = t("modify.value.dunno");
    const field = (f: string) => t(`modify.field.${f}`);
    switch (b.kind) {
      case "add":
        return { uuid, what: t("score.what.add"), value: "" };
      case "move": {
        const m = this.changes.move?.m ?? 0;
        return { uuid, what: field("position"), value: t("score.det.moved", { m: Math.round(m) }) };
      }
      case "shape":
        return b.answer === "unknown"
          ? { uuid, what: field("shape"), value: dunno }
          : { uuid, what: field("shape"), value: t(`modify.shape.${b.answer}`) };
      case "direction": {
        if (b.direction === undefined)
          return { uuid, what: field("direction"), value: t("modify.value.not_visible") };
        const from = Number(this.props.d ?? -1);
        const dir = t(`modify.compass.${Math.round(b.direction / 45) % 8}`);
        return !this.adding && from >= 0
          ? {
              uuid,
              what: field("direction"),
              value: t("score.det.turned", { from: Math.round(from), to: b.direction, dir }),
            }
          : { uuid, what: field("direction"), value: this.bearingText(b.direction) };
      }
      case "height":
        return b.answer === "unknown"
          ? { uuid, what: field("height"), value: dunno }
          : { uuid, what: field("height"), value: t(`modify.height.${b.answer}`) };
      case "tilt":
        return b.answer === "unknown"
          ? { uuid, what: field("tilt"), value: dunno }
          : { uuid, what: field("tilt"), value: t(`chip.value.tilt.${b.answer}`) };
      default:
        return b.answer === "unknown"
          ? { uuid, what: field("operator"), value: dunno }
          : {
              uuid,
              what: field("operator"),
              // A proposed name shows nowhere before review, not on the ticket either.
              value:
                b.operator_name ??
                (b.operator_proposed
                  ? t("modify.operator.ticket_proposed", { cls: t(`modify.operator.${b.answer}`) })
                  : t(`modify.operator.${b.answer}`)),
            };
    }
  }

  /** 8a: the field the send gives drawn first towards the camera's direction, then turned
   * to the new one once the sheet is gone (700 ms on 8a's spring), its bearing on the
   * yellow tag beside it; at once under reduced motion. What review has not accepted yet
   * stays on the map only while the tickets are shown (the author's request of 2026-10-11). */
  private turn(from: number, to: number): void {
    const d = ((to - from + 540) % 360) - 180;
    const field = this.field;
    if (!d || !field.features.length) return;
    const o = this.origin();
    const k = Math.cos((o[1] * Math.PI) / 180);
    const turned = (deg: number): GeoJSON.FeatureCollection => {
      const r = (deg * Math.PI) / 180;
      const [cos, sin] = [Math.cos(r), Math.sin(r)];
      const at = ([lng, lat]: number[]) => {
        const x = (lng - o[0]) * k;
        const y = lat - o[1];
        return [o[0] + (x * cos + y * sin) / k, o[1] - x * sin + y * cos];
      };
      const walk = (c: unknown): unknown =>
        typeof (c as number[])[0] === "number" ? at(c as number[]) : (c as unknown[]).map(walk);
      return {
        type: "FeatureCollection",
        features: field.features.map((f) => ({
          ...f,
          geometry: {
            ...f.geometry,
            coordinates: walk((f.geometry as GeoJSON.Polygon).coordinates),
          } as GeoJSON.Geometry,
        })),
      };
    };
    const tag = el("div", "", this.bearingText(Math.round(from)));
    tag.id = "edit-tag";
    tag.setAttribute("aria-hidden", "true");
    document.body.append(tag);
    this.turnTag = tag;
    const place = (bearing: number) => {
      const box = this.map.getContainer().getBoundingClientRect();
      const p = this.map.project(along(o, bearing, 22));
      const left = box.left + p.x > window.innerWidth - TAG_ROOM;
      const xy = `translate(${box.left + p.x}px, ${box.top + p.y}px)`;
      tag.dataset.side = left ? "left" : "right";
      tag.style.transform = left ? `${xy} translateX(-100%)` : xy;
    };
    // The tag follows the map (its own ease to the camera, then any move until put away).
    let bearing = from;
    const follow = () => place(bearing);
    this.map.on("move", follow);
    this.unturn = () => this.map.off("move", follow);
    if (!motion()) {
      tag.textContent = this.bearingText(to);
      bearing = to;
      place(to);
      return;
    }
    this.set("edit-field", turned(-d));
    place(from);
    const ease = cubicBezier(0.2, 1.6, 0.4, 1);
    const start = performance.now() + LAND + 80;
    const frame = (now: number) => {
      if (!this.active) return;
      const p = Math.min(1, Math.max(0, (now - start) / 700));
      const left = -d * (1 - ease(p));
      this.set("edit-field", turned(left));
      // 8a: the tag says the new bearing from 300 ms after the sheet is gone.
      if (now >= start + 220) tag.textContent = this.bearingText(to);
      bearing = to + left;
      place(bearing);
      if (p < 1) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  // --- leaving ------------------------------------------------------------------------------

  /** « ← » (back to the camera's sheet) or « × » (to the map): with something not sent,
   * asks first. */
  private leave(toSheet: boolean): void {
    if (!this.adding && !this.count()) {
      this.exit(toSheet);
      return;
    }
    if (this.panel.querySelector(".part-abandon")) return;
    const box = el("div", "part-abandon");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-labelledby", "modify-abandon-q");
    const q = el(
      "p",
      "part-question",
      t(this.adding ? "part.add.abandon_question" : "modify.abandon_question"),
    );
    q.id = "modify-abandon-q";
    box.append(q, el("p", "part-hint", t("modify.abandon_nothing")));
    const row = el("div", "modify-actions");
    const keep = el("button", "part-btn quiet", t("part.add.abandon_keep"));
    keep.addEventListener("click", () => {
      box.remove();
      this.panel.querySelector<HTMLElement>("#modify-title")?.focus();
    });
    const drop = el("button", "part-btn primary", t("modify.abandon_confirm"));
    drop.id = "modify-abandon";
    drop.addEventListener("click", () => {
      debugEvent(`${this.adding ? "add" : "modify"} abandoned, nothing sent`);
      this.exit(toSheet);
    });
    row.append(keep, drop);
    box.append(row);
    this.panel.querySelector(".modify-head")?.after(box);
    keep.focus();
  }

  /** Escape: back from a view, else as « × ». */
  escape(): void {
    if (this.view === "position" && this.placing) this.exit();
    else if (this.view === "position" || this.view === "aim") this.enterSheet(this.view);
    else if (this.view === "duplicates") {
      this.placing = true;
      this.enterPosition();
    } else if (this.view === "sent") this.exit();
    else this.leave(false);
  }

  exit(toSheet = false): void {
    if (!this.active) return;
    this.active = false;
    this.inflight?.abort();
    cancelAnimationFrame(this.raf);
    this.unturn();
    this.turnTag?.remove();
    this.turnTag = null;
    this.scene?.end();
    this.scene = null;
    this.leaveMapView();
    this.map.off("move", this.onMove);
    for (const id of this.layerIds()) if (this.map.getLayer(id)) this.map.removeLayer(id);
    for (const id of SOURCES) if (this.map.getSource(id)) this.map.removeSource(id);
    for (const undo of this.restore.splice(0)) undo();
    this.pin?.remove();
    this.pin = null;
    this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    this.panel.remove();
    document.body.classList.remove("moving", "modifying");
    delete document.body.dataset.editView;
    debugEvent(`${this.adding ? "add" : "modify"} end, ${this.sent} sent`);
    this.ctx.onExit(this.sent);
    if (toSheet && !this.adding) this.ctx.reopen(this.cam.id);
  }
}

/** The point `m` metres from `from` towards `deg` (degrees from north). */
function along(from: [number, number], deg: number, m: number): [number, number] {
  const rad = Math.PI / 180;
  const dLat = (m * Math.cos(deg * rad)) / 111_320;
  const dLon = (m * Math.sin(deg * rad)) / (111_320 * Math.cos(from[1] * rad));
  return [from[0] + dLon, from[1] + dLat];
}

/** Text for screen readers only (the sheet's `said`). */
function said(text: string): HTMLElement {
  return el("span", "modify-sr", text);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
