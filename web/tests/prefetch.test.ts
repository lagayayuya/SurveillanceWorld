// The ring of tiles fetched around the view while the map rests (src/prefetch.ts).
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { prefetching, ring, SERVED_BYTES, tileOf } from "../src/prefetch.ts";

test("tileOf: Paris's Hôtel de Ville at z15 and the world's corners", () => {
  assert.deepEqual(tileOf(2.3522, 48.8566, 15), [16598, 11273]);
  assert.deepEqual(tileOf(-180, 85.05, 2), [0, 0]);
  assert.deepEqual(tileOf(180, -85.05, 2), [3, 3]);
});

test("ring: the tiles around a view of 2 × 3 tiles, sides before corners, none inside", () => {
  // A view inside the tiles x 10..11, y 20..22 at z10.
  const z = 10;
  const n = 2 ** z;
  const lng = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const view: [number, number, number, number] = [lng(10.5), lat(22.5), lng(11.5), lat(20.5)];
  const r = ring(view, z);
  assert.equal(r.length, 4 * 5 - 2 * 3);
  for (const [x, y] of r) assert.ok(!(x >= 10 && x <= 11 && y >= 20 && y <= 22));
  const corners = new Set(["9,19", "12,19", "9,23", "12,23"]);
  assert.deepEqual(new Set(r.slice(-4).map(([x, y]) => `${x},${y}`)), corners);
});

test("ring: nothing outside the world at its edge", () => {
  const r = ring([-180, 80, -170, 85], 3);
  for (const [x, y] of r) assert.ok(x >= 0 && y >= 0 && x < 8 && y < 8);
});

test("a move starts no more prefetches and cuts none; MapLibre's abort cuts the one it took", async () => {
  const controllers = new Map<string, AbortController>();
  const answers = new Map<string, (v: { data: Uint8Array }) => void>();
  const load = (params: { url: string }, c: AbortController) => {
    controllers.set(params.url, c);
    return new Promise<{ data: Uint8Array }>((r) => answers.set(params.url, r));
  };
  const archive = "pmtiles://http://x/tiles/streets.pmtiles";
  const { loader, install } = prefetching(load as never);
  const handlers: Record<string, () => void> = {};
  const map = {
    on: (event: string, f: () => void) => {
      handlers[event] = f;
    },
    getBounds: () => ({
      getWest: () => 2.35,
      getSouth: () => 48.855,
      getEast: () => 2.36,
      getNorth: () => 48.86,
    }),
    getZoom: () => 15.5,
    getStyle: () => ({ sources: { streets: { type: "vector", url: archive } } }),
    getSource: () => ({ minzoom: 12, maxzoom: 16 }),
  };
  install(map as never);
  // MapLibre reads the archive at z15 (one tile of the view).
  const [x, y] = tileOf(2.355, 48.8575, 15);
  const own = `${archive}/15/${x}/${y}`;
  void loader({ url: own, type: "arrayBuffer" } as never, new AbortController());
  handlers.idle();
  await new Promise((r) => setTimeout(r, 350)); // REST_MS
  const prefetched = [...controllers.keys()].filter((u) => u !== own);
  assert.equal(prefetched.length, 4); // PARALLEL in flight
  const taken = prefetched[0];
  const mapAbort = new AbortController();
  const handed = loader({ url: taken, type: "arrayBuffer" } as never, mapAbort);
  handlers.movestart();
  for (const u of prefetched) assert.equal(controllers.get(u)?.signal.aborted, false);
  // The ones in flight answer: none started after the move.
  for (const u of prefetched) answers.get(u)?.({ data: new Uint8Array([1]) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(controllers.size, 5);
  assert.deepEqual(await handed, { data: new Uint8Array([1]) });
  // Taken over, the next one MapLibre asks while in flight follows MapLibre's abort.
  handlers.idle();
  await new Promise((r) => setTimeout(r, 350)); // REST_MS
  const later = [...controllers.keys()].filter((u) => u !== own && !prefetched.includes(u));
  const abort = new AbortController();
  void Promise.resolve(loader({ url: later[0], type: "arrayBuffer" } as never, abort)).catch(
    () => {},
  );
  abort.abort();
  assert.equal(controllers.get(later[0])?.signal.aborted, true);
});

test("a tile asked again is given from memory, a copy each time; the least recently asked go first", async () => {
  let loads = 0;
  const load = (params: { url: string }) => {
    loads++;
    const size = params.url.endsWith("/900") ? SERVED_BYTES / 2 + 1 : 3;
    return Promise.resolve({ data: new Uint8Array(size).fill(7), cacheControl: "max-age=60" });
  };
  const { loader } = prefetching(load as never);
  const ask = (url: string) =>
    Promise.resolve(
      loader({ url, type: "arrayBuffer" } as never, new AbortController()),
    ) as Promise<{ data: Uint8Array; cacheControl?: string }>;
  const tile = "pmtiles://http://x/basemap.pmtiles/15/1/2";
  const first = await ask(tile);
  // MapLibre transfers the bytes to a worker: the kept ones are not those.
  first.data.fill(0);
  const second = await ask(tile);
  assert.equal(loads, 1);
  assert.deepEqual(second, { data: new Uint8Array(3).fill(7), cacheControl: "max-age=60" });
  assert.notEqual(second.data.buffer, first.data.buffer);
  // Two big tiles past the budget: the oldest goes, the tile asked since stays.
  await ask("pmtiles://http://x/basemap.pmtiles/15/1/900");
  await ask(tile);
  await ask("pmtiles://http://x/basemap.pmtiles/15/2/900");
  await ask(tile);
  assert.equal(loads, 3);
  await ask("pmtiles://http://x/basemap.pmtiles/15/2/900");
  assert.equal(loads, 3);
  await ask("pmtiles://http://x/basemap.pmtiles/15/1/900");
  assert.equal(loads, 4);
});
