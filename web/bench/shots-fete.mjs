// Captures of the lot of 2026-10-11's points 9 and 11 for the author's stop point, at the
// boards' sizes (scale 2, light): the welcome (28a) on a wide screen (960 × 581) and a phone
// (390 × 845), and the points scored at the send (8a) on a phone at three instants of its
// timeline — tickets falling, the total landed, the cannon burst — and under reduced motion.
// On the states' servers (states/harness.mjs: the throwaway API on the CI build, real sends,
// real fields), GET /api/me/points answered by score-kit.mjs until the API serves it. The
// instants are held: every animation of the page paused at the same time from the tap on
// « Envoyer » (score.ts: the sheet gone at 400 ms, then 8a's own times).
// The lot of 2026-10-12's point 2 (`column`): the tickets mid-fall in their categories'
// colours, on a wide screen (960 × 581, Chromium) in the column of the sheet that slid away
// — its place drawn by the bench as a dashed outline, not by the page — and on a phone
// (390 × 845, WebKit), light and dark; the add of a bullet on the wide screen, its infos on
// one ticket. The return on Temps 1's map point 2 (`centred`): on a 375 px phone, dark, the
// stack and the total centred, at rest.
//   node bench/shots-fete.mjs [--out DIR] [--only welcome|fete|categories|column|centred]
//   (default: <repository>/build/shots/fete, never committed; every part)
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { addFilled, frameContext, holdAt, mockPoints, threeChanges } from "./score-kit.mjs";
import { COOKIE } from "./session.mjs";
import {
  APP,
  closeProxy,
  login,
  ROOT,
  resetContributions,
  startServers,
  stopServers,
  takenPorts,
} from "./states/harness.mjs";
import { kit } from "./states/kit.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = resolve(arg("--out", resolve(ROOT, "build/shots/fete")));
const only = arg("--only", null);
const part = (name) => only === null || only === name;
mkdirSync(OUT, { recursive: true });
const PHONE = { width: 390, height: 845 };
const WIDE = { width: 960, height: 581 };
// The welcome mockup draws its wide frame at 1180 × 740, not the map boards' 960 × 581.
const WELCOME_WIDE = { width: 1180, height: 740 };
// From the tap on « Envoyer »: the second ticket mid-fall, the total landed, the burst.
/** A third into the first ticket's fall, in ms after the tap. */
const MID_FALL = 1330;
const INSTANTS = [
  ["send-1", 1580],
  ["send-2", 2420],
  ["send-3", 3050],
];

/** Where the sheet stood (left, top, width, height), dashed over the map by the bench. */
const outline = (page, [left, top, width, height]) =>
  page.evaluate(
    ([l, t, w, h]) => {
      const box = document.createElement("div");
      box.style.cssText = `position:fixed;left:${l}px;top:${t}px;width:${w}px;height:${h}px;outline:2px dashed #ff48b0;outline-offset:-2px;z-index:39;pointer-events:none`;
      document.body.append(box);
    },
    [left, top, width, height],
  );

const taken = await takenPorts();
if (taken.length) {
  console.log(`FAIL ports taken: ${taken.join(", ")}`);
  process.exit(2);
}
const ctx = { login, cookie: COOKIE, app: APP };
let browsers;
let failed = 0;
const done = (name, ok, why = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` — ${why}` : ""}`);
};
try {
  await startServers();
  resetContributions();
  browsers = { webkit: await webkit.launch(), chromium: await chromium.launch() };
  // --- 28a: the welcome, its poppers played (the cones stay) ----------------------------
  for (const [name, size, engine] of !part("welcome")
    ? []
    : [
        ["welcome-wide", WIDE, "chromium"],
        ["welcome-board", WELCOME_WIDE, "chromium"],
        ["welcome-phone", PHONE, "webkit"],
      ]) {
    const context = await frameContext(browsers[engine], size, { ...ctx, welcome: true });
    const page = await context.newPage();
    const k = kit(page, context, {
      device: size.width < 600 ? "phone" : "desktop",
      mode: "clair",
    });
    try {
      await k.open("#16.5/48.8963/2.2382");
      await page.waitForSelector("#welcome [role=dialog]");
      await page.waitForTimeout(2300);
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      done(name, true);
    } catch (e) {
      done(name, false, String(e).split("\n")[0]);
    }
    await context.close();
  }
  // --- 8a: three changes sent, held at three instants; then under reduced motion ----------
  for (const [name, ms] of !part("fete") ? [] : [...INSTANTS, ["send-reduced", null]]) {
    resetContributions();
    const context = await frameContext(browsers.webkit, PHONE, { ...ctx, reduced: ms === null });
    const page = await context.newPage();
    const k = kit(page, context, { device: "phone", mode: "clair" });
    try {
      await mockPoints(page);
      await threeChanges(k);
      await k.tap("#modify-send");
      await page.waitForSelector("#score");
      // The points in, the field turned (it follows the clock, not the held animations).
      await page
        .waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(1400);
      if (ms !== null) await holdAt(page, ms);
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      done(`${name}${ms === null ? "" : ` (${ms} ms after the tap)`}`, true);
    } catch (e) {
      done(name, false, String(e).split("\n")[0]);
    }
    await context.close();
  }
  // --- the retouch of 2026-10-11: the tickets in the leaderboard's category colours and
  // words, then « Voir le classement » (its legend), light and dark, at rest -------------
  for (const dark of part("categories") ? [false, true] : []) {
    const mode = dark ? "sombre" : "clair";
    resetContributions();
    const context = await frameContext(browsers.webkit, PHONE, { ...ctx, reduced: true, dark });
    const page = await context.newPage();
    const k = kit(page, context, { device: "phone", mode });
    try {
      await mockPoints(page);
      await threeChanges(k);
      await k.tap("#modify-send");
      await page.waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `categories-${mode}-tickets.png`) });
      await k.tap("#score .score-board");
      await page.waitForSelector("#sheet .board-count", { timeout: 15000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT, `categories-${mode}-classement.png`) });
      done(`categories-${mode}`, true);
    } catch (e) {
      done(`categories-${mode}`, false, String(e).split("\n")[0]);
    }
    await context.close();
  }
  // --- 2026-10-12, point 2: mid-fall, the sheet's column; the add's infos on one ticket ----
  const columns = [
    ["wide", WIDE, "chromium"],
    ["phone", PHONE, "webkit"],
  ];
  for (const [where, size, engine] of part("column") ? columns : [])
    for (const dark of [false, true]) {
      const mode = dark ? "sombre" : "clair";
      const name = `column-${where}-${mode}`;
      resetContributions();
      const context = await frameContext(browsers[engine], size, { ...ctx, dark });
      const page = await context.newPage();
      const k = kit(page, context, {
        device: where === "phone" ? "phone" : "desktop",
        mode,
      });
      try {
        await mockPoints(page);
        await threeChanges(k);
        const sheet = await page.evaluate(() => {
          const p = document.getElementById("modify-panel");
          return [p.offsetLeft, p.offsetTop, p.offsetWidth, p.offsetHeight];
        });
        await k.tap("#modify-send");
        await page.waitForSelector("#score");
        await page
          .waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(1400);
        // Mid-fall: the first ticket falls from 1190 to 1610 ms after the tap (the sheet's
        // 400 ms, the 650 ms wait, its 420 ms fall), in its colour from the first frame.
        await holdAt(page, MID_FALL);
        // A phone's sheet takes the whole width: nothing to outline.
        if (where === "wide") await outline(page, sheet);
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(OUT, `${name}.png`) });
        done(`${name} (${MID_FALL} ms after the tap, mid-fall, the sheet's place dashed)`, true);
      } catch (e) {
        done(name, false, String(e).split("\n")[0]);
      }
      await context.close();
    }
  for (const dark of part("column") ? [false, true] : []) {
    const mode = dark ? "sombre" : "clair";
    const name = `column-wide-add-${mode}`;
    resetContributions();
    const context = await frameContext(browsers.chromium, WIDE, {
      ...ctx,
      who: "fay",
      dark,
      reduced: true,
    });
    const page = await context.newPage();
    const k = kit(page, context, { device: "desktop", mode });
    try {
      await mockPoints(page);
      await addFilled(k, { shape: "bullet" });
      await k.tap("#modify-send");
      await page.waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      done(`${name} (a bullet added, at rest)`, true);
    } catch (e) {
      done(name, false, String(e).split("\n")[0]);
    }
    await context.close();
  }
  // --- 2026-10-14, map point 2: on a phone the stack and the total centred, 375 px wide, the
  // author's iPhone capture's case (a dome added, dark) and three changes, every animation
  // over (the cannon's burst gone, the cannon left) ---------------------------------------
  const NARROW = { width: 375, height: 812 };
  for (const [what, engine] of part("centred")
    ? [
        ["add", "webkit"],
        ["changes", "webkit"],
        ["add", "chromium"],
      ]
    : []) {
    const name = `centred-375-${what}-${engine}-sombre`;
    resetContributions();
    const context = await frameContext(browsers[engine], NARROW, {
      ...ctx,
      who: "fay",
      dark: true,
    });
    const page = await context.newPage();
    const k = kit(page, context, { device: "phone", mode: "sombre" });
    try {
      await mockPoints(page);
      if (what === "add") await addFilled(k);
      else await threeChanges(k);
      await k.tap("#modify-send");
      await page.waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 });
      await page.evaluate(() =>
        Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
      );
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      done(`${name} (at rest)`, true);
    } catch (e) {
      done(name, false, String(e).split("\n")[0]);
    }
    await context.close();
  }
} finally {
  await browsers?.webkit.close();
  await browsers?.chromium.close();
  await stopServers();
  closeProxy();
}
console.log(`${failed ? "FAIL" : "ok"}: captures in ${OUT}`);
process.exit(failed ? 1 : 0);
