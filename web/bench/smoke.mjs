// Smoke test of the map interactions on the production build (needs the region's tiles and
// basemap in web/public). Exits non-zero if any check failed.
//   node bench/smoke.mjs [--region idf|ci]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { accountSmoke } from "./account.mjs";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { benchBrowser } from "./ui.mjs";

const args = process.argv.slice(2);
const region = args.includes("--region") ? args[args.indexOf("--region") + 1] : "idf";
requireTiles(region);
const PORT = 4177;
const APP = `http://localhost:${PORT}/`;
// A street with cameras in each region: Châtelet; La Défense for the CI extract.
const STREET = region === "ci" ? [2.2377, 48.8977] : [2.3485, 48.8597];
const checks = [];
// The panel is mockup 20a's machine (machine.ts): closed until « Filtres et légende » opens
// it, its keys and chips written as 20a writes them (fr.json filters.*, adv.chip.*).
const W = {
  pubOnly: "Publiques seules",
  all: "Toutes",
  dir: "la direction",
  height: "la hauteur",
  never: "jamais",
  scope: "ne suivent que",
};
/** The machine opened (a camera's sheet closes it), before the panel is used. */
async function openPanel(page) {
  if (await page.evaluate(() => document.body.classList.contains("machine-open"))) return;
  await page.locator("#fab-filters").click();
  await page.waitForTimeout(400);
}

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// A duration's limit, as smoke-mobile.mjs has it: binding here and in the local gate; with
// BENCH_TIMING=report (CI's shared machines, whose timings vary) measured and printed, over
// the limit a warning in the run's annotations, never a failure. What happened is checked
// either way.
const TIMING_REPORT = process.env.BENCH_TIMING === "report";
function within(name, ms, limit) {
  const ok = ms !== null && ms <= limit;
  if (!TIMING_REPORT) return ok;
  console.log(`time ${name}: ${ms} ms, limit ${limit} ms${ok ? "" : " (over)"}`);
  if (!ok) console.log(`::warning::desktop: ${name} took ${ms} ms (limit ${limit} ms)`);
  return ms !== null;
}

// The estimate the map draws (band index of the style's "bands" filter): 1 Standard, the
// one the map opens on; 2 Prudent.
async function chosenBand(page) {
  const f = JSON.stringify(await page.evaluate(() => window.__map.getFilter("bands")));
  return Number(f.match(/"b"\],(\d)/)?.[1] ?? Number.NaN);
}

// Wait for the map to finish re-rendering (symbol placement is asynchronous).
async function idle(page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        window.__map.once("idle", r);
        window.__map.triggerRepaint();
        setTimeout(r, 3000);
      }),
  );
  await page.waitForTimeout(400);
}

async function settle(page, view) {
  await page.evaluate(async (v) => {
    const m = window.__map;
    m.jumpTo(v);
    await new Promise((r) => m.once("idle", r));
  }, view);
  await page.waitForTimeout(150);
}

/** Every camera in the loaded tiles, in view and kept by the pictogram layer's filter,
 * against the pictograms actually placed: ids of the missing ones. */
const missingPictos = (page) =>
  page.evaluate(() => {
    const m = window.__map;
    const b = m.getBounds();
    const want = new Set(
      m
        .querySourceFeatures("detail", { sourceLayer: "cameras", filter: m.getFilter("cameras") })
        .filter((f) => b.contains(f.geometry.coordinates))
        .map((f) => f.id),
    );
    const drawn = new Set(m.queryRenderedFeatures({ layers: ["cameras"] }).map((f) => f.id));
    return { want: want.size, missing: [...want].filter((id) => !drawn.has(id)) };
  });

/** The colour of the pictograms other than `focusId` on the uncovered map (one screenshot):
 * the median of the pixels near the theme's colour for them (window.__palette, otherPicto)
 * around each one's centre, and around the middle of each pair of overlapping ones
 * (centres < 14 px apart). */
async function pictoColours(page, focusId) {
  const pts = await page.evaluate((fid) => {
    const m = window.__map;
    const canvas = m.getCanvas();
    const r = canvas.getBoundingClientRect();
    const free = (x, y) =>
      [
        [-8, -8],
        [8, 8],
        [-8, 8],
        [8, -8],
        [0, 0],
      ].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === canvas);
    const seen = new Set();
    return m
      .queryRenderedFeatures({ layers: ["cameras"] })
      .filter((f) => f.id !== fid && !seen.has(f.id) && seen.add(f.id))
      .map((f) => {
        const p = m.project(f.geometry.coordinates);
        return { x: Math.round(p.x + r.left), y: Math.round(p.y + r.top), id: f.id };
      })
      .filter((p) => free(p.x, p.y));
  }, focusId);
  const pairs = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d > 3 && d < 14)
        pairs.push({
          x: Math.round((pts[i].x + pts[j].x) / 2),
          y: Math.round((pts[i].y + pts[j].y) / 2),
          ids: [pts[i].id, pts[j].id],
        });
    }
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(
    async ([png, singles, overlaps, [expected, near]]) => {
      const want = [1, 3, 5].map((i) => Number.parseInt(expected.slice(i, i + 2), 16));
      const bm = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${png}`)).blob(),
      );
      const c = new OffscreenCanvas(bm.width, bm.height);
      const x = c.getContext("2d");
      x.drawImage(bm, 0, 0);
      const img = x.getImageData(0, 0, bm.width, bm.height);
      const colour = (p, half) => {
        const px = [];
        for (let dx = -half; dx <= half; dx++)
          for (let dy = -half; dy <= half; dy++) {
            const i = ((p.y + dy) * img.width + (p.x + dx)) * 4;
            const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
            const d = Math.abs(r - want[0]) + Math.abs(g - want[1]) + Math.abs(b - want[2]);
            if (d < near) px.push([r, g, b]);
          }
        if (!px.length) return null;
        return [0, 1, 2].map((k) => px.map((v) => v[k]).sort((a, b) => a - b)[px.length >> 1]);
      };
      return {
        singles: singles.map((p) => ({ ...p, rgb: colour(p, 4) })).filter((p) => p.rgb),
        overlaps: overlaps.map((p) => ({ ...p, rgb: colour(p, 2) })).filter((p) => p.rgb),
      };
    },
    [shot, pts, pairs, await otherPicto(page)],
  );
}

/** The colour of the other pictograms in focus mode, and how near (sum of the channels'
 * differences) a pixel must be to count: the stickers' dimmed body, half-way from the
 * pictogram's colour to the halo (16a, stickers.ts variantInks), counted closely: around a
 * pair's middle the eyes and lash lines of a sticker blend into its body at their edges
 * (anti-aliasing, not opacity). */
const otherPicto = (page) =>
  page.evaluate(() => {
    const p = window.__palette();
    const rgb = (c) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
    const [a, b] = [rgb(p.picto), rgb(p.halo)];
    const dim = a.map((v, i) =>
      Math.round((v + b[i]) / 2)
        .toString(16)
        .padStart(2, "0"),
    );
    return [`#${dim.join("")}`, 12];
  });

/** The punk area sheet's « Rues » ticket (its accessible name) and its colour line
 * (areapunk.ts shareFace, placeLine; DECISIONS 2026-10-09, « Punk sheets on a phone… »). */
const AREA_TICKET =
  /^(1 sur [\d\s]+|\d+ sur 10) rues à portée$|^\d+\s% des rues à portée$|^Aucune rue à portée$/;
const AREA_PLACE =
  /^Sa couleur : (la classe la moins filmée \(moins de|(une classe peu filmée|la classe du milieu|une classe très filmée) \(de [\d,]+ à|la classe la plus filmée \(plus de) [\d,]+\s% des rues à portée\)$|^Sur la carte : hachurée, aucune caméra recensée\.$/;
/** The open area sheet holds in its width (DECISIONS 2026-10-09, « Punk sheets on a
 * phone… »): nothing scrolls sideways, the title ends left of ↑ and ×, and the map's cursor
 * stays over its ramp even with a name longer than it (its text lengthened here). Run in
 * the page. */
const AREA_FIT = () => {
  const box = (e) => e.getBoundingClientRect();
  const cursor = document.querySelector("#sheet .area-cursor");
  const ramp = document.querySelector("#sheet .area-ramp");
  if (cursor) cursor.textContent = "Paris 12e Arrondissement, un nom plus long que la rampe";
  const words = [...document.querySelectorAll("#sheet .cut-word")].map((w) => box(w).right);
  const buttons = [...document.querySelectorAll("#sheet .sheet-head :is(.sheet-grab, .close)")]
    .map(box)
    .filter((r) => r.width > 0)
    .map((r) => r.left);
  // What runs out of the paper's sides (which clip sideways: a width measure would hide it).
  const paper = box(document.querySelector("#sheet .sheet-paper"));
  const sideways = [...document.querySelectorAll("#sheet .sheet-paper *")]
    .map((e) => [e, box(e)])
    .filter(([, r]) => r.width > 0 && (r.left < paper.left - 1 || r.right > paper.right + 1))
    .map(([e, r]) => `${e.tagName.toLowerCase()}.${e.className} ${r.left | 0}-${r.right | 0}`);
  return {
    sideways,
    title: Math.round(Math.max(...words)),
    buttons: Math.round(Math.min(...buttons)),
    // A hatched area has no cursor.
    cursor:
      !cursor ||
      (box(cursor).left >= box(ramp).left - 1 && box(cursor).right <= box(ramp).right + 1),
  };
};
/** Whether area `code`'s middle (tiles/areas.json bounds) lies in the map the panels leave
 * free: below the estimate bar, above the sheet on a phone, between the side panels on a
 * wide screen. */
/** The loaded camera nearest the map's centre put at (fx, fy) of the canvas, the map at
 * rest: where it is (page px), and the map's view. The map's moves from then on are kept in
 * window.__moves (smoke-mobile.mjs has its twin). */
async function placeCamera(page, fx, fy) {
  await page.evaluate(
    ([fx, fy]) => {
      const m = window.__map;
      const c = m.getCenter();
      const d = (f) =>
        Math.hypot(f.geometry.coordinates[0] - c.lng, f.geometry.coordinates[1] - c.lat);
      const f = m
        .querySourceFeatures("detail", { sourceLayer: "cameras" })
        .reduce((a, b) => (d(b) < d(a) ? b : a));
      const w = m.getCanvas().clientWidth;
      const h = m.getCanvas().clientHeight;
      m.jumpTo({ center: f.geometry.coordinates });
      m.panBy([w / 2 - w * fx, h / 2 - h * fy], { animate: false });
      window.__placed = f.geometry.coordinates;
    },
    [fx, fy],
  );
  await idle(page);
  await page.evaluate(() => {
    const m = window.__map;
    window.__moves = [];
    if (window.__movesHooked) return;
    window.__movesHooked = true;
    m.on("movestart", () => window.__moves.push(["start", performance.now()]));
    m.on("moveend", () => window.__moves.push(["end", performance.now()]));
  });
  return placedView(page);
}

/** The placed camera's point (page px), the map's view and moves, the sheet's left edge. */
const placedView = (page) =>
  page.evaluate(() => {
    const m = window.__map;
    const r = m.getCanvas().getBoundingClientRect();
    const q = m.project(window.__placed);
    const c = m.getCenter();
    const sheet = document.getElementById("sheet");
    const moves = window.__moves ?? [];
    const start = moves.find((e) => e[0] === "start");
    const end = moves.findLast((e) => e[0] === "end");
    return {
      x: q.x + r.left,
      y: q.y + r.top,
      center: [c.lng, c.lat],
      zoom: m.getZoom(),
      starts: moves.filter((e) => e[0] === "start").length,
      ms: start && end ? Math.round(end[1] - start[1]) : null,
      sheetLeft: sheet.hidden ? null : sheet.getBoundingClientRect().left,
      focus: document.body.classList.contains("focus"),
    };
  });

const areaFramed = (page, code) =>
  page.evaluate(async (c) => {
    const m = window.__map;
    const [, , [w, s, e, n]] = (await fetch("/tiles/areas.json").then((r) => r.json()))[c];
    const p = m.project([(w + e) / 2, (s + n) / 2]);
    const r = m.getCanvas().getBoundingClientRect();
    const x = p.x + r.left;
    const y = p.y + r.top;
    const bar = document.getElementById("estimate").getBoundingClientRect().bottom;
    const sheet = document.getElementById("sheet").getBoundingClientRect();
    // The machine, closed, covers nothing (only its ticket, at the top left).
    const closed = !document.body.classList.contains("machine-open");
    const panel = closed
      ? { right: 0 }
      : document.getElementById("filters").getBoundingClientRect();
    const phone = sheet.width >= r.width - 1;
    const free = phone
      ? y > bar && y < sheet.top && x > 0 && x < r.width
      : y > bar && y < r.height && x > panel.right && x < sheet.left;
    return { free, at: [Math.round(x), Math.round(y)], z: +m.getZoom().toFixed(2) };
  }, code);

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = benchBrowser(
  await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] }),
  true,
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${APP}#10/48.85/2.35`);
  await page.waitForFunction(() => window.__map?.loaded());

  // Attribution always visible.
  for (const zoom of [8, 14, 18]) {
    await settle(page, { center: STREET, zoom });
    const text = await page.locator(".maplibregl-ctrl-attrib").innerText();
    check(`attribution at z${zoom}`, text.includes("OpenStreetMap") && text.includes("ODbL"));
  }

  // The basemap (self-hosted extract) is drawn under the surveillance layers.
  await settle(page, { center: STREET, zoom: 16 });
  const basemap = await page.evaluate(
    () => window.__map.querySourceFeatures("protomaps", { sourceLayer: "buildings" }).length,
  );
  check("basemap buildings rendered", basemap > 0, `${basemap}`);

  // Who films, below z15: switching to public cameras swaps the aggregate set.
  await settle(page, { center: STREET, zoom: 10 });
  await openPanel(page);
  await page.getByLabel(W.pubOnly).check();
  const filter = await page.evaluate(() => JSON.stringify(window.__map.getFilter("communes")));
  check("public-only switch uses n_pub", filter.includes("n_pub"), filter);
  // Public cameras only is a filter on what is filmed, like the others: at z12 the merged
  // intervals are kept by their filter bits (one shade).
  await settle(page, { center: STREET, zoom: 12 });
  const pubPaint = JSON.stringify(
    await page.evaluate(() => window.__map.getPaintProperty("portions", "line-color")),
  );
  check(
    "public only at z12: a filter on the filmed intervals' bits",
    pubPaint.includes('"fb"') && !pubPaint.includes('"cp'),
    pubPaint.slice(0, 120),
  );
  await page.getByLabel(W.all).check();

  // Street level: a type filter removes cameras, the panel only lists what is in view.
  await settle(page, { center: STREET, zoom: 17 });
  const count = () =>
    page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ["cameras"] }).length);
  const bandsCount = () =>
    page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ["bands"] }).length);
  const bandsBefore = await bandsCount();
  check("observation bands rendered", bandsBefore > 0, `${bandsBefore}`);
  // Only the filmed portions are coloured; segments are grey.
  const portionsDrawn = await page.evaluate(() => ({
    portions: window.__map.queryRenderedFeatures({ layers: ["portions"] }).length,
    grey: window.__map.getPaintProperty("streets", "line-color") === window.__palette().streetNone,
  }));
  check(
    "z17: filmed portions drawn, whole segments grey",
    portionsDrawn.portions > 0 && portionsDrawn.grey,
    JSON.stringify(portionsDrawn),
  );
  // A sample per level, in the legend its ticket prints (20a: « identifier · reconnaître ·
  // détecter »).
  const levels = await page.evaluate(() => {
    // Rows holding a level sample canvas (machine.ts renderLegend), not the swatches alone.
    const names = [...document.querySelectorAll("#legend .legend-levels dt")]
      .filter((r) => r.querySelector("canvas.sample.level"))
      .map((r) => r.textContent.trim());
    return names.join() === "identifier,reconnaître,détecter";
  });
  check("panel shows observation levels", levels);
  const before = await count();
  // The first type listed in the panel (types are listed only when in view).
  await openPanel(page);
  const types = page
    .locator("#filters label", { has: page.locator("canvas.sample") })
    .filter({ visible: true });
  check("panel lists types in view", (await types.count()) >= 1);
  const first = types.first();
  const name = (await first.locator(".label").innerText()).toLowerCase();
  const kindOf = {
    dôme: "dome",
    fixe: "fixed",
    motorisée: "ptz",
    panoramique: "panorama",
    "lecture de plaques": "alpr",
    plaques: "alpr",
    sonnette: "doorbell",
    "type inconnu": "unknown",
    inconnu: "unknown",
  };
  await first.locator("input").uncheck();
  await idle(page);
  const after = await count();
  check(`unchecking ${name} hides them`, after < before, `${before} -> ${after}`);
  const bandsAfter = await bandsCount();
  check("…and their bands", bandsAfter < bandsBefore, `${bandsBefore} -> ${bandsAfter}`);
  // Streets follow the filters: a portion is kept iff a camera of another type films it
  // with the chosen estimate or a more certain one (recomputed here from cameras.json).
  await page.waitForFunction(() =>
    JSON.stringify(window.__map.getPaintProperty("portions", "line-color")).includes(
      "feature-state",
    ),
  );
  await idle(page);
  const streetsFiltered = await page.evaluate(
    async ([hidden, est]) => {
      const m = window.__map;
      const t = await fetch("/tiles/cameras.json").then((r) => r.json());
      let kept = 0;
      let out = 0;
      let wrong = 0;
      for (const f of m.queryRenderedFeatures({ layers: ["portions"] })) {
        if (f.id === undefined || !f.properties.cs) continue;
        const want = String(f.properties.cs)
          .split(";")
          .filter(Boolean)
          .map((tok) => Number.parseInt(tok, 36))
          .some((v) => v % 3 <= est && t.kinds[t.k[Math.floor(v / 3)]] !== hidden);
        const sel =
          m.getFeatureState({ source: "streets", sourceLayer: f.sourceLayer, id: f.id }).sel ===
          true;
        if (sel !== want) wrong++;
        if (sel) kept++;
        else out++;
      }
      const text = document.querySelector("#filters .streets-count")?.textContent ?? "";
      return { kept, out, wrong, text };
    },
    [kindOf[name], await chosenBand(page)],
  );
  check(
    "filters mark streets (from z15), as recomputed",
    streetsFiltered.kept > 0 && streetsFiltered.wrong === 0 && /tronçon/.test(streetsFiltered.text),
    JSON.stringify(streetsFiltered),
  );
  await first.locator("input").check();
  await idle(page);
  // Punk: the machine is patched at each idle, never rebuilt: a key keeps the keyboard focus
  // while the map moves and settles again (machine.ts render).
  await first.locator("input").focus();
  const focusKept = await page.evaluate(async () => {
    const before = document.activeElement;
    const m = window.__map;
    for (const dx of [60, -60]) {
      m.panBy([dx, 0], { duration: 0 });
      await new Promise((r) => {
        m.once("idle", r);
        setTimeout(r, 8000);
      });
    }
    return before?.tagName === "INPUT" && document.activeElement === before;
  });
  check("punk: a key keeps the keyboard focus while the map moves and settles", focusKept);
  const unfiltered = await page.evaluate(() =>
    JSON.stringify(window.__map.getPaintProperty("portions", "line-color")).includes(
      "feature-state",
    ),
  );
  check("no filter: streets as usual", !unfiltered);

  // Hover highlight, hand cursor and enlarged click target (click 12 px off the icon).
  const target = await page.evaluate(() => {
    const m = window.__map;
    // The camera closest to the centre, away from the filter panel.
    const c = m.project(m.getCenter());
    const pts = m.queryRenderedFeatures({ layers: ["cameras"] }).map((f) => {
      const p = m.project(f.geometry.coordinates);
      return { x: p.x, y: p.y, id: f.id, d: Math.hypot(p.x - c.x, p.y - c.y) };
    });
    return pts.sort((a, b) => a.d - b.d)[0];
  });
  await page.mouse.move(target.x + 12, target.y);
  await page.waitForTimeout(200);
  const state = await page.evaluate(
    (id) => window.__map.getFeatureState({ source: "detail", sourceLayer: "cameras", id }),
    target.id,
  );
  check("hover sets feature-state", state.hover === true);
  const cursor = await page.evaluate(() => window.__map.getCanvas().style.cursor);
  check("hand cursor on hover", cursor === "pointer");
  await page.mouse.click(target.x + 12, target.y);
  await page.waitForTimeout(200);
  check("click opens the sheet", await page.locator("#sheet").isVisible());
  await idle(page);
  const fan = await page.evaluate(() => ({
    drawn: window.__map.queryRenderedFeatures({ layers: ["bands-fan"] }).map((f) => f.properties.b),
  }));
  const fanZone = await chosenBand(page);
  check(
    "click outlines the camera for the chosen hypothesis only",
    fan.drawn.length > 0 && fan.drawn.every((b) => b === fanZone),
    JSON.stringify([...new Set(fan.drawn)]),
  );
  check("CNIL signal hidden by default", (await page.locator("#sheet .cnil").count()) === 0);

  // A click on a camera in the part of the map the panels leave free: the map does not move
  // at all; on a camera where the sheet comes: one move, <= 400 ms (DECISIONS 2026-10-06),
  // just enough for its target to be left of the sheet, the zoom kept (DECISIONS
  // 2026-10-18; it used to frame the camera's field).
  await page.keyboard.press("Escape");
  const seen = await placeCamera(page, 0.45, 0.5);
  await page.mouse.click(seen.x, seen.y);
  await page.waitForTimeout(900);
  await idle(page);
  const still = await placedView(page);
  check(
    "click a camera in the free part: the map does not move (no movestart, same centre and zoom)",
    still.focus &&
      still.starts === 0 &&
      still.zoom === seen.zoom &&
      still.center.every((v, i) => Math.abs(v - seen.center[i]) < 1e-9),
    JSON.stringify({ seen, still }),
  );
  await page.keyboard.press("Escape");
  const right = await placeCamera(page, 0.85, 0.5);
  await page.mouse.click(right.x, right.y);
  await page.waitForTimeout(1200);
  await idle(page);
  const freed = await placedView(page);
  check(
    "click a camera where the sheet comes: one move, <= 400 ms, the camera left of the sheet, same zoom",
    freed.focus &&
      freed.starts === 1 &&
      within("click a camera where the sheet comes", freed.ms, 400) &&
      freed.zoom === right.zoom &&
      freed.sheetLeft !== null &&
      freed.x <= freed.sheetLeft - 20 &&
      Math.abs(freed.y - right.y) < 1,
    JSON.stringify({ right, freed }),
  );

  // Focus mode: everything else dimmed, reach written on the outlines, filmed street
  // highlighted; left with Escape and with a click on empty map. No console error.
  const consoleErrors = [];
  // The participation API is not started here (bench/smoke-participate.mjs covers it):
  // its calls fail with the preview proxy's 502, which is not what this test watches.
  const onConsole = (msg) => {
    if (msg.type() === "error" && !msg.location().url.includes("/api/"))
      consoleErrors.push(msg.text());
  };
  page.on("console", onConsole);
  await page.keyboard.press("Escape");
  // A camera filming a street with the standard estimate or a more certain one (portions
  // list ";n:band;" from z15), centred, then clicked on its icon.
  await page.waitForFunction(
    () => window.__map.isSourceLoaded("streets") && window.__map.isSourceLoaded("detail"),
  );
  const focusZone = await chosenBand(page);
  const focusCam = await page.evaluate(() => {
    const m = window.__map;
    const filming = new Set(
      m
        .querySourceFeatures("streets", { sourceLayer: "portions" })
        .flatMap((f) => String(f.properties.cs ?? "").split(";"))
        .filter(Boolean)
        .map((tok) => Number.parseInt(tok, 36))
        .filter((v) => v % 3 <= 1)
        .map((v) => Math.floor(v / 3)),
    );
    const c = m.getCenter();
    const cams = m
      .querySourceFeatures("detail", { sourceLayer: "cameras" })
      .filter((f) => filming.has(f.properties.n))
      .map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        return { lng, lat, n: f.properties.n, d: Math.hypot(lng - c.lng, lat - c.lat) };
      });
    return cams.sort((a, b) => a.d - b.d)[0] ?? null;
  });
  check("a camera filming a street is loaded", focusCam !== null, JSON.stringify(focusCam));
  // At z18, about where framing its field put the map until lot U: a click no longer
  // zooms (DECISIONS 2026-10-18), and at z17 a short reach's label lies on the pictogram.
  await settle(page, { center: [focusCam.lng, focusCam.lat], zoom: 18 });
  const mid = await page.evaluate(() => {
    const r = window.__map.getCanvas().getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(mid.x, mid.y);
  await idle(page);
  // Where the camera is now (the map may have moved since): find it again.
  const clickFocusCam = async () => {
    const p = await page.evaluate((c) => {
      const m = window.__map;
      const r = m.getCanvas().getBoundingClientRect();
      const q = m.project([c.lng, c.lat]);
      return { x: q.x + r.left, y: q.y + r.top };
    }, focusCam);
    await page.mouse.click(p.x, p.y);
  };
  const focusState = () =>
    page.evaluate(() => {
      const m = window.__map;
      const n = (id) => m.queryRenderedFeatures({ layers: [id] }).length;
      return {
        labels: n("focus-labels"),
        points: m.querySourceFeatures("focus-points").length,
        levels: [
          ...new Set(
            m.queryRenderedFeatures({ layers: ["focus-labels"] }).map((f) => f.properties.lv),
          ),
        ],
        streets: n("focus-streets"),
        zoom: m.getZoom(),
        text: m.queryRenderedFeatures({ layers: ["focus-labels"] })[0]?.properties ?? null,
        dim: JSON.stringify(m.getPaintProperty("streets", "line-opacity")).includes("0.15"),
        fan: JSON.stringify(m.getFilter("bands-fan")),
        body: document.body.classList.contains("focus"),
      };
    });
  let fs = await focusState();
  check("focus dims the rest of the map", fs.dim && fs.body);
  // No PTZ zoom outline nor direction cone, focus included (author's decision).
  const gone = await page.evaluate(() =>
    ["ptz-reach", "camera-cones"].filter((id) => window.__map.getLayer(id)),
  );
  check("no PTZ zoom outline nor direction cone, in focus too", gone.length === 0, gone.join(","));
  // A label may give way to the selected pictogram (drawn larger, on top): the label points
  // exist, and the labels drawn are identification ones.
  check(
    "focus labels: identification only (a label may give way to the pictogram)",
    fs.points > 0 && fs.levels.every((lv) => lv === 3),
    JSON.stringify({ points: fs.points, levels: fs.levels }),
  );
  check("focus highlights the filmed street", fs.streets > 0, `${fs.streets}`);
  // The other cameras' pictograms stay visible (only fields and streets are dimmed); the
  // camera in focus is drawn larger on top of every layer, no reach label over it.
  const focusId = fs.fan.match(/"i"\],(\d+)/)?.[1] * 1;
  const view = await page.evaluate(() => ({
    center: window.__map.getCenter(),
    zoom: window.__map.getZoom(),
  }));
  // The other pictograms: one solid lighter colour at opacity 1, so an overlapping pair
  // looks like a single one. Step out (focus stays) until the view holds an overlap.
  let cols = { singles: [], overlaps: [] };
  for (let step = 0; step < 6; step++) {
    cols = await pictoColours(page, focusId);
    const z = await page.evaluate(() => window.__map.getZoom());
    if ((cols.singles.length && cols.overlaps.length) || z < 15.3) break;
    await page.evaluate(() =>
      window.__map.jumpTo({ zoom: Math.max(15.2, window.__map.getZoom() - 0.7) }),
    );
    await idle(page);
  }
  const ref = cols.singles[0]?.rgb;
  const same = (rgb) => ref && rgb.every((v, k) => Math.abs(v - ref[k]) <= 6);
  // The punk stickers carry their colours: the others take their dimmed image (layers.ts
  // stickerImage), the camera in focus its own.
  const paint = await page.evaluate(() => ({
    colour: JSON.stringify(window.__map.getPaintProperty("cameras", "icon-color")),
    opacity: window.__map.getPaintProperty("cameras", "icon-opacity") ?? 1,
    image: JSON.stringify(window.__map.getLayoutProperty("cameras", "icon-image")),
  }));
  const byImage = paint.image.includes(`["==",["id"],${focusId}],"-full","-dim"`);
  check(
    "focus: other pictograms one solid lighter colour, overlaps not darker",
    paint.opacity === 1 &&
      byImage &&
      cols.overlaps.length > 0 &&
      [...cols.singles, ...cols.overlaps].every((p) => same(p.rgb)),
    JSON.stringify({
      ref,
      singles: cols.singles.length,
      overlaps: cols.overlaps.map((p) => p.rgb),
      odd: cols.singles.filter((p) => !same(p.rgb)).map((p) => p.rgb),
      image: paint.image.slice(0, 200),
    }),
  );
  await page.evaluate((v) => window.__map.jumpTo(v), view);
  await idle(page);
  const top = await page.evaluate(() => {
    const m = window.__map;
    const layers = m.getStyle().layers;
    const sel = m.queryRenderedFeatures({ layers: ["camera-selected"] })[0];
    if (!sel) return { last: layers[layers.length - 1].id, drawn: false };
    const p = m.project(sel.geometry.coordinates);
    const box = [
      [p.x - 12, p.y - 12],
      [p.x + 12, p.y + 12],
    ];
    return {
      last: layers[layers.length - 1].id,
      drawn: true,
      labelsOver: m.queryRenderedFeatures(box, { layers: ["focus-labels"] }).length,
    };
  });
  check(
    "focus: selected pictogram drawn above every layer, no reach label over it",
    top.last === "camera-selected" && top.drawn && top.labelsOver === 0,
    JSON.stringify(top),
  );
  // The highlight is the filmed portions listing the camera, for the chosen hypothesis:
  // every highlighted feature is such a portion, and its middle lies in a drawn field.
  const cut = await page.evaluate((est) => {
    const m = window.__map;
    const id = JSON.parse(JSON.stringify(m.getFilter("bands-fan")))[1][2];
    const n = m.querySourceFeatures("detail", { sourceLayer: "cameras" }).find((c) => c.id === id)
      ?.properties.n;
    let mine = 0;
    let inField = 0;
    const hi = m.queryRenderedFeatures({ layers: ["focus-streets"] });
    for (const f of hi) {
      const lists = String(f.properties.cs ?? "")
        .split(";")
        .filter(Boolean)
        .some((tok) => {
          const v = Number.parseInt(tok, 36);
          return v % 3 <= est && Math.floor(v / 3) === Number(n);
        });
      if (f.sourceLayer === "portions" && Number(f.properties.b) === est && lists) mine++;
      const c =
        f.geometry.type === "LineString" ? f.geometry.coordinates : f.geometry.coordinates[0];
      const mid = c[Math.floor(c.length / 2)];
      const q = m.project(mid);
      if (m.queryRenderedFeatures([q.x, q.y], { layers: ["bands"] }).length) inField++;
    }
    return { highlighted: hi.length, mine, inField };
  }, focusZone);
  check(
    "focus: highlighted = filmed portions listing the camera, inside fields",
    cut.highlighted > 0 && cut.mine === cut.highlighted && cut.inField >= cut.highlighted * 0.9,
    JSON.stringify(cut),
  );
  // Hovering the field shows the chosen level's label alone, chosen by the sheet's tickets
  // (DECISIONS 2026-10-08, « Punk focus… »).
  const fieldPoint = await page.evaluate((c) => {
    const m = window.__map;
    const r = m.getCanvas().getBoundingClientRect();
    const q = m.project([c.lng, c.lat]);
    return { x: q.x + r.left + 6, y: q.y + r.top + 6 };
  }, focusCam);
  await page.mouse.move(fieldPoint.x, fieldPoint.y);
  await idle(page);
  const hovered = (await focusState()).levels;
  check(
    "focus (punk): hovering the field keeps the chosen level's label alone",
    hovered.every((lv) => lv === 3),
    JSON.stringify(hovered),
  );
  await page.mouse.move(5, 790);
  // « reconnaît » chosen: the map's focused field, outline and label are that level's.
  const ticket = page.locator('#sheet .ticket[data-level="2"]:not([aria-disabled])');
  if (await ticket.count()) {
    await ticket.click();
    await idle(page);
    const chosen = await page.evaluate(() => {
      const m = window.__map;
      return {
        fan: JSON.stringify(m.getFilter("bands-fan")),
        field: JSON.stringify(m.getFilter("focus-field")),
        label: JSON.stringify(m.getFilter("focus-labels")),
        checked: document.querySelector("#sheet .ticket[aria-checked=true]")?.dataset.level,
        drawn: [
          ...new Set(
            m.queryRenderedFeatures({ layers: ["focus-field"] }).map((f) => f.properties.lv),
          ),
        ],
      };
    });
    check(
      "focus (punk): a ticket chosen shows its level alone, with its label",
      chosen.checked === "2" &&
        chosen.fan.includes('["==",["get","lv"],2]') &&
        chosen.field === chosen.fan &&
        chosen.label === '["==",["get","lv"],2]' &&
        chosen.drawn.every((lv) => lv === 2),
      JSON.stringify(chosen),
    );
    // « détecte » chosen, its field the widest: its yellow label lies wholly in the visible
    // map, never under the sheet, « Me localiser » or the other panels (product owner,
    // 2026-10-08; focus.reachLabelPoints).
    await page.locator('#sheet .ticket[data-level="1"]').click();
    await idle(page);
    // The camera brought 120 px left of the sheet: its field runs under the sheet, where
    // its farthest point's label would go.
    await page.evaluate((c) => {
      const m = window.__map;
      const at = m.project([c.lng, c.lat]);
      const edge = document.querySelector("#sheet").getBoundingClientRect().left;
      const dx = edge - m.getContainer().getBoundingClientRect().left - 120 - at.x;
      if (dx > 0) m.panBy([-dx, 0], { duration: 0 });
    }, focusCam);
    await idle(page);
    const tag = await page.evaluate(() => {
      const m = window.__map;
      const origin = m.getContainer().getBoundingClientRect();
      const f = m.queryRenderedFeatures({ layers: ["focus-labels"] })[0];
      if (!f) return { drawn: false };
      const at = m.project(f.geometry.coordinates);
      const icon = f.layer.layout["icon-image"];
      const image = m.getImage(typeof icon === "string" ? icon : (icon?.name ?? ""));
      const [w, h] = image
        ? [image.data.width / image.pixelRatio, image.data.height / image.pixelRatio]
        : [0, 0];
      const box = { left: at.x, right: at.x + w, top: at.y - h / 2, bottom: at.y + h / 2 };
      const over = [...document.querySelectorAll("#sheet, #fabs > *, #ticket, #estimate")]
        .map((el) => [el.id || el.className, el.getBoundingClientRect()])
        .filter(([, r]) => r.width > 0)
        .filter(
          ([, r]) =>
            r.left - origin.left < box.right &&
            r.right - origin.left > box.left &&
            r.top - origin.top < box.bottom &&
            r.bottom - origin.top > box.top,
        )
        .map(([id]) => id);
      const c = m.getCanvas();
      const inside =
        box.left >= 0 && box.top >= 0 && box.right <= c.clientWidth && box.bottom <= c.clientHeight;
      return { drawn: true, w: Math.round(w), box, inside, over };
    });
    check(
      "focus (punk): the level's label lies wholly in the visible map",
      tag.drawn && tag.w > 0 && tag.inside && tag.over.length === 0,
      JSON.stringify(tag),
    );
    await page.locator('#sheet .ticket[data-level="3"]').click();
    await idle(page);
  }
  await page.mouse.move(5, 790);
  // Switching hypothesis during focus leaves one set of outlines, the new one's.
  const fanBands = () =>
    page.evaluate(() => [
      ...new Set(
        window.__map.queryRenderedFeatures({ layers: ["bands-fan"] }).map((f) => f.properties.b),
      ),
    ]);
  await page.locator("#estimate button", { hasText: "Prudent" }).click();
  await idle(page);
  const afterHigh = await fanBands();
  await page.locator("#estimate button", { hasText: "Standard" }).click();
  await idle(page);
  const afterTypical = await fanBands();
  check(
    "focus: switching hypothesis leaves only its outlines",
    afterHigh.length === 1 &&
      afterHigh[0] === 2 &&
      afterTypical.length === 1 &&
      afterTypical[0] === 1,
    JSON.stringify({ afterHigh, afterTypical }),
  );
  await page.keyboard.press("Escape");
  await idle(page);
  fs = await focusState();
  check(
    "Escape leaves focus mode",
    !(await page.locator("#sheet").isVisible()) && !fs.dim && !fs.body && fs.fan.includes("-1"),
    fs.fan,
  );
  await clickFocusCam();
  await idle(page);
  check("click enters focus mode again", (await focusState()).dim);
  const empty = await page.evaluate(() => {
    const m = window.__map;
    const r = m.getCanvas().getBoundingClientRect();
    for (let y = r.top + 60; y < r.bottom - 60; y += 25) {
      for (let x = r.left + 60; x < r.right - 60; x += 25) {
        const onMap = document.elementFromPoint(x, y) === m.getCanvas();
        const hit = m.queryRenderedFeatures([x - r.left, y - r.top], { layers: ["camera-hit"] });
        if (onMap && hit.length === 0) return { x, y };
      }
    }
    return null;
  });
  if (empty) await page.mouse.click(empty.x, empty.y);
  await idle(page);
  fs = await focusState();
  check(
    "click on empty map leaves focus mode",
    empty !== null && !(await page.locator("#sheet").isVisible()) && !fs.dim,
    JSON.stringify(empty),
  );
  page.off("console", onConsole);
  check("focus mode: no console error", consoleErrors.length === 0, consoleErrors.join(" | "));
  await clickFocusCam();
  await idle(page);

  // Hypotheses: the map opens on "Standard" (no est= in the URL); switching to "Prudent"
  // filters bands and streets, goes in the URL (est=prudent) and is restored on reload.
  await page.locator("#sheet .close").click();
  await idle(page);
  const opening = await page.evaluate(() => ({
    bands: JSON.stringify(window.__map.getFilter("bands")),
    url: window.location.search,
    pressed: document.querySelector("#estimate button[aria-pressed=true]")?.textContent,
  }));
  check(
    "opens on Standard",
    opening.bands.includes('["get","b"],1') &&
      !opening.url.includes("est=") &&
      opening.pressed === "Standard",
    JSON.stringify(opening),
  );
  await page.locator("#estimate button", { hasText: "Prudent" }).click();
  await idle(page);
  const est = await page.evaluate(() => ({
    bands: JSON.stringify(window.__map.getFilter("bands")),
    streets: JSON.stringify(window.__map.getFilter("portions")),
    url: window.location.search,
  }));
  check("estimate filters the bands", est.bands.includes('["get","b"],2'), est.bands);
  check("hypothesis picks its filmed portions", est.streets.includes('["get","b"],2'), est.streets);
  check("estimate is in the URL", est.url.includes("est=prudent"), est.url);
  const bandsPrudent = await bandsCount();
  check("prudent bands rendered", bandsPrudent > 0, `${bandsPrudent}`);
  await page.reload();
  await page.waitForFunction(() => window.__map?.loaded());
  await idle(page);
  check(
    "estimate restored from the URL",
    (await page
      .locator("#estimate button", { hasText: "Prudent" })
      .getAttribute("aria-pressed")) === "true" &&
      JSON.stringify(await page.evaluate(() => window.__map.getFilter("bands"))).includes(
        '["get","b"],2',
      ),
  );
  // Old links open the estimate that took their place: typical, probable, certain ->
  // Standard; cautious, possible -> Prudent.
  for (const [value, band] of [
    ["typical", 1],
    ["probable", 1],
    ["certain", 1],
    ["cautious", 2],
    ["possible", 2],
    ["prudent", 2],
  ]) {
    const u = new URL(page.url());
    u.searchParams.set("est", value);
    await page.goto(u.toString());
    await page.waitForFunction(() => window.__map?.loaded());
    const bands = JSON.stringify(await page.evaluate(() => window.__map.getFilter("bands")));
    check(`est=${value} opens band ${band}`, bands.includes(`["get","b"],${band}`), bands);
  }
  await idle(page);
  await page.locator("#estimate button", { hasText: "Standard" }).click();
  await idle(page);
  check(
    "back to Standard: no est= in the URL",
    !(await page.evaluate(() => window.location.search)).includes("est="),
  );

  // Advanced filters: collapsed drawer, counts in view, a row restricts cameras and bands,
  // state in the URL and restored on reload.
  await settle(page, { center: STREET, zoom: 17 });
  await idle(page);
  await openPanel(page);
  check(
    "drawer collapsed by default",
    !(await page.locator("#filters .advanced details").evaluate((d) => d.open)),
  );
  await page.locator("#filters .advanced summary").click();
  const dirRow = page.locator("#filters .advanced label", { hasText: W.dir });
  const dirCount = Number(await dirRow.locator(".count").innerText());
  check("drawer rows count cameras in view", dirCount >= 0, `${dirCount}`);
  check(
    "scope line under the drawer",
    (await page.locator("#filters", { hasText: W.scope }).count()) === 1,
  );
  const camsBefore = await count();
  await dirRow.locator("input").check();
  await idle(page);
  const camsAfter = await count();
  const advUrl = await page.evaluate(() => window.location.search);
  check(
    "direction-unknown filter keeps only those",
    camsAfter <= camsBefore && advUrl.includes("f=direction_unknown"),
    `${camsBefore} -> ${camsAfter}, ${advUrl}`,
  );
  const allUnknown = await page.evaluate(() =>
    window.__map
      .queryRenderedFeatures({ layers: ["cameras"] })
      .every((f) => Math.floor(f.properties.fl / 16) % 2 === 1),
  );
  check("…every camera shown has an unknown direction", allUnknown);
  await page.reload();
  await page.waitForFunction(() => window.__map?.loaded());
  await idle(page);
  await openPanel(page);
  check(
    "advanced filter restored from the URL",
    await page.locator("#filters .advanced label", { hasText: W.dir }).locator("input").isChecked(),
  );
  await page.locator("#filters .advanced label", { hasText: W.dir }).locator("input").uncheck();
  await idle(page);
  // Operator search: a name typed in the box restricts to that operator.
  const opName = await page.evaluate(() => {
    const f = window.__map
      .queryRenderedFeatures({ layers: ["cameras"] })
      .find((x) => x.properties.op !== undefined);
    return f ? f.properties.op : null;
  });
  if (opName !== null) {
    const meta = await page.evaluate(() => fetch("/tiles/meta.json").then((r) => r.json()));
    const name = meta.operators[opName];
    await page.locator("#adv-operator").fill(name);
    await idle(page);
    const ops = await page.evaluate(() =>
      window.__map.queryRenderedFeatures({ layers: ["cameras"] }).map((f) => f.properties.op),
    );
    const ids = meta.operators.map((n, i) =>
      n.toLowerCase().includes(name.toLowerCase()) ? i : -1,
    );
    check(
      "operator search restricts cameras",
      ops.length > 0 && ops.every((o) => ids.includes(o)),
      `${name}: ${ops.length}`,
    );
    await page.locator("#adv-operator").fill("");
    await idle(page);
  }

  // Pictograms are never pale: "maybe gone" is a grey badge (layer camera-gone).
  const picto = await page.evaluate(() => ({
    opacity: window.__map.getPaintProperty("cameras", "icon-opacity") ?? 1,
    badge: JSON.stringify(window.__map.getFilter("camera-gone")),
  }));
  check(
    "pictograms: opaque; 'maybe gone' shown by a badge",
    picto.opacity === 1 && picto.badge.includes('["get","fl"],4'),
    JSON.stringify(picto),
  );

  // The punk interface's stickers (stickers.ts, mockup 16a): plain images, one per type and
  // state, the selected camera's larger; a proposal's ghost answers to `cam-<kind>`, which
  // no other layer asks for; a change of the phone's mode draws them again, on the map and
  // in the filter panel, exactly as a page opened in that mode.
  const kinds = ["dome", "multidome", "fixed", "ptz", "panorama", "alpr", "doorbell", "unknown"];
  const images = await page.evaluate((ks) => {
    const m = window.__map;
    const names = ks.flatMap((k) => [
      ...["full", "dim", "gone", "full-big", "gone-big"].map((s) => `sticker-${k}-${s}`),
      `cam-${k}`,
    ]);
    return {
      missing: names.filter((n) => !m.hasImage(n)),
      sdf: names.filter((n) => m.style.getImage(n)?.sdf),
      cam: m
        .getStyle()
        .layers.filter((l) => JSON.stringify(l.layout?.["icon-image"] ?? "").includes('"cam-"'))
        .map((l) => l.id),
    };
  }, kinds);
  check(
    "punk: a sticker per type and state, plain images; only the proposals' ghost asks cam-*",
    !images.missing.length &&
      !images.sdf.length &&
      images.cam.every((id) => id === "proposal-ghost"),
    JSON.stringify(images),
  );
  await settle(page, { center: STREET, zoom: 17 });
  // A fingerprint of every sticker image and of the filter panel's samples.
  const prints = (p) =>
    p.evaluate((ks) => {
      const m = window.__map;
      const hash = (bytes) => {
        let h = 2166136261;
        for (let i = 0; i < bytes.length; i += 3) h = Math.imul(h ^ bytes[i], 16777619);
        return (h >>> 0).toString(16);
      };
      const names = ks.flatMap((k) => [`sticker-${k}-full`, `sticker-${k}-dim`, `cam-${k}`]);
      const samples = [...document.querySelectorAll("#filters canvas.sample")].map((c) =>
        hash(new TextEncoder().encode(c.toDataURL())),
      );
      return {
        map: names.map((n) => hash(m.style.getImage(n).data.data)).join(" "),
        samples: samples.join(" "),
        water: JSON.stringify(
          ["water-over-fields", "water-shore"].map(
            (id) => m.getStyle().layers.find((l) => l.id === id)?.paint,
          ),
        ),
      };
    }, kinds);
  const light = await prints(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.mode === "dark");
  await idle(page);
  const switched = await prints(page);
  // The same page (its query and position in the URL) opened in dark.
  const fresh = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
  });
  await fresh.goto(page.url());
  await fresh.waitForFunction(() => window.__map?.loaded());
  await idle(fresh);
  const opened = await prints(fresh);
  await fresh.close();
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.mode === "light");
  await idle(page);
  const back = await prints(page);
  check(
    "punk: a change of mode draws the stickers again (map and panel), as a page opened in it",
    switched.map !== light.map &&
      switched.map === opened.map &&
      switched.samples === opened.samples &&
      switched.samples !== light.samples &&
      back.map === light.map &&
      back.samples === light.samples,
    JSON.stringify({
      samples: light.samples.split(" ").length,
      darkEqual: [switched.map === opened.map, switched.samples === opened.samples],
      lightEqual: [back.map === light.map, back.samples === light.samples],
    }),
  );
  check(
    "punk: a change of mode paints the water over the fields and its shore as a page opened in it",
    light.water !== switched.water &&
      switched.water === opened.water &&
      back.water === light.water &&
      !light.water.includes("null"),
    JSON.stringify({ light: light.water, dark: switched.water, opened: opened.water }),
  );

  // Filters act on the merged axes too (z11-13): the "direction unknown" row keeps axes
  // whose bit is set in fb<zone> (recomputed here from the tiles' bit layout); two groups
  // combined say they are approximate; the operator search says it waits for z14.
  await settle(page, { center: STREET, zoom: 12.5 });
  await idle(page);
  await openPanel(page);
  if (!(await page.locator("#filters .advanced details").evaluate((d) => d.open))) {
    await page.locator("#filters .advanced summary").click();
  }
  await page.locator("#filters .advanced label", { hasText: W.dir }).locator("input").check();
  await idle(page);
  const low = await page.evaluate(
    async (zone) => {
      const m = window.__map;
      const key = "fb";
      const meta = await fetch("/tiles/meta.json").then((r) => r.json());
      const bit = meta.segment_bits.direction_unknown;
      const color = JSON.stringify(m.getPaintProperty("portions", "line-color"));
      let kept = 0;
      let dimmed = 0;
      for (const f of m.queryRenderedFeatures({ layers: ["portions"] })) {
        if (f.properties[key] === undefined || Number(f.properties.b) !== zone) continue;
        if (Math.floor(f.properties[key] / 2 ** bit) % 2 === 1) kept++;
        else dimmed++;
      }
      return {
        usesBits: color.includes(`"${key}"`) && color.includes(String(2 ** bit)),
        kept,
        dimmed,
      };
    },
    await chosenBand(page),
  );
  check(
    "z12: filters act on the merged filmed intervals through their bits",
    low.usesBits && low.kept > 0 && low.dimmed > 0,
    JSON.stringify(low),
  );
  await page.locator("#filters .advanced label", { hasText: W.height }).locator("input").check();
  await idle(page);
  check(
    "z12: two criteria in one group stay exact (no approximation line)",
    (await page.locator("#filters .filter-approx").count()) === 0,
  );
  await page.locator("#filters .advanced label", { hasText: W.never }).locator("input").check();
  await idle(page);
  check(
    "z12: two groups combined say they are approximate",
    (await page.locator("#filters .filter-approx").count()) === 1,
  );
  for (const row of [W.dir, W.height, W.never]) {
    await page.locator("#filters .advanced label", { hasText: row }).locator("input").uncheck();
  }
  await page.locator("#adv-operator").fill("Ville");
  await idle(page);
  check(
    "z12: the operator search says it applies from z15",
    (await page.locator("#filters", { hasText: "qu'à partir du zoom rue" }).count()) === 1,
  );
  await page.locator("#adv-operator").fill("");
  await idle(page);

  // Every camera in view has its pictogram drawn (no symbol placement hides one), with or
  // without a filter.
  for (const zoom of [16, 17, 18]) {
    await settle(page, { center: STREET, zoom });
    await idle(page);
    const r = await missingPictos(page);
    check(
      `z${zoom}: every camera in view has its pictogram`,
      r.want > 0 && !r.missing.length,
      JSON.stringify(r),
    );
  }
  await openPanel(page);
  const domeRow = page.locator("#filters label.toggle", { hasText: /dôme/i });
  if (await domeRow.count()) {
    await domeRow.locator("input").uncheck();
    await idle(page);
    const filtered = await missingPictos(page);
    check(
      "z18, a type filtered out: every kept camera has its pictogram",
      !filtered.missing.length,
      JSON.stringify(filtered),
    );
    await domeRow.locator("input").check();
    await idle(page);
  }

  // City view: communes (and départements) under the basemap's labels, a click opens the
  // commune's sheet, the IGN attribution shows while they are drawn.
  await settle(page, { center: STREET, zoom: 10 });
  await idle(page);
  const city = await page.evaluate((at) => {
    const m = window.__map;
    const p = m.project(at);
    const f = m.queryRenderedFeatures([p.x, p.y], {
      layers: ["communes", "communes-none"],
    })[0];
    return {
      communes: m.queryRenderedFeatures({ layers: ["communes", "communes-none"] }).length,
      code: f?.properties.c ?? null,
      name: f?.properties.nm ?? null,
      point: [p.x, p.y],
    };
  }, STREET);
  check("z10: communes drawn", city.communes > 0 && city.code !== null, JSON.stringify(city));
  check(
    "z10: IGN attribution shown",
    (await page.locator(".maplibregl-ctrl-attrib").innerText()).includes("IGN"),
  );
  await page.mouse.click(city.point[0], city.point[1]);
  await page.waitForTimeout(400);
  const areaSheet = await page.evaluate(() => ({
    visible: !document.getElementById("sheet").hidden,
    name: document.querySelector("#sheet .area-name")?.textContent ?? "",
    head: document.querySelector("#sheet .headline")?.textContent ?? "",
    streets: document.querySelector("#sheet #area-tab-streets")?.getAttribute("aria-label") ?? "",
    text: document.getElementById("sheet").innerText,
    selected: JSON.stringify(window.__map.getFilter("communes-selected")),
  }));
  check(
    "click on a commune opens its sheet and outlines it",
    areaSheet.visible &&
      areaSheet.name === city.name &&
      // Mockup 24a with Y only, as a maximum: « 1 sur N rues à portée » (or « N sur 10 »,
      // or the percentage; 2026-10-08), never X nor a certainty (DECISIONS 2026-10-06,
      // « Punk commune and département sheets… »); the 100 m street without « au plus » /
      // « au moins » (2026-10-08), the ticket and the colour line neither (2026-10-09,
      // « Punk sheets on a phone… »).
      AREA_TICKET.test(areaSheet.streets) &&
      !/Entre [\d,]+ %|à coup sûr|direction connue|au moins|au\splus/.test(areaSheet.text) &&
      areaSheet.selected.includes(`"${city.code}"`),
    JSON.stringify({ ...areaSheet, text: undefined }),
  );
  // Its colour on the map in words, its class's range « des rues à portée » (2026-10-09).
  const place = await page
    .waitForSelector("#sheet .area-place-text", { timeout: 10000 })
    .then((e) => e.textContent())
    .catch(() => "");
  check("punk commune sheet: its colour's class in words", AREA_PLACE.test(place), place);
  const fit = await page.evaluate(AREA_FIT);
  check(
    "punk commune sheet: no sideways scroll, title left of ×, the cursor over its ramp",
    fit.sideways.length === 0 && fit.title <= fit.buttons && fit.cursor,
    JSON.stringify(fit),
  );
  // 24a's tickets are tabs: a click and the arrows choose, the panel follows.
  await page.click("#area-tab-cameras");
  await page.keyboard.press("ArrowRight");
  const tabs = await page.evaluate(() => ({
    selected: [...document.querySelectorAll("#sheet [role=tab]")]
      .filter((b) => b.getAttribute("aria-selected") === "true")
      .map((b) => b.id),
    focused: document.activeElement?.id ?? "",
    panel: document.getElementById("area-panel")?.getAttribute("aria-labelledby") ?? "",
  }));
  check(
    "punk commune sheet: its tickets are tabs (click, arrows), the panel follows",
    tabs.selected.join() === "area-tab-who" &&
      tabs.focused === "area-tab-who" &&
      tabs.panel === "area-tab-who",
    JSON.stringify(tabs),
  );
  // « Qui filme ? » ends with every camera by operator class; « La liste des caméras »
  // counts them by type, each row with its sticker (24a, 16a): both add up to the ticket.
  const counted = () =>
    page.evaluate(() => ({
      n: Number.parseInt(document.querySelector("#area-tab-cameras .area-tab-v").textContent, 10),
      rows: [...document.querySelectorAll("#area-panel .area-list li")].map((li) => ({
        n: Number(li.querySelector(".area-count")?.textContent),
        sticker: li.querySelector(".area-sticker canvas") !== null,
      })),
    }));
  const byClass = await counted();
  await page.click("#area-tab-cameras");
  const byKind = await counted();
  const sum = (c) => c.rows.reduce((s, r) => s + r.n, 0);
  check(
    "punk commune sheet: cameras by type with stickers, by operator class in « Qui filme ? »",
    byClass.rows.length === 4 &&
      sum(byClass) === byClass.n &&
      byKind.rows.length > 0 === byKind.n > 0 &&
      byKind.rows.every((r) => r.sticker && r.n > 0) &&
      sum(byKind) === byKind.n,
    JSON.stringify({ byClass, byKind }),
  );
  await page.waitForTimeout(900);
  await idle(page);
  const framedC = await areaFramed(page, city.code);
  check("clicked commune framed between the panels", framedC.free, JSON.stringify(framedC));
  await page.keyboard.press("Escape");
  await settle(page, { center: STREET, zoom: 6 });
  await idle(page);
  const depHit = await page.evaluate((at) => {
    const m = window.__map;
    const p = m.project(at);
    const f = m.queryRenderedFeatures([p.x, p.y], { layers: ["deps", "deps-none"] })[0];
    return {
      drawn: m.queryRenderedFeatures({ layers: ["deps", "deps-none"] }).length,
      code: f?.properties.c ?? null,
      point: [p.x, p.y],
    };
  }, STREET);
  check("z6: départements drawn", depHit.drawn > 0 && depHit.code !== null, JSON.stringify(depHit));
  await page.mouse.click(depHit.point[0], depHit.point[1]);
  await page.waitForTimeout(1200);
  await idle(page);
  const framedD = await areaFramed(page, depHit.code);
  check(
    "clicked département: its sheet, framed between the panels",
    framedD.free && (await page.locator("#sheet .area-name").isVisible()),
    JSON.stringify(framedD),
  );
  await page.keyboard.press("Escape");
  await settle(page, { center: STREET, zoom: 16 });
  check(
    "z16: no IGN attribution (no commune drawn)",
    !(await page.locator(".maplibregl-ctrl-attrib").innerText()).includes("IGN"),
  );

  // Our surfaces and lines are under the basemap's labels; pictograms and reach labels above.
  const order = await page.evaluate(() => {
    const layers = window.__map.getStyle().layers;
    const ours = new Set(["admin", "admin7", "streets", "detail", "focus-points"]);
    const labels = layers.flatMap((l, i) =>
      l.source === "protomaps" && l.type === "symbol" ? [i] : [],
    );
    const above = ["focus-labels", "camera-hit", "cameras", "camera-gone", "camera-selected"];
    const below = layers.flatMap((l, i) =>
      ours.has(l.source) && !above.includes(l.id) ? [i] : [],
    );
    const aboveIdx = layers.flatMap((l, i) => (above.includes(l.id) ? [i] : []));
    return {
      labels: labels.length,
      below: Math.max(...below) < Math.min(...labels),
      above: Math.min(...aboveIdx) > Math.max(...labels),
    };
  });
  check(
    "layer order: surfaces under the labels, pictograms above",
    order.labels > 0 && order.below && order.above,
    JSON.stringify(order),
  );

  // Punk (product owner, 2026-10-15): the basemap's roads, paths, piers, ramps and bridges
  // drawn again above the fields from the street level (z15, layers.ts DETAIL_MIN), fill and
  // outline, after the buildings, in the flavour's order and its paint, under our streets and
  // every label; the flavour's own stop there; tunnels and railways stay below.
  const roads = await page.evaluate(() => {
    const layers = window.__map.getStyle().layers;
    const at = (id) => layers.findIndex((l) => l.id === id);
    const where = (p) => layers.flatMap((l, i) => (p(l) ? [i] : []));
    const ground = layers.filter(
      (l) => l.source === "protomaps" && l["source-layer"] === "roads" && l.type === "line",
    );
    const lifted = layers.filter((l) => l.id.endsWith("-lifted"));
    const own = (l) => ground.find((g) => `${g.id}-lifted` === l.id);
    // Where a copy shows: its opacity's step (it is in the two parent zooms' tiles too,
    // invisible there, lot P), else its minzoom.
    const shows = (l) => {
      const o = l.paint?.["line-opacity"];
      return Array.isArray(o) && o[0] === "step" ? o[3] : l.minzoom;
    };
    const rest = (paint) => JSON.stringify({ ...paint, "line-opacity": undefined });
    const fields = where((l) => /^(field-|focus-zone-|bands-fan$|focus-field$)/.test(l.id));
    const up = where((l) => l.id.endsWith("-lifted"));
    return {
      lifted: lifted.length,
      ids: lifted.map((l) => l.id.replace(/-lifted$/, "")),
      flavourOrder: lifted.every(
        (l, i) => i === 0 || ground.indexOf(own(l)) > ground.indexOf(own(lifted[i - 1])),
      ),
      samePaint: lifted.every(
        (l) =>
          own(l) &&
          rest(l.paint) === rest(own(l).paint) &&
          JSON.stringify(l.paint["line-opacity"]) ===
            JSON.stringify(["step", ["zoom"], 0, shows(l), own(l).paint["line-opacity"] ?? 1]),
      ),
      fromStreetLevel: lifted.every((l) => shows(l) >= 15 && !(l.maxzoom <= 15)),
      // In the tiles of the two zooms below (a loading zoom draws its parent's tiles).
      inParents: lifted.every((l) => l.minzoom === shows(l) - 2),
      // The paths' lines (the flavour's `other`) from z16, where their portions start.
      pathsFrom16: lifted.every(
        (l) => /^roads_(bridges_)?other(_casing)?-lifted$/.test(l.id) === (shows(l) === 16),
      ),
      groundStops: ground
        .filter((g) => lifted.some((l) => own(l) === g))
        // Each flavour layer stops where its copy shows.
        .every((g) => g.maxzoom === shows(lifted.find((l) => own(l) === g))),
      // The others keep the flavour's own stop (its `_casing_early`, z12) or none.
      othersKept: ground
        .filter((g) => !lifted.some((l) => own(l) === g))
        .every((g) => g.maxzoom !== 15 && g.maxzoom !== 16),
      aboveFields: up.length > 0 && Math.min(...up) > Math.max(...fields, at("buildings")),
      underStreets: Math.max(...up) < Math.min(at("streets"), at("portions"), at("focus-streets")),
      underLabels:
        Math.max(...up) < layers.findIndex((l) => l.source === "protomaps" && l.type === "symbol"),
    };
  });
  const LIFTS = ["roads_other", "roads_pier", "roads_link", "roads_minor", "roads_bridges_other"];
  check(
    "punk: the basemap's roads, paths and piers drawn again above the fields (fill and outline) and the buildings from z15 (the paths' lines from z16, with their portions), in their own style, under our streets and the labels",
    LIFTS.every((id) => roads.ids.includes(id)) &&
      !roads.ids.some((id) => /^roads_(tunnels_|rail)/.test(id)) &&
      roads.flavourOrder &&
      roads.samePaint &&
      roads.fromStreetLevel &&
      roads.inParents &&
      roads.pathsFrom16 &&
      roads.groundStops &&
      roads.othersKept &&
      roads.aboveFields &&
      roads.underStreets &&
      roads.underLabels,
    JSON.stringify(roads),
  );

  // Punk (product owner, 2026-10-15): the basemap's water drawn again over every camera's
  // fields from z15, see through, with its shore line, under the focused camera's zone (its
  // outline stays clear) and the lifted roads; the flavour's water kept under the fields at
  // every zoom (the copy over it the same colour: nothing changes where there is no field).
  const water = await page.evaluate(() => {
    const layers = window.__map.getStyle().layers;
    const at = (id) => layers.findIndex((l) => l.id === id);
    const get = (id) => layers.find((l) => l.id === id);
    const [ground, over, shore] = ["water", "water-over-fields", "water-shore"].map(get);
    const ups = layers.flatMap((l, i) => (l.id.endsWith("-lifted") ? [i] : []));
    return {
      over: !!over,
      shore: !!shore,
      groundKept: !!ground && ground.maxzoom === undefined,
      // Shown from z15, in the two parent zooms' tiles too (lot P).
      fromStreetLevel:
        over?.minzoom === 13 &&
        shore?.minzoom === 13 &&
        JSON.stringify(over.paint["fill-opacity"].slice(0, 4)) === '["step",["zoom"],0,15]',
      sameWater:
        !!over &&
        over.source === ground.source &&
        over["source-layer"] === ground["source-layer"] &&
        JSON.stringify(over.filter) === JSON.stringify(ground.filter) &&
        over.paint["fill-color"] === ground.paint["fill-color"],
      seeThrough: over?.paint["fill-opacity"][4] > 0 && over?.paint["fill-opacity"][4] < 1,
      shoreLine:
        shore?.type === "line" &&
        shore["source-layer"] === "water" &&
        shore.paint["line-width"] === 1 &&
        shore.paint["line-color"] !== ground.paint["fill-color"],
      aboveFields: at("water-over-fields") > Math.max(at("field-3"), at("field-3-line")),
      shoreAbove: at("water-shore") === at("water-over-fields") + 1,
      underFocus:
        at("water-shore") < Math.min(at("focus-zone-1-line"), at("bands-fan"), at("focus-field")),
      underRoads: ups.length > 0 && at("water-shore") < Math.min(...ups, at("buildings")),
    };
  });
  check(
    "punk: the water drawn again over the fields from z15, see through, its shore above, under the focused zone, the buildings and the lifted roads; the flavour's own kept",
    Object.values(water).every(Boolean),
    JSON.stringify(water),
  );

  // Below the street level the panel counts the cameras of the communes in view (no more
  // hexagons): at z10 where they are drawn, at z13 from the invisible counting layer.
  for (const zoom of [10, 13]) {
    await settle(page, { center: STREET, zoom });
    await idle(page);
    await openPanel(page);
    const row = await page.locator("#filters label.toggle", { hasText: W.all });
    const n = Number((await row.locator(".count").innerText()).replace(/[^0-9]/g, ""));
    const hex = await page.evaluate(() =>
      window.__map.getStyle().layers.some((l) => l.source === "cells"),
    );
    check(`z${zoom}: camera count from the communes (≈ ${n}), no hexagon layer`, n > 0 && !hex);
  }

  // Streets under every simple filter (and two combined), at each half zoom from 12 to 16,
  // in both hypotheses: the portions a filter keeps are drawn wherever the data hold some,
  // and none it excludes. "Drawn" is the portions layer's own opacity expression evaluated
  // on each rendered feature with its feature-state. Then a zoom animated across z14 is
  // sampled frame by frame: the kept streets vanished there on an iPhone while zooming
  // (unmarked portions hidden until the map was idle).
  {
    const fr = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url)));
    const OPS = ["pub", "pro", "pri", "unk"];
    const KINDS = ["dome", "multidome", "fixed", "ptz", "panorama", "alpr", "doorbell", "unknown"];
    const ROWS = [
      "fresh_lt1",
      "fresh_1to3",
      "fresh_gt3",
      "fresh_never",
      "maybe_gone",
      "gone",
      "legacy_import",
      "direction_unknown",
      "type_unknown",
      "height_unknown",
      "in_building",
      "plate_reading",
      "ptz",
      "night_vision",
      "analytics",
      "identifies_far",
    ]; // prettier-ignore
    const specs = [
      ...OPS.map((v) => ({ name: `who=${v}`, op: v })),
      ...KINDS.map((v) => ({ name: `type=${v}`, kind: v })),
      ...ROWS.map((v) => ({ name: v, row: v })),
      { name: "who=pub + direction_unknown", op: "pub", row: "direction_unknown" },
      { name: "type=dome + fresh_never", kind: "dome", row: "fresh_never" },
    ];
    // Uncheck every row of a "who" or "type" list but `keep`'s; returns the codes left
    // checked. The panel lists only the categories with a camera in view: one without a row
    // stays checked, and the streets it films are kept wherever they come into view (the
    // whole CI extract is in view at z15; on IDF a type absent from the street's z15 view
    // may film streets of the z12.5-13 view around it).
    // Punk: its keys write 20a's short names (fr.json filters.who.*, filters.kind.*), and
    // « Inconnu » names both a key of « Qui filme » and a type: each set is its own rows.
    const only = async (codes, keep, prefix) => {
      const left = [];
      await openPanel(page);
      for (const c of codes) {
        const key = `filters.${prefix === "op" ? "who" : "kind"}.${c}`;
        const label = fr[key].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const set = prefix === "op" ? "[data-op]" : "[data-kind]";
        const row = page
          .locator(`#filters label.toggle${set}`)
          .filter({ has: page.locator(".label", { hasText: new RegExp(`^${label}$`) }) })
          .filter({ visible: true });
        if (c !== keep && (await row.count())) await row.first().locator("input").uncheck();
        else left.push(c);
      }
      return left;
    };
    // In the page: portions of the chosen estimate rendered now, kept (by their bits when
    // merged, by their cameras otherwise) and drawn.
    const measure = (spec) =>
      page.evaluate(async (spec) => {
        const m = window.__map;
        window.__streetTable ??= await fetch("/tiles/cameras.json").then((r) => r.json());
        window.__streetMeta ??= await fetch("/tiles/meta.json").then((r) => r.json());
        const t = window.__streetTable;
        const meta = window.__streetMeta;
        const est = Number(JSON.parse(JSON.stringify(m.getFilter("portions")))[2]);
        const flag = (fl, name) => Math.floor(fl / 2 ** meta.flag_bits[name]) % 2 === 1;
        const rowOk = (row, fl) => {
          if (!row) return true;
          if (row === "gone") return false; // a camera verified gone films nothing
          if (row.startsWith("fresh_"))
            return fl % 4 === ["fresh_lt1", "fresh_1to3", "fresh_gt3", "fresh_never"].indexOf(row);
          return flag(fl, row === "identifies_far" ? `identifies_far_${est}` : row);
        };
        const camOk = (n) =>
          (!spec.ops || spec.ops.includes(t.ops[t.o[n]])) &&
          (!spec.kinds || spec.kinds.includes(t.kinds[t.k[n]])) &&
          rowOk(spec.row, t.fl[n]);
        const bit = (fb, name) => {
          const b = meta.segment_bits[name];
          return b !== undefined && Math.floor(fb / 2 ** b) % 2 === 1;
        };
        const mergedOk = (fb) =>
          (!spec.ops || spec.ops.some((o) => bit(fb, `op:${o}`))) &&
          (!spec.kinds || spec.kinds.some((k) => bit(fb, `kind:${k}`))) &&
          (!spec.row ||
            bit(fb, spec.row === "identifies_far" ? `identifies_far_${est}` : spec.row));
        const opacity = m.style.getLayer("portions").paint.get("line-opacity");
        const out = { z: Number(m.getZoom().toFixed(2)), kept: 0, drawn: 0, excludedDrawn: 0 };
        for (const f of m.queryRenderedFeatures({ layers: ["portions"] })) {
          const p = f.properties;
          const ok =
            f.id === undefined
              ? mergedOk(Number(p.fb ?? 0))
              : String(p.cs ?? "")
                  .split(";")
                  .filter(Boolean)
                  .map((tok) => Number.parseInt(tok, 36))
                  .some((v) => v % 3 <= est && camOk(Math.floor(v / 3)));
          const state =
            f.id === undefined
              ? {}
              : m.getFeatureState({ source: "streets", sourceLayer: "portions", id: f.id });
          const drawn = opacity.evaluate({ type: 2, properties: p, id: f.id }, state, null, []) > 0;
          if (ok) out.kept++;
          if (ok && drawn) out.drawn++;
          if (!ok && drawn) out.excludedDrawn++;
        }
        return out;
      }, spec);
    // Every filter in Standard; in Prudent "publique" and a combination (CI time).
    for (const est of ["", "prudent"]) {
      const bad = [];
      const widened = new Set(); // a filter that keeps categories without a row
      let tested = 0;
      for (const spec of est ? [specs[0], specs.at(-2)] : specs) {
        const f = spec.row ? `f=${spec.row}` : "";
        const q = [est && "est=prudent", f].filter(Boolean).join("&");
        // A fresh page each time: goto alone keeps the document when only the hash changes.
        await page.goto(`${APP}${q ? `?${q}` : ""}#15/${STREET[1]}/${STREET[0]}`);
        await page.reload();
        await page.waitForFunction(() => window.__map?.loaded());
        await idle(page);
        // What the panel now keeps: the spec's category and those without a row.
        const kept = { ...spec };
        if (spec.op) kept.ops = await only(OPS, spec.op, "op");
        if (spec.kind) kept.kinds = await only(KINDS, spec.kind, "kind");
        for (const left of [kept.ops, kept.kinds])
          if (left?.length > 1) widened.add(`${spec.name}: ${left.join("+")}`);
        await page.waitForFunction(() =>
          JSON.stringify(window.__map.getPaintProperty("portions", "line-opacity")).includes(
            "feature-state",
          ),
        );
        // Streets fade in over z12-12.5 (layers.STREET_FADE): nothing is drawn at z12 itself.
        for (const z of [12.5, 13, 14, 15, 16]) {
          await settle(page, { center: STREET, zoom: z });
          const r = await measure(kept);
          if (r.kept) tested++;
          if ((r.kept && !r.drawn) || r.excludedDrawn) bad.push({ filter: spec.name, ...r });
        }
      }
      check(
        `${est || "standard"}: filters draw the streets they keep at z12-16, none they exclude`,
        bad.length === 0 && tested >= (est ? 8 : 60),
        JSON.stringify({ tested, bad: bad.slice(0, 6), widened: [...widened] }),
      );
      // Across z15 while zooming (the merged portions end at z14, lot P): some kept street
      // drawn at every frame.
      const spec = specs[0];
      await page.goto(`${APP}${est ? "?est=prudent" : ""}#15/${STREET[1]}/${STREET[0]}`);
      await page.reload();
      await page.waitForFunction(() => window.__map?.loaded());
      await idle(page);
      const kept = { ...spec, ops: await only(OPS, spec.op, "op") };
      await settle(page, { center: STREET, zoom: 14.2 });
      await idle(page);
      // Streets tiles answer 600 ms late, as on a phone: the z14 tiles stay drawn past z15
      // while the z15 ones load.
      const slow = (route) => setTimeout(() => route.continue().catch(() => {}), 600);
      await page.route("**/tiles/streets.pmtiles", slow);
      const frames = [];
      await page.evaluate(() =>
        window.__map.easeTo({ zoom: 15.9, duration: 2500, easing: (x) => x }),
      );
      for (let i = 0; i < 14; i++) {
        frames.push(await measure(kept));
        await page.waitForTimeout(150);
      }
      await page.unroute("**/tiles/streets.pmtiles", slow);
      const short = frames.filter((r) => r.kept && r.drawn < 0.9 * r.kept);
      check(
        `${est || "standard"}: "publique" streets drawn at every sampled frame zooming across z15`,
        short.length === 0 && frames.some((r) => r.z >= 15 && r.drawn),
        JSON.stringify(frames.map((r) => [r.z, r.kept, r.drawn])),
      );
    }
  }

  // Punk (DECISIONS 2026-10-09): filters that hide every camera or every filmed street of
  // the view say so on the map with « Tout réafficher »; filters set in the street view are
  // told in the machine at every zoom, and counted on « Filtres et légende (N) ».
  {
    const told = () =>
      page.evaluate(() => {
        const empty = document.getElementById("filters-empty");
        const line = document.querySelector("#filters .street-active");
        return {
          z: Math.round(window.__map.getZoom() * 10) / 10,
          empty: empty && !empty.hidden ? empty.innerText.replace(/\s+/g, " ").trim() : null,
          line: line && !line.hidden ? line.innerText.replace(/\s+/g, " ").trim() : null,
          fab: document.getElementById("fab-filters").innerText.trim(),
        };
      });
    // A filter with a bit no camera here sets (PTZ): it hides the streets below z15 too,
    // where the operator search no longer applies to them (lot P).
    await page.goto(`${APP}?f=ptz#16.5/${STREET[1]}/${STREET[0]}`);
    await page.reload();
    await page.waitForFunction(() => window.__map?.loaded());
    await idle(page);
    const street = await told();
    await settle(page, { center: STREET, zoom: 14.5 });
    await idle(page);
    const streets = await told();
    await settle(page, { center: STREET, zoom: 13 });
    await idle(page);
    await openPanel(page);
    const low = await told();
    await page.locator("#filters .street-active .reset-link").click();
    await idle(page);
    const reset = await told();
    const search = await page.evaluate(() => window.location.search);
    check(
      "punk: filters hiding every camera, then every filmed street, told on the map (at z13 too); told in the machine at z13; « Tout réafficher » clears them",
      street.empty === "Les filtres cachent toutes les caméras de la vue. Tout réafficher" &&
        streets.empty ===
          "Les filtres cachent toutes les rues filmées de la vue. Tout réafficher" &&
        // PTZ is a bit: it hides the streets at z13 too (an operator search did not).
        low.empty?.startsWith("Les filtres cachent toutes les rues filmées de la vue.") &&
        low.line === "1 filtre actif en vue rue · Tout réafficher" &&
        low.fab === "Filtres et légende (1)" &&
        reset.line === null &&
        reset.empty === null &&
        reset.fab === "Filtres et légende" &&
        !search.includes("f="),
      JSON.stringify({ street, streets, low, reset, search }),
    );
    await page.keyboard.press("Escape");
  }

  // A pending add (the participation API mocked: this preview has none) answers as a
  // camera from the stickers' zoom: its ghost has a camera's target (22 px) and a hover
  // ring (the iPhone test's « caméra anormale », 2026-10-09); below it nothing is drawn,
  // nothing answers (DECISIONS 2026-10-09, « Pending proposals… »).
  const at = [STREET[0] + 0.0004, STREET[1] + 0.0003];
  const add = {
    type: "Feature",
    geometry: { type: "Point", coordinates: at },
    properties: {
      ...{ u: "11111111-2222-4333-8444-555555555555", c: "c111111112222", k: "add" },
      ...{ ck: "dome", s: "pending", month: "2026-10", n: 0, d: 0, m: false, o: null },
    },
  };
  const ghost = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  ghost.on("pageerror", (e) => errors.push(String(e)));
  await ghost.route("**/api/**", (r) =>
    r.request().url().includes("/api/proposals")
      ? r.fulfill({ json: { type: "FeatureCollection", features: [add] } })
      : r.fulfill({ json: { name: "smoke", review: false } }),
  );
  const answers = [];
  for (const [z, dx] of [
    [14.2, 0],
    [16, 17],
  ]) {
    await ghost.goto(`${APP}?r=${z}#${z}/${at[1]}/${at[0]}`);
    await ghost.waitForFunction(() => window.__map?.loaded() && window.__map.areTilesLoaded());
    await ghost.waitForTimeout(1200);
    const p = await ghost.evaluate((a) => window.__map.project(a), at);
    const box = await ghost.locator("#map canvas").boundingBox();
    await ghost.mouse.move(box.x + p.x + dx, box.y + p.y);
    await ghost.waitForTimeout(300);
    const cursor = await ghost.evaluate(() => window.__map.getCanvas().style.cursor);
    await ghost.mouse.click(box.x + p.x + dx, box.y + p.y);
    await ghost
      .waitForFunction(() => !document.getElementById("sheet").hidden, null, { timeout: 5000 })
      .catch(() => {});
    answers.push({
      z,
      dx,
      cursor,
      sheet: await ghost.evaluate(() => !document.getElementById("sheet").hidden),
    });
  }
  await ghost.close();
  check(
    "punk: a pending add takes the hand and opens its sheet from z15, its ghost 17 px off; nothing below",
    answers[0].cursor === "" &&
      !answers[0].sheet &&
      answers[1].cursor === "pointer" &&
      answers[1].sheet,
    JSON.stringify(answers),
  );

  // The account's screens (lot « comptes », board 25a), the API simulated
  // (bench/account.mjs).
  await accountSmoke(browser, {
    app: APP,
    street: STREET,
    phone: false,
    check,
    context: { viewport: { width: 1280, height: 800 } },
  });

  // Narrow screen: the panel is a full-screen layer behind the "Filtres" button (the phone
  // itself is covered by smoke-mobile.mjs).
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await page.waitForFunction(() => window.__map?.loaded());
  await page.waitForTimeout(500);
  check(
    "narrow: filters hidden behind their button",
    !(await page.locator("#filters").isVisible()),
  );
  check("narrow: 'Filtres' button shown", await page.locator("#fab-filters").isVisible());

  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.kill();
}
process.exit(checks.every((c) => c.ok) ? 0 : 1);
