// Participation API client. Same origin: the browser sends the session cookie itself (the
// account, migration 014; the preview's basic auth is only its gate). ?debug=1 logs each call (method,
// path without its query, status, duration), never its body.
import { debugEvent } from "../debug";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
  /** Retrying later can succeed (server busy or down, rate limit). */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Told when an API call succeeds: the network is back (the send queue listens). */
const reachable: (() => void)[] = [];
export const onReachable = (listener: () => void) => reachable.push(listener);

/** Offline, DNS failure, connection reset: fetch throws a TypeError. */
export const isNetworkError = (e: unknown): boolean => e instanceof TypeError;

export async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const t0 = performance.now();
  const label = `${method} ${path.split("?")[0]}`;
  try {
    const r = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    debugEvent(`api ${label} ${r.status} ${Math.round(performance.now() - t0)} ms`);
    const data = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
    if (!r.ok) throw new ApiError(r.status, String(data?.error ?? r.statusText));
    for (const listener of reachable) listener();
    return data as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      debugEvent(`api ${label} aborted`);
    } else if (!(e instanceof ApiError)) {
      debugEvent(`api ${label} failed (${e instanceof Error ? e.name : "?"})`);
    }
    throw e;
  }
}

export type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, number | string>>;
export type Preview = {
  position: [number, number];
  pulled: boolean;
  facade: [number, number][] | null;
  facade_m: number | null;
  move_m: number;
  inside_footprint: boolean;
  origin: [number, number] | null;
  bands: GeoJSON.FeatureCollection;
  build_id: string;
};

/** A camera moved to (lon, lat), or with `add` and no camera, a new one placed there. */
export type PreviewBody = {
  camera?: string;
  add?: boolean;
  lon: number;
  lat: number;
  placement: "facade" | "free";
};

export const preview = (body: PreviewBody, signal: AbortSignal) =>
  call<Preview>("POST", "/api/preview", body, signal);

/** The buildings around a camera (or a point, for an add), in metres relative to it
 * (magnet.ts), and the frame. */
export type Facades = {
  frame: import("./magnet").Frame;
  capture_m: number;
  offset_m: number;
  polygons: import("./magnet").Poly[];
};
export const facades = (at: { camera: string } | { lon: number; lat: number }) =>
  call<Facades>("POST", "/api/facades", at);

/** Contribution statuses; applied, superseded and conflict are written by the deploy,
 * withdrawn by the author (migration 008). */
export type Status =
  | "pending"
  | "validated"
  | "rejected"
  | "applied"
  | "superseded"
  | "conflict"
  | "withdrawn";
export const STATUSES: Status[] = [
  "pending",
  "validated",
  "applied",
  "superseded",
  "conflict",
  "rejected",
  "withdrawn",
];
/** Statuses a build settled (the deploy writes them with the build, apply_build); a later
 * decision (rejected, validated again) keeps that column, so show it only with them. */
export const SETTLED: Status[] = ["applied", "superseded", "conflict"];
/** "idf-20260926T113843Z-cddac8c1" -> "cddac8c1": the build's digest, enough to tell. */
export const shortBuild = (id: string) => id.split("-").pop() ?? id;

export type Mine = {
  author: string;
  contributions: {
    uuid: string;
    kind: "verify" | "move" | "agree" | "disagree" | "shape" | "direction" | "operator" | "add";
    camera: string;
    day: string;
    status: Status;
    answer: string | null;
    move_m: number | null;
    /** The build that applied it, superseded it or found it in conflict. */
    apply_build: string | null;
    direction: number | null;
    operator_name: string | null;
    /** A name proposed, still under review: the API sends `true` and no name. */
    operator_proposed?: boolean | null;
    /** A piece of a « Modifier » send: the send's uuid. */
    batch?: string | null;
    /** The camera's commune (none for an add not yet in the build), where it stands, and
     * the others' agreement as /revue counts it (null: nothing to agree with). */
    commune?: string | null;
    lng?: number | null;
    lat?: number | null;
    agree?: number | null;
    disagree?: number | null;
    /** « Mes caméras » (lot U): made on site, its publication on OpenStreetMap (the live
     * server or the offered one), where it stands; absent from an older API. */
    on_site?: boolean;
    osm?: { server: string; state: string; month: string; changeset: number | null } | null;
    state?: CollectionState | null;
  }[];
  /** Each camera's label, as « Compte » names it (an add's kind from its shape answer). */
  cameras?: Record<string, CameraLabel>;
};
/** Where a contribution stands in « Mes caméras »: en attente, validée, sur la carte, publiée
 * sur OSM, refusée (pipeline/lacarte/api/app.py collection_state). */
export type CollectionState = "pending" | "validated" | "map" | "osm" | "refused";
/** How the API names a camera (/revue's labels, GET /api/osm/sync's). */
export type CameraLabel = {
  add: boolean;
  built: boolean;
  kind: string | null;
  operator: string | null;
  operator_class: string | null;
  street: string | null;
  commune: string | null;
};
export const mine = () => call<Mine>("GET", "/api/me/contributions");
/** The author takes back a pending contribution of theirs (uuid in the body, never in the
 * URL); an add takes their pending answers on it. */
export const withdrawSent = (uuid: string) =>
  call<{ uuid: string; status: Status; withdrawn: string[] }>(
    "POST",
    "/api/contributions/withdraw",
    { uuid },
  );

export const inView = (bbox: [number, number, number, number]) =>
  call<GeoJSON.FeatureCollection>("GET", `/api/contributions?bbox=${bbox.join(",")}`);
