// Captures of the punk streets above the fields at Place Denfert-Rochereau (« Prudent », the
// author's captures of 2026-10-13 and 2026-10-14), on a phone (390 × 845, WebKit, scale 2):
// « Prudent » from z15 (the fields fade in there) to z20 (an iPhone's view with the house
// numbers is z18 – z19), « Standard » at z17 and z19, light and dark; with the contrast of each
// street line against each field level's pattern, its average colour (linear light: what the
// eye mixes at a distance), the line drawn over it at its opacity. A curve's value is read at
// its last stop (z19 and above), whatever the capture's zoom.
// Run once per build to compare (before, after): --label names the files.
//   node bench/shots-streets.mjs [--label NAME] [--out DIR] [--port N]
//   (default: <repository>/build/shots/streets, never committed; NAME "current")
// Needs an IDF build: LACARTE_DIST (bench/dist.mjs), or web/dist with the IDF tiles.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("idf");
const label = arg("--label", "current");
const OUT = resolve(arg("--out", resolve(WEB, "../build/shots/streets")));
const PORT = Number(arg("--port", 4473));
const APP = `http://127.0.0.1:${PORT}/`;
const PLACE = [48.8338, 2.3324];
/** Zoom and estimate (« Prudent », and « Standard », the map opening on it). */
const VIEWS = [
  ...[15, 16, 17, 18, 19, 20].map((z) => [z, "prudent"]),
  [17, "standard"],
  [19, "standard"],
];
/** The line layers whose colour is measured: the street, and every basemap layer a variant
 * draws again above the fields (`-lifted`). */
const LINES = ["streets"];
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

/** In the page: each field level's average colour and each measured line's contrast on it. */
const contrasts = (page) =>
  page.evaluate((lines) => {
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
    // A paint value as drawn at the current zoom: a string, or the last stop of a curve.
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
      .layers.filter((l) => l.id.endsWith("-lifted"))
      .map((l) => l.id);
    for (const id of [...lines, ...lifted]) {
      if (!map.getLayer(id)) continue;
      const colour = value(map.getPaintProperty(id, "line-color"));
      const opacity = Number(value(map.getPaintProperty(id, "line-opacity")) ?? 1);
      if (typeof colour !== "string") continue;
      const c = parse(colour);
      out.lines.push({
        id,
        colour: hex(c),
        opacity,
        on: fields.map((f) => {
          const drawn = c.map((v, k) => Math.round(v * opacity + f.average[k] * (1 - opacity)));
          return ratio(drawn, f.average);
        }),
      });
    }
    return out;
  }, LINES);

const server = spawn("npx", preview(PORT, "127.0.0.1"), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2000));
let failures = 0;
const numbers = {};
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
        localStorage.setItem("lacarte.ui", "punk");
        localStorage.setItem("lacarte.mode", m);
        localStorage.setItem("lacarte.welcome", "1");
      } catch {
        // about:blank has no storage.
      }
    }, mode);
    for (const [z, est] of VIEWS) {
      const name = `${label}-z${z}-${est}-${mode}`;
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(
        `${APP}?ui=punk${est === "prudent" ? "&est=prudent" : ""}#${z}/${PLACE[0]}/${PLACE[1]}`,
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
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(resolve(OUT, `${label}-contrast.json`), `${JSON.stringify(numbers, null, 1)}\n`);
for (const [mode, n] of Object.entries(numbers)) {
  console.log(`${mode}: fields ${n.fields.map((f) => `${f.lv} ${f.average}`).join(", ")}`);
  for (const l of n.lines)
    console.log(`  ${l.id} ${l.colour} ×${l.opacity}: ${l.on.map((r) => `${r}:1`).join(" / ")}`);
}
console.log(`${failures ? "FAIL" : "ok"}: captures in ${OUT}`);
process.exit(failures ? 1 : 0);
