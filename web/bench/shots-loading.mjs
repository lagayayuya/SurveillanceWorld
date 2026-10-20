// Captures of « Chargement » (board 2c; src/loading.ts) for the fidelity stop point, at the
// boards' sizes (phone 390 × 845, wide screen 960 × 581, scale 2), light and dark, at rest
// (reduced motion: the mockup's `still` drawing): the punk interface's first load (the
// map's tiles held), and the account's sheet on a return from OpenStreetMap (`?osm=signup`,
// GET /api/osm/signup held; bench/account.mjs's simulated API). The device has the punk
// fonts (a returning visit), so that its own faces are drawn. On the production build of the
// CI extract.
//   node bench/shots-loading.mjs [--out DIR] [--port N]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { mockApi, OSM_SIGNUP } from "./account.mjs";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { withUi } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const PORT = Number(arg("--port", "4622"));
const APP = `http://localhost:${PORT}/`;
const AT = "#16.5/48.8977/2.2377";
const OUT = resolve(arg("--out", resolve(WEB, "../build/shots/loading")));
mkdirSync(OUT, { recursive: true });
const SIZES = {
  phone: { ...devices["iPhone 14"], viewport: { width: 390, height: 845 }, deviceScaleFactor: 2 },
  wide: { viewport: { width: 960, height: 581 }, deviceScaleFactor: 2 },
};

async function shot(engine, size, dark, where) {
  const context = await engine.newContext({
    ...SIZES[size],
    locale: "fr-FR",
    colorScheme: dark ? "dark" : "light",
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("lacarte.fonts", "1");
    } catch {}
  });
  await mockApi(context, { osm: { login: true, signup: { ...OSM_SIGNUP } } });
  const never = new Promise(() => {});
  if (where === "first")
    await context.route(/\.pmtiles(\?|$)|\/tiles\/(?!meta\.json)/, () => never);
  else await context.route("**/api/osm/signup", () => never);
  const page = await context.newPage();
  if (where === "first") {
    await page.goto(`${APP}${AT}`);
    await page.waitForSelector("#loading");
  } else {
    await page.goto(`${APP}?osm=signup${AT}`);
    await page.waitForSelector('#sheet [data-account="waiting"] .loading');
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const file = resolve(
    OUT,
    `${where === "first" ? "first-load" : "account-sheet"}-${size}-${dark ? "dark" : "light"}.png`,
  );
  await page.screenshot({ path: file });
  console.log(file);
  await context.close();
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
// The phone in WebKit (an iPhone's engine), the wide screen in Chromium.
const engines = {
  phone: withUi(await webkit.launch(), "punk"),
  wide: withUi(await chromium.launch(), "punk"),
};
try {
  for (const where of ["first", "account"])
    for (const size of ["phone", "wide"])
      for (const dark of [false, true]) await shot(engines[size], size, dark, where);
} finally {
  for (const b of Object.values(engines)) await b.close();
  server.kill();
}
