// "Compléter" (phase D2): at most three questions on a camera, one per screen, in this
// order, each asked only when the map does not know the answer:
//   1. shape ("À quoi ressemble-t-elle ?"): only for a camera of unknown type;
//   2. direction ("Qu'est-ce qu'elle regarde ?"): only without a surveyed direction, and
//      for a kind the direction rule covers (not PTZ, panoramas or doorbells: the type
//      from OSM, or the answer just given to question 1);
//   3. height and tilt (phase D3, one screen, "Hauteur et inclinaison"): only when the
//      answer can change the field (questions.ts mountParts): the height, then for a tube
//      the tilt once a height is chosen or known;
//   4. who films ("Qui l'a installée, d'après vous ?"): only for an unknown or private
//      operator.
// Every answer leaves at once as its own contribution, through the send queue (offline,
// idempotent); "Je ne sais pas" and "Je ne vois pas" are answers too (stored for the
// statistics, they change nothing on the map); the cross ends the questions. While they
// last only the basemap and this camera are drawn: every field, pictogram and proposal is
// hidden (opacity 0, as in move mode), the camera framed at z18. The direction screen
// slides the map under a fixed target, as move mode does: the direction is the bearing
// from the camera to the target, the field is redrawn live (/api/preview with a
// direction, 150 ms debounce), the current field stays dashed. Which answers map to which
// kind, and the distances, come from rules/questions.yaml through the build's meta.
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { debugEvent } from "../debug";
import { has, t } from "../i18n";
import { cameraCanvas, KINDS, type Kind } from "../icons";
import { isPhone } from "../layout";
import { onTheme, palette } from "../theme";
import { call, isNetworkError, type Preview } from "./api";
import { answerText } from "./mine";
import type { MoveTarget } from "./move";
import { metresBetween, type OnSiteRules, onSite, onSiteHelp } from "./onsite";
import {
  type Asked,
  answerableFacts,
  mountParts,
  type Questions,
  questionsFor,
  type Step,
} from "./questions";
import { type Contribution, type Queue, today } from "./queue";
import {
  HEIGHTS,
  type Height,
  heightSvg,
  OFFERED,
  type Shape,
  shapeSvg,
  TILTS,
  type Tilt,
  tiltSvg,
} from "./shapes";
import { hideFields, paddingFollower, slideMode } from "./slide";

/** The tile attributes the questions read (questions.ts Asked) with the sheet's target;
 * `added`: a camera just added (add.ts), in no build yet, with no current field. */
export type CompleteTarget = MoveTarget & Asked & { added?: boolean };
export type OperatorClass = "public" | "business" | "household";

const DIRECTION_ZOOM = 19;
const QUESTION_ZOOM = 18; // shape and who films: the buildings around the camera
const DEBOUNCE_MS = 150;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["aim-old", "aim-new", "aim-line"] as const;

/** Bearing in whole degrees (0-359, clockwise from north) from a to b. */
export function bearing(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const [l1, p1, l2, p2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
  const y = Math.sin(l2 - l1) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return Math.round((Math.atan2(y, x) / rad + 360) % 360) % 360;
}

export type { Questions };

/** An add not sent yet (phase "Retours terrain"): it waits on the phone with its answers
 * until "Envoyer l'ajout", then they all enter the send queue together; abandoned, nothing
 * leaves. lon, lat, placement: the requested point, where the server will place it. */
export type AddDraft = {
  uuid: string;
  body: Contribution;
  answers: { uuid: string; body: Contribution }[];
  lon: number;
  lat: number;
  placement: "facade" | "free";
};

export class CompleteMode {
  active = false;
  private cam!: CompleteTarget;
  /** The add these questions are about, while it is not sent. */
  private draft: AddDraft | null = null;
  /** "‹ Retour" from an add's first question: back to its position screen, answers kept. */
  private toPosition: ((draft: AddDraft) => void) | null = null;
  private steps: Step[] = [];
  private index = 0;
  private shape: Shape | "unknown" | null = null;
  /** This journey's direction and height answers (the tilt sends them along, so that the
   * field stored for /revue is the one they give together). */
  private direction: number | null = null;
  private height: Height | "unknown" | null = null;
  /** The mount screen's height part answered: the tilt part shows. */
  private heightDone = false;
  private sent = 0;
  private panel!: HTMLElement;
  private restore: (() => void)[] = [];
  private marker: HTMLElement | null = null;
  private aim: {
    target: HTMLElement;
    timer: number;
    inflight: AbortController | null;
    undo: () => void;
  } | null = null;
  private onMove = () => {
    this.placeMarker();
    this.aimMoved();
  };

  constructor(
    private map: MlMap,
    private q: Questions,
    private ctx: {
      queue: Queue;
      buildId: string;
      onSite: OnSiteRules;
      est: () => number;
      onExit: (sent: number) => void;
    },
  ) {}

  /** The camera gets at least one question: the sheet shows "Compléter". */
  offers(cam: CompleteTarget): boolean {
    return questionsFor(cam, this.q).length > 0;
  }

  /** The sheet's facts its questions can answer (questions.ts answerableFacts): none when
   * it does not offer « Compléter ». */
  answerable(cam: CompleteTarget): string[] {
    return this.offers(cam) ? answerableFacts(cam, this.q) : [];
  }

  start(
    cam: CompleteTarget,
    draft: AddDraft | null = null,
    toPosition: ((draft: AddDraft) => void) | null = null,
  ): void {
    this.cam = cam;
    this.draft = draft;
    this.toPosition = toPosition;
    this.active = true;
    this.sent = 0;
    this.index = 0;
    this.heightDone = false;
    // Back from the position screen: the answers already given stay, the shape included.
    const given = draft?.answers.find((a) => a.body.kind === "shape")?.body.answer;
    this.shape = (given as Shape | "unknown" | undefined) ?? null;
    this.direction =
      draft?.answers.find((a) => a.body.kind === "direction")?.body.direction ?? null;
    const height = draft?.answers.find((a) => a.body.kind === "height")?.body.answer;
    this.height = (height as Height | "unknown" | undefined) ?? null;
    this.steps = questionsFor(cam, this.q, this.shape);
    document.body.classList.add("moving", "completing");
    this.panel = document.createElement("section");
    this.panel.id = "complete-panel";
    this.panel.className = "part-panel";
    document.body.append(this.panel);
    // The map's "move" rewrites the direction's status line, which can change the panel's
    // height while a finger slides the map: the padding waits for the finger
    // (paddingFollower).
    new ResizeObserver(
      paddingFollower(
        this.map,
        () => (this.active ? this.padding() : null),
        () => this.placeMarker(),
      ),
    ).observe(this.panel);
    this.restore = [hideFields(this.map, true)];
    this.marker = this.cameraMarker();
    document.body.append(this.marker);
    this.map.on("move", this.onMove);
    debugEvent(`complete start ${cam.id}: ${this.steps.join(",")}`);
    this.show();
  }

  private padding() {
    const top = 8;
    const bottom = isPhone() ? this.panel.offsetHeight + 8 : 0;
    const right = isPhone() ? 0 : this.panel.offsetWidth + 20;
    return { top, bottom, left: 0, right };
  }

  /** The current screen, or the end. */
  private show(): void {
    this.leaveDirection();
    const step = this.steps[this.index];
    this.panel.replaceChildren();
    this.panel.dataset.step = step ?? "done";
    if (!step) {
      this.renderDone();
      return;
    }
    this.map.setPadding(this.padding());
    if (step === "direction") this.enterDirection();
    else this.map.jumpTo({ center: this.cam.lngLat, zoom: QUESTION_ZOOM });
    this.placeMarker();
    const head = el("div", "part-head");
    if (this.draft) head.append(this.backButton());
    head.append(
      el("span", "part-step", t("part.complete.step", { i: this.index + 1, n: this.steps.length })),
    );
    head.append(this.closeButton());
    this.panel.append(head);
    if (step === "shape") this.renderShape();
    else if (step === "direction") this.renderDirection();
    else if (step === "mount") this.renderMount();
    else this.renderOperator();
    // Back on a screen already answered (an add's "‹ Retour"): the answer shows.
    const given = this.given(step);
    if (given?.answer)
      this.panel
        .querySelector(`button[data-answer="${given.answer}"]`)
        ?.setAttribute("aria-pressed", "true");
    if (given?.direction !== undefined)
      this.panel
        .querySelector("h3")
        ?.after(el("p", "part-given", t("part.add.given_direction", { deg: given.direction })));
    this.panel.append(el("p", "part-onsite", t("part.complete.onsite")), ...this.help());
  }

  /** "Activez « Me localiser »…" on the journey's first screen only: on every question it
   * made the panel taller and the map, the viewfinder, smaller. An add's questions follow
   * its position screen, which had it. */
  private help(): HTMLElement[] {
    return this.index === 0 && !this.draft ? [onSiteHelp(this.ctx.onSite)] : [];
  }

  /** An add not sent: "‹ Retour" to the previous screen, the answers kept; from the first
   * question, to its position screen. "Compléter" on an existing camera has none: each
   * answer has left already. */
  private backButton(): HTMLButtonElement {
    const back = el("button", "part-back", t("part.add.back"));
    back.id = "complete-back";
    back.addEventListener("click", () => {
      if (this.index > 0) {
        this.index = Math.min(this.index, this.steps.length) - 1;
        this.heightDone = false;
        this.show();
        return;
      }
      const draft = this.draft;
      const to = this.toPosition;
      if (!draft || !to) return;
      this.draft = null; // kept by the position screen, not abandoned
      this.sent = 0;
      this.exit();
      to(draft);
    });
    return back;
  }

  /** The answer this add's draft holds for a question (shown again after "‹ Retour"). */
  private given(kind: Step | "height" | "tilt"): Contribution | undefined {
    return this.draft?.answers.find((a) => a.body.kind === kind)?.body;
  }

  /** The cross: stops the questions; for an add not sent, asks first (nothing leaves). */
  private closeButton(): HTMLButtonElement {
    const close = el("button", "part-close", "×");
    close.setAttribute("aria-label", t(this.draft ? "part.add.abandon" : "part.complete.stop"));
    close.addEventListener("click", () => (this.draft ? this.askAbandon() : this.exit()));
    return close;
  }

  /** Escape: the cross's behaviour (an add not sent asks first). */
  escape(): void {
    if (this.draft) this.askAbandon();
    else this.exit();
  }

  /** "Abandonner cet ajout ?": the second step, above the current screen. */
  askAbandon(): void {
    if (this.panel.querySelector(".part-abandon")) return;
    const box = el("div", "part-abandon");
    box.setAttribute("role", "alertdialog");
    box.append(
      el("p", "part-question", t("part.add.abandon_question")),
      el("p", "part-hint", t("part.add.abandon_nothing")),
    );
    const row = el("div", "part-actions");
    const keep = el("button", "part-btn quiet", t("part.add.abandon_keep"));
    keep.addEventListener("click", () => box.remove());
    const drop = el("button", "part-btn primary", t("part.add.abandon_confirm"));
    drop.id = "add-abandon";
    drop.addEventListener("click", () => {
      debugEvent("add abandoned, nothing sent");
      this.draft = null;
      this.sent = 0;
      this.exit();
    });
    row.append(keep, drop);
    box.append(row);
    const head = this.panel.querySelector(".part-head");
    if (head) head.after(box);
    else this.panel.prepend(box);
  }

  private next(): void {
    this.index += 1;
    this.heightDone = false;
    this.show();
  }

  /** The camera the questions are about: its pictogram, enlarged on a white disc. */
  private cameraMarker(): HTMLElement {
    const box = el("div", "");
    box.id = "complete-camera";
    box.setAttribute("aria-hidden", "true");
    const kind = (
      (KINDS as readonly string[]).includes(this.cam.k) ? this.cam.k : "unknown"
    ) as Kind;
    let picto = cameraCanvas(kind);
    picto.className = "complete-picto";
    onTheme(
      () => {
        const fresh = cameraCanvas(kind);
        fresh.className = "complete-picto";
        picto.replaceWith(fresh);
        picto = fresh;
      },
      () => picto.isConnected,
    );
    const disc = el("div", "complete-disc");
    disc.append(picto);
    box.append(disc);
    return box;
  }

  private placeMarker(): void {
    if (!this.marker) return;
    const box = this.map.getContainer().getBoundingClientRect();
    const p = this.map.project(this.cam.lngLat);
    this.marker.style.transform = `translate(${box.left + p.x}px, ${box.top + p.y}px)`;
  }

  private async send(body: Partial<Contribution>): Promise<void> {
    for (const b of this.panel.querySelectorAll("button")) b.disabled = true;
    const full = {
      camera: this.cam.id,
      build_id: this.ctx.buildId,
      day: today(),
      on_site: await onSite(this.cam.lngLat, this.ctx.onSite),
      ...body,
    } as Contribution;
    // An add not sent: kept with it until "Envoyer l'ajout"; answered again after
    // "‹ Retour", the new answer replaces the old one.
    if (this.draft) {
      this.draft.answers = this.draft.answers.filter((a) => a.body.kind !== full.kind);
      this.draft.answers.push({ uuid: crypto.randomUUID(), body: full });
    } else await this.ctx.queue.add(full);
    this.sent += 1;
    debugEvent(`complete sent ${body.kind} ${body.answer ?? body.direction ?? ""}`);
  }

  // --- 1. shape ------------------------------------------------------------------------

  private renderShape(): void {
    this.panel.append(el("h3", "", t("part.complete.shape.title")));
    const grid = el("div", "part-shapes");
    const before = this.given("shape")?.answer;
    for (const shape of OFFERED) {
      const b = el("button", "part-shape");
      b.dataset.answer = shape;
      b.setAttribute("aria-pressed", String(before === shape));
      b.append(
        shapeSvg(shape),
        el("span", "part-shape-name", t(`part.complete.shape.${shape}`)),
        el("span", "part-shape-hint", t(`part.complete.shape.${shape}.hint`)),
      );
      b.addEventListener("click", () => void this.answerShape(shape));
      grid.append(b);
    }
    // "Je ne sais pas" as the grid's fourth tile, the silhouettes' size.
    const unknown = el("button", "part-shape part-shape-unknown");
    unknown.dataset.answer = "unknown";
    unknown.setAttribute("aria-pressed", String(before === "unknown"));
    unknown.append(el("span", "part-shape-name", t("part.complete.unknown")));
    unknown.addEventListener("click", () => void this.answerShape("unknown"));
    grid.append(unknown);
    this.panel.append(grid);
  }

  private async answerShape(shape: Shape | "unknown"): Promise<void> {
    await this.send({ kind: "shape", answer: shape });
    this.shape = shape;
    // The direction question depends on the shape just given (none for a PTZ or a
    // camera with several lenses).
    this.steps = [
      ...this.steps.slice(0, this.index + 1),
      ...questionsFor(this.cam, this.q, shape).filter((s) => s !== "shape"),
    ];
    // A shape that has no direction (a big hanging ball): the direction given before goes;
    // one that takes no tilt (anything but a tube) the tilt, and with no screen left for
    // them the height too.
    if (this.draft) {
      const parts = mountParts(this.cam, this.q, this.kindNow(), this.height);
      const drop = new Set<string>();
      if (!this.steps.includes("direction")) drop.add("direction");
      if (!this.steps.includes("mount")) drop.add("height").add("tilt");
      else if (!parts.tilt) drop.add("tilt");
      this.draft.answers = this.draft.answers.filter((a) => !drop.has(a.body.kind));
      if (drop.has("direction")) this.direction = null;
      if (drop.has("height")) this.height = null;
    }
    this.next();
  }

  // --- 2. direction --------------------------------------------------------------------

  private kindNow(): string {
    return this.shape && this.shape !== "unknown" ? this.q.shape_kinds[this.shape] : this.cam.k;
  }

  private renderDirection(): void {
    this.panel.append(
      el("h3", "", t("part.complete.direction.title")),
      el("p", "part-hint", t("part.complete.direction.hint")),
    );
    if (this.kindNow() === "dome")
      this.panel.append(el("p", "part-hint muted", t("part.complete.direction.dome")));
    const status = el("p", "part-status");
    status.id = "aim-status";
    status.setAttribute("aria-live", "polite");
    this.panel.append(status);
    const row = el("div", "part-actions");
    const notVisible = el("button", "part-btn", t("part.complete.direction.not_visible"));
    notVisible.dataset.answer = "not_visible";
    notVisible.addEventListener("click", async () => {
      this.direction = null;
      await this.send({ kind: "direction", answer: "not_visible" });
      this.next();
    });
    const ok = el("button", "part-btn primary", t("part.complete.direction.submit"));
    ok.id = "aim-submit";
    ok.addEventListener("click", async () => {
      if (!this.aimReady()) return;
      this.direction = this.aimBearing();
      await this.send({ kind: "direction", direction: this.direction });
      this.next();
    });
    row.append(notVisible, ok);
    this.panel.append(row);
    this.aimStatus();
  }

  private enterDirection(): void {
    for (const id of SOURCES) this.map.addSource(id, { type: "geojson", data: EMPTY });
    const p = palette();
    const below = this.map.getLayer("cameras") ? "cameras" : undefined;
    this.map.addLayer(
      {
        id: "aim-new",
        type: "fill",
        source: "aim-new",
        paint: {
          "fill-color": p.field,
          "fill-opacity": ["match", ["get", "lv"], 1, 0.12, 2, 0.16, 3, 0.2, 0.12],
        },
      },
      below,
    );
    this.map.addLayer(
      {
        id: "aim-old",
        type: "line",
        source: "aim-old",
        filter: ["==", ["get", "lv"], 1],
        paint: { "line-color": p.ink, "line-width": 1.5, "line-dasharray": [2, 2] },
      },
      below,
    );
    this.map.addLayer({
      id: "aim-line",
      type: "line",
      source: "aim-line",
      paint: { "line-color": p.guide, "line-width": 3 },
    });
    const target = el("div", "");
    target.id = "aim-target";
    target.setAttribute("aria-hidden", "true");
    document.body.append(target);
    this.aim = { target, timer: 0, inflight: null, undo: slideMode(this.map) };
    this.map.jumpTo({
      center: this.cam.lngLat,
      zoom: Math.max(this.map.getZoom(), DIRECTION_ZOOM),
    });
    void this.loadOld();
    this.aimMoved();
  }

  private leaveDirection(): void {
    if (!this.aim) return;
    this.aim.inflight?.abort();
    clearTimeout(this.aim.timer);
    this.aim.target.remove();
    this.aim.undo();
    this.aim = null;
    for (const id of ["aim-new", "aim-old", "aim-line"])
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    for (const id of SOURCES) if (this.map.getSource(id)) this.map.removeSource(id);
  }

  private centre(): [number, number] {
    const c = this.map.getCenter();
    return [c.lng, c.lat];
  }

  private aimBearing(): number {
    return bearing(this.cam.lngLat, this.centre());
  }

  private aimReady(): boolean {
    return metresBetween(this.cam.lngLat, this.centre()) >= this.q.min_target_m;
  }

  private aimMoved(): void {
    if (!this.aim) return;
    const box = this.map.getContainer().getBoundingClientRect();
    const p = this.map.project(this.map.getCenter());
    this.aim.target.style.transform = `translate(${box.left + p.x}px, ${box.top + p.y}px)`;
    this.set("aim-line", {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [this.cam.lngLat, this.centre()] },
          properties: {},
        },
      ],
    });
    this.aimStatus();
    clearTimeout(this.aim.timer);
    this.aim.timer = window.setTimeout(() => void this.preview(), DEBOUNCE_MS);
  }

  private aimStatus(text?: string): void {
    const status = this.panel.querySelector("#aim-status");
    const ok = this.panel.querySelector<HTMLButtonElement>("#aim-submit");
    if (!status || !ok) return;
    const ready = this.aimReady();
    const deg = this.aimBearing();
    const lines = [
      ready
        ? t("part.complete.direction.bearing", {
            deg,
            dir: t(`compass.${Math.round(deg / 45) % 8}`),
          })
        : t("part.complete.direction.closer"),
    ];
    if (text) lines.push(text);
    status.textContent = lines.join(" · ");
    ok.disabled = !ready;
    this.panel.dataset.bearing = ready ? String(deg) : "";
  }

  /** The field for the aimed direction (the server's, as the build would draw it). */
  private async preview(): Promise<void> {
    if (!this.aim) return;
    this.aim.inflight?.abort();
    if (!this.aimReady()) {
      this.set("aim-new", EMPTY);
      return;
    }
    const ctrl = new AbortController();
    this.aim.inflight = ctrl;
    this.aimStatus(t("part.move.preview.loading"));
    const shapeKind = this.shape && this.shape !== "unknown" ? this.kindNow() : undefined;
    const deg = this.aimBearing();
    debugEvent(`aim preview ${deg}° ${shapeKind ?? "-"} sent`);
    try {
      const r = await call<Preview>(
        "POST",
        "/api/preview",
        this.draft
          ? { ...this.where(), add: true, direction: this.aimBearing(), kind: shapeKind }
          : { camera: this.cam.id, direction: this.aimBearing(), kind: shapeKind },
        ctrl.signal,
      );
      if (ctrl.signal.aborted || !this.aim) {
        debugEvent(`aim preview ${deg}° dropped (${ctrl.signal.aborted ? "aborted" : "left"})`);
        return;
      }
      const est = this.ctx.est();
      const features = r.bands.features.filter((f) => f.properties?.b === est);
      debugEvent(
        `aim preview ${deg}° ${r.bands.features.length} bands, ${features.length} drawn (est ${est})`,
      );
      this.set("aim-new", { type: "FeatureCollection", features });
      this.aimStatus();
    } catch (e) {
      debugEvent(`aim preview ${deg}° failed: ${ctrl.signal.aborted ? "aborted" : String(e)}`);
      if (ctrl.signal.aborted) return;
      this.set("aim-new", EMPTY);
      this.aimStatus(
        t(isNetworkError(e) ? "part.complete.direction.offline" : "part.move.preview.error"),
      );
    }
  }

  /** The current field, dashed: the server's at the served position (as move mode
   * shows it), else the loaded tiles' pieces (offline). */
  private async loadOld(): Promise<void> {
    if (this.cam.added) return;
    const est = this.ctx.est();
    let features: GeoJSON.Feature[];
    try {
      const [lon, lat] = this.cam.lngLat;
      const r = await call<Preview>("POST", "/api/preview", {
        camera: this.cam.id,
        lon,
        lat,
        placement: "free",
      });
      features = r.bands.features.filter((f) => f.properties?.b === est);
    } catch {
      features = this.map
        .querySourceFeatures("detail", { sourceLayer: "bands" })
        .filter((f) => Number(f.properties.i) === this.cam.fid && f.properties.b === est)
        .map((f) => ({ type: "Feature" as const, geometry: f.geometry, properties: f.properties }));
    }
    if (this.aim) this.set("aim-old", { type: "FeatureCollection", features });
  }

  private set(id: (typeof SOURCES)[number], data: GeoJSON.FeatureCollection): void {
    (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  }

  // --- 3. height and tilt (phase D3) ----------------------------------------------------

  /** One screen, "Hauteur et inclinaison", one part at a time: the height (four drawings
   * and "Je ne sais pas"), then, for a tube once a height is chosen or known, the tilt
   * (three profiles and "Je ne sais pas"), under a line recalling the height. On an
   * existing camera each answer leaves at once; on an add both wait with it. */
  private renderMount(): void {
    const kind = this.kindNow();
    this.panel.append(el("h3", "", t("part.complete.mount.title")));
    const parts = mountParts(this.cam, this.q, kind, this.height);
    if (parts.height && (!this.heightDone || !parts.tilt)) {
      this.renderHeight();
      return;
    }
    if (parts.height && this.height) {
      const row = el("div", "part-title-row");
      row.append(
        el("p", "part-given", t("part.complete.height.given", { v: this.heightText(this.height) })),
      );
      if (this.draft) {
        const change = el("button", "part-link", t("part.complete.operator.change"));
        change.dataset.answer = "change-height";
        change.addEventListener("click", () => {
          this.heightDone = false;
          this.show();
        });
        row.append(change);
      }
      this.panel.append(row);
    }
    this.renderTilt();
  }

  private heightText(h: Height | "unknown"): string {
    return h === "unknown"
      ? t("part.complete.unknown").toLowerCase()
      : t("part.complete.height.answer", {
          v: t(`part.complete.height.${h}`),
          m: this.q.height_m[h] ?? "?",
        });
  }

  private renderHeight(): void {
    this.panel.append(el("p", "part-question", t("part.complete.height.title")));
    const grid = el("div", "part-shapes");
    for (const h of HEIGHTS) {
      const b = el("button", "part-shape");
      b.dataset.answer = h;
      b.dataset.part = "height";
      b.setAttribute("aria-pressed", String(this.height === h));
      b.append(
        heightSvg(h),
        el("span", "part-shape-name", t(`part.complete.height.${h}`)),
        el(
          "span",
          "part-shape-hint",
          t("part.complete.height.hint", { m: this.q.height_m[h] ?? "?" }),
        ),
      );
      b.addEventListener("click", () => void this.answerHeight(h));
      grid.append(b);
    }
    const unknown = el("button", "part-btn part-unknown", t("part.complete.unknown"));
    unknown.dataset.answer = "unknown";
    unknown.dataset.part = "height";
    unknown.setAttribute("aria-pressed", String(this.height === "unknown"));
    unknown.addEventListener("click", () => void this.answerHeight("unknown"));
    this.panel.append(grid, unknown);
  }

  private async answerHeight(h: Height | "unknown"): Promise<void> {
    await this.send({ kind: "height", answer: h, ...this.journey(false) });
    this.height = h;
    this.heightDone = true;
    const parts = mountParts(this.cam, this.q, this.kindNow(), h);
    // "Je ne sais pas" after a tilt was given (an add, back here): the tilt goes too.
    if (this.draft && !parts.tilt)
      this.draft.answers = this.draft.answers.filter((a) => a.body.kind !== "tilt");
    if (parts.tilt) this.show();
    else this.next();
  }

  private renderTilt(): void {
    this.panel.append(el("p", "part-question", t("part.complete.tilt.title")));
    const before = this.given("tilt")?.answer;
    const grid = el("div", "part-shapes three");
    for (const tilt of TILTS) {
      const b = el("button", "part-shape");
      b.dataset.answer = tilt;
      b.dataset.part = "tilt";
      b.setAttribute("aria-pressed", String(before === tilt));
      b.append(tiltSvg(tilt), el("span", "part-shape-name", t(`part.complete.tilt.${tilt}`)));
      b.addEventListener("click", () => void this.answerTilt(tilt));
      grid.append(b);
    }
    const unknown = el("button", "part-btn part-unknown", t("part.complete.unknown"));
    unknown.dataset.answer = "unknown";
    unknown.dataset.part = "tilt";
    unknown.setAttribute("aria-pressed", String(before === "unknown"));
    unknown.addEventListener("click", () => void this.answerTilt("unknown"));
    this.panel.append(grid, unknown);
  }

  private async answerTilt(tilt: Tilt | "unknown"): Promise<void> {
    await this.send({ kind: "tilt", answer: tilt, ...this.journey(true) });
    this.next();
  }

  /** What this journey answered before, sent with a height or tilt answer (the API stores
   * the field they give together for /revue): the shape's kind, the bearing, and for a
   * tilt the height just chosen. */
  private journey(withHeight: boolean): Partial<Contribution> {
    const out: Partial<Contribution> = {};
    if (this.shape && this.shape !== "unknown") out.aim_kind = this.kindNow();
    if (this.direction !== null) out.aim_direction = this.direction;
    if (withHeight && this.height && this.height !== "unknown") out.aim_height = this.height;
    return out;
  }

  // --- 4. who films --------------------------------------------------------------------

  private renderOperator(): void {
    this.panel.append(el("h3", "", t("part.complete.operator.title")));
    const list = el("div", "part-answers stack");
    for (const cls of ["public", "business", "household"] as OperatorClass[]) {
      const b = el("button", "part-btn part-two-lines");
      b.dataset.answer = cls;
      b.append(el("span", "", t(`part.complete.operator.${cls}`)));
      const hint = `part.complete.operator.${cls}.hint`;
      if (has(hint)) b.append(el("span", "part-btn-hint", t(hint)));
      b.addEventListener("click", () => void this.answerOperator(cls));
      list.append(b);
    }
    const unknown = el("button", "part-btn", t("part.complete.unknown"));
    unknown.dataset.answer = "unknown";
    unknown.addEventListener("click", async () => {
      await this.send({ kind: "operator", answer: "unknown" });
      this.next();
    });
    list.append(unknown);
    this.panel.append(list);
  }

  /** Public or business: a short optional list of operators around (alphabetical); a
   * private individual gets none. Offline, or with no name around, the class alone. */
  private async answerOperator(cls: OperatorClass): Promise<void> {
    let names: string[] = [];
    if (cls !== "household") {
      try {
        names = (
          await call<{ names: string[] }>(
            "POST",
            "/api/operators",
            this.draft ? { ...this.where(), class: cls } : { camera: this.cam.id, class: cls },
          )
        ).names;
      } catch {
        names = [];
      }
    }
    if (!names.length) {
      await this.send({ kind: "operator", answer: cls });
      this.next();
      return;
    }
    this.renderNames(cls, names);
  }

  private renderNames(cls: OperatorClass, names: string[]): void {
    const keep = this.panel.querySelector(".part-head");
    this.panel.replaceChildren(...(keep ? [keep] : []));
    // "‹ Changer": back to the three answers, nothing sent.
    const title = el("div", "part-title-row");
    const change = el("button", "part-link", t("part.complete.operator.change"));
    change.dataset.answer = "change";
    change.addEventListener("click", () => {
      const head = this.panel.querySelector(".part-head");
      this.panel.replaceChildren(...(head ? [head] : []));
      this.renderOperator();
      this.panel.append(el("p", "part-onsite", t("part.complete.onsite")), ...this.help());
    });
    title.append(el("h3", "", t(`part.complete.operator.${cls}`)), change);
    this.panel.append(title, el("p", "part-hint", t("part.complete.operator.which")));
    const list = el("div", "part-answers stack");
    for (const name of names) {
      const b = el("button", "part-btn quiet", name);
      b.dataset.operator = name;
      b.addEventListener("click", async () => {
        await this.send({ kind: "operator", answer: cls, operator_name: name });
        this.next();
      });
      list.append(b);
    }
    const other = el("button", "part-btn", t("part.complete.operator.other"));
    other.dataset.operator = "";
    other.addEventListener("click", async () => {
      await this.send({ kind: "operator", answer: cls });
      this.next();
    });
    list.append(other);
    this.panel.append(list, el("p", "part-onsite", t("part.complete.onsite")), ...this.help());
  }

  // --- end -----------------------------------------------------------------------------

  /** An add not sent: where the server will place it (its previews and lists). */
  private where() {
    const d = this.draft as AddDraft;
    return { lon: d.lon, lat: d.lat, placement: d.placement };
  }

  /** The last screen of an add not sent: the answers given ("je ne sais pas" included),
   * then "Envoyer l'ajout". */
  private renderSend(draft: AddDraft): void {
    const head = el("div", "part-head");
    head.append(
      this.backButton(),
      el("span", "part-step", t("part.add.ready.step")),
      this.closeButton(),
    );
    const p = el("p", "part-question", t("part.add.ready", { n: draft.answers.length }));
    const recap = el("dl", "part-recap");
    // The mount screen's two answers on two lines: the tilt only where it was asked.
    const parts = mountParts(this.cam, this.q, this.kindNow(), this.height);
    const kinds = this.steps.flatMap((s) =>
      s === "mount" ? [...(parts.height ? ["height"] : []), ...(parts.tilt ? ["tilt"] : [])] : [s],
    ) as (Step | "height" | "tilt")[];
    for (const step of kinds) {
      const a = this.given(step);
      recap.append(
        el("dt", "", t(`part.mine.kind.${step}`)),
        el(
          "dd",
          "",
          a
            ? answerText({
                kind: step,
                answer: a.answer ?? null,
                direction: a.direction ?? null,
                operator_name: a.operator_name ?? null,
              })
            : "–",
        ),
      );
    }
    const row = el("div", "part-actions");
    const send = el("button", "part-btn primary", t("part.add.send"));
    send.id = "add-commit";
    send.addEventListener("click", async () => {
      send.disabled = true;
      await this.ctx.queue.addAll([{ uuid: draft.uuid, body: draft.body }, ...draft.answers]);
      debugEvent(`add sent with ${draft.answers.length} answer(s)`);
      this.sent = 1 + draft.answers.length;
      this.draft = null;
      this.exit();
    });
    row.append(send);
    this.panel.append(head, p, recap, row);
  }

  private renderDone(): void {
    if (this.draft) {
      this.renderSend(this.draft);
      return;
    }
    const p = el(
      "p",
      "part-done",
      this.sent === 0
        ? t("part.complete.none")
        : t(navigator.onLine ? "part.complete.done" : "part.complete.queued", { n: this.sent }),
    );
    p.setAttribute("role", "status");
    const row = el("div", "part-actions");
    const finish = el("button", "part-btn primary", t("part.complete.finish"));
    finish.addEventListener("click", () => this.exit());
    row.append(finish);
    this.panel.append(p, row);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.leaveDirection();
    this.map.off("move", this.onMove);
    for (const undo of this.restore.splice(0)) undo();
    this.marker?.remove();
    this.marker = null;
    this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    this.panel.remove();
    document.body.classList.remove("moving", "completing");
    debugEvent(`complete end, ${this.sent} sent`);
    this.ctx.onExit(this.sent);
  }
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
