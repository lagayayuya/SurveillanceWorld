// Captures for the theme work (redesign, phase 2): the same states in each mode, on a phone
// (WebKit, "iPhone 14") and a wide screen (Chromium 1440×900), with the map's style as JSON,
// so that a change can be proven not to move the map (identical style, identical pixels,
// bench/pixeldiff.mjs between two builds) and looked at in light and dark.
//   node bench/shots-theme.mjs [--region idf|ci] [--mode clair|sombre]
//     [--out DIR] [--only phone|desktop]
// Needs `npm run build` with the region's tiles in web/public (make web-assets REGION=idf),
// or LACARTE_DIST (bench/dist.mjs). /revue is not captured here (its states:
// states/catalogue.mjs).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const region = arg("--region", "idf");
requireTiles(region);
const mode = arg("--mode", null);
const only = arg("--only", null);
const OUT = resolve(arg("--out", "shots-theme"));
const PORT = 4184;
const APP = `http://localhost:${PORT}/`;
mkdirSync(OUT, { recursive: true });

const query = (extra = "") => {
  const q = new URLSearchParams(extra);
  if (mode) q.set("mode", mode);
  const s = q.toString();
  return s ? `?${s}` : "";
};

// name, query string, hash, then an optional action once the map is idle. IDF: Châtelet,
// a fixed camera in Paris, a dome without direction, a PTZ. CI extract (La Défense, no PTZ):
// a fixed camera, one a validated move placed, a dome without direction, and the one the
// fixture says a private individual installed.
const IDF_STATES = [
  ["map-z7-departements", "", "#7.60/48.80/2.35"],
  ["map-z10-communes", "", "#10.30/48.856/2.35"],
  ["map-z13-streets", "", "#12.60/48.8597/2.3485"],
  ["map-z14-portions", "", "#14.50/48.8597/2.3485"],
  ["map-z16-street", "", "#16.50/48.8597/2.3485"],
  ["map-z16-prudent", "est=prudent", "#16.50/48.8597/2.3485"],
  ["sheet-fixed", "cam=n13205053278", "#18/48.857247/2.361873"],
  ["sheet-dome-nodir", "cam=n5981573941", "#18/48.858637/2.347573"],
  ["sheet-ptz", "cam=n6229035257", ""],
  ["area-commune", "insee=75101", ""],
  ["area-departement", "insee=75", ""],
  ["filters-open", "", "#16.50/48.8597/2.3485", "filters"],
];
const CI_STATES = [
  ["map-z7-departements", "", "#7.60/48.89/2.23"],
  ["map-z10-communes", "", "#10.30/48.895/2.23"],
  ["map-z13-streets", "", "#12.60/48.8977/2.2377"],
  ["map-z14-portions", "", "#14.50/48.8977/2.2377"],
  ["map-z16-street", "", "#16.50/48.8977/2.2377"],
  ["map-z16-prudent", "est=prudent", "#16.50/48.8977/2.2377"],
  ["sheet-fixed", "cam=n1835838252", "#18/48.896952/2.239633"],
  ["sheet-moved", "cam=n1923568246", "#18/48.895741/2.239954"],
  ["sheet-dome-nodir", "cam=n5442645358", "#18/48.898154/2.237327"],
  ["sheet-household", "cam=n1864927349", "#18/48.897241/2.239254"],
  ["area-commune", "insee=92026", ""],
  ["area-departement", "insee=92", ""],
  ["filters-open", "", "#16.50/48.8977/2.2377", "filters"],
];
const STATES = region === "ci" ? CI_STATES : IDF_STATES;

async function idle(page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        window.__map.once("idle", r);
        window.__map.triggerRepaint();
        setTimeout(r, 4000);
      }),
  );
  await page.waitForTimeout(600);
}

/** The style with sorted keys, without the per-run parts (none today: kept as a hook). */
function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortedJson(value[k])]),
    );
  return value;
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));

const profiles = [
  ["phone", webkit, { ...devices["iPhone 14"] }],
  ["desktop", chromium, { viewport: { width: 1440, height: 900 } }],
].filter(([name]) => !only || only === name);

let failures = 0;
try {
  for (const [name, engine, options] of profiles) {
    const browser = await engine.launch();
    const context = await browser.newContext({
      ...options,
      colorScheme: mode === "sombre" ? "dark" : "light",
      reducedMotion: "reduce",
    });
    for (const [state, q, hash, action] of STATES) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${APP}${query(q)}${hash}`);
      await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 30000 });
      await idle(page);
      if (action === "filters") {
        if (name === "phone") await page.click("#fab-filters");
        await idle(page);
      }
      // A camera or area link that opened nothing would be captured as a bare map, the same
      // on both sides of a comparison: it fails instead.
      const wantsSheet = /\b(cam|insee)=/.test(q);
      const sheet = wantsSheet
        ? await page
            .waitForSelector("#sheet:not([hidden])", { timeout: 20000 })
            .then(() => true)
            .catch(() => false)
        : true;
      if (!sheet) errors.push("no sheet opened");
      await page.screenshot({ path: `${OUT}/${state}-${name}.png` });
      if (state === "map-z16-street") {
        const style = await page.evaluate(() => window.__map.getStyle());
        writeFileSync(`${OUT}/style-${name}.json`, JSON.stringify(sortedJson(style), null, 1));
      }
      if (errors.length) {
        failures++;
        console.log(`FAIL ${state}-${name}: ${errors.join(" | ")}`);
      } else console.log(`ok   ${state}-${name}`);
      await page.close();
    }
    await browser.close();
  }
} finally {
  server.kill();
}
process.exit(failures ? 1 : 0);
