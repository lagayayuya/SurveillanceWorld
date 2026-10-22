// Low-end measurement (an observation, not a gate): phone screen, CPU throttled x6, slow
// 4G, cold cache, on the production build. Records the time to the first useful display
// (surveillance layer drawn), frame times and long tasks over a typical visit, and the
// bytes downloaded.
//   node bench/lowend.mjs [--region idf] [--label name] [--ui classique|punk]
//     [--mode clair|sombre] [--profile lowend|phone4g] [--cpu N] [--port 4181]
//     [--at Z/LAT/LON] [--no-visit]
// --at: the first display there (default: the city at z11); --no-visit: stop after it.
// Network and CPU: profiles.mjs; `lowend` (the default) is Chrome DevTools' "Slow 4G" preset
// (devtools-frontend, NetworkManager.ts: 1.6 Mbit/s x 0.9 down, 750 kbit/s x 0.9 up,
// 150 ms x 3.75 latency) and CPU x6; `phone4g --cpu 4` the « x4 » phone. The screen stays
// this script's own (390x844 at scale 3) whatever the profile.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { conditions, PHONE_PROFILES } from "./profiles.mjs";

const args = process.argv.slice(2);
const region = args.includes("--region") ? args[args.indexOf("--region") + 1] : "idf";
requireTiles(region);
const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "lowend";
// The interface and its mode (redesign): a query string, as a link would carry it.
const query = ["ui", "mode"]
  .filter((k) => args.includes(`--${k}`))
  .map((k) => `${k}=${args[args.indexOf(`--${k}`) + 1]}`)
  .join("&");
const out = new URL(`../../qa/out/${region}/bench/${label}/`, import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const PORT = Number(arg("--port", "4181"));
const profile = arg("--profile", "lowend");
const CPU_RATE = Number(arg("--cpu", String(PHONE_PROFILES[profile].cpu)));
const NETWORK = conditions(PHONE_PROFILES[profile]);
const AT = arg("--at", null);
const VISITS = !args.includes("--no-visit");
// On the CI extract (La Défense only), the city and the street are La Défense's.
const CI = region === "ci";
const CITY = CI ? [2.2377, 48.8977] : [2.3488, 48.8534];
const STREET = CI ? [2.2377, 48.8977] : [2.3485, 48.8597]; // Châtelet
// A typical visit on a phone: the city, then the street where one lives, a camera, back out.
const VISIT = [
  { center: CITY, zoom: 11, duration: 0 },
  { center: STREET, zoom: 13, duration: 3000 },
  { center: STREET, zoom: 16, duration: 3000 },
  { center: [STREET[0] + 0.002, STREET[1]], zoom: 16, duration: 1500 },
  { center: STREET, zoom: 17.5, duration: 2000 },
  { center: STREET, zoom: 12, duration: 3000 },
];

function stats(frames) {
  const s = [...frames].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    frames: s.length,
    median_ms: +q(0.5).toFixed(1),
    p95_ms: +q(0.95).toFixed(1),
    max_ms: +s[s.length - 1].toFixed(1),
    over_50ms: s.filter((f) => f > 50).length,
  };
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  args: ["--disable-frame-rate-limit", "--disable-gpu-vsync", "--ignore-gpu-blocklist"],
});
const result = {
  region,
  date: new Date().toISOString(),
  profile,
  cpu_rate: CPU_RATE,
  network: NETWORK,
};
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", NETWORK);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
  let bytes = 0;
  let requests = 0;
  cdp.on("Network.loadingFinished", (e) => {
    bytes += e.encodedDataLength;
    requests++;
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const t0 = Date.now();
  await page.goto(
    `http://localhost:${PORT}/${query ? `?${query}` : ""}#${AT ?? `${VISIT[0].zoom}/${CITY[1]}/${CITY[0]}`}`,
  );
  await page.waitForFunction(() => window.__map?.loaded(), null, {
    timeout: 180000,
  });
  // First useful display: a surveillance layer drawn on screen (communes, départements,
  // hexagons or streets, whichever the build and zoom draw).
  await page.waitForFunction(
    () => {
      const m = window.__map;
      // cells: older builds; portions: what is filmed, since the phase "tronçons"
      const ids = [
        "communes",
        "communes-none",
        "deps",
        "deps-none",
        "cells",
        "streets",
        "portions",
      ];
      const layers = ids.filter((id) => m.getLayer(id));
      return m.queryRenderedFeatures({ layers }).length > 0;
    },
    null,
    { timeout: 180000, polling: 100 },
  );
  result.first_useful_display_ms = Date.now() - t0;
  // Idle may already have fired: wait for it only if the map is still loading.
  await page.waitForFunction(() => window.__map.loaded() && window.__map.areTilesLoaded(), null, {
    timeout: 300000,
    polling: 200,
  });
  result.first_idle_ms = Date.now() - t0;
  result.bytes_first_display_kib = Math.round(bytes / 1024);
  result.at = AT;

  const run = !VISITS
    ? null
    : await page.evaluate(async (legs) => {
        const map = window.__map;
        const frames = [];
        const longTasks = [];
        const obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) longTasks.push(e.duration);
        });
        obs.observe({ type: "longtask" });
        let last = performance.now();
        let running = true;
        const tick = (t) => {
          frames.push(t - last);
          last = t;
          if (running) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const t = performance.now();
        for (const leg of legs.slice(1)) {
          await new Promise((r) => {
            map.once("moveend", r);
            map.flyTo({
              center: leg.center,
              zoom: leg.zoom,
              duration: leg.duration,
              essential: true,
            });
          });
        }
        // Settle: wait until every tile of the last view is loaded (or give up after 2 min).
        const t1 = performance.now();
        while (!(map.loaded() && map.areTilesLoaded()) && performance.now() - t1 < 120000) {
          await new Promise((r) => setTimeout(r, 200));
        }
        running = false;
        obs.disconnect();
        return {
          frames: frames.slice(1),
          longTasks,
          visit_ms: performance.now() - t,
        };
      }, VISIT);
  result.visit = run && {
    ...stats(run.frames),
    visit_ms: Math.round(run.visit_ms),
    long_tasks: {
      count: run.longTasks.length,
      total_ms: Math.round(run.longTasks.reduce((a, d) => a + d, 0)),
      max_ms: Math.round(run.longTasks.length ? Math.max(...run.longTasks) : 0),
    },
  };
  result.bytes_total_kib = Math.round(bytes / 1024);
  result.requests = requests;
  result.page_errors = errors;
  await page.screenshot({ path: `${out}end.png` });
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(`${out}lowend.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
