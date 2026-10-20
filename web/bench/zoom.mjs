// Fluidity bench: a fixed zoom path over the production build, frame times measured with
// requestAnimationFrame, with and without 4x CPU throttling, cold then warm tile cache.
// Chromium runs without the frame-rate limit and GPU vsync, so frame times are not
// clamped to 16.7 ms; long tasks (> 50 ms on the main thread) are recorded too.
// Also checks that some surveillance layer is visible at every half zoom level.
//   node bench/zoom.mjs [--region idf] [--label name] [--headed]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const region = args.includes("--region") ? args[args.indexOf("--region") + 1] : "idf";
const headed = args.includes("--headed");
// A label keeps a run apart (e.g. a baseline before a change): qa/out/<region>/bench/<label>/.
const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "";
const out = new URL(`../../qa/out/${region}/bench/${label ? `${label}/` : ""}`, import.meta.url)
  .pathname;
mkdirSync(out, { recursive: true });

const PORT = 4173;
const APP = `http://localhost:${PORT}/`;
const PARIS = [2.3488, 48.8534];
const STREET = [2.3485, 48.8597]; // Châtelet
// Layers absent from a build (an older one) are skipped.
const SURVEILLANCE = [
  "deps",
  "deps-none",
  "communes",
  "communes-none",
  "streets",
  "streets-unfilmed",
  "portions",
  "bands",
  "cameras",
];

// The path: région -> city -> district -> street -> back out. Each leg is a MapLibre flyTo.
const LEGS = [
  { center: PARIS, zoom: 7, duration: 0 },
  { center: PARIS, zoom: 10, duration: 3000 },
  { center: PARIS, zoom: 13, duration: 4000 },
  { center: STREET, zoom: 15, duration: 5000 },
  { center: STREET, zoom: 18, duration: 4000 },
  { center: STREET, zoom: 20, duration: 2000 },
  { center: PARIS, zoom: 12, duration: 6000 },
  { center: PARIS, zoom: 10, duration: 3000 },
];

function stats(frames) {
  const s = [...frames].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    frames: s.length,
    median_ms: +q(0.5).toFixed(1),
    p95_ms: +q(0.95).toFixed(1),
    p99_ms: +q(0.99).toFixed(1),
    max_ms: +s[s.length - 1].toFixed(1),
    over_50ms: s.filter((f) => f > 50).length,
  };
}

function longTaskStats(tasks) {
  const total = tasks.reduce((a, d) => a + d, 0);
  return {
    count: tasks.length,
    total_ms: Math.round(total),
    blocking_ms: Math.round(tasks.reduce((a, d) => a + Math.max(0, d - 50), 0)),
    max_ms: Math.round(tasks.length ? Math.max(...tasks) : 0),
  };
}

async function runPath(page) {
  return page.evaluate(async (legs) => {
    const map = window.__map;
    const frames = [];
    const longTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push(e.duration);
    });
    observer.observe({ type: "longtask" });
    let last = performance.now();
    let running = true;
    const tick = (t) => {
      frames.push(t - last);
      last = t;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (const leg of legs) {
      if (leg.duration === 0) {
        map.jumpTo({ center: leg.center, zoom: leg.zoom });
        await new Promise((r) => map.once("idle", r));
        frames.length = 0;
        longTasks.length = 0;
        last = performance.now();
        continue;
      }
      await new Promise((r) => {
        map.once("moveend", r);
        map.flyTo({ center: leg.center, zoom: leg.zoom, duration: leg.duration, essential: true });
      });
    }
    await new Promise((r) => map.once("idle", r));
    running = false;
    observer.disconnect();
    return { frames: frames.slice(1), longTasks };
  }, LEGS);
}

async function coverage(page) {
  // Every half zoom from 5 to 20 on the street point: something from the surveillance
  // layers must be rendered, and we keep a screenshot for the report.
  const rows = [];
  for (let z = 5; z <= 20; z += 0.5) {
    const n = await page.evaluate(
      async ({ z, center, layers }) => {
        const map = window.__map;
        map.jumpTo({ center, zoom: z });
        await new Promise((r) => map.once("idle", r));
        return map.queryRenderedFeatures({ layers: layers.filter((id) => map.getLayer(id)) })
          .length;
      },
      { z, center: STREET, layers: SURVEILLANCE },
    );
    await page.screenshot({ path: `${out}z${z.toFixed(1)}.png` });
    rows.push({ zoom: z, surveillance_features: n });
  }
  return rows;
}

async function main() {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({
    headless: !headed,
    args: [
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--use-angle=metal",
      "--disable-frame-rate-limit",
      "--disable-gpu-vsync",
    ],
  });
  const result = { region, label, headed, date: new Date().toISOString(), runs: {} };
  try {
    for (const throttle of [1, 4]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const errors = [];
      page.on("console", async (m) => {
        if (m.type() !== "error") return;
        const loc = m.location();
        const detail = await Promise.all(m.args().map((a) => a.jsonValue().catch(() => "?")));
        errors.push({ text: m.text(), at: `${loc.url}:${loc.lineNumber}`, args: detail });
      });
      page.on("pageerror", (e) => errors.push({ text: String(e), stack: e.stack }));
      const failed = [];
      page.on("requestfailed", (r) =>
        failed.push({ url: r.url(), range: r.headers().range, why: r.failure()?.errorText }),
      );
      const cdp = await context.newCDPSession(page);
      await page.goto(`${APP}#10/${PARIS[1]}/${PARIS[0]}`);
      await page.waitForFunction(() => window.__map?.loaded());
      await page.evaluate(() => {
        window.__mapErrors = [];
        window.__loadedTiles = [];
        // Which tiles loaded, and when: tells whether an errored tile was abandoned or
        // re-requested and loaded afterwards.
        window.__map.on("data", (e) => {
          if (e.dataType === "source" && e.tile?.state === "loaded") {
            window.__loadedTiles.push({ key: e.tile.tileID.key, t: performance.now() });
          }
        });
        window.__map.on("error", (e) =>
          window.__mapErrors.push({
            message: e.error?.message,
            name: e.error?.name,
            status: e.error?.status,
            url: e.error?.url,
            source: e.sourceId,
            zoom: window.__map.getZoom().toFixed(2),
            phase: window.__phase,
            t: Math.round(performance.now()),
            tile: e.tile?.tileID?.canonical ? JSON.stringify(e.tile.tileID.canonical) : undefined,
            key: e.tile?.tileID?.key,
            tileState: e.tile?.state,
            aborted: e.tile?.aborted,
            stillWanted: e.tile
              ? Boolean(
                  window.__map.style.tileManagers?.[e.sourceId]?.getTileByID?.(e.tile.tileID.key),
                )
              : undefined,
            stack: String(e.error?.stack ?? "")
              .split("\n")
              .slice(0, 4)
              .join(" | "),
          }),
        );
      });
      result.renderer ??= await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        const ext = gl?.getExtension("WEBGL_debug_renderer_info");
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
      await page.evaluate(() => {
        window.__phase = "cold";
      });
      const coldRun = await runPath(page);
      const cold = { ...stats(coldRun.frames), long_tasks: longTaskStats(coldRun.longTasks) };
      await page.evaluate(() => {
        window.__phase = "warm";
      });
      const warmRun = await runPath(page);
      const warm = { ...stats(warmRun.frames), long_tasks: longTaskStats(warmRun.longTasks) };
      await page.evaluate(() => {
        window.__phase = "coverage";
      });
      const bytes = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .filter((e) => e.name.includes(".pmtiles"))
          .reduce((a, e) => ({ n: a.n + 1, kib: a.kib + e.transferSize / 1024 }), { n: 0, kib: 0 }),
      );
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const cov = throttle === 1 ? await coverage(page) : undefined;
      const mapErrors = await page.evaluate(() =>
        window.__mapErrors.map((err) => ({
          ...err,
          loadedLater: window.__loadedTiles.some((l) => l.key === err.key && l.t > err.t),
        })),
      );
      result.runs[`cpu_x${throttle}`] = {
        cold,
        warm,
        tile_requests: bytes.n,
        tile_kib: Math.round(bytes.kib),
        console_errors: errors,
        map_errors: mapErrors,
        tile_retries: await page.evaluate(() => window.__tileRetries ?? 0),
        failed_requests: failed,
        coverage: cov,
      };
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  writeFileSync(`${out}bench.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, (k, v) => (k === "coverage" ? undefined : v), 2));
}

main();
