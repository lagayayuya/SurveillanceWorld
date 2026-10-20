// "Me localiser"'s position (src/tracker.ts): a fast coarse request and the high-accuracy
// watch start together on the tap; the first answer is the fix, a coarse one never replaces
// a precise one; no fix within the wait stops it with error 3 (the API's own timeout, which
// leaves the permission prompt out); a refusal stops it; the fast request of an earlier
// start is ignored. And when a new fix is worth moving the map.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FAST,
  type Fix,
  MAX_WAIT_MS,
  PRECISE,
  Tracker,
  type TrackerEnv,
  worthMoving,
} from "../src/tracker.ts";

type Ok = (p: GeolocationPosition) => void;
type Ko = (e: GeolocationPositionError) => void;

/** A fake geolocation: every request is kept, answered by the test. */
function fake() {
  const clock = { now: 1000, epoch: 1_700_000_000_000 };
  const fast: { ok: Ok; ko: Ko; opts?: PositionOptions }[] = [];
  const watches = new Map<number, { ok: Ok; ko: Ko; opts?: PositionOptions }>();
  const timers = new Map<number, () => void>();
  let ids = 0;
  const env: TrackerEnv = {
    geolocation: {
      getCurrentPosition: (ok, ko, opts) => {
        fast.push({ ok, ko: ko as Ko, opts });
      },
      watchPosition: (ok, ko, opts) => {
        watches.set(++ids, { ok, ko: ko as Ko, opts });
        return ids;
      },
      clearWatch: (id) => {
        watches.delete(id);
      },
    },
    now: () => clock.now,
    epoch: () => clock.epoch,
    log: () => {},
    started: () => {},
    later: (fn) => {
      timers.set(++ids, fn);
      return ids;
    },
    cancel: (id) => {
      timers.delete(id);
    },
    onVisibility: () => {},
  };
  const pos = (lng: number, lat: number, accuracy: number, ageMs = 0) =>
    ({
      coords: { longitude: lng, latitude: lat, accuracy },
      timestamp: clock.epoch - ageMs,
    }) as GeolocationPosition;
  const err = (code: number) =>
    ({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError;
  const watch = () => [...watches.values()][0];
  return { env, clock, fast, watches, watch, timers, pos, err };
}

function started() {
  const f = fake();
  const tr = new Tracker(f.env);
  const seen: string[] = [];
  tr.listen(() => seen.push(`${tr.on ? "on" : "off"}:${tr.fix ? (tr.fix.coarse ? "coarse" : "precise") : "none"}:${tr.error ?? ""}`));
  assert.equal(tr.start(), true);
  return { f, tr, seen };
}

test("a tap starts a fast coarse request and the high-accuracy watch together", () => {
  const { f, tr } = started();
  assert.equal(f.fast.length, 1);
  assert.equal(f.watches.size, 1);
  assert.deepEqual(f.fast[0].opts, FAST);
  assert.equal(FAST.enableHighAccuracy, false);
  assert.equal(FAST.timeout, MAX_WAIT_MS);
  assert.ok((FAST.maximumAge ?? 0) > 0, "the fast request accepts a young cached position");
  assert.deepEqual(f.watch().opts, PRECISE);
  assert.equal(PRECISE.enableHighAccuracy, true);
  assert.equal(tr.waiting, true, "« Localisation… » until a fix");
});

test("the coarse fix comes first, the precise one refines it", () => {
  const { f, tr, seen } = started();
  f.fast[0].ok(f.pos(2.35, 48.85, 65));
  assert.equal(tr.waiting, false);
  assert.equal(tr.fix?.coarse, true);
  assert.equal(tr.fix?.accuracy, 65);
  f.watch().ok(f.pos(2.3502, 48.8501, 8));
  assert.equal(tr.fix?.coarse, false);
  assert.deepEqual(tr.fix?.lngLat, [2.3502, 48.8501]);
  assert.deepEqual(seen, ["on:none:", "on:coarse:", "on:precise:"]);
});

test("a coarse fix arriving after a precise one is dropped", () => {
  const { f, tr, seen } = started();
  f.watch().ok(f.pos(2.3502, 48.8501, 8));
  f.fast[0].ok(f.pos(2.35, 48.85, 65));
  assert.equal(tr.fix?.coarse, false);
  assert.equal(tr.fix?.accuracy, 8);
  assert.deepEqual(seen, ["on:none:", "on:precise:"]);
});

test("a cached fast fix keeps its true age (« on site » reads it)", () => {
  const { f, tr } = started();
  f.fast[0].ok(f.pos(2.35, 48.85, 30, 12_000));
  assert.equal(tr.age(), 12);
});

test("no fix within the wait: the tracker stops, error 3", () => {
  const { f, tr, seen } = started();
  f.fast[0].ko(f.err(3));
  assert.equal(tr.on, false);
  assert.equal(tr.error, 3);
  assert.equal(f.watches.size, 0, "the watch is cleared");
  assert.deepEqual(seen, ["on:none:", "off:none:3"]);
});

test("the fast request timing out after a precise fix changes nothing", () => {
  const { f, tr } = started();
  f.watch().ok(f.pos(2.3502, 48.8501, 8));
  f.fast[0].ko(f.err(3));
  assert.equal(tr.on, true);
  assert.equal(tr.error, null);
});

test("fast request unavailable: the watch gets the same wait, then error 3", () => {
  const { f, tr } = started();
  f.fast[0].ko(f.err(2));
  assert.equal(tr.on, true);
  assert.equal(f.timers.size, 1);
  for (const fn of f.timers.values()) fn();
  assert.equal(tr.on, false);
  assert.equal(tr.error, 3);
});

test("fast request unavailable, then a precise fix: the backstop is cancelled", () => {
  const { f, tr } = started();
  f.fast[0].ko(f.err(2));
  f.watch().ok(f.pos(2.3502, 48.8501, 8));
  assert.equal(f.timers.size, 0);
  assert.equal(tr.on, true);
});

test("refused: the tracker stops with error 1", () => {
  const { f, tr } = started();
  f.watch().ko(f.err(1));
  assert.equal(tr.on, false);
  assert.equal(tr.error, 1);
});

test("the fast answer of an earlier start is ignored", () => {
  const { f, tr } = started();
  const old = f.fast[0];
  tr.stop();
  tr.start();
  old.ok(f.pos(2.35, 48.85, 65));
  assert.equal(tr.fix, null);
  old.ko(f.err(3));
  assert.equal(tr.on, true);
});

test("a move is worth it beyond half the accuracy radius, 5 m at least", () => {
  const at: [number, number] = [2.35, 48.85];
  const fix = (dLatM: number, accuracy: number): Fix => ({
    lngLat: [2.35, 48.85 + dLatM / 111_195],
    accuracy,
    at: 0,
    coarse: false,
  });
  assert.equal(worthMoving(at, fix(3, 4)), false, "3 m: under the 5 m floor");
  assert.equal(worthMoving(at, fix(8, 4)), true, "8 m with ±4 m");
  assert.equal(worthMoving(at, fix(20, 65)), false, "20 m inside half a ±65 m circle");
  assert.equal(worthMoving(at, fix(40, 65)), true, "40 m beyond half a ±65 m circle");
});
