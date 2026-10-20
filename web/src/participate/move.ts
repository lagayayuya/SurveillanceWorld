// Move mode: the map slides under the camera, drawn as a pin whose tip is the exact position
// (neither the finger nor the pictogram hides it; pan and pinch stay the map's own, without
// inertia), from z19. Two placements, one control: "Libre" keeps the tip at the centre;
// "Sur une façade" pulls it onto the nearest facade within 3 m on every frame, on the
// phone (magnet.ts, the server's rule on the buildings /api/facades sent once). At rest,
// /api/preview computes the field (150 ms debounce, the previous request cancelled) and its
// position wins; a phone-server gap over 5 cm goes to ?debug=1. The current field stays
// dashed, the facade used is drawn. Preselection by the mount (rules/participation.yaml),
// none for an unknown mount, and then "Valider" waits.
// Offline: no preview, the move can still be sent (the server computes it on receipt).
// "Ajouter une caméra" (add.ts) is this mode on a point instead of a camera.

import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { debugEvent } from "../debug";
import { t } from "../i18n";
import { cameraCanvas, KINDS, type Kind } from "../icons";
import { isPhone } from "../layout";
import { onTheme, palette } from "../theme";
import {
  ApiError,
  type Facades,
  facades,
  isNetworkError,
  type Preview,
  type PreviewBody,
  preview,
} from "./api";
import { magnet, toLocal, toLonLat } from "./magnet";
import { metresBetween, onSite, onSiteHelp } from "./onsite";
import { type Contribution, type Queue, today } from "./queue";
import { hideFields, paddingFollower, slideMode } from "./slide";

export type Placement = "facade" | "free";
export type Rules = {
  placement: { facade: string[]; free: string[]; choose: string[] };
  add?: { min_zoom: number; refetch_m: number; duplicate_m: number };
  capture_m: number;
  move_max_m: number;
  nearby_m: number;
  on_site_m: number;
  on_site_max_age_s?: number;
  on_site_max_accuracy_m?: number;
  proposals_min_zoom?: number;
};
export type MoveTarget = {
  id: string;
  fid: number;
  lngLat: [number, number];
  mg: string;
  k: string;
};

const MIN_ZOOM = 19;
const DEBOUNCE_MS = 150;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["move-old", "move-new", "move-facade"] as const;
const AGREE_M = 0.05; // phone and server positions further apart than this are logged

export class MoveMode {
  active = false;
  protected cam!: MoveTarget;
  protected placement: Placement | null = null;
  private timer = 0;
  private inflight: AbortController | null = null;
  protected last: Preview | null = null;
  private restore: (() => void)[] = [];
  protected panel!: HTMLElement;
  private pin!: HTMLElement;
  protected facades: Facades | null = null;
  /** Where the pin is: the phone's result while the map moves, the server's at rest. */
  protected at: { lngLat: [number, number]; pulled: boolean; source: "phone" | "server" } | null =
    null;
  private onMove = () => {
    this.placePin();
    this.schedule();
  };

  constructor(
    protected map: MlMap,
    protected rules: Rules,
    protected ctx: {
      queue: Queue;
      buildId: string;
      est: () => number;
      onExit: (sent: boolean) => void;
    },
  ) {}

  // What an add (add.ts) does differently: the buildings and the field around a point,
  // no current field, no move limit, its own words, its own end.
  protected facadesFor(): Promise<Facades> {
    return facades({ camera: this.cam.id });
  }

  protected previewBody(lon: number, lat: number, placement: Placement): PreviewBody {
    return { camera: this.cam.id, lon, lat, placement };
  }

  /** The server's position and field for the pin at rest (« Modifier »'s position view
   * asks for the field its other changes give: modify.ts). */
  protected fetchPreview(
    lon: number,
    lat: number,
    placement: Placement,
    signal: AbortSignal,
  ): Promise<Preview> {
    return preview(this.previewBody(lon, lat, placement), signal);
  }

  protected words: { title: string; hint: string; foot?: string; previewOk: string } = {
    title: "part.move.title",
    hint: "part.move.hint",
    previewOk: "part.move.preview.ok",
  };

  /** What the status line says, and whether "Valider" waits. */
  protected statusLines(): { lines: string[]; blocked: boolean } {
    const d = this.distance();
    const tooFar = d > this.rules.move_max_m;
    const lines = [
      tooFar
        ? t("part.move.too_far", { max: this.rules.move_max_m })
        : t("part.move.distance", { m: Math.round(d * 10) / 10 }),
    ];
    return { lines, blocked: tooFar };
  }

  /** Cameras of the loaded tiles within `nearby_m` of this one, itself first. */
  nearby(cam: MoveTarget): MoveTarget[] {
    const seen = new Map<string, MoveTarget>([[cam.id, cam]]);
    for (const f of this.map.querySourceFeatures("detail", { sourceLayer: "cameras" })) {
      const id = String(f.properties.id);
      const lngLat = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      if (seen.has(id) || metresBetween(cam.lngLat, lngLat) > this.rules.nearby_m) continue;
      seen.set(id, {
        id,
        fid: Number(f.id),
        lngLat,
        mg: String(f.properties.mg ?? "unknown"),
        k: String(f.properties.k ?? "unknown"),
      });
    }
    return [...seen.values()];
  }

  start(cam: MoveTarget): void {
    this.cam = cam;
    this.active = true;
    this.last = null;
    const p = this.rules.placement;
    this.placement = p.facade.includes(cam.mg) ? "facade" : p.free.includes(cam.mg) ? "free" : null;
    document.body.classList.add("moving");
    this.restore = [hideFields(this.map)];
    this.addLayers();
    this.buildUi();
    this.restore.push(slideMode(this.map));
    this.map.setPadding(this.padding());
    this.map.jumpTo({ center: cam.lngLat, zoom: Math.max(this.map.getZoom(), MIN_ZOOM) });
    this.map.on("move", this.onMove);
    this.placePin();
    debugEvent(`move start ${cam.id} mg=${cam.mg}`);
    void this.loadFacades();
    void this.loadOld().then(() => this.request());
  }

  /** The buildings around the camera, once: the phone's magnet reads them every frame. */
  protected async loadFacades(): Promise<void> {
    this.facades = null;
    try {
      this.facades = await this.facadesFor();
      debugEvent(`facades: ${this.facades.polygons.length} buildings`);
      this.placePin();
    } catch {
      // Offline: the pin stays at the centre; the server pulls it on receipt.
    }
  }

  /** The phone's position for the map's centre: the centre, or pulled onto a facade. */
  private phonePosition(): {
    lngLat: [number, number];
    pulled: boolean;
    facade: [number, number][] | null;
  } {
    const c = this.map.getCenter();
    const centre: [number, number] = [c.lng, c.lat];
    const f = this.facades;
    if (this.placement !== "facade" || !f) return { lngLat: centre, pulled: false, facade: null };
    const [x, y] = toLocal(f.frame, c.lng, c.lat);
    const r = magnet(x, y, f.polygons, f.capture_m);
    if (!r.pulled) return { lngLat: centre, pulled: false, facade: null };
    return {
      lngLat: toLonLat(f.frame, r.x, r.y),
      pulled: true,
      facade: r.facade ? r.facade.map(([fx, fy]) => toLonLat(f.frame, fx, fy)) : null,
    };
  }

  /** Every frame while the map moves: the pin follows (the phone's magnet in façade mode). */
  protected placePin(): void {
    if (!this.active || !this.pin) return;
    const p = this.phonePosition();
    this.set("move-facade", p.facade ? line(p.facade) : EMPTY);
    this.drawPin({ lngLat: p.lngLat, pulled: p.pulled, source: "phone" });
  }

  private drawPin(at: NonNullable<MoveMode["at"]>): void {
    this.at = at;
    const box = this.map.getContainer().getBoundingClientRect();
    const q = this.map.project(at.lngLat);
    this.pin.style.transform = `translate(${box.left + q.x}px, ${box.top + q.y}px)`;
    this.pin.dataset.lng = String(at.lngLat[0]);
    this.pin.dataset.lat = String(at.lngLat[1]);
    this.pin.dataset.pulled = String(at.pulled);
    this.pin.dataset.source = at.source;
  }

  /** The current field, dashed: the batch's field at the served position (no magnet). */
  protected async loadOld(): Promise<void> {
    try {
      const [lon, lat] = this.cam.lngLat;
      const r = await preview(
        { camera: this.cam.id, lon, lat, placement: "free" as const },
        new AbortController().signal,
      );
      const est = this.ctx.est();
      const features = r.bands.features.filter((f) => f.properties?.b === est);
      this.set("move-old", { type: "FeatureCollection", features });
    } catch {
      this.oldFromTiles();
    }
  }

  private padding() {
    const top = (document.getElementById("estimate")?.getBoundingClientRect().bottom ?? 0) + 8;
    // On a phone the panel covers the bottom; on a wide screen it sits at the right.
    const bottom = isPhone() ? this.panel.offsetHeight + 8 : 0;
    const right = isPhone() ? 0 : this.panel.offsetWidth + 20;
    return { top, bottom, left: 0, right };
  }

  private buildUi(): void {
    // The camera itself, as a pin: its pictogram above a thin stem whose tip is the point.
    this.pin = document.createElement("div");
    this.pin.id = "move-pin";
    this.pin.setAttribute("aria-hidden", "true");
    const kind = (
      (KINDS as readonly string[]).includes(this.cam.k) ? this.cam.k : "unknown"
    ) as Kind;
    let picto = cameraCanvas(kind);
    picto.className = "pin-picto";
    onTheme(
      () => {
        const fresh = cameraCanvas(kind);
        fresh.className = "pin-picto";
        picto.replaceWith(fresh);
        picto = fresh;
      },
      () => picto.isConnected,
    );
    const stem = document.createElement("span");
    stem.className = "pin-stem";
    const tip = document.createElement("span");
    tip.className = "pin-tip";
    this.pin.append(stem, picto, tip);
    this.panel = document.createElement("section");
    this.panel.id = "move-panel";
    this.panel.setAttribute("aria-label", t("part.move.title"));
    document.body.append(this.pin, this.panel);
    this.render();
    // The map's "move" rewrites the status line, which can change the panel's height while
    // a finger slides the map: the padding waits for the finger (paddingFollower).
    new ResizeObserver(
      paddingFollower(
        this.map,
        () => (this.active ? this.padding() : null),
        () => this.placePin(),
      ),
    ).observe(this.panel);
    this.map.setPadding(this.padding());
    this.placePin();
  }

  protected render(): void {
    const p = this.panel;
    p.replaceChildren();
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    p.append(el("h3", "", t(this.words.title)), el("p", "part-hint", t(this.words.hint)));
    const status = el("p", "part-status");
    status.id = "move-status";
    status.setAttribute("aria-live", "polite");
    p.append(status);

    // One control, two exclusive positions (a radio group of two buttons).
    const group = el("div", "part-placement");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", t("part.move.placement"));
    for (const choice of ["facade", "free"] as Placement[]) {
      const b = el("button", "part-choice", t(`part.move.placement.${choice}`));
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(this.placement === choice));
      b.dataset.placement = choice;
      b.addEventListener("click", () => {
        this.placement = choice;
        this.render();
        void this.request();
      });
      group.append(b);
    }
    p.append(group);
    const actions = el("div", "part-actions");
    const cancel = el("button", "part-btn quiet", t("part.cancel"));
    cancel.addEventListener("click", () => this.exit(false));
    const ok = el("button", "part-btn primary", t("part.move.submit"));
    ok.id = "move-submit";
    ok.addEventListener("click", () => void this.submit());
    actions.append(cancel, ok);
    p.append(actions);
    if (this.words.foot) p.append(el("p", "part-onsite", t(this.words.foot)));
    p.append(onSiteHelp(this.rules));
    this.updateStatus();
  }

  protected needsPlacement(): boolean {
    return this.placement === null;
  }

  private distance(): number {
    const c = this.map.getCenter();
    return metresBetween(this.cam.lngLat, this.at?.lngLat ?? [c.lng, c.lat]);
  }

  protected updateStatus(text?: string): void {
    const status = this.panel.querySelector("#move-status");
    const ok = this.panel.querySelector<HTMLButtonElement>("#move-submit");
    if (!status || !ok) return;
    const { lines, blocked } = this.statusLines();
    if (this.last?.pulled && this.last.facade_m !== null)
      lines.push(t("part.move.pulled", { m: this.last.facade_m }));
    if (this.last?.inside_footprint) lines.push(t("part.move.inside"));
    if (text) lines.push(text);
    if (this.needsPlacement()) lines.push(t("part.move.placement_needed"));
    status.textContent = lines.join(" · ");
    ok.disabled = blocked || this.needsPlacement();
  }

  private schedule(): void {
    // The map moved: an answer still on its way is about a centre it has left, and drawn
    // it would put the pin back there while the finger rests (smoke test, WebKit).
    this.inflight?.abort();
    this.updateStatus();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.request(), DEBOUNCE_MS);
  }

  protected async request(): Promise<void> {
    if (!this.active) return;
    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    const c = this.map.getCenter();
    const phone = this.phonePosition();
    this.updateStatus(t("part.move.preview.loading"));
    try {
      // Before a choice (unknown mount), the preview shows the free position.
      const r = await this.fetchPreview(c.lng, c.lat, this.placement ?? "free", ctrl.signal);
      if (ctrl.signal.aborted || !this.active) return;
      this.last = r;
      const est = this.ctx.est();
      const bands = r.bands.features.filter((f) => f.properties?.b === est);
      this.set("move-new", { type: "FeatureCollection", features: bands });
      this.set("move-facade", r.facade ? line(r.facade) : EMPTY);
      // The server is the authority: the pin goes where it says.
      const gap = metresBetween(phone.lngLat, r.position);
      if (gap > AGREE_M || phone.pulled !== r.pulled)
        debugEvent(
          `magnet: phone ${gap.toFixed(3)} m from server (pulled ${phone.pulled}/${r.pulled})`,
        );
      this.drawPin({ lngLat: r.position, pulled: r.pulled, source: "server" });
      this.updateStatus(t(this.words.previewOk));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.last = null;
      this.set("move-new", EMPTY);
      const key = isNetworkError(e)
        ? "part.move.preview.offline"
        : e instanceof ApiError && e.code === "too_far"
          ? ""
          : "part.move.preview.error";
      this.updateStatus(key ? t(key) : undefined);
    }
  }

  /** Offline: the current field from the loaded tiles (pieces cut at tile edges). */
  private oldFromTiles(): void {
    const est = this.ctx.est();
    const features = this.map
      .querySourceFeatures("detail", { sourceLayer: "bands" })
      .filter((f) => Number(f.properties.i) === this.cam.fid && f.properties.b === est)
      .map((f) => ({ type: "Feature" as const, geometry: f.geometry, properties: f.properties }));
    this.set("move-old", { type: "FeatureCollection", features });
  }

  protected async submit(): Promise<void> {
    if (this.placement === null || this.distance() > this.rules.move_max_m) return;
    const c = this.map.getCenter();
    const body: Contribution = {
      kind: "move",
      camera: this.cam.id,
      build_id: this.ctx.buildId,
      day: today(),
      on_site: await onSite(this.cam.lngLat, this.rules),
      lon: c.lng,
      lat: c.lat,
      placement: this.placement,
    };
    await this.ctx.queue.add(body);
    debugEvent(`move sent ${this.cam.id} ${this.placement}`);
    this.exit(true);
  }

  exit(sent: boolean): void {
    if (!this.active) return;
    this.active = false;
    this.inflight?.abort();
    clearTimeout(this.timer);
    this.map.off("move", this.onMove);
    this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    for (const id of ["move-old", "move-new", "move-facade"]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const id of SOURCES) if (this.map.getSource(id)) this.map.removeSource(id);
    for (const undo of this.restore.splice(0)) undo();
    this.panel.remove();
    this.pin.remove();
    document.body.classList.remove("moving");
    debugEvent(`move ${sent ? "sent" : "cancelled"}`);
    this.ctx.onExit(sent);
  }

  private addLayers(): void {
    for (const id of SOURCES) this.map.addSource(id, { type: "geojson", data: EMPTY });
    const p = palette();
    const below = this.map.getLayer("cameras") ? "cameras" : undefined;
    this.map.addLayer(
      {
        id: "move-new",
        type: "fill",
        source: "move-new",
        paint: {
          "fill-color": p.field,
          "fill-opacity": ["match", ["get", "lv"], 1, 0.12, 2, 0.16, 3, 0.2, 0.12],
        },
      },
      below,
    );
    this.map.addLayer(
      {
        id: "move-old",
        type: "line",
        source: "move-old",
        filter: ["==", ["get", "lv"], 1],
        paint: { "line-color": p.ink, "line-width": 1.5, "line-dasharray": [2, 2] },
      },
      below,
    );
    this.map.addLayer({
      id: "move-facade",
      type: "line",
      source: "move-facade",
      paint: { "line-color": p.guide, "line-width": 4 },
    });
  }

  private set(id: (typeof SOURCES)[number], data: GeoJSON.FeatureCollection): void {
    (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  }
}

const line = (cs: [number, number][]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "LineString", coordinates: cs }, properties: {} },
  ],
});
