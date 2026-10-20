// The sheet of the participation silhouettes (src/participate/shapes.ts): every drawing of
// the shape, height and tilt screens at 96 and 40 px, black on white as the tiles draw
// them, to judge them side by side (phases "Retours terrain" and D3).
//   node --experimental-strip-types bench/shots-silhouettes.mjs [--browser webkit|chromium] [--out FILE]
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { OFFERED, SILHOUETTES, svgMarkup } from "../src/participate/shapes.ts";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const engine = arg("--browser", "webkit");
const OUT = resolve(arg("--out", "shots-silhouettes/silhouettes.png"));
mkdirSync(dirname(OUT), { recursive: true });

const groups = [
  ["Forme", OFFERED.map((k) => [k, SILHOUETTES.shape[k]])],
  ["Hauteur", Object.entries(SILHOUETTES.height)],
  ["Inclinaison", Object.entries(SILHOUETTES.tilt)],
];
const cell = (name, body) =>
  `<figure>${svgMarkup(body, 96)}${svgMarkup(body, 40)}<figcaption>${name}</figcaption></figure>`;
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 16px; font: 13px system-ui, sans-serif; color: #1d1d1d; background: #fff; }
  h2 { font-size: 14px; margin: 14px 0 6px; }
  .row { display: flex; gap: 14px; }
  figure { margin: 0; padding: 8px; border: 1px solid #ddd; border-radius: 8px;
           display: grid; grid-template-columns: 96px 40px; gap: 10px; align-items: end; }
  figcaption { grid-column: 1 / 3; color: #555; }
</style>${groups
  .map(
    ([title, items]) =>
      `<h2>${title}</h2><div class="row">${items.map(([n, b]) => cell(n, b)).join("")}</div>`,
  )
  .join("")}`;

const browser = await (engine === "chromium" ? chromium : webkit).launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(OUT);
