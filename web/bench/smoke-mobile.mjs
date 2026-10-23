// Smoke test on a phone: the "iPhone 14" device profile, in WebKit (every iPhone browser
// is WebKit) by default, Chromium with --browser chromium. Real taps only: a JS click
// would pass through what covers an element, which is the bug class under test.
//   node bench/smoke-mobile.mjs [--region idf|ci] [--browser webkit|chromium] [--port N]
import { spawn } from "node:child_process";
import { chromium, devices, webkit } from "playwright";
import { accountSmoke } from "./account.mjs";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { benchBrowser } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const region = arg("--region", "idf");
requireTiles(region);
const engine = arg("--browser", "webkit");
// Repeated taps: 5 in CI, 20 with `make smoke-full`.
const TAPS = Number(arg("--taps", "5"));
const PART = Number(arg("--part", "0")); // 0: the whole test
const PORT = Number(arg("--port", "4180"));
const APP = `http://localhost:${PORT}/`;
const STREET = region === "ci" ? [2.2377, 48.8977] : [2.3485, 48.8597];
// A position for "Me localiser", near the street, given by the emulated device.
const HERE = { latitude: STREET[1] + 0.0004, longitude: STREET[0] + 0.0006 };
const MIN_TARGET = 44;
const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// A duration's limit: binding here and in the local gate; with BENCH_TIMING=report (CI's
// shared machines, whose timings vary) measured and printed, over the limit a warning in
// the run's annotations, never a failure. What happened is checked either way.
const TIMING_REPORT = process.env.BENCH_TIMING === "report";
function within(name, ms, limit) {
  const ok = ms !== null && ms <= limit;
  if (!TIMING_REPORT) return ok;
  console.log(`time [${engine}] ${name}: ${ms} ms, limit ${limit} ms${ok ? "" : " (over)"}`);
  if (!ok) console.log(`::warning::${engine}: ${name} took ${ms} ms (limit ${limit} ms)`);
  return ms !== null;
}

async function idle(page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        window.__map.once("idle", r);
        window.__map.triggerRepaint();
        setTimeout(r, 4000);
      }),
  );
  await page.waitForTimeout(400);
}

/** Which of `selectors` is on top at (x, y), or the tag name of what is. */
const onTop = (page, x, y, selectors) =>
  page.evaluate(
    ([px, py, sels]) => {
      const e = document.elementFromPoint(px, py);
      return sels.find((s) => e?.closest(s)) ?? e?.tagName ?? null;
    },
    [x, y, selectors],
  );

/** The attribution's text is not covered by anything; punk folds it to its « ⓘ » on a phone
 * (DECISIONS 2026-10-09): then the « ⓘ » is not covered. */
async function attributionVisible(page) {
  const folded = await page
    .locator(".maplibregl-ctrl-attrib:not(.attrib-open) #attrib-toggle")
    .isVisible();
  const b = await page
    .locator(folded ? "#attrib-toggle .attrib-i" : ".maplibregl-ctrl-attrib-inner")
    .boundingBox();
  if (!b) return "no attribution";
  const points = [0.1, 0.5, 0.9].map((fx) => [b.x + b.width * fx, b.y + b.height / 2]);
  const tops = [];
  for (const [x, y] of points) tops.push(await onTop(page, x, y, [".maplibregl-ctrl-attrib"]));
  return tops.every((t) => t === ".maplibregl-ctrl-attrib") ? "ok" : tops.join(",");
}

/** Punk: where the header ticket and the floating buttons are, and whether they are hidden. */
const slid = (page) =>
  page.evaluate(() => {
    const at = (sel) => {
      const e = document.querySelector(sel);
      const r = e.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        right: Math.round(r.right),
        hidden: getComputedStyle(e).visibility === "hidden",
      };
    };
    return { vw: window.innerWidth, ticket: at("#ticket"), fabs: at("#fabs") };
  });

/** Visible touch targets smaller than MIN_TARGET px (the attribution's legal links apart). */
const smallTargets = (page) =>
  page.evaluate((min) => {
    const sel = "button, a[href], summary, input[type=search], label.toggle, [role=button]";
    return [...document.querySelectorAll(sel)]
      .filter((e) => !e.closest(".maplibregl-ctrl-attrib"))
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ e, r }) => r.width > 0 && r.height > 0 && e.checkVisibility?.() !== false)
      .filter(({ r }) => r.bottom > 0 && r.top < window.innerHeight)
      .filter(({ r }) => r.width < min - 0.5 || r.height < min - 0.5)
      .map(
        ({ e, r }) =>
          `${e.tagName.toLowerCase()}.${e.className || e.id}:${r.width | 0}x${r.height | 0}`,
      );
  }, MIN_TARGET);

/** The open area sheet holds in its width (DECISIONS 2026-10-09, « Punk sheets on a
 * phone… »): nothing scrolls sideways, the title ends left of ↑ and ×, and the map's cursor
 * stays over its ramp even with a name longer than it (its text lengthened here). Run in
 * the page; smoke.mjs has its twin. */
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

/** The punk sheet half open on a phone (DECISIONS 2026-10-09, « Punk sheets on a
 * phone… »): its paper scrolled 120 px, its head has not moved and is on top at its foot,
 * while what follows it in the top (the tickets, the tabs) moved as much as the paper. Run
 * in the page; the paper is put back. */
const PINNED = async () => {
  const sheet = document.getElementById("sheet");
  const paper = sheet.querySelector(".sheet-paper");
  const head = sheet.querySelector(".sheet-head");
  const next = sheet.querySelector(".sheet-top > :not(.sheet-head, .sheet-head-room)");
  const at = () => ({
    head: head.getBoundingClientRect().top,
    next: next.getBoundingClientRect().top,
  });
  // From its start: « Calcul ? », opened and closed before, leaves it scrolled to its end.
  paper.scrollTop = 0;
  await new Promise((r) => requestAnimationFrame(r));
  const start = paper.scrollTop;
  const before = at();
  paper.scrollTop = start + 120;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = at();
  const moved = paper.scrollTop - start;
  const h = head.getBoundingClientRect();
  const onTop = document
    .elementFromPoint(h.left + h.width / 2, h.bottom - 2)
    ?.closest(".sheet-head");
  paper.scrollTop = start;
  const got = {
    state: sheet.dataset.state,
    paper: [paper.scrollHeight, paper.clientHeight, getComputedStyle(paper).overflowY],
    moved,
    head: Math.round(after.head - before.head),
    next: Math.round(after.next - before.next),
    onTop: Boolean(onTop),
  };
  return {
    ...got,
    ok:
      got.state === "half" &&
      moved >= 60 &&
      got.head === 0 &&
      Math.abs(after.next - before.next + moved) < 1 &&
      got.onTop,
  };
};

/** A camera whose icon is in the free map area (below the bar, above `maxY`). */
const cameraInFreeArea = (page, maxY) =>
  page.evaluate((limit) => {
    const m = window.__map;
    const top = document.getElementById("estimate").getBoundingClientRect().bottom;
    const r = m.getCanvas().getBoundingClientRect();
    return (
      m
        .queryRenderedFeatures({ layers: ["cameras"] })
        .map((f) => {
          const p = m.project(f.geometry.coordinates);
          return { x: p.x + r.left, y: p.y + r.top, id: f.id };
        })
        .filter((p) => p.y > top + 30 && p.y < limit && p.x > 30 && p.x < r.width - 110)[0] ?? null
    );
  }, maxY);

/** A camera to tap in the free map area: one already there, else the loaded camera nearest
 * the centre, brought there by moving the map (whatever the region's data). */
async function cameraAt(page, maxY) {
  const here = await cameraInFreeArea(page, maxY);
  if (here) return here;
  const moved = await page.evaluate((limit) => {
    const m = window.__map;
    const c = m.getCenter();
    const cams = m.querySourceFeatures("detail", { sourceLayer: "cameras" });
    if (!cams.length) return false;
    const d = (f) =>
      Math.hypot(f.geometry.coordinates[0] - c.lng, f.geometry.coordinates[1] - c.lat);
    const f = cams.reduce((a, b) => (d(b) < d(a) ? b : a));
    const top = document.getElementById("estimate").getBoundingClientRect().bottom;
    const h = m.getCanvas().clientHeight;
    const w = m.getCanvas().clientWidth;
    m.jumpTo({ center: f.geometry.coordinates });
    // Put it at 40 % of the width, halfway between the bar and the limit.
    m.panBy([w / 2 - w * 0.4, h / 2 - (top + limit) / 2], { animate: false });
    return true;
  }, maxY);
  if (!moved) return null;
  await idle(page);
  return cameraInFreeArea(page, maxY);
}

/** The loaded camera nearest the map's centre put at (fx, fy) of the canvas, the map at
 * rest: where it is (page px), and the map's view. The map's moves from then on are kept in
 * window.__moves (smoke.mjs has its twin). */
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

/** The placed camera's point (page px), the map's view and moves, the panels' edges. */
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
      bar: document.getElementById("estimate").getBoundingClientRect().bottom,
      sheetTop: sheet.hidden ? null : sheet.getBoundingClientRect().top,
      focus: document.body.classList.contains("focus"),
    };
  });

/** Whether area `code`'s middle (tiles/areas.json bounds) lies in the map the panels leave
 * free: below the estimate bar, above the sheet on a phone, between the side panels on a
 * wide screen. */
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
    const panel = document.getElementById("filters").getBoundingClientRect();
    const phone = sheet.width >= r.width - 1;
    const free = phone
      ? y > bar && y < sheet.top && x > 0 && x < r.width
      : y > bar && y < r.height && x > panel.right && x < sheet.left;
    return { free, at: [Math.round(x), Math.round(y)], z: +m.getZoom().toFixed(2) };
  }, code);

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = benchBrowser(await (engine === "chromium" ? chromium : webkit).launch(), true);
try {
  const context = await browser.newContext({
    ...devices["iPhone 14"],
    geolocation: HERE,
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The participation API is not started here (bench/smoke-participate.mjs covers it):
  // its calls fail with the preview proxy's 502, which is not what this test watches.
  page.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.includes("/api/")) errors.push(m.text());
  });
  await page.goto(`${APP}#17/${STREET[1]}/${STREET[0]}`);
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
  await idle(page);
  const vh = page.viewportSize().height;
  check("map loads", true);
  {
    // Every kind the build writes (meta.json segment_bits `kind:*`, the multi-dome among
    // them since 2026-10-23) is kept by each layer that filters on the kind, and has its
    // sticker: a kind missing from the page's list takes its cameras and fields off the map.
    const kinds = await page.evaluate(async () => {
      const meta = await fetch("/tiles/meta.json").then((r) => r.json());
      const built = Object.keys(meta.segment_bits)
        .filter((b) => b.startsWith("kind:"))
        .map((b) => b.slice(5));
      const m = window.__map;
      const dropping = m
        .getStyle()
        .layers.map((l) => [l.id, JSON.stringify(m.getFilter(l.id) ?? null)])
        .filter(([, f]) => f.includes('["get","k"]') && f.includes('"literal"'))
        .map(([id, f]) => [id, built.filter((k) => !f.includes(`"${k}"`))]);
      return {
        built,
        layers: dropping.map(([id]) => id),
        dropped: dropping.filter(([, gone]) => gone.length),
        noSticker: built.filter((k) => !m.hasImage(`sticker-${k}-full`)),
      };
    });
    check(
      "every kind of the build kept by the kind filters, with its sticker (multi-dome)",
      kinds.built.includes("multidome") &&
        kinds.layers.length > 0 &&
        !kinds.dropped.length &&
        !kinds.noSticker.length,
      JSON.stringify(kinds),
    );
  }
  check("attribution not covered (map)", (await attributionVisible(page)) === "ok");
  {
    // The credit folded to a compact « ⓘ » (44 px), a tap unfolds it at 11 px at least,
    // another folds it again (DECISIONS 2026-10-09).
    const credit = () =>
      page.evaluate(() => {
        const t = document.getElementById("attrib-toggle");
        const inner = document.querySelector(".maplibregl-ctrl-attrib-inner");
        const r = t?.getBoundingClientRect();
        return {
          expanded: t?.getAttribute("aria-expanded"),
          name: t?.getAttribute("aria-label"),
          size: r ? [Math.round(r.width), Math.round(r.height)] : null,
          text: inner?.checkVisibility() ? inner.innerText : "",
          px: Number.parseFloat(getComputedStyle(inner).fontSize),
        };
      });
    const folded = await credit();
    await page.locator("#attrib-toggle").tap();
    const open = await credit();
    const uncovered = await attributionVisible(page);
    await page.locator("#attrib-toggle").tap();
    const again = await credit();
    check(
      "punk: the credit folded to a 44 px « ⓘ », a tap unfolds it (11 px, OSM and ODbL), another folds it",
      folded.expanded === "false" &&
        folded.text === "" &&
        folded.size?.every((v) => v >= 44) &&
        folded.name === "Sources et licence de la carte" &&
        open.expanded === "true" &&
        open.text.includes("OpenStreetMap") &&
        open.text.includes("ODbL") &&
        open.px >= 11 &&
        uncovered === "ok" &&
        again.expanded === "false" &&
        again.text === "",
      JSON.stringify({ folded, open, uncovered, again }),
    );
  }
  check(
    "touch targets >= 44 px (map)",
    (await smallTargets(page)).length === 0,
    (await smallTargets(page)).join(" "),
  );

  // --part 1 | 2 run the two halves apart (CI runs them in parallel); without it, both.
  if (PART !== 2) {
    // Hypothesis bar at the top: the map opens on "Standard"; a tap switches to "Prudent".
    await page.locator("#estimate button", { hasText: "Prudent" }).tap();
    await idle(page);
    const est = await page.evaluate(() => ({
      url: window.location.search,
      bands: JSON.stringify(window.__map.getFilter("bands")),
    }));
    check(
      "zone bar: tap switches",
      est.url.includes("est=prudent") && est.bands.includes('["get","b"],2'),
      est.url,
    );
    await page.locator("#estimate button", { hasText: "Standard" }).tap();
    await idle(page);

    // Filters: full-screen layer from the button, closed by "Fermer". Punk: 18a's machine,
    // risen across the width, from under the ticket's title to the screen's foot.
    await page.locator("#fab-filters").tap();
    await page.waitForTimeout(400);
    const layer = await page.locator("#filters").boundingBox();
    const vw = page.viewportSize().width;
    // Punk: down to the attribution (18a's inset at the bottom left), never over it (ODbL).
    const attrib = await page.locator(".maplibregl-ctrl-attrib").boundingBox();
    check(
      "filters open: the machine across the screen, under the ticket's title, down to the attribution",
      layer !== null &&
        attrib !== null &&
        layer.x <= 16 &&
        layer.x + layer.width >= vw - 32 &&
        layer.y < 120 &&
        layer.y + layer.height >= attrib.y - 20 &&
        layer.y + layer.height <= attrib.y,
      JSON.stringify({ layer, attrib }),
    );
    check("attribution not covered (machine open)", (await attributionVisible(page)) === "ok");
    check(
      "touch targets >= 44 px (filters)",
      (await smallTargets(page)).length === 0,
      (await smallTargets(page)).join(" "),
    );
    await page.locator("#filters .panel-close").tap();
    // Punk: the machine slides down for 300 ms, then hides.
    await page
      .locator("#filters")
      .waitFor({ state: "hidden", timeout: 2000 })
      .catch(() => {});
    check("filters close", !(await page.locator("#filters").isVisible()));

    // Tap a camera: the sheet opens at half height, on top. The camera is where the half
    // sheet leaves the map free (below the bar, above the sheet and the attribution, beside
    // the punk ticket, which slides away): the map does not move at all (DECISIONS
    // 2026-10-18; it used to frame the camera's field, zooming out).
    const cam = await placeCamera(page, 0.72, 0.27);
    check("a camera is tappable", cam !== null, JSON.stringify(cam));
    await page.touchscreen.tap(cam.x, cam.y);
    await page.waitForTimeout(900);
    await idle(page);
    const still = await placedView(page);
    check(
      "tap a camera in the free part: the map does not move (no movestart, same centre and zoom)",
      still.focus &&
        still.starts === 0 &&
        still.zoom === cam.zoom &&
        still.center.every((v, i) => Math.abs(v - cam.center[i]) < 1e-9),
      JSON.stringify({ cam, still }),
    );
    const sheet = await page.locator("#sheet").boundingBox();
    const shownPx = await page.evaluate(() => {
      const r = document.getElementById("sheet").getBoundingClientRect();
      return Math.min(r.bottom, window.innerHeight) - r.top;
    });
    check(
      "sheet opens at half height",
      Math.abs(sheet.y - vh * 0.5) < vh * 0.12,
      `top ${sheet.y | 0} of ${vh}`,
    );
    const tops = [];
    for (const fy of [0.05, 0.3, 0.6]) {
      tops.push(await onTop(page, sheet.x + sheet.width / 2, sheet.y + shownPx * fy, ["#sheet"]));
    }
    check(
      "sheet on top",
      tops.every((t) => t === "#sheet"),
      tops.join(","),
    );
    check("attribution not covered (sheet half)", (await attributionVisible(page)) === "ok");
    {
      // The sheet open, the ticket slid away to the left, the floating buttons to the right,
      // gone (DECISIONS 2026-10-09); back when it closes (below).
      await page.waitForTimeout(450);
      const away = await slid(page);
      check(
        "punk: a sheet open, the ticket slid left and the floating buttons right, hidden",
        away.ticket.hidden &&
          away.ticket.right <= 0 &&
          away.fabs.hidden &&
          away.fabs.left >= away.vw,
        JSON.stringify(away),
      );
    }
    const mapLabels = await page.evaluate(() => ({
      visibility: window.__map.getLayoutProperty("focus-labels", "visibility"),
      filter: JSON.stringify(window.__map.getFilter("focus-labels")),
      pieces: window.__map.queryRenderedFeatures({ layers: ["focus-streets"] }).length,
    }));
    // The chosen level's yellow label alone, « identifie » first (DECISIONS 2026-10-08,
    // « Punk focus… »).
    check(
      "phone focus: identify's label alone, filmed pieces drawn",
      mapLabels.visibility === "visible" &&
        mapLabels.filter === '["==",["get","lv"],3]' &&
        mapLabels.pieces > 0,
      JSON.stringify(mapLabels),
    );
    check(
      "touch targets >= 44 px (sheet)",
      (await smallTargets(page)).length === 0,
      (await smallTargets(page)).join(" "),
    );

    // The sheet's content (M5): headline, ruler, chips with certainty, one "how" link. The
    // punk sheet (lot 3.2, mockup 17a): its title's real text, the distance tickets named
    // by the headline, the facts as rows (dl, dt, dd) each saying its certainty, « Calcul ? »
    // once, the links after the facts.
    {
      const content = await page.evaluate(() => {
        const sh = document.getElementById("sheet");
        const rows = [...sh.querySelectorAll(".facts > .fact")];
        const said = (e) => [...e.querySelectorAll(".sheet-sr")].map((x) => x.textContent).join("");
        const last = [...sh.querySelectorAll(".facts > .fact, .sheet-assumed")]
          .map((e) => e.getBoundingClientRect().bottom)
          .reduce((a, b) => Math.max(a, b), 0);
        return {
          title: sh.querySelector(".headline > .sheet-sr")?.textContent ?? "",
          letters: sh.querySelector(".headline > .cutout")?.getAttribute("aria-hidden"),
          tickets: sh.querySelector(".tickets")?.getAttribute("aria-label") ?? "",
          group: sh.querySelector(".tickets")?.getAttribute("role") ?? "",
          radios: [...sh.querySelectorAll(".tickets > [role=radio]")].map(
            (r) => `${r.getAttribute("aria-checked")}:${r.tabIndex}`,
          ),
          rows: rows.length,
          structured: rows.every(
            (r) => [...r.children].map((c) => c.tagName).join(",") === "DT,DD",
          ),
          worded: rows.filter((r) => /identifiée|estimée|par défaut/.test(said(r))).length,
          how: sh.querySelectorAll(".how-toggle").length,
          linksAfter:
            sh.querySelector(".how-toggle").getBoundingClientRect().top >= last &&
            sh.querySelector(".osm-page").getBoundingClientRect().top >= last,
          doubled: /type type/i.test(sh.textContent ?? ""),
        };
      });
      check(
        "sheet (punk): title, the tickets a radiogroup on « identifie », rows with certainty, « Calcul ? », links last",
        content.title.length > 3 &&
          content.letters === "true" &&
          content.tickets === "Niveau montré sur la carte" &&
          content.group === "radiogroup" &&
          content.radios.join() === "true:0,false:-1,false:-1" &&
          content.rows >= 5 &&
          content.structured &&
          content.worded >= 4 &&
          content.how === 1 &&
          content.linksAfter &&
          !content.doubled,
        JSON.stringify(content),
      );
      await page.locator("#sheet .how-toggle").tap();
      await page.waitForTimeout(200);
      check(
        "sheet (punk): « Calcul ? » explains the rows and their certainty",
        (await page.locator("#sheet .how").isVisible()) &&
          (await page.locator("#sheet .how-toggle").getAttribute("aria-expanded")) === "true" &&
          /estimée/.test(await page.locator("#sheet .how").innerText()),
        (await page.locator("#sheet .how").innerText()).slice(0, 120),
      );
      await page.locator("#sheet .how-toggle").tap();
      await page.waitForTimeout(200);
    }

    // Punk, half open: only the title stays, the tickets and the rest scroll under it; left
    // scrolled, the paper is back at its start at the peek (below).
    {
      const pinned = await page.evaluate(PINNED);
      check(
        "punk sheet at half: only its title stays, the tickets and the rest scroll under it",
        pinned.ok,
        JSON.stringify(pinned),
      );
      await page.evaluate(() => {
        document.querySelector("#sheet .sheet-paper").scrollTop = 100;
      });
    }
    // Drag the sheet by its top: up to full, down to peek.
    const drag = async (dy) => {
      const b = await page.locator("#sheet .sheet-grab").boundingBox();
      const x = b.x + b.width / 3;
      const y0 = b.y + b.height / 2;
      // Pointer events as a finger sends them (touchscreen has no drag in Playwright).
      await page.evaluate(
        async ([px, py, d]) => {
          const target = document.elementFromPoint(px, py);
          const ev = (type, y) =>
            target.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                pointerId: 7,
                pointerType: "touch",
                clientX: px,
                clientY: y,
                isPrimary: true,
              }),
            );
          ev("pointerdown", py);
          for (let i = 1; i <= 10; i++) {
            ev("pointermove", py + (d * i) / 10);
            await new Promise((r) => setTimeout(r, 30));
          }
          ev("pointerup", py + d);
        },
        [x, y0, dy],
      );
      await page.waitForTimeout(500);
      return page.evaluate(() => document.getElementById("sheet").dataset.state);
    };
    check("drag up: full", (await drag(-vh * 0.4)) === "full");
    check("drag down: peek", (await drag(vh * 0.8)) === "peek");
    {
      const peek = await page.evaluate(() => {
        const sheet = document.getElementById("sheet");
        const ticket = sheet.querySelector(".ticket");
        return {
          scrollTop: sheet.querySelector(".sheet-paper").scrollTop,
          // The tickets show whole at the peek (4b's « réduite »).
          tickets: ticket
            ? ticket.getBoundingClientRect().bottom <= sheet.getBoundingClientRect().bottom
            : null,
        };
      });
      check(
        "punk sheet at its peek: its start, the tickets whole",
        peek.scrollTop === 0 && peek.tickets !== false,
        JSON.stringify(peek),
      );
    }
    check("attribution not covered (sheet peek)", (await attributionVisible(page)) === "ok");
    await page.locator("#sheet .sheet-grab").tap();
    await page.waitForTimeout(500);
    check(
      "handle tap: peek -> half",
      (await page.evaluate(() => document.getElementById("sheet").dataset.state)) === "half",
    );

    // The ticket and its « Filtres et légende » slid away while a sheet is open (DECISIONS
    // 2026-10-09): out of reach, checked above.
    check(
      "punk: « Filtres et légende » out of reach while a sheet is open",
      !(await page.locator("#fab-filters").isVisible()),
    );

    // A camera where the half sheet will be: the map moves once, in at most 400 ms (DECISIONS
    // 2026-10-06), just enough for the camera's tap target to be above the sheet, the zoom
    // kept. Then the visible height changes (Safari's toolbars) with the sheet open: the map
    // does not frame anything again, the camera moves only with the canvas (MapLibre keeps
    // its centre: half the change). A second framing on such a change, with another padding,
    // made the map leave and come back (lot U).
    await page.locator("#sheet .close").tap();
    await page.waitForTimeout(500);
    const low = await placeCamera(page, 0.4, 0.75);
    await page.touchscreen.tap(low.x, low.y);
    await page.waitForTimeout(1200);
    await idle(page);
    const raised = await placedView(page);
    check(
      "tap a camera under the sheet's place: one move, <= 400 ms, the camera above the sheet, same zoom",
      raised.focus &&
        raised.starts === 1 &&
        within("tap a camera under the sheet's place", raised.ms, 400) &&
        raised.zoom === low.zoom &&
        raised.y >= raised.bar + 20 &&
        raised.sheetTop !== null &&
        raised.y <= raised.sheetTop - 20,
      JSON.stringify({ low, raised }),
    );
    await page.setViewportSize({ width: vw, height: vh + 60 });
    await page.waitForTimeout(900);
    await idle(page);
    const taller = await placedView(page);
    check(
      "the visible height changes with the sheet open: no new framing, the camera moves with the canvas",
      taller.zoom === raised.zoom &&
        Math.abs(taller.x - raised.x) <= 2 &&
        Math.abs(taller.y - raised.y - 30) <= 2,
      JSON.stringify({ raised, taller }),
    );
    await page.setViewportSize({ width: vw, height: vh });
    await page.waitForTimeout(900);
    await idle(page);

    // A tap on empty map closes the sheet. On a settled map, with no camera within a finger's
    // tolerance (12 px). Full circles (direction not surveyed) are framed farther out, and
    // at La Défense the band between the bar and the sheet can hold no such point: zoom in
    // (1.5 levels, up to three times) until one is found.
    const findEmpty = (limit) =>
      page.evaluate((limit) => {
        const m = window.__map;
        const r = m.getCanvas().getBoundingClientRect();
        const top = document.getElementById("estimate").getBoundingClientRect().bottom + 20;
        for (let y = top; y < limit; y += 20) {
          for (let x = 20; x < r.width - 120; x += 20) {
            const onMap = document.elementFromPoint(x, y) === m.getCanvas();
            const box = [
              [x - r.left - 12, y - r.top - 12],
              [x - r.left + 12, y - r.top + 12],
            ];
            if (onMap && !m.queryRenderedFeatures(box, { layers: ["camera-hit"] }).length)
              return { x, y };
          }
        }
        return null;
      }, limit);
    let empty = null;
    let tries = 0;
    for (; tries < 3 && !empty; tries++) {
      if (tries)
        await page.evaluate(() => window.__map.jumpTo({ zoom: window.__map.getZoom() + 1.5 }));
      await idle(page);
      empty = await findEmpty(sheet.y - 10);
    }
    if (empty) await page.touchscreen.tap(empty.x, empty.y);
    // Wait for the effect, not a fixed time: on CI's slower machine the close came after 500 ms.
    await page
      .waitForFunction(() => document.getElementById("sheet").hidden, null, { timeout: 5000 })
      .catch(() => {});
    const afterEmpty = await page.evaluate(() => ({
      zoom: Math.round(window.__map.getZoom() * 10) / 10,
      state: document.getElementById("sheet").dataset.state,
    }));
    check(
      "tap on empty map closes the sheet",
      empty !== null && !(await page.locator("#sheet").isVisible()),
      JSON.stringify({ empty, tries, ...afterEmpty }),
    );
    {
      await page.waitForTimeout(450);
      const back = await slid(page);
      check(
        "punk: the sheet closed, the ticket and the floating buttons back in place",
        !back.ticket.hidden &&
          back.ticket.left >= 0 &&
          !back.fabs.hidden &&
          back.fabs.right <= back.vw,
        JSON.stringify(back),
      );
    }

    // Me localiser: position only on request, shown as a dot; the URL hash is held meanwhile.
    const hashBefore = await page.evaluate(() => window.location.hash);
    await page.locator("#fab-locate").tap();
    await page.waitForTimeout(2500);
    const located = await page.evaluate(() => ({
      dot: window.__map.querySourceFeatures("me").length,
      center: window.__map.getCenter(),
      hash: window.location.hash,
    }));
    check(
      "locate: map moves to the position, shown as a dot",
      located.dot > 0 && Math.abs(located.center.lat - HERE.latitude) < 0.001,
      JSON.stringify(located.center),
    );
    check(
      "locate: the URL follows the map, as always",
      located.hash !== hashBefore,
      `${hashBefore} -> ${located.hash}`,
    );
    // Every gesture on the map leaves « Suivi » (the owner, 2026-10-18), a pinch too: the
    // keyboard's zoom in both engines, the wheel and a two-finger pinch in Chromium
    // (Playwright's phone WebKit has neither); a position that comes after never moves the
    // map.
    const fab = page.locator("#fab-locate");
    const gestures = [
      [
        "keyboard zoom",
        async () => {
          await page.locator(".maplibregl-canvas").focus();
          await page.keyboard.press("Equal");
        },
      ],
    ];
    if (engine === "chromium") {
      gestures.push([
        "wheel",
        async () => {
          await page.mouse.move(195, 320);
          await page.mouse.wheel(0, -100);
        },
      ]);
      gestures.push([
        "pinch",
        async () => {
          const cdp = await context.newCDPSession(page);
          const points = (d) => [
            { x: 160 - d, y: 320, id: 0 },
            { x: 230 + d, y: 320, id: 1 },
          ];
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: points(0),
          });
          for (let i = 1; i <= 8; i++) {
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: points(i * 8),
            });
            await page.waitForTimeout(16);
          }
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await cdp.detach();
        },
      ]);
    }
    const centre = () =>
      page.evaluate(() => {
        const c = window.__map.getCenter();
        return [c.lng, c.lat, window.__map.getZoom()];
      });
    let walked = 0;
    for (const [name, gesture] of gestures) {
      if ((await fab.getAttribute("data-locate")) !== "follow") {
        await fab.tap();
        await page.waitForTimeout(1200);
      }
      const following = await fab.getAttribute("data-locate");
      await gesture();
      await page.waitForTimeout(900);
      const still = await centre();
      const left = await fab.getAttribute("data-locate");
      walked += 1;
      await context.setGeolocation({
        latitude: HERE.latitude + 0.0004 * walked,
        longitude: HERE.longitude,
        accuracy: 5,
      });
      await page.waitForTimeout(1500);
      const later = await centre();
      const moved = Math.hypot(later[0] - still[0], later[1] - still[1]);
      check(
        `locate: a ${name} in Suivi stops following (Recentrer), a later position leaves the map`,
        following === "follow" && left === "free" && moved < 1e-7 && later[2] === still[2],
        JSON.stringify({ following, left, still, later }),
      );
    }
    await context.setGeolocation(HERE);
    // Following again, then a tap in « Suivi » turns it off.
    if ((await fab.getAttribute("data-locate")) !== "follow") {
      await fab.tap();
      await page.waitForTimeout(1200);
    }
    await page.locator("#fab-locate").tap();
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__map.panBy([30, 0], { duration: 0 }));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      dot: window.__map.querySourceFeatures("me").length,
      hash: window.location.hash,
    }));
    check("locate off: dot gone", after.dot === 0, after.hash);

    // A camera of unknown type: "Caméra de type inconnu", never "type type inconnu". One
    // from the loaded tiles, centred, then tapped.
    const unknownAt = await page.evaluate(() => {
      const f = window.__map
        .querySourceFeatures("detail", { sourceLayer: "cameras" })
        .find((x) => x.properties.k === "unknown");
      return f ? f.geometry.coordinates : null;
    });
    let unknownCam = null;
    if (unknownAt) {
      await page.evaluate((c) => window.__map.jumpTo({ center: c, zoom: 18 }), unknownAt);
      await idle(page);
      unknownCam = await page.evaluate((c) => {
        const m = window.__map;
        const r = m.getCanvas().getBoundingClientRect();
        const q = m.project(c);
        return { x: q.x + r.left, y: q.y + r.top };
      }, unknownAt);
    }
    if (unknownCam) {
      await page.touchscreen.tap(unknownCam.x, unknownCam.y);
      // The sheet of that camera, not the text left in a closed one (CI: 800 ms were short).
      await page
        .waitForFunction(
          () => {
            const sh = document.getElementById("sheet");
            // The current sheet's line, the punk title's real text.
            const line = sh.querySelector(".sheet-line, .headline > .sheet-sr");
            return !sh.hidden && /inconnu/.test(line?.textContent ?? "");
          },
          null,
          { timeout: 5000 },
        )
        .catch(() => {});
      const text = await page.locator("#sheet").innerText();
      check(
        "unknown type: no 'type type'",
        /type inconnu/.test(text) && !/type\s+type/i.test(text),
        text.split("\n").slice(0, 8).join(" / "),
      );
    } else {
      check("unknown type: a camera in view", false, "none found");
    }

    // A real finger moves a little between down and up (iPhone journal: touchstart, no
    // click). Chromium only (CDP): touchStart, touchMove by (5, 4) px, touchEnd, ~150 ms.
    // From a closed sheet, then with the sheet open on another camera.
    if (engine === "chromium") {
      const cdp = await context.newCDPSession(page);
      const finger = async (x, y) => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await page.waitForTimeout(70);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + 5, y: y + 4 }],
        });
        await page.waitForTimeout(80);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };
      await page.evaluate((c) => window.__map.jumpTo({ center: c, zoom: 16.5 }), STREET);
      await idle(page);
      const cams = await page.evaluate(() => {
        const seen = new Set();
        return window.__map
          .querySourceFeatures("detail", { sourceLayer: "cameras" })
          .filter((f) => !seen.has(f.id) && seen.add(f.id))
          .slice(0, 5)
          .map((f) => ({ id: f.id, at: f.geometry.coordinates }));
      });
      const opened = [];
      for (const c of cams) {
        if (await page.locator("#sheet").isVisible()) await page.locator("#sheet .close").tap();
        await page.evaluate((at) => window.__map.jumpTo({ center: at, zoom: 16.5 }), c.at);
        await idle(page);
        const q = await page.evaluate((at) => {
          const m = window.__map;
          const r = m.getCanvas().getBoundingClientRect();
          const p = m.project(at);
          return { x: p.x + r.left, y: p.y + r.top };
        }, c.at);
        await finger(q.x, q.y);
        await page.waitForTimeout(800);
        opened.push(await page.locator("#sheet").isVisible());
      }
      check(
        "finger taps (moving 6 px) open the sheet",
        opened.length >= 3 && opened.every(Boolean),
        opened.join(","),
      );
      // Sheet open on the first camera, a finger on another one switches to it.
      let switched = false;
      if (cams.length >= 2) {
        if (!(await page.locator("#sheet").isVisible())) {
          await page.evaluate((at) => window.__map.jumpTo({ center: at, zoom: 16 }), cams[0].at);
          await idle(page);
        }
        // Above the half-height sheet.
        await page.evaluate(
          (at) => window.__map.easeTo({ center: at, zoom: 16, offset: [0, -170], duration: 0 }),
          cams[1].at,
        );
        await idle(page);
        const q = await page.evaluate((at) => {
          const m = window.__map;
          const r = m.getCanvas().getBoundingClientRect();
          const p = m.project(at);
          return { x: p.x + r.left, y: p.y + r.top };
        }, cams[1].at);
        const before = JSON.stringify(
          await page.evaluate(() => window.__map.getFilter("bands-fan")),
        );
        // In a dense area the tap targets (20 px) overlap: any camera under the finger will do.
        const under = await page.evaluate(
          ([x, y]) => {
            const m = window.__map;
            const r = m.getCanvas().getBoundingClientRect();
            return m
              .queryRenderedFeatures([x - r.left, y - r.top], { layers: ["camera-hit"] })
              .map((f) => f.id);
          },
          [q.x, q.y],
        );
        await finger(q.x, q.y);
        await page.waitForTimeout(800);
        const after = JSON.stringify(
          await page.evaluate(() => window.__map.getFilter("bands-fan")),
        );
        const now = JSON.parse(after)[1][2];
        switched = after !== before && under.includes(now) && now !== JSON.parse(before)[1][2];
        check(
          "finger tap with the sheet open switches camera",
          switched,
          `${before} -> ${after}, under ${JSON.stringify(under)}, target ${cams[1].id}`,
        );
      }
      if (await page.locator("#sheet").isVisible()) await page.locator("#sheet .close").tap();
    }

    // 20 taps in a row at different zooms (the iPhone applied the focus 1 time in 2): each
    // from a closed sheet, then the fit and the new tiles; the sheet is open, the rest is
    // dimmed, the outlines are this camera's and its filmed portions are highlighted.
    await page.evaluate((c) => window.__map.jumpTo({ center: c, zoom: 16.5 }), STREET);
    await idle(page);
    const filmingCams = await page.evaluate(() => {
      const m = window.__map;
      const n = new Set(
        m
          .querySourceFeatures("streets", { sourceLayer: "portions" })
          .flatMap((f) => String(f.properties.cs ?? "").split(";"))
          .filter(Boolean)
          .map((tok) => Number.parseInt(tok, 36))
          .filter((v) => v % 3 <= 1)
          .map((v) => Math.floor(v / 3)),
      );
      const seen = new Set();
      return m
        .querySourceFeatures("detail", { sourceLayer: "cameras" })
        .filter(
          (f) => n.has(f.properties.n) && !seen.has(f.properties.id) && seen.add(f.properties.id),
        )
        .slice(0, 10)
        .map((f) => ({ id: f.properties.id, fid: f.id, at: f.geometry.coordinates }));
    });
    const filmingN = await page.evaluate(() => [
      ...new Set(
        window.__map
          .querySourceFeatures("streets", { sourceLayer: "portions" })
          .flatMap((f) => String(f.properties.cs ?? "").split(";"))
          .filter(Boolean)
          .map((tok) => Number.parseInt(tok, 36))
          .filter((v) => v % 3 <= 1)
          .map((v) => Math.floor(v / 3)),
      ),
    ]);
    const zooms = [15.5, 16, 16.5, 17, 17.5];
    const rounds = [];
    for (let i = 0; i < TAPS && filmingCams.length; i++) {
      const c = filmingCams[i % filmingCams.length];
      if (await page.locator("#sheet").isVisible()) await page.locator("#sheet .close").tap();
      await page.evaluate(
        ([at, z]) => window.__map.jumpTo({ center: at, zoom: z }),
        [c.at, zooms[i % 5]],
      );
      await idle(page);
      const q = await page.evaluate((at) => {
        const m = window.__map;
        const r = m.getCanvas().getBoundingClientRect();
        const p = m.project(at);
        return { x: p.x + r.left, y: p.y + r.top };
      }, c.at);
      // Cameras under the finger (close cameras share the enlarged target): the focus must
      // be one of them.
      const under = await page.evaluate(({ x, y }) => {
        const m = window.__map;
        const r = m.getCanvas().getBoundingClientRect();
        return m
          .queryRenderedFeatures([x - r.left, y - r.top], { layers: ["camera-hit"] })
          .map((f) => ({ fid: f.id, n: f.properties.n }));
      }, q);
      await page.touchscreen.tap(q.x, q.y);
      await page.waitForTimeout(700);
      await idle(page);
      const r = await page.evaluate(
        ({ under, filming }) => {
          const m = window.__map;
          const s = document.getElementById("sheet").getBoundingClientRect();
          const e = document.elementFromPoint(s.left + s.width / 2, s.top + 20);
          const fid = JSON.parse(JSON.stringify(m.getFilter("bands-fan")))[1][2];
          const focused = under.find((u) => u.fid === fid);
          return {
            open: !document.getElementById("sheet").hidden && Boolean(e?.closest("#sheet")),
            dim: JSON.stringify(m.getPaintProperty("streets", "line-opacity")).includes("0.15"),
            fan: focused !== undefined,
            films: focused !== undefined && filming.includes(focused.n),
            lit: m.queryRenderedFeatures({ layers: ["focus-streets"] }).length,
            z: m.getZoom().toFixed(1),
          };
        },
        { under, filming: filmingN },
      );
      const ok = r.open && r.dim && r.fan && (!r.films || r.lit > 0);
      rounds.push(`${ok ? "ok" : "KO"}:${c.id}@${r.z}${ok ? "" : JSON.stringify(r)}`);
    }
    check(
      `${TAPS} taps: sheet, dimming, own outlines and highlight every time`,
      rounds.length === TAPS && rounds.every((x) => x.startsWith("ok")),
      rounds.filter((x) => x.startsWith("KO")).join(" ") || `${rounds.length} ok`,
    );

    // Sheet open, tap another camera: the sheet switches to it and the map recentres; the
    // sheet reaches the bottom of the screen, the attribution rides above it.
    if (filmingCams.length >= 2) {
      const c1 = filmingCams[0];
      let c2 = filmingCams[1];
      if (await page.locator("#sheet").isVisible()) await page.locator("#sheet .close").tap();
      await page.evaluate((at) => window.__map.jumpTo({ center: at, zoom: 16 }), c1.at);
      await idle(page);
      const tapAt = (at) =>
        page.evaluate((a) => {
          const m = window.__map;
          const r = m.getCanvas().getBoundingClientRect();
          const p = m.project(a);
          return { x: p.x + r.left, y: p.y + r.top };
        }, at);
      let q = await tapAt(c1.at);
      await page.touchscreen.tap(q.x, q.y);
      await page.waitForTimeout(700);
      await idle(page);
      // The second camera: brought into the free map (between the estimate bar and the
      // sheet, still open), the first one whose pictogram no other one crowds (a tap
      // selects the nearest pictogram within 20 px).
      const picked = await page.evaluate(
        ([cands, from]) => {
          const m = window.__map;
          const all = m.querySourceFeatures("detail", { sourceLayer: "cameras" });
          const top = document.getElementById("estimate").getBoundingClientRect().bottom;
          const bottom = document.getElementById("sheet").getBoundingClientRect().top;
          const centre = m.getCanvas().getBoundingClientRect().height / 2;
          for (const c of cands) {
            if (c.id === from) continue;
            m.jumpTo({ center: c.at, zoom: 17 });
            m.panBy([0, centre - (top + bottom) / 2], { animate: false });
            const p = m.project(c.at);
            const crowded = all.some((f) => {
              if (f.properties.id === c.id) return false;
              const o = m.project(f.geometry.coordinates);
              return Math.hypot(o.x - p.x, o.y - p.y) <= 24;
            });
            if (!crowded) return c.id;
          }
          return null;
        },
        [filmingCams, c1.id],
      );
      if (picked) c2 = filmingCams.find((c) => c.id === picked);
      await idle(page);
      q = await tapAt(c2.at);
      // Between the estimate bar and the sheet: elsewhere the tap lands on a panel.
      const bar = await page.locator("#estimate").boundingBox();
      const visibleAbove =
        q.y < (await page.locator("#sheet").boundingBox()).y - 10 &&
        q.y > (bar ? bar.y + bar.height : 0) + 10 &&
        q.x > 10 &&
        q.x < page.viewportSize().width - 10;
      if (visibleAbove) {
        await page.touchscreen.tap(q.x, q.y);
        await page.waitForTimeout(700);
        await idle(page);
      }
      const sw = await page.evaluate((fid) => {
        const m = window.__map;
        const s = document.getElementById("sheet").getBoundingClientRect();
        const a = document.querySelector(".maplibregl-ctrl-bottom-right").getBoundingClientRect();
        return {
          fan: JSON.stringify(m.getFilter("bands-fan")).includes(String(fid)),
          open: !document.getElementById("sheet").hidden,
          bottom: Math.round(s.bottom),
          vh: window.innerHeight,
          attribAboveSheet: a.bottom <= s.top + 1,
        };
      }, c2.fid);
      check(
        "sheet open, tap another camera: switches to it",
        visibleAbove ? sw.open && sw.fan : true,
        visibleAbove
          ? JSON.stringify({
              ...sw,
              from: c1.id,
              to: c2.id,
            })
          : "second camera hidden by the sheet: skipped",
      );
      check(
        "sheet reaches the bottom of the screen, attribution above it",
        sw.bottom >= sw.vh - 1 && sw.attribAboveSheet,
        JSON.stringify(sw),
      );
    }
    if (await page.locator("#sheet").isVisible()) await page.locator("#sheet .close").tap();
  }
  if (PART !== 1) {
    if (PART === 2) {
      await page.goto(`${APP}#17/${STREET[1]}/${STREET[0]}`);
      await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
      await idle(page);
    }
    // Unchecking every other operator listed, close-up: no field, outline or kept portion
    // of an unchecked operator's camera in view. The panel lists the operators with a camera
    // in the view widened by the farthest field (180 m): a camera just outside reaches in;
    // an operator not listed stays checked (`unlisted`, expected empty now).
    await page.evaluate((c) => window.__map.jumpTo({ center: c, zoom: 16.8 }), STREET);
    await idle(page);
    await page.locator("#fab-filters").tap();
    const unlisted = [];
    for (const op of ["Privée, extérieur", "Privée, intérieur", "Exploitant inconnu"]) {
      const row = page.locator("#filters label", { hasText: op });
      if (await row.count()) await row.first().tap();
      else unlisted.push(op);
      await idle(page);
    }
    await page.locator("#filters .panel-close").tap();
    await idle(page);
    const pubOnly = await page.evaluate(async (unlisted) => {
      const m = window.__map;
      const t = await fetch("/tiles/cameras.json").then((r) => r.json());
      const layers = ["bands"].filter((id) => m.getLayer(id));
      const bands = m.queryRenderedFeatures({ layers });
      let keptPrivate = 0;
      for (const f of m.queryRenderedFeatures({ layers: ["portions"] })) {
        const sel = m.getFeatureState({ source: "streets", sourceLayer: "portions", id: f.id }).sel;
        const anyPub = String(f.properties.cs ?? "")
          .split(";")
          .filter(Boolean)
          .some((tok) => t.ops[t.o[Math.floor(Number.parseInt(tok, 36) / 3)]] === "pub");
        if (sel && !anyPub) keptPrivate++;
      }
      const code = {
        "Privée, extérieur": "pro",
        "Privée, intérieur": "pri",
        "Exploitant inconnu": "unk",
      };
      const allowed = new Set(["pub", ...unlisted.map((op) => code[op])]);
      const others = bands.filter((f) => !allowed.has(f.properties.o));
      return {
        bands: bands.length,
        nonPublicBands: others.length,
        keptPrivate,
        ops: JSON.stringify(m.getFilter("bands")).match(/"o"\],\["literal",\[[^\]]*\]/)?.[0],
        others: [
          ...new Set(others.map((f) => `${f.layer.id}:${f.properties.o}:${f.properties.i}`)),
        ],
        unlisted,
      };
    }, unlisted);
    check(
      "listed operators unchecked: no field nor kept portion of theirs",
      pubOnly.bands > 0 && pubOnly.nonPublicBands === 0 && pubOnly.keptPrivate === 0,
      JSON.stringify(pubOnly),
    );
    // Back to every operator.
    await page.locator("#fab-filters").tap();
    for (const op of ["Privée, extérieur", "Privée, intérieur", "Exploitant inconnu"]) {
      const row = page.locator("#filters label", { hasText: op });
      if (await row.count()) await row.first().tap();
    }
    check(
      "legend: the zone is not named twice",
      (await page
        .locator("#filters", { hasText: /(Standard|Prudent) : (Standard|Prudent)/ })
        .count()) === 0,
    );
    await page.locator("#filters .panel-close").tap();
    const width16 = await page.evaluate(() =>
      JSON.stringify(window.__map.getPaintProperty("portions", "line-width")),
    );
    // Punk: one stroke without a casing, as wide as the first round's casing (3.5 px) for a
    // segment without a width class (a path, src/streetwidth.ts), as wide as the basemap's
    // road for a class whose road is wider (a boulevard, `major`, 4.9 px at z16).
    const punkAt16 = (w, c) => {
      const e = JSON.parse(w);
      const arm = e[e.indexOf(16, 3) + 1];
      return Array.isArray(arm) ? (c ? arm[arm.indexOf(c) + 1] : arm.at(-1)) : null;
    };
    check(
      "portions from z16: 3.5 px, a boulevard as wide as the basemap's",
      punkAt16(width16) === 3.5 && punkAt16(width16, "major") > 4.5,
      width16.slice(0, 300),
    );

    // Headline without an identification field, a camera with no field at all, and a dome
    // without a surveyed direction in both hypotheses (CI extract): never "inside a building"
    // but for the second, which gets "position to check" and the OSM link; the dome films
    // "if it is turned towards you", its Direction chip says "non relevée". Opened by ?cam=
    // links, which also tests them.
    if (region === "ci") {
      // The camera verified gone is not drawn, but for its advanced filter (grey).
      const goneDrawn = async (q) => {
        await page.goto(`${APP}${q}#19/48.895771/2.239842`);
        await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
        await idle(page);
        return page.evaluate(
          () =>
            window.__map
              .queryRenderedFeatures({ layers: ["cameras"] })
              .filter((f) => f.properties.gm !== undefined).length,
        );
      };
      const hidden = await goneDrawn("");
      const shown = await goneDrawn("?f=gone");
      check(
        "gone camera hidden, drawn with its filter",
        hidden === 0 && shown >= 1,
        `${hidden} / ${shown}`,
      );
      for (const [cam, at, est, want] of [
        // Validated contributions (tests/fixtures/contrib-ci.jsonl, applied by the CI
        // build): verified gone (d2), and moved then seen on site (a1), months only.
        [
          "n1923568277",
          [48.895771, 2.239842],
          "",
          // Punk (17a): the stamp in place of the tickets, the month.
          /Disparue[\s\S]*introuvable sur place · septembre 2026/,
        ],
        [
          "n1925222790",
          [48.896031, 2.237693],
          "",
          // Punk: the dates line, then the Position row tagged « sur place · 09/26 ».
          /Vérifiée sur place : septembre 2026[\s\S]*Position[\s\S]*sur place · 09\/26[\s\S]*corrigée/i,
        ],
        [
          "n1925222792",
          [48.895987, 2.237501],
          "",
          // Punk: the note under the tickets says it.
          /trop haute ou trop inclinée pour identifier/,
        ],
        // No reach given for it: no "Identifier :" ruler line.
        [
          "n2001231961",
          [48.896526, 2.239174],
          "",
          /Position ou direction à vérifier(?![\s\S]*Identifier :)/,
        ],
        [
          "n1933603486",
          [48.895967, 2.23638],
          "",
          // Punk: the note under the tickets, the other estimate rounded up, no « ~ », and no
          // « si elle est tournée vers vous » (removed 2026-10-11).
          /(?<!tournée vers vous · )Prudent\s:\s[\d\s—·]+\sm[\s\S]*Direction[\s\S]*non relevée/i,
        ],
        [
          "n1933603486",
          [48.895967, 2.23638],
          "prudent",
          /(?<!tournée vers vous · )Standard\s:\s[\d\s—·]+\sm[\s\S]*Direction[\s\S]*non relevée/i,
        ],
      ]) {
        const q = est ? `&est=${est}` : "";
        await page.goto(`${APP}?cam=${cam}${q}#18/${at[0]}/${at[1]}`);
        await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
        await page
          .waitForFunction(() => !document.getElementById("sheet").hidden, null, { timeout: 20000 })
          .catch(() => {});
        // The dome's chips are in the body: read the whole sheet.
        const whole = ["n1933603486", "n1923568277", "n1925222790"].includes(cam);
        // The punk sheet's headline names its tickets (lot 3.2): read first.
        const named = await page
          .evaluate(
            () => document.querySelector("#sheet .tickets")?.getAttribute("aria-label") ?? "",
          )
          .catch(() => "");
        const seen = await page
          .locator(whole ? "#sheet" : "#sheet .sheet-top")
          .innerText()
          .catch(() => "");
        const head = named ? `${named}\n${seen}` : seen;
        const ok =
          want.test(head) && (cam !== "n2001231961" || /Corriger sur OpenStreetMap/.test(head));
        check(
          `?cam=${cam}${q}: sheet opens, headline right`,
          // The camera with a field must never be said to be inside a building.
          ok && (cam === "n2001231961" || !/bâtiment/.test(head)),
          head.replace(/\n/g, " / "),
        );
        // Let the fit and its tiles settle before the next link: WebKit reports the
        // fetches a navigation cancels as "access control" errors.
        await idle(page);
      }
    }

    // "Partager" hands a ?cam= link to the system share sheet (captured here), which opens
    // that camera's sheet. Outside the CI extract no link opened a sheet above: tap a camera.
    if (!(await page.locator("#sheet .share").isVisible())) {
      await page.goto(`${APP}#17/${STREET[1]}/${STREET[0]}`);
      await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
      await idle(page);
      const any = await cameraAt(page, vh * 0.45);
      if (any) await page.touchscreen.tap(any.x, any.y);
      await page.waitForTimeout(900);
      await idle(page);
    }
    if (await page.locator("#sheet .share").isVisible()) {
      await page.evaluate(() => {
        navigator.share = async (d) => {
          window.__shared = d.url;
        };
      });
      await page.locator("#sheet .share").tap();
      await page.waitForTimeout(300);
      const link = await page.evaluate(() => window.__shared ?? "");
      const opened = link
        ? await (async () => {
            await page.goto(link.replace(/^https?:\/\/[^/]+\//, APP));
            await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
            return page
              .waitForFunction(() => !document.getElementById("sheet").hidden, null, {
                timeout: 20000,
              })
              .then(() => true)
              .catch(() => false);
          })()
        : false;
      check(
        "share: a ?cam= link that opens the sheet",
        // CI: the last camera the headline checks opened.
        (region === "ci" ? /\?cam=n1933603486/ : /\?cam=[nwr]\d+/).test(link) && opened,
        link,
      );
    } else {
      check("share: button in the sheet", false, "no .share");
    }

    // ?debug=1: the band with the sheet state and the viewport heights.
    await page.goto(`${APP}?debug=1#17/${STREET[1]}/${STREET[0]}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const band = await page
      .locator("#debug")
      .innerText()
      .catch(() => "");
    check(
      "debug band: sheet state and viewport heights",
      /sheet:/.test(band) &&
        /visualViewport\.height/.test(band) &&
        /safe-area-inset-bottom/.test(band),
      band.split("\n").slice(0, 4).join(" / "),
    );

    // Landscape phone (touch, 390 px high): the phone layout too.
    const land = await browser.newContext({
      ...devices["iPhone 14"],
      viewport: { width: 844, height: 390 },
      screen: { width: 844, height: 390 },
    });
    const lp = await land.newPage();
    await lp.goto(`${APP}#16/${STREET[1]}/${STREET[0]}`);
    await lp.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await lp.waitForTimeout(800);
    check(
      "landscape phone: phone layout (Filtres button, no side panel)",
      (await lp.locator("#fab-filters").isVisible()) && !(await lp.locator("#filters").isVisible()),
    );
    // A link frames the camera's field in the part the half sheet leaves free, even when the
    // field needs more room than that part has and the zoom is raised to the street level:
    // the field's middle (here the camera: a full circle) stays in it, not three times as
    // far as the free part's offset (lot U).
    if (region === "ci") {
      await lp.goto(`${APP}?cam=n9622344410&est=prudent#16/${STREET[1]}/${STREET[0]}`);
      await lp.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
      await lp
        .waitForFunction(() => !document.getElementById("sheet").hidden, null, { timeout: 20000 })
        .catch(() => {});
      await idle(lp);
      const linked = await lp.evaluate(() => {
        const m = window.__map;
        const f = m
          .querySourceFeatures("detail", { sourceLayer: "cameras" })
          .find((c) => c.properties.id === "n9622344410");
        const r = m.getCanvas().getBoundingClientRect();
        const q = f ? m.project(f.geometry.coordinates) : null;
        return {
          y: q ? Math.round(q.y + r.top) : null,
          zoom: +m.getZoom().toFixed(2),
          bar: document.getElementById("estimate").getBoundingClientRect().bottom,
          sheetTop: document.getElementById("sheet").getBoundingClientRect().top,
        };
      });
      check(
        "landscape phone, ?cam= of a wide field: the camera framed between the bar and the sheet",
        linked.y !== null && linked.y >= linked.bar && linked.y <= linked.sheetTop,
        JSON.stringify(linked),
      );
    }
    await land.close();

    // The headline starts with the chosen hypothesis (an old est=cautious link: Prudent).
    if (region === "ci") {
      await page.goto(`${APP}?cam=n1925222792&est=cautious#18/48.895987/2.237501`);
      await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
      await page
        .waitForFunction(() => !document.getElementById("sheet").hidden, null, { timeout: 20000 })
        .catch(() => {});
      // The punk sheet: the chosen estimate's tickets, the other one in the note under them.
      const h = await page
        .evaluate(() => {
          const top = document.querySelector("#sheet .sheet-top");
          return document.querySelector("#sheet .tickets")
            ? (top?.innerText ?? "").replace(/\s+/g, " ")
            : document.querySelector("#sheet .headline")?.innerText;
        })
        .catch(() => "");
      check(
        "Prudent chosen: headline (punk: the tickets) starts with its reach",
        // 10.4 m, stored rounded up to the metre since 2026-10-08 (optics.label_m).
        /^Peut identifier jusqu'à ~11\sm \(en standard, trop haute/.test(h) ||
          /11\sm identifie[\s\S]*Standard\s:\s—/.test(h),
        h,
      );
      // The sheet's fit to the field moves the map: let it settle before leaving the page,
      // or WebKit logs the tile requests the navigation cancels as console errors (seen in
      // the punk interface since lot 3.1, six of them, at this navigation only).
      await idle(page);
    }

    // ?debug=1 journal: touch, click, selection, focus, sheet, tiles.
    await page.goto(`${APP}?debug=1#17/${STREET[1]}/${STREET[0]}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await idle(page);
    const debugCam = await cameraAt(page, 600);
    if (debugCam) {
      await page.touchscreen.tap(debugCam.x, debugCam.y);
      await page.waitForTimeout(800);
      await idle(page);
    }
    const journal = await page
      .locator("#debug")
      .innerText()
      .catch(() => "");
    const selects = journal.split("\n").filter((l) => / select /.test(l)).length;
    check(
      "debug journal: pointer events, tap recognised, one selection, focus, sheet",
      [
        "touchstart",
        "pointerdown",
        "pointerup",
        "tap recognised",
        "focus applied",
        "sheet open",
      ].every((w) => journal.includes(w)) && selects === 1,
      journal.split("\n").slice(0, 12).join(" / "),
    );

    // Position refused: the button says so (a touch screen shows no tooltip).
    const denied = await browser.newContext({ ...devices["iPhone 14"], permissions: [] });
    const dp = await denied.newPage();
    await dp.goto(`${APP}#15/${STREET[1]}/${STREET[0]}`);
    await dp.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await dp.locator("#fab-locate").tap();
    const said = await dp
      .waitForFunction(
        () => document.getElementById("fab-locate").textContent === "Position indisponible",
        null,
        {
          timeout: 20000,
        },
      )
      .then(() => true)
      .catch(() => false);
    check("locate refused: the button says so", said, await dp.locator("#fab-locate").innerText());
    await denied.close();

    // Communes: a tap opens the commune's sheet; then a camera (its sheet replaces the
    // commune's, the outline goes); then the commune again (camera focus cleared).
    const INSEE = region === "ci" ? "92026" : "75101";
    /** Put STREET at zoom `z` a quarter of the height from the top (above a half sheet). */
    const placeStreet = (z) =>
      page.evaluate(
        ([c, zoom]) => {
          const m = window.__map;
          m.jumpTo({ center: c, zoom });
          m.panBy([0, m.getCanvas().clientHeight * 0.25], { animate: false });
        },
        [STREET, z],
      );
    /** The commune under STREET, with its screen point. */
    const communeAt = () =>
      page.evaluate((at) => {
        const m = window.__map;
        const p = m.project(at);
        const r = m.getCanvas().getBoundingClientRect();
        const f = m.queryRenderedFeatures([p.x, p.y], { layers: ["communes", "communes-none"] })[0];
        return f
          ? { x: p.x + r.left, y: p.y + r.top, code: f.properties.c, name: f.properties.nm }
          : null;
      }, STREET);
    const sheetState = () =>
      page.evaluate(() => ({
        open: !document.getElementById("sheet").hidden,
        area: document.querySelector("#sheet .area-name")?.textContent ?? null,
        head: document.querySelector("#sheet .headline")?.textContent ?? "",
        selected: JSON.stringify(window.__map.getFilter("communes-selected")),
        fan: JSON.stringify(window.__map.getFilter("bands-fan")),
        focus: document.body.classList.contains("focus"),
      }));
    await page.goto(`${APP}#10/${STREET[1]}/${STREET[0]}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await placeStreet(10);
    await idle(page);
    const commune = await communeAt();
    check("z10: a commune under the finger", commune !== null, JSON.stringify(commune));
    if (commune) await page.touchscreen.tap(commune.x, commune.y);
    await page.waitForTimeout(700);
    let st = await sheetState();
    check(
      "tap on a commune: its sheet, outlined",
      st.open && st.area === commune.name && st.selected.includes(`"${commune.code}"`),
      JSON.stringify(st),
    );
    await page.waitForTimeout(900);
    await idle(page);
    const framedC = await areaFramed(page, commune.code);
    check("tapped commune framed above its sheet", framedC.free, JSON.stringify(framedC));
    check(
      "touch targets >= 44 px (commune sheet)",
      (await smallTargets(page)).length === 0,
      (await smallTargets(page)).join(" "),
    );
    {
      // The sheet holds in the phone's width (2026-10-09, « Punk sheets on a phone… »).
      await page.waitForSelector("#sheet .area-place-text", { timeout: 10000 }).catch(() => null);
      const fit = await page.evaluate(AREA_FIT);
      check(
        "punk commune sheet: no sideways scroll, title left of ↑ and ×, the cursor over its ramp",
        fit.sideways.length === 0 && fit.title <= fit.buttons && fit.cursor,
        JSON.stringify(fit),
      );
      const pinned = await page.evaluate(PINNED);
      check(
        "punk commune sheet at half: only its title stays, the tabs and the rest scroll under it",
        pinned.ok,
        JSON.stringify(pinned),
      );
      // Mockup 24a: Y only, « rues à portée » (« des rues à portée » after a percentage,
      // never « au plus », the colour line in words: 2026-10-09, « Punk sheets on a
      // phone… »); its tickets are tabs a finger switches, and « Toutes /
      // Publiques » recounts the street (the sheet stays open, its size kept).
      const before = await page.evaluate(() => document.getElementById("sheet").offsetHeight);
      await page.locator("#area-tab-who").tap();
      await page.waitForTimeout(300);
      await page.locator("#area-tab-streets").tap();
      await page.waitForTimeout(300);
      await page.locator('.area-toggle[data-set="public"]').tap();
      await page.waitForTimeout(300);
      const tabbed = await page.evaluate(() => ({
        open: !document.getElementById("sheet").hidden,
        height: document.getElementById("sheet").offsetHeight,
        selected: document.querySelector("#sheet [role=tab][aria-selected=true]")?.id ?? "",
        streets: document.querySelector("#area-tab-streets")?.getAttribute("aria-label") ?? "",
        pressed: document.querySelector(".area-toggle[aria-pressed=true]")?.dataset.set ?? "",
        text: document.getElementById("sheet").innerText,
        place: document.querySelector("#sheet .area-place-text")?.textContent ?? "",
      }));
      check(
        "punk commune sheet: tabs and « Publiques » by touch, Y « à portée » only",
        tabbed.open &&
          tabbed.height === before &&
          tabbed.selected === "area-tab-streets" &&
          tabbed.pressed === "public" &&
          /^(1 sur [\d\s]+|\d+ sur 10) rues à portée$|^\d+\s% des rues à portée$|^Aucune rue à portée$/.test(
            tabbed.streets,
          ) &&
          !/Entre [\d,]+ %|à coup sûr|au moins|au\splus/.test(tabbed.text) &&
          /^Sa couleur : .+ des rues à portée\)$|^Sur la carte : hachurée/.test(tabbed.place),
        JSON.stringify({ ...tabbed, text: undefined, before }),
      );
    }
    // A département (z6): its sheet, and it is framed above the sheet too.
    await placeStreet(6);
    await idle(page);
    const dep = await page.evaluate((at) => {
      const m = window.__map;
      const p = m.project(at);
      const r = m.getCanvas().getBoundingClientRect();
      const f = m.queryRenderedFeatures([p.x, p.y], { layers: ["deps", "deps-none"] })[0];
      return f ? { x: p.x + r.left, y: p.y + r.top, code: f.properties.c } : null;
    }, STREET);
    if (dep) await page.touchscreen.tap(dep.x, dep.y);
    await page.waitForTimeout(1200);
    await idle(page);
    const framedD = dep ? await areaFramed(page, dep.code) : null;
    check(
      "tapped département: its sheet, framed above it",
      dep !== null && framedD.free && (await page.locator("#sheet .area-name").isVisible()),
      JSON.stringify({ dep, framedD }),
    );
    await page.evaluate((c) => window.__map.jumpTo({ center: c, zoom: 17 }), STREET);
    await idle(page);
    const cam2 = await cameraAt(page, vh * 0.45);
    if (cam2) {
      await page.touchscreen.tap(cam2.x, cam2.y);
      await page.waitForTimeout(900);
      await idle(page);
    }
    st = await sheetState();
    check(
      "then a camera: the camera's sheet replaces it, no commune outlined",
      cam2 !== null && st.open && st.area === null && st.focus && st.selected.includes('""'),
      JSON.stringify(st),
    );
    await placeStreet(10);
    await idle(page);
    // The commune again, away from the camera in focus: in punk its marker stands in the
    // camera's place below z15, and a tap on it goes back to the camera (main.ts).
    const again = await page.evaluate((at) => {
      const m = window.__map;
      const p0 = m.project(at);
      const r = m.getCanvas().getBoundingClientRect();
      const marker = m.getLayer("focus-marker-ring") ? ["focus-marker-ring"] : [];
      for (const [dx, dy] of [
        [0, 0],
        [0, 60],
        [60, 0],
        [-60, 0],
        [0, -60],
        [60, 60],
        [-60, 60],
      ]) {
        const [x, y] = [p0.x + dx, p0.y + dy];
        const near = [
          [x - 24, y - 24],
          [x + 24, y + 24],
        ];
        if (marker.length && m.queryRenderedFeatures(near, { layers: marker }).length) continue;
        const f = m.queryRenderedFeatures([x, y], { layers: ["communes", "communes-none"] })[0];
        if (f) return { x: x + r.left, y: y + r.top, code: f.properties.c, name: f.properties.nm };
      }
      return null;
    }, STREET);
    if (again) await page.touchscreen.tap(again.x, again.y);
    await page.waitForTimeout(700);
    st = await sheetState();
    check(
      "then the commune again: its sheet, camera focus cleared",
      again !== null && st.open && st.area === again.name && !st.focus && st.fan.includes("-1"),
      JSON.stringify(st),
    );

    // ?insee=: the map frames the commune (drawn) and opens its sheet.
    await page.goto(`${APP}?insee=${INSEE}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    const linked = await page
      .waitForFunction(() => document.querySelector("#sheet .area-name"), null, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    const view = await page.evaluate(async (code) => {
      const m = window.__map;
      const [, , [w, s, e, n]] = (await fetch("/tiles/areas.json").then((r) => r.json()))[code];
      // The commune's middle is in the map the sheet leaves free, under the estimate bar.
      const p = m.project([(w + e) / 2, (s + n) / 2]);
      const top = document.getElementById("estimate").getBoundingClientRect().bottom;
      const sheetTop = document.getElementById("sheet").getBoundingClientRect().top;
      return {
        z: m.getZoom(),
        free: p.y > top && p.y < sheetTop && p.x > 0 && p.x < m.getCanvas().clientWidth,
        at: [Math.round(p.x), Math.round(p.y)],
        sheetTop: Math.round(sheetTop),
        name: document.querySelector("#sheet .area-name")?.textContent,
      };
    }, INSEE);
    check(
      `?insee=${INSEE}: the commune framed above the sheet, drawn, sheet open`,
      linked && view.free && view.z >= 8 && view.z <= 11.5,
      JSON.stringify(view),
    );
    // "Partager" gives a ?insee= link.
    await page.evaluate(() => {
      navigator.share = async (d) => {
        window.__sharedArea = d.url;
      };
    });
    await page.locator("#sheet .share").tap();
    await page.waitForTimeout(300);
    const areaLink = await page.evaluate(() => window.__sharedArea ?? "");
    check("commune share: a ?insee= link", areaLink.includes(`?insee=${INSEE}`), areaLink);
  }

  // Punk: the account's screens on a phone (lot « comptes », board 25a), the API simulated
  // (bench/account.mjs), in the second half.
  if (PART !== 1)
    await accountSmoke(browser, {
      app: APP,
      street: STREET,
      phone: true,
      check,
      context: { ...devices["iPhone 14"] },
      smallTargets,
    });

  check("no page or console errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.kill();
}
process.exit(checks.every((c) => c.ok) ? 0 : 1);
