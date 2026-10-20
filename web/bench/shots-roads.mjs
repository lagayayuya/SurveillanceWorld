// Captures of the punk basemap's roads and paths over the fields at Bercy, at the product
// owner's two places of 2026-10-15 (Cour Saint-Émilion in « Standard », the same in
// « Prudent », their centres kept, their zoom replaced): z15 – z19 on a phone (390 × 845,
// WebKit, scale 2), z17 on a wide screen (960 × 581, scale 2), light and dark; with the
// contrast of each basemap line drawn again above the fields (`-lifted`, layers.ts
// drawnBasemap) against each field level's pattern, its average colour (linear light: what
// the eye mixes at a distance). A curve's value is read at its last stop.
// Run once per build to compare (before, after): --label names the files.
//   node bench/shots-roads.mjs [--label NAME] [--out DIR] [--port N]
//   (default: <repository>/build/shots/roads, never committed; NAME "current")
// Files: <label>-<place>-z<z>-<mode>-<device>.png. Needs an IDF build: LACARTE_DIST
// (bench/dist.mjs), or web/dist with the IDF tiles.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("idf");
const label = arg("--label", "current");
const OUT = resolve(arg("--out", resolve(WEB, "../build/shots/roads")));
const PORT = Number(arg("--port", 4474));
const APP = `http://127.0.0.1:${PORT}/`;
/** Two places in Bercy: `#18.31/48.82642/2.39073` and `?est=prudent#17.79/48.82615/2.39061`. */
const PLACES = [
  { name: "standard", est: null, at: [48.82642, 2.39073] },
  { name: "prudent", est: "prudent", at: [48.82615, 2.39061] },
];
const DEVICES = {
  phone: {
    viewport: { width: 390, height: 845 },
    isMobile: true,
    hasTouch: true,
    zooms: [15, 16, 17, 18, 19],
  },
  wide: { viewport: { width: 960, height: 581 }, isMobile: false, hasTouch: false, zooms: [17] },
};
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

/** In the page: each field level's average colour and each lifted line's contrast on it. */
const contrasts = (page) =>
  page.evaluate(() => {
    const map = window.__map;
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const srgb = (v) =>
      Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
    };
    const parse = (c) => {
      const el = document.createElement("canvas").getContext("2d");
      el.fillStyle = c;
      const s = el.fillStyle; // #rrggbb or rgba(…)
      if (s.startsWith("#")) return [1, 3, 5].map((i) => Number.parseInt(s.slice(i, i + 2), 16));
      return s
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    };
    const value = (v) => {
      if (typeof v === "string" || typeof v === "number") return v;
      if (Array.isArray(v)) return value(v.at(-1));
      return null;
    };
    const fields = [1, 2, 3].map((lv) => {
      const name = map.getPaintProperty(`field-${lv}`, "fill-pattern");
      const img = map.style.getImage(name).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < img.data.length; i += 4)
        for (let k = 0; k < 3; k++) sum[k] += lin(img.data[i + k]);
      const n = img.data.length / 4;
      return { lv, average: sum.map((s) => srgb(s / n)) };
    });
    const out = { fields: fields.map((f) => ({ lv: f.lv, average: hex(f.average) })), lines: [] };
    const lifted = map
      .getStyle()
      .layers.filter((l) => l.id.endsWith("-lifted") && !l.id.includes("casing"))
      .map((l) => l.id);
    for (const id of lifted) {
      const colour = value(map.getPaintProperty(id, "line-color"));
      if (typeof colour !== "string") continue;
      const c = parse(colour);
      out.lines.push({ id, colour: hex(c), on: fields.map((f) => ratio(c, f.average)) });
    }
    return out;
  });

const server = spawn("npx", preview(PORT, "127.0.0.1"), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2000));
let failures = 0;
const numbers = {};
const browser = await webkit.launch();
try {
  for (const mode of ["clair", "sombre"]) {
    for (const [device, d] of Object.entries(DEVICES)) {
      const context = await browser.newContext({
        viewport: d.viewport,
        deviceScaleFactor: 2,
        isMobile: d.isMobile,
        hasTouch: d.hasTouch,
        colorScheme: mode === "sombre" ? "dark" : "light",
        reducedMotion: "reduce",
        locale: "fr-FR",
      });
      await context.addInitScript((m) => {
        try {
          localStorage.setItem("lacarte.ui", "punk");
          localStorage.setItem("lacarte.mode", m);
          localStorage.setItem("lacarte.welcome", "1");
        } catch {
          // about:blank has no storage.
        }
      }, mode);
      for (const place of PLACES)
        for (const z of d.zooms) {
          const name = `${label}-${place.name}-z${z}-${mode}-${device}`;
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e)));
          const [lat, lng] = place.at;
          await page.goto(
            `${APP}?ui=punk${place.est ? `&est=${place.est}` : ""}#${z}/${lat}/${lng}`,
          );
          await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 30000 });
          await idle(page);
          await page.screenshot({ path: resolve(OUT, `${name}.png`) });
          if (!numbers[mode]) numbers[mode] = await contrasts(page);
          if (errors.length) {
            failures++;
            console.log(`FAIL ${name}: ${errors.join(" | ")}`);
          } else console.log(`ok   ${name}`);
          await page.close();
        }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(resolve(OUT, `${label}-contrast.json`), `${JSON.stringify(numbers, null, 1)}\n`);
for (const [mode, n] of Object.entries(numbers)) {
  console.log(`${mode}: fields ${n.fields.map((f) => `${f.lv} ${f.average}`).join(", ")}`);
  for (const l of n.lines)
    console.log(`  ${l.id} ${l.colour}: ${l.on.map((r) => `${r}:1`).join(" / ")}`);
}
console.log(`${failures ? "FAIL" : "ok"}: captures in ${OUT}`);
process.exit(failures ? 1 : 0);
