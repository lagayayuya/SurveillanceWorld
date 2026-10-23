// Proposals on the map, for every account (GET /api/proposals, by view, from
// `proposals_min_zoom`): moves, "not found" and adds not rejected. A dot up to z15; then a
// badge at the pictogram's top left (the "maybe gone" one is at the top right) and, for a
// move, a pale pictogram at the proposed position linked by a thin dotted line; an add is
// a pale pictogram with the badge, tappable (it opens the proposal's sheet). The proposed
// field is drawn only while its camera is selected. This phone's proposals still in the
// send queue are drawn too, and once sent they stay drawn until a refresh started after
// they left answers (with them, or without: refused); responses are drawn in the order
// the refreshes started, the latest wins. No author's name ever reaches the map.
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { DETAIL_MIN } from "../layers";
import { palette } from "../theme";
import { call } from "./api";
import { addedId, type Queue } from "./queue";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export type Proposal = {
  u: string; // uuid ("" while queued)
  q?: string; // its uuid in the send queue
  c: string; // camera
  k: "move" | "not_found" | "add";
  ck: string; // camera kind, for the pale pictogram
  /** conflict: an add an OSM camera was mapped beside (the review account only).
   * sent: left this phone, not yet in a response. */
  s: "pending" | "validated" | "queued" | "sent" | "conflict";
  /** "2026-10": the API dates a proposal by its month, never its day. */
  month: string;
  n: number; // other authors agreeing
  d: number; // other authors disagreeing
  m: boolean; // made by this account
  o: "agree" | "disagree" | null; // this account's opinion
  ou?: string; // its uuid (to withdraw it)
  to?: [number, number];
  mv?: number;
  bands?: GeoJSON.FeatureCollection;
  at: [number, number]; // the camera's current position; an add's own
  reason?: "duplicate";
  os?: boolean; // an add made on site
  b?: string; // a piece of a « Modifier » send: the send's uuid
  /** An add's kept answers (the API's add_answers): shape, height, tilt as their classes,
   * the direction in degrees, who films as [class, name or null]. */
  ans?: {
    shape?: string;
    /** « Multi-boules »' number of domes, beside `shape` (absent: none given). */
    dome_count?: number;
    direction?: number;
    height?: string;
    tilt?: string;
    operator?: [string, string | null];
  };
};

export class ProposalsLayer {
  private added = false;
  private remote: Proposal[] = [];
  /** Refreshes started, and the latest one whose response was drawn. */
  private started = 0;
  private drawn = 0;
  /** This phone's proposals in the queue at the last draw, by uuid. */
  private inQueue = new Map<string, Proposal>();
  /** Those that left it: kept until a refresh started after `after` answers. */
  private sent: { p: Proposal; after: number }[] = [];
  /** Shown: this phone's queued proposals, then the view's. */
  all: Proposal[] = [];
  private selected: string | null = null;
  private fieldFor: string | null = null; // the camera whose proposed field is drawn
  /** A pending add's kept answers by its uuid, read with its camera (the view's list has
   * none: the API reads them for one camera only), kept across the view's refreshes. */
  private answers = new Map<string, NonNullable<Proposal["ans"]>>();

  constructor(
    private map: MlMap,
    private queue: Queue,
    private minZoom: number,
    private est: () => number,
    private cameraAt: (id: string) => [number, number] | null,
    private onChange: () => void,
  ) {
    map.on("moveend", () => void this.refresh());
  }

  /** A proposal taken out of the queue unsent (withdrawn): not "sent", gone. */
  forget(uuid: string): void {
    this.inQueue.delete(uuid);
    this.sent = this.sent.filter((s) => s.p.u !== uuid);
  }

  /** Proposals of one camera, the most recent first. */
  forCamera(id: string): Proposal[] {
    return this.all.filter((p) => p.c === id);
  }

  private ensure(): void {
    if (this.added) return;
    this.added = true;
    for (const id of ["proposals", "proposal-moves", "proposal-field"])
      this.map.addSource(id, { type: "geojson", data: EMPTY });
    const p = palette();
    const below = this.map.getLayer("cameras") ? "cameras" : undefined;
    this.map.addLayer(
      {
        id: "proposal-field",
        type: "fill",
        source: "proposal-field",
        paint: {
          "fill-color": p.field,
          "fill-opacity": ["match", ["get", "lv"], 1, 0.1, 2, 0.14, 3, 0.18, 0.1],
        },
      },
      below,
    );
    // DECISIONS 2026-10-08, a pending add's field from its answers: the proposed field
    // outlined in the ink, dashed, so that it reads among the drawn fields.
    this.map.addLayer(
      {
        id: "proposal-field-line",
        type: "line",
        source: "proposal-field",
        filter: ["==", ["get", "lv"], 1],
        paint: { "line-color": p.ink, "line-width": 2, "line-dasharray": [2, 1.5] },
      },
      below,
    );
    // Under the selected camera, which stays above every layer (focus mode).
    const top = this.map.getLayer("camera-selected") ? "camera-selected" : undefined;
    this.map.addLayer(
      {
        id: "proposal-link",
        type: "line",
        source: "proposal-moves",
        minzoom: DETAIL_MIN,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": p.ink, "line-width": 1, "line-dasharray": [1.5, 2] },
      },
      top,
    );
    this.map.addLayer(
      {
        id: "proposal-ghost",
        type: "symbol",
        source: "proposal-moves",
        minzoom: DETAIL_MIN,
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "icon-image": ["concat", "cam-", ["get", "ck"]],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 1, 20, 1.25],
        },
        // Pale but opaque, above the cameras' pictograms: translucent, a camera beneath
        // showed through and the ghost read as under it.
        paint: {
          "icon-color": p.ghostPicto,
          "icon-halo-color": p.halo,
          "icon-halo-width": 2,
          "icon-halo-blur": 1,
        },
      },
      top,
    );
    this.map.addLayer(
      {
        id: "proposal-dot",
        type: "circle",
        source: "proposals",
        minzoom: this.minZoom,
        maxzoom: DETAIL_MIN,
        paint: {
          "circle-radius": 4,
          "circle-color": p.proposal,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": p.halo,
        },
      },
      top,
    );
    this.map.addLayer(
      {
        id: "proposal-badge",
        type: "circle",
        source: "proposals",
        minzoom: DETAIL_MIN,
        paint: {
          "circle-radius": 4,
          "circle-color": p.proposal,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": p.halo,
          "circle-translate": [-11, -10],
        },
      },
      top,
    );
  }

  async refresh(): Promise<void> {
    if (this.map.getZoom() < this.minZoom) return;
    this.ensure();
    // While a mode slides the map (move, add, "Compléter"), no fetch on every move: the
    // queue alone is drawn, and the mode's exit refreshes.
    if (document.body.classList.contains("moving")) {
      this.draw();
      return;
    }
    const id = ++this.started;
    const b = this.map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");
    try {
      const fc = await call<GeoJSON.FeatureCollection>("GET", `/api/proposals?bbox=${bbox}`);
      // A response to an older refresh, arriving after a newer one: already superseded.
      if (id < this.drawn) return;
      this.drawn = id;
      this.remote = fc.features.map((f) => {
        const p: Proposal = {
          ...(f.properties as Omit<Proposal, "at">),
          at: (f.geometry as GeoJSON.Point).coordinates as [number, number],
        };
        const ans = this.answers.get(p.u);
        return ans ? { ...p, ans } : p;
      });
      this.sent = this.sent.filter((s) => s.after >= id);
    } catch {
      // Offline: keep what was shown, plus the queue.
    }
    this.draw();
  }

  /** This phone's proposals still waiting in the send queue. */
  private queued(): Proposal[] {
    const out: Proposal[] = [];
    for (const { uuid, body } of this.queue.items) {
      if (body.kind === "add" && body.lon !== undefined && body.lat !== undefined) {
        out.push({
          ...{ u: "", q: uuid, c: addedId(uuid), k: "add", ck: "unknown", s: "queued" },
          ...{ month: body.day.slice(0, 7), n: 0, d: 0, m: true, o: null },
          at: [body.lon, body.lat],
        });
        continue;
      }
      const move = body.kind === "move" && body.lon !== undefined && body.lat !== undefined;
      if (!move && !(body.kind === "verify" && body.answer === "not_found")) continue;
      if (!body.camera) continue;
      const at = this.cameraAt(body.camera);
      if (!at) continue;
      out.push({
        u: "",
        q: uuid,
        c: body.camera,
        k: move ? "move" : "not_found",
        ck: "unknown",
        s: "queued",
        month: body.day.slice(0, 7),
        n: 0,
        d: 0,
        m: true,
        o: null,
        at,
        ...(move ? { to: [body.lon as number, body.lat as number] as [number, number] } : {}),
      });
    }
    return out;
  }

  draw(): void {
    if (!this.added) return;
    const queued = this.queued();
    // What left the queue since the last draw: on the server now, kept until a refresh
    // started from now on answers.
    const still = new Set(queued.map((p) => p.q));
    for (const [uuid, p] of this.inQueue) {
      if (!still.has(uuid))
        this.sent.push({ p: { ...p, u: uuid, s: "sent" }, after: this.started });
    }
    this.inQueue = new Map(queued.map((p) => [p.q as string, p]));
    const known = new Set(this.remote.map((p) => p.u));
    this.sent = this.sent.filter((s) => !known.has(s.p.u));
    this.all = [...queued, ...this.sent.map((s) => s.p), ...this.remote];
    const point = (at: [number, number], props: object): GeoJSON.Feature => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: at },
      properties: props,
    });
    (this.map.getSource("proposals") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: this.all.map((p) => point(p.at, { c: p.c, k: p.k, s: p.s })),
    });
    const moves: GeoJSON.Feature[] = [];
    for (const p of this.all) {
      // An add: its pale pictogram where it was added (`a`: a tap opens its sheet).
      if (p.k === "add") moves.push(point(p.at, { c: p.c, ck: p.ck, a: 1 }));
      if (!p.to) continue;
      moves.push(point(p.to, { c: p.c, ck: p.ck }), {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [p.at, p.to] },
        properties: { c: p.c },
      });
    }
    (this.map.getSource("proposal-moves") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: moves,
    });
    // A sheet opened before the proposals arrived: its proposed field now.
    if (this.selected && this.fieldFor !== this.selected) void this.select(this.selected);
    this.onChange();
  }

  /** The selected camera's proposed field, fetched on selection; none otherwise. */
  async select(camera: string | null): Promise<void> {
    this.selected = camera;
    if (!this.added) return;
    const field = this.map.getSource("proposal-field") as GeoJSONSource;
    field.setData(EMPTY);
    this.fieldFor = null;
    if (!camera || !this.forCamera(camera).some((p) => p.k !== "not_found" && p.u)) return;
    try {
      const fc = await call<GeoJSON.FeatureCollection>(
        "GET",
        `/api/proposals?camera=${encodeURIComponent(camera)}`,
      );
      if (this.selected !== camera) return;
      this.fieldFor = camera;
      // A pending add's answers (its sheet lists them): onto the view's proposal.
      let read = false;
      for (const f of fc.features) {
        const { u, k, ans } = (f.properties ?? {}) as Partial<Proposal>;
        if (k !== "add" || !u) continue;
        this.answers.set(u, ans ?? {});
        for (const p of this.remote) if (p.u === u) p.ans = ans ?? {};
        read = true;
      }
      if (read) this.onChange();
      const est = this.est();
      const latest = fc.features.find((f) => f.properties?.bands?.features?.length);
      const bands = (latest?.properties?.bands as GeoJSON.FeatureCollection | undefined)?.features;
      field.setData({
        type: "FeatureCollection",
        features: (bands ?? []).filter((f) => f.properties?.b === est),
      });
    } catch {
      // Offline: no proposed field.
    }
  }
}

/** One camera's proposals from the API (with the proposed field; for the review account an
 * add in conflict too): a sheet opened from a link, before the view's proposals came. */
export async function proposalsOf(camera: string): Promise<Proposal[]> {
  const fc = await call<GeoJSON.FeatureCollection>(
    "GET",
    `/api/proposals?camera=${encodeURIComponent(camera)}`,
  );
  return fc.features.map((f) => ({
    ...(f.properties as Omit<Proposal, "at">),
    at: (f.geometry as GeoJSON.Point).coordinates as [number, number],
  }));
}
