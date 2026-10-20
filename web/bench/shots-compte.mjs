// Captures for the author's stop point of the lot of 2026-10-11 (agent « compte »): « Compte »
// in board 28a's three frames (light, « retour d'OSM en échec », dark) at the boards' sizes
// (a phone 390×845, a wide screen 960×581, both at scale 2), and the camera sheet signed out
// with its greyed buttons (point 3) on a phone. The production build of the CI extract, the
// API answered by the page (bench/account.mjs mockApi: sign-in with OpenStreetMap on, on its
// test server; never openstreetmap.org). The failure frame is the page opened with
// `?osm=failed&osm_why=client_refuse` (the reason is not shown: no `?debug=1`); its
// `-debug` capture adds `?debug=1` (the reason under the band).
//   node bench/shots-compte.mjs --out DIR [--port N]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkit } from "playwright";
import { mockApi } from "./account.mjs";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { returning } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const OUT = arg("--out", null) && resolve(arg("--out"));
if (!OUT) {
  console.log("usage: node bench/shots-compte.mjs --out DIR [--port N]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const PORT = Number(arg("--port", "4197"));
const APP = `http://localhost:${PORT}/`;
// A street of the CI extract with cameras, as the smoke tests' (smoke-mobile.mjs STREET).
const STREET = [2.2377, 48.8977];
const AT = `#17.6/${STREET[1]}/${STREET[0]}`;
const SIZES = {
  phone: {
    viewport: { width: 390, height: 845 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  wide: { viewport: { width: 960, height: 581 }, deviceScaleFactor: 2 },
};

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = returning(await webkit.launch());
let failed = 0;

/** A page signed out, sign-in with OpenStreetMap on (test server), punk, `mode`. */
async function open(size, mode, query = "") {
  const context = await browser.newContext({ ...SIZES[size], locale: "fr-FR" });
  await mockApi(context, { osm: { login: true, server: "dev" } });
  const page = await context.newPage();
  await page.goto(`${APP}?ui=punk&mode=${mode}${query}${AT}`);
  await page.waitForFunction(() => window.__map?.loaded() && window.__map.areTilesLoaded(), null, {
    timeout: 60_000,
  });
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`wrote ${name}.png`);
}

try {
  for (const size of ["phone", "wide"]) {
    for (const [state, mode, query] of [
      ["clair", "clair", ""],
      ["echec", "clair", "&osm=failed&osm_why=client_refuse"],
      ["sombre", "sombre", ""],
    ]) {
      const { context, page } = await open(size, mode, query);
      if (state !== "echec") await page.locator("#account-square").click();
      await page.waitForSelector("#sheet .account-osm-key", { timeout: 15_000 });
      if (state === "echec")
        await page.waitForFunction(
          () => document.querySelector("#sheet .account-notice")?.textContent,
        );
      await shot(page, `compte-${state}-${size}`);
      await context.close();
    }
    const { context, page } = await open(
      size,
      "clair",
      "&osm=failed&osm_why=client_refuse&debug=1",
    );
    await page.waitForSelector("#sheet .account-why", { timeout: 15_000 });
    await shot(page, `compte-echec-debug-${size}`);
    await context.close();
  }
  // Point 3: a camera sheet signed out, its two buttons greyed, the line under them.
  {
    const { context, page } = await open("phone", "clair", "");
    const id = await page.evaluate(
      () =>
        window.__map
          .querySourceFeatures("detail", { sourceLayer: "cameras" })
          .map((c) => String(c.properties.id))
          .find((c) => /^[nwr]\d+$/.test(c)) ?? null,
    );
    await page.goto(`${APP}?ui=punk&mode=clair&cam=${id}${AT}`);
    await page.waitForSelector('#sheet #part-modify[aria-disabled="true"]', { timeout: 30_000 });
    // The buttons in view: the sheet at full height, its paper scrolled to them.
    await page.locator("#sheet .sheet-grab").click();
    await page.waitForTimeout(400);
    await page.evaluate(() =>
      document.getElementById("part-signin")?.scrollIntoView({ block: "center" }),
    );
    await shot(page, "sheet-signed-out-phone");
    await context.close();
  }
} catch (e) {
  failed++;
  console.log(`FAIL ${String(e).split("\n")[0]}`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
