// The return from OpenStreetMap measured (the author's point 1 of 2026-10-12): punk, the
// API simulated (bench/account.mjs mockApi + mockOsm, `?osm=signup` with a signup waiting),
// on the production build of the CI extract, in Chromium with the network and the CPU
// throttled through CDP. Two ways in: the page opened at `?osm=signup` (`direct`), and the
// whole round trip from « Compte » (`chain`: the key pressed, GET /api/osm/login answered by
// a redirect back to the page with `?osm=signup` after OSM's delay, as when OSM grants an
// application it already knows without a page of its own). For each: the navigation's
// times (first paint, the scripts, meta.json, GET /api/me, GET /api/osm/signup, the map's
// `load`), every render of #sheet with what it showed and the stack that drew it, the
// loading's own times (shown, gone), and the screen every ~200 ms (CDP screencast) under
// --out. Prints the timeline; checks nothing.
//   node bench/loading-timeline.mjs [--profile slow|desktop] [--way direct|chain]
//     [--out DIR] [--port N]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { mockApi, OSM_SIGNUP } from "./account.mjs";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { withUi } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const PORT = Number(arg("--port", "4620"));
const APP = `http://localhost:${PORT}/`;
const AT = "#16.5/48.8977/2.2377";
const OUT = resolve(arg("--out", resolve(WEB, "../build/loading-timeline")));
// `slow`: a phone on a slow 4G (DevTools' « Slow 4G »-like: 150 ms, 1.6 Mb/s down), its CPU
// 4× slower; `desktop`: no throttling, a wide window.
const PROFILES = {
  slow: { latency: 150, down: 1.6e6 / 8, up: 750e3 / 8, cpu: 4, api: 150 },
  desktop: { latency: 0, down: -1, up: -1, cpu: 1, api: 30 },
};
const profiles = arg("--profile", null) ? [arg("--profile")] : Object.keys(PROFILES);
const ways = arg("--way", null) ? [arg("--way")] : ["direct", "chain"];
// OpenStreetMap's part of the round trip (its authorize and the callback's redirects).
const OSM_TRIP = 600;

/** In the page, before its scripts: the times of what the timeline names, every render of
 * #sheet (what it shows, the stack that drew it), the loading's own appearance. */
function instrument() {
  const t0 = performance.timeOrigin;
  const log = [];
  window.__timeline = { t0, log };
  const at = () => Math.round(performance.now());
  const say = (what, extra) => log.push({ t: at(), what, ...extra });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) say(e.name);
  }).observe({ type: "paint", buffered: true });
  const describe = (sheet) => {
    const paper = sheet.querySelector("[data-account]");
    const kind = paper?.getAttribute("data-account") ?? (sheet.firstElementChild ? "other" : "");
    const text = (sheet.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 70);
    return { kind, text, hidden: sheet.hidden };
  };
  const wrap = (proto, name) => {
    const original = proto[name];
    proto[name] = function (...a) {
      const out = original.apply(this, a);
      if (this.id === "sheet")
        say(`#sheet.${name}`, {
          ...describe(this),
          stack: (new Error().stack ?? "")
            .split("\n")
            .slice(2, 7)
            .map((s) => s.trim()),
        });
      return out;
    };
  };
  wrap(Element.prototype, "replaceChildren");
  wrap(Node.prototype, "appendChild");
  let last = "";
  const watch = () => {
    const sheet = document.getElementById("sheet");
    const loading = document.querySelector(".loading");
    const state = JSON.stringify([
      sheet ? describe(sheet) : null,
      loading
        ? {
            line: loading.textContent?.replace(/\s+/g, " ").trim().slice(-30),
            leaving: loading.classList.contains("leaving"),
            shown: getComputedStyle(loading).visibility !== "hidden",
          }
        : null,
    ]);
    if (state !== last) {
      last = state;
      const [s, l] = JSON.parse(state);
      say("screen", { sheet: s, loading: l });
    }
  };
  document.addEventListener("readystatechange", () => say(`document ${document.readyState}`));
  const poll = () => {
    watch();
    const map = window.__map;
    if (map && !window.__timelineMap) {
      window.__timelineMap = true;
      say("main.ts done (window.__map)");
      if (map.loaded()) say("map load (already)");
      else map.once("load", () => say("map load"));
      map.once("idle", () => say("map idle"));
    }
    setTimeout(poll, 10);
  };
  poll();
}

/** The resources the timeline names, from the page's Resource Timing. */
const resources = (page) =>
  page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => ({
      name: new URL(r.name).pathname,
      start: Math.round(r.startTime),
      end: Math.round(r.responseEnd),
    })),
  );

const NAMED = [
  [/\/assets\/main-.*\.js$/, "main.js"],
  [/\/assets\/classic-.*\.js$/, "MapLibre chunk"],
  [/\/assets\/punk-.*\.css$/, "punk.css"],
  [/\/tiles\/meta\.json$/, "meta.json"],
  [/^\/api\/me$/, "GET /api/me"],
  [/^\/api\/osm\/status$/, "GET /api/osm/status"],
  [/^\/api\/osm\/signup$/, "GET /api/osm/signup"],
];

async function run(browser, profile, way) {
  const p = PROFILES[profile];
  const phone = profile === "slow";
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 845 } : { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: "fr-FR",
    colorScheme: "light",
  });
  const api = await mockApi(context, { osm: { login: true, signup: { ...OSM_SIGNUP } } });
  // The API's own delay (the mock answers at once; the network throttling does not reach a
  // fulfilled route).
  await context.route("**/api/**", async (route) => {
    await new Promise((r) => setTimeout(r, p.api));
    return route.fallback();
  });
  // OpenStreetMap's part: the flow's start comes back to `then` with `?osm=signup`.
  await context.route("**/api/osm/login**", async (route) => {
    const then = new URL(route.request().url()).searchParams.get("then") ?? "/";
    const back = new URL(then, APP);
    back.searchParams.set("osm", "signup");
    await new Promise((r) => setTimeout(r, OSM_TRIP));
    return route.fulfill({ status: 302, headers: { location: back.href } });
  });
  const page = await context.newPage();
  await page.addInitScript(instrument);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: p.latency,
    downloadThroughput: p.down,
    uploadThroughput: p.up,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  const dir = resolve(OUT, `${profile}-${way}`);
  mkdirSync(dir, { recursive: true });
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ at: f.metadata.timestamp * 1000, data: f.data });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });

  if (way === "chain") {
    // Signed out on the map, « Compte » open: the key leaves for OpenStreetMap.
    await page.goto(`${APP}${AT}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 120000 });
    await page.click("#account-square");
    await page.waitForSelector('#sheet [data-osm="true"]', { timeout: 30000 });
    await page.waitForTimeout(800);
  }
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
  const clicked = Date.now();
  if (way === "chain") await page.click("#account-osm");
  else await page.goto(`${APP}?osm=signup${AT}`);
  await page.waitForSelector('#sheet [data-account="signup"]', { timeout: 120000 });
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await cdp.send("Page.stopScreencast");
  const tl = await page.evaluate(() => window.__timeline);
  const res = await resources(page);
  const named = [];
  for (const [re, label] of NAMED) {
    const r = res.find((x) => re.test(x.name));
    if (r) named.push({ t: r.end, what: `${label} (asked at ${r.start})` });
  }
  const tiles = res.filter((r) => /pmtiles|\/tiles\//.test(r.name));
  const lines = [];
  const out = (s) => lines.push(s);
  out(
    `== ${profile} / ${way}: ms from the navigation's start (the click: ${clicked - tl.t0 < 0 ? clicked - tl.t0 : 0})`,
  );
  if (way === "chain")
    out(
      `   the key pressed at ${Math.round(clicked - tl.t0)} (OSM's part simulated: ${OSM_TRIP} ms)`,
    );
  const events = [
    ...tl.log.filter((e) => e.what !== "#sheet.appendChild" || e.kind),
    ...named,
    {
      t: Math.max(0, ...tiles.map((r) => r.end)),
      what: `last tile byte (${tiles.length} tile requests)`,
    },
  ].sort((a, b) => a.t - b.t);
  for (const e of events) {
    let s = `${String(e.t).padStart(6)}  ${e.what}`;
    if (e.what === "screen") s += ` ${JSON.stringify({ sheet: e.sheet, loading: e.loading })}`;
    if (e.kind !== undefined && e.what.startsWith("#sheet"))
      s += ` [${e.kind}] « ${e.text} »\n${e.stack.map((x) => `            ${x}`).join("\n")}`;
    out(s);
  }
  // Frames every ~200 ms, named by their time from the navigation's start.
  let lastAt = -Infinity;
  let kept = 0;
  for (const f of frames) {
    const t = Math.round(f.at - tl.t0);
    if (t - lastAt < 200) continue;
    lastAt = t;
    kept++;
    writeFileSync(
      resolve(dir, `${String(t).replace("-", "m").padStart(6, "0")}.jpg`),
      Buffer.from(f.data, "base64"),
    );
  }
  out(
    `   ${kept} frames in ${dir}; GET /api/osm/signup asked ${api.signups.length ? "and posted" : ""}`,
  );
  writeFileSync(resolve(dir, "timeline.txt"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  await context.close();
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = withUi(await chromium.launch(), "punk");
try {
  for (const profile of profiles) for (const way of ways) await run(browser, profile, way);
} finally {
  await browser.close();
  server.kill();
}
