// What the first display downloads, by kind, for one interface (redesign: the punk one may
// add at most 150 KB compressed of JS + CSS + fonts, the current one nothing; DECISIONS
// 2026-10-05). Serves a build folder (its files, then web/public for the tiles and the
// basemap, with HTTP Range), opens the map on a phone screen (Chromium), waits for the map
// to be idle and the fonts loaded, and sums the requested files: raw bytes, and gzip -9
// bytes as the server would send them (woff2 and PMTiles as stored); lists what was
// requested after the map was first idle (the punk fonts).
//   node bench/weight.mjs [--dist DIR] [--ui classique|punk] [--mode clair|sombre]
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, devices } from "playwright";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const DIST = resolve(arg("--dist", "dist"));
const PUBLIC = resolve(import.meta.dirname, "../public");
const query = ["ui", "mode"]
  .filter((k) => args.includes(`--${k}`))
  .map((k) => `${k}=${arg(`--${k}`)}`)
  .join("&");
const PORT = 4187;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/octet-stream",
};

function file(path) {
  const clean = decodeURIComponent(path.split("?")[0]);
  for (const root of [DIST, PUBLIC]) {
    const f = join(root, clean === "/" ? "index.html" : clean);
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
  const type = TYPES[extname(f)] ?? "application/octet-stream";
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
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size });
    createReadStream(f).pipe(res);
  }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 14"], colorScheme: "light" });
const page = await context.newPage();
// The map's first idle, as the app sees it (theme.ts loads the punk fonts then).
await page.addInitScript(() => {
  const watch = () => {
    if (window.__map) window.__map.once("idle", () => (window.__firstIdle = performance.now()));
    else requestAnimationFrame(watch);
  };
  watch();
});
const seen = new Map();
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.origin === `http://localhost:${PORT}`)
    seen.set(u.pathname, (seen.get(u.pathname) ?? 0) + 1);
});
await page.goto(`http://localhost:${PORT}/${query ? `?${query}` : ""}#13/48.8597/2.3485`);
await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
await page.evaluate(
  () =>
    new Promise((r) => {
      window.__map.once("idle", r);
      setTimeout(r, 8000);
    }),
);
await page.waitForTimeout(3000);
await page.evaluate(() => document.fonts.ready);
// The first display ends at the map's first idle: what started later (the punk fonts,
// theme/fonts.ts) is listed apart.
const later = new Set(
  await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => e.startTime >= window.__firstIdle - 5)
      .map((e) => new URL(e.name).pathname),
  ),
);
const atIdle = new Set([...seen.keys()].filter((p) => !later.has(p)));
await browser.close();
server.close();

const kindOf = (p) =>
  p.endsWith(".js") || p.endsWith(".mjs")
    ? "js"
    : p.endsWith(".css")
      ? "css"
      : p.endsWith(".woff2")
        ? "font"
        : p.endsWith(".html") || p === "/"
          ? "html"
          : p.endsWith(".pmtiles")
            ? "tiles (ranges, not counted)"
            : "basemap assets";
const out = {};
for (const path of atIdle) {
  const f = file(path);
  if (!f) continue;
  const kind = kindOf(path);
  out[kind] ??= { files: 0, raw: 0, gzip: 0, list: [] };
  const raw = statSync(f).size;
  const sent =
    kind === "font" || kind.startsWith("tiles")
      ? raw
      : gzipSync(readFileSync(f), { level: 9 }).length;
  out[kind].files++;
  out[kind].raw += raw;
  out[kind].gzip += sent;
  out[kind].list.push(`${path} ${sent}`);
}
const code = ["js", "css", "font"].reduce((s, k) => s + (out[k]?.gzip ?? 0), 0);
const after = [...later].map((p) => `${p} ${file(p) ? statSync(file(p)).size : "?"}`);
console.log(
  JSON.stringify(
    { dist: DIST, query, js_css_fonts_gzip: code, after_first_display: after, ...out },
    null,
    1,
  ),
);
