// The tiles around the view, fetched while the map rests (the author's point 7 of
// 2026-10-12: streets arriving late while walking the map). MapLibre loads only the tiles
// the view covers, so a pan waits for the network; once the map has rested REST_MS, the ring
// of tiles one tile beyond the view is fetched for each archive the map is reading at this zoom,
// a few at a time, no more started once the map moves, and kept in memory until MapLibre asks
// for them (then handed over at once, and forgotten: MapLibre's own tile cache keeps them).
// The image does not change; the cost is data: one ring per stop (web/bench/latency.mjs
// measures both). Nothing is fetched when the browser asks to save data or the connection
// is a 2G one. A tile MapLibre has already asked for is never fetched again.
// Every tile MapLibre takes is also kept in memory (SERVED_BYTES at most, the least recently
// asked dropped first) and given again when MapLibre asks for it again: it loads a tile once
// more for each zoom past its archive's own (the basemap and the cameras stop at z15, the
// streets at z16), and the browser's HTTP cache did not keep these byte ranges (lot P2,
// 2026-10-17: at Châtelet on a phone over 4G, the zoom to z16 downloaded again 656 KB of z15
// tiles, the zoom to z17 218 KB of z16 ones, web/bench/zoomblank.mjs `refetchKb`).
import type { AddProtocolAction, Map as MlMap } from "maplibre-gl";

type Result = Awaited<ReturnType<AddProtocolAction>>;
type Loader = AddProtocolAction;

/** How long the map rests before the ring is fetched, in ms: a pause between two gestures
 * costs no data. */
const REST_MS = 300;
/** Tiles fetched at once while the map rests. */
const PARALLEL = 4;
/** Prefetched tiles kept waiting for MapLibre at most (oldest dropped first). */
const KEPT = 160;
/** Tiles MapLibre asked for, remembered so as not to fetch them again (oldest dropped). */
const ASKED = 4000;
/** Bytes of the tiles kept once MapLibre has taken them, at most (about the tiles of five
 * street-level views of a dense city with their rings, decompressed). */
export const SERVED_BYTES = 24 * 2 ** 20;

const TILE = /^(pmtiles:\/\/.+)\/(\d+)\/(\d+)\/(\d+)$/;

/** Whether to prefetch: not in a browser driven by tests (navigator.webdriver), unless the
 * device asks for it (localStorage lacarte.prefetch = "1", which web/bench/latency.mjs sets).
 * WebKit under Playwright reports a fetch a navigation or a closing page cuts as an error of
 * the page, and the prefetch has some in flight after nearly every rest: every WebKit bench
 * would fail on it; latency.mjs, a step of the gate, checks the prefetch itself. */
export function wanted(): boolean {
  try {
    if (localStorage.getItem("lacarte.prefetch") === "1") return true;
  } catch {
    // No storage: as any browser.
  }
  return !navigator.webdriver;
}

/** The tile column and row at zoom `z` of a longitude and a latitude (Web Mercator, XYZ). */
export function tileOf(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** The tiles one tile beyond the view (west, south, east, north) at zoom `z`, not the view's
 * own, nearest the view's sides first (the corners last). */
export function ring(
  [west, south, east, north]: [number, number, number, number],
  z: number,
): [number, number][] {
  const n = 2 ** z;
  const [x0, y0] = tileOf(west, north, z);
  const [x1, y1] = tileOf(east, south, z);
  const out: [number, number, number][] = [];
  for (let x = x0 - 1; x <= x1 + 1; x++)
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const corner = (x < x0 || x > x1) && (y < y0 || y > y1);
      out.push([x, y, corner ? 1 : 0]);
    }
  return out.sort((a, b) => a[2] - b[2]).map(([x, y]) => [x, y]);
}

/** Wraps the pmtiles protocol's loader: what it asks is served from the prefetched tiles
 * when there, else loaded as before. `install` starts the prefetching on `map`. */
export function prefetching(load: Loader) {
  /** pmtiles://…/archive.pmtiles → the zoom MapLibre last read it at. */
  const reading = new Map<string, number>();
  const asked = new Set<string>();
  /** A prefetch: its answer, and what MapLibre's abort stops once it has taken it over. */
  type Prefetch = { p: Promise<Result>; controller: AbortController };
  const kept = new Map<string, Prefetch>();
  /** The prefetching under way: a move stops it from starting more tiles. */
  let round: { stopped: boolean } | null = null;

  const remember = (url: string) => {
    asked.add(url);
    if (asked.size > ASKED) asked.delete(asked.values().next().value as string);
  };

  /** Tiles MapLibre took, by URL, the least recently asked first. MapLibre may hand the
   * bytes it gets to a worker (transferred, hence emptied): each side keeps its own copy. */
  const served = new Map<string, Result>();
  let servedBytes = 0;
  const bytesOf = (r: Result) => (r.data as Uint8Array).byteLength;
  const copy = (r: Result): Result => ({ ...r, data: (r.data as Uint8Array).slice() });
  const keep = (url: string, r: Result): Result => {
    const data = r?.data;
    if (!(data instanceof Uint8Array || data instanceof ArrayBuffer)) return r;
    const own = {
      ...r,
      data: data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0)),
    };
    const old = served.get(url);
    if (old) servedBytes -= bytesOf(old);
    served.delete(url);
    served.set(url, own);
    servedBytes += bytesOf(own);
    while (servedBytes > SERVED_BYTES && served.size) {
      const [first, r0] = served.entries().next().value as [string, Result];
      served.delete(first);
      servedBytes -= bytesOf(r0);
    }
    return r;
  };

  const loader: Loader = (params, abortController) => {
    const m = TILE.exec(params.url);
    if (m) {
      const url = params.url;
      reading.set(m[1], Number(m[2]));
      remember(url);
      const again = served.get(url);
      if (again) {
        served.delete(url);
        served.set(url, again);
        return Promise.resolve(copy(again));
      }
      const ready = kept.get(url);
      if (ready) {
        kept.delete(url);
        abortController.signal.addEventListener("abort", () => ready.controller.abort(), {
          once: true,
        });
        // A prefetch that failed is loaded again, as MapLibre asked.
        return ready.p.catch(() => load(params, abortController)).then((r) => keep(url, r));
      }
      return Promise.resolve(load(params, abortController)).then((r) => keep(url, r));
    }
    return load(params, abortController);
  };

  // A move stops the round from starting more tiles; those in flight (PARALLEL at most)
  // finish and wait for MapLibre: cut, they would cost as much again when asked (and WebKit
  // reports a fetch cut under Playwright's routing as a page error).
  function stop(): void {
    if (round) round.stopped = true;
    round = null;
  }

  async function fill(map: MlMap): Promise<void> {
    stop();
    const net = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } })
      .connection;
    if (net?.saveData || /2g/.test(net?.effectiveType ?? "")) return;
    const b = map.getBounds();
    const view: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];
    const zoom = map.getZoom();
    const wanted: string[] = [];
    // Our archives (the streets, the cameras) before the basemap, the heaviest: a pan soon
    // after a rest finds the streets first.
    const sources = Object.entries(map.getStyle().sources).sort(
      ([a], [b]) => Number(a === "protomaps") - Number(b === "protomaps"),
    );
    for (const [id, source] of sources) {
      const archive = "url" in source ? source.url : undefined;
      if (!archive?.startsWith("pmtiles://")) continue;
      const read = map.getSource(id) as { minzoom?: number; maxzoom?: number } | undefined;
      const lo = read?.minzoom ?? 0;
      const hi = read?.maxzoom ?? 22;
      if (zoom < lo) continue;
      const at = Math.min(hi, Math.floor(zoom));
      // Only an archive MapLibre is reading at this zoom (a source whose layers are all
      // hidden here is not asked for).
      if (reading.get(archive) !== at) continue;
      for (const [x, y] of ring(view, at)) {
        const url = `${archive}/${at}/${x}/${y}`;
        if (!asked.has(url) && !kept.has(url)) wanted.push(url);
      }
    }
    if (!wanted.length) return;
    const own = { stopped: false };
    round = own;
    let next = 0;
    const worker = async () => {
      while (next < wanted.length && !own.stopped) {
        const url = wanted[next++];
        const controller = new AbortController();
        const prefetch: Prefetch = {
          p: Promise.resolve(load({ url, type: "arrayBuffer" }, controller)),
          controller,
        };
        kept.set(url, prefetch);
        if (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
        try {
          await prefetch.p;
        } catch {
          // Failed: MapLibre will ask for it if it needs it.
          if (kept.get(url) === prefetch) kept.delete(url);
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (round === own) round = null;
  }

  function install(map: MlMap): void {
    let resting = 0;
    map.on("movestart", () => {
      clearTimeout(resting);
      stop();
    });
    map.on("idle", () => {
      clearTimeout(resting);
      resting = setTimeout(() => void fill(map), REST_MS);
    });
  }

  return { loader, install };
}
