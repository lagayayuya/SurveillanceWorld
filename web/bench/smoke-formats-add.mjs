// The formats' smoke test (smoke-formats.mjs) after « ＋ Ajouter », chained (lot V, the
// author's report of 2026-10-23: « les étiquettes décentrées après l'ajout d'une caméra… il
// arrive au hasard, et parfois un bouton sort de l'écran »: the points' tickets of board 8a,
// participate/score.ts). On the states' servers (states/harness.mjs: the throwaway API on the
// CI build; the sends and GET /api/me/points answered in the page, as the API's 30 writes a
// minute would refuse a chain of adds), one page per format, the add made as a hand
// makes it (real taps on a touch screen: « ＋ Ajouter », « Ici », a dome, the direction, the
// height, « Public », « Envoyer »), then the scene put away. A variant per add, in turn:
//   watch       the scene watched to its end, then Escape;
//   escape-mid  put away 1 s after « Envoyer », the tickets mid-fall (an animation cut short);
//   tap-mid     a touch on the map 2 s after;
//   search      the operator's search typed in before « Envoyer » (its field focused);
//   aim         the direction aimed on the map (« Viser sur la carte › », « Valider »);
//   rotate      the screen turned (or the window resized) 1.5 s after « Envoyer », the
//               scene still up, turned back once put away.
// Through the scene and at its end: on a phone's layout the column, its stack and its total
// centred on the visible screen (within 1 px); on a wide one the column where the sheet
// stood (22 px from the right edge); every ticket that has landed inside the screen
// sideways; every button shown inside the visible screen; the page neither scrolled, zoomed
// nor wider than the screen. Once put away: nothing of the scene or the editor left (the
// scene, the editor's sheet, its tag, the map's padding), and the floating controls apart
// and inside the screen (layout-kit.mjs, smoke-formats.mjs's own check). A ticket above the
// screen's top is said (« note »), not failed: on a phone held sideways 375 px high or less
// the stack of an add does not fit even gathered (score.ts tooHigh), an open question.
// The gate's budget (measured 2026-10-23, an M-series Mac: an add takes 9 s in WebKit and
// Firefox, 25 to 40 s in Chromium, whose headless map draws slowly):
//   webkit    every format, one add turned mid-scene each (a new context per format: a cold
//             cache, the punk fonts loading after the map as on a first visit); then 20 adds
//             chained in one page at 390 × 844 (a warm cache), the six variants in turn;
//   chromium  6 adds chained at 390 × 844 under a CPU 6 times slower (bench/profiles.mjs's
//             lowend, through CDP), the six variants once; one add turned on a tablet and a
//             desktop format;
//   firefox   every format, one add turned mid-scene each.
// The reproduction before the fix (lot V): no format at a fixed size ever failed (20 adds
// chained, warm and cold, WebKit, Chromium under ×6), every wide format failed once turned.
//   STATES_PORTS=app,static,api node bench/smoke-formats-add.mjs [--browser webkit|chromium|firefox]
//     [--only NAME] [--runs N] [--variants watch,rotate,…] [--cache warm|cold] [--cpu 6]
//     [--out DIR]   (any of --only, --runs, --variants, --cache, --cpu: that run alone)
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, devices, firefox, webkit } from "playwright";
import { FORMATS, problems, SHAPES } from "./layout-kit.mjs";
import { COOKIE } from "./session.mjs";
import {
  APP,
  closeProxy,
  login,
  startServers,
  stopServers,
  takenPorts,
} from "./states/harness.mjs";
import { launchOptions } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const engine = arg("--browser", "webkit");
const OUT = arg("--out", null) && resolve(arg("--out"));
if (OUT) mkdirSync(OUT, { recursive: true });
// A facade with no camera within 20 m (score-kit.mjs FREE).
const FREE = [48.8981364, 2.2403746];
const ALL = ["watch", "escape-mid", "tap-mid", "search", "aim", "rotate"];
const named = (...names) => FORMATS.filter(([n]) => names.includes(n));

/** Legs: [formats, adds chained per format, variants, cache, CPU slowdown]. */
const custom = ["--only", "--runs", "--variants", "--cache", "--cpu"].some((o) => args.includes(o));
const PLAN = custom
  ? [
      [
        FORMATS.filter(([n]) => !arg("--only") || n.includes(arg("--only"))),
        Number(arg("--runs", "1")),
        arg("--variants", ALL.join(",")).split(","),
        arg("--cache", "warm"),
        Number(arg("--cpu", "1")),
      ],
    ]
  : {
      webkit: [
        [FORMATS, 1, ["rotate"], "warm", 1],
        [named("phone-390x844"), 20, ALL, "warm", 1],
      ],
      chromium: [
        [named("phone-390x844"), 6, ALL, "warm", 6],
        [named("tablet-1024x768", "desktop-1280x720"), 1, ["rotate"], "warm", 1],
      ],
      firefox: [[FORMATS, 1, ["rotate"], "warm", 1]],
    }[engine];

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** What is wrong on the screen now (run in the page): `bad`, and `notes` (said only). */
const MEASURE = () => {
  const PHONE = "(max-width: 600px), (pointer: coarse) and (max-height: 500px)";
  const vv = window.visualViewport;
  // What the eye sees: the visual viewport (a zoomed or shifted page moves it off the
  // layout viewport, which fixed boxes follow).
  const vw = vv?.width ?? innerWidth;
  const vh = vv?.height ?? innerHeight;
  const ox = vv?.offsetLeft ?? 0;
  const oy = vv?.offsetTop ?? 0;
  const bad = [];
  const notes = [];
  if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) bad.push(`visual viewport shifted ${ox},${oy}`);
  if (vv && Math.abs(vv.scale - 1) > 0.001) bad.push(`page zoomed ×${vv.scale}`);
  if (scrollX || scrollY) bad.push(`page scrolled ${scrollX},${scrollY}`);
  // The body is fixed, its overflow hidden: no finger scrolls it, but a script's
  // scrollIntoView or a focus() without preventScroll does, and every control then moves
  // with it, out of reach.
  const body = document.body;
  if (body.scrollTop || body.scrollLeft)
    bad.push(`body scrolled ${body.scrollLeft},${body.scrollTop}`);
  // A page wider or taller than the screen can be panned by a finger (the body is fixed,
  // its overflow hidden: what it holds beyond the screen cannot).
  const html = document.documentElement;
  if (html.scrollWidth > innerWidth + 0.5 || html.scrollHeight > innerHeight + 0.5)
    bad.push(
      `page ${html.scrollWidth}×${html.scrollHeight} on a ${innerWidth}×${innerHeight} screen`,
    );
  const phone = matchMedia(PHONE).matches;
  const root = document.getElementById("score");
  if (root) {
    const col = root.querySelector(".score-col");
    const c = col.getBoundingClientRect();
    const mid = (r) => (r.left + r.right) / 2;
    if (phone) {
      if (Math.abs(mid(c) - ox - vw / 2) > 1)
        bad.push(`column off-centre by ${(mid(c) - ox - vw / 2).toFixed(1)} px`);
      const st = root.querySelector(".score-stack").getBoundingClientRect();
      if (st.width && Math.abs(mid(st) - mid(c)) > 1)
        bad.push(`stack off-centre by ${(mid(st) - mid(c)).toFixed(1)} px`);
      const total = root.querySelector(".score-total");
      const at = total.offsetLeft + total.offsetWidth / 2;
      if (Math.abs(at - col.clientWidth / 2) > 1)
        bad.push(`total off-centre by ${(at - col.clientWidth / 2).toFixed(1)} px`);
    } else if (Math.abs(html.clientWidth - 22 - c.right) > 1)
      // Where the sheet stood: both sheets 22 px from the right edge (theme/punk/
      // participate.css #modify-panel, sheet.css #sheet).
      bad.push(`column's right edge at ${c.right | 0} on a ${html.clientWidth} px screen`);
    for (const tk of root.querySelectorAll(".score-ticket:not([hidden])")) {
      // Mid-fall (from 330 px above, 1.25 times larger) it may pass the edges: once landed.
      if (tk.getAnimations().some((a) => a.playState !== "finished")) continue;
      const r = tk.getBoundingClientRect();
      const box = `(${r.left | 0},${r.top | 0})-(${r.right | 0},${r.bottom | 0})`;
      if (r.left - ox < -0.5 || r.right - ox > vw + 0.5) bad.push(`ticket out ${box}`);
      else if (r.top - oy < -0.5) notes.push(`ticket above the screen ${box}`);
    }
  }
  for (const b of document.querySelectorAll("button")) {
    if (!b.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    // The editor's sheet slides away once sent (inert, then hidden), its paper scrolls; the
    // camera sheet, the filters and the machine are not open here; the credit is
    // smoke-formats.mjs's.
    if (b.closest(".maplibregl-ctrl-attrib, #sheet, #filters, .machine, #modify-panel")) continue;
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (
      r.left - ox < -0.5 ||
      r.top - oy < -0.5 ||
      r.right - ox > vw + 0.5 ||
      r.bottom - oy > vh + 0.5
    )
      bad.push(
        `« ${b.textContent.trim() || b.id} » out of the screen (${r.left | 0},${r.top | 0})-(${r.right | 0},${r.bottom | 0})`,
      );
  }
  return { bad, notes };
};

/** Nothing of the scene or the editor left once put away (run in the page). */
const LEFT = () => {
  const out = [];
  if (document.body.classList.contains("scoring")) out.push("body.scoring left");
  for (const id of ["score", "modify-panel", "edit-tag", "edit-pin"])
    if (document.getElementById(id)) out.push(`#${id} left`);
  const p = window.__map.getPadding();
  if (p.top || p.bottom || p.left || p.right) out.push(`map padding ${JSON.stringify(p)} left`);
  return out;
};

async function newPage(browser, [, w, h, dpr, touch], cpu) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    hasTouch: touch,
    // Not in Firefox (Playwright: « isMobile … is not supported in Firefox »).
    ...(touch && engine !== "firefox"
      ? { isMobile: true, userAgent: devices["iPhone 14"].userAgent }
      : {}),
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });
  // A returning visitor (no welcome), punk; the punk fonts not remembered: a new context
  // loads them after the map, as a first visit does (theme/fonts.ts).
  await context.addInitScript(() => {
    try {
      localStorage.setItem("lacarte.ui", "punk");
      localStorage.setItem("lacarte.welcome", "1");
    } catch {
      // about:blank has no storage.
    }
  });
  await context.addCookies([
    { name: COOKIE, value: await login("ana"), url: APP, httpOnly: true, sameSite: "Strict" },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (cpu > 1 && engine === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  }
  // The sends answered here, the points from them (26a's scale: an add 50, an info 10).
  const sent = new Map();
  await page.route("**/api/contributions", (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    const body = req.postDataJSON();
    sent.set(body.uuid, body);
    return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });
  await page.route(/\/api\/me\/points\?/, (route) => {
    const items = new URL(route.request().url()).searchParams
      .getAll("uuid")
      .filter((u) => sent.has(u))
      .map((uuid) => {
        const add = sent.get(uuid).kind === "add";
        return {
          uuid,
          kind: sent.get(uuid).kind,
          category: add ? "add" : "info",
          points: add ? 50 : 10,
          bonus: false,
          accepted: false,
        };
      });
    const total = items.reduce((s, i) => s + i.points, 0);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, total }),
    });
  });
  return { context, page, errors, touch };
}

/** A real tap on a touch screen (a click elsewhere, and in Firefox) on `target` at rest. */
async function tap(page, touch, target) {
  const loc = typeof target === "string" ? page.locator(target).first() : target;
  await loc.waitFor({ state: "visible", timeout: 20000 });
  // Into the middle of its panel's paper, as a finger scrolls it (above its foot,
  // « Envoyer »), that paper alone: scrollIntoView would scroll the body too (a box whose
  // overflow is hidden still scrolls by script), which no finger can do.
  await loc.evaluate((e) => {
    const paper = e.closest(".modify-paper");
    if (!paper) return;
    const r = e.getBoundingClientRect();
    const p = paper.getBoundingClientRect();
    paper.scrollTop += r.top + r.height / 2 - (p.top + p.height / 2);
  });
  // A box at rest: the sheet's lines unfold and slide (a tap on a moving target lands on
  // its neighbour).
  let b = await loc.boundingBox();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(80);
    const n = await loc.boundingBox();
    const same = b && n && Math.abs(n.x - b.x) < 0.5 && Math.abs(n.y - b.y) < 0.5;
    b = n;
    if (same) break;
  }
  if (!b) throw new Error(`no box for ${target}`);
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  if (touch && engine !== "firefox") await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

const view = (page, v) =>
  page.waitForSelector(`#modify-panel[data-view="${v}"]`, { timeout: 30000 });

/** Turn the screen: its width and height swapped. */
async function turn(page) {
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.height, height: vp.width });
}

/** One add, the scene, put away; what was wrong through it. */
async function oneAdd(page, touch, variant, label) {
  const wrong = [];
  const notes = [];
  const look = async (when) => {
    const m = await page.evaluate(MEASURE);
    wrong.push(...m.bad.map((b) => `${when}: ${b}`));
    notes.push(...m.notes.map((n) => `${when}: ${n}`));
    return m.bad.length > 0;
  };
  await page.waitForSelector("#fab-add:not([hidden]):not([aria-disabled='true'])", {
    timeout: 60000,
  });
  await tap(page, touch, "#fab-add");
  await view(page, "position");
  await page.waitForTimeout(600);
  await tap(page, touch, "#modify-here");
  await page.waitForSelector('#modify-panel:is([data-view="sheet"], [data-view="duplicates"])', {
    timeout: 30000,
  });
  if (await page.locator("#add-other").count()) {
    await tap(page, touch, "#add-other");
    await view(page, "sheet");
  }
  const choose = async (selector) => {
    await tap(page, touch, `#modify-panel :is(.modify-tile, .modify-chip)${selector}`);
    await page.waitForTimeout(150);
  };
  const unfold = async (field) => {
    const line = page.locator(`#modify-panel .modify-line[data-field="${field}"]`);
    if ((await line.count()) && (await line.evaluate((e) => e.tagName === "BUTTON")))
      await tap(page, touch, line);
  };
  await choose('[data-answer="dome"]');
  await unfold("direction");
  if (variant === "aim") {
    // « Viser sur la carte › »: the map slid so that a point 16 m east-north-east is under
    // the target (a phone's stays at the map's centre), posed by a click on a wide screen.
    await tap(page, touch, "#modify-aim-open");
    await view(page, "aim");
    await page.waitForTimeout(1200);
    const at = await page.evaluate(() => {
      const pin = document.getElementById("edit-pin");
      const [lon, lat] = [Number(pin.dataset.lng), Number(pin.dataset.lat)];
      const k = Math.cos((lat * Math.PI) / 180);
      const m = window.__map;
      m.jumpTo({ center: [lon + 15 / (111320 * k), lat + 6 / 111320] });
      const r = m.getCanvas().getBoundingClientRect();
      const q = m.project(m.getCenter());
      return { x: r.left + q.x, y: r.top + q.y };
    });
    if (!touch) await page.mouse.click(at.x, at.y);
    await page.waitForSelector("#aim-submit:not([disabled])", { timeout: 15000 });
    await tap(page, touch, "#aim-submit");
    await view(page, "sheet");
  } else await choose('[data-answer="unknown"][data-part="direction"]');
  await choose('[data-answer="first"][data-part="height"]');
  await unfold("operator");
  await choose('[data-answer="public"][data-part="operator"]');
  if (variant === "search") {
    await tap(page, touch, "#modify-operator-search");
    await page.keyboard.type("Vil", { delay: 60 });
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(300);
  await look("before « Envoyer »");
  await tap(page, touch, "#modify-send");
  await page.waitForSelector("#score", { timeout: 20000 });
  const sent = Date.now();
  if (variant === "escape-mid" || variant === "tap-mid") {
    await page.waitForTimeout(
      Math.max(0, (variant === "escape-mid" ? 1000 : 2000) - (Date.now() - sent)),
    );
    if (variant === "escape-mid") await page.keyboard.press("Escape");
    else {
      // A touch on the map, clear of the controls: a third down, in the middle.
      const vp = page.viewportSize();
      if (touch && engine !== "firefox") await page.touchscreen.tap(vp.width / 2, vp.height / 3);
      else await page.mouse.click(vp.width / 2, vp.height / 3);
    }
  } else {
    let turned = variant !== "rotate";
    while (Date.now() - sent < 4500) {
      if (!turned && Date.now() - sent > 1500) {
        await turn(page);
        turned = true;
      }
      await look("during the scene");
      await page.waitForTimeout(150);
    }
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
    await page.waitForTimeout(300);
    if ((await look("the scene at rest")) && OUT)
      await page.screenshot({ path: `${OUT}/${label}-scene.png` });
    await page.keyboard.press("Escape");
  }
  await page.waitForSelector("#score", { state: "detached", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const after = await look("put away");
  const left = await page.evaluate(LEFT);
  const controls = problems(await page.evaluate(SHAPES));
  wrong.push(...left.map((l) => `put away: ${l}`), ...controls.map((c) => `put away: ${c}`));
  if (OUT && (after || left.length || controls.length))
    await page.screenshot({ path: `${OUT}/${label}-after.png` });
  if (variant === "rotate") {
    await turn(page);
    await page.waitForTimeout(500);
  }
  return { wrong: [...new Set(wrong)], notes: [...new Set(notes)] };
}

const taken = await takenPorts();
if (taken.length) {
  console.log(`FAIL ports taken: ${taken.join(", ")}`);
  process.exit(2);
}
let browser;
const t0 = Date.now();
try {
  await startServers();
  browser = await { chromium, webkit, firefox }[engine].launch(launchOptions(engine));
  for (const [formats, runs, variants, cache, cpu] of PLAN) {
    for (const format of formats) {
      const name = format[0];
      let open = null;
      let failed = 0;
      for (let i = 0; i < runs; i++) {
        const variant = variants[i % variants.length];
        const label = `${engine}-${name}-${cache}-cpu${cpu}-${i}-${variant}`;
        const what = `${name}${cpu > 1 ? ` CPU ×${cpu}` : ""}, add ${i + 1}/${runs} (${variant}, ${cache} cache)`;
        try {
          if (cache === "cold" || !open) {
            await open?.context.close();
            open = await newPage(browser, format, cpu);
            await open.page.goto(`${APP}?add=${i}#18/${FREE[0]}/${FREE[1]}`);
            await open.page.waitForFunction(() => window.__map?.loaded(), null, {
              timeout: 60000,
            });
          }
          const r = await oneAdd(open.page, open.touch, variant, label);
          const errors = open.errors.splice(0);
          if (r.wrong.length || errors.length) failed++;
          check(
            `${what}: the tickets centred or in the sheet's column, every button on the screen, nothing left, the controls apart`,
            r.wrong.length === 0 && errors.length === 0,
            [...r.wrong, ...errors].join(" | "),
          );
          if (r.notes.length) console.log(`note [${engine}] ${what}: ${r.notes.join(" | ")}`);
        } catch (e) {
          failed++;
          check(`${what}: the add went through`, false, String(e).split("\n")[0]);
          if (OUT && open)
            await open.page.screenshot({ path: `${OUT}/${label}-error.png` }).catch(() => {});
          await open?.context.close().catch(() => {});
          open = null;
        }
      }
      if (runs > 1) console.log(`     [${engine}] ${name}: ${failed}/${runs} adds wrong`);
      await open?.context.close().catch(() => {});
    }
  }
} finally {
  await browser?.close();
  await stopServers();
  closeProxy();
}
const failed = checks.filter((c) => !c.ok);
console.log(
  `[${engine}] ${failed.length}/${checks.length} adds wrong, ${Math.round((Date.now() - t0) / 1000)} s`,
);
if (OUT) writeFileSync(`${OUT}/checks-${engine}.json`, JSON.stringify(checks, null, 1));
process.exit(failed.length ? 1 : 0);
