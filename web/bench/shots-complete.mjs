// Captures of the "Compléter" screens (phase D2) on the CI extract, iPhone 14 profile:
// the camera sheet with "Compléter", then the shape, direction and "who films" screens.
//   node bench/shots-complete.mjs [--browser webkit|chromium] [--out DIR] [--ui classique|punk] [--camera ID
//     --at LAT/LON] [--sheet-only: the camera's sheet alone]
// Needs `make build REGION=ci` and `npm run build`. The API runs on a throwaway database
// (tests/apiserver.py) behind a Node proxy doing what the site file does.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
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
const OUT = resolve(arg("--out", "shots"));
const CAMERA = arg("--camera", "n9622344410");
const AT = arg("--at", "48.897761/2.239971"); // lat/lon of the camera
const ROOT = resolve(import.meta.dirname, "../..");
const APP_PORT = 4290;
const STATIC_PORT = 4291;
const API_PORT = 8795;
const APP = `http://localhost:${APP_PORT}/`;
const children = [];
const tmp = mkdtempSync(join(tmpdir(), "shots-"));
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
        // Signed in as ana, through the API's own sign-in (migration 014: no X-Author).
        headers.cookie = withSession(req.headers.cookie, await signIn("ana"));
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
  return JSON.parse(readFileSync(fixtures, "utf8"));
}

async function tap(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

class Done extends Error {}
let browser;
try {
  await start();
  browser = withUi(await (engine === "chromium" ? chromium : webkit).launch(), uiArg(args));
  const context = await browser.newContext({ ...devices["iPhone 14"] });
  const page = await context.newPage();
  await page.goto(`${APP}?cam=${CAMERA}#18.00/${AT}`);
  await page.waitForSelector(
    args.includes("--sheet-only") ? ".participate button" : "#part-complete",
    {
      state: "attached",
      timeout: 60000,
    },
  );
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: join(OUT, args.includes("--sheet-only") ? `sheet-${CAMERA}.png` : "0-sheet.png"),
  });
  if (args.includes("--sheet-only")) throw new Done();
  // The whole sheet (full position) shows the three buttons together.
  await tap(page, page.locator("#part-complete"));
  await page.waitForSelector("#complete-panel[data-step='shape']");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, "1-shape.png") });
  const share = await page.evaluate(
    () => document.getElementById("complete-panel").offsetHeight / window.innerHeight,
  );
  console.log(`shape panel: ${Math.round(share * 100)} % of the screen height`);
  await tap(page, page.locator(".part-shape[data-answer='dome']"));
  await page.waitForSelector("#complete-panel[data-step='direction']");
  // Slide the map: the target 18 m north-east of the camera.
  await page.evaluate(() => {
    const m = window.__map;
    const c = m.getCenter();
    m.jumpTo({ center: [c.lng + 0.00018, c.lat + 0.00011] });
  });
  await page.waitForFunction(
    () => document.querySelector("#complete-panel")?.dataset.bearing,
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, "2-direction.png") });
  // Too close: "Valider" waits.
  const [lat, lon] = AT.split("/").map(Number);
  await page.evaluate((c) => window.__map.jumpTo({ center: c }), [lon, lat]);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, "2b-direction-too-close.png") });
  await tap(page, page.locator("button[data-answer='not_visible']"));
  await page.waitForSelector("#complete-panel[data-step='operator']");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, "3-operator.png") });
  await tap(page, page.locator("button[data-answer='public']"));
  await page.waitForSelector("button[data-operator]", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, "3b-operator-list.png") });
  // "‹ Changer": back to the three answers, nothing sent.
  await tap(page, page.locator("button[data-answer='change']"));
  await page.waitForSelector("button[data-answer='household']");
  await page.screenshot({ path: join(OUT, "3c-operator-changed.png") });
  console.log(`captures in ${OUT}`);
} catch (e) {
  if (!(e instanceof Done)) throw e;
} finally {
  await browser?.close();
  for (const c of children) c.kill("SIGTERM");
}
process.exit(0);
