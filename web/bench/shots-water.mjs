// Captures of the punk water over the fields (product owner, 2026-10-15): Bercy as the owner
// gave it (`#16.40/48.82509/2.39018`, « Standard » and « Prudent ») and the canal
// Saint-Martin (z17), on a phone (390 × 845, WebKit, scale 2), light and dark. Run once per
// build to compare (before, after): --label names the files.
//   node bench/shots-water.mjs [--label NAME] [--out DIR] [--port N] [--only SUBSTRING]
//   (default: <repository>/build/shots/water, never committed; NAME "current")
// Files: <label>-<place>-<mode>.png. Needs an IDF build: LACARTE_DIST (bench/dist.mjs), or
// web/dist with the IDF tiles.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("idf");
const label = arg("--label", "current");
const only = arg("--only", "");
const OUT = resolve(arg("--out", resolve(WEB, "../build/shots/water")));
const PORT = Number(arg("--port", 4480));
const APP = `http://127.0.0.1:${PORT}/`;
const PLACES = [
  { name: "bercy-standard", query: "", hash: "16.40/48.82509/2.39018" },
  { name: "bercy-prudent", query: "&est=prudent", hash: "16.40/48.82509/2.39018" },
  { name: "bercy-standard-z17", query: "", hash: "17/48.82509/2.39018" },
  { name: "canal-st-martin", query: "", hash: "17/48.87060/2.36530" },
  { name: "canal-st-martin-prudent", query: "&est=prudent", hash: "17/48.87060/2.36530" },
].filter((p) => p.name.includes(only));
mkdirSync(OUT, { recursive: true });

async function idle(page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        window.__map.once("idle", r);
        window.__map.triggerRepaint();
        setTimeout(r, 8000);
      }),
  );
  await page.waitForTimeout(800);
}

const server = spawn("npx", preview(PORT, "127.0.0.1"), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2000));
let failures = 0;
const browser = await webkit.launch();
try {
  for (const mode of ["clair", "sombre"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 845 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: mode === "sombre" ? "dark" : "light",
      reducedMotion: "reduce",
      locale: "fr-FR",
    });
    await context.addInitScript((m) => {
      try {
        localStorage.setItem("lacarte.mode", m);
        localStorage.setItem("lacarte.welcome", "1");
      } catch {
        // about:blank has no storage.
      }
    }, mode);
    for (const place of PLACES) {
      const name = `${label}-${place.name}-${mode}`;
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${APP}?${place.query.slice(1)}#${place.hash}`);
      await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 30000 });
      await idle(page);
      await page.screenshot({ path: resolve(OUT, `${name}.png`) });
      if (errors.length) {
        failures++;
        console.log(`FAIL ${name}: ${errors.join(" | ")}`);
      } else console.log(`ok   ${name}`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(`${failures ? "FAIL" : "ok"}: captures in ${OUT}`);
process.exit(failures ? 1 : 0);
