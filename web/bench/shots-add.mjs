// Captures of "Ajouter une caméra" (phase "Ajouter") on the CI extract, iPhone 14 profile:
// the button below and above its zoom, the position screen, the duplicates list, the sheet
// of a pending add (seen by its author and by another account), and the sheet of an add a
// build applied (cadd000010000, tests/fixtures/contrib-ci.jsonl).
//   node bench/shots-add.mjs [--browser webkit|chromium] [--out DIR] [--ui classique|punk]
// Needs `make build REGION=ci` (with the fixture in data/contrib/ci.jsonl) and `npm run
// build`. The API runs on a throwaway database (tests/apiserver.py) behind a Node proxy
// doing what the site file does; the account is the `who` cookie (default ana).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { sessionOf, withSession } from "./session.mjs";
import { uiArg, withUi } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
// The API loads data/build/ci (tests/apiserver.py): the map must show the same build.
requireTiles("ci", true);
const engine = arg("--browser", "webkit");
const OUT = resolve(arg("--out", "shots-add"));
const ROOT = resolve(import.meta.dirname, "../..");
const APP_PORT = 4292;
const STATIC_PORT = 4293;
const API_PORT = 8796;
const APP = `http://localhost:${APP_PORT}/`;
// Lat/lon: a facade with no camera within 20 m; 1.8 m from the OSM camera n1925222797;
// the add the CI build applied.
const FREE = "48.8981364/2.2403746";
const NEAR = "48.8967635/2.2384104";
const BUILT = { id: "cadd000010000", at: "48.8959569/2.2406947" };
const children = [];
const tmp = mkdtempSync(join(tmpdir(), "shots-add-"));
mkdirSync(OUT, { recursive: true });

const run = (cmd, argv, opts = {}) => {
  const p = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  children.push(p);
  p.stderr.on("data", (d) => process.env.SHOTS_VERBOSE && process.stderr.write(d));
  return p;
};
const waitFor = async (what, test, ms = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${what}`);
};
const up = async (url) => {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
};

async function start() {
  const fixtures = join(tmp, "fixtures.json");
  const api = run(
    "uv",
    ["run", "python", "tests/apiserver.py", "--region", "ci", "--port", String(API_PORT),
     "--origin", `http://localhost:${APP_PORT}`, "--review-user", "rev",
     "--fixtures", fixtures, "--reset"],
    { cwd: ROOT },
  ); // biome-ignore format: argv
  let ready = false;
  api.stdout.on("data", (d) => {
    if (String(d).includes("api ready")) ready = true;
  });
  await waitFor("the API", () => ready && existsSync(fixtures));
  run("npx", preview(STATIC_PORT, "127.0.0.1"), { cwd: WEB });
  await waitFor("vite preview", () => up(`http://127.0.0.1:${STATIC_PORT}/`));
  const signIn = (who) =>
    sessionOf(`http://127.0.0.1:${API_PORT}`, `http://localhost:${APP_PORT}`, who);
  http
    .createServer(async (req, res) => {
      const url = new URL(req.url, "http://x");
      const headers = { ...req.headers };
      let port = STATIC_PORT;
      if (url.pathname.startsWith("/api/")) {
        port = API_PORT;
        // Signed in as the `who` cookie's account (ana by default), through the API's
        // own sign-in (migration 014: no X-Author any more).
        const who = /(?:^|;\s*)who=([a-z]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "ana";
        headers.cookie = withSession(req.headers.cookie, await signIn(who));
      }
      const r = http.request(
        { host: "127.0.0.1", port, path: req.url, method: req.method, headers },
        (u) => {
          res.writeHead(u.statusCode, u.headers);
          u.pipe(res);
        },
      );
      r.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(r);
    })
    .listen(APP_PORT);
}

async function tap(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

async function phone(who) {
  const context = await browser.newContext({ ...devices["iPhone 14"] });
  await context.addCookies([{ name: "who", value: who, url: APP }]);
  return context.newPage();
}

/** The position screen at `at` (lat/lon), placement chosen, the server's pin at rest. */
let loads = 0;
async function position(page, at, placement) {
  // A query that changes: a new hash alone would not load the page again.
  await page.goto(`${APP}?load=${++loads}#18.00/${at}`);
  await page.waitForSelector("#fab-add:not([hidden]):not([aria-disabled='true'])", {
    timeout: 60000,
  });
  await tap(page, page.locator("#fab-add"));
  await page.waitForSelector("#move-panel");
  await tap(page, page.locator(`#move-panel button[data-placement='${placement}']`));
  await page.waitForSelector("#move-pin[data-source='server']", {
    state: "attached",
    timeout: 20000,
  });
  await page.waitForTimeout(1200);
}

let browser;
try {
  await start();
  browser = withUi(await (engine === "chromium" ? chromium : webkit).launch(), uiArg(args));
  const ana = await phone("ana");
  // 0. The button: below its zoom it says so, from z17 it adds.
  await ana.goto(`${APP}#16.40/${FREE}`);
  await ana.waitForSelector("#fab-add:not([hidden])", { timeout: 60000 });
  await ana.waitForTimeout(1500);
  await ana.screenshot({ path: join(OUT, "0a-button-zoom-in.png") });
  await ana.evaluate(() => window.__map.jumpTo({ zoom: 17.6 }));
  await ana.waitForTimeout(1500);
  await ana.screenshot({ path: join(OUT, "0b-button.png") });
  // 1. Position, on a facade.
  await position(ana, FREE, "facade");
  await ana.screenshot({ path: join(OUT, "1-position-facade.png") });
  console.log(
    "position:",
    await ana.evaluate(() => document.getElementById("move-status")?.textContent),
  );
  await tap(ana, ana.locator("#move-panel .part-btn.quiet:not(.part-onsite-locate)"));
  // 2. Next to a camera of the map: the duplicates list before anything leaves.
  await position(ana, NEAR, "free");
  await tap(ana, ana.locator("#move-submit"));
  await ana.waitForSelector("#move-panel[data-step='duplicates']");
  await ana.waitForTimeout(600);
  await ana.screenshot({ path: join(OUT, "2-duplicates.png") });
  // "Non, c'en est une autre": the add leaves, the questions follow (captured once).
  await tap(ana, ana.locator("#add-other"));
  await ana.waitForSelector("#complete-panel[data-step='shape']", { timeout: 20000 });
  await ana.waitForTimeout(1200);
  await ana.screenshot({ path: join(OUT, "3-questions-shape.png") });
  await tap(ana, ana.locator(".part-shape[data-answer='dome']"));
  await ana.waitForSelector("#complete-panel[data-step='direction']");
  await tap(ana, ana.locator("button[data-answer='not_visible']"));
  await ana.waitForSelector("#complete-panel[data-step='operator']");
  await tap(ana, ana.locator("button[data-answer='unknown']"));
  await ana.waitForSelector("#complete-panel[data-step='done']");
  await tap(ana, ana.locator("#complete-panel .part-btn.primary"));
  await ana.waitForFunction(() => !document.body.classList.contains("moving"));
  // 4. The pending add, seen by another account, then by its author.
  for (const [who, file] of [
    ["bob", "4a-pending-other.png"],
    ["ana", "4b-pending-author.png"],
  ]) {
    const page = who === "ana" ? ana : await phone(who);
    await page.goto(`${APP}?load=${++loads}#18.50/${NEAR}`);
    await page.waitForFunction(
      // Right after goto the map may not exist yet (seen in the gate): wait for it too.
      () =>
        window.__map?.querySourceFeatures("proposal-moves").some((f) => f.properties.a === 1) ===
        true,
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(1200);
    const at = await page.evaluate(() => {
      const m = window.__map;
      const g = m.querySourceFeatures("proposal-moves").find((f) => f.properties.a === 1);
      const p = m.project(g.geometry.coordinates);
      const r = m.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    });
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForSelector(".sheet-picto.pending", { timeout: 20000 });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(OUT, file) });
  }
  // 5. An add a build applied: its own sheet.
  await ana.goto(`${APP}?cam=${BUILT.id}#18.00/${BUILT.at}`);
  await ana.waitForSelector(".participate button", { state: "attached", timeout: 60000 });
  await ana.waitForTimeout(1500);
  await ana.screenshot({ path: join(OUT, "5-built-add-sheet.png") });
  // The whole sheet, down to its chips ("Position : ajoutée sur place (…)").
  for (let i = 0; i < 3 && (await ana.evaluate(() => document.body.dataset.sheet)) !== "full"; i++)
    await tap(ana, ana.locator(".sheet-grab"));
  await ana.waitForTimeout(800);
  await ana.evaluate(() =>
    document.querySelector("#sheet .chips")?.scrollIntoView({ block: "center" }),
  );
  await ana.waitForTimeout(500);
  await ana.screenshot({ path: join(OUT, "5b-built-add-chips.png") });
  console.log(`captures in ${OUT}`);
} finally {
  await browser?.close();
  for (const c of children) c.kill("SIGTERM");
}
process.exit(0);
