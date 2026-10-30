// « Carte et drones » on the site's map (registre/vues/carte.ts, drones.ts): how smooth the map is
// while it tilts and turns with the commune's drone volumes on it, and what the view loads.
// For each commune (Paris 75056 and Lyon 69123 by default), in Chromium with Metal (the map does not
// paint without the GPU):
// - weight, cold: a fresh browser opens /registre/commune/<insee>/carte; every byte received
//   (Chrome's own count, compressed as sent, a cancelled read counted for what arrived), by kind:
//   code (html, js, css, fonts), the register's data, the map's tiles and its basemap's assets;
// - weight, warm: the map first opened on its own at the commune and settled, then the view opened
//   from it as a link does (hote.ts): what the view adds;
// - smoothness, on the warm page: the map tilted from flat to 50° in 2 s, then turned by 170° in
//   4 s (easeTo, linear), the animation frames counted (requestAnimationFrame): images per second,
//   median and 95th percentile of the time between two, and MapLibre's renders; then the same turn
//   with the view's layers hidden, their cost. Chromium draws without the 60 Hz limit (vsync off).
// The server: a build of the web (its files first, web/public's after: the register's data, the
// tiles and the basemap), every /registre path answered with the page (as Caddy does), text gzipped
// on the fly as Caddy's `encode` does, the PMTiles by HTTP Range.
//   node bench/registre-carte.mjs --dist DIR [--communes 75056,69123] [--runs 3]
//                                 [--mode clair|sombre] [--out FILE.json]
// DIR: a build of the web, e.g. a Vite build without the public folder (its basemap is gigabytes):
//   node -e 'import("vite").then(v=>v.build({publicDir:false,build:{outDir:"/tmp/x",emptyOutDir:true}}))'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { createGzip } from "node:zlib";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const DIST = resolve(arg("--dist", "dist"));
const PUBLIC = resolve(import.meta.dirname, "../public");
const COMMUNES = arg("--communes", "75056,69123").split(",");
const RUNS = Number(arg("--runs", 3));
const MODE = arg("--mode", "clair");
const OUT = arg("--out", null);
const PORT = Number(arg("--port", 4191));
const ORIGIN = `http://127.0.0.1:${PORT}`;
if (!existsSync(join(DIST, "index.html"))) {
  console.log(`FAIL no build in ${DIST} (--dist DIR)`);
  process.exit(2);
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/octet-stream",
};
const TEXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt"]);

function file(path) {
  const clean = decodeURIComponent(path.split("?")[0]);
  // the register's paths are the map's page (deploy/preview.caddy, vite.config.ts)
  const page = clean === "/" || /^\/registre(\/|$)/.test(clean) ? "/index.html" : clean;
  for (const root of [DIST, PUBLIC]) {
    const f = join(root, page);
    if (f.startsWith(root) && existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const server = createServer((req, res) => {
  const f = file(req.url);
  if (!f) {
    res.writeHead(404).end();
    return;
  }
  const size = statSync(f).size;
  const ext = extname(f);
  const type = TYPES[ext] ?? "application/octet-stream";
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
    });
    createReadStream(f, { start, end }).pipe(res);
  } else if (TEXT.has(ext) && /gzip/.test(req.headers["accept-encoding"] ?? "")) {
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Encoding": "gzip",
      Vary: "Accept-Encoding",
    });
    const src = createReadStream(f);
    // a reader that cancels (lireContour) closes the socket: stop reading the file
    res.on("close", () => src.destroy());
    src.pipe(createGzip({ level: 6 })).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size });
    createReadStream(f).pipe(res);
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const kindOf = (url) => {
  const p = new URL(url).pathname;
  if (p.startsWith("/data/registre/")) return "registre";
  if (p.endsWith(".pmtiles")) return p.startsWith("/basemap/") ? "fond" : "tuiles";
  if (p.startsWith("/basemap/") || p.startsWith("/tiles/")) return "fond_assets";
  if (/\.(m?js|css|html|woff2)$/.test(p) || p === "/" || /^\/registre(\/|$)/.test(p)) return "code";
  return "autre";
};

/** Every byte the page receives from now on, by request (CDP: compressed, as sent). */
async function meter(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  const reqs = new Map();
  let on = true;
  cdp.on("Network.requestWillBeSent", (e) => {
    if (on) reqs.set(e.requestId, { url: e.request.url, bytes: 0, done: false });
  });
  cdp.on("Network.dataReceived", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.bytes += e.encodedDataLength;
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    // the total with the headers, when Chrome gives it
    if (r) {
      r.bytes = Math.max(r.bytes, e.encodedDataLength);
      r.done = true;
    }
  });
  cdp.on("Network.loadingFailed", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.cancelled = e.canceled || /ABORT/.test(e.errorText ?? "");
  });
  return {
    reset() {
      reqs.clear();
    },
    stop() {
      on = false;
    },
    sum() {
      const by = {};
      for (const r of reqs.values()) {
        const k = kindOf(r.url);
        by[k] ??= { requetes: 0, octets: 0 };
        by[k].requetes++;
        by[k].octets += r.bytes;
      }
      const total = Object.values(by).reduce((s, x) => s + x.octets, 0);
      const registre = [...reqs.values()]
        .filter((r) => kindOf(r.url) === "registre")
        .map((r) => ({
          url: new URL(r.url).pathname,
          octets: r.bytes,
          ...(r.cancelled ? { annule: true } : {}),
        }));
      return { total, ...by, registre };
    },
  };
}

/** The view is drawn: its volumes on the map (or, without a slot, its panel), the map settled. */
const ready = (page) =>
  page.waitForFunction(
    () =>
      window.__map?.getLayer("rg-cd-vol") &&
      document.querySelector(".v-carte .minit") &&
      !window.__map.isMoving(),
    null,
    { timeout: 60000, polling: 250 },
  );
const idle = (page, ms = 8000) =>
  page.evaluate(
    (ms) =>
      new Promise((r) => {
        window.__map.once("idle", r);
        setTimeout(r, ms);
      }),
    ms,
  );

/** Images per second while the map moves (`move` returns once its animation is over). */
const frames = (page, move) =>
  page.evaluate(async (move) => {
    const map = window.__map;
    const dts = [];
    let renders = 0;
    let last = 0;
    let on = true;
    const tick = (t) => {
      if (last) dts.push(t - last);
      last = t;
      if (on) requestAnimationFrame(tick);
    };
    const count = () => renders++;
    map.on("render", count);
    requestAnimationFrame(tick);
    const t0 = performance.now();
    await new Promise((done) => {
      map.once("moveend", done);
      if (move.pitch != null)
        map.easeTo({ pitch: move.pitch, duration: move.ms, easing: (x) => x });
      else
        map.easeTo({ bearing: map.getBearing() + move.turn, duration: move.ms, easing: (x) => x });
    });
    const ms = performance.now() - t0;
    on = false;
    map.off("render", count);
    dts.sort((a, b) => a - b);
    const q = (p) => dts[Math.min(dts.length - 1, Math.floor(p * dts.length))] ?? 0;
    return {
      duree_ms: Math.round(ms),
      images_s: +((dts.length / ms) * 1000).toFixed(1),
      rendus_s: +((renders / ms) * 1000).toFixed(1),
      dt_median_ms: +q(0.5).toFixed(1),
      dt_p95_ms: +q(0.95).toFixed(1),
      dt_max_ms: +q(1).toFixed(1),
    };
  }, move);

/** The commune's centre, from the head of its map file (the bench may read it whole). */
function centre(insee) {
  const f = join(PUBLIC, `data/registre/carte/${insee}.json`);
  if (!existsSync(f)) return null;
  const [w, s, e, n] = JSON.parse(readFileSync(f, "utf8")).bbox;
  return [(s + n) / 2, (w + e) / 2];
}

const launch = () =>
  chromium.launch({
    args: [
      "--use-angle=metal",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      // the frames as fast as the machine draws them, not the screen's 60 Hz (as bench/zoom.mjs)
      "--disable-frame-rate-limit",
      "--disable-gpu-vsync",
    ],
  });
async function context(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((m) => {
    try {
      localStorage.setItem("lacarte.mode", m);
    } catch {}
  }, MODE);
  return ctx;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const results = {};
for (const insee of COMMUNES) {
  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    const browser = await launch();
    // cold: the view's address in a fresh browser
    let ctx = await context(browser);
    let page = await ctx.newPage();
    let m = await meter(page);
    await page.goto(`${ORIGIN}/registre/commune/${insee}/carte`);
    await ready(page);
    await idle(page);
    await page.waitForTimeout(1500);
    const froid = m.sum();
    await ctx.close();
    // warm: the map at the commune first, then the view opened from it
    ctx = await context(browser);
    page = await ctx.newPage();
    const c = centre(insee);
    await page.goto(`${ORIGIN}/${c ? `#12/${c[0].toFixed(5)}/${c[1].toFixed(5)}` : ""}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await idle(page);
    await page.waitForTimeout(2000);
    m = await meter(page);
    await page.evaluate((insee) => {
      const a = document.createElement("a");
      a.href = `/registre/commune/${insee}/carte`;
      document.body.append(a);
      a.click();
      a.remove();
    }, insee);
    await ready(page);
    await idle(page);
    await page.waitForTimeout(1500);
    const chaud = m.sum();
    m.stop();
    // smoothness: flat, then tilted in 2 s, then turned in 4 s
    await page.evaluate(() => window.__map.jumpTo({ pitch: 0 }));
    await idle(page, 4000);
    const incliner = await frames(page, { pitch: 50, ms: 2000 });
    await idle(page, 4000);
    const tourner = await frames(page, { turn: 170, ms: 4000 });
    const vols = await page.evaluate(
      () =>
        new Set(window.__map.querySourceFeatures("rg-cd-zones").map((f) => f.properties.id)).size,
    );
    // the same turn without what the view adds (its layers hidden): their cost
    await page.evaluate(() => {
      const map = window.__map;
      for (const l of map.getStyle().layers)
        if (l.id.startsWith("rg-cd-")) map.setLayoutProperty(l.id, "visibility", "none");
    });
    await idle(page, 4000);
    const tournerSans = await frames(page, { turn: -170, ms: 4000 });
    runs.push({
      froid,
      chaud,
      incliner,
      tourner,
      tourner_sans_volumes: tournerSans,
      volumes: vols,
    });
    await browser.close();
  }
  const pick = (f) => median(runs.map(f));
  results[insee] = {
    volumes: runs[0].volumes,
    froid_octets: pick((r) => r.froid.total),
    chaud_octets: pick((r) => r.chaud.total),
    incliner_images_s: pick((r) => r.incliner.images_s),
    tourner_images_s: pick((r) => r.tourner.images_s),
    tourner_dt_p95_ms: pick((r) => r.tourner.dt_p95_ms),
    tourner_sans_volumes_images_s: pick((r) => r.tourner_sans_volumes.images_s),
    runs,
  };
}
server.close();
const out = { dist: DIST, mode: MODE, runs: RUNS, results };
if (OUT) writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
for (const [insee, r] of Object.entries(results)) {
  const ko = (n) => `${Math.round(n / 1024)} Ko`;
  console.log(
    `${insee}: froid ${ko(r.froid_octets)}, chaud ${ko(r.chaud_octets)}; ` +
      `incliner ${r.incliner_images_s} img/s, tourner ${r.tourner_images_s} img/s ` +
      `(p95 ${r.tourner_dt_p95_ms} ms; sans les volumes ${r.tourner_sans_volumes_images_s} img/s); ` +
      `${r.volumes} volumes`,
  );
}
console.log(
  JSON.stringify(
    Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { ...r, runs: undefined }])),
    null,
    1,
  ),
);
