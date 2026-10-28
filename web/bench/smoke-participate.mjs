// Smoke test of participation (phases D1, D2, "Ajouter") on a phone profile ("iPhone 14"),
// WebKit by default, Chromium with --browser chromium: verify, move "Sur une façade"
// (magnet), move "Libre" into a building's footprint (an awning or arcade), "Compléter"
// (shape, direction slid under the target, who films, offline, a private individual's
// sheet), the send queue offline then resent (on reconnect and at startup), the review
// page, "Ajouter une caméra" (complete, position only, duplicates, offline, seen and
// confirmed from another account), and "Me localiser" (followed position, "on site" from
// it: true, unknown when imprecise, false when far; follow, drag, recentre, off), and
// withdrawing one's own pending contributions (sheet, opinion, add, queue, list).
// Real taps on every button (page.touchscreen.tap). Sliding the map under the pin:
//   - Chromium: a real finger drag through CDP (Input.dispatchTouchEvent);
//   - WebKit: Playwright's touchscreen has only tap(), so the map is slid with Playwright's
//     mouse (MapLibre pans on mouse and touch events, not on PointerEvents). The finger
//     drag on an iPhone is checked by hand on the device.
// Behind the real Caddy site file (deploy/preview.caddy rendered by deploy/site.py) when
// caddy is installed (CI), else behind a small Node proxy doing what the site file does:
// basic auth (the gate), X-Author and client-address headers dropped, /revue for everyone
// past the gate. Each account then signs in to the API itself (POST /api/session, the
// bench's accounts of tests/apiserver.py, web/bench/session.mjs; rev, an administrator, by
// /revue's privileged entry, POST /api/review/session, once through /revue's own form).
//   node bench/smoke-participate.mjs [--browser webkit|chromium] [--proxy auto|caddy|node]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { DIST, preview, requireTiles, WEB } from "./dist.mjs";
import { BENCH_PASSWORD, COOKIE, entryOf, reauthOf, sessionOf } from "./session.mjs";
import { benchBrowser } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
// The API loads data/build/ci (tests/apiserver.py): the map must show the same build.
requireTiles("ci", true);
const engine = arg("--browser", "webkit");
// DECISIONS 2026-10-08: « Modifier » replaces « Déplacer » and « Compléter » on the camera
// sheet; the moves and the answers go through it.
// The height in metres (the author's point 5 of 2026-10-12: « ~2 m », « ~4 m », « 6 m et
// + », no « Poteau »), in the editor and on the camera sheet.
const FIRST = "~4 m";
const EDIT_FIRST = "~4 m";
const hasCaddy = (() => {
  try {
    execFileSync("caddy", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const proxyMode =
  arg("--proxy", "auto") === "auto" ? (hasCaddy ? "caddy" : "node") : arg("--proxy");
const ROOT = resolve(import.meta.dirname, "../..");
// SMOKE_PORTS="app,static,api" moves them (two runs side by side on one machine).
const [APP_PORT, STATIC_PORT, API_PORT] = (process.env.SMOKE_PORTS ?? "4280,4281,8793") // not 4190: on the Fetch spec's blocked-port list
  .split(",")
  .map(Number);
const APP = `http://localhost:${APP_PORT}/`;
const PW = "pw-smoke";
const USERS = ["ana", "bob", "rev"];
const checks = [];
const children = [];
const tmp = mkdtempSync(join(tmpdir(), "smoke-part-"));

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(
    `${ok ? "ok  " : "FAIL"} [${engine}/${proxyMode}] ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

function run(cmd, argv, opts = {}) {
  const p = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  children.push(p);
  p.stderr.on("data", (d) => process.env.SMOKE_VERBOSE && process.stderr.write(d));
  return p;
}

const waitFor = async (what, test, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${what}`);
};

const basic = (user) => `Basic ${Buffer.from(`${user}:${PW}`).toString("base64")}`;
const ORIGIN = APP.slice(0, -1);
/** Past the gate as `user`, signed in to the API as the account of the same name. */
async function asUser(user, path, init = {}) {
  const token = await sessionOf(APP, ORIGIN, user, { Authorization: basic(user) });
  return fetch(new URL(path, APP), {
    ...init,
    headers: { Authorization: basic(user), cookie: `${COOKIE}=${token}`, ...(init.headers ?? {}) },
  });
}
/** A browser context past the gate as `user` signs in to the API as that account, as the
 * page's form does (POST /api/session, or /revue's POST /api/review/session for rev; the
 * cookie lands in the context). */
async function signedIn(context, user) {
  const r = await context.request.post(new URL(entryOf(user), APP).href, {
    headers: { origin: ORIGIN },
    data: { pseudonym: user, password: BENCH_PASSWORD },
  });
  if (r.status() !== 204) throw new Error(`sign-in as ${user}: ${r.status()}`);
  return context;
}
/** rev's password given again (POST /api/review/reauth, 10 minutes): the CSV is an
 * administrator's destructive route (lot 2). */
const reauthed = () => reauthOf(APP, ORIGIN, "rev", { Authorization: basic("rev") });
/** The whole review list: an administrator's, within the reauthentication, as the CSV. */
const reviewList = async (query = "") => {
  await reauthed();
  return (await asUser("rev", `/api/review/contributions${query}`)).json();
};
const review = async () => (await reviewList()).contributions;

// --- servers -----------------------------------------------------------------------------
async function startApi() {
  const fixtures = join(tmp, "fixtures.json");
  const api = run(
    "uv",
    [
      "run",
      "python",
      "tests/apiserver.py",
      "--region",
      "ci",
      "--port",
      String(API_PORT),
      "--origin",
      `http://localhost:${APP_PORT}`,
      "--review-user",
      "rev",
      "--fixtures",
      fixtures,
      "--reset",
    ],
    { cwd: ROOT },
  );
  let ready = false;
  api.stdout.on("data", (d) => {
    if (String(d).includes("api ready")) ready = true;
  });
  await waitFor("the API", () => ready && existsSync(fixtures), 180000);
  await waitFor("the API port", async () => {
    try {
      await fetch(`http://127.0.0.1:${API_PORT}/api/`);
      return true;
    } catch {
      return false;
    }
  });
  return JSON.parse(readFileSync(fixtures, "utf8"));
}

async function startCaddy() {
  const hash = execFileSync("caddy", ["hash-password", "--plaintext", PW]).toString().trim();
  const env = {
    ...process.env,
    PREVIEW_HOST: `http://localhost:${APP_PORT}`,
    PREVIEW_ROOT: DIST,
    PREVIEW_ACCOUNTS: USERS.map((u) => `${u} ${hash}`).join(";"),
    API_PORT: String(API_PORT),
  };
  const siteFile = execFileSync("uv", ["run", "python", "deploy/site.py", "render"], {
    cwd: ROOT,
    env,
  }).toString();
  writeFileSync(join(tmp, "preview.caddy"), siteFile);
  writeFileSync(
    join(tmp, "Caddyfile"),
    "{\n\tadmin off\n\tauto_https off\n}\n\nimport preview.caddy\n",
  );
  run("caddy", ["run", "--adapter", "caddyfile", "--config", join(tmp, "Caddyfile")]);
}

/** What the site file does, for a machine without caddy. */
async function startNodeProxy() {
  run("npx", preview(STATIC_PORT, "127.0.0.1"), { cwd: WEB });
  await waitFor("vite preview", async () => {
    try {
      await fetch(`http://127.0.0.1:${STATIC_PORT}/`);
      return true;
    } catch {
      return false;
    }
  });
  http
    .createServer((req, res) => {
      const auth = req.headers.authorization ?? "";
      const [user, pw] = Buffer.from(auth.replace(/^Basic /, ""), "base64")
        .toString()
        .split(":");
      if (!auth.startsWith("Basic ") || !USERS.includes(user) || pw !== PW) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="restricted"' });
        res.end();
        return;
      }
      const url = new URL(req.url, "http://x");
      const headers = { ...req.headers };
      for (const h of ["x-forwarded-for", "x-real-ip", "forwarded", "x-author"]) delete headers[h];
      let port = STATIC_PORT;
      let path = req.url;
      if (url.pathname.startsWith("/api/")) port = API_PORT;
      else if (url.pathname === "/revue" || url.pathname === "/revue.html") path = "/revue.html";
      const up = http.request(
        { host: "127.0.0.1", port, path, method: req.method, headers },
        (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(up);
    })
    .listen(APP_PORT);
}

// --- gestures ----------------------------------------------------------------------------
async function tap(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  // Where it rests (Playwright's « stable »: the same box twice): a sheet still sliding in
  // would send the finger elsewhere, to the map under it, which then selects a camera.
  let b = await locator.boundingBox();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    const now = await locator.boundingBox();
    const same = now && b && ["x", "y", "width", "height"].every((k) => now[k] === b[k]);
    b = now;
    if (same) break;
  }
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

/** Slide a finger from `from` to `to`; `hold` runs with the finger still down, before
 * it lifts (the pin must already follow). */
async function slide(page, context, from, to, hold = async () => {}) {
  const steps = 12;
  const point = (i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  });
  if (engine === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(0)] });
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(25);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(i)] });
    }
    await page.waitForTimeout(60);
    await hold();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return;
  }
  // WebKit: no finger drag in Playwright (see the header), and no Touch constructor in its
  // desktop build. Events named touchstart / touchmove / touchend carrying the touch lists
  // MapLibre's touch pan handler reads, dispatched on the map canvas.
  const send = (type, pts) =>
    page.evaluate(
      async ([kind, list]) => {
        const canvas = window.__map.getCanvas();
        for (const p of list) {
          const touch = {
            identifier: 1,
            target: canvas,
            clientX: p.x,
            clientY: p.y,
            pageX: p.x,
            pageY: p.y,
          };
          const touches = kind === "touchend" ? [] : [touch];
          const ev = new Event(kind, { bubbles: true, cancelable: true });
          for (const [k, v] of Object.entries({
            touches,
            targetTouches: touches,
            changedTouches: [touch],
          }))
            Object.defineProperty(ev, k, { value: v });
          canvas.dispatchEvent(ev);
          await new Promise((r) => setTimeout(r, 25));
        }
      },
      [type, pts],
    );
  await send("touchstart", [point(0)]);
  await send(
    "touchmove",
    Array.from({ length: steps }, (_, i) => point(i + 1)),
  );
  await page.waitForTimeout(60);
  await hold();
  await send("touchend", [point(steps)]);
}

const button = (page, text) => page.locator("button", { hasText: text }).first();

let opened = 0;
async function openCamera(page, fx) {
  lastPage = page;
  const [lon, lat] = fx.at;
  // Leave only a settled map: WebKit reports the tile fetches a navigation cuts off as page
  // errors, and a full circle (direction not surveyed) loads many tiles around the camera.
  if (await page.evaluate(() => Boolean(window.__map)).catch(() => false)) await idle(page);
  // A new query each time: a URL differing only by its hash is not reloaded (Chromium).
  await page.goto(`${APP}?cam=${fx.camera}&open=${++opened}#18.00/${lat}/${lon}`);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".participate button")].some(
        (b) => b.textContent === "Toujours là ?",
      ),
    null,
    { timeout: 60000 },
  );
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
}

// --- punk: the one editor, adding and « Modifier » (DECISIONS 2026-10-08) -------------
const ed = {
  view: (pg, v) => pg.waitForSelector(`#modify-panel[data-view="${v}"]`, { timeout: 20000 }),
  /** The position ticket's words once its commune is read from the tiles (place.ts: once
   * the map is idle, the communes' tile loaded at the sheet's zoom). */
  place: async (pg) => {
    await pg
      .waitForFunction(
        () =>
          document
            .querySelector("#modify-position .modify-position-sub")
            ?.textContent?.includes(" · "),
        null,
        { timeout: 10000 },
      )
      .catch(() => {});
    return pg.locator("#modify-position").evaluate((b) => ({
      title: b.querySelector(".modify-position-title")?.textContent,
      sub: b.querySelector(".modify-position-sub")?.textContent,
      name: b.getAttribute("aria-label"),
    }));
  },
  row: (pg, f) => pg.locator(`#modify-panel .modify-line[data-field="${f}"]`),
  /** A row's value as written (textContent: the capitals are CSS). */
  value: (pg, f) =>
    pg.locator(`#modify-panel [data-field="${f}"] .modify-value`).evaluate((e) => e.textContent),
  tile: (pg, a) => pg.locator(`#modify-panel .modify-tile[data-answer="${a}"]`),
  part: (pg, part, a) =>
    pg.locator(`#modify-panel .modify-chip[data-part="${part}"][data-answer="${a}"]`),
  /** The field the send gives, drawn (its preview's features). */
  field: (pg) => pg.evaluate(() => window.__map.querySourceFeatures("edit-field").length),
  fieldDrawn: (pg, ms = 20000) =>
    pg
      .waitForFunction(() => window.__map.querySourceFeatures("edit-field").length > 0, null, {
        timeout: ms,
      })
      .then(() => true)
      .catch(() => false),
  /** The pin: where its tip says it is, how far that is from the map's centre, and how
   * far it is drawn from there (the element's origin is the tip). */
  pin: (pg) =>
    pg.evaluate(() => {
      const pin = document.getElementById("edit-pin");
      const m = window.__map;
      const box = m.getContainer().getBoundingClientRect();
      const c = m.project(m.getCenter());
      const at = [Number(pin.dataset.lng), Number(pin.dataset.lat)];
      const q = m.project(at);
      const r = pin.getBoundingClientRect();
      return {
        at,
        drawnOff: Math.hypot(r.left - (box.left + q.x), r.top - (box.top + q.y)),
        fromCentrePx: Math.hypot(q.x - c.x, q.y - c.y),
      };
    }),
  /** The direction's view on a phone (DECISIONS 2026-10-09): the crosshair fixed at the
   * map's centre, a finger slides the map until the point `east`, `north` metres from the
   * camera is under it; returns the bearing « Valider » would send (null: it waits). */
  aim: async (pg, east = 11, north = 11) => {
    const at = await pg.evaluate(
      ([e, n]) => {
        const pin = document.getElementById("edit-pin");
        const [lon, lat] = [Number(pin.dataset.lng), Number(pin.dataset.lat)];
        const k = Math.cos((lat * Math.PI) / 180);
        return [lon + e / (111320 * k), lat + n / 111320];
      },
      [east, north],
    );
    await bringToCentre(pg, pg.context(), at);
    await pg
      .waitForFunction(() => !document.getElementById("aim-submit")?.disabled, null, {
        timeout: 10000,
      })
      .catch(() => {});
    const b = await pg.locator("#modify-panel").getAttribute("data-bearing");
    return b ? Number(b) : null;
  },
  /** A line of « Modifier » folded (a button): a tap unfolds its choices. */
  unfold: async (pg, f) => {
    const line = ed.row(pg, f);
    if (await line.evaluate((e) => e.tagName === "BUTTON")) await tap(pg, line);
    await pg.waitForSelector(
      `#modify-panel [data-row="${f}"] :is(.modify-choices, .modify-tiles)`,
      { timeout: 10000 },
    );
  },
  /** The lines whose choices show. */
  unfolded: (pg) =>
    pg
      .locator("#modify-panel .modify-row:has(.modify-choices, .modify-tiles)")
      .evaluateAll((rs) => rs.map((r) => r.dataset.row)),
  /** « Viser sur la carte › »: the direction's map. */
  aimOpen: async (pg) => {
    await ed.unfold(pg, "direction");
    await tap(pg, pg.locator("#modify-aim-open"));
    await ed.view(pg, "aim");
  },
  /** « Envoyer »: the sheet slides away, 8a's tickets fall on the map (score.ts). */
  send: async (pg) => {
    await tap(pg, pg.locator("#modify-send"));
    // The sheet is hidden once it has slid away (400 ms): attached, not visible.
    await pg.waitForSelector('#modify-panel[data-view="sent"]', { state: "attached" });
    await pg.waitForSelector("#score #modify-done", { state: "attached" });
  },
  /** The tickets put away (Escape; a touch or a move of the map does the same): the
   * editor closes. */
  finish: async (pg) => {
    await pg.keyboard.press("Escape");
    await pg.waitForFunction(() => !document.getElementById("modify-panel"));
  },
};

/** « Modifier »'s position view on the fixture camera (always free placement). */
async function startMove(page, fx) {
  await openCamera(page, fx);
  await tap(page, page.locator("#part-modify"));
  await ed.view(page, "sheet");
  await tap(page, page.locator("#modify-position"));
  await ed.view(page, "position");
}

/** « Valider » the position; punk: « Ici », back on « Modifier », its one change sent,
 * « Terminer ». */
async function submitMove(page) {
  await tap(page, page.locator("#modify-here"));
  await ed.view(page, "sheet");
  await ed.send(page);
  await ed.finish(page);
}

const TOLERANCE_PX = 10; // the map's clickTolerance (main.ts)
/** Screen points of `target` and of the map's centre (where the pin's tip rests). */
const targetAndCentre = (page, target) =>
  page.evaluate((t) => {
    const m = window.__map;
    const box = m.getContainer().getBoundingClientRect();
    const p = m.project(t);
    const c = m.project(m.getCenter());
    return [
      { x: box.left + p.x, y: box.top + p.y },
      { x: box.left + c.x, y: box.top + c.y },
    ];
  }, target);

/** Slide the map so that `target` comes to the centre. A pan starts only past the map's
 * click tolerance (10 px): each slide travels the distance plus that tolerance, and is
 * repeated until the target is within 3 px. `hold` runs on each slide, finger down: the
 * last one is the state with the target at the centre. After five slides, a target still
 * farther than the tolerance stops the run here, with the distance after each, instead of
 * a check further on failing on a map that never got there; closer, the run goes on
 * (Chromium: five slides for the last 6.2 px moved nothing, as they did before this check). */
async function bringToCentre(page, context, target, hold) {
  const trail = [];
  for (let i = 0; ; i++) {
    await idle(page);
    const [from, to] = await targetAndCentre(page, target);
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    trail.push(d.toFixed(1));
    if (d < 3) break;
    if (i === 5) {
      // Under twice the tolerance the run goes on, as before this check (CI run
      // 38010355680, WebKit: two slides for the last 11.2 px moved nothing); farther, the
      // map stopped short (the « free » failures: tens of px).
      if (d < 2 * TOLERANCE_PX) break;
      throw new Error(`the map never brought the target to the centre: ${trail} px`);
    }
    const k = (d + TOLERANCE_PX) / d;
    const start = { x: to.x - (to.x - from.x) * k, y: to.y - (to.y - from.y) * k };
    await slide(page, context, start, to, hold);
  }
  await page.waitForTimeout(700); // debounce + preview
}

const metres = (a, b) => {
  const rad = Math.PI / 180;
  const dx = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad) * 6371008.8;
  const dy = (b[1] - a[1]) * rad * 6371008.8;
  return Math.hypot(dx, dy);
};

/** The author's own ghost (pale pictogram) drawn without anyone moving the map, polled
 * for 5 s: of `camera`, or (an add still in the queue, no id known here) an add within
 * 5 m of `near`. Also how many times the map moved meanwhile. */
async function ghostShown(pg, { camera = null, near = null, absent = false }) {
  await pg.evaluate(() => {
    window.__moved = 0;
    window.__map.on("moveend", () => {
      window.__moved += 1;
    });
  });
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < 5000) {
    n = await pg.evaluate(
      ([c, at]) =>
        window.__map.queryRenderedFeatures({ layers: ["proposal-ghost"] }).filter((f) => {
          if (c) return f.properties.c === c;
          const [x, y] = f.geometry.coordinates;
          const k = Math.cos((at[1] * Math.PI) / 180);
          return f.properties.a === 1 && Math.hypot((x - at[0]) * k, y - at[1]) * 111320 < 5;
        }).length,
      [camera, near],
    );
    if (absent ? n === 0 : n > 0) break;
    await pg.waitForTimeout(250);
  }
  return { shown: n > 0, moved: await pg.evaluate(() => window.__moved) };
}

/** The review window's small map at rest (its basemap tiles drawn), before a capture. */
async function reviewMapIdle(pg) {
  await pg.evaluate(
    () =>
      new Promise((r) => {
        const m = window.__reviewMap;
        if (!m) return r();
        m.once("idle", r);
        m.triggerRepaint();
        setTimeout(r, 6000);
      }),
  );
}

const newMove = async (before) =>
  (await review()).find((c) => c.kind === "move" && !before.has(c.uuid));

// --- what a failure leaves --------------------------------------------------------------
// A run that times out says where (its stack) but not why. Each page keeps the last clicks
// (where a tap landed) and the map's camera calls (a padding or a jump under a finger
// stops the drag); the API requests still unanswered are counted here. On a failure they
// go into failure.txt beside failure.png, and into the log.
const RECORD = () => {
  const log = [];
  window.__smokeLog = log;
  const note = (s) => {
    log.push(`${new Date().toISOString().slice(11, 23)} ${s}`);
    if (log.length > 40) log.shift();
  };
  const name = (e) =>
    e?.tagName
      ? `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/).join(".")}` : ""}${e.disabled ? "[disabled]" : ""}`
      : String(e);
  document.addEventListener("click", (e) => note(`click ${name(e.target)}`), true);
  const hook = () => {
    const m = window.__map;
    if (!m) return void setTimeout(hook, 200);
    for (const k of ["jumpTo", "setPadding", "easeTo", "flyTo", "stop"]) {
      const f = m[k].bind(m);
      m[k] = (...a) => {
        note(`map.${k}${m.dragPan.isActive() ? " under a finger" : ""}`);
        return f(...a);
      };
    }
  };
  hook();
};
const unanswered = new Map(); // API request -> when it left
/** Watch what a failure would need to explain itself, in `context`. */
async function recorded(context) {
  await context.addInitScript(RECORD);
  const api = (r) => new URL(r.url()).pathname.startsWith("/api/");
  context.on("request", (r) => api(r) && unanswered.set(r, Date.now()));
  context.on("requestfinished", (r) => unanswered.delete(r));
  context.on("requestfailed", (r) => unanswered.delete(r));
  return context;
}
async function failureReport(page) {
  const state = await page
    ?.evaluate(() => ({
      url: location.href.replace(location.origin, ""),
      online: navigator.onLine,
      panels: [...document.querySelectorAll("#modify-panel, #complete-panel, #move-panel")].map(
        (p) => {
          const bs = [...p.querySelectorAll("button")];
          return `${p.id} view=${p.dataset.view ?? "-"} step=${p.dataset.step ?? "-"} buttons disabled ${bs.filter((b) => b.disabled).length}/${bs.length}`;
        },
      ),
      queue: document.getElementById("queue-count")?.textContent ?? null,
      log: window.__smokeLog ?? [],
    }))
    .catch((e) => ({ error: String(e) }));
  const now = Date.now();
  const pending = [...unanswered].map(
    ([r, t]) => `${r.method()} ${new URL(r.url()).pathname} for ${((now - t) / 1000).toFixed(1)} s`,
  );
  return [
    JSON.stringify({ ...state, log: undefined }),
    ...(state?.log ?? []).map((l) => `  ${l}`),
    `API requests unanswered: ${pending.length ? pending.join(", ") : "none"}`,
  ].join("\n");
}

// --- the run -----------------------------------------------------------------------------
const pageErrors = [];
let offline = false; // requests fail by design while offline
let browser;
let lastPage = null; // screenshot on failure
/** The console errors being read (their argument's message), awaited before the check. */
const consoleRead = [];
try {
  const fx = await startApi();
  if (proxyMode === "caddy") await startCaddy();
  else await startNodeProxy();
  await waitFor("the proxy", async () => {
    try {
      return (await fetch(APP)).status === 401;
    } catch {
      return false;
    }
  });

  // Nothing without the password, the API included.
  const anon = await Promise.all(
    ["/", "/api/me/contributions", "/revue"].map(
      async (p) => (await fetch(new URL(p, APP))).status,
    ),
  );
  check(
    "anonymous: 401 everywhere",
    anon.every((s) => s === 401),
    anon.join(","),
  );

  browser = benchBrowser(await (engine === "chromium" ? chromium : webkit).launch(), true);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await recorded(await newContext(options));
    const user = options?.httpCredentials?.username;
    return user ? signedIn(context, user) : context;
  };
  const phone = (user) =>
    browser.newContext({
      ...devices["iPhone 14"],
      httpCredentials: { username: user, password: PW },
    });
  const context = await phone("ana");
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  // Offline fetches fail by design (the queue keeps what did not leave): the engines' fetch
  // failures are not errors of the page. An Error object logged (MapLibre's error event,
  // a tile that failed while offline and was told after the network came back) reads
  // « Error » here, its message in the argument (Chromium: « Failed to fetch »).
  const NETWORK =
    /Failed to load resource|ERR_INTERNET_DISCONNECTED|NetworkError|Load failed|Failed to fetch/;
  page.on("console", (m) => {
    if (m.type() !== "error" || offline) return;
    const where = `${m.location().url}:${m.location().lineNumber}`;
    consoleRead.push(
      (async () => {
        const said = await m
          .args()[0]
          ?.evaluate((e) => (e instanceof Error ? `${e.name}: ${e.message}` : null))
          .catch(() => null);
        const text = said ?? m.text();
        if (!NETWORK.test(text) && !NETWORK.test(m.text())) pageErrors.push(`${text} @ ${where}`);
      })(),
    );
  });

  const failedRequests = [];
  page.on("requestfailed", (r) =>
    failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`),
  );
  page.on("response", (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${r.url()}`));

  // 1. Verify: "Toujours là ?" then "Elle est là".
  await openCamera(page, fx);
  await tap(page, button(page, "Toujours là ?"));
  await tap(page, button(page, "Elle est là"));
  await page.waitForSelector(".part-done");
  const done = await page.locator(".part-done").innerText();
  // Punk: from afar it earns nothing, so no 8a scene: the sheet says it is sent.
  check("verify: thanked", done === "Envoyé · en attente de revue", done);
  await waitFor("the verify stored", async () =>
    (await review()).some((c) => c.author === "ana" && c.answer === "present"),
  );
  check("verify: stored with author ana", true);

  // 2. "Sur une façade": the map centre 2 m off a facade; the pin is pulled to 0.5 m by
  // the phone while the finger is still down, and the server agrees within 5 cm.
  let before = new Set((await review()).map((c) => c.uuid));
  {
    // 2'. Punk (DECISIONS 2026-10-08, « Placing a camera is always free… »): « Modifier »'s
    // position view, a small map, no façade / libre choice, no magnet, no « Me localiser »;
    // the pin's tip at the centre while the finger is down, the field drawn once it stops.
    await startMove(page, fx);
    const choices = await page.locator(".part-choice, #move-panel").count();
    const locate = await page.locator("#fab-locate").isVisible();
    const [far] = await targetAndCentre(page, fx.target);
    await slide(page, context, far, { x: far.x - 80, y: far.y - 60 });
    let live = null;
    await bringToCentre(page, context, fx.target, async () => {
      live = await ed.pin(page);
    });
    // No field: the camera's direction is not surveyed (unknown direction, no trace: the
    // author's point 3 of 2026-10-12); none appears while the pin rests.
    const drawn = await ed.fieldDrawn(page, 3000);
    const rest = await ed.pin(page);
    if (process.env.SMOKE_SHOTS)
      await page.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-position.png`) });
    check(
      "position: always free — no façade / libre, no « Me localiser »; the pin follows the map, no field (direction not surveyed)",
      choices === 0 &&
        !locate &&
        live !== null &&
        live.fromCentrePx < 1.5 &&
        live.drawnOff < 1.5 &&
        !drawn &&
        rest.fromCentrePx < 1.5,
      JSON.stringify({ choices, locate, live, rest, drawn }),
    );
    await submitMove(page);
    await page.waitForFunction(() => !document.body.classList.contains("moving"));
    const ghostMove = await ghostShown(page, { camera: fx.camera });
    check(
      "proposal: the author's ghost shows right after the move, the map untouched",
      ghostMove.shown,
      JSON.stringify(ghostMove),
    );
    await idle(page);
    const fields = await page.evaluate(
      () => window.__map.queryRenderedFeatures({ layers: ["bands"] }).length,
    );
    check("move: the map's fields come back after « Modifier »", fields > 0, `${fields} bands`);
    await waitFor("the move stored", async () => Boolean(await newMove(before)));
    const moved = await newMove(before);
    check(
      "move: stored free, never pulled, in a send's batch, with its field",
      moved.payload.placement === "free" &&
        moved.payload.pulled === false &&
        Boolean(moved.batch) &&
        moved.payload.bands.features.length > 0,
      JSON.stringify({ placement: moved.payload.placement, pulled: moved.payload.pulled }),
    );
  }

  // 2b. The proposal on the map and in the sheet, for every account.
  const proposalOnMap = (pg, layer) =>
    pg.evaluate(
      ([l, c]) =>
        window.__map.queryRenderedFeatures({ layers: [l] }).filter((f) => f.properties.c === c)
          .length,
      [layer, fx.camera],
    );
  // Punk (lot 3.1): 20a's yellow tape replaces the blue badge; below the stickers' zoom
  // nothing replaces the blue dot (layers.ts proposalTapeLayers).
  await openCamera(page, fx);
  await idle(page);
  const onMap = {
    badge: await proposalOnMap(page, "proposal-tape"),
    ghost: await proposalOnMap(page, "proposal-ghost"),
    link: await proposalOnMap(page, "proposal-link"),
    field: await page.evaluate(() => window.__map.querySourceFeatures("proposal-field").length),
  };
  check(
    "proposal: badge, pale pictogram and dotted link at z15+, the field with the camera selected",
    onMap.badge > 0 && onMap.ghost > 0 && onMap.link > 0 && onMap.field > 0,
    JSON.stringify(onMap),
  );
  if (process.env.SMOKE_SHOTS)
    await page.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-proposal-author.png`) });
  const ownBlock = await page.locator(".part-proposal").innerText();
  const ownButtons = await page.locator(".part-proposal button[data-opinion]").count();
  const ownWithdraw = await page.locator(".part-proposal .part-withdraw").count();
  check(
    "proposal: its author reads it, without confirm buttons, with « Retirer ma proposition »",
    ownBlock.includes("Proposition en attente") &&
      ownButtons === 0 &&
      ownWithdraw === 1 &&
      ownBlock.includes("votre"),
    ownBlock.replace(/\n/g, " / "),
  );
  {
    // The punk sheet is built in the order it is seen (WCAG 1.3.2, 2.4.3): the keyboard
    // meets its controls top to bottom, left to right — the proposal under the tickets,
    // the buttons after the facts (« Modifier », « Toujours là ? »), then « Partager »,
    // « OpenStreetMap », « Calcul ? », « Vos contributions »; no « Déplacer » any more.
    await page.locator("#sheet .sheet-grab").evaluate((b) => b.scrollIntoView());
    const probe = await page.evaluate(() => {
      const sel = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])";
      const els = [...document.querySelectorAll(`#sheet :is(${sel})`)].filter(
        (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden",
      );
      return els.map((e, i) => {
        e.dataset.tabProbe = String(i);
        const r = e.getBoundingClientRect();
        const name = (e.textContent || e.getAttribute("aria-label") || "").trim();
        return { name: name.replace(/\s+/g, " ").slice(0, 24), top: r.top, bottom: r.bottom, left: r.left };
      });
    }); // biome-ignore format: compact
    // Seen after: below the previous one, or on its line and to its right.
    const misplaced = probe.slice(1).filter((b, i) => {
      const a = probe[i];
      const below = b.top >= a.bottom - 4;
      const sameLine = b.top < a.bottom && a.top < b.bottom;
      return !(below || (sameLine && b.left > a.left));
    });
    await page.locator("[data-tab-probe='0']").focus();
    const met = ["0"];
    for (let i = 1; i < probe.length; i++) {
      await page.keyboard.press(engine === "webkit" ? "Alt+Tab" : "Tab");
      met.push(await page.evaluate(() => document.activeElement?.dataset.tabProbe ?? "out"));
    }
    const names = probe.map((p) => p.name);
    check(
      "proposal: the punk sheet's tab order is its visual order (proposal, buttons, links)",
      misplaced.length === 0 &&
        met.every((m, i) => m === String(i)) &&
        names.indexOf("Retirer ma proposition") < names.indexOf("Modifier") &&
        names.indexOf("Modifier") < names.indexOf("Toujours là ?") &&
        names.indexOf("Toujours là ?") < names.indexOf("Partager") &&
        !names.includes("Déplacer") &&
        names.at(-1) === "Vos contributions",
      JSON.stringify({ names, met, misplaced: misplaced.map((m) => m.name) }),
    );
  }
  await tap(page, page.locator("#sheet .close"));
  await idle(page);
  const fieldClosed = await page.evaluate(
    () => window.__map.querySourceFeatures("proposal-field").length,
  );
  check(
    "proposal: no proposed field without a selected camera",
    fieldClosed === 0,
    String(fieldClosed),
  );
  await page.evaluate(() => window.__map.jumpTo({ zoom: 13.6 }));
  await idle(page);
  {
    // Punk: no proposal mark before the stickers' zoom (DECISIONS 2026-10-09, « Pending
    // proposals… »): nothing drawn by any proposal layer at z13-14.
    const below = await page.evaluate(() => {
      const m = window.__map;
      const ids = m
        .getStyle()
        .layers.map((l) => l.id)
        .filter(
          (id) => id.startsWith("proposal") && m.getLayoutProperty(id, "visibility") !== "none",
        );
      return {
        ids: ids.length,
        drawn: ids.length ? m.queryRenderedFeatures({ layers: ids }).length : 0,
      };
    });
    check(
      "proposal: no mark at z13-14, before the stickers",
      below.ids > 0 && below.drawn === 0,
      JSON.stringify(below),
    );
  }

  // bob confirms from the sheet, in one tap; rev validates from the sheet, in two.
  const bobContext = await phone("bob");
  const bobPage = await bobContext.newPage();
  await openCamera(bobPage, fx);
  await bobPage.waitForSelector('.part-proposal button[data-opinion="agree"]', { timeout: 20000 });
  const bobLine = await bobPage.locator(".proposal-line").innerText();
  if (process.env.SMOKE_SHOTS)
    await bobPage.screenshot({
      path: join(process.env.SMOKE_SHOTS, `${engine}-proposal-other.png`),
    });
  await tap(bobPage, bobPage.locator('.part-proposal button[data-opinion="agree"]'));
  await bobPage.waitForFunction(() =>
    document.querySelector(".part-proposal")?.textContent.includes("Vous avez répondu"),
  );
  const moveUuid = (await review()).find((c) => c.kind === "move")?.uuid;
  await waitFor("bob's agreement counted", async () =>
    (await review()).some((c) => c.uuid === moveUuid && c.agree === 1),
  );
  check(
    "proposal: another account confirms from the sheet, in one tap",
    bobLine.includes("déplacée de"),
    bobLine,
  );
  // Dated by the month in both interfaces: the public API gives no day (DECISIONS
  // 2026-10-13, refining 2026-09-30).
  check("proposal: its line dated by the month", / en \p{L}+ \d{4}$/u.test(bobLine), bobLine);
  await bobContext.close();
  const revContextPhone = await phone("rev");
  const revPage = await revContextPhone.newPage();
  await openCamera(revPage, fx);
  await revPage.waitForSelector(".part-proposal .decide-validated", { timeout: 20000 });
  const confirmedBy = await revPage.locator(".part-proposal").innerText();
  await tap(revPage, revPage.locator(".part-proposal .decide-validated"));
  await tap(revPage, revPage.locator(".part-proposal .decide-validated.armed"));
  await waitFor("the validation from the sheet", async () =>
    (await review()).some((c) => c.uuid === moveUuid && c.status === "validated"),
  );
  check(
    "proposal: the review account validates from the sheet, in two taps",
    confirmedBy.includes("confirmée par 1 contributeur"),
    confirmedBy.replace(/\n/g, " / "),
  );
  await revContextPhone.close();

  // Lot U: the camera's public history on its sheet — the move rev just validated, by the
  // month, « par un contributeur » (ana's pending « Elle est là » not in it); ana chooses to
  // show her pseudonym (her account's switch) and the next opening of the sheet says it,
  // then takes it back.
  // Lot U2: each entry two lines at most — « Position corrigée · <mois année> », then who on
  // one line —, no tag nor dotted leader.
  const historyText = async (pg) => {
    await pg.waitForSelector(".sheet-history-slot[data-history]", {
      state: "attached",
      timeout: 20000,
    });
    return (await pg.locator(".sheet-history-slot").textContent()) ?? "";
  };
  const historyEntries = (pg) =>
    pg.evaluate(() =>
      [...document.querySelectorAll(".sheet-history .history-entry")].map((li) => {
        const lines = (e) =>
          e ? Math.round(e.offsetHeight / Number.parseFloat(getComputedStyle(e).lineHeight)) : 0;
        const what = li.querySelector(".history-what");
        const who = li.querySelector(".history-who");
        return {
          what: what?.textContent,
          who: who?.textContent,
          lines: lines(what) + lines(who),
          children: [...li.children].map((c) => c.className).join(),
        };
      }),
    );
  const bobHistory = await phone("bob");
  const bobView = await bobHistory.newPage();
  await openCamera(bobView, fx);
  const month = new Date().toLocaleDateString("fr", { month: "long", year: "numeric" });
  const anonymous = await historyText(bobView);
  check(
    "history: the validated move by the month, « par un contributeur », not the pending check",
    anonymous.includes("Position corrigée") &&
      anonymous.includes(month) &&
      anonymous.includes("par un contributeur") &&
      !anonymous.includes("ana") &&
      !anonymous.includes("Vérifiée") &&
      !/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/.test(anonymous),
    anonymous,
  );
  const entries = await historyEntries(bobView);
  check(
    "history: each entry two lines at most, « Position corrigée · <mois année> » then « par un contributeur », no tag",
    entries.length > 0 &&
      entries.some(
        (e) => e.what === `Position corrigée · ${month}` && e.who === "par un contributeur",
      ) &&
      entries.every((e) => e.lines <= 2 && e.children === "history-what,history-who") &&
      !/contribution ·|\d{2}\/\d{2}/.test(anonymous),
    JSON.stringify(entries),
  );
  /** ana's choice, from her account's screen. */
  const chooseSigned = async (on) => {
    await page.goto(`${APP}?open=${++opened}#16/${fx.at[1]}/${fx.at[0]}`);
    await tap(page, page.locator("#account-square"));
    const sw = page.locator("#sheet .board-signed");
    await sw.waitFor({ timeout: 20000 });
    const help = await page.locator("#board-signed-help").textContent();
    if ((await sw.getAttribute("aria-checked")) !== String(!on)) return false;
    await tap(page, sw);
    await page.waitForFunction(
      (want) =>
        document.querySelector("#sheet .board-signed")?.getAttribute("aria-checked") === want,
      String(on),
      { timeout: 10000 },
    );
    return /suivre où vous passez/.test(help ?? "");
  };
  const turnedOn = await chooseSigned(true);
  await openCamera(bobView, fx);
  const signed = await historyText(bobView);
  check(
    "history: ana shows her pseudonym (off by default, what it reveals said), at once",
    turnedOn && signed.includes("par ana") && !signed.includes("par un contributeur"),
    `${turnedOn} ${signed}`,
  );
  const turnedOff = await chooseSigned(false);
  await openCamera(bobView, fx);
  const again = await historyText(bobView);
  check(
    "history: ana takes her pseudonym back, at once",
    turnedOff && again.includes("par un contributeur") && !again.includes("par ana"),
    `${turnedOff} ${again}`,
  );
  await bobHistory.close();
  {
    // Lot U: « Mes caméras » on the real API — ana's camera, its move « acceptée » and her
    // « Elle est là » « en attente »; a tap closes the screen and opens its sheet.
    await page.goto(`${APP}?open=${++opened}#16/${fx.at[1]}/${fx.at[0]}`);
    await tap(page, page.locator("#account-square"));
    const toggle = page.locator("#sheet .board-cameras-toggle");
    await toggle.waitFor({ timeout: 20000 });
    await tap(page, toggle);
    const row = page.locator(`#sheet [data-camera="${fx.camera}"]`);
    await row.waitFor({ timeout: 20000 });
    const item = (await row.textContent()) ?? "";
    const numbers =
      (await page.locator("#sheet .board-cameras .profile-numbers").textContent()) ?? "";
    await tap(page, row.locator("button.profile-cam"));
    await page.waitForSelector("#sheet .sheet-paper:not(.profile-paper) .sheet-return", {
      timeout: 20000,
    });
    const verifyShown = await page
      .locator(".participate button", { hasText: "Toujours là ?" })
      .count();
    check(
      "« Mes caméras »: ana's camera, its move « acceptée », her check « en attente »; a tap opens its sheet",
      /Position corrigée/.test(item) &&
        /acceptée/.test(item) &&
        /en attente/.test(item) &&
        /\d+ caméras?/.test(numbers) &&
        verifyShown > 0,
      `${numbers} | ${item} | ${verifyShown}`,
    );
  }

  // 3. "Libre" into a building's footprint (an awning, an arcade): no magnet, the real
  // position kept, found inside by the server.
  before = new Set((await review()).map((c) => c.uuid));
  {
    // Punk: placed inside the footprint (under a roof), kept there; no field, its direction
    // not surveyed (the server draws one there: tests/test_api_modify.py).
    await startMove(page, fx);
    await bringToCentre(page, context, fx.inside);
    const drawn = await ed.fieldDrawn(page, 3000);
    const free = await ed.pin(page);
    if (process.env.SMOKE_SHOTS)
      await page.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-free.png`) });
    check(
      "free: in a footprint, the pin's tip stays where the map is, no field (direction not surveyed)",
      free.fromCentrePx < 1.5 && free.drawnOff < 1.5 && !drawn,
      JSON.stringify({ free, drawn }),
    );
    await submitMove(page);
    await waitFor("the free move stored", async () => Boolean(await newMove(before)));
    const inside = await newMove(before);
    check(
      "free: stored free, not pulled, inside a footprint, with a field",
      inside.payload.placement === "free" &&
        inside.payload.pulled === false &&
        inside.payload.inside_footprint === true &&
        inside.payload.bands.features.length > 0,
      JSON.stringify({ inside: inside.payload.inside_footprint }),
    );
  }

  // 4. Offline: queued on the phone, counter shown, sent when the network comes back.
  await openCamera(page, fx);
  offline = true;
  await context.setOffline(true);
  await tap(page, button(page, "Toujours là ?"));
  await tap(page, button(page, "Je ne sais pas"));
  await page.waitForSelector(".part-done");
  const queuedText = await page.locator(".part-done").innerText();
  const counter = await page.locator("#queue-count").innerText();
  check(
    "offline: kept on the phone, counter shown",
    queuedText.includes("sur ce téléphone") && counter.includes("1 en attente"),
    `${queuedText} | ${counter}`,
  );
  await context.setOffline(false);
  // Sent on the "online" event, else on the queue's 15 s retry.
  await page.waitForFunction(() => document.getElementById("queue-count").hidden, null, {
    timeout: 45000,
  });
  await idle(page); // the tiles refused while offline, reported then fetched again
  offline = false;
  const unsure = (await review()).filter((c) => c.answer === "unsure").length;
  check("offline: resent on reconnect", unsure === 1, `${unsure} stored`);

  // ... and at startup: queued offline, the page closed, the app opened again online.
  await openCamera(page, fx);
  offline = true;
  await context.setOffline(true);
  await tap(page, button(page, "Toujours là ?"));
  await tap(page, button(page, "Je ne la trouve pas"));
  await tap(page, page.locator(".part-btn.armed")); // the two-step confirmation
  await page.waitForSelector(".part-done");
  await page.close();
  await context.setOffline(false);
  offline = false;
  const page2 = await context.newPage();
  await openCamera(page2, fx);
  await waitFor("the startup resend", async () =>
    (await review()).some((c) => c.answer === "not_found"),
  );
  check("offline: resent at startup", true);
  await page2.close();

  // 4b. "Compléter" (phase D2): the three screens, "Je ne sais pas" and "Je ne vois pas"
  // (stored, out of the review list), "‹ Changer", the offline queue, and a private
  // individual's sheet without CNIL signal nor complaint link.
  const d2 = fx.complete;
  const page3 = await context.newPage();
  const openD2 = async (pg, c) => {
    if (await pg.evaluate(() => Boolean(window.__map)).catch(() => false)) await idle(pg);
    await pg.goto(`${APP}?cam=${c.camera}&open=${++opened}#18.00/${c.at[1]}/${c.at[0]}`);
    await pg.waitForSelector(".participate button", { timeout: 60000 });
  };
  const hidden = (pg) =>
    pg.evaluate(() => {
      const m = window.__map;
      return {
        pictos: m.getPaintProperty("cameras", "icon-opacity"),
        // The punk map draws its fields as one layer per level (layers.ts punkFields: `bands`
        // stays at 0 there, kept for the tests' queries).
        fields: m.getLayer("field-1")
          ? m.getPaintProperty("field-1", "fill-opacity")
          : m.getPaintProperty("bands", "fill-opacity"),
        marker: Boolean(
          document.getElementById("complete-camera") ?? document.getElementById("edit-pin"),
        ),
        // Punk: the stickers' image (« -dim » for the dimmed ones) and the fields' pattern
        // (« punk-field-dim »), as in focus; the proposals' ghosts.
        image: JSON.stringify(
          m.getLayer("cameras") ? m.getLayoutProperty("cameras", "icon-image") : null,
        ),
        pattern: m.getLayer("field-1") ? m.getPaintProperty("field-1", "fill-pattern") : null,
        ghosts: m.getLayer("proposal-ghost")
          ? m.getPaintProperty("proposal-ghost", "icon-opacity")
          : null,
      };
    });
  {
    // 4b'. « Modifier » (punk, DECISIONS 2026-10-08), in place of « Compléter »: its sheet,
    // the position ticket then Forme, Direction, Hauteur, Exploitant, each line's choices
    // under it — unfolded for what the camera only assumes, a tap unfolds the others; only
    // the direction opens the map; the changed ones sent at once, one batch; while it is
    // open only the basemap and the camera are drawn, with the field the changes give;
    // offline the send waits on the phone, then leaves whole.
    const sentPieces = async (before) =>
      (await review()).filter((c) => c.batch && !before.has(c.uuid));
    await openD2(page3, d2.three);
    const asks = await page3.locator("#part-modify.asks").count();
    await tap(page3, page3.locator("#part-modify"));
    await ed.view(page3, "sheet");
    const during = await hidden(page3);
    const fields = await page3
      .locator("#modify-panel [data-field]")
      .evaluateAll((rs) => rs.map((r) => r.dataset.field));
    const unfolded3 = await ed.unfolded(page3);
    // Who films unfolded only when unknown (the fixture's camera: unknown or private).
    const opUnknown = await page3.evaluate(
      (id) =>
        window.__map
          .querySourceFeatures("detail", { sourceLayer: "cameras" })
          .find((f) => String(f.properties.id) === id)?.properties.o === "unk",
      d2.three.camera,
    );
    const offAtFirst = await page3.locator("#modify-send").isDisabled();
    // The position ticket: the nearest street, « Position actuelle » and the commune.
    const place3 = await ed.place(page3);
    // 16a's sticker whole in the head, as on the map: a canvas, not clipped by a disc.
    const sticker = await page3.evaluate(() => {
      const c = document.querySelector("#modify-panel .modify-head canvas");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const clip = [c, ...(function* up(e) { for (let p = e.parentElement; p; p = p.parentElement) yield p; })(c)]
        .some((e) => getComputedStyle(e).borderRadius !== "0px" && getComputedStyle(e).overflow === "hidden");
      return { w: r.width, h: r.height, clip };
    }); // biome-ignore format: compact
    if (process.env.SMOKE_SHOTS)
      await page3.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-modify.png`) });
    check(
      "modify: « Modifier » with its « ? », the position ticket (the street, « Position actuelle » and the commune) and four lines, what the camera assumes unfolded (type, direction, height, who films when unknown); nothing to send yet, the sticker whole; the cameras and fields around dimmed as in focus, the proposals hidden, the camera its pin",
      asks === 1 &&
        fields.join(",") === "position,shape,direction,mount,operator" &&
        place3.title !== "Position actuelle" &&
        /^Position actuelle · \S/.test(place3.sub ?? "") &&
        place3.name === `Position : ${place3.title}, ${place3.sub}` &&
        unfolded3.join(",") === `shape,direction,mount${opUnknown ? ",operator" : ""}` &&
        offAtFirst &&
        sticker !== null &&
        !sticker.clip &&
        during.pictos !== 0 &&
        during.fields !== 0 &&
        during.image.includes('["==",["id"],-1],"-full","-dim"]') &&
        during.pattern === "punk-field-dim" &&
        during.ghosts === 0 &&
        during.marker,
      JSON.stringify({ asks, fields, place3, unfolded3, opUnknown, offAtFirst, sticker, during }),
    );
    // Forme: 3a's tiles, 16a's stickers, under the line; a tap answers in place.
    const tiles = await page3
      .locator("#modify-panel .modify-tile")
      .evaluateAll((bs) =>
        bs.map((b) => `${b.dataset.answer}:${Boolean(b.querySelector("canvas"))}`),
      );
    await tap(page3, ed.tile(page3, "dome"));
    const shape3 = await ed.value(page3, "shape");
    const pressed3 = await ed.tile(page3, "dome").getAttribute("aria-pressed");
    const focused3 = await page3.evaluate(() => document.activeElement?.dataset.answer);
    // A dome's height: its classes and « Je ne sais pas »; its tilt line as the served
    // build's rule says (questions@5: a small dome takes the tilt; a CI build made before
    // it: no line).
    const domeTilts = await page3.evaluate(async () =>
      ((q) => q?.editor_tilt_kinds ?? q?.tilt_kinds ?? [])(
        (await (await fetch("/tiles/meta.json")).json()).participation?.questions,
      ).includes("dome"),
    );
    const domeParts = await page3
      .locator(
        '#modify-panel :is([data-row="direction"], [data-row="mount"]) .modify-chip[data-part]',
      )
      .evaluateAll((bs) => bs.map((b) => `${b.dataset.part}:${b.dataset.answer}`));
    const tiltLine = await page3.locator('#modify-panel [data-row="tilt"]').count();
    const view3 = await page3.locator("#modify-panel").getAttribute("data-view");
    // « Je ne sais pas » first on every line, checked where nothing else is (DECISIONS
    // 2026-10-09): the camera's direction and height are unknown, only assumed.
    const dunno3 = await page3
      .locator('#modify-panel .modify-chip[aria-pressed="true"]')
      .evaluateAll((bs) => bs.map((b) => `${b.dataset.part}:${b.dataset.answer}`));
    check(
      "modify: five tiles with their stickers (« Multi-boules » last), « Je ne sais pas » first, answered in place (pressed, the focus kept); a dome gets the height classes and the tilt line as the build's tilt_kinds say; the direction « Je ne sais pas » and « Viser sur la carte »; « Je ne sais pas » checked on the lines nothing answers",
      tiles.join(",") === "unknown:true,dome:true,bullet:true,ptz:true,multidome:true" &&
        dunno3.includes("direction:unknown") &&
        dunno3.includes("height:unknown") &&
        shape3 === "Petit dôme" &&
        pressed3 === "true" &&
        focused3 === "dome" &&
        view3 === "sheet" &&
        domeParts.join(",") ===
          "direction:unknown,height:unknown,height:ground,height:first,height:upper" &&
        tiltLine === (domeTilts ? 1 : 0) &&
        (await page3.locator("#modify-aim-open").count()) === 1,
      JSON.stringify({
        tiles,
        shape3,
        pressed3,
        focused3,
        view3,
        domeParts,
        tiltLine,
        domeTilts,
        dunno3,
      }),
    );
    // Direction (a phone): the crosshair fixed at the centre, on the camera at first, so
    // « Valider » waits; the map slid 15 m north-east under it, the aim follows.
    await ed.aimOpen(page3);
    const waits = await page3.locator("#aim-submit").isDisabled();
    const bearing = await ed.aim(page3);
    const cone = await ed.fieldDrawn(page3);
    // The crosshair at the free map's centre, the line from the camera to it.
    const fixed = await page3.evaluate(() => {
      const m = window.__map;
      const box = m.getContainer().getBoundingClientRect();
      const c = m.project(m.getCenter());
      const r = document.getElementById("edit-target").getBoundingClientRect();
      return Math.hypot(
        r.left + r.width / 2 - (box.left + c.x),
        r.top + r.height / 2 - (box.top + c.y),
      );
    });
    // A tap elsewhere brings that point under the crosshair (a drag's alternative).
    const tapped = await page3.evaluate(() => {
      const m = window.__map;
      const box = m.getContainer().getBoundingClientRect();
      const c = m.project(m.getCenter());
      const p = { x: box.left + c.x - 60, y: box.top + c.y - 30 };
      const ll = m.unproject([c.x - 60, c.y - 30]);
      return { p, ll: [ll.lng, ll.lat] };
    });
    await page3.touchscreen.tap(tapped.p.x, tapped.p.y);
    await page3
      .waitForFunction(
        (ll) => {
          const c = window.__map.getCenter();
          return Math.hypot(c.lng - ll[0], c.lat - ll[1]) < 2e-6 && !window.__map.isMoving();
        },
        tapped.ll,
        { timeout: 5000 },
      )
      .catch(() => {});
    const tapBearing = Number(await page3.locator("#modify-panel").getAttribute("data-bearing"));
    const centreNow = await page3.evaluate(() => {
      const c = window.__map.getCenter();
      return [c.lng, c.lat];
    });
    const tapMoved = metres(centreNow, tapped.ll) < 0.5 && tapBearing !== bearing;
    // Slid back to 15 m north-east: the bearing « Valider » sends.
    const bearingBack = await ed.aim(page3);
    // The line's source is tiled in a worker: it is there once its tile is.
    await page3
      .waitForFunction(() => window.__map.querySourceFeatures("edit-line").length > 0, null, {
        timeout: 5000,
      })
      .catch(() => {});
    const line = await page3.evaluate(() => ({
      n: window.__map.querySourceFeatures("edit-line").length,
      dash: window.__map.getPaintProperty("edit-line", "line-dasharray"),
    }));
    if (process.env.SMOKE_SHOTS)
      await page3.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-modify-aim.png`) });
    check(
      "modify: aimed on a phone by sliding the map under the fixed crosshair — Valider waits on the camera, then the bearing to the centre, a dotted line, the field drawn; a tap brings its point under the crosshair",
      waits && bearing !== null && Math.abs(bearing - 45) <= 8 && fixed < 1.5 && cone && line.n > 0 && Boolean(line.dash) && tapMoved && bearingBack !== null && Math.abs(bearingBack - 45) <= 8,
      JSON.stringify({ waits, bearing, fixed, cone, line, tapMoved, tapBearing, bearingBack }),
    ); // biome-ignore format: compact
    await tap(page3, page3.locator("#aim-submit"));
    await ed.view(page3, "sheet");
    const backOn = await page3.evaluate(() => document.activeElement?.id);
    await ed.unfold(page3, "operator");
    const ops = await page3
      .locator('#modify-panel .modify-chip[data-part="operator"]')
      .evaluateAll((bs) => bs.map((b) => `${b.dataset.answer}:${b.getAttribute("aria-pressed")}`));
    // The camera's operator as a choice says it: unknown -> « Je ne sais pas », a private
    // one without its kind -> none.
    const opOwn = await page3.evaluate((id) => {
      const p = window.__map
        .querySourceFeatures("detail", { sourceLayer: "cameras" })
        .find((f) => String(f.properties.id) === id)?.properties;
      if (!p || p.o === "unk") return "unknown";
      return { pub: "public", h: "household", b: "business" }[p.ok ?? p.o] ?? null;
    }, d2.three.camera);
    const opsWanted = ["unknown", "public", "business", "household"]
      .map((a) => `${a}:${a === opOwn}`)
      .join(",");
    await tap(page3, ed.part(page3, "operator", "household"));
    const stamps = await page3.locator("#modify-panel .modify-stamp").count();
    const sendText = await page3.locator("#modify-send").innerText();
    check(
      "modify: back from the map on « Viser sur la carte »; who films unfolded by a tap, « Je ne sais pas » first, the camera's own answer pressed (« Je ne sais pas » when unknown); the sheet is the summary — three rows stamped « Corrigé », « Envoyer 3 modifications »",
      backOn === "modify-aim-open" &&
        ops.join(",") === opsWanted &&
        stamps === 3 &&
        /3 modifications/i.test(sendText),
      JSON.stringify({ backOn, ops, opOwn, stamps, sendText }),
    );
    let known3 = new Set((await review()).map((c) => c.uuid));
    await ed.send(page3);
    const thanks = await page3.locator("#modify-done").innerText();
    await ed.finish(page3);
    const after = await hidden(page3);
    let sent3;
    await waitFor("the send stored", async () => {
      sent3 = await sentPieces(known3);
      return sent3.length === 3;
    });
    const dir3 = sent3.find((c) => c.kind === "direction");
    check(
      "modify: one send, its three pieces in one batch, the bearing as aimed; the map back after",
      new Set(sent3.map((c) => c.batch)).size === 1 &&
        sent3.every((c) => c.status === "pending") &&
        dir3?.direction === bearingBack &&
        sent3.some((c) => c.kind === "shape" && c.answer === "dome") &&
        sent3.some((c) => c.kind === "operator" && c.answer === "household") &&
        thanks.includes("3 modifications") &&
        after.pictos !== 0 &&
        after.fields !== 0 &&
        !/-dim/.test(after.image) &&
        after.pattern !== "punk-field-dim" &&
        after.ghosts !== 0 &&
        !after.marker,
      JSON.stringify({ thanks, pieces: sent3.map((c) => [c.kind, c.answer, c.direction]) }),
    );
    // Offline: a tube at the first floor (its tilt line, left unanswered), a business; kept
    // on the phone, then sent whole.
    await openD2(page3, d2.three);
    offline = true;
    await context.setOffline(true);
    await tap(page3, page3.locator("#part-modify"));
    await ed.view(page3, "sheet");
    await tap(page3, ed.tile(page3, "bullet"));
    const mountLabel = await page3
      .locator('#modify-panel [data-field="mount"] .modify-label')
      .innerText();
    await tap(page3, ed.part(page3, "height", "first"));
    const tiltShown = await ed.part(page3, "tilt", "slight").count();
    await ed.unfold(page3, "operator");
    await tap(page3, ed.part(page3, "operator", "business"));
    await page3.waitForTimeout(300); // offline: no names to offer
    known3 = new Set((await review()).map((c) => c.uuid));
    await ed.send(page3);
    const doneText = await page3.locator("#modify-done").innerText();
    const counter3 = await page3.locator("#queue-count").innerText();
    check(
      "modify offline: a tube's « Hauteur », its « Inclinaison » on the line under it; three pieces kept on the phone",
      mountLabel === "Hauteur" &&
        tiltShown === 1 &&
        doneText.includes("sur ce téléphone") &&
        counter3.includes("3 en attente"),
      `${mountLabel} | ${doneText} | ${counter3}`,
    );
    await ed.finish(page3);
    await context.setOffline(false);
    await page3.waitForFunction(() => document.getElementById("queue-count").hidden, null, {
      timeout: 45000,
    });
    offline = false;
    let sentOffline;
    await waitFor("the offline send stored", async () => {
      sentOffline = await sentPieces(known3);
      return sentOffline.length === 3;
    });
    check(
      "modify offline: resent whole, one batch",
      new Set(sentOffline.map((c) => c.batch)).size === 1,
      JSON.stringify(sentOffline.map((c) => [c.kind, c.answer])),
    );
    // A send leaves one piece at a time: cut after its first piece, the rest waits on the
    // phone. Withdrawn there, the piece already on the server goes too; refused by the
    // server (its second piece), none of it is kept and the author is told.
    const contribPath = (u) => u.pathname === "/api/contributions";
    let posts = 0;
    let refuseSecond = false;
    const cut = async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      if (posts === 1) return route.continue();
      if (refuseSecond && posts === 2)
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: "too_far" }),
        });
      return route.abort("internetdisconnected");
    };
    await page3.route(contribPath, cut);
    // A tube at the first floor, and slightly down with `tilt`: two or three pieces.
    const editTwo = async (tilt) => {
      await openD2(page3, d2.three);
      await tap(page3, page3.locator("#part-modify"));
      await ed.view(page3, "sheet");
      await tap(page3, ed.tile(page3, "bullet"));
      await tap(page3, ed.part(page3, "height", "first"));
      if (tilt) await tap(page3, ed.part(page3, "tilt", "slight"));
    };
    // The review's list leaves withdrawn rows out unless asked: both lists.
    const everyPiece = async () => [
      ...(await review()),
      ...(await reviewList("?status=withdrawn")).contributions,
    ];
    const piecesSince = async (before) =>
      (await everyPiece()).filter((c) => c.batch && !before.has(c.uuid));
    const oneWithdrawn = (rows) => rows.length === 1 && rows[0].status === "withdrawn";
    await editTwo(false);
    const knownCut = new Set((await everyPiece()).map((c) => c.uuid));
    await ed.send(page3);
    await waitFor("the cut send's first piece stored", async () => {
      return (await piecesSince(knownCut)).length === 1;
    });
    await ed.finish(page3);
    await page3.waitForSelector("#queue-count:not([hidden])");
    await tap(page3, page3.locator("#queue-count"));
    const queuedWithdraw = page3.locator("#mine .mine-withdraw").first();
    await tap(page3, queuedWithdraw);
    await tap(page3, queuedWithdraw);
    let cutRows = [];
    await waitFor("the cut send withdrawn on the server", async () => {
      cutRows = await piecesSince(knownCut);
      return oneWithdrawn(cutRows);
    }).catch(() => {});
    const cutQueue = await page3.evaluate(() => document.getElementById("queue-count").hidden);
    check(
      "modify cut mid-send, withdrawn on the phone: its piece on the server withdrawn too, none left waiting",
      oneWithdrawn(cutRows) && cutQueue,
      JSON.stringify({ rows: cutRows.map((c) => [c.kind, c.status]), cutQueue }),
    );
    await tap(page3, page3.locator("#mine .close"));
    posts = 0;
    refuseSecond = true;
    await editTwo(true);
    const knownRefused = new Set((await everyPiece()).map((c) => c.uuid));
    await ed.send(page3);
    await page3
      .waitForFunction(
        () => document.getElementById("queue-count")?.textContent.includes("refusée"),
        null,
        { timeout: 30000 },
      )
      .catch(() => {});
    const refusedThanks = await page3.locator("#modify-done").innerText();
    const refusedCounter = await page3.locator("#queue-count").innerText();
    let refusedRows = [];
    await waitFor("the refused send's arrived piece withdrawn", async () => {
      refusedRows = await piecesSince(knownRefused);
      return oneWithdrawn(refusedRows);
    }).catch(() => {});
    // Three pieces: the first stored, the second refused, the third never sent.
    check(
      "modify refused mid-send: the whole send dropped (its arrived piece withdrawn, the rest never sent), said in place of the thanks and on the counter",
      oneWithdrawn(refusedRows) &&
        posts === 2 &&
        refusedThanks.includes("refusée") &&
        refusedCounter.includes("refusée"),
      JSON.stringify({
        rows: refusedRows.map((c) => [c.kind, c.status]),
        refusedThanks,
        refusedCounter,
        posts,
      }),
    );
    await ed.finish(page3);
    await page3.unroute(contribPath, cut);
  }

  // A private individual's camera (the CI fixture's validated "Particulier").
  await openD2(page3, d2.household);
  const sheet3 = await page3.locator("#sheet").innerText();
  const cnil = await page3.locator("#sheet .cnil").count();
  const link = await page3.locator('#sheet a[href*="cnil.fr"]').count();
  check(
    "particulier: no CNIL signal, no complaint link, said in the headline",
    cnil === 0 && link === 0 && sheet3.includes("de particulier"),
    sheet3.split("\n").slice(0, 2).join(" / "),
  );
  await page3.close();

  // 5. Review (/revue, lot 1 « Modérer »): the reviewer role only; « File » (one row per
  // camera, no raw id, its filters and search in the address), a camera's view (its map,
  // what to decide, « Détails »), a decision in one tap with « Annuler » for 8 s, the next
  // camera after the last send of one, « Changer la décision » in two steps, the way back
  // to the queue (its row focused), the map's old ?status=conflict; then lot 2's entry and
  // the administrator's views (5b). Behind the real site file (caddy) the page meets its
  // Content-Security-Policy: no violation.
  // Past the gate the page itself loads for everyone (it says « Connexion à la revue »);
  // what it shows comes from the API, which answers only a session its privileged entry
  // opened (POST /api/review/session), a reviewer's or an administrator's.
  const ana = await asUser("ana", "/revue");
  const anaApi = await asUser("ana", "/api/review/queue");
  const revOrdinary = await fetch(new URL("/api/session", APP), {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", Authorization: basic("rev") },
    body: JSON.stringify({ pseudonym: "rev", password: BENCH_PASSWORD }),
  });
  check(
    "review: closed to a contributor (401 privileged); /api/session refuses the administrator",
    ana.status === 200 &&
      anaApi.status === 401 &&
      (await anaApi.json()).error === "privileged" &&
      revOrdinary.status === 401,
    `${ana.status} ${anaApi.status} ${revOrdinary.status}`,
  );
  const revCsp = (await asUser("rev", "/revue")).headers.get("content-security-policy") ?? "";
  const revContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    httpCredentials: { username: "rev", password: PW },
  });
  // Every violation of the page's Content-Security-Policy, told by the browser.
  await revContext.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const desk = await revContext.newPage();
  lastPage = desk;
  desk.on("pageerror", (e) => pageErrors.push(String(e)));
  desk.on("console", (m) => {
    if (m.type() === "error" && /Content.Security.Policy|Refused to/i.test(m.text()))
      pageErrors.push(`revue CSP: ${m.text()}`);
  });
  const queueApi = async (filter) =>
    (await (await asUser("rev", `/api/review/queue?filter=${filter}`)).json()).items;
  const rowsOf = (pg) =>
    pg
      .locator(".review-row")
      .evaluateAll((ls) => ls.map((l) => ({ camera: l.dataset.camera, text: l.innerText })));
  await desk.goto(`${APP}revue`);
  await desk.waitForSelector(".review-row", { timeout: 60000 });
  const todo = await rowsOf(desk);
  const todoApi = await queueApi("todo");
  const summary = await desk.locator(".review-summary").innerText();
  if (process.env.SMOKE_SHOTS)
    await desk.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-revue-list-desk.png`) });
  check(
    "review: « À traiter » lists the queue's cameras in its order, one row each, no raw id, « N en attente »",
    todo.length > 0 &&
      todo.map((l) => l.camera).join() === todoApi.map((i) => i.camera).join() &&
      todo.every((l) => !l.text.includes(l.camera)) &&
      /\d+ en attente/.test(summary) &&
      (await desk.evaluate(() => document.activeElement?.tagName)) === "H1",
    `${todo.length} rows; ${summary}`,
  );
  await desk.locator('.review-chip[data-filter="all"]').click();
  await desk.waitForFunction(() => window.location.search.includes("file=all"));
  await desk.waitForFunction(
    (n) => document.querySelectorAll(".review-row").length >= n,
    todo.length,
  );
  await desk.waitForTimeout(300);
  const every = await rowsOf(desk);
  await desk.locator("#review-search").fill("zzzz");
  await desk.waitForSelector(".review-empty", { timeout: 10000 });
  const none = await desk.locator(".review-empty").innerText();
  const searched = await desk.evaluate(() => window.location.search);
  await desk.locator("#review-search").fill("");
  await desk.waitForFunction(
    (n) => document.querySelectorAll(".review-row").length === n,
    every.length,
  );
  check(
    "review: « Tout » and a search, both kept in the address",
    every.length >= todo.length &&
      every.map((l) => l.camera).join() === (await queueApi("all")).map((i) => i.camera).join() &&
      none.includes("zzzz") &&
      searched.includes("q=zzzz"),
    `${every.length} rows; ${none}; ${searched}`,
  );

  // A camera's view, from the « Tout » list: its h1 (the label, no id), the map (the
  // served position and field, a direction's proposed field), what to decide.
  const three = d2.three.camera;
  await desk.locator(`.review-row[data-camera="${three}"]`).click();
  await desk.waitForSelector(`#review-camera[data-camera="${three}"] .review-diff`);
  await desk
    .waitForFunction(
      () =>
        (window.__reviewMap?.querySourceFeatures("sel") ?? []).some(
          (f) => f.properties.role === "served",
        ),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
  const view = await desk.evaluate(() => ({
    url: window.location.search,
    h1: document.querySelector("h1")?.innerText ?? "",
    focused: document.activeElement?.tagName,
    table: document.querySelector(".review-diff tbody")?.innerText ?? "",
    page: document.querySelector("#review-camera")?.innerText ?? "",
    legend: document.querySelector(".review-legend")?.innerText ?? "",
  }));
  const drawn = await desk.evaluate(() => {
    const feats = window.__reviewMap?.querySourceFeatures("sel") ?? [];
    const n = (role) => feats.filter((f) => f.properties.role === role).length;
    return { now: n("now"), proposed: n("proposed"), served: n("served") };
  });
  check(
    "review: a camera's view — its address, its label as h1 (no id), the map, a direction before -> after",
    view.url.includes(`camera=${three}`) &&
      view.url.includes("file=all") &&
      !view.h1.includes(three) &&
      view.focused === "H1" &&
      /Direction/.test(view.page) &&
      /\d+° \(/.test(view.page),
    `${view.h1} | ${view.table.replace(/\n/g, " ")}`,
  );
  check(
    "review: the map draws the served position and field (dashed), the legend names shapes",
    drawn.now > 0 &&
      drawn.served > 0 &&
      (!/Direction/.test(view.table) || drawn.proposed > 0) &&
      view.legend.includes("rond cerclé") &&
      !/rouge|blanc|rose/.test(view.legend),
    `${JSON.stringify(drawn)} ${view.legend}`,
  );
  if (process.env.SMOKE_SHOTS) {
    await reviewMapIdle(desk);
    await desk.screenshot({
      path: join(process.env.SMOKE_SHOTS, `${engine}-revue-window-desk.png`),
    });
  }
  // One tap validates; « Annuler » puts it back; one tap again.
  const unitOf = () =>
    desk.locator(".review-diff tbody tr").evaluateAll((trs) => trs.map((tr) => tr.dataset.uuid));
  const statusOf = async (uuids) => {
    const rows = await review();
    return uuids.map((u) => rows.find((c) => c.uuid === u)?.status);
  };
  const firstUnit = await unitOf();
  await desk.locator('[data-action="validated"]').click();
  await desk.waitForSelector(".review-toast .review-toast-undo");
  const toast = await desk.locator(".review-toast").innerText();
  await waitFor("a validation", async () =>
    (await statusOf(firstUnit)).every((s) => s === "validated"),
  );
  const validated = (await review()).find((c) => c.uuid === firstUnit[0]);
  check(
    "review: « Valider » in one tap, keeping who and which day; « Validée. » and « Annuler »",
    validated.decided_by === "rev" &&
      validated.decided_on === new Date().toLocaleDateString("sv") &&
      toast.includes("Validée.") &&
      /Annuler \(\d s\)/i.test(toast),
    JSON.stringify({ by: validated.decided_by, on: validated.decided_on, toast }),
  );
  await desk.locator(".review-toast-undo").click();
  await waitFor("the undo", async () => (await statusOf(firstUnit)).every((s) => s === "pending"));
  await desk.waitForSelector(`#review-camera[data-camera="${three}"] .review-diff`);
  await desk.waitForFunction(() =>
    document.getElementById("review-live")?.textContent?.includes("annulée"),
  );
  // The camera shown again with the send undone to decide (its view drawn anew).
  await desk.waitForFunction(
    (uuids) =>
      [...document.querySelectorAll(".review-diff tbody tr")]
        .map((tr) => tr.dataset.uuid)
        .join() === uuids.join(),
    firstUnit,
    { timeout: 15000 },
  );
  check("review: « Annuler » puts the decision back, the camera shown again, said", true);
  await desk.waitForTimeout(400);
  await desk.locator('[data-action="validated"]').click();
  await waitFor("a validation again", async () =>
    (await statusOf(firstUnit)).every((s) => s === "validated"),
  );
  // The camera's other sends, rejected one by one; then the next camera of « Tout ».
  const at = every.findIndex((l) => l.camera === three);
  const expected = every[at + 1]?.camera ?? null;
  const rejected = [];
  /** The view after a decision on `unit`: another send to decide, or another view. */
  const moved = (unit) =>
    desk.waitForFunction(
      ([c, u]) =>
        document.querySelector("#review-camera")?.dataset.camera !== c ||
        Boolean(document.querySelector('[data-action="next"]')) ||
        [...document.querySelectorAll(".review-diff tbody tr")]
          .map((tr) => tr.dataset.uuid)
          .join() !== u.join(),
      [three, unit],
      { timeout: 15000 },
    );
  await moved(firstUnit);
  for (let i = 0; i < 8; i++) {
    const here = await desk.evaluate(() => ({
      camera: document.querySelector("#review-camera")?.dataset.camera ?? null,
      next: Boolean(document.querySelector('[data-action="next"]')),
    }));
    if (here.camera !== three || here.next) break;
    const unit = await unitOf();
    if (!unit.length) break;
    await desk.locator('[data-action="rejected"]').click();
    await waitFor("a rejection", async () => (await statusOf(unit)).every((s) => s === "rejected"));
    rejected.push(...unit);
    await moved(unit);
  }
  await desk.waitForFunction(
    (c) => (document.querySelector("#review-camera")?.dataset.camera ?? null) !== c,
    three,
    { timeout: 15000 },
  );
  const after = await desk.evaluate(() => ({
    camera: document.querySelector("#review-camera")?.dataset.camera ?? null,
    queue: Boolean(document.getElementById("review-queue")),
    url: window.location.search,
  }));
  check(
    "review: « Rejeter » in one tap; the camera's next send, then the next camera of the list",
    rejected.length > 0 &&
      (expected
        ? after.camera === expected && after.url.includes(`camera=${expected}`)
        : after.queue),
    JSON.stringify({ rejected: rejected.length, expected, after }),
  );
  // « Changer la décision » (Détails, open when nothing waits): two steps, there and back.
  await desk.goto(`${APP}revue?camera=${three}&file=all`);
  const decided = desk.locator(`#review-details li.review-decided[data-uuid="${firstUnit[0]}"]`);
  await decided.waitFor({ timeout: 20000 });
  const to1 = await decided.locator(".decide-change").getAttribute("data-to");
  await decided.locator(".decide-change").click();
  const armed = await decided.locator(".decide-change.armed").innerText();
  await decided.locator(".decide-change.armed").click();
  await waitFor("the decision changed", async () =>
    (await statusOf(firstUnit)).every((s) => s === "rejected"),
  );
  await desk.waitForSelector(
    `#review-details li.review-decided[data-uuid="${firstUnit[0]}"][data-status="rejected"]`,
  );
  const to2 = await decided.locator(".decide-change").getAttribute("data-to");
  await decided.locator(".decide-change").click();
  await decided.locator(".decide-change.armed").click();
  await waitFor("the decision changed back", async () =>
    (await statusOf(firstUnit)).every((s) => s === "validated"),
  );
  const details = await desk.locator("#review-details").innerText();
  check(
    "review: « Changer la décision » in two steps, validated -> rejected -> validated; the id only under « Détails », with its copy button",
    to1 === "rejected" &&
      /Rejeter : confirmer/i.test(armed) &&
      to2 === "validated" &&
      details.includes(three) &&
      (await desk.locator("#review-details .review-id button").count()) === 1,
    JSON.stringify({ to1, armed, to2 }),
  );
  // Back to the queue (« ‹ File »): its row focused; the browser's back button returns.
  await desk.locator(".review-back").click();
  await desk.waitForSelector(".review-row");
  await desk
    .waitForFunction((c) => document.activeElement?.dataset?.camera === c, three, {
      timeout: 10000,
    })
    .catch(() => {});
  const focusedRow = await desk.evaluate(() => document.activeElement?.dataset?.camera);
  await desk.goBack();
  await desk.waitForSelector(`#review-camera[data-camera="${three}"]`);
  check(
    "review: « ‹ File » back to the queue, the camera's row focused; the back button returns",
    focusedRow === three,
    String(focusedRow),
  );
  // The map's links: /revue?status=conflict (and &kind=add) open « Conflits ».
  await desk.goto(`${APP}revue?status=conflict&kind=add`);
  await desk.waitForSelector('.review-chip[data-filter="conflicts"][aria-pressed="true"]');
  const legacy = await desk.evaluate(() => window.location.search);
  check(
    "review: the map's ?status=conflict&kind=add opens « Conflits »",
    legacy.includes("file=conflicts") && !legacy.includes("status="),
    legacy,
  );
  await reauthed();
  const csv = await (await asUser("rev", "/api/review/export.csv")).text();
  check(
    "review: CSV export (the administrator's, after the password again), one line per contribution",
    // Every contribution, the 6 "Compléter" answers included: 12 rows and the header;
    // punk, the cut and the refused sends' piece each (4b', withdrawn) too.
    csv.startsWith("uuid,kind,camera") && csv.trim().split("\n").length === 15,
    `${csv.trim().split("\n").length - 1} rows`,
  );

  // 5b. Lot 2 « Administrer »: the privileged entry through the page's own form, the
  // administrator's tabs, « Comptes » and a sheet (role, cut, suspend, reset, delete, each
  // after « Confirmez avec votre mot de passe »), « Retraits », « Réglages » with the CSV,
  // « Journal », « Statistiques » (lot 4). gil, a bench account this smoke never signs in, takes the gestures.
  const entry = await recorded(
    await newContext({
      viewport: { width: 1280, height: 900 },
      httpCredentials: { username: "rev", password: PW },
      acceptDownloads: true,
    }),
  );
  const gate = await entry.newPage();
  lastPage = gate;
  gate.on("pageerror", (e) => pageErrors.push(String(e)));
  await gate.goto(`${APP}revue?file=all`);
  await gate.waitForSelector("#review-signin #review-pseudonym", { timeout: 60000 });
  await gate.fill("#review-pseudonym", "rev");
  await gate.fill("#review-password", BENCH_PASSWORD);
  await gate.click("#review-signin button[type=submit]");
  await gate.waitForSelector(".review-row", { timeout: 60000 });
  const tabs = await gate.locator(".review-tab").allInnerTexts();
  check(
    "review: the privileged entry by /revue's form, the address kept; an administrator's six tabs",
    gate.url().includes("file=all") &&
      tabs.map((x) => x.toLowerCase()).join(",") ===
        "file,comptes,retraits,réglages,statistiques,journal",
    `${gate.url()} ${tabs.join(",")}`,
  );
  /** The password dialog, answered (the first destructive action of this session). */
  const confirmPassword = async (pg) => {
    await pg.waitForSelector("#review-reauth[open]", { timeout: 20000 });
    const focused = await pg.evaluate(() => document.activeElement?.id);
    await pg.fill("#review-reauth-password", BENCH_PASSWORD);
    await pg.click("#review-reauth button[type=submit]");
    await pg.waitForSelector("#review-reauth:not([open])", { state: "attached", timeout: 40000 });
    return focused;
  };
  /** The sheet's line at its top (written just after the view: read aloud then). */
  const sheetNote = async (pg) => {
    await pg.waitForFunction(
      () => document.querySelector("#review-account .review-note")?.textContent?.trim(),
      null,
      { timeout: 40000 },
    );
    return pg.locator("#review-account .review-note").innerText();
  };
  await gate.click('.review-tab[data-tab="comptes"]');
  await gate.waitForSelector("#review-accounts a[data-account]");
  await gate.fill("#review-accounts-search", "gil");
  await gate.waitForFunction(
    () =>
      [...document.querySelectorAll("#review-accounts a[data-account]")]
        .map((a) => a.textContent)
        .join() === "gil",
  );
  await gate.locator("#review-accounts a[data-account]", { hasText: "gil" }).click();
  await gate.waitForSelector("#review-account #review-role");
  const sheet = await gate.locator("#review-account").innerText();
  await gate.click("#review-role");
  await gate.check('input[name="review-role"][value="reviewer"]');
  await gate.click(".review-role-form button[type=submit]");
  const dialogFocus = await confirmPassword(gate);
  const roleNote = await sheetNote(gate);
  check(
    "review: a sheet (no OSM id, no hash), « Rôle… » after « Confirmez avec votre mot de passe », said",
    /Rôle\s*Contributeur/.test(sheet) &&
      /Arrivée/.test(sheet) &&
      !/osm_id|\$argon2/.test(sheet) &&
      dialogFocus === "review-reauth-password" &&
      roleNote.includes("Rôle changé : Relecteur"),
    `${roleNote} [${dialogFocus}]`,
  );
  await gate.click("#review-role");
  await gate.check('input[name="review-role"][value="contributor"]');
  await gate.click(".review-role-form button[type=submit]");
  await gate.waitForFunction(() =>
    document.querySelector("#review-account .review-note")?.textContent?.includes("Contributeur"),
  );
  await gate.click("#review-cut");
  await gate.click("#review-cut");
  await gate.waitForFunction(() =>
    document.querySelector("#review-account .review-note")?.textContent?.includes("Accès coupé"),
  );
  const cutNote = await sheetNote(gate);
  await gate.click("#review-suspend");
  await gate.click("#review-suspend");
  await gate.waitForFunction(() =>
    document.querySelector("#review-account .review-note")?.textContent?.includes("suspendu"),
  );
  const suspended = await gate.locator("#review-account").innerText();
  await gate.click("#review-state");
  await gate.click("#review-state");
  await gate.waitForFunction(() =>
    document.querySelector("#review-account .review-note")?.textContent?.includes("réactivé"),
  );
  await gate.click("#review-reset");
  await gate.click("#review-reset");
  await gate.waitForSelector(".review-reset #review-reset-password");
  const password = await gate.locator("#review-reset-password").innerText();
  await gate.click('.review-tab[data-tab="comptes"], .review-back');
  await gate.waitForSelector("#review-accounts");
  check(
    "review: « Couper l'accès », « Suspendre » (disabled, said), « Réactiver », a password shown once",
    /Accès coupé/.test(cutNote) &&
      /désactivé/.test(suspended) &&
      password.length >= 20 &&
      !(await gate.content()).includes(password),
    `${cutNote} | ${password.length} characters`,
  );
  // One's own sheet: nothing that the API would refuse.
  await gate.fill("#review-accounts-search", "rev");
  await gate.waitForSelector('#review-accounts a[data-account]:text-is("rev")');
  await gate.locator('#review-accounts a[data-account]:text-is("rev")').click();
  await gate.waitForSelector("#review-account #review-cut");
  const own = await gate.evaluate(() => ({
    del: Boolean(document.getElementById("review-delete")),
    suspend: Boolean(document.getElementById("review-suspend")),
    text: document.getElementById("review-account")?.innerText ?? "",
  }));
  check(
    "review: one's own sheet offers neither « Supprimer… » nor « Suspendre », and says why",
    !own.del && !own.suspend && own.text.includes("C'est votre compte"),
    JSON.stringify({ del: own.del, suspend: own.suspend }),
  );
  // Deleting gil: the pseudonym retyped.
  await gate.click(".review-back");
  await gate.fill("#review-accounts-search", "gil");
  await gate.locator("#review-accounts a[data-account]", { hasText: "gil" }).click();
  await gate.waitForSelector("#review-account #review-delete");
  await gate.click("#review-delete");
  await gate.fill("#review-delete-name", "gill");
  await gate.click(".review-delete-form button[type=submit]");
  const mistyped = await gate.locator("#review-account .review-error").innerText();
  await gate.fill("#review-delete-name", "gil");
  await gate.click(".review-delete-form button[type=submit]");
  await gate.waitForFunction(
    () =>
      document.querySelector("#review-accounts .review-note")?.textContent?.includes("supprimé"),
    null,
    { timeout: 20000 },
  );
  const deleted = await gate.locator("#review-accounts .review-note").innerText();
  check(
    "review: « Supprimer… » asks the pseudonym retyped, then « Comptes » says it is gone",
    mistyped.includes("ne correspond pas") && deleted.includes("Compte gil supprimé"),
    `${mistyped} | ${deleted}`,
  );
  // « Retraits »: hidden by a map link, its label said as typed, shown again.
  const hideCam = three;
  await gate.click('.review-tab[data-tab="retraits"]');
  await gate.waitForSelector("#review-hidden #review-hide-id");
  // The view loaded (its list said) before typing, as one reads it first: typed at once
  // after the tab, the field lost its link twice in WebKit (lot U2's gate; a pause
  // of any kind made it pass, the field the same element, no reload).
  await gate.waitForFunction(
    () => (document.querySelector("#review-hidden .review-hidden-list")?.textContent ?? "") !== "",
  );
  await gate.fill("#review-hide-id", `${APP}?cam=${hideCam}#18/48.9/2.24`);
  await gate.waitForFunction(
    (c) => document.getElementById("review-hide-preview")?.textContent?.startsWith(`${c} : `),
    hideCam,
  );
  const preview = await gate.locator("#review-hide-preview").innerText();
  await gate.click(".review-hide-form button[type=submit]");
  await gate.waitForSelector(`#review-hidden tr[data-camera="${hideCam}"]`);
  const hiddenRow = await gate.locator(`#review-hidden tr[data-camera="${hideCam}"]`).innerText();
  await gate.locator(`#review-hidden tr[data-camera="${hideCam}"] button`).click();
  await gate.waitForSelector(`#review-hidden tr[data-camera="${hideCam}"]`, { state: "detached" });
  check(
    "review: « Retraits » hides by a map link (what it is said first), « au prochain build », « Démasquer »",
    !preview.includes("Inconnue") && /au prochain build/i.test(hiddenRow),
    `${preview} | ${hiddenRow.replace(/\n/g, " ")}`,
  );
  // « Réglages »: sign-ups closed and open again, at once; the CSV downloaded.
  await gate.click('.review-tab[data-tab="reglages"]');
  await gate.waitForSelector("#review-switch-signups_open");
  await gate.click("#review-switch-signups_open");
  await gate.waitForSelector('#review-switch-signups_open[aria-checked="false"]');
  const closedConfig = await (
    await fetch(new URL("/api/config", APP), { headers: { Authorization: basic("ana") } })
  ).json();
  await gate.click("#review-switch-signups_open");
  await gate.waitForSelector('#review-switch-signups_open[aria-checked="true"]');
  const [download] = await Promise.all([gate.waitForEvent("download"), gate.click("#review-csv")]);
  check(
    "review: « Réglages » closes and opens sign-ups at once; « Exporter toutes les contributions (CSV) » downloads",
    closedConfig.signups === false && download.suggestedFilename() === "contributions.csv",
    `${JSON.stringify(closedConfig)} ${download.suggestedFilename()}`,
  );
  // The OSM synchronisation's switches: « Synchronisation OSM » suspended and on again (each
  // after the password, as the others); « Écriture sur le vrai serveur OSM » off, and greyed
  // with its reason while this API has no client for the live server (a tap says it, no
  // request).
  await gate.click("#review-switch-osm_sync");
  await gate.waitForSelector('#review-switch-osm_sync[aria-checked="false"]');
  const suspendedSettings = await (await asUser("rev", "/api/review/settings")).json();
  await gate.click("#review-switch-osm_sync");
  await gate.waitForSelector('#review-switch-osm_sync[aria-checked="true"]');
  const live = await gate.evaluate(() => {
    const sw = document.getElementById("review-switch-osm_write_live");
    const reason = document.getElementById("review-osm_write_live-reason");
    return {
      checked: sw?.getAttribute("aria-checked"),
      disabled: sw?.getAttribute("aria-disabled"),
      described: sw?.getAttribute("aria-describedby") ?? "",
      reason: reason && !reason.hidden ? reason.textContent : null,
      hint: document.getElementById("review-osm_write_live-hint")?.textContent ?? "",
    };
  });
  const osmBefore = (await (await asUser("rev", "/api/review/settings")).json()).osm;
  let livePosts = 0;
  const countLive = (r) => {
    if (r.method() === "POST" && r.url().includes("/api/review/settings")) livePosts++;
  };
  gate.on("request", countLive);
  // force: Playwright waits on an aria-disabled element as on a disabled one; a tap does not.
  if (osmBefore.live_client === false)
    await gate.locator("#review-switch-osm_write_live").click({ force: true });
  await gate.waitForTimeout(300);
  gate.off("request", countLive);
  const liveSaid = await gate.locator("#review-settings .review-inline-error").textContent();
  check(
    "review: « Réglages » suspends the OSM synchronisation and resumes it; « Écriture sur le vrai serveur OSM » off, its sentence (wiki, forum, two weeks), greyed with its reason without the live client, a tap says it and sends nothing",
    suspendedSettings.osm_sync === false &&
      live.checked === "false" &&
      /wiki[\s\S]*forum[\s\S]*deux semaines/.test(live.hint) &&
      (osmBefore.live_client !== false ||
        (live.disabled === "true" &&
          live.described.includes("review-osm_write_live-reason") &&
          /client du vrai serveur OSM/.test(live.reason ?? "") &&
          /client du vrai serveur OSM/.test(liveSaid ?? "") &&
          livePosts === 0)),
    JSON.stringify({ suspended: suspendedSettings.osm_sync, live, osmBefore, liveSaid, livePosts }),
  );
  // « OSM », the queue's filter: its chip and count, the address keeps it.
  await gate.click('.review-tab[data-tab="queue"]');
  await gate.waitForSelector('.review-chip[data-filter="osm"]');
  await gate.click('.review-chip[data-filter="osm"]');
  await gate.waitForFunction(() => window.location.search.includes("file=osm"));
  await gate.waitForSelector('.review-chip[data-filter="osm"][aria-pressed="true"]');
  const osmChip = await gate.locator('.review-chip[data-filter="osm"]').innerText();
  const osmApi = (await (await asUser("rev", "/api/review/queue?filter=osm")).json()).summary.counts
    .osm;
  check(
    "review: the queue's « OSM » filter, its count the API's (none shown at 0), `?file=osm` kept",
    // The chips show a count only when it is not 0.
    osmChip.replace(/\s+/g, " ").trim() === (osmApi ? `OSM ${osmApi}` : "OSM"),
    `${osmChip.replace(/\n/g, " ")} / ${osmApi}`,
  );
  // « Journal », the activity feed (the « go » of 17/10): the gestures above under
  // « Administration », the account named, never a uuid.
  await gate.click('.review-tab[data-tab="journal"]');
  await gate.waitForSelector("#review-journal .review-feed-item");
  await gate.click('#review-journal .review-chip[data-type="admin"]');
  await gate.waitForFunction(() => window.location.search.includes("type=admin"));
  await gate.waitForFunction(() =>
    [...document.querySelectorAll("#review-journal .review-feed-item")].every(
      (li) => li.dataset.source === "journal",
    ),
  );
  const journal = await gate.locator("#review-journal .review-feed").innerText();
  check(
    "review: « Journal » under « Administration », the account named, no uuid",
    journal.includes("a changé le rôle de gil : Contributeur → Relecteur") &&
      !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(journal),
    journal.replace(/\n/g, " | ").slice(0, 200),
  );
  // « Statistiques » (lot 4, the « go » of 17/10) against the real API: eight blocks (the
  // counters' four spans, then lot 4's questions), each an answer or the closed
  // publication's box, no count held back by a threshold (lot M: counts from the first one;
  // a computed value under its threshold says « peu de données », as this run's few entries
  // and accounts do); the map loads still 0 after this whole run (its browsers are driven:
  // navigator.webdriver, no hit), and said so.
  await gate.click('.review-tab[data-tab="statistiques"]');
  await gate.waitForSelector("#review-stats .review-stats-grid");
  const stats = await gate.evaluate(() =>
    [...document.querySelectorAll("#review-stats .review-stat")].map((b) => ({
      id: b.id,
      h2: b.querySelector("h2")?.textContent ?? "",
      said: Boolean(b.querySelector(".review-stat-answer, .review-stat-closed")),
      answer: b.querySelector(".review-stat-answer")?.textContent ?? "",
      low: b.querySelector(".review-stat-low")?.textContent ?? "",
      h1: document.activeElement?.tagName,
    })),
  );
  const hoursSaid = stats.find((b) => b.id === "review-stat-hours")?.answer ?? "";
  const lead = await gate.locator("#review-stats .review-stats-lead").innerText();
  check(
    "review: « Statistiques », eight blocks, each answered, no count marked low, 2 accounts « peu de données »; « jamais des personnes »; no map load counted from this driven run",
    stats.length === 8 &&
      stats.map((b) => b.id.replace("review-stat-", "")).join() ===
        "hours,days,weeks,months,queue,contributors,osm,hidden" &&
      stats.every((b) => b.said) &&
      stats.filter((b) => /-(hours|days|weeks|months|hidden)$/.test(b.id)).every((b) => !b.low) &&
      /^peu de données \(n\u00a0=\u00a0\d+\)$/.test(
        stats.find((b) => b.id === "review-stat-contributors")?.low ?? "",
      ) &&
      hoursSaid.startsWith("0 chargement de la carte en 24") &&
      lead.includes("jamais des personnes") &&
      stats[0].h1 === "H1",
    JSON.stringify(stats),
  );
  await entry.close();

  const violations = await desk.evaluate(() => window.__csp ?? []);
  check(
    "review: no Content-Security-Policy violation" +
      (proxyMode === "caddy" ? " behind the real site file" : " (node proxy: no policy sent)"),
    violations.length === 0 && (proxyMode !== "caddy" || revCsp.includes("script-src 'self'")),
    `${violations.join(" | ")} [${revCsp}]`,
  );

  // 6. "Ajouter une caméra" (phase "Ajouter"), after the review: its counts stay as they
  // were. Points of the CI extract (tests/fixtures/ci.osm.pbf): three facades with no
  // camera within 20 m, and one 2 m from the OSM camera n1925222797.
  const ADD = {
    full: [2.2403746, 48.8981364],
    alone: [2.2415777, 48.899896],
    offline: [2.2363862, 48.8969081],
    near: [2.2384104, 48.8967635],
    nearCamera: "n1925222797",
  };
  const adds = async () => (await review()).filter((c) => c.kind === "add");
  const onAdd = async (uuid) => (await review()).filter((c) => c.target === uuid);
  let loads = 0;
  const page6 = await context.newPage();
  // While offline by design, tile fetches fail (WebKit: "... due to access control checks").
  page6.on(
    "pageerror",
    (e) => !offline && pageErrors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`),
  );
  // The button: "＋ Ajouter", greyed below z17 (punk: below the street level, z15,
  // DECISIONS 2026-10-09); a tap there says "Zoomez pour ajouter" and opens nothing.
  await page6.goto(`${APP}?add=${++loads}#14.50/${ADD.full[1]}/${ADD.full[0]}`);
  await page6.waitForSelector("#fab-add:not([hidden])", { timeout: 60000 });
  const greyed = await page6
    .locator("#fab-add")
    .evaluate((b) => [b.textContent, b.getAttribute("aria-disabled")]);
  await tap(page6, page6.locator("#fab-add"));
  const zoomSaid = await page6.locator("#fab-add").innerText();
  const panelOpened = await page6.locator("#move-panel, #modify-panel").count();
  check(
    "add: « ＋ Ajouter » greyed below z17 (punk z15), a tap says « Zoomez pour ajouter », nothing opens",
    greyed[0] === "＋ Ajouter" &&
      greyed[1] === "true" &&
      zoomSaid === "Zoomez pour ajouter" &&
      !panelOpened,
    `${greyed} | ${zoomSaid}`,
  );
  {
    // Punk: active from the street level; a tap at z16.5 zooms to z17, then opens the add.
    await page6.evaluate(() => window.__map.jumpTo({ zoom: 16.5 }));
    await page6.waitForSelector("#fab-add:not([aria-disabled='true'])", { timeout: 20000 });
    await tap(page6, page6.locator("#fab-add"));
    await page6.waitForSelector("#modify-panel", { timeout: 20000 });
    const zoomed = await page6.evaluate(() => window.__map.getZoom());
    check(
      "add (punk): « ＋ Ajouter » active at z16.5, a tap zooms to z17 and opens the add",
      zoomed >= 16.99,
      `z=${zoomed}`,
    );
    await page6.keyboard.press("Escape");
    await page6.waitForTimeout(500);
  }

  let full;
  let alone;
  let beside;
  {
    // 6'. Punk (DECISIONS 2026-10-08): the add is « Modifier »'s component — the position
    // first (always free, its field once the pin stops), the duplicates within 5 m, then
    // the sheet, every line's choices under it (only the direction opens the map); nothing
    // leaves before « Envoyer », then the add and its answers in one queue transaction.
    const addAtP = async (pg, at, online = true) => {
      lastPage = pg;
      if (await pg.evaluate(() => Boolean(window.__map)).catch(() => false)) await idle(pg);
      if (online) await pg.goto(`${APP}?add=${++loads}#18.00/${at[1]}/${at[0]}`);
      await pg.waitForSelector("#fab-add:not([hidden]):not([aria-disabled='true'])", {
        timeout: 60000,
      });
      await tap(pg, pg.locator("#fab-add"));
      await ed.view(pg, "position");
      // The server's position at rest (an add not aimed draws no field: a short wait).
      if (online) await ed.fieldDrawn(pg, 2000);
    };
    /** « Ici », then past the duplicates if any: the sheet. */
    const here = async (pg) => {
      await tap(pg, pg.locator("#modify-here"));
      await pg.waitForSelector('#modify-panel:is([data-view="sheet"], [data-view="duplicates"])', {
        timeout: 20000,
      });
      if (await pg.locator("#add-other").count()) {
        await tap(pg, pg.locator("#add-other"));
        await ed.view(pg, "sheet");
      }
    };
    const values = (pg) =>
      pg
        .locator("#modify-panel .modify-line[data-field]")
        .evaluateAll((ls) =>
          Object.fromEntries(
            ls.map((l) => [l.dataset.field, l.querySelector(".modify-value")?.textContent]),
          ),
        );
    const opens = ed.unfolded;
    const allUnknown = async (pg) => {
      await tap(pg, ed.tile(pg, "unknown"));
      await tap(pg, ed.part(pg, "direction", "unknown"));
      await tap(pg, ed.part(pg, "height", "unknown"));
      await tap(pg, ed.part(pg, "operator", "unknown"));
    };
    const aimAndValidate = async (pg) => {
      await ed.aimOpen(pg);
      const b = await ed.aim(pg);
      await tap(pg, pg.locator("#aim-submit"));
      await ed.view(pg, "sheet");
      return b;
    };
    const height = async (pg, h) => {
      await tap(pg, ed.part(pg, "height", h));
    };

    // 6a'. A complete add: a dome, aimed, at the first floor, public.
    await addAtP(page6, ADD.full);
    const onPosition = {
      choices: await page6.locator(".part-choice, #move-panel").count(),
      locate: await page6.locator("#fab-locate").isVisible(),
      cross: await page6.locator("#edit-float").getAttribute("aria-label"),
      title: await page6.locator("#modify-title").innerText(),
    };
    if (process.env.SMOKE_SHOTS)
      await page6.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-add-position.png`) });
    await here(page6);
    const empty = await values(page6);
    const emptyPressed = await page6
      .locator('#modify-panel [aria-pressed="true"]')
      .evaluateAll((bs) => bs.map((b) => b.dataset.answer));
    const emptyFirst = await page6
      .locator("#modify-panel :is(.modify-tiles, .modify-choices)")
      .evaluateAll((gs) => gs.map((g) => g.querySelector("button")?.dataset.answer));
    const place6 = await ed.place(page6);
    if (process.env.SMOKE_SHOTS)
      await page6.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-add-sheet.png`) });
    check(
      "add: the position first, a small map, no façade / libre, no « Me localiser »; then the sheet, its ticket naming the street and the commune from the tiles, every line's choices shown, each on « Je ne sais pas » (first, checked, said)",
      onPosition.choices === 0 &&
        !onPosition.locate &&
        onPosition.cross === "Abandonner cet ajout" &&
        /nouvelle caméra/i.test(onPosition.title) &&
        place6.title === "Boulevard de la Mission Marchand" &&
        place6.sub === "Position posée · Courbevoie" &&
        Object.values(empty).every((v) => v === "je ne sais pas") &&
        Object.keys(empty).join(",") === "shape,direction,mount,operator" &&
        (await opens(page6)).join(",") === "shape,direction,mount,operator" &&
        emptyPressed.join(",") === "unknown,unknown,unknown,unknown" &&
        emptyFirst.every((a) => a === "unknown"),
      JSON.stringify({ onPosition, place6, empty, emptyPressed, emptyFirst }),
    );
    const tiles = await page6
      .locator("#modify-panel .modify-tile")
      .evaluateAll((bs) => bs.map((b) => b.dataset.answer));
    await tap(page6, ed.tile(page6, "dome"));
    const bearing6 = await aimAndValidate(page6);
    await height(page6, "first");
    await tap(page6, ed.part(page6, "operator", "public"));
    // The names around, under the line once a class is chosen.
    await page6
      .waitForSelector('#modify-panel [data-row="operator"] [data-operator]', { timeout: 20000 })
      .catch(() => {});
    const offered = await page6.locator("#modify-panel [data-operator]").count();
    if (offered) await tap(page6, page6.locator("#modify-panel [data-operator]").first());
    const firstRecap = await values(page6);
    // A big ball: no direction, no height (their lines without choices, their answers
    // gone); a dome again: both asked again.
    await tap(page6, ed.tile(page6, "ptz"));
    const ball = { values: await values(page6), opens: await opens(page6) };
    // The rule comes with the build's meta (rules/questions.yaml height.modify_excludes): an
    // extract built before it offers every kind a height.
    const noBallHeight = await page6.evaluate(async () => {
      const meta = await (await fetch("/tiles/meta.json")).json();
      return (meta.participation.questions.height_excluded_kinds ?? []).includes("ptz");
    });
    await tap(page6, ed.tile(page6, "dome"));
    const again = await values(page6);
    await aimAndValidate(page6);
    await height(page6, "first");
    const last = await values(page6);
    check(
      "add: tiles « Je ne sais pas », dome, tube, big ball, multi-dome; a dome's height; the big ball drops the direction and the height, the dome brings them back (on « Je ne sais pas »)",
      tiles.join(",") === "unknown,dome,bullet,ptz,multidome" &&
        firstRecap.shape === "Petit dôme" &&
        /^\d+° · /.test(firstRecap.direction ?? "") &&
        firstRecap.mount === EDIT_FIRST &&
        ball.values.direction === "toutes (motorisée)" &&
        (noBallHeight
          ? ball.values.mount === "—" &&
            ball.opens.join(",") === "shape,operator" &&
            again.mount === "je ne sais pas"
          : ball.opens.join(",") === "shape,mount,operator") &&
        again.direction === "je ne sais pas" &&
        last.mount === EDIT_FIRST,
      JSON.stringify({ noBallHeight, tiles, firstRecap, ball, again, last }),
    );
    if (process.env.SMOKE_SHOTS)
      await page6.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-add-send.png`) });
    const beforeSend = (await adds()).length;
    check(
      "add: nothing leaves before « Envoyer »",
      beforeSend === 0 && offered > 0 && bearing6 !== null,
      `${beforeSend} adds, ${offered} names, bearing ${bearing6}`,
    );
    await ed.send(page6);
    await ed.finish(page6);
    await waitFor("the add and its answers", async () => (await adds()).length === 1);
    full = (await adds())[0];
    await waitFor("its four answers", async () => (await onAdd(full.uuid)).length === 4);
    const answers = await onAdd(full.uuid);
    const ghostAdd = await ghostShown(page6, { camera: full.camera });
    check(
      "add: the author's ghost shows right after « Envoyer », the map untouched",
      ghostAdd.shown,
      JSON.stringify(ghostAdd),
    );
    check(
      "add: complete — free, the camera's id from its uuid, four answers on it (a dome's height too)",
      full.camera === `c${full.uuid.replaceAll("-", "").slice(0, 12)}` &&
        full.payload.placement === "free" &&
        full.payload.pulled === false &&
        full.osm_type === null &&
        answers.every((a) => a.camera === full.camera && a.osm_type === null) &&
        new Set(answers.map((a) => a.kind)).size === 4 &&
        answers.find((a) => a.kind === "shape")?.answer === "dome" &&
        answers.find((a) => a.kind === "height")?.answer === "first",
      JSON.stringify(answers.map((a) => [a.kind, a.answer])),
    );

    // 6b'. « Je ne sais pas » everywhere, untouched (checked by default, DECISIONS
    // 2026-10-09): said on the sheet, the add leaves alone, as an untouched line did before
    // (a tap on « Je ne sais pas » sends it, for the statistics).
    await addAtP(page6, ADD.alone);
    await here(page6);
    const unknownRecap = await values(page6);
    await ed.send(page6);
    await ed.finish(page6);
    await waitFor("the add with « je ne sais pas »", async () => (await adds()).length === 2);
    alone = (await adds()).find((c) => c.uuid !== full.uuid);
    check(
      "add: every line left on « Je ne sais pas », said on the sheet, stored free with no answer",
      alone.payload.placement === "free" &&
        (await onAdd(alone.uuid)).length === 0 &&
        Object.values(unknownRecap).every((v) => /je ne (sais|vois) pas/.test(v)),
      JSON.stringify(unknownRecap),
    );

    // 6c'. Duplicates: a camera of the map 2 m away is listed; a tap opens its sheet and
    // sends nothing; « Non, c'en est une autre » goes on, the camera kept in `near`.
    await addAtP(page6, ADD.near);
    await tap(page6, page6.locator("#modify-here"));
    await ed.view(page6, "duplicates");
    const dupes = await page6
      .locator(".modify-duplicate")
      .evaluateAll((bs) => bs.map((b) => b.dataset.camera));
    check("add: duplicates list the camera 2 m away", dupes.includes(ADD.nearCamera), `${dupes}`);
    await tap(page6, page6.locator(`.modify-duplicate[data-camera='${ADD.nearCamera}']`));
    await page6.waitForFunction(
      () =>
        [...document.querySelectorAll(".participate button")].some(
          (b) => b.textContent === "Toujours là ?",
        ),
      null,
      { timeout: 20000 },
    );
    const focused = await page6.evaluate(() =>
      JSON.stringify(window.__map.getFilter("camera-selected")),
    );
    check(
      "add: a listed camera opens its sheet, nothing sent",
      focused.includes(String(1925222797 * 3)) && (await adds()).length === 2,
      focused.slice(0, 80),
    );
    await addAtP(page6, ADD.near);
    await here(page6);
    await allUnknown(page6);
    await ed.send(page6);
    await ed.finish(page6);
    await waitFor("the add beside a camera", async () => (await adds()).length === 3);
    beside = (await adds()).find((c) => ![full.uuid, alone.uuid].includes(c.uuid));
    check(
      "add: « Non, c'en est une autre » sends, the camera kept in near",
      beside.payload.near.includes(ADD.nearCamera),
      JSON.stringify(beside.payload.near),
    );

    // 6c''. Abandoned after an answer: asked first, nothing leaves.
    const beforeAbandon = (await adds()).length;
    await addAtP(page6, [ADD.full[0], ADD.full[1] + 0.0004]); // ~45 m north
    await here(page6);
    await tap(page6, ed.tile(page6, "dome"));
    await tap(page6, page6.locator("#modify-panel .modify-head .modify-close"));
    await page6.waitForSelector("#modify-abandon");
    const asked = await page6.locator(".part-abandon").innerText();
    await tap(page6, page6.locator("#modify-abandon"));
    await page6.waitForFunction(() => !document.getElementById("modify-panel"));
    await page6.waitForTimeout(1500);
    const queuedAfter = await page6.locator("#queue-count").isVisible();
    check(
      "add: abandoned after an answer, asked first, nothing sent nor queued",
      asked.includes("Abandonner cet ajout ?") &&
        (await adds()).length === beforeAbandon &&
        !queuedAfter,
      asked.replace(/\n/g, " / "),
    );

    // 6d'. Offline: the add and its answers wait on the phone, then leave, the add first.
    await idle(page6);
    await page6.goto(`${APP}?add=${++loads}#18.00/${ADD.offline[1]}/${ADD.offline[0]}`);
    await page6.waitForSelector("#fab-add:not([hidden]):not([aria-disabled='true'])", {
      timeout: 60000,
    });
    await idle(page6);
    offline = true;
    await context.setOffline(true);
    await addAtP(page6, ADD.offline, false);
    await here(page6);
    await tap(page6, ed.tile(page6, "bullet"));
    // « Je ne vois pas » on the direction's map.
    await ed.aimOpen(page6);
    await tap(page6, page6.locator("#modify-not-visible"));
    await ed.view(page6, "sheet");
    // A tube: the height, then its tilt on the line under it (« Je ne sais pas » both).
    await height(page6, "unknown");
    await tap(page6, ed.part(page6, "tilt", "unknown"));
    await tap(page6, ed.part(page6, "operator", "unknown"));
    await ed.send(page6);
    await page6
      .waitForFunction(() =>
        /6 en attente/.test(document.getElementById("queue-count").textContent),
      )
      .catch(() => {});
    const waiting = await page6.locator("#queue-count").innerText();
    await ed.finish(page6);
    const ghostQueued = await ghostShown(page6, { near: ADD.offline });
    check(
      "add: offline, its ghost shows from the queue, the map untouched",
      ghostQueued.shown,
      JSON.stringify(ghostQueued),
    );
    check(
      "add: offline, the add and its five answers (a tube: its height and tilt) wait on the phone",
      waiting.includes("6 en attente"),
      waiting,
    );
    await context.setOffline(false);
    await page6.waitForFunction(() => document.getElementById("queue-count").hidden, null, {
      timeout: 45000,
    });
    const ghostSent = await ghostShown(page6, { near: ADD.offline });
    check(
      "add: once sent on reconnect, its ghost stays, the map untouched",
      ghostSent.shown,
      JSON.stringify(ghostSent),
    );
    await idle(page6);
    offline = false;
    const queued = (await adds()).find(
      (c) => ![full.uuid, alone.uuid, beside.uuid].includes(c.uuid),
    );
    const queuedShape = queued ? await onAdd(queued.uuid) : [];
    check(
      "add: offline, sent on reconnect, its answer on it",
      queued !== undefined && queuedShape.length === 1 && queuedShape[0].answer === "bullet",
      `${queued?.camera} ${queuedShape.map((a) => a.answer)}`,
    );

    // 6e'. « Multi-boules » (DECISIONS 2026-10-23): its sticker on the pin, « Nombre de
    // boules » under the shape (« Je ne sais pas », 2 to the build's max), no direction
    // asked (all around), a height; sent with dome_count 3, then with « Je ne sais pas »
    // (no dome_count). The second send's answer says what the API says to someone who
    // publishes on OSM (`osm: "kept"`, added here to the real API's answer, as
    // smoke-score.mjs adds `will_publish`): the scene says it stays on Surveillance World.
    {
      const before = (await adds()).map((c) => c.uuid);
      const multiAdd = async (at, count) => {
        await addAtP(page6, at);
        await here(page6);
        await tap(page6, ed.tile(page6, "multidome"));
        const seen = {
          counts: await page6
            .locator('#modify-panel [data-row="count"] .modify-chip[data-part="count"]')
            .evaluateAll((bs) => bs.map((b) => b.dataset.answer)),
          pressed: await page6
            .locator('#modify-panel [data-row="count"] .modify-chip[aria-pressed="true"]')
            .evaluateAll((bs) => bs.map((b) => b.dataset.answer)),
          rows: await page6
            .locator("#modify-panel .modify-row[data-row]")
            .evaluateAll((rs) => rs.map((r) => r.dataset.row)),
          // The pin wears the tile's sticker (the same drawing, icons.ts cameraCanvas).
          pin: await page6.evaluate(() => {
            const pin = document.querySelector("#edit-pin canvas.edit-pin-picto");
            const tile = document.querySelector('.modify-tile[data-answer="multidome"] canvas');
            return Boolean(pin && tile && pin.toDataURL() === tile.toDataURL());
          }),
        };
        await tap(page6, ed.part(page6, "count", count));
        seen.value = await ed.value(page6, "count");
        seen.direction = await ed.value(page6, "direction");
        await height(page6, "first");
        return seen;
      };
      const three = await multiAdd([ADD.full[0], ADD.full[1] + 0.0004], "3");
      await ed.send(page6);
      await ed.finish(page6);
      // The add arrives first, its answers after it; past ana's writes_per_minute
      // (rules/participation.yaml) they wait on the phone for the queue's next try.
      const newAdd = async () => (await adds()).find((c) => !before.includes(c.uuid));
      const shapeOn = async (add) =>
        add ? (await onAdd(add.uuid)).find((a) => a.kind === "shape") : undefined;
      await waitFor(
        "the multi-dome with 3 domes",
        async () => Boolean(await shapeOn(await newAdd())),
        150000,
      ).catch(() => {});
      const add3 = await newAdd();
      const shape3m = await shapeOn(add3);
      check(
        "add: « Multi-boules », its sticker; « Nombre de boules » « Je ne sais pas », 2 to 6 under the shape, no direction (all around), a height; sent with dome_count 3",
        three.pin &&
          three.counts.join(",") === "unknown,2,3,4,5,6" &&
          three.pressed.join(",") === "unknown" &&
          three.rows.join(",") === "shape,count,direction,mount,operator" &&
          three.value === "3 boules" &&
          three.direction === "toutes (plusieurs boules)" &&
          shape3m?.answer === "multidome" &&
          shape3m?.dome_count === 3,
        JSON.stringify({ three, shape: shape3m }),
      );
      // « Je ne sais pas »: the answer leaves without a number; the API's `osm: "kept"`.
      const sentBodies = [];
      await page6.route("**/api/contributions", async (route) => {
        const body = route.request().postDataJSON();
        sentBodies.push(body);
        const real = await route.fetch();
        const answer = await real.json().catch(() => ({}));
        const kept = body?.kind === "shape" && body.answer === "multidome" && !body.dome_count;
        return route.fulfill({
          response: real,
          json: kept ? { ...answer, osm: "kept", osm_reason: "multidome_count_unknown" } : answer,
        });
      });
      const dunno = await multiAdd([ADD.full[0] + 0.0006, ADD.full[1] + 0.0004], "unknown");
      await ed.send(page6);
      const keptLine = await page6
        .waitForSelector("#modify-done .score-kept", { timeout: 15000 })
        .then((e) => e.textContent())
        .catch(() => null);
      if (process.env.SMOKE_SHOTS)
        await page6.screenshot({
          path: join(process.env.SMOKE_SHOTS, `${engine}-multidome-kept.png`),
        });
      await ed.finish(page6);
      await page6.unroute("**/api/contributions");
      // This add's shape (the first one's may still leave in the same flush).
      const shapeSent = sentBodies.find((b) => b.kind === "shape" && b.camera !== add3?.camera);
      check(
        "add: « Multi-boules » with « Je ne sais pas » leaves without dome_count; the API's « kept » said under the scene",
        dunno.value === "je ne sais pas" &&
          shapeSent?.answer === "multidome" &&
          !("dome_count" in shapeSent) &&
          keptLine ===
            "Sans le nombre de boules, cette réponse reste sur Surveillance World : elle ne sera pas publiée sur OpenStreetMap.",
        JSON.stringify({ dunno, shapeSent, keptLine }),
      );
    }
    await idle(page6);
    await page6.close();
  }

  // 6e. Seen from another account: a pale pictogram; a tap opens "En attente de
  // validation" with "Je confirme" / "Ce n'est pas ça".
  const bobAdd = await phone("bob");
  const pageB = await bobAdd.newPage();
  lastPage = pageB;
  pageB.on("pageerror", (e) => pageErrors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  await pageB.goto(`${APP}?add=${++loads}#18.50/${ADD.alone[1]}/${ADD.alone[0]}`);
  await pageB.waitForFunction(
    // Right after goto: the map may not exist yet (a slower machine), not a failure.
    () => window.__map?.querySourceFeatures("proposal-moves").some((f) => f.properties.a === 1),
    null,
    { timeout: 30000 },
  );
  await idle(pageB);
  const ghost = await pageB.evaluate(() => {
    const m = window.__map;
    const g = m.querySourceFeatures("proposal-moves").find((f) => f.properties.a === 1);
    const p = m.project(g.geometry.coordinates);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await pageB.touchscreen.tap(ghost.x, ghost.y);
  await pageB.waitForSelector(".sheet-picto.pending", { timeout: 20000 });
  const sheetText = await pageB.locator("#sheet").innerText();
  check(
    "add: another account sees it pending, without its author",
    sheetText.includes("En attente de validation") && !sheetText.includes("ana"),
    sheetText.slice(0, 120),
  );
  // Framed above the sheet without leaving a padding on the map: a padding left there was
  // subtracted again by the next framing, and a commune tapped after it stayed under its
  // sheet (main.ts openPending).
  await idle(pageB);
  const framed = await pageB.evaluate(() => {
    const m = window.__map;
    const pad = m.getPadding();
    const g = m.querySourceFeatures("proposal-moves").find((f) => f.properties.a === 1);
    const y = m.project(g.geometry.coordinates).y + m.getCanvas().getBoundingClientRect().top;
    const sheet = document.querySelector("#sheet").getBoundingClientRect().top;
    return {
      pad: [pad.top, pad.bottom, pad.left, pad.right],
      y: Math.round(y),
      sheet: Math.round(sheet),
    };
  });
  check(
    "add: a pending add's sheet frames it above the sheet, no padding left on the map",
    framed.pad.every((v) => v === 0) && framed.y < framed.sheet,
    JSON.stringify(framed),
  );
  await tap(pageB, pageB.locator("button[data-opinion='agree']"));
  await waitFor("bob's agreement", async () =>
    (await adds()).some((c) => c.uuid === alone.uuid && c.agree === 1),
  );
  check("add: confirmed from another account", true);
  await idle(pageB);
  await bobAdd.close();

  // 6f. /revue: the adds in « Tout », each row « Ajout · … »; the complete one's view
  // decides the add with its author's answers (one table); the one beside a camera names
  // it by its kind and distance, no id. Then the same on a phone: rows within the screen,
  // the camera's view with its decision bar fixed at the bottom, clear of the content.
  await desk.goto(`${APP}revue?file=all`);
  await desk.waitForSelector(".review-row", { timeout: 60000 });
  const addRows = (await rowsOf(desk)).filter((l) => /^c[0-9a-f]{12}$/.test(l.camera));
  await desk.locator(`.review-row[data-camera="${full.camera}"]`).click();
  await desk.waitForSelector(`#review-camera[data-camera="${full.camera}"] .review-diff`);
  const underFull = (await desk.locator(".review-diff tbody tr").count()) - 1;
  await desk.goBack();
  await desk.waitForSelector(`.review-row[data-camera="${beside.camera}"]`);
  await desk.locator(`.review-row[data-camera="${beside.camera}"]`).click();
  await desk.waitForSelector(`#review-camera[data-camera="${beside.camera}"] .review-decide`);
  const nearText = await desk.locator("#review-camera .review-decide").innerText();
  check(
    "add: /revue lists the adds as « Ajout », the complete one's answers in its table, the camera within 10 m named by its kind and distance",
    addRows.length >= 4 &&
      addRows.every((l) => l.text.startsWith("Ajout")) &&
      underFull === 4 &&
      /À [\d,]+ m : .+ déjà sur la carte/.test(nearText) &&
      !nearText.includes("n1925222797"),
    `${addRows.length} adds, ${underFull} answers with the complete one, "${nearText.replace(/\n/g, " | ").slice(0, 160)}"`,
  );
  if (process.env.SMOKE_SHOTS)
    await desk.screenshot({
      path: join(process.env.SMOKE_SHOTS, `${engine}-revue-adds.png`),
      fullPage: true,
    });
  const revPhone = await browser.newContext({
    ...devices["iPhone 14"],
    httpCredentials: { username: "rev", password: PW },
  });
  const pocket = await revPhone.newPage();
  pocket.on("pageerror", (e) => pageErrors.push(String(e)));
  await pocket.goto(`${APP}revue?file=all`);
  await pocket.waitForSelector(".review-row", { timeout: 60000 });
  if (process.env.SMOKE_SHOTS)
    await pocket.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-revue-phone.png`) });
  const rows = await pocket.evaluate(() => {
    const ls = [...document.querySelectorAll(".review-row")];
    const w = document.documentElement.clientWidth;
    const big = (s) =>
      [...document.querySelectorAll(s)].every((e) => e.getBoundingClientRect().height >= 44);
    return {
      n: ls.length,
      fit: ls.every((l) => l.getBoundingClientRect().right <= w + 0.5),
      scroll: document.documentElement.scrollWidth <= w,
      tall: ls.every((l) => l.getBoundingClientRect().height >= 44),
      targets: big(".review-chip") && big(".review-search") && big(".review-top button"),
    };
  });
  await tap(pocket, pocket.locator(".review-row").first());
  await pocket.waitForSelector(".review-foot .review-bar button");
  if (process.env.SMOKE_SHOTS) {
    await reviewMapIdle(pocket);
    await pocket.screenshot({
      path: join(process.env.SMOKE_SHOTS, `${engine}-revue-window-phone.png`),
    });
  }
  const cam = await pocket.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const foot = document.querySelector(".review-foot").getBoundingClientRect();
    const main = document.getElementById("review-camera");
    const kids = [...main.querySelectorAll(".review-info > *")];
    const last = kids[kids.length - 1]?.getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".review-bar button, .review-back")];
    return {
      fixed: Math.abs(foot.bottom - window.innerHeight) < 1,
      clear: last ? last.bottom <= foot.top + 0.5 : false,
      targets: buttons.every((b) => b.getBoundingClientRect().height >= 44),
      scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });
  if (process.env.SMOKE_SHOTS)
    await pocket.screenshot({
      path: join(process.env.SMOKE_SHOTS, `${engine}-revue-window-phone-end.png`),
    });
  await tap(pocket, pocket.locator(".review-back"));
  await pocket.waitForSelector(".review-row");
  check(
    "review on a phone: rows within the screen, 44 px targets, the camera's bar fixed at the bottom clear of the content, back to the queue",
    rows.n > 0 &&
      rows.fit &&
      rows.scroll &&
      rows.tall &&
      rows.targets &&
      cam.fixed &&
      cam.clear &&
      cam.targets &&
      cam.scroll,
    JSON.stringify({ ...rows, ...cam }),
  );
  await revPhone.close();

  // 7. "Me localiser" follows the position, and "on site" comes from it: true near the
  // camera with a precise position, unknown when it is imprecise, false when farFix; the help
  // line says what to do, and the map follows until it is dragged.
  const [camLon, camLat] = fx.at;
  const nearFix = { longitude: camLon + 0.0003, latitude: camLat, accuracy: 15 }; // ~22 m
  const located = await browser.newContext({
    ...devices["iPhone 14"],
    httpCredentials: { username: "ana", password: PW },
    geolocation: nearFix,
    permissions: ["geolocation"],
  });
  const page7 = await located.newPage();
  page7.on("pageerror", (e) => pageErrors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  const verifyOnSite = async (answer) => {
    const known = new Set((await review()).map((c) => c.uuid));
    await openCamera(page7, fx);
    await tap(page7, button(page7, "Toujours là ?"));
    const help = page7.locator(".part-onsite-help");
    const before = (await help.isVisible()) ? await help.innerText() : "";
    if (process.env.SMOKE_SHOTS && answer === "Elle est là") {
      await help.scrollIntoViewIfNeeded();
      await page7.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-onsite-help.png`) });
    }
    await tap(page7, help.locator("button"));
    await page7.waitForTimeout(1500);
    const after = (await help.isVisible()) ? await help.innerText() : "";
    await tap(page7, button(page7, answer));
    await page7.waitForSelector(".part-done");
    let row;
    await waitFor("the verify stored", async () => {
      row = (await review()).find((c) => !known.has(c.uuid) && c.author === "ana");
      return row !== undefined;
    });
    return { before, after, onSite: row.on_site };
  };
  const precise = await verifyOnSite("Elle est là");
  check(
    "on site: help line until located, then true near the camera with a precise position",
    precise.before.includes("Activez « Me localiser »") &&
      precise.after === "" &&
      precise.onSite === true,
    JSON.stringify(precise),
  );
  await located.setGeolocation({ ...nearFix, accuracy: 500 });
  const vague = await verifyOnSite("Je ne sais pas");
  check(
    "on site: unknown with a position 500 m wide, and the help line says so",
    vague.after.includes("précision insuffisante") && vague.onSite === null,
    JSON.stringify(vague),
  );
  const farFix = { longitude: camLon + 0.004, latitude: camLat, accuracy: 10 }; // ~290 m
  await located.setGeolocation(farFix);
  const away = await verifyOnSite("Je ne sais pas");
  check("on site: false 290 m away", away.onSite === false, JSON.stringify(away));

  // Tracking: started from the help line, the dot shows without following; a tap follows,
  // the map moves with the position; a drag stops following, the dot still moves; a tap
  // follows again; a tap in "Suivi" turns it off.
  const fab = page7.locator("#fab-locate");
  const state = async () => ({
    locate: await fab.getAttribute("data-locate"),
    label: await fab.innerText(),
    ...(await page7.evaluate(() => {
      const m = window.__map;
      const dot = m.querySourceFeatures("me")[0]?.geometry.coordinates ?? null;
      const at = dot && m.project(dot);
      const canvas = m.getCanvas();
      return {
        dot,
        // Where the dot is drawn, and the canvas's size: following keeps the dot at one
        // point, the middle of the part the panels leave free (locate.ts recentre, by an
        // offset: the map's own centre is not the position).
        px: at && [Math.round(at.x), Math.round(at.y)],
        size: [canvas.clientWidth, canvas.clientHeight],
        circle: m.querySourceFeatures("me-accuracy").length,
        center: [m.getCenter().lng, m.getCenter().lat],
      };
    })),
  });
  const off = (a, b) => (a && b ? metres(a, b) : Infinity);
  // The dot's source is tiled in a worker and the map eases to it: the state read once
  // `ok` holds (or after 15 s, to be reported), never after a fixed delay.
  const settled = async (ok) => {
    const t0 = Date.now();
    let s = await state();
    while (!ok(s) && Date.now() - t0 < 15000) {
      await page7.waitForTimeout(200);
      s = await state();
    }
    return s;
  };
  // Punk: on a phone the floating buttons slide away while a sheet is open (DECISIONS
  // 2026-10-09): the sheet closed first, « Me localiser » comes back.
  if (await page7.locator("#sheet").isVisible()) {
    await tap(page7, page7.locator("#sheet .close"));
    await page7.waitForTimeout(600);
  }
  // Punk: 8a's tickets after the answer hide them too (score.css): put away first.
  if (await page7.locator("#score").count()) {
    await page7.keyboard.press("Escape");
    await page7.waitForTimeout(400);
  }
  let st = await state();
  check(
    "locate: started from the help line, the dot and its circle, no follow",
    st.locate === "free" && st.label === "Recentrer" && st.circle > 0,
    JSON.stringify(st),
  );
  await tap(page7, fab);
  // Followed: the dot centred across, well inside the screen top to bottom.
  const followed = (s) =>
    s.locate === "follow" &&
    s.label === "Suivi" &&
    off(s.dot, [farFix.longitude, farFix.latitude]) < 1 &&
    s.px !== null &&
    Math.abs(s.px[0] - s.size[0] / 2) <= 2 &&
    s.px[1] > s.size[1] * 0.15 &&
    s.px[1] < s.size[1] * 0.85;
  st = await settled(followed);
  const anchor = st.px;
  const onAnchor = (s) =>
    s.px !== null && anchor !== null && Math.hypot(s.px[0] - anchor[0], s.px[1] - anchor[1]) <= 2;
  if (process.env.SMOKE_SHOTS)
    await page7.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-locate-follow.png`) });
  // Nothing floats over the followed dot: the map's canvas at its centre and 12 px around.
  const covered = await page7.evaluate(() => {
    const m = window.__map;
    const dot = m.querySourceFeatures("me")[0]?.geometry.coordinates;
    if (!dot) return ["no dot"];
    const p = m.project(dot);
    const box = m.getCanvas().getBoundingClientRect();
    const out = [];
    for (const [dx, dy] of [
      [0, 0],
      [12, 0],
      [-12, 0],
      [0, 12],
      [0, -12],
    ]) {
      const e = document.elementFromPoint(box.left + p.x + dx, box.top + p.y + dy);
      if (e !== m.getCanvas()) out.push(`${e?.tagName}#${e?.id}.${e?.className}`);
    }
    return out;
  });
  check("locate: nothing covers the followed dot", covered.length === 0, covered.join(", "));
  check("locate: a tap follows (Suivi), the map on the position", followed(st), JSON.stringify(st));
  const walk = { ...farFix, longitude: farFix.longitude + 0.0008 }; // ~58 m further
  await located.setGeolocation(walk);
  // The map moves with the dot: the dot stays where it was drawn.
  const walked = (s) => off(s.dot, [walk.longitude, walk.latitude]) < 1 && onAnchor(s);
  st = await settled(walked);
  check("locate: walking, the dot and the map move together", walked(st), JSON.stringify(st));
  // Drag from a point where the map itself is under the finger: the punk phone's
  // attribution inset rides over the map above the sheet (18a), and a drag that starts on
  // it does not move the map.
  const dragFrom = await page7.evaluate(() => {
    const canvas = window.__map.getCanvas();
    for (let y = 160; y < 520; y += 20)
      if (
        document.elementFromPoint(120, y) === canvas &&
        document.elementFromPoint(220, y) === canvas
      )
        return { x: 120, y };
    return { x: 120, y: 300 };
  });
  await slide(page7, located, dragFrom, { x: dragFrom.x + 100, y: dragFrom.y });
  await page7.waitForTimeout(500);
  const dragged = await state();
  const walk2 = { ...walk, latitude: walk.latitude + 0.0005 }; // ~56 m north
  await located.setGeolocation(walk2);
  st = await settled((s) => off(s.dot, [walk2.longitude, walk2.latitude]) < 1);
  if (process.env.SMOKE_SHOTS)
    await page7.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-locate-free.png`) });
  check(
    "locate: a drag stops following (Recentrer), the dot still moves, the map stays",
    dragged.locate === "free" &&
      st.label === "Recentrer" &&
      off(st.dot, [walk2.longitude, walk2.latitude]) < 1 &&
      off(st.center, dragged.center) < 1,
    JSON.stringify({ dragged: dragged.locate, ...st }),
  );
  await tap(page7, fab);
  const refollowed = (s) =>
    s.locate === "follow" && off(s.dot, [walk2.longitude, walk2.latitude]) < 1 && onAnchor(s);
  st = await settled(refollowed);
  check("locate: a tap recentres and follows again", refollowed(st), JSON.stringify(st));
  await tap(page7, fab);
  const stopped = (s) =>
    s.locate === "off" && s.label === "Me localiser" && s.dot === null && s.circle === 0;
  st = await settled(stopped);
  check(
    "locate: a tap in Suivi turns it off, dot and circle gone",
    stopped(st),
    JSON.stringify(st),
  );
  await idle(page7);
  await located.close();

  // 8. Withdrawing one's own pending contribution: a proposal from its sheet, an opinion,
  // an add (its sheet closes), one still on the phone (never sent), and from "Vos
  // contributions". Withdrawn rows stay on the server, out of the lists.
  const withdrawn = async () => (await reviewList("?status=withdrawn")).contributions;
  const ctx8 = await phone("ana");
  const page8 = await ctx8.newPage();
  lastPage = page8;
  page8.on("pageerror", (e) => !offline && pageErrors.push(`${e.message}`));
  const gone = { camera: ADD.nearCamera, at: ADD.near };
  let known8 = new Set((await review()).map((c) => c.uuid));
  await openCamera(page8, gone);
  await tap(page8, button(page8, "Toujours là ?"));
  await tap(page8, button(page8, "Je ne la trouve pas"));
  await tap(page8, page8.locator(".part-btn.armed"));
  await page8.waitForSelector(".part-done");
  let notFound;
  await waitFor("the not-found stored", async () => {
    notFound = (await review()).find((c) => !known8.has(c.uuid) && c.camera === gone.camera);
    return notFound !== undefined;
  });
  await openCamera(page8, gone);
  await page8.waitForSelector(".part-proposal .part-withdraw", { timeout: 20000 });
  if (process.env.SMOKE_SHOTS)
    await page8.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-withdraw.png`) });
  await tap(page8, page8.locator(".part-withdraw"));
  const armedText = await page8.locator(".part-withdraw").innerText();
  await tap(page8, page8.locator(".part-withdraw"));
  await waitFor("the proposal withdrawn", async () =>
    (await withdrawn()).some((c) => c.uuid === notFound.uuid),
  );
  await page8
    .waitForFunction(() => document.querySelector(".part-proposal")?.hidden !== false, null, {
      timeout: 10000,
    })
    .catch(() => {});
  const blockGone = await page8.evaluate(
    () => document.querySelector(".part-proposal")?.hidden !== false,
  );
  check(
    "withdraw: « Retirer ma proposition » in two steps, withdrawn on the server, out of the sheet",
    armedText.includes("confirmer") && blockGone,
    armedText,
  );

  // An opinion: bob takes back his agreement with ana's position-only add.
  const ctxBob = await phone("bob");
  const pageBob = await ctxBob.newPage();
  lastPage = pageBob;
  pageBob.on("pageerror", (e) => pageErrors.push(`${e.message}`));
  await pageBob.goto(`${APP}?cam=${alone.camera}&w=1#18.50/${ADD.alone[1]}/${ADD.alone[0]}`);
  await pageBob.waitForSelector(".part-proposal .part-withdraw", { timeout: 30000 });
  const said = await pageBob.locator(".part-proposal").innerText();
  await tap(pageBob, pageBob.locator(".part-withdraw"));
  await tap(pageBob, pageBob.locator(".part-withdraw"));
  await waitFor("bob's agreement withdrawn", async () =>
    (await adds()).some((c) => c.uuid === alone.uuid && c.agree === 0),
  );
  check("withdraw: an opinion, « Retirer mon avis »", said.includes("je confirme"), said);
  await idle(pageBob);
  await ctxBob.close();

  // An add: its own sheet, the sheet closes and the ghost goes.
  lastPage = page8;
  await idle(page8);
  await page8.goto(`${APP}?cam=${alone.camera}&w=2#18.50/${ADD.alone[1]}/${ADD.alone[0]}`);
  await page8.waitForSelector(".part-proposal .part-withdraw", { timeout: 30000 });
  await tap(page8, page8.locator(".part-withdraw"));
  await tap(page8, page8.locator(".part-withdraw"));
  await waitFor("the add withdrawn", async () =>
    (await withdrawn()).some((c) => c.uuid === alone.uuid),
  );
  await page8.waitForFunction(() => document.getElementById("sheet").hidden, null, {
    timeout: 10000,
  });
  const ghostAfter = await ghostShown(page8, { camera: alone.camera, absent: true });
  check(
    "withdraw: an add from its sheet, the sheet closes, no ghost left",
    !ghostAfter.shown && !(await adds()).some((c) => c.uuid === alone.uuid),
    JSON.stringify(ghostAfter),
  );

  // Still on the phone: withdrawn from "Vos contributions", never sent.
  await idle(page8);
  await openCamera(page8, gone);
  known8 = new Set([...(await review()), ...(await withdrawn())].map((c) => c.uuid));
  offline = true;
  await ctx8.setOffline(true);
  await tap(page8, button(page8, "Toujours là ?"));
  await tap(page8, button(page8, "Elle est là"));
  await page8.waitForSelector(".part-done");
  // The counter sits under an open sheet: closed first (punk on site: the sheet is gone,
  // 8a's tickets fall over the map; put away).
  if (await page8.locator("#score").count()) await page8.keyboard.press("Escape");
  else await tap(page8, page8.locator("#sheet .close"));
  await tap(page8, page8.locator("#queue-count"));
  await page8.waitForSelector("#mine [data-withdraw]");
  if (process.env.SMOKE_SHOTS)
    await page8.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-mine-queued.png`) });
  await tap(page8, page8.locator("#mine [data-withdraw]").first());
  await tap(page8, page8.locator("#mine [data-withdraw]").first());
  await page8.waitForFunction(() => document.getElementById("queue-count").hidden, null, {
    timeout: 10000,
  });
  // The counter hides before the list is drawn again (a race seen once in CI, WebKit punk):
  // wait for the line to change, then read it (the check below still fails if it never does).
  await page8
    .waitForFunction(
      () => /retirée/.test(document.querySelector("#mine li")?.textContent ?? ""),
      null,
      {
        timeout: 10000,
      },
    )
    .catch(() => {});
  const queuedLine = await page8.locator("#mine li").first().innerText();
  await ctx8.setOffline(false);
  await page8.waitForTimeout(3000);
  await idle(page8);
  offline = false;
  const sentAnyway = [...(await review()), ...(await withdrawn())].filter(
    (c) => !known8.has(c.uuid),
  );
  check(
    "withdraw: one still on the phone leaves the queue and is never sent",
    queuedLine.includes("retirée") && sentAnyway.length === 0,
    `${queuedLine} | ${sentAnyway.length} sent`,
  );

  // Sent and pending: withdrawn from "Vos contributions".
  await page8.locator("#mine .close").tap();
  await openCamera(page8, gone);
  await tap(page8, button(page8, "Toujours là ?"));
  await tap(page8, button(page8, "Elle est là"));
  await page8.waitForSelector(".part-done");
  let present;
  await waitFor("the verify stored", async () => {
    present = (await review()).find((c) => !known8.has(c.uuid));
    return present !== undefined;
  });
  await openCamera(page8, gone); // the sheet thanked; its idle state has the link
  await tap(page8, button(page8, "Vos contributions"));
  const row8 = page8.locator(`#mine [data-withdraw="${present.uuid}"]`);
  await row8.waitFor({ timeout: 20000 });
  await tap(page8, row8);
  await tap(page8, row8);
  await waitFor("the verify withdrawn", async () =>
    (await withdrawn()).some((c) => c.uuid === present.uuid),
  );
  check("withdraw: a sent verification from « Vos contributions »", true);
  await idle(page8);
  await ctx8.close();

  // 9. "Hauteur et inclinaison" (phase D3), last: the review's counts above stay as they
  // were. On an existing tube without height (the CI fixture made a dome a tube), each
  // answer leaves at once: the height, then the tilt, sent with the height chosen; the
  // sheet of the tube whose height and tilt applied; and an add of a tube with
  // « ‹ Retour », « Je ne sais pas » dropping the tilt, and the summary.
  const ctx9 = await phone("ana");
  const page9 = await ctx9.newPage();
  lastPage = page9;
  page9.on("pageerror", (e) => !offline && pageErrors.push(`${e.message}`));
  // A settled map first: WebKit can capture the canvas before its next frame.
  const shot9 = async (name) => {
    if (!process.env.SMOKE_SHOTS) return;
    await idle(page9);
    await page9.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-${name}.png`) });
  };
  const known9 = new Set((await review()).map((c) => c.uuid));
  {
    // Punk: « Modifier » on a tube whose height is assumed: its « Hauteur » line unfolded
    // (4a-f4's tickets), its « Inclinaison » on the line under it, answered in place, sent
    // at once.
    await openD2(page9, d2.tube);
    await tap(page9, page9.locator("#part-modify"));
    await ed.view(page9, "sheet");
    const label9 = await page9
      .locator('#modify-panel [data-field="mount"] .modify-label')
      .innerText();
    const tickets9 = await page9
      .locator('#modify-panel :is([data-row="mount"], [data-row="tilt"]) .modify-chip[data-part]')
      .evaluateAll((bs) => bs.map((b) => `${b.dataset.part}:${b.dataset.answer}`));
    await tap(page9, ed.part(page9, "height", "first"));
    const stays = await page9.locator('#modify-panel[data-view="sheet"]').count();
    await shot9("modify-mount");
    await tap(page9, ed.part(page9, "tilt", "slight"));
    const value9 = `${await ed.value(page9, "mount")} · ${await ed.value(page9, "tilt")}`;
    await ed.send(page9);
    let sent9;
    await waitFor("the height and the tilt stored", async () => {
      sent9 = (await review()).filter((c) => !known9.has(c.uuid));
      return sent9.length === 2;
    });
    const t9 = sent9.find((c) => c.kind === "tilt");
    check(
      "modify: a tube's assumed « Hauteur » unfolded, its « Inclinaison » on the line under it, answered in place, one send; the tilt carries the height, its field stored",
      label9 === "Hauteur" &&
        tickets9.join(",") ===
          "height:unknown,height:ground,height:first,height:upper," +
            "tilt:unknown,tilt:horizon,tilt:slight,tilt:steep" &&
        stays === 1 &&
        value9 === `${EDIT_FIRST} · un peu vers le bas` &&
        sent9.some((c) => c.kind === "height" && c.answer === "first") &&
        t9?.answer === "slight" &&
        t9.payload.aim_height === "first" &&
        (t9.payload.bands?.features.length ?? 0) > 0 &&
        new Set(sent9.map((c) => c.batch)).size === 1,
      JSON.stringify({
        label9,
        tickets9,
        stays,
        value9,
        sent: sent9.map((c) => [c.kind, c.answer]),
      }),
    );
    await ed.finish(page9);
  }

  // The sheet of the tube the fixture gave a height (on site) and a tilt.
  await openD2(page9, d2.mounted);
  const sheet9 = await page9.locator("#sheet").innerText();
  await page9
    .locator("#sheet :is(.chip-value, .fact dd)", { hasText: "un peu vers le bas" })
    .scrollIntoViewIfNeeded();
  await shot9("sheet-mount");
  // The punk sheet (lot 3.2, 17a) writes the source and the month in the row's tag (« sur
  // place · 10/26 », « réponse · 10/26 »), the value alone.
  const rows9 = await page9.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("#sheet .facts > .fact")].map((r) => [
        r.querySelector("dt")?.firstChild?.nodeValue?.trim(),
        {
          tag: r.querySelector(".chip-tag")?.className ?? "",
          month: r.querySelector(".chip-tag")?.innerText ?? "",
          value: r.querySelector("dd")?.innerText ?? "",
        },
      ]),
    ),
  );
  check(
    "mount: the sheet says the height's class and the tilt's, never degrees",
    Object.keys(rows9).length
      ? rows9.Hauteur?.tag.includes("site") &&
          rows9.Hauteur.value.includes(FIRST) &&
          /10\/26/.test(rows9.Hauteur.month) &&
          rows9.Inclinaison?.tag.includes("answer") &&
          rows9.Inclinaison.value.includes("un peu vers le bas") &&
          /10\/26/.test(rows9.Inclinaison.month) &&
          !/\d+ ?°/.test(rows9.Inclinaison.value)
      : sheet9.includes("1er étage (≈ 4 m), d'après une réponse sur place (octobre 2026)") &&
          sheet9.includes("un peu vers le bas, d'après une réponse (octobre 2026)") &&
          !/\d+ ?°/.test(sheet9.split("Inclinaison")[1]?.split("\n")[1] ?? ""),
    Object.keys(rows9).length
      ? JSON.stringify({ Hauteur: rows9.Hauteur, Inclinaison: rows9.Inclinaison })
      : sheet9
          .split("\n")
          .filter((l) => /Hauteur|Inclinaison|étage|vers/.test(l))
          .join(" / "),
  );
  {
    // « Modifier » on that tube: its height and tilt known, their lines folded; a tap on
    // « Hauteur » unfolds it alone, in place, nothing to send yet.
    await tap(page9, page9.locator("#part-modify"));
    await ed.view(page9, "sheet");
    const foldedAtFirst = await page9
      .locator("#modify-panel button.modify-line[aria-expanded='false']")
      .evaluateAll((ls) => ls.map((l) => l.dataset.field));
    await ed.unfold(page9, "mount");
    const afterTap = await ed.unfolded(page9);
    const focusedOn = await page9.evaluate(() => document.activeElement?.dataset.part);
    const nothing = await page9.locator("#modify-send").isDisabled();
    // A line with a value shows it, not « Je ne sais pas »; « Je ne sais pas » there sends
    // nothing and leaves the value (DECISIONS 2026-10-09).
    const pressedOf = (part) =>
      page9
        .locator(`#modify-panel .modify-chip[data-part="${part}"][aria-pressed="true"]`)
        .evaluateAll((bs) => bs.map((b) => b.dataset.answer));
    const ownHeight = await pressedOf("height");
    await ed.unfold(page9, "tilt");
    const ownTilt = await pressedOf("tilt");
    const valueBefore = await ed.value(page9, "mount");
    await tap(page9, ed.part(page9, "height", "unknown"));
    const dunnoHeight = await pressedOf("height");
    const valueAfter = await ed.value(page9, "mount");
    const stillNothing = await page9.locator("#modify-send").isDisabled();
    check(
      "modify: a known height and tilt show their own choice pressed; « Je ne sais pas » on the height is heard, sends nothing and keeps the value",
      ownHeight.join(",") === "first" &&
        ownTilt.join(",") === "slight" &&
        dunnoHeight.join(",") === "unknown" &&
        valueAfter === valueBefore &&
        !/je ne sais pas/.test(valueAfter ?? "") &&
        stillNothing,
      JSON.stringify({ ownHeight, ownTilt, dunnoHeight, valueBefore, valueAfter, stillNothing }),
    );
    check(
      "modify: what the camera knows folded (its height and tilt); a tap unfolds that line alone, in place, the focus on its first choice",
      foldedAtFirst.includes("mount") &&
        foldedAtFirst.includes("tilt") &&
        afterTap.includes("mount") &&
        !afterTap.includes("tilt") &&
        focusedOn === "height" &&
        nothing,
      JSON.stringify({ foldedAtFirst, afterTap, focusedOn, nothing }),
    );
    await tap(page9, page9.locator("#modify-panel .modify-head .modify-close"));
    await page9.waitForFunction(() => !document.getElementById("modify-panel"));
  }

  // An add of a tube: the screen after the direction, « ‹ Retour », « Je ne sais pas ».
  const MOUNT_AT = [ADD.offline[0], ADD.offline[1] + 0.0004];
  let addsBefore;
  {
    // Punk: a tube placed, aimed by a tap, its height and tilt in one view; « Je ne sais
    // pas » for the height keeps the tilt line (it waits for a height: said under it);
    // the page never scrolls and the paper reaches the bottom.
    await page9.goto(`${APP}?add9=1#18.00/${MOUNT_AT[1]}/${MOUNT_AT[0]}`);
    await page9.waitForSelector("#fab-add:not([hidden]):not([aria-disabled='true'])", {
      timeout: 60000,
    });
    await tap(page9, page9.locator("#fab-add"));
    await ed.view(page9, "position");
    await ed.fieldDrawn(page9, 2000);
    await tap(page9, page9.locator("#modify-here"));
    await page9.waitForSelector('#modify-panel:is([data-view="sheet"], [data-view="duplicates"])', {
      timeout: 20000,
    });
    if (await page9.locator("#add-other").count()) await tap(page9, page9.locator("#add-other"));
    await ed.view(page9, "sheet");
    await tap(page9, ed.tile(page9, "bullet"));
    await ed.aimOpen(page9);
    const layout9 = await page9.evaluate(() => {
      const p = document.getElementById("modify-panel").getBoundingClientRect();
      const vv = window.visualViewport;
      return {
        scrollY: Math.round(window.scrollY + document.documentElement.scrollTop),
        gap: Math.round((vv ? vv.height + vv.offsetTop : window.innerHeight) - p.bottom),
      };
    });
    const bearing9 = await ed.aim(page9);
    const cone9 = await ed.fieldDrawn(page9);
    await shot9("add-direction-panel");
    check(
      "panel: the page never scrolls, the paper reaches the bottom; a tap aims, its field drawn",
      layout9.scrollY === 0 && layout9.gap === 0 && bearing9 !== null && cone9,
      JSON.stringify({ layout9, bearing9, cone9 }),
    );
    await tap(page9, page9.locator("#aim-submit"));
    await ed.view(page9, "sheet");
    const mountTilt = async () =>
      `${await ed.value(page9, "mount")} · ${await ed.value(page9, "tilt")}`;
    await tap(page9, ed.part(page9, "height", "unknown"));
    // The tilt's own note (the operator's search has notes of its own).
    const note9 = await page9.locator('#modify-panel [data-row="tilt"] .modify-note').count();
    await tap(page9, ed.part(page9, "tilt", "slight"));
    const unknownHeight = await mountTilt();
    await tap(page9, ed.part(page9, "height", "first"));
    const kept = await ed.part(page9, "tilt", "slight").getAttribute("aria-pressed");
    const both = await mountTilt();
    await tap(page9, ed.part(page9, "operator", "unknown"));
    await shot9("add-recap");
    check(
      "mount, add: the tilt's line waits for a height (said), the answers kept; the sheet has both",
      note9 === 1 &&
        unknownHeight === "je ne sais pas · un peu vers le bas" &&
        kept === "true" &&
        both === `${EDIT_FIRST} · un peu vers le bas`,
      JSON.stringify({ note9, unknownHeight, kept, both }),
    );
    addsBefore = new Set((await adds()).map((c) => c.uuid));
    await ed.send(page9);
    await ed.finish(page9);
  }
  let add9;
  await waitFor("the tube's add", async () => {
    add9 = (await adds()).find((c) => !addsBefore.has(c.uuid));
    return add9 !== undefined;
  });
  let on9;
  await waitFor("its answers (blank ones aside)", async () => {
    on9 = await onAdd(add9.uuid);
    return on9.length === 4;
  });
  const tilt9 = on9.find((c) => c.kind === "tilt");
  check(
    "mount, add: sent with the add — shape, direction, height, tilt (with the kind, bearing and height chosen)",
    on9.find((c) => c.kind === "height")?.answer === "first" &&
      tilt9?.answer === "slight" &&
      Number.isInteger(tilt9.payload.aim_direction) &&
      tilt9.payload.aim_kind === "fixed" &&
      tilt9.payload.aim_height === "first",
    JSON.stringify(on9.map((c) => [c.kind, c.answer, c.payload.aim_kind, c.payload.aim_height])),
  );
  // Its proposed field follows its open answers (aimed, 1er étage, un peu vers le bas: a
  // sector with a blind zone, not the default camera's full circle stored with the add),
  // on the map and in the sheet once its ghost is tapped. Areas in square degrees: only
  // their ratio is read.
  const area9 = (fs) =>
    fs
      .filter((f) => f.properties.b === 1)
      .flatMap((f) =>
        f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates,
      )
      .reduce((sum, rings) => {
        const ring = (r) =>
          r.reduce((a, [x, y], i) => a + x * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y, 0) / 2;
        return sum + Math.abs(ring(rings[0])) - rings.slice(1).reduce((h, r) => h + Math.abs(ring(r)), 0);
      }, 0); // biome-ignore format: compact
  const stored9 = add9.payload.bands?.features ?? [];
  const proposals9 = await (await asUser("ana", `/api/proposals?camera=${add9.camera}`)).json();
  const answered9 =
    proposals9.features.find((f) => f.properties.k === "add")?.properties.bands?.features ?? [];
  await page9.goto(`${APP}?load9=1#18.50/${MOUNT_AT[1]}/${MOUNT_AT[0]}`);
  await page9.waitForFunction(
    (c) => window.__map?.querySourceFeatures("proposal-moves").some((f) => f.properties.c === c),
    add9.camera,
    { timeout: 30000 },
  );
  await idle(page9);
  const ghost9 = await page9.evaluate((c) => {
    const m = window.__map;
    const g = m.querySourceFeatures("proposal-moves").find((f) => f.properties.c === c);
    const p = m.project(g.geometry.coordinates);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, add9.camera);
  await page9.touchscreen.tap(ghost9.x, ghost9.y);
  await page9.waitForSelector(".sheet-picto.pending", { timeout: 20000 });
  await page9
    .waitForFunction(() => window.__map.querySourceFeatures("proposal-field").length > 0, null, {
      timeout: 20000,
    })
    .catch(() => {});
  const drawn9 = await page9.evaluate(
    () => window.__map.querySourceFeatures("proposal-field").length,
  );
  await shot9("add-ghost-field");
  check(
    "add: a pending add's field follows its answers (a sector, not the full circle), drawn when its ghost is tapped",
    answered9.length > 0 && area9(answered9) < 0.6 * area9(stored9) && drawn9 > 0,
    JSON.stringify({ stored: area9(stored9), answered: area9(answered9), drawn9 }),
  );
  await idle(page9);
  await ctx9.close();

  // /revue on a phone: the add and its answers validated in one tap, then « Changer la
  // décision » in two steps, validated -> rejected; nothing on a withdrawn one.
  const ctx9r = await phone("rev");
  const rev9 = await ctx9r.newPage();
  lastPage = rev9;
  const add9Rows = () => [add9.uuid, ...on9.map((c) => c.uuid)];
  const status9 = async () => {
    const rows = await review();
    return add9Rows().map((u) => rows.find((c) => c.uuid === u)?.status);
  };
  await rev9.goto(`${APP}revue?camera=${add9.camera}&file=all`);
  await rev9.waitForSelector(`#review-camera[data-camera="${add9.camera}"] .review-diff`, {
    timeout: 60000,
  });
  const table9 = await rev9.locator(".review-diff tbody tr").count();
  await tap(rev9, rev9.locator('[data-action="validated"]'));
  await waitFor("the add and its answers validated", async () =>
    (await status9()).every((s) => s === "validated"),
  );
  await rev9.goto(`${APP}revue?camera=${add9.camera}&file=all`);
  const line9 = rev9.locator(`#review-details li.review-decided[data-uuid="${add9.uuid}"]`);
  await line9.waitFor({ timeout: 20000 });
  const change1 = await line9.locator(".decide-change").getAttribute("data-to");
  await line9.locator(".decide-change").scrollIntoViewIfNeeded();
  if (process.env.SMOKE_SHOTS)
    await rev9.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-revue-change-0.png`) });
  // Centred: at the screen's foot it would lie under the fixed decision bar.
  const centre = (l) => l.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await centre(line9.locator(".decide-change"));
  await tap(rev9, line9.locator(".decide-change"));
  const armed9 = await line9.locator(".decide-change.armed").innerText();
  if (process.env.SMOKE_SHOTS)
    await rev9.screenshot({ path: join(process.env.SMOKE_SHOTS, `${engine}-revue-change.png`) });
  await centre(line9.locator(".decide-change.armed"));
  await tap(rev9, line9.locator(".decide-change.armed"));
  await waitFor("the add rejected with its answers", async () =>
    (await status9()).every((s) => s === "rejected"),
  );
  await rev9.waitForSelector(
    `#review-details li.review-decided[data-uuid="${add9.uuid}"][data-status="rejected"]`,
  );
  const change2 = await line9.locator(".decide-change").getAttribute("data-to");
  const withdrawnButtons = await rev9.locator("#review-details .review-withdrawn button").count();
  check(
    "review: an add validated with its answers in one tap; « Changer la décision » in two steps, validated -> rejected (its answers with it), then back to validated offered",
    table9 === 5 && change1 === "rejected" && /Rejeter : confirmer/i.test(armed9) &&
      change2 === "validated" && withdrawnButtons === 0,
    JSON.stringify({ table9, change1, armed9, change2, withdrawnButtons }),
  ); // biome-ignore format: compact
  await ctx9r.close();

  await Promise.all(consoleRead);
  check("no page or console errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  const unexpected = failedRequests.filter(
    (r) => !/internal error|cancelled|ERR_INTERNET|aborted/i.test(r),
  );
  check(
    "no unexpected failed request",
    unexpected.length === 0,
    unexpected.slice(0, 3).join(" ; "),
  );
} catch (e) {
  const shot = join(tmp, "failure.png");
  await lastPage?.screenshot({ path: shot }).catch(() => {});
  const report = await failureReport(lastPage);
  writeFileSync(join(tmp, "failure.txt"), `${report}\n`);
  check(
    "run",
    false,
    `${e instanceof Error ? e.stack : String(e)}\n  screenshot: ${shot}\n${report}`,
  );
} finally {
  await browser?.close();
  for (const c of children) c.kill("SIGTERM");
}
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
