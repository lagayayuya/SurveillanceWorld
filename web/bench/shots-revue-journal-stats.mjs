// /revue's « Journal » (an activity feed) and « Statistiques » (the counters' spans) of the
// « go » of 17/10, at the boards' sizes: a phone (390 × 845, WebKit) and a wide screen
// (960 × 581, Chromium), scale 2, light and dark, as rev (an administrator), on the states'
// servers (states/harness.mjs). The two API answers are the page's own until S6 is
// integrated (states/catalogue.mjs journalMock, statsMock: several days of contributions,
// decisions and gestures; the hours with their reference; « Retraits » under its
// threshold). Checks on each: the feed's example line and its camera link, the type
// filter, the page never wider than the screen, the tables' heads, the charts' text
// alternatives, and axe (WCAG 2.2 A/AA) on the view.
//   node bench/shots-revue-journal-stats.mjs [--out DIR] [--axe PATH]
//   (default DIR: <repository>/build/shots/revue-journal-stats, never committed;
//   STATES_PORTS moves the servers' ports)
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { COOKIE } from "./session.mjs";
import { journalMock, mockJournal, statsMock } from "./states/catalogue.mjs";
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

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = resolve(arg("--out", resolve(ROOT, "build/shots/revue-journal-stats")));
const AXE = arg(
  "--axe",
  process.env.LACARTE_AXE ?? createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
);
mkdirSync(OUT, { recursive: true });
const SIZES = {
  phone: { engine: "webkit", viewport: { width: 390, height: 845 } },
  wide: { engine: "chromium", viewport: { width: 960, height: 581 } },
};
const MODES = { clair: "light", sombre: "dark" };

const taken = await takenPorts();
if (taken.length) {
  console.log(`FAIL ports taken: ${taken.join(", ")}`);
  process.exit(2);
}
let browsers;
let failed = 0;
const done = (name, ok, why = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` — ${why}` : ""}`);
};

async function open(size, mode) {
  const { engine, viewport } = SIZES[size];
  const context = await browsers[engine].newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: engine === "webkit",
    hasTouch: engine === "webkit",
    colorScheme: MODES[mode],
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });
  await context.addInitScript((m) => {
    try {
      localStorage.setItem("lacarte.ui", "punk");
      localStorage.setItem("lacarte.mode", m);
      localStorage.setItem("lacarte.fonts", "1");
    } catch {
      // about:blank has no storage.
    }
  }, mode);
  await context.addCookies([
    { name: COOKIE, value: await login("rev"), url: APP, httpOnly: true, sameSite: "Strict" },
  ]);
  const page = await context.newPage();
  return { context, page };
}

/** axe on the view's main, WCAG 2.2 A/AA: the violations' rule and target. */
async function axe(page) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const r = await window.axe.run(document.querySelector("main"), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return r.violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(" ")}`));
  });
}
/** The page wider than its screen (a sideways scroll): its width and the first element
 * that passes the screen's edge, else "". */
const overflow = (page) =>
  page.evaluate(() => {
    const w = window.innerWidth;
    if (document.documentElement.scrollWidth <= w) return "";
    const out = [...document.querySelectorAll("body *")].find(
      (e) => e.getBoundingClientRect().right > w + 1 && !e.closest(".review-table-scroll > *"),
    );
    const name = out ? `${out.tagName.toLowerCase()}.${[...out.classList].join(".")}` : "?";
    return `${document.documentElement.scrollWidth}: ${name}`;
  });

async function journal(size, mode) {
  const { context, page } = await open(size, mode);
  const tag = `${size} ${mode}: journal`;
  try {
    await mockJournal({ page });
    await page.goto(`${APP}revue?vue=journal`);
    await page.waitForSelector("#review-journal .review-feed-item");
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `journal-${size}-${mode}.png`) });
    await page.screenshot({ path: join(OUT, `journal-${size}-${mode}-page.png`), fullPage: true });
    // axe in both modes: the dark one has its own contrasts.
    const found = await axe(page);
    done(`${tag}: axe WCAG 2.2 A/AA`, found.length === 0, found.join(" | "));
    if (mode === "clair") {
      const lines = await page
        .locator("#review-journal .review-feed-line")
        .evaluateAll((ps) => ps.map((p) => p.textContent));
      const example = lines.find((l) => l.includes("ana · a proposé un déplacement de 7 m"));
      done(
        `${tag}, the example line: day · who · what · the queue's label`,
        /^\d\d\/\d\d · ana · a proposé un déplacement de 7 m · Fixe · Avenue de l'Arche, Courbevoie$/.test(
          example ?? "",
        ),
        example,
      );
      const href = await page
        .locator("#review-journal .review-feed-camera")
        .first()
        .getAttribute("href");
      done(`${tag}, the camera's id a link to its view`, /[?&]camera=n\d+/.test(href ?? ""), href);
      done(
        `${tag}: a deleted account, a test account, an elided name`,
        lines.some((l) => l.includes("compte supprimé")) &&
          (await page.locator("#review-journal .review-feed-line .review-tag").count()) === 1 &&
          lines.some((l) => l.includes("la contribution d'ana")),
      );
      const raw = lines.filter((l) => /[0-9a-f]{8}-[0-9a-f]{4}-/.test(l));
      done(`${tag}: no uuid in a line`, raw.length === 0, raw.join(" | "));
      // « Décisions »: only the decisions, the address keeps it.
      await page.locator('#review-journal .review-chip[data-type="decisions"]').click();
      await page.waitForFunction(() => window.location.search.includes("type=decisions"));
      await page.waitForTimeout(300);
      const kept = await page
        .locator("#review-journal .review-feed-what")
        .evaluateAll((s) => s.map((e) => e.textContent));
      done(
        `${tag}: « Décisions » keeps the review's decisions alone`,
        kept.length === 4 && kept.every((w) => /contribution d/.test(w)),
        kept.join(" | "),
      );
      await page.screenshot({ path: join(OUT, `journal-decisions-${size}-${mode}.png`) });
    }
    const wide = await overflow(page);
    done(`${tag}: no sideways scroll`, wide === "", wide);
  } catch (e) {
    done(tag, false, String(e).split("\n")[0]);
  }
  await context.close();
}

async function stats(size, mode, opts = {}) {
  const { context, page } = await open(size, mode);
  const name = opts.low ? "stats-pas-assez" : "stats";
  const tag = `${size} ${mode}: ${name}`;
  try {
    await page.route("**/api/review/stats", (r) => r.fulfill({ json: statsMock(opts) }));
    await page.goto(`${APP}revue?vue=statistiques`);
    await page.waitForSelector("#review-stats .review-stats-grid");
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${name}-${size}-${mode}.png`) });
    await page.screenshot({ path: join(OUT, `${name}-${size}-${mode}-page.png`), fullPage: true });
    if (!opts.low) {
      // « Voir les chiffres » of the 24 hours, in view.
      await page.locator("#review-stat-hours .review-figures summary").click();
      await page.locator("#review-stat-hours .review-figures table").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `stats-chiffres-${size}-${mode}.png`) });
    }
    if (mode === "clair" && !opts.low) {
      const facts = await page.evaluate(() => ({
        lead: document.querySelector(".review-stats-lead")?.textContent,
        blocks: [...document.querySelectorAll(".review-stat")].map((b) => b.id),
        low: [...document.querySelectorAll(".review-stat-low")].map(
          (p) => p.closest(".review-stat")?.id,
        ),
        charts: [...document.querySelectorAll(".review-chart-plot")].map((s) => ({
          role: s.getAttribute("role"),
          label: s.getAttribute("aria-label") ?? "",
        })),
        heads: [...document.querySelectorAll(".review-stats-table thead th")].every(
          (th) => th.getAttribute("scope") === "col",
        ),
        rowHeads: [...document.querySelectorAll(".review-stats-table tbody tr")].every(
          (tr) => tr.firstElementChild?.getAttribute("scope") === "row",
        ),
        hoursRows: document.querySelectorAll("#review-stat-hours tbody tr").length,
      }));
      done(
        `${tag}: « jamais des personnes », eight blocks, « Retraits » under its threshold`,
        facts.lead === "On compte des visites et des connexions, jamais des personnes." &&
          facts.blocks.length === 8 &&
          facts.low.join() === "review-stat-hidden",
        JSON.stringify({ lead: facts.lead, blocks: facts.blocks, low: facts.low }),
      );
      done(
        `${tag}: every chart an image with its values said (${facts.charts.length})`,
        facts.charts.length === 7 &&
          facts.charts.every((c) => c.role === "img" && /\d/.test(c.label)),
        JSON.stringify(facts.charts.map((c) => c.label.slice(0, 60))),
      );
      done(
        `${tag}: tables with th scope, the 24 hours one row each`,
        facts.heads && facts.rowHeads && facts.hoursRows === 24,
        JSON.stringify({ heads: facts.heads, rows: facts.rowHeads, hours: facts.hoursRows }),
      );
    }
    const found = await axe(page);
    done(`${tag}: axe WCAG 2.2 A/AA`, found.length === 0, found.join(" | "));
    const wide = await overflow(page);
    done(`${tag}: no sideways scroll`, wide === "", wide);
  } catch (e) {
    done(tag, false, String(e).split("\n")[0]);
  }
  await context.close();
}

try {
  await startServers();
  resetContributions();
  browsers = { webkit: await webkit.launch(), chromium: await chromium.launch() };
  // The mock is the same at every run but for its days (dated from today).
  done(
    "the feed's mock: several days, every type",
    new Set(journalMock().map((e) => e.day)).size >= 4,
  );
  for (const size of Object.keys(SIZES))
    for (const mode of Object.keys(MODES)) {
      await journal(size, mode);
      await stats(size, mode);
      await stats(size, mode, { low: true });
    }
} finally {
  await browsers?.webkit.close();
  await browsers?.chromium.close();
  await stopServers();
  closeProxy();
}
console.log(`${failed ? "FAIL" : "ok"}: captures in ${OUT}`);
process.exit(failed ? 1 : 0);
