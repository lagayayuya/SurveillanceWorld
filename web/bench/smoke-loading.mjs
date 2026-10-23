// Smoke test of « Chargement » on the punk interface's first load (the author's point 1 of
// 2026-10-12, board 2c: src/loading.ts, src/loading.css, index.html's template and inline
// script), on the production build of the CI extract: the map's tiles held, the screen is
// there before the map (role status, « Chargement de la carte » said, « de la carte » under
// the word, the ten letters, the camera), never in the way of a pointer, under the welcome
// panel, light and dark; the tiles let go, it is gone at the map's first display (and its
// mark on the page with it); under reduced motion nothing of it moves, else its camera and
// letters do; axe-core WCAG 2.2 A/AA none; ?ui=classique (an old link) shows it too; a return from
// OpenStreetMap shows « de votre compte » at once. The account's sheet on that return is
// bench/account.mjs's. Exits non-zero if a check failed.
//   node bench/smoke-loading.mjs [--browser webkit|chromium] [--port N]
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chromium, devices, webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { returning } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const engine = arg("--browser", "webkit");
const PORT = Number(arg("--port", "4621"));
const APP = `http://localhost:${PORT}/`;
const AT = "#17/48.8963/2.2382";
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const PHONE = { ...devices["iPhone 14"], viewport: { width: 390, height: 845 } };
const WIDE = { viewport: { width: 960, height: 581 } };

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** The map's tiles (and the basemap's) held until `release()`: the first load lasts. */
async function holdTiles(context) {
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  await context.route(/\.pmtiles(\?|$)|\/tiles\/(?!meta\.json)/, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  return () => release();
}

let browser;
async function visit(options, { dark = false, reduced = false, query = "", watch = false } = {}) {
  const context = await browser.newContext({
    ...options,
    locale: "fr-FR",
    colorScheme: dark ? "dark" : "light",
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  // Every « Chargement » put in the page, by its line.
  if (watch)
    await context.addInitScript(() => {
      window.__lines = [];
      new MutationObserver((records) => {
        for (const r of records)
          for (const n of r.addedNodes) {
            const el =
              n instanceof Element ? (n.closest(".loading") ?? n.querySelector(".loading")) : null;
            if (el) window.__lines.push(el.querySelector(".loading-line-text")?.textContent);
          }
      }).observe(document, { childList: true, subtree: true });
    });
  const release = await holdTiles(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"no_session"}' }),
  );
  const q = query.replace(/^&/, "");
  await page.goto(`${APP}${q ? `?${q}` : ""}${AT}`);
  return { context, page, errors, release };
}

const screen = (page) =>
  page.evaluate(() => {
    const el = document.getElementById("loading");
    if (!el) return null;
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const sheet = document.getElementById("sheet");
    return {
      role: el.getAttribute("role"),
      said: el.querySelector(".loading-said")?.textContent,
      line: el.querySelector(".loading-line-text")?.textContent,
      letters: [...el.querySelectorAll(".loading-letter")].map((l) => l.textContent).join(""),
      camera: Boolean(el.querySelector(".loading-stage .loading-lens")),
      hidden: [...el.querySelectorAll("[aria-hidden=true]")].length,
      pointer: style.pointerEvents,
      z: Number(style.zIndex),
      covers: r.width >= innerWidth && r.height >= innerHeight,
      background: style.backgroundColor,
      moves: el.getAnimations({ subtree: true }).length,
      mark: document.documentElement.dataset.loading ?? null,
      sheetHidden: sheet?.hidden,
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  });

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
browser = returning(await (engine === "chromium" ? chromium : webkit).launch());
try {
  for (const [name, options] of [
    ["phone", PHONE],
    ["wide", WIDE],
  ]) {
    const { context, page, errors, release } = await visit(options);
    await page.waitForSelector("#loading", { timeout: 15000 });
    await page.waitForTimeout(400);
    const s = await screen(page);
    check(
      `${name}: the first load's « Chargement » over the page before the map (role status, « Chargement de la carte » said, « de la carte », the ten letters, the camera, drawn hidden from screen readers), the whole screen, no pointer caught, under the welcome (z < 60), no sideways scroll`,
      s !== null &&
        s.role === "status" &&
        s.said === "Chargement de la carte" &&
        s.line === "de la carte" &&
        s.letters === "Chargement" &&
        s.camera &&
        s.hidden === 2 &&
        s.pointer === "none" &&
        s.z < 60 &&
        s.covers &&
        s.mark === "map" &&
        !s.sideways,
      JSON.stringify(s),
    );
    check(
      `${name}: its camera and letters move where motion is welcome`,
      (s?.moves ?? 0) > 10,
      String(s?.moves),
    );
    // What is under a finger is not the screen.
    const hit = await page.evaluate(() => {
      const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return e?.closest("#loading") ? "loading" : (e?.id ?? e?.className ?? "");
    });
    check(`${name}: a pointer goes through it`, hit !== "loading", hit);
    await page.addScriptTag({ path: AXE });
    const found = await page.evaluate(async () => {
      const r = await window.axe.run(document.getElementById("loading"), {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return r.violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(" ")}`));
    });
    check(
      `${name}: axe WCAG 2.2 A/AA none in « Chargement »`,
      found.length === 0,
      found.join(" | "),
    );
    release();
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    const after = await page.evaluate(() => ({
      el: Boolean(document.getElementById("loading") || document.querySelector(".loading")),
      mark: document.documentElement.dataset.loading ?? null,
    }));
    check(
      `${name}: gone at the map's first display, its mark with it`,
      !after.el && after.mark === null,
      JSON.stringify(after),
    );
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // Dark: 2c's sombre page; reduced motion: still.
  {
    const { context, page, release } = await visit(PHONE, { dark: true, reduced: true });
    await page.waitForSelector("#loading", { timeout: 15000 });
    await page.waitForTimeout(400);
    const s = await screen(page);
    check("dark: 2c's sombre page (#141216)", s?.background === "rgb(20, 18, 22)", s?.background);
    check(
      "reduced motion: nothing of it moves (no animation at all)",
      s?.moves === 0,
      String(s?.moves),
    );
    release();
    await context.close();
  }

  // Back from OpenStreetMap: « de votre compte » at once.
  {
    const { context, page, release } = await visit(PHONE, { query: "&osm=denied", watch: true });
    await page.waitForSelector("#sheet .account-notice:not(:empty)", { timeout: 30000 });
    const seen = await page.evaluate(() => window.__lines);
    check(
      "?osm=: « Chargement de votre compte » as the page starts (over the page, then in the sheet), never « de la carte »",
      seen.length >= 1 && seen.every((l) => l === "de votre compte"),
      JSON.stringify(seen),
    );
    release();
    await context.close();
  }

  // The classique's old link (removed 2026-10-23): « Chargement » as on any visit.
  {
    const { context, page, release } = await visit(PHONE, { query: "&ui=classique" });
    await page.waitForSelector("#loading", { timeout: 15000 });
    const s = await screen(page);
    check(
      "?ui=classique: « Chargement de la carte » as on any visit",
      s !== null && s.line === "de la carte" && s.mark === "map",
      JSON.stringify(s),
    );
    release();
    await context.close();
  }
} catch (e) {
  check("the run", false, String(e).split("\n")[0]);
} finally {
  await browser.close();
  server.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length} ok, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
