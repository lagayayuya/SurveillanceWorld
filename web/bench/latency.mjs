// Street latency while walking the map (the author's point 7 of 2026-10-12): the production
// build (web/dist, the region linked in web/public), punk, a fixed walk of pans at street
// zoom then a zoom in and out, under a throttled network. For each step: the time from the
// gesture's start until the streets' source (our exposure lines) and the basemap's
// (protomaps: its roads and names) have every tile of the view, the Range requests made per
// archive and their bytes, and the requests a zoom left unfinished. Chromium is throttled
// through the DevTools protocol (Network.emulateNetworkConditions: latency, bandwidth);
// Playwright cannot throttle WebKit, so WebKit gets the latency alone, added to every tile
// request by a route (no bandwidth limit: its numbers are a floor). The local server
// (vite preview) answers in about a millisecond: the network figures are the emulated ones.
//   node bench/latency.mjs [--browser chromium|webkit] [--profile desktop|phone4g|lowend]
//                          [--port 4199] [--dwell 1500] [--out file.json] [--check]
//                          [--cpu N]
// lowend (CPU ×6 and DevTools' « Slow 4G », profiles.mjs) throttles the CPU too, in Chromium.
// --check (the gate): the prefetch fetched a ring while the map rested, and the pans after
// the first needed no street tile (prefetched): « ok » / « FAIL » lines, exit 1 on a FAIL.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { DIST, preview, WEB } from "./dist.mjs";
import { conditions, PHONE_PROFILES } from "./profiles.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const engine = arg("--browser", "chromium");
const profile = arg("--profile", "desktop");
const PORT = Number(arg("--port", "4199"));
const out = arg("--out", null);
// The pause after each step, as someone looking at the map (the prefetch's time).
const DWELL = Number(arg("--dwell", "1500"));
const APP = `http://localhost:${PORT}/`;

/** The networks: a desktop on a home line; the phones (phone4g, lowend) in profiles.mjs. */
const PROFILES = {
  desktop: { width: 1280, height: 800, phone: false, latency: 40, down: 50e6 / 8, up: 10e6 / 8 },
  none: { width: 1280, height: 800, phone: false, latency: 0, down: -1, up: -1 },
  ...PHONE_PROFILES,
};
const P = PROFILES[profile];
const CPU = Number(arg("--cpu", String(P.cpu ?? 1)));

// Paris, a dense street (rue de Rivoli by the Hôtel de Ville): the heaviest tiles; on the
// CI extract (the gate), La Défense.
const served = JSON.parse(readFileSync(resolve(DIST, "tiles/meta.json"), "utf8")).build_id;
const START = served.startsWith("ci-")
  ? { center: [2.2377, 48.8977], zoom: 15.5 }
  : { center: [2.3522, 48.8566], zoom: 15.5 };

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);
for (let i = 0; ; i++) {
  try {
    await fetch(APP);
    break;
  } catch {
    if (i > 60) throw new Error("vite preview did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
}

// The GPU as zoom.mjs has it: headless Chromium otherwise renders in software and the
// drawing, not the network, sets the times.
const browser = await (engine === "webkit" ? webkit : chromium).launch(
  engine === "chromium" ? { args: ["--enable-gpu", "--ignore-gpu-blocklist"] } : {},
);
const context = await browser.newContext({
  viewport: { width: P.width, height: P.height },
  deviceScaleFactor: 2,
  ...(P.phone && engine === "webkit"
    ? { isMobile: true, hasTouch: true, userAgent: devices["iPhone 14"].userAgent }
    : {}),
  locale: "fr-FR",
});
await context.addInitScript(() => {
  try {
    localStorage.setItem("lacarte.welcome", "1");
    localStorage.setItem("lacarte.fonts", "1");
    // The prefetch, off in a browser driven by tests (src/prefetch.ts wanted), measured here.
    localStorage.setItem("lacarte.prefetch", "1");
  } catch {}
});
const page = await context.newPage();

// Every Range request to an archive, with its size and timing (Resource Timing in the page
// would miss aborted ones: the responses are counted here).
const log = [];
page.on("requestfinished", async (req) => {
  const url = req.url();
  if (!url.endsWith(".pmtiles")) return;
  const sizes = await req.sizes().catch(() => null);
  log.push({
    t: Date.now(),
    start: req.timing().startTime,
    archive: url.split("/").pop(),
    bytes: sizes ? sizes.responseBodySize : 0,
    ms: req.timing().responseEnd,
  });
});
let failed = 0;
page.on("requestfailed", (req) => {
  if (req.url().endsWith(".pmtiles")) failed++;
});

if (engine === "chromium") {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", conditions(P));
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
} else {
  await page.route(/\.pmtiles$/, async (route) => {
    await new Promise((r) => setTimeout(r, P.latency));
    await route.fallback();
  });
}

const t0 = Date.now();
await page.goto(`${APP}#${START.zoom}/${START.center[1]}/${START.center[0]}`, {
  waitUntil: "load",
});
await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 120000 });
const firstLoad = Date.now() - t0;

/** Run `gesture` in the page, then wait until both sources have every tile of the view;
 * the time from the gesture's start to each source's completion. */
async function step(name, gesture) {
  const from = log.length;
  const began = Date.now();
  const failedBefore = failed;
  const r = await page.evaluate(async (g) => {
    const map = window.__map;
    const start = performance.now();
    const done = {};
    const watch = () =>
      new Promise((resolve) => {
        const tick = () => {
          for (const s of ["streets", "protomaps"])
            if (done[s] === undefined && !map.isMoving() && map.isSourceLoaded(s))
              done[s] = Math.round(performance.now() - start);
          if (done.streets !== undefined && done.protomaps !== undefined) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    if (g.kind === "pan") map.panBy(g.by, { duration: 300 });
    else map.easeTo({ zoom: g.zoom, duration: g.duration });
    await watch();
    return { ...done, moving_ms: g.kind === "pan" ? 300 : g.duration };
  }, gesture);
  await page.waitForTimeout(150);
  const reqs = log.slice(from);
  const atRest = log.length;
  await page.waitForTimeout(DWELL);
  const rested = log.slice(atRest);
  const by = {};
  for (const q of reqs) {
    by[q.archive] ??= { n: 0, kb: 0 };
    by[q.archive].n++;
    by[q.archive].kb += q.bytes / 1024;
  }
  for (const v of Object.values(by)) v.kb = Math.round(v.kb);
  const last = reqs.length ? Math.max(...reqs.map((q) => q.t)) - began : 0;
  return {
    step: name,
    last_response_ms: last,
    streets_ms: r.streets,
    basemap_ms: r.protomaps,
    requests: by,
    aborted: failed - failedBefore,
    // Fetched while the map rested afterwards (the prefetched ring, in punk).
    at_rest: { n: rested.length, kb: Math.round(rested.reduce((a, q) => a + q.bytes, 0) / 1024) },
  };
}

const W = P.width;
const steps = [];
steps.push(await step("pan east 60%", { kind: "pan", by: [0.6 * W, 0] }));
steps.push(await step("pan east 60%", { kind: "pan", by: [0.6 * W, 0] }));
steps.push(await step("pan south 60%", { kind: "pan", by: [0, 0.6 * P.height] }));
steps.push(await step("pan west 60%", { kind: "pan", by: [-0.6 * W, 0] }));
steps.push(await step("pan back north (seen)", { kind: "pan", by: [0, -0.6 * P.height] }));
steps.push(await step("zoom in to 17", { kind: "zoom", zoom: 17, duration: 600 }));
steps.push(await step("zoom out to 14", { kind: "zoom", zoom: 14, duration: 600 }));
steps.push(await step("zoom in to 16 fast", { kind: "zoom", zoom: 16, duration: 250 }));

const result = { engine, profile, network: P, cpu: CPU, first_load_ms: firstLoad, steps };
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
let checkFailed = false;
if (args.includes("--check")) {
  const pans = steps.filter((s) => s.step.startsWith("pan") && !s.step.includes("seen"));
  const rested = steps.reduce((a, s) => a + s.at_rest.n, 0);
  const streets = pans.slice(1).map((s) => s.requests["streets.pmtiles"]?.n ?? 0);
  const said = (ok, name, detail) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
    checkFailed ||= !ok;
  };
  said(rested > 0, "the map at rest fetches the ring around the view", JSON.stringify(steps));
  said(
    streets.every((n) => n === 0),
    "the pans after the first ask no street tile (prefetched)",
    JSON.stringify(streets),
  );
} else console.log(JSON.stringify(result, null, 1));
await browser.close();
stop();
process.exit(checkFailed ? 1 : 0);
