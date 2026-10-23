// « Mes caméras » (lot U), the account's private collection, as data: GET
// /api/me/contributions gathered by camera — each camera once, its kind (the collection's
// sticker), its name's parts, where it stands, its contributions newest first with what each
// changed and where it stands — and the counts by kind. No import but types: the tests
// (tests/collection.test.ts) read it in node.
import type { CameraLabel, CollectionState, Mine } from "../participate/api";

/** The map's kinds of camera (icons.ts KINDS), the collection's order. */
export const KINDS = [
  "dome",
  "multidome",
  "fixed",
  "ptz",
  "panorama",
  "alpr",
  "doorbell",
  "unknown",
] as const;
export type Kind = (typeof KINDS)[number];

export type Piece = {
  uuid: string;
  /** What it changed, in the history's words (historytext.ts WHATS). */
  what: string;
  /** "2026-10": the month (her own list could keep the day; the collection says the month as
   * every camera sheet does). */
  month: string;
  on_site: boolean;
  state: CollectionState;
};

export type Owned = {
  camera: string;
  kind: Kind;
  label: CameraLabel | null;
  /** Where it stands (the camera's position, or an add's own), for the little map. */
  at: [number, number] | null;
  pieces: Piece[];
  /** What a tap opens: the camera's sheet, a pending add's, or nothing (an add the review
   * refused: there is no camera to show). */
  opens: "camera" | "pending" | null;
  /** In the collection's counts: a camera she helped put or keep on the map (not one whose
   * every contribution was refused). */
  counted: boolean;
};

export type Collection = {
  cameras: Owned[];
  /** Counted cameras by kind, the most first (a tie in KINDS' order), only the kinds she has. */
  byKind: { kind: Kind; n: number }[];
  /** How many cameras she contributed to (the counted ones). */
  total: number;
};

/** A contribution's change in the history's words. */
export function whatOf(kind: string, answer: string | null): string {
  if (kind === "verify") return answer === "not_found" ? "gone" : "seen";
  if (kind === "move") return "moved";
  if (kind === "add") return "added";
  return kind;
}

const kindOf = (k: string | null | undefined): Kind =>
  (KINDS as readonly string[]).includes(k ?? "") ? (k as Kind) : "unknown";

/** The person's contributions gathered by camera, the most recent camera first. What says
 * nothing about a camera (an opinion, « Je ne sais pas », a withdrawn send: no `state`) is
 * left out; an older API without `state` gives an empty collection. */
export function collect(data: Mine): Collection {
  const by = new Map<string, Owned>();
  for (const c of data.contributions) {
    if (!c.state) continue;
    let owned = by.get(c.camera);
    if (!owned) {
      const label = data.cameras?.[c.camera] ?? null;
      owned = {
        camera: c.camera,
        kind: kindOf(label?.kind),
        label,
        at: c.lng != null && c.lat != null ? [c.lng, c.lat] : null,
        pieces: [],
        opens: "camera",
        counted: false,
      };
      by.set(c.camera, owned);
    }
    owned.pieces.push({
      uuid: c.uuid,
      what: whatOf(c.kind, c.answer),
      month: c.day.slice(0, 7),
      on_site: c.on_site === true,
      state: c.state,
    });
  }
  const cameras = [...by.values()];
  for (const o of cameras) {
    o.counted = o.pieces.some((p) => p.state !== "refused");
    const add = o.pieces.find((p) => p.what === "added");
    // An added camera: its sheet once a build drew it, else its pending add's; none once the
    // review refused it.
    if (add?.state === "refused") o.opens = null;
    else if (add && !o.label?.built) o.opens = "pending";
  }
  const counts = new Map<Kind, number>();
  for (const o of cameras) if (o.counted) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
  return {
    cameras,
    byKind: KINDS.filter((k) => counts.has(k))
      .map((k) => ({ kind: k, n: counts.get(k) ?? 0 }))
      .sort((a, b) => b.n - a.n),
    total: cameras.filter((o) => o.counted).length,
  };
}

/** The frame of the little map: the cameras' extent, at least `minSpan` degrees of latitude
 * across (about 330 m: a single camera, a street), widened to the box's `aspect` (width / height) at
 * that latitude, with a margin. [west, south, east, north]. */
export function frameOf(
  points: [number, number][],
  aspect: number,
  minSpan = 0.003,
  margin = 0.12,
): [number, number, number, number] | null {
  if (!points.length) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  const cy = (s + n) / 2;
  const cx = (w + e) / 2;
  const k = Math.cos((cy * Math.PI) / 180); // a degree of longitude, in degrees of latitude
  let height = Math.max(n - s, minSpan) * (1 + 2 * margin);
  let width = Math.max((e - w) * k * (1 + 2 * margin), height * aspect);
  height = Math.max(height, width / aspect);
  width = height * aspect;
  return [cx - width / k / 2, cy - height / 2, cx + width / k / 2, cy + height / 2];
}

// --- the mini-map's names (lot U2) ------------------------------------------------------
/** The mini-map's dots (profile/cameras.ts miniMap), in the drawing's units. */
export const DOT_R = 4.5;
/** A name's box in the drawing's units: `x` its middle, `y` its baseline (text-anchor
 * middle), its sides around them. */
export type Box = { x: number; y: number; l: number; r: number; t: number; b: number };
/** The names' letters (theme/punk/profile.css: 11 px of a typewriter face, 0.6 em a letter
 * at most), their halo (3 px) and a little air around the dots. */
const CHAR_W = 7;
const ASCENT = 10;
const DESCENT = 4;
const AIR = 2;

/** Where a commune's name goes near (cx, cy): under its cameras, over them, then beside,
 * then a little further, the first place inside the drawing that covers no dot and no name
 * already placed; null when none does (the list under the map says every commune). */
export function labelPlace(
  name: string,
  cx: number,
  cy: number,
  dots: [number, number][],
  taken: Box[],
  w: number,
  h: number,
): Box | null {
  const half = (name.length * CHAR_W) / 2;
  const box = (x: number, y: number): Box => ({
    x,
    y,
    l: x - half,
    r: x + half,
    t: y - ASCENT,
    b: y + DESCENT,
  });
  const free = (b: Box) =>
    b.l >= 2 &&
    b.r <= w - 2 &&
    b.t >= 2 &&
    b.b <= h - 2 &&
    dots.every(
      ([dx, dy]) =>
        dx + DOT_R + AIR <= b.l ||
        dx - DOT_R - AIR >= b.r ||
        dy + DOT_R + AIR <= b.t ||
        dy - DOT_R - AIR >= b.b,
    ) &&
    taken.every((o) => o.r <= b.l || o.l >= b.r || o.b <= b.t || o.t >= b.b);
  for (const d of [1, 2, 3])
    for (const [dx, dy] of [
      [0, 20 * d],
      [0, -12 * d],
      [half + 8 * d, 4],
      [-half - 8 * d, 4],
    ]) {
      const b = box(cx + dx, cy + dy);
      if (free(b)) return b;
    }
  return null;
}
