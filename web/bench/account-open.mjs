// The account's screen on an entry-level phone (lot U: « Mes caméras »' little map was
// decided on these numbers, docs/interface.md): Chromium, profiles.mjs `lowend` (CPU ×6,
// DevTools' « Slow 4G »), 390×845 CSS px at scale 2, the account routes answered by the page
// (profile-mock.mjs, « Mes caméras »' fuller COLLECTION), on the CI extract. The map opened
// on the cluster and at rest, then `--runs` times: the account square clicked → the screen
// drawn with « Vous » and its points (`open`); « Mes caméras ↓ » clicked → its little map
// drawn (`.board-minimap[data-drawn]`: `cameras`); the long tasks' total over each; the
// sheet closed. The first run is cold (the screen's code, the pictograms), the others warm:
// prints each run and the warm medians. A build without « Mes caméras » measures `open` only.
//   node bench/account-open.mjs [--runs 5] [--port 4550] [--profile lowend|phone4g]
// Serves LACARTE_DIST (bench/dist.mjs). Exits non-zero when a step times out.
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { AT, COLLECTION, mockProfile } from "./profile-mock.mjs";
import { conditions, PHONE_PROFILES } from "./profiles.mjs";
import { returning } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const RUNS = Number(arg("--runs", "5"));
const PORT = Number(arg("--port", "4550"));
const PROFILE = PHONE_PROFILES[arg("--profile", "lowend")];
const APP = `http://localhost:${PORT}/`;

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
const browser = returning(await chromium.launch());
let failed = false;
try {
  await new Promise((r) => setTimeout(r, 2500));
  const context = await browser.newContext({
    viewport: { width: PROFILE.width, height: PROFILE.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "fr-FR",
  });
  await mockProfile(context, { contributions: COLLECTION });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", conditions(PROFILE));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpu });
  await page.goto(`${APP}?ui=punk&mode=clair${AT}`);
  await page.waitForFunction(() => window.__map?.loaded() && window.__map.areTilesLoaded(), null, {
    timeout: 180_000,
  });
  await page.waitForTimeout(3000);
  // Time from a click to `selector` in the page, and the long tasks' total meanwhile.
  const timed = async (click, selector) => {
    await page.evaluate(() => {
      window.__t = { t0: 0, t1: 0, long: 0 };
      document.addEventListener("click", () => (window.__t.t0 = performance.now()), {
        capture: true,
        once: true,
      });
      window.__obs?.disconnect();
      window.__obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!window.__t.t1) window.__t.long += e.duration;
      });
      window.__obs.observe({ type: "longtask" });
    });
    await page.locator(click).first().click();
    await page.waitForFunction(
      (sel) => {
        if (!document.querySelector(sel)) return false;
        window.__t.t1 ||= performance.now();
        return true;
      },
      selector,
      { timeout: 120_000, polling: "raf" },
    );
    await page.waitForTimeout(300); // the long tasks' entries come in after
    return page.evaluate(() => ({
      ms: Math.round(window.__t.t1 - window.__t.t0),
      long: Math.round(window.__t.long),
    }));
  };
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const open = await timed("#account-square", "#sheet .board-paper .board-you:not([hidden])");
    const has = await page.locator("#sheet .board-cameras-toggle").count();
    let cameras = null;
    if (has) {
      await page.locator("#sheet .board-cameras-toggle").scrollIntoViewIfNeeded();
      cameras = await timed("#sheet .board-cameras-toggle", "#sheet .board-minimap[data-drawn]");
    }
    runs.push({ open, cameras });
    console.log(
      `run ${i + 1}${i ? "" : " (cold)"}: open ${open.ms} ms (long tasks ${open.long} ms)` +
        (cameras ? `, « Mes caméras » ${cameras.ms} ms (long tasks ${cameras.long} ms)` : ""),
    );
    await page.locator("#sheet .close").first().click();
    await page.waitForTimeout(1500);
  }
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const warm = runs.slice(1);
  console.log(
    `warm medians (${warm.length} runs): open ${median(warm.map((r) => r.open.ms))} ms` +
      (warm[0]?.cameras
        ? `, « Mes caméras » ${median(warm.map((r) => r.cameras.ms))} ms, its long tasks ${median(warm.map((r) => r.cameras.long))} ms`
        : ""),
  );
} catch (e) {
  failed = true;
  console.log(`FAIL ${String(e).split("\n")[0]}`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
