// « Me localiser » measured (lot M, 2026-10-17: 5 to 7 s on an entry-level phone), on the
// production build of the CI extract (DIST, or LACARTE_DIST), punk, in Chromium with the
// network and the CPU throttled (profiles.mjs: phone4g with --cpu 4 is the « ×4 » phone,
// lowend the « ×6 » one). The map starts at z13 a kilometre from the position; per run,
// from the tap (the pointer event's own time):
//   feedback_ms   the button changed (its text, its attributes), and feedback_paint_ms the
//                 frame after it;
//   moved_ms      the map's first move;
//   first_move    that move's duration, the zoom it ended at, whether another move
//                 interrupted it (a moveend while short of the target zoom);
//   landed_ms     the first move's end, landed_idle_ms the map idle after it (tiles drawn);
//   settled_ms    the last move's end, idle_ms the map idle after it;
//   moves         every move start in the window (a fix that moved the map).
// --gps instant (the default): Playwright's emulated position answers every request at once
// (context.setGeolocation), with or without high accuracy: the bench sees the page's own
// time and the animation, never a phone's wait for its satellites. After the landing, the
// position moves 30 m (±10 m), then 3 m: how far the map's centre goes each time (refine
// worth a move, or noise left alone).
// --gps model: a stand-in geolocation (init script) answering a request without high
// accuracy after --coarse ms (default 500, ±65 m, 40 m off) and one with high accuracy
// after --precise ms (default 5000, ±8 m), then every second: a MODEL of a phone, its
// delays assumed, not measured; it shows what the code does with two answers of different
// speeds, not a phone's figures.
//   node bench/locate.mjs [--profile phone4g|lowend] [--cpu N] [--gps instant|model]
//     [--runs 3] [--port 4480] [--out file.json] [--coarse 500] [--precise 5000]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium, devices } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { conditions, PHONE_PROFILES } from "./profiles.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const profile = arg("--profile", "phone4g");
const P = PHONE_PROFILES[profile];
const CPU = Number(arg("--cpu", String(P.cpu)));
const gps = arg("--gps", "instant");
const RUNS = Number(arg("--runs", "3"));
const PORT = Number(arg("--port", "4480"));
const out = arg("--out", null);
const COARSE = Number(arg("--coarse", "500"));
const PRECISE = Number(arg("--precise", "5000"));
const APP = `http://localhost:${PORT}/`;
// La Défense (the CI extract); the map starts 1 km west-south-west, at z13: in view.
const ME = { latitude: 48.8977, longitude: 2.2377, accuracy: 20 };
const START = "#13/48.8935/2.2255";
// After the landing (instant only): 30 m north, then 3 m further.
const metresNorth = (m) => m / 111_195;

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
process.on("exit", () => server.kill());
for (let i = 0; ; i++) {
  try {
    await fetch(APP);
    break;
  } catch {
    if (i > 60) throw new Error("vite preview did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist"] });

/** The stand-in geolocation of --gps model, in the page before its scripts. */
function model([me, coarseMs, preciseMs]) {
  // The coarse answer 40 m south of the precise one (±65 m, a Wi-Fi fix): the precise one
  // lies outside half its circle, a refine worth a move.
  const pos = (accuracy) => ({
    coords: {
      latitude: me.latitude - (accuracy > 30 ? 40 / 111_195 : 0),
      longitude: me.longitude,
      accuracy,
    },
    timestamp: Date.now(),
  });
  const timers = new Map();
  let ids = 0;
  window.__gpsAsked = [];
  const geo = {
    getCurrentPosition(ok, _ko, opts = {}) {
      window.__gpsAsked.push({
        t: performance.now(),
        how: "once",
        high: !!opts.enableHighAccuracy,
      });
      const high = !!opts.enableHighAccuracy;
      setTimeout(() => ok(pos(high ? 8 : 65)), high ? preciseMs : coarseMs);
    },
    watchPosition(ok, _ko, opts = {}) {
      const high = !!opts.enableHighAccuracy;
      window.__gpsAsked.push({ t: performance.now(), how: "watch", high });
      const id = ++ids;
      const tick = () => {
        ok(pos(high ? 8 : 65));
        timers.set(id, setTimeout(tick, 1000));
      };
      timers.set(id, setTimeout(tick, high ? preciseMs : coarseMs));
      return id;
    },
    clearWatch(id) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    },
  };
  Object.defineProperty(navigator, "geolocation", { get: () => geo, configurable: true });
}

/** In the page once the map is idle: the tap's time, the button's changes, the map's moves. */
function instrument() {
  const map = window.__map;
  const log = { tap: null, button: [], moves: [], idle: [], frames: [] };
  window.__locate = log;
  const button = document.getElementById("fab-locate");
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (log.tap === null && button.contains(e.target)) log.tap = e.timeStamp;
    },
    true,
  );
  new MutationObserver(() => {
    if (log.tap === null) return;
    const t = performance.now();
    log.button.push({ t, text: button.textContent, busy: button.getAttribute("aria-busy") });
    if (log.button.length === 1) requestAnimationFrame(() => (log.paint = performance.now()));
  }).observe(button, { attributes: true, childList: true, subtree: true, characterData: true });
  map.on("movestart", () => {
    if (log.tap !== null) log.moves.push({ start: performance.now() });
  });
  map.on("moveend", () => {
    const m = log.moves.at(-1);
    if (m && m.end === undefined) {
      m.end = performance.now();
      m.zoom = map.getZoom();
    }
  });
  map.on("idle", () => {
    if (log.tap !== null) log.idle.push(performance.now());
  });
  let last = performance.now();
  const tick = (t) => {
    if (log.tap !== null && log.moves.length) log.frames.push({ t, gap: t - last });
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function once() {
  const context = await browser.newContext({
    viewport: { width: P.width, height: P.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: devices["iPhone 14"].userAgent,
    locale: "fr-FR",
    ...(gps === "instant" ? { geolocation: ME, permissions: ["geolocation"] } : {}),
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("lacarte.ui", "punk");
      localStorage.setItem("lacarte.welcome", "1");
      localStorage.setItem("lacarte.fonts", "1");
    } catch {}
  });
  if (gps === "model") await context.addInitScript(model, [ME, COARSE, PRECISE]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", conditions(P));
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await page.goto(`${APP}${START}`);
  await page.waitForFunction(() => window.__map?.loaded() && window.__map.areTilesLoaded(), null, {
    timeout: 180000,
    polling: 200,
  });
  await page.evaluate(instrument);
  await page.locator("#fab-locate").tap();
  // The window: the landing and, under the model, the precise fix and a few after it.
  const windowMs = gps === "model" ? PRECISE + 3000 : 4000;
  await page.waitForTimeout(windowMs);
  const refine = {};
  if (gps === "instant") {
    // 30 m north (±10 m): beyond half the circle, worth a move; then 3 m: noise.
    for (const [name, m] of [
      ["30m", 30],
      ["3m_more", 33],
    ]) {
      const centre = () => page.evaluate(() => window.__map.getCenter().toArray());
      const before = await centre();
      await context.setGeolocation({ ...ME, latitude: ME.latitude + metresNorth(m), accuracy: 10 });
      await page.waitForTimeout(2500);
      const after = await centre();
      // How far the map's centre went (m): ~0 when the fix was left alone.
      const dLat = (after[1] - before[1]) * 111_195;
      const dLon = (after[0] - before[0]) * 111_195 * Math.cos((after[1] * Math.PI) / 180);
      refine[`${name}_map_moved_m`] = +Math.hypot(dLat, dLon).toFixed(1);
    }
  }
  // Idle after the last move (tiles drawn), at most 60 s more.
  await page
    .waitForFunction(
      () => {
        const l = window.__locate;
        const end = l.moves.at(-1)?.end;
        return end !== undefined && l.idle.some((t) => t >= end);
      },
      null,
      { timeout: 60000, polling: 200 },
    )
    .catch(() => {});
  const r = await page.evaluate(() => {
    const l = window.__locate;
    const rel = (t) => (t === undefined || t === null ? null : Math.round(t - l.tap));
    const first = l.moves[0];
    const last = l.moves.at(-1);
    const during = first ? l.frames.filter((f) => f.t >= first.start && f.t <= first.end) : [];
    return {
      feedback_ms: rel(l.button[0]?.t),
      feedback_paint_ms: rel(l.paint),
      feedback_text: l.button.at(0)?.text ?? null,
      busy_seen: l.button.some((b) => b.busy === "true"),
      moved_ms: rel(first?.start),
      first_move: first
        ? {
            duration_ms: Math.round(first.end - first.start),
            end_zoom: +first.zoom.toFixed(2),
            interrupted: first.zoom < 15.99,
            frames: during.length,
            max_frame_gap_ms: Math.round(Math.max(0, ...during.map((f) => f.gap))),
          }
        : null,
      landed_ms: rel(first?.end),
      // The tiles of the landing drawn (the first idle after the first move's end).
      landed_idle_ms: rel(l.idle.find((t) => t >= (first?.end ?? Infinity))),
      settled_ms: rel(last?.end),
      idle_ms: rel(l.idle.find((t) => t >= (last?.end ?? Infinity))),
      moves: l.moves.map((m) => ({
        start: rel(m.start),
        end: rel(m.end),
        zoom: +m.zoom?.toFixed(2),
      })),
      asked: window.__gpsAsked ?? null,
    };
  });
  await context.close();
  return { ...r, refine, errors };
}

const runs = [];
for (let i = 0; i < RUNS; i++) {
  runs.push(await once());
  console.error(`run ${i + 1}/${RUNS}: ${JSON.stringify(runs.at(-1))}`);
}
const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const summary = {
  feedback_ms: median(runs.map((r) => r.feedback_ms)),
  feedback_paint_ms: median(runs.map((r) => r.feedback_paint_ms)),
  moved_ms: median(runs.map((r) => r.moved_ms)),
  first_move_ms: median(runs.map((r) => r.first_move?.duration_ms)),
  first_move_interrupted: runs.filter((r) => r.first_move?.interrupted).length,
  landed_ms: median(runs.map((r) => r.landed_ms)),
  landed_idle_ms: median(runs.map((r) => r.landed_idle_ms)),
  settled_ms: median(runs.map((r) => r.settled_ms)),
  idle_ms: median(runs.map((r) => r.idle_ms)),
  moves: median(runs.map((r) => r.moves.length)),
  refine_30m_map_moved_m: median(runs.map((r) => r.refine["30m_map_moved_m"])),
  refine_3m_map_moved_m: median(runs.map((r) => r.refine["3m_more_map_moved_m"])),
};
const result = {
  dist: process.env.LACARTE_DIST ?? "web/dist",
  profile,
  cpu: CPU,
  network: conditions(P),
  gps,
  ...(gps === "model" ? { model: { coarse_ms: COARSE, precise_ms: PRECISE } } : {}),
  date: new Date().toISOString(),
  summary,
  runs,
};
await browser.close();
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ profile, cpu: CPU, gps, summary }, null, 2));
process.exit(0);
