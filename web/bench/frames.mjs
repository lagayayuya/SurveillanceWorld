// Render cost of the punk map at the street level (product owner, 2026-10-15: the basemap's
// roads drawn again above the fields, `-lifted`, and the water over them), on a phone
// (390 × 845, scale 3, touch), at Bercy (« Standard », « Prudent ») and Châtelet, z15 and
// z17, tiles loaded by a first pass:
// - smoothness: a scripted pan and zoom, the time between animation frames
//   (requestAnimationFrame), MapLibre's own render on the main thread (Map._render) and
//   the renders per second;
// - cost: the view drawn again and again (Map.redraw, a pixel read back each time so that
//   the GPU is done), all layers, then without the lifted roads, without the water over the
//   fields, without both (their visibility off): the time per frame, the differences are
//   their cost. WebKit's clock counts whole milliseconds: each figure is a total over many
//   frames divided by their number, in eight rounds taken in turn (their median).
// Chromium runs with Metal, without the frame-rate limit and vsync (as bench/zoom.mjs);
// WebKit as Playwright gives it (frames at 60 Hz).
//   node bench/frames.mjs [--browser webkit|chromium] [--label NAME] [--runs N] [--port N]
//                         [--out FILE.json]
// Needs an IDF build: LACARTE_DIST (bench/dist.mjs), or web/dist with the IDF tiles.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium, webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("idf");
const engine = arg("--browser", "webkit");
const label = arg("--label", "current");
const RUNS = Number(arg("--runs", 3));
const PORT = Number(arg("--port", 4480));
const OUT = arg("--out", null);
const APP = `http://127.0.0.1:${PORT}/`;
const PLACES = [
  { name: "bercy", query: "", at: "48.82509/2.39018" },
  { name: "bercy-prudent", query: "&est=prudent", at: "48.82509/2.39018" },
  { name: "chatelet", query: "", at: "48.8595/2.3470" },
];
const ZOOMS = [15, 17];
const REDRAWS = 40;

/** The motion in the page: pans, then a zoom out and back; each frame timed. */
const motion = (page) =>
  page.evaluate(async () => {
    const map = window.__map;
    const deltas = [];
    const renders = [];
    let last = 0;
    let on = true;
    const tick = (t) => {
      if (last) deltas.push(t - last);
      last = t;
      if (on) requestAnimationFrame(tick);
    };
    const render = map._render;
    map._render = function (ts) {
      const t0 = performance.now();
      const out = render.call(this, ts);
      renders.push(performance.now() - t0);
      return out;
    };
    const moved = () => new Promise((r) => map.once("moveend", r));
    requestAnimationFrame(tick);
    const t0 = performance.now();
    for (const [x, y] of [
      [160, 0],
      [0, 220],
      [-160, 0],
      [0, -220],
      [120, 160],
      [-120, -160],
    ]) {
      const done = moved();
      map.panBy([x, y], { duration: 500, easing: (t) => t });
      await done;
    }
    const z = map.getZoom();
    for (const to of [z - 0.8, z]) {
      const done = moved();
      map.easeTo({ zoom: to, duration: 700, easing: (t) => t });
      await done;
    }
    const seconds = (performance.now() - t0) / 1000;
    on = false;
    map._render = render;
    return { deltas, renders, seconds };
  });

/** In the page: ms per frame of the view drawn `n` times, all layers and without each
 * group (its layers' visibility off, then back as they were). */
const forced = (page, n) =>
  page.evaluate((n) => {
    const map = window.__map;
    const gl = map.painter.context.gl;
    const pixel = new Uint8Array(4);
    const ids = map.getStyle().layers.map((l) => l.id);
    const groups = {
      lifted: ids.filter((id) => id.endsWith("-lifted")),
      water: ids.filter((id) => id === "water-over-fields" || id === "water-shore"),
    };
    const time = (hidden) => {
      const was = hidden.map((id) => map.getLayoutProperty(id, "visibility"));
      for (const id of hidden) map.setLayoutProperty(id, "visibility", "none");
      const draw = () => {
        map.redraw();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      };
      for (let i = 0; i < 10; i++) draw();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) draw();
      const ms = (performance.now() - t0) / n;
      hidden.forEach((id, i) => {
        map.setLayoutProperty(id, "visibility", was[i] ?? "visible");
      });
      return ms;
    };
    // Rounds in turn (the clock and the GPU drift): each variant's median round.
    const variants = {
      all: [],
      noLifted: groups.lifted,
      noWater: groups.water,
      neither: [...groups.lifted, ...groups.water],
    };
    const rounds = Object.fromEntries(Object.keys(variants).map((k) => [k, []]));
    for (let r = 0; r < 8; r++)
      for (const [k, hidden] of Object.entries(variants)) rounds[k].push(time(hidden));
    const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    return {
      layers: { lifted: groups.lifted.length, water: groups.water.length },
      ...Object.fromEntries(Object.entries(rounds).map(([k, xs]) => [k, median(xs)])),
    };
  }, n);

const idle = (page) =>
  page.evaluate(
    () =>
      new Promise((r) => {
        window.__map.once("idle", r);
        window.__map.triggerRepaint();
        setTimeout(r, 15000);
      }),
  );

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null;
};
const round = (x) => +x.toFixed(2);

const server = spawn("npx", preview(PORT, "127.0.0.1"), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await (engine === "chromium" ? chromium : webkit).launch(
  engine === "chromium"
    ? {
        args: [
          "--enable-gpu",
          "--ignore-gpu-blocklist",
          "--use-angle=metal",
          "--disable-frame-rate-limit",
          "--disable-gpu-vsync",
        ],
      }
    : {},
);
const results = { engine, label, date: new Date().toISOString(), runs: RUNS, places: {} };
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 845 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
    locale: "fr-FR",
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("lacarte.ui", "punk");
      localStorage.setItem("lacarte.mode", "clair");
      localStorage.setItem("lacarte.welcome", "1");
    } catch {}
  });
  for (const place of PLACES)
    for (const z of ZOOMS) {
      const key = `${place.name}-z${z}`;
      const pooled = { deltas: [], renders: [], rate: [], cost: [] };
      let renderer = null;
      let layers = null;
      for (let i = 0; i < RUNS; i++) {
        const page = await context.newPage();
        await page.goto(`${APP}?ui=punk${place.query}#${z}/${place.at}`);
        await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 30000 });
        await idle(page);
        renderer ??= await page.evaluate(() => {
          const gl = window.__map.painter.context.gl;
          const ext = gl.getExtension("WEBGL_debug_renderer_info");
          return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        });
        await motion(page); // tiles in
        await idle(page);
        const m = await motion(page);
        await idle(page);
        const c = await forced(page, REDRAWS);
        layers = c.layers;
        pooled.deltas.push(...m.deltas);
        pooled.renders.push(...m.renders);
        pooled.rate.push(m.renders.length / m.seconds);
        pooled.cost.push(c);
        await page.close();
      }
      const med = (k) =>
        q(
          pooled.cost.map((c) => c[k]),
          0.5,
        );
      const diff = (k) =>
        q(
          pooled.cost.map((c) => c.all - c[k]),
          0.5,
        );
      results.places[key] = {
        renderer,
        layers,
        frame: {
          median: q(pooled.deltas, 0.5),
          p95: q(pooled.deltas, 0.95),
          n: pooled.deltas.length,
        },
        render: { median: q(pooled.renders, 0.5), p95: q(pooled.renders, 0.95) },
        rendersPerSecond: q(pooled.rate, 0.5),
        drawn: {
          all: med("all"),
          lifted: diff("noLifted"),
          water: diff("noWater"),
          both: diff("neither"),
          runs: pooled.cost.map((c) => [c.all, c.noLifted, c.noWater, c.neither].map(round)),
        },
      };
      const r = results.places[key];
      console.log(
        `ok   ${engine} ${label} ${key}: frame ${r.frame.median}/${r.frame.p95} ms, render ${r.render.median}/${r.render.p95} ms, ${r.rendersPerSecond}/s; drawn ${r.drawn.all} ms, lifted ${r.drawn.lifted}, water ${r.drawn.water}, both ${r.drawn.both} (${layers.lifted} + ${layers.water} layers) [${renderer}]`,
      );
    }
  await context.close();
} finally {
  await browser.close();
  server.kill();
}
if (OUT) writeFileSync(OUT, `${JSON.stringify(results, null, 1)}\n`);
