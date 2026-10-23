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
// sheet's head with the longest title there is (lot U2, longestTitle below). With --out, a
// capture of each format and mode.
//   node bench/smoke-formats.mjs [--browser chromium|webkit|firefox] [--region ci]
//                                [--port N] [--out DIR] [--only NAME] [--zoom 1.3]
// Playwright's viewports have no browser bars that come and go: the bottom is checked
// against visualViewport, which on a real phone follows them; the harness cannot show the
// bars themselves (a real Android's address bar, a real iPhone's toolbar).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { benchBrowser } from "./ui.mjs";

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
// Clearance between two controls, in CSS px: tilted toward each other, two buttons closer
// than this read as touching (the report's « nearly overlap »).
const MIN_GAP = 4;
// The floating buttons' foot above the visible bottom, at most: 18a's 34 px, plus a tilt.
const MAX_FOOT = 40;

// [name, width, height, device pixel ratio, touch]. Phones held upright and sideways.
const PHONES = [
  ["320x568", 320, 568, 2],
  ["360x640", 360, 640, 2],
  ["360x800", 360, 800, 3],
  ["375x667", 375, 667, 2],
  ["390x844", 390, 844, 3],
  ["412x915", 412, 915, 2.625],
];
const FORMATS = [
  ...PHONES.map(([n, w, h, d]) => [`phone-${n}`, w, h, d, true]),
  ...PHONES.map(([, w, h, d]) => [`phone-${h}x${w}`, h, w, d, true]),
  ["tablet-768x1024", 768, 1024, 2, true],
  ["tablet-1024x768", 1024, 768, 2, true],
  ["desktop-1280x720", 1280, 720, 1, false],
  ["desktop-1440x900", 1440, 900, 1, false],
  ["desktop-1920x1080", 1920, 1080, 1, false],
].filter(([name]) => !ONLY || name.includes(ONLY));

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

/** Every floating control shown, as a polygon in CSS px (run in the page); with `whole`, the
 * attribution's whole control (its credit unfolded) rather than its « ⓘ ». */
const SHAPES = (whole) => {
  const deg = (v) => {
    if (!v || v === "none") return 0;
    const n = Number.parseFloat(v);
    return v.endsWith("rad") ? (n * 180) / Math.PI : v.endsWith("turn") ? n * 360 : n;
  };
  const shape = (name, e) => {
    if (!e?.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return null;
    const box = e.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    // Its own size, its tilt and scale (the `rotate` and `scale` properties and a
    // `transform`, its ancestors' translations moving its centre only); rotation and scale
    // are about the centre (transform-origin's default), so the box's centre is its own.
    const cs = getComputedStyle(e);
    const m = new DOMMatrix(cs.transform === "none" ? undefined : cs.transform);
    const s = (cs.scale === "none" ? 1 : Number.parseFloat(cs.scale)) * Math.hypot(m.a, m.b);
    const angle = ((deg(cs.rotate) + (Math.atan2(m.b, m.a) * 180) / Math.PI) * Math.PI) / 180;
    const w = (e.offsetWidth * s) / 2;
    const h = (e.offsetHeight * s) / 2;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const round = Number.parseFloat(cs.borderTopLeftRadius) >= e.offsetWidth / 2 - 0.5;
    const local = round
      ? Array.from({ length: 32 }, (_, i) => [
          w * Math.cos((i * Math.PI) / 16),
          h * Math.sin((i * Math.PI) / 16),
        ])
      : [
          [-w, -h],
          [w, -h],
          [w, h],
          [-w, h],
        ];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      name,
      points: local.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]),
    };
  };
  const q = (s) => document.querySelector(s);
  const attribToggle = q("#attrib-toggle");
  const shapes = [
    shape("ticket", q("#ticket")),
    shape("Standard", q("#estimate button:nth-child(1)")),
    shape("Prudent", q("#estimate button:nth-child(2)")),
    shape("Ajouter", q("#fab-add")),
    shape("Me localiser", q("#fab-locate")),
    shape("zoom +", q(".maplibregl-ctrl-zoom-in")),
    shape("zoom −", q(".maplibregl-ctrl-zoom-out")),
    attribToggle?.checkVisibility() && !whole
      ? shape("ⓘ", attribToggle)
      : shape("attribution", q(".maplibregl-ctrl-attrib")),
  ].filter(Boolean);
  // What the ticket holds stays within its paper sideways (a narrower ticket must wrap, not
  // spill).
  const paper = q("#ticket .ticket-paper")?.getBoundingClientRect();
  const spill = paper
    ? [...document.querySelectorAll("#ticket .ticket-paper *")]
        .filter((e) => e.checkVisibility?.({ visibilityProperty: true }) !== false)
        .map((e) => [e, e.getBoundingClientRect()])
        .filter(([, r]) => r.width > 0 && (r.left < paper.left - 1 || r.right > paper.right + 1))
        .map(([e, r]) => `${e.tagName.toLowerCase()}.${e.className} ${r.left | 0}-${r.right | 0}`)
    : [];
  // The credit unfolded: nothing over it (nine points of its box).
  const credit = q(".maplibregl-ctrl-attrib").getBoundingClientRect();
  const covered = [0.1, 0.5, 0.9]
    .flatMap((fx) => [0.1, 0.5, 0.9].map((fy) => [fx, fy]))
    .map(([fx, fy]) => [credit.left + credit.width * fx, credit.top + credit.height * fy])
    .map(([x, y]) => document.elementFromPoint(x, y))
    .filter((e) => !e?.closest(".maplibregl-ctrl-attrib"))
    .map((e) => e?.closest("[id]")?.id ?? e?.tagName ?? "nothing");
  const vv = window.visualViewport;
  return {
    shapes,
    spill,
    covered: whole ? covered : [],
    vw: vv?.width ?? window.innerWidth,
    vh: vv?.height ?? window.innerHeight,
    phone: matchMedia("(max-width: 600px), (pointer: coarse) and (max-height: 500px)").matches,
    coarse: matchMedia("(pointer: coarse)").matches,
  };
};

// Convex polygons: overlap by separating axes, else their distance (vertex to edge).
const axes = (p) =>
  p.map(([x, y], i) => {
    const [nx, ny] = p[(i + 1) % p.length];
    return [y - ny, nx - x];
  });
const separated = (a, b) =>
  [...axes(a), ...axes(b)].some(([ax, ay]) => {
    const pa = a.map(([x, y]) => x * ax + y * ay);
    const pb = b.map(([x, y]) => x * ax + y * ay);
    return Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa);
  });
const toSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const toPolygon = (pt, p) => Math.min(...p.map((a, i) => toSegment(pt, a, p[(i + 1) % p.length])));
const gap = (a, b) =>
  separated(a, b)
    ? Math.min(...a.map((pt) => toPolygon(pt, b)), ...b.map((pt) => toPolygon(pt, a)))
    : 0;

/** What is wrong with the layout measured (an empty list: nothing). With the credit unfolded
 * (`foot` false: the floating buttons rise above it where it would meet them), it may lie
 * over the ticket's foot on a short screen, on top of it (map.css), never under anything. */
function problems(m, foot = true) {
  const out = [];
  const { shapes, vw, vh } = m;
  const over = (a, b) => !foot && [a, b].includes("ticket") && [a, b].includes("attribution");
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++) {
      if (over(shapes[i].name, shapes[j].name)) continue;
      const g = gap(shapes[i].points, shapes[j].points);
      if (g < MIN_GAP) out.push(`${shapes[i].name}/${shapes[j].name} ${g.toFixed(1)} px apart`);
    }
  for (const { name, points } of shapes) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const [l, r, t, b] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (l < -0.5 || t < -0.5 || r > vw + 0.5 || b > vh + 0.5)
      out.push(`${name} out of the screen (${l | 0},${t | 0})-(${r | 0},${b | 0})`);
  }
  const feet = shapes
    .filter((s) => s.name === "Ajouter" || s.name === "Me localiser")
    .map((s) => vh - Math.max(...s.points.map(([, y]) => y)));
  if (foot && feet.length && Math.min(...feet) > MAX_FOOT)
    out.push(`floating buttons ${Math.min(...feet).toFixed(0)} px above the bottom`);
  if (!shapes.some((s) => s.name === "Me localiser")) out.push("no « Me localiser »");
  if (m.spill.length) out.push(`out of the ticket: ${m.spill.join(", ")}`);
  if (m.covered.length) out.push(`the credit under ${[...new Set(m.covered)].join(", ")}`);
  return out;
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
const browser = benchBrowser(await { chromium, webkit, firefox }[engine].launch());
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
    await longestTitle(page, name);
    await context.close();
  }
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.kill();
}
process.exit(checks.every((c) => c.ok) ? 0 : 1);
