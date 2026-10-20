// What a zoom costs, on a served site (the live one, or a local build): from z13 to z17 at a
// place, one zoom level at a time as a scroll or a pinch would, with the network, the
// tiles' loading and the screen apart (lot P, 2026-10-17: « after a zoom the screen stays
// black a few seconds »). Per step:
//   - every Range request to an archive: its time to first byte (TTFB), its duration, its
//     bytes (Playwright's request timing: the network);
//   - when each source had every tile of the view (MapLibre's `data` events per tile) and
//     when the map went idle: what follows the network (decoding in the workers, layout,
//     drawing);
//   - with --shots, the screen every ~100 ms against the settled frame: the share of the
//     screen still missing (a pixel that differs from the settled one by more than a few
//     levels), its peak after the animation, and when it falls under 50 % and 10 %;
//   - the frames' longest gap (requestAnimationFrame), and any WebGL context loss;
//   - the zoom's own bytes apart from the prefetch's (prefetch.ts: the ring of tiles around
//     the view, fetched once the map has rested 300 ms): a request started before the map
//     went idle is the zoom's, one started after is the ring's (`prefetch`). The next step
//     waits for the network to be quiet, so that no ring is counted in the next zoom.
//   node bench/zoomblank.mjs --url https://<host>/ [--browser chromium|webkit]
//        [--profile desktop|phone4g|lowend|none] [--cpu 4] [--scheme dark|light]
//        [--place bercy|chatelet] [--steps 14,15,16,17] [--duration 500] [--shots]
//        [--out file.json] [--no-prefetch]
// Chromium is throttled through the DevTools protocol; WebKit cannot be (Playwright): its
// figures are the network as it is.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, devices, webkit } from "playwright";
import { PHONE_PROFILES } from "./profiles.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const URL0 = arg("--url", null);
if (!URL0) throw new Error("--url https://<host>/ (or a local build)");
const engine = arg("--browser", "chromium");
const profile = arg("--profile", "desktop");
const scheme = arg("--scheme", "dark");
const placeName = arg("--place", "bercy");
const shots = args.includes("--shots");
const out = arg("--out", null);
// Without the ring (as a browser driven by tests: prefetch.ts wanted()).
const prefetchOn = !args.includes("--no-prefetch");
// With --frames DIR, the step's frames are written there (step-<z>-<ms>.jpg).
const framesDir = arg("--frames", null);

const PROFILES = {
  none: { width: 1280, height: 800, phone: false },
  desktop: { width: 1280, height: 800, phone: false },
  // phone4g, lowend (CPU ×6 and « Slow 4G »): profiles.mjs.
  ...PHONE_PROFILES,
};
const P = PROFILES[profile];
// --cpu overrides the profile's own (lowend: 6).
const CPU = Number(arg("--cpu", String(P.cpu ?? 1)));
const PLACES = { bercy: [2.39018, 48.82509], chatelet: [2.347, 48.8606] };
const at = PLACES[placeName];
// The zooms, one after the other from z13 (--steps 17,13: a jump in, then out).
const STEPS = arg("--steps", "14,15,16,17").split(",").map(Number);
const DURATION = Number(arg("--duration", "500"));

const browser = await (engine === "webkit" ? webkit : chromium).launch(
  engine === "chromium" ? { args: ["--enable-gpu", "--ignore-gpu-blocklist"] } : {},
);
const context = await browser.newContext({
  viewport: { width: P.width, height: P.height },
  deviceScaleFactor: 2,
  colorScheme: scheme,
  ...(P.phone ? { isMobile: true, hasTouch: true, userAgent: devices["iPhone 14"].userAgent } : {}),
  locale: "fr-FR",
});
await context.addInitScript((prefetchOn) => {
  try {
    localStorage.setItem("lacarte.welcome", "1");
    if (prefetchOn) localStorage.setItem("lacarte.prefetch", "1");
  } catch {}
  // A lost WebGL context, however it comes.
  window.__lost = [];
  const watch = () => {
    for (const c of document.querySelectorAll("canvas"))
      if (!c.__watched) {
        c.__watched = true;
        c.addEventListener("webglcontextlost", () => window.__lost.push(performance.now()));
      }
  };
  new MutationObserver(watch).observe(document, { childList: true, subtree: true });
}, prefetchOn);
const page = await context.newPage();
const consoleLines = [];
page.on("console", (m) => {
  if (/webgl|context|error/i.test(m.text()) || m.type() === "error")
    consoleLines.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => consoleLines.push(`pageerror: ${String(e).slice(0, 300)}`));

let requests = [];
/** Byte ranges already received per archive (a range asked again is a refetch: a tile
 * MapLibre loads once more, for a zoom past the archive's own, not kept by the HTTP cache). */
const received = new Set();
let inflight = 0;
let lastNet = Date.now();
page.on("request", (req) => {
  if (!req.url().includes(".pmtiles")) return;
  inflight++;
  lastNet = Date.now();
});
page.on("requestfinished", async (req) => {
  if (!req.url().includes(".pmtiles")) return;
  inflight--;
  lastNet = Date.now();
  const t = req.timing();
  const sizes = await req.sizes().catch(() => null);
  const archive = req.url().split("/").pop().split("?")[0];
  const range = `${archive} ${req.headers().range}`;
  const again = received.has(range);
  received.add(range);
  requests.push({
    archive,
    again,
    start: t.startTime,
    // Request start time, in ms since the epoch (Playwright's Request.timing()).
    started: t.startTime,
    ttfb: t.responseStart - t.requestStart,
    ms: t.responseEnd,
    // -1 when the body came from a cache.
    bytes: sizes ? Math.max(0, sizes.responseBodySize) : 0,
  });
});
let failed = 0;
page.on("requestfailed", (req) => {
  if (!req.url().includes(".pmtiles")) return;
  inflight--;
  lastNet = Date.now();
  failed++;
});
/** Until no archive request has been in flight for `quiet` ms (at most `cap` ms). */
async function networkQuiet(quiet = 1500, cap = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < cap && (inflight > 0 || Date.now() - lastNet < quiet))
    await new Promise((r) => setTimeout(r, 100));
}

if (engine === "chromium") {
  const cdp = await context.newCDPSession(page);
  if (P.latency) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: P.latency,
      downloadThroughput: P.down,
      uploadThroughput: P.up,
    });
  }
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
}

// The screens are compared in a page of their own (no image library here).
const lab = shots ? await (await browser.newContext()).newPage() : null;
async function missing(frames, settled) {
  return lab.evaluate(
    async ([frames, settled]) => {
      const load = (b64) =>
        new Promise((r) => {
          const i = new Image();
          i.onload = () => r(i);
          i.src = `data:image/jpeg;base64,${b64}`;
        });
      const pixels = async (b64) => {
        const img = await load(b64);
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const ref = await pixels(settled);
      const outv = [];
      for (const f of frames) {
        const d = await pixels(f.b64);
        let off = 0;
        for (let i = 0; i < d.length; i += 16) {
          const diff =
            Math.abs(d[i] - ref[i]) +
            Math.abs(d[i + 1] - ref[i + 1]) +
            Math.abs(d[i + 2] - ref[i + 2]);
          if (diff > 40) off++;
        }
        outv.push({ t: f.t, missing: off / (d.length / 16) });
      }
      return outv;
    },
    [frames, settled],
  );
}

await page.goto(`${URL0}#13/${at[1]}/${at[0]}`);
await page.waitForFunction(() => window.__map?.loaded?.(), null, { timeout: 60000 });
await page.evaluate(
  () =>
    new Promise((r) => {
      window.__map.once("idle", r);
      setTimeout(r, 30000);
    }),
);
await page.waitForTimeout(2500);
await networkQuiet();

const result = {
  engine,
  profile,
  cpu: CPU,
  scheme,
  place: placeName,
  prefetch: prefetchOn,
  steps: [],
};
for (const z of STEPS) {
  requests = [];
  failed = 0;
  const wall0 = Date.now();
  // The step, in the page: tile events per source, idle, the frames' gaps.
  const run = page.evaluate(
    ([z, dur]) =>
      new Promise((resolve) => {
        const map = window.__map;
        const start = performance.now();
        const loaded = {};
        let lastFrame = start;
        let gap = 0;
        let raf = true;
        const tick = () => {
          const now = performance.now();
          gap = Math.max(gap, now - lastFrame);
          lastFrame = now;
          if (raf) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const onData = (e) => {
          if (e.dataType === "source" && e.tile && e.sourceId)
            loaded[e.sourceId] = performance.now() - start;
        };
        map.on("data", onData);
        let moveEnd = null;
        map.once("moveend", () => {
          moveEnd = performance.now() - start;
          map.once("idle", () => {
            raf = false;
            map.off("data", onData);
            resolve({ moveEnd, idle: performance.now() - start, lastTile: loaded, gap });
          });
        });
        map.easeTo({ zoom: z, duration: dur });
        setTimeout(() => {
          raf = false;
          resolve({ moveEnd, idle: null, lastTile: loaded, gap, timeout: true });
        }, 30000);
      }),
    [z, DURATION],
  );
  const frames = [];
  if (shots) {
    while (Date.now() - wall0 < 12000) {
      const b = await page.screenshot({ type: "jpeg", quality: 60, scale: "css" });
      frames.push({ t: Date.now() - wall0, b64: b.toString("base64") });
      const done = await Promise.race([
        run.then(() => true),
        new Promise((r) => setTimeout(() => r(false), 10)),
      ]);
      if (done && Date.now() - wall0 > 1500) break;
    }
  }
  const step = await run;
  await page.waitForTimeout(800);
  await networkQuiet();
  const idleWall = wall0 + (step.idle ?? 30000);
  const stepReq = requests.filter((r) => r.start >= 0 && r.started <= idleWall);
  const prefetch = {};
  for (const r of requests.filter((r) => r.start >= 0 && r.started > idleWall))
    prefetch[r.archive] = (prefetch[r.archive] ?? 0) + Math.round(r.bytes / 1024);
  const refetchKb = {};
  for (const r of stepReq.filter((r) => r.again))
    refetchKb[r.archive] = (refetchKb[r.archive] ?? 0) + Math.round(r.bytes / 1024);
  const byArchive = {};
  for (const r of stepReq) {
    byArchive[r.archive] ??= { n: 0, bytes: 0, ttfb: [], ms: [] };
    const a = byArchive[r.archive];
    a.n++;
    a.bytes += r.bytes;
    a.ttfb.push(Math.round(r.ttfb));
    a.ms.push(Math.round(r.ms));
  }
  const med = (v) => (v.length ? v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)] : null);
  const max = (v) => (v.length ? Math.max(...v) : null);
  const rec = {
    zoom: z,
    moveEnd: Math.round(step.moveEnd ?? -1),
    idle: step.idle == null ? null : Math.round(step.idle),
    timeout: !!step.timeout,
    lastTile: Object.fromEntries(Object.entries(step.lastTile).map(([k, v]) => [k, Math.round(v)])),
    longestFrameGap: Math.round(step.gap),
    failed,
    archives: Object.fromEntries(
      Object.entries(byArchive).map(([k, a]) => [
        k,
        {
          n: a.n,
          kb: Math.round(a.bytes / 1024),
          ttfbMedian: med(a.ttfb),
          ttfbMax: max(a.ttfb),
          msMedian: med(a.ms),
          msMax: max(a.ms),
        },
      ]),
    ),
    prefetchKb: prefetch,
    refetchKb,
  };
  if (shots && frames.length) {
    const settled = (await page.screenshot({ type: "jpeg", quality: 60, scale: "css" })).toString(
      "base64",
    );
    const m = await missing(frames, settled);
    const after = m.filter((f) => f.t >= DURATION + 50);
    rec.missingPeakAfterAnimation = after.length
      ? Math.round(100 * Math.max(...after.map((f) => f.missing)))
      : null;
    const under = (lim) =>
      after.find((_, i) => after.slice(i).every((g) => g.missing < lim))?.t ?? null;
    rec.missingUnder50 = under(0.5);
    rec.missingUnder10 = under(0.1);
    rec.frames = m.map((f) => [f.t, Math.round(100 * f.missing)]);
    if (framesDir) {
      mkdirSync(framesDir, { recursive: true });
      for (const f of frames)
        writeFileSync(
          `${framesDir}/step-${result.steps.length}-z${z}-${String(f.t).padStart(5, "0")}.jpg`,
          Buffer.from(f.b64, "base64"),
        );
      writeFileSync(
        `${framesDir}/step-${result.steps.length}-z${z}-settled.jpg`,
        Buffer.from(settled, "base64"),
      );
    }
  }
  result.steps.push(rec);
  console.log(JSON.stringify({ ...rec, frames: undefined }));
}
result.webglLost = await page.evaluate(() => window.__lost);
result.console = consoleLines.slice(0, 40);
console.log("webgl lost:", result.webglLost.length, "| console:", consoleLines.length);
for (const l of consoleLines.slice(0, 10)) console.log("  ", l);
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
await browser.close();
