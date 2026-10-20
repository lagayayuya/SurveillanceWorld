// The device position while "Me localiser" is on, in two phases (lot M, 2026-10-17: the map
// took 5 to 7 s to come to the user on an entry-level phone):
//   fast     one getCurrentPosition without high accuracy, a cached position accepted if
//            young (FAST): whatever the phone knows at once (Wi-Fi, cell, a recent fix), so
//            that the map moves without waiting for the satellites;
//   precise  the watchPosition with high accuracy, as before (PRECISE): it refines the fast
//            fix, then follows. A fast fix coming after a precise one is dropped.
// Both start together on the tap (one permission prompt). The fast request carries the
// maximum wait (MAX_WAIT_MS): with no fix of either kind by then, the tracker stops and
// says why (error 3). The W3C Geolocation API (§7.2, `timeout`) leaves the time spent on
// the permission prompt out of that wait, which a timer started on the tap would not.
// The last fix is kept in memory only, never stored nor sent. No DOM here (the browser
// part is position.ts): tests drive it with a fake geolocation.

export type Fix = {
  lngLat: [number, number];
  /** Radius in metres the phone reports (95 % confidence on iOS). */
  accuracy: number;
  /** performance.now() when it was measured (a cached fix is older than its arrival). */
  at: number;
  /** From the fast request (no high accuracy). */
  coarse: boolean;
};

/** The longest wait for a first position, from the permission granted. A network fix
 * usually takes a second or two (hypothesis, not measured on a phone); past this, staying
 * on « Localisation… » says nothing more, and the tap can be tried again. */
export const MAX_WAIT_MS = 15_000;

/** The fast request: a cached position up to 15 s old — at a walk (1.4 m/s) about 20 m, less
 * than a Wi-Fi fix's own radius. */
export const FAST: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 15_000,
  timeout: MAX_WAIT_MS,
};
export const PRECISE: PositionOptions = { enableHighAccuracy: true, maximumAge: 0 };

const TIMEOUT = 3;
const DENIED = 1;
const UNAVAILABLE = 2;

/** What the tracker needs of the browser (position.ts gives the real one). */
export type TrackerEnv = {
  geolocation: Pick<Geolocation, "getCurrentPosition" | "watchPosition" | "clearWatch"> | null;
  /** performance.now() */
  now(): number;
  /** Date.now(): a position's timestamp is in that clock. */
  epoch(): number;
  log(text: string): void;
  /** Once per start (position.ts: the permission's state, for ?debug=1). */
  started(): void;
  later(fn: () => void, ms: number): number;
  cancel(id: number): void;
  /** Called on every visibility change of the page, with `hidden`. */
  onVisibility(fn: (hidden: boolean) => void): void;
};

type Listener = () => void;

export class Tracker {
  /** "Me localiser" is on (even while the page is hidden and the watch paused). */
  on = false;
  fix: Fix | null = null;
  /** The last error code (1 refused, 2 unavailable, 3 no position within MAX_WAIT_MS). */
  error: number | null = null;
  private watch: number | null = null;
  /** Bumped at each begin and stop: a fast answer of an older start is ignored. */
  private run = 0;
  /** The backstop when the fast request failed before its wait (unavailable). */
  private backstop: number | null = null;
  private listeners = new Set<Listener>();
  private visibility = false;

  private env: TrackerEnv;

  constructor(env: TrackerEnv) {
    this.env = env;
  }

  /** Listen to every change (a fix, on, off, an error); returns the undo. */
  listen(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  /** On, with no position yet: « Localisation… ». */
  get waiting(): boolean {
    return this.on && this.fix === null;
  }

  /** false: no geolocation in this browser. */
  start(): boolean {
    if (!this.env.geolocation) return false;
    if (this.on) return true;
    if (!this.visibility) {
      this.visibility = true;
      this.env.onVisibility((hidden) => this.visible(!hidden));
    }
    this.on = true;
    this.error = null;
    this.begin();
    this.env.started();
    this.emit();
    return true;
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.clear();
    this.fix = null;
    this.emit();
  }

  private visible(shown: boolean): void {
    if (!this.on) return;
    if (!shown) {
      this.clear();
      this.env.log("position: paused (page hidden)");
    } else if (this.watch === null) {
      this.begin();
      this.env.log("position: resumed");
    }
  }

  private begin(): void {
    const geo = this.env.geolocation;
    if (!geo) return;
    const run = ++this.run;
    // The fast request only while there is no fix (a resume keeps the last one shown).
    if (!this.fix) {
      geo.getCurrentPosition(
        (pos) => run === this.run && this.take(pos, true),
        (err) => run === this.run && this.fastFailed(err.code),
        FAST,
      );
    }
    this.watch = geo.watchPosition(
      (pos) => this.take(pos, false),
      (err) => {
        this.error = err.code;
        this.env.log(`position: error ${err.code}`);
        // Refused: nothing more will come. Unavailable: the watch goes on (the fast
        // request's wait, or the backstop, bounds the wait for a first fix).
        if (err.code === DENIED) this.stop();
        else this.emit();
      },
      PRECISE,
    );
  }

  private take(pos: GeolocationPosition, coarse: boolean): void {
    if (coarse && this.fix && !this.fix.coarse) return;
    const now = this.env.now();
    const age = Math.max(0, this.env.epoch() - pos.timestamp);
    this.error = null;
    this.stopBackstop();
    this.fix = {
      lngLat: [pos.coords.longitude, pos.coords.latitude],
      accuracy: pos.coords.accuracy,
      at: now - age,
      coarse,
    };
    this.emit();
  }

  private fastFailed(code: number): void {
    this.env.log(`position: fast request error ${code}`);
    if (this.fix) return;
    if (code === DENIED) {
      this.error = code;
      this.stop();
    } else if (code === TIMEOUT) {
      this.giveUp();
    } else if (code === UNAVAILABLE && this.backstop === null) {
      // Failed before its wait (no network position): the precise watch gets the rest.
      this.backstop = this.env.later(() => {
        this.backstop = null;
        if (this.on && !this.fix) this.giveUp();
      }, MAX_WAIT_MS);
    }
  }

  private giveUp(): void {
    this.env.log("position: no fix within the wait");
    // Set before stop, which emits: the listeners see off with error 3.
    this.error = TIMEOUT;
    this.stop();
  }

  private stopBackstop(): void {
    if (this.backstop !== null) this.env.cancel(this.backstop);
    this.backstop = null;
  }

  private clear(): void {
    this.run++;
    this.stopBackstop();
    if (this.watch !== null) this.env.geolocation?.clearWatch(this.watch);
    this.watch = null;
  }

  /** Age of the last fix in seconds, null without one. */
  age(): number | null {
    return this.fix ? (this.env.now() - this.fix.at) / 1000 : null;
  }

  /** For ?debug=1: where the position comes from, how precise, how old; never where. */
  describe(): string {
    if (!this.on) return "none (Me localiser off)";
    if (!this.fix) return `watch, no fix yet${this.error ? ` (error ${this.error})` : ""}`;
    const kind = this.fix.coarse ? "fast" : "watch";
    return `${kind} ±${Math.round(this.fix.accuracy)} m, ${Math.round(this.age() ?? 0)} s old`;
  }
}

const EARTH_M = 6_371_008.8;

export function metresBetween(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/** A new fix is worth moving the map when it lies farther from where the map puts the dot
 * than half its own accuracy radius, and at least 5 m: inside that, the shift is the
 * position's own noise (a fine fix landing inside the coarse one's circle, a standing
 * phone's jitter), and at street zoom (z16, ~0.8 m per pixel) 5 m is a few pixels. */
export const REFINE_FLOOR_M = 5;
export function worthMoving(shown: [number, number], fix: Fix): boolean {
  return metresBetween(shown, fix.lngLat) > Math.max(REFINE_FLOOR_M, fix.accuracy / 2);
}
