// Smoke test of the punk map's layout on every screen format (lot M, 2026-10-17: on a
// 360 px Android phone the header ticket covered « Standard », and « ＋ Ajouter » and « Me
// localiser » floated high above the bottom, nearly touching). From 320 px to 1920 px wide,
// phones held upright and sideways, tablets, desktops, in light and dark: the floating
// controls — the ticket, Standard / Prudent, « ＋ Ajouter », « Me localiser », the zoom
// buttons where shown, the attribution's « ⓘ » (its strip on a wide screen) — keep clear of
// each other (MIN_GAP), stay inside the screen, and the floating buttons sit at the visible
// bottom (visualViewport). A control hidden on purpose at a format (the zoom buttons on a
// phone) is skipped. Shapes are measured as drawn: each control's own box turned by its
// tilt and scaled as the CSS says (rotate, scale, transform), a pastille as its circle, so
// a tilt counts and a bounding box's corners do not. Then, on each format, a camera
// sheet's head with the longest title there is (lot U2, longestTitle below), and on each
// touch format the page never zoomed (« Zoom bloqué », 2026-10-23, noZoom below). With
// --out, a capture of each format and mode.
//   node bench/smoke-formats.mjs [--browser chromium|webkit|firefox] [--region ci]
//                                [--port N] [--out DIR] [--only NAME] [--zoom 1.3]
//                                [--fields some|all|none]
// Playwright's viewports have no browser bars that come and go: the bottom is checked
// against visualViewport, which on a real phone follows them; the harness cannot show the
// bars themselves (a real Android's address bar, a real iPhone's toolbar).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { fieldCases } from "./fields.mjs";
import { FORMATS as ALL_FORMATS, problems, SHAPES } from "./layout-kit.mjs";
import { benchBrowser, launchOptions } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const region = arg("--region", "ci");
requireTiles(region);
const engine = arg("--browser", "chromium");
const PORT = Number(arg("--port", "4194"));
const APP = `http://localhost:${PORT}/`;
const OUT = arg("--out", null) && resolve(arg("--out"));
const ONLY = arg("--only", null);
// --zoom 1.3: each format seen through a page zoom (the browser's, which divides the CSS
// width and height and multiplies the pixel ratio); not run by the gate. The punk controls
// are sized in px, so a larger root font size (`html { font-size: 130% }`) would not move
// them: a system text size is not simulated here.
const ZOOM = Number(arg("--zoom", "1"));
if (OUT) mkdirSync(OUT, { recursive: true });
// The user's report was at zoom 13 (« ＋ Ajouter » shown, muted, below z15).
const CENTRE = region === "ci" ? [2.2377, 48.8977] : [2.3485, 48.8597];
const HASH = `#13/${CENTRE[1]}/${CENTRE[0]}`;
const FORMATS = ALL_FORMATS.filter(([name]) => !ONLY || name.includes(ONLY));

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** The map at rest (its next idle, 4 s at most), the fonts in, then a short pause. */
async function idle(page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        window.__map.once("idle", r);
        window.__map.triggerRepaint();
        setTimeout(r, 4000);
      }),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

// --- the page never zoomed (the author's report of 2026-10-23, « Zoom bloqué »: on a phone
// the page ended up zoomed, its buttons off the screen, with no way back; gestures.ts,
// theme/punk/base.css). On every touch format, on the map then on a camera sheet:
//   - statically, in every engine: the root says pan-x pan-y, the map's canvas none, and no
//     element shown (but the map's) lets a pinch or a double tap zoom the page, read both as
//     the Pointer Events spec says (the chain up to the root) and as WebKit does (the chain
//     cut at the nearest scroll container, StyleAdjuster.cpp computeUsedTouchAction: a
//     sheet's scrolling paper started afresh at `auto`); the mark `data-page-zoomed` set by
//     hand gives every element back to the browser (`auto`), the canvas kept;
//   - a double tap on the ticket, the estimate bar and the sheet's paper (two taps 80 ms
//     apart), then, in Chromium only, a pinch out on them and on the map
//     (Input.synthesizePinchGesture, touch): visualViewport.scale stays 1 and every control
//     shown stays reachable (CONTROLS: inside the visible part, or inside a scrolling paper
//     that is);
//   - Chromium only, the way back out: the page forced to a scale of 2
//     (Emulation.setPageScaleFactor), the mark comes, the ticket says auto, and a pinch in on
//     the ticket brings the page back to 1 and the mark goes;
//   - in each field (bench/fields.mjs), tapped then typed in, then let go: every text field
//     of its screen 16 px or more where the phone layout applies (WebKit zooms an iPhone's
//     page on a field to 16 / its size, WKWebViewIOS.mm _zoomToFocusRect, and leaves it
//     zoomed), the scale 1, every control reachable. By default on three phones (--fields
//     all: every touch format; none: skipped).
// What the harness cannot show: Playwright's WebKit is not iOS (no focus zoom, no pinch: no
// multi-touch is synthesized there), Firefox has no `isMobile` and no pinch either, and
// Chromium already declines both a double tap's zoom (a width=device-width page) and a
// field's (« decide not to zoom in if the user won't be able to zoom out »,
// web_frame_widget_impl.cc): those checks keep the page from regressing; the pinch and the
// way out are the ones Chromium plays for real. Only an iPhone shows Safari's own.
const FIELDS = arg("--fields", "some");
const FIELD_FORMATS = ["phone-320x568", "phone-390x844", "phone-844x390"];
const FIELD_AT = "#17.6/48.8977/2.2377";

/** The page's zoom state and what would let a gesture zoom it (run in the page). */
const ZOOM_STATE = () => {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const ta = (e) => getComputedStyle(e).touchAction;
  const pinches = (v) => v === "auto" || v === "manipulation" || v.includes("pinch-zoom");
  const scrolls = (e) => {
    const s = getComputedStyle(e);
    return /^(auto|scroll)$/.test(s.overflowX) || /^(auto|scroll)$/.test(s.overflowY);
  };
  const name = (e) =>
    e.id
      ? `#${e.id}`
      : `${e.tagName.toLowerCase()}${[...e.classList].map((c) => `.${c}`).join("")}`;
  const open = [];
  for (const e of document.querySelectorAll("body, body *")) {
    if (e.closest(".maplibregl-canvas-container")) continue;
    if (!e.checkVisibility({ visibilityProperty: true })) continue;
    if (getComputedStyle(e).pointerEvents === "none") continue;
    // A way is open when every element of its chain allows it.
    let cut = false;
    const allow = {
      pinch: true,
      "double tap": true,
      "webkit pinch": true,
      "webkit double tap": true,
    };
    for (let x = e; x; x = x.parentElement) {
      const v = ta(x);
      if (!pinches(v)) {
        allow.pinch = false;
        if (!cut) allow["webkit pinch"] = false;
      }
      if (v !== "auto") {
        allow["double tap"] = false;
        if (!cut) allow["webkit double tap"] = false;
      }
      if (scrolls(x)) cut = true;
    }
    const left = Object.entries(allow)
      .filter(([, ok]) => ok)
      .map(([k]) => k);
    if (left.length) open.push(`${name(e)} (${left.join(", ")})`);
  }
  const canvas = document.querySelector(".maplibregl-canvas-container");
  return {
    scale: vv ? vv.scale : 1,
    offset: vv ? [Math.round(vv.offsetLeft), Math.round(vv.offsetTop)] : [0, 0],
    marked: root.dataset.pageZoomed !== undefined,
    root: ta(root),
    canvas: canvas ? ta(canvas) : null,
    open,
  };
};

/** The controls shown that a finger cannot reach in the visible part (run in the page): a
 * control must lie inside the visual viewport across, and down too unless the page itself
 * brings it up: a scrolling paper shown in the visible part, or the phone's sheet (pulled
 * up by its grip). A zoomed page fails it: the visible part is a piece of the screen. */
const CONTROLS = () => {
  const vv = window.visualViewport;
  const [L, T, W, H] = vv
    ? [vv.offsetLeft, vv.offsetTop, vv.width, vv.height]
    : [0, 0, window.innerWidth, window.innerHeight];
  const across = (r) => r.left >= L - 1 && r.right <= L + W + 1;
  const down = (r) => r.top >= T - 1 && r.bottom <= T + H + 1;
  const meets = (r) => r.left < L + W && r.right > L && r.top < T + H && r.bottom > T;
  const scroller = (e) => {
    for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
      const s = getComputedStyle(x);
      const y = /^(auto|scroll)$/.test(s.overflowY) && x.scrollHeight > x.clientHeight + 1;
      const xx = /^(auto|scroll)$/.test(s.overflowX) && x.scrollWidth > x.clientWidth + 1;
      if (y || xx) return x;
    }
    return null;
  };
  const name = (e) =>
    e.id
      ? `#${e.id}`
      : `${e.tagName.toLowerCase()}${[...e.classList].map((c) => `.${c}`).join("")}`;
  const out = [];
  let shown = 0;
  for (const e of document.querySelectorAll(
    "button, [role=button], a[href], input:not([type=hidden]), select, textarea",
  )) {
    if (!e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    if (e.closest("[inert], [aria-hidden=true]")) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    shown++;
    const s = scroller(e);
    const sheet = e.closest("#sheet");
    const brought =
      (s && meets(s.getBoundingClientRect())) || (sheet && meets(sheet.getBoundingClientRect()));
    if (across(r) && (down(r) || brought)) continue;
    out.push(`${name(e)} (${r.left | 0},${r.top | 0})-(${r.right | 0},${r.bottom | 0})`);
  }
  return { shown, out, viewport: [L | 0, T | 0, W | 0, H | 0] };
};

/** A point of `selector` where a tap or a pinch lands on nothing that acts (no button, link,
 * field, label or summary), inside the visible part (the visual viewport, when the page is
 * zoomed), the nearest to its centre; with `spread`, the points that far above and below
 * it too (a synthesized pinch puts its two fingers there: one on the map, and the map takes
 * the gesture). Null when there is none (run in the page). `x`, `y` in the layout viewport
 * (elementFromPoint, a tap); `vx`, `vy` in the visible part, in CSS px (Chromium's
 * synthesized gestures, measured: a point beyond it is refused, « Position out of
 * bounds »). */
const QUIET = ([selector, spread]) => {
  const el = document.querySelector(selector);
  if (!el?.checkVisibility({ visibilityProperty: true })) return null;
  const r = el.getBoundingClientRect();
  const vv = window.visualViewport;
  const [L, T, W, H] = vv
    ? [vv.offsetLeft, vv.offsetTop, vv.width, vv.height]
    : [0, 0, window.innerWidth, window.innerHeight];
  const acts = "button, a[href], input, select, textarea, label, summary, [role=button]";
  const quiet = (x, y) => {
    if (x < L + 2 || y < T + 2 || x > L + W - 2 || y > T + H - 2) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && el.contains(hit) && !hit.closest(acts);
  };
  // A grid over the part of it that is shown.
  const [x0, x1] = [Math.max(r.left, L), Math.min(r.right, L + W)];
  const [y0, y1] = [Math.max(r.top, T), Math.min(r.bottom, T + H)];
  const points = [];
  for (let fy = 0.05; fy < 1; fy += 0.1)
    for (let fx = 0.05; fx < 1; fx += 0.1) {
      const x = x0 + (x1 - x0) * fx;
      const y = y0 + (y1 - y0) * fy;
      if (quiet(x, y) && (!spread || (quiet(x, y - spread) && quiet(x, y + spread))))
        points.push({ x, y, vx: x - L, vy: y - T });
    }
  const d = (q) => Math.hypot(q.x - (L + W / 2), q.y - (T + H / 2));
  return points.sort((a, b) => d(a) - d(b))[0] ?? null;
};

const scaleOk = (s) => Math.abs(s.scale - 1) < 0.01 && s.offset[0] === 0 && s.offset[1] === 0;

/** Two taps 80 ms apart at a quiet point of `selector`; false when it has none. */
async function doubleTap(page, selector) {
  const p = await page.evaluate(QUIET, [selector, 0]);
  if (!p) return false;
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(500);
  return true;
}

/** A pinch (Chromium's CDP, two touch points one above the other) at a quiet point of
 * `selector`, by `factor` (above 1: fingers apart, the zoom in); with `both`, both fingers
 * on `selector` (they start about 36 / factor CSS px of the visible part from the point
 * when they close, measured). False when it has no such point. */
async function pinch(page, cdp, selector, factor, both = false) {
  const spread = both ? 36 / Math.min(factor, 1) + 6 : 0;
  const p = await page.evaluate(QUIET, [selector, spread]);
  if (!p) return false;
  try {
    await cdp.send("Input.synthesizePinchGesture", {
      x: p.vx,
      y: p.vy,
      scaleFactor: factor,
      gestureSourceType: "touch",
    });
  } catch (e) {
    console.log(`     pinch on ${selector} refused: ${String(e).split("\n")[0]}`);
    return false;
  }
  await page.waitForTimeout(400);
  return true;
}

/** The static checks, then double taps and pinches on `targets`, on the screen as it is. */
async function noZoom(page, cdp, name, targets) {
  const s = await page.evaluate(ZOOM_STATE);
  check(
    `${name}: no zoom of the page in its touch-action (the root pan-x pan-y, the map's canvas none, no element shown open to a pinch or a double tap, read as the spec and as WebKit)`,
    s.root === "pan-x pan-y" && s.canvas === "none" && s.open.length === 0 && scaleOk(s),
    JSON.stringify({ ...s, open: s.open.slice(0, 8), more: Math.max(0, s.open.length - 8) }),
  );
  const tried = [];
  for (const target of targets) {
    if (cdp && (await pinch(page, cdp, target, 2))) tried.push(`pinch ${target}`);
    if (await doubleTap(page, target)) tried.push(`double tap ${target}`);
  }
  const after = await page.evaluate(ZOOM_STATE);
  const reach = await page.evaluate(CONTROLS);
  check(
    `${name}: after ${tried.join(", ") || "nothing (no quiet point)"}, the page at scale 1 and every control reachable`,
    tried.length > 0 && scaleOk(after) && reach.out.length === 0,
    JSON.stringify({
      scale: after.scale,
      offset: after.offset,
      ...reach,
      out: reach.out.slice(0, 8),
    }),
  );
}

/** The way out, on the screen as it is: the mark by hand gives `paper` and every element
 * back to the browser (every engine); then, in Chromium, the page zoomed to 2, the mark
 * comes, and pinches with both fingers on `paper` (one on the map and the map would take
 * the gesture: the way out is on the interface) bring it back to 1, three at most. */
async function wayOut(page, cdp, name, paper) {
  const byHand = await page.evaluate((sel) => {
    const root = document.documentElement;
    root.dataset.pageZoomed = "";
    const ta = (e) => (e ? getComputedStyle(e).touchAction : null);
    const el = document.querySelector(sel);
    const r = {
      root: ta(root),
      paper: ta(el),
      inside: ta(el?.querySelector("*")),
      canvas: ta(document.querySelector(".maplibregl-canvas-container")),
    };
    delete root.dataset.pageZoomed;
    return r;
  }, paper);
  check(
    `${name}: the mark data-page-zoomed gives every element back to the browser (auto), the map's canvas kept none`,
    byHand.root === "auto" &&
      byHand.paper === "auto" &&
      [null, "auto"].includes(byHand.inside) &&
      byHand.canvas === "none",
    JSON.stringify(byHand),
  );
  if (!cdp) return;
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await page.waitForTimeout(400);
  const zoomed = await page.evaluate(
    (sel) => ({
      scale: window.visualViewport.scale,
      marked: document.documentElement.dataset.pageZoomed !== undefined,
      paper: getComputedStyle(document.querySelector(sel)).touchAction,
    }),
    paper,
  );
  let pinched = 0;
  let back = await page.evaluate(ZOOM_STATE);
  for (let i = 0; i < 3 && back.scale > 1.01; i++) {
    if (!(await pinch(page, cdp, paper, 0.7, true))) break;
    pinched++;
    back = await page.evaluate(ZOOM_STATE);
  }
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await page.waitForTimeout(200);
  check(
    `${name}: zoomed to 2 all the same, the mark comes and pinches on its paper bring the page back to 1`,
    zoomed.scale > 1.5 &&
      zoomed.marked &&
      zoomed.paper === "auto" &&
      pinched > 0 &&
      back.scale < 1.01 &&
      !back.marked,
    JSON.stringify({ zoomed, pinched, back: { scale: back.scale, marked: back.marked } }),
  );
}

/** The welcome (a first visit) and a legal page, each over the map in a fresh context: no
 * element of theirs lets the page zoom, a pinch or a double tap on their paper leaves it at
 * 1 (a pinch on « Conditions » zoomed Chromium's page to 2 before 2026-10-23). */
async function overlays(browser, name, options) {
  const screens = [
    ["welcome", `${APP}?mode=clair${HASH}`, "#welcome [role=dialog]", true],
    ["legal page", `${APP}?mode=clair&page=conditions${HASH}`, "#legal [role=dialog]", false],
  ];
  for (const [what, url, paper, first] of screens) {
    const context = await browser.newContext(options);
    try {
      if (first)
        await context.addInitScript(() => {
          try {
            localStorage.removeItem("lacarte.welcome");
          } catch {
            // about:blank has no storage.
          }
        });
      await context.route("**/api/**", (r) =>
        r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"no_session"}' }),
      );
      const page = await context.newPage();
      const cdp = engine === "chromium" ? await context.newCDPSession(page) : null;
      await page.goto(url);
      await page.waitForSelector(paper, { timeout: 30000 });
      await page.waitForTimeout(700);
      await noZoom(page, cdp, `${name} ${what}`, [paper]);
      if (!first) await wayOut(page, cdp, `${name} ${what}`, paper);
    } catch (e) {
      check(`${name} ${what}`, false, String(e).split("\n")[0]);
    } finally {
      await context.close();
    }
  }
}

/** Every field of every screen in fields.mjs: its size, then tapped, typed in, let go. */
async function fields(browser, format, options) {
  for (const c of fieldCases(APP, FIELD_AT)) {
    const context = await browser.newContext(options);
    const label = `${format} ${c.name}`;
    try {
      const page = await c.open(context);
      await page.waitForSelector(c.field, { state: "visible", timeout: 15000 });
      await page.waitForTimeout(400);
      const list = await page.evaluate(() => {
        const text =
          'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"], [type="file"], [type="hidden"]), textarea, select, [contenteditable="true"]';
        return {
          phone: matchMedia("(max-width: 600px), (pointer: coarse) and (max-height: 500px)")
            .matches,
          fields: [...document.querySelectorAll(text)]
            .filter((e) => e.checkVisibility({ visibilityProperty: true }))
            .map((e, i) => {
              e.dataset.zoomField = String(i);
              return {
                i,
                id: e.id || e.getAttribute("autocomplete") || e.type,
                px: Number.parseFloat(getComputedStyle(e).fontSize),
              };
            }),
        };
      });
      const small = list.fields.filter((f) => f.px < 16);
      check(
        `${label}: every text field ${list.phone ? "16 px or more (phone layout)" : "measured (not the phone layout: no iPhone's focus zoom)"}`,
        list.fields.length > 0 && (!list.phone || small.length === 0),
        JSON.stringify(list.fields.map((f) => `${f.id} ${f.px}px`)),
      );
      for (const f of list.fields) {
        const field = page.locator(`[data-zoom-field="${f.i}"]`);
        await field.scrollIntoViewIfNeeded();
        await field.tap();
        await page.keyboard.type("zoom", { delay: 20 });
        await page.waitForTimeout(400);
        const typed = await page.evaluate(ZOOM_STATE);
        const reachTyped = await page.evaluate(CONTROLS);
        await page.evaluate(() => document.activeElement?.blur());
        await page.waitForTimeout(400);
        const left = await page.evaluate(ZOOM_STATE);
        const reachLeft = await page.evaluate(CONTROLS);
        check(
          `${label}: ${f.id} tapped, typed in and let go, the page at scale 1 and every control reachable`,
          scaleOk(typed) &&
            scaleOk(left) &&
            reachTyped.out.length === 0 &&
            reachLeft.out.length === 0,
          JSON.stringify({
            typed: typed.scale,
            left: left.scale,
            out: [...new Set([...reachTyped.out, ...reachLeft.out])].slice(0, 8),
          }),
        );
      }
    } catch (e) {
      check(label, false, String(e).split("\n")[0]);
    } finally {
      await context.close();
    }
  }
}

// --- the camera sheet's head with the longest title there is (lot U2: « CAMÉRA FIXE PRIVÉE »
// on three lines seemed to cover « Je confirme / Ce n'est pas ça » on a phone, the paper
// scrolled under its pinned head). The longest of the catalogue's titles, the kind's word
// and the class of who films (chips.ts shortTitle, fr.json): « Lecteur de plaques de
// particulier » (33 characters, five words; « Caméra panoramique de particulier » and
// « Sonnette connectée de particulier » as long, with fewer words), drawn by chips.ts in a
// real sheet of the CI extract (the household camera of shots-theme.mjs). In each place the
// sheet takes (a phone's half and full heights; a wide screen's column): the letters inside
// the head, apart from ↑ and ×, the first line under it below its letters; then, the paper
// scrolled (made longer if it was not), the pinned head of a phone folded to one bar (its
// title on one line, cut short), so that nothing scrolls under a title of several lines.
const CHIPS_JS = stripTypeScriptTypes(readFileSync(resolve(WEB, "src/chips.ts"), "utf8"));
const LONGEST = "Lecteur de plaques de particulier";
const HOUSEHOLD = "cam=n1864927349#18/48.897241/2.239254";

/** The head as laid out (run in the page). */
const HEAD = () => {
  const box = (e) => e.getBoundingClientRect();
  const head = document.querySelector("#sheet .sheet-head");
  const letters = [...head.querySelectorAll(".cut")].map(box).filter((r) => r.width > 0);
  const buttons = [...head.querySelectorAll(":scope > :is(.sheet-grab, .close, .sheet-back)")]
    .map(box)
    .filter((r) => r.width > 0);
  const room = document.querySelector("#sheet .sheet-head-room");
  const pinned = !!room && room.offsetHeight > 0;
  // The first thing under the head, in the flow (the room on a phone is the head's place).
  const next = [...document.querySelectorAll("#sheet .sheet-top > *, #sheet .sheet-body > *")]
    .filter((e) => !e.matches(".sheet-head, .sheet-head-room") && e.offsetHeight > 0)
    .map(box)[0];
  const meet = (a, b) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const h = box(head);
  const said = head.querySelector(".headline > .sheet-sr");
  return {
    pinned,
    head: [Math.round(h.top), Math.round(h.bottom)],
    // A letter's tilt and lift (chips.ts TILT, LIFT: 3 px at most) may pass its line's box.
    lettersOut: letters.filter((r) => r.top < h.top - 4 || r.bottom > h.bottom + 4).length,
    onButtons: letters.filter((r) => buttons.some((b) => meet(r, b))).length,
    lettersBottom: Math.round(Math.max(0, ...letters.map((r) => r.bottom))),
    nextTop: next ? Math.round(next.top) : null,
    lines: [...head.querySelectorAll(".cut-word")].length,
    folded: head.classList.contains("compact"),
    saidHeight: said ? Math.round(box(said).height) : 0,
    shownLetters: letters.length,
  };
};

async function longestTitle(page, name) {
  await page.goto(`${APP}?mode=clair&${HOUSEHOLD}`);
  await page.waitForSelector("#sheet .sheet-head .headline", { timeout: 30000 });
  await idle(page);
  await page.evaluate(
    async ([code, title]) => {
      const m = await import(
        `data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(code)))}`
      );
      const h2 = m.cutout(title, title);
      document.querySelector("#sheet .sheet-head .headline").replaceWith(h2);
      m.fitTitle(h2);
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 400));
    },
    [CHIPS_JS, LONGEST],
  );
  const places = [];
  const at = async (place) => {
    const h = await page.evaluate(HEAD);
    places.push(place);
    const bad = [];
    if (h.lettersOut) bad.push(`${h.lettersOut} letters out of the head ${h.head}`);
    if (h.onButtons) bad.push(`${h.onButtons} letters on ↑ / ×`);
    if (h.nextTop !== null && h.nextTop < h.lettersBottom)
      bad.push(`the next line at ${h.nextTop}, the letters down to ${h.lettersBottom}`);
    check(
      `${name} ${place}: the longest title in its head, apart from ↑ and ×, the content under it`,
      bad.length === 0,
      bad.length ? `${bad.join("; ")} ${JSON.stringify(h)}` : "",
    );
    if (OUT) await page.screenshot({ path: resolve(OUT, `${engine}-${name}-title-${place}.png`) });
    return h;
  };
  const first = await at(
    await page.evaluate(() => document.getElementById("sheet").dataset.state ?? "open"),
  );
  if (!first.pinned) return;
  // A phone: its full height, then the paper scrolled.
  await page.evaluate(() => document.querySelector("#sheet .sheet-grab")?.click());
  await page.waitForTimeout(700);
  await at(await page.evaluate(() => document.getElementById("sheet").dataset.state));
  const scrolled = await page.evaluate(async () => {
    const paper = document.querySelector("#sheet .sheet-paper");
    if (paper.scrollHeight - paper.clientHeight < 300) {
      const more = document.createElement("div");
      more.style.height = `${paper.clientHeight}px`;
      document.querySelector("#sheet .sheet-body").append(more);
    }
    paper.scrollTop = 300;
    await new Promise((r) => setTimeout(r, 300));
    return paper.scrollTop;
  });
  const h = await page.evaluate(HEAD);
  check(
    `${name} scrolled: the pinned head folds to one bar (no letters, its title on one line), at most 72 px`,
    scrolled > 0 &&
      h.folded &&
      h.shownLetters === 0 &&
      h.saidHeight > 0 &&
      h.saidHeight <= 30 &&
      h.head[1] - h.head[0] <= 72,
    JSON.stringify({ scrolled, ...h }),
  );
  if (OUT) await page.screenshot({ path: resolve(OUT, `${engine}-${name}-title-scrolled.png`) });
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = benchBrowser(
  await { chromium, webkit, firefox }[engine].launch(launchOptions(engine)),
);
const errors = [];
try {
  for (const [format, w, h, dpr, touch] of FORMATS) {
    const width = Math.round(w / ZOOM);
    const height = Math.round(h / ZOOM);
    const name = ZOOM === 1 ? format : `${format}-zoom${Math.round(ZOOM * 100)}`;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: dpr * ZOOM,
      hasTouch: touch,
      // Not in Firefox (Playwright: « isMobile … is not supported in Firefox »).
      ...(touch && engine !== "firefox" ? { isMobile: true } : {}),
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    const cdp = engine === "chromium" && touch ? await context.newCDPSession(page) : null;
    // No API here: a visitor (401), contributions open (config.ts's defaults), so that
    // « ＋ Ajouter » shows as to anyone.
    await page.route("**/api/**", (r) =>
      r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"no_session"}' }),
    );
    await page.goto(`${APP}?mode=clair${HASH}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await page
      .waitForFunction(() => !document.getElementById("fab-add")?.hidden, null, {
        timeout: 10000,
      })
      .catch(() => {
        // Checked below: a missing « ＋ Ajouter » shows in the controls listed.
      });
    await idle(page);
    for (const mode of ["clair", "sombre"]) {
      if (mode === "sombre") {
        // The ticket's sun / moon, as a tap would (a JS click: no focus ring in the capture).
        await page.evaluate(() => document.getElementById("mode-toggle").click());
        await page.waitForFunction(() => document.documentElement.dataset.mode === "dark");
        await idle(page);
      }
      const m = await page.evaluate(SHAPES);
      const bad = problems(m);
      const shown = m.shapes.map((s) => s.name).join(", ");
      check(
        `${name} ${mode} (${m.phone ? "phone" : "wide"} layout${m.coarse ? ", touch" : ""}): ` +
          "controls apart, inside the screen, buttons at the bottom",
        bad.length === 0,
        bad.length ? `${bad.join("; ")} [${shown}]` : "",
      );
      if (OUT) await page.screenshot({ path: resolve(OUT, `${engine}-${name}-${mode}.png`) });
    }
    // A phone's credit unfolded (its « ⓘ » tapped): the floating buttons rise above it
    // where they would meet it, and nothing else does.
    if (await page.locator("#attrib-toggle").isVisible()) {
      await page.evaluate(() => document.getElementById("attrib-toggle").click());
      await page.waitForTimeout(300);
      const m = await page.evaluate(SHAPES, true);
      const bad = problems(m, false);
      check(
        `${name}: the credit unfolded, on top, controls apart and inside the screen`,
        bad.length === 0,
        bad.join("; "),
      );
      if (OUT) await page.screenshot({ path: resolve(OUT, `${engine}-${name}-credit.png`) });
      await page.evaluate(() => document.getElementById("attrib-toggle").click());
    }
    if (touch) {
      // The mark first, the ticket at rest; then the gestures, the ticket last (a tap on its
      // paper prints the legend over the rest).
      await wayOut(page, null, `${name} map`, "#ticket");
      await noZoom(page, cdp, `${name} map`, ["#map .maplibregl-canvas", "#estimate", "#ticket"]);
    }
    await longestTitle(page, name);
    // The sheet still open, once its title is checked (a tap on its paper may move it).
    if (touch)
      await noZoom(page, cdp, `${name} sheet`, ["#sheet .sheet-body", "#sheet .sheet-paper"]);
    await context.close();
    if (touch) {
      const options = {
        viewport: { width, height },
        deviceScaleFactor: dpr * ZOOM,
        hasTouch: true,
        locale: "fr-FR",
        ...(engine !== "firefox" ? { isMobile: true } : {}),
      };
      await overlays(browser, name, options);
      if (FIELDS === "all" || (FIELDS !== "none" && FIELD_FORMATS.includes(format)))
        await fields(browser, name, options);
    }
  }
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.kill();
}
process.exit(checks.every((c) => c.ok) ? 0 : 1);
