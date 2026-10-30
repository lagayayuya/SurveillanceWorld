// Smoke test of the register's frame (registre/modale.ts, hote.ts; v2.1 A4, A6, A9) on the production
// build, in Chromium or WebKit, on a wide screen (1440 × 900):
// - A9, one modal at a time: the welcome, a legal page and the account's sheet opened on the map,
//   then the browser's back onto a register page: only the register shows and holds the focus; a
//   register page opened cold on a first visit shows no welcome; « Signaler une erreur » from an
//   arrêté opens over the register (the register inert, the focus in the dialog), the dialog's
//   « Confidentialité » opens over it (the focus in the legal page), and closing them gives the
//   focus back to the register;
// - A6, two tables of a commune, the arrêtés (its « autorisations ») and the contracts (its
//   documents, contracts only): a column of numbers (`num`) has its head's words and its values'
//   right edges within 1 px; a column of text, their left edges;
// - A4, the back button: a commune opened cold says « ← Carte »; its section, then another fiche:
//   « ← Retour » there brings the commune back with its section and its scroll; ✕ the map.
// The server: the build (LACARTE_DIST, bench/dist.mjs) first, then web/public: the register's data
// are not in a build (web/public/data is ignored by git, so the gate's build has none) and come
// from the developer's link, web/public/data/registre (the pilot's build of lacarte-registre). Every
// /registre path is answered with the page, as Caddy does. The commune: --commune, else Lyon
// (69123), else the first of the data with arrêtés and contracts. The map's region is the CI
// extract's (--region ci), as the other benches': the register does not read its tiles.
// Exits 2 when the build or the register's data are missing, 1 when a check failed.
//   node bench/smoke-registre.mjs [--region ci] [--browser chromium|webkit] [--commune INSEE] [--port N]
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { DIST, requireTiles, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const engine = arg("--browser", "chromium");
const PORT = Number(arg("--port", "4631"));
const APP = `http://127.0.0.1:${PORT}`;
requireTiles(arg("--region", "ci"));
const PUBLIC = resolve(WEB, "public");
const DATA = resolve(PUBLIC, "data/registre");
if (!existsSync(join(DIST, "index.html"))) {
  console.log(`FAIL no build in ${DIST}: npm --prefix web run build, or LACARTE_DIST=<a build>`);
  process.exit(2);
}
if (!existsSync(join(DATA, "index.json"))) {
  console.log(
    `FAIL no register data in ${DATA}: link the pilot's build there (ln -s ../../../data/registre/site web/public/data/registre)`,
  );
  process.exit(2);
}

/** A commune with arrêtés and contracts, for the two tables. */
function commune() {
  const has = (insee) => {
    const f = join(DATA, "commune", `${insee}.json`);
    if (!existsSync(f)) return false;
    const ev = JSON.parse(readFileSync(f, "utf8")).evenements ?? [];
    return ev.some((e) => e.t === "arrete") && ev.some((e) => e.t === "attribution");
  };
  const asked = arg("--commune", null);
  if (asked) return has(asked) ? asked : null;
  if (has("69123")) return "69123";
  for (const f of readdirSync(join(DATA, "commune")))
    if (f.endsWith(".json") && has(f.slice(0, -5))) return f.slice(0, -5);
  return null;
}
const INSEE = commune();
if (!INSEE) {
  console.log(`FAIL no commune with arrêtés and contracts in ${DATA}/commune`);
  process.exit(2);
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".pmtiles": "application/octet-stream",
};
function file(path) {
  const clean = decodeURIComponent(path.split("?")[0]);
  const page = clean === "/" || /^\/registre(\/|$)/.test(clean) ? "/index.html" : clean;
  for (const root of [DIST, PUBLIC]) {
    const f = join(root, page);
    if (f.startsWith(root) && existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}
const server = createServer((req, res) => {
  const f = file(req.url);
  if (!f) {
    res.writeHead(404).end();
    return;
  }
  const size = statSync(f).size;
  const type = TYPES[extname(f)] ?? "application/octet-stream";
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
    });
    createReadStream(f, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size });
    createReadStream(f).pipe(res);
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await (engine === "webkit" ? webkit : chromium).launch();
/** A page of a fresh context; `first`: a first visit (the welcome not seen yet). */
async function visit(path, { first = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "fr-FR",
  });
  if (!first)
    await context.addInitScript(() => {
      try {
        localStorage.setItem("lacarte.welcome", "1");
      } catch {}
    });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // no API behind the build: signed out, nothing sent
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"no_session"}' }),
  );
  await page.goto(`${APP}${path}`);
  return { context, page, errors };
}
/** The register drawn: its frame shown and a view in it. */
const drawn = (page) =>
  page.waitForFunction(
    () => {
      const rg = document.getElementById("registre");
      return rg && !rg.hidden && rg.querySelector("#vue *");
    },
    null,
    { timeout: 20000 },
  );

/** Which of the page's modals show (present, drawn, not inert) and where the focus is. */
const modals = (page) =>
  page.evaluate(() => {
    const seen = (x) => {
      if (!x || x.hidden || x.inert || x.closest("[inert]")) return false;
      const s = getComputedStyle(x);
      const r = x.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const sheet = document.getElementById("sheet");
    const all = {
      registre: document.getElementById("registre"),
      welcome: document.getElementById("welcome"),
      legal: document.getElementById("legal"),
      account: sheet?.querySelector("[data-account]") ? sheet : null,
      mine: document.getElementById("mine"),
      dialogue: document.querySelector("body > .dialogue"),
    };
    // the register's root holds its frame, fixed: the frame is what shows
    const frame = all.registre?.querySelector(":scope > .th > :is(.modal, .side, .sheet)");
    const shown = Object.keys(all).filter((k) =>
      k === "registre" ? seen(all.registre) || (frame && seen(frame)) : seen(all[k]),
    );
    const f = document.activeElement;
    const focus = Object.keys(all).find((k) => all[k]?.contains(f)) ?? f?.tagName ?? null;
    return { shown, focus };
  });

/** Back in the history until a register page shows (a sheet may have added a step). */
async function backToRegister(page) {
  for (let i = 0; i < 4 && !/^\/registre/.test(new URL(page.url()).pathname); i++) {
    await page.goBack();
    await page.waitForTimeout(600);
  }
  await drawn(page);
  await page.waitForTimeout(800);
}

try {
  const COMMUNE = `/registre/commune/${INSEE}`;

  // --- A9: a cold open on a first visit: no welcome over the register -------------------------
  {
    const { context, page, errors } = await visit(COMMUNE, { first: true });
    await drawn(page);
    await page.waitForTimeout(1500);
    const m = await modals(page);
    check(
      "A9: a register page opened cold on a first visit: the register alone, the focus in it",
      m.shown.join() === "registre" && m.focus === "registre" && errors.length === 0,
      JSON.stringify({ ...m, errors }),
    );
    await context.close();
  }

  // --- A9: each site modal open on the map, then the browser's back onto the register ---------
  const OPENERS = {
    welcome: (page) => page.locator("#welcome-square").click(),
    legal: (page) =>
      // a legal link as the site writes them (legal/index.ts opens it in place)
      page.evaluate(() => {
        const a = document.createElement("a");
        a.href = "/?page=sources";
        document.body.append(a);
        a.click();
        a.remove();
      }),
    account: (page) => page.locator("#account-square").click(),
  };
  for (const [name, open] of Object.entries(OPENERS)) {
    const { context, page, errors } = await visit(COMMUNE);
    await drawn(page);
    await page.locator("#registre [data-fermer]").first().click();
    await page.waitForFunction(() => document.getElementById("registre")?.hidden !== false);
    await page.waitForTimeout(800);
    await open(page);
    await page.waitForTimeout(800);
    const before = await modals(page);
    await backToRegister(page);
    const after = await modals(page);
    check(
      `A9: ${name} open on the map, then back onto a register page: it closes, the register alone, the focus in it`,
      before.shown.includes(name) &&
        after.shown.join() === "registre" &&
        after.focus === "registre" &&
        errors.length === 0,
      JSON.stringify({ before, after, errors }),
    );
    await context.close();
  }

  // --- A9: « Signaler une erreur » from an arrêté, then its « Confidentialité » ---------------
  {
    const { context, page, errors } = await visit(`${COMMUNE}/autorisations`);
    await drawn(page);
    await page.waitForTimeout(1500);
    const signaler = page
      .locator("#registre")
      .getByRole("link", { name: /Signaler une erreur/ })
      .or(page.locator("#registre").getByRole("button", { name: /Signaler une erreur/ }));
    // B4 puts it in the panel of the chosen arrêté: an arrêté chosen first, when no row has one
    if (!(await signaler.first().isVisible())) {
      await page.locator("#registre table.t tr.r td.num").first().click();
      await page.waitForTimeout(600);
    }
    const found = await signaler.first().isVisible();
    if (found) {
      await signaler.first().click();
      await page.waitForSelector("body > .dialogue", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    const over = await modals(page);
    const inert = await page.evaluate(() => document.getElementById("registre")?.inert);
    check(
      "A9: « Signaler une erreur » from an arrêté: its dialog alone over the register (inert), the focus in it",
      found && over.shown.join() === "dialogue" && over.focus === "dialogue" && inert === true,
      JSON.stringify({ found, over, inert }),
    );
    const privacy = page.locator("body > .dialogue a[href='/?page=confidentialite']");
    if (await privacy.count()) {
      await privacy.first().click();
      await page.waitForSelector("#legal", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
      const legal = await modals(page);
      const z = await page.evaluate(() => {
        const l = document.getElementById("legal");
        const d = document.querySelector("body > .dialogue");
        return l && d
          ? [Number(getComputedStyle(l).zIndex), Number(getComputedStyle(d).zIndex)]
          : [];
      });
      check(
        "A9: the dialog's « Confidentialité »: the legal page over it (z), alone, the focus in it, the dialog kept",
        legal.shown.join() === "legal" && legal.focus === "legal" && z[0] > z[1],
        JSON.stringify({ legal, z }),
      );
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    const back = await modals(page);
    check(
      "A9: the dialog closed: the register alone again, the focus back in it",
      back.shown.join() === "registre" && back.focus === "registre" && errors.length === 0,
      JSON.stringify({ back, errors }),
    );
    await context.close();
  }

  // --- A6: two tables, the columns' edges -----------------------------------------------------
  for (const [name, path] of [
    ["the arrêtés (autorisations)", `${COMMUNE}/autorisations`],
    ["the contracts (documents, contracts only)", `${COMMUNE}/documents?t=con`],
  ]) {
    const { context, page } = await visit(path);
    await drawn(page);
    await page.waitForSelector("#registre table.t tbody tr", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const cols = await page.evaluate(() => {
      /** Where a cell's words are: its text without the spaces around it and its pictograms,
       * not a button's padding around them; null when it shows none. */
      const words = (cell) => {
        let left = Infinity;
        let right = -Infinity;
        const add = (b) => {
          if (b.width <= 0 || b.height <= 0) return;
          left = Math.min(left, b.left);
          right = Math.max(right, b.right);
        };
        const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const s = n.textContent;
          const i = s.search(/\S/);
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, s.length - (s.length - s.trimEnd().length));
          for (const b of r.getClientRects()) add(b);
        }
        for (const x of cell.querySelectorAll(".mini, svg, img")) add(x.getBoundingClientRect());
        return left < right ? { left, right } : null;
      };
      const out = [];
      for (const [ti, table] of [...document.querySelectorAll("#registre table.t")].entries()) {
        const heads = [...(table.tHead?.rows[0]?.cells ?? [])];
        if (heads.some((h) => h.colSpan > 1)) continue;
        heads.forEach((th, i) => {
          const h = words(th);
          if (!h) return;
          const num = th.classList.contains("num");
          let worst = 0;
          let n = 0;
          let notNum = 0;
          for (const tr of table.tBodies[0]?.rows ?? []) {
            if (tr.cells.length < heads.length) continue; // a row may hold more (the phone's links)
            const td = tr.cells[i];
            if (td.classList.contains("num") !== num) notNum++;
            const v = words(td);
            if (!v) continue;
            n++;
            worst = Math.max(worst, Math.abs(num ? v.right - h.right : v.left - h.left));
          }
          out.push({ table: ti, col: th.textContent.trim().slice(0, 30), num, n, worst, notNum });
        });
      }
      return out;
    });
    const bad = cols.filter((c) => c.n > 0 && (c.worst > 1 || c.notNum > 0));
    check(
      `A6: ${name}: every column's head and values on one edge (numbers right, text left) within 1 px, a num head over num values`,
      cols.length > 0 && cols.some((c) => c.num && c.n > 0) && bad.length === 0,
      bad.length
        ? JSON.stringify(
            bad.map(
              (c) =>
                `${c.table}:${c.col} ${c.num ? "right" : "left"} ${c.worst.toFixed(1)} px, ${c.notNum} cells of the other kind`,
            ),
          )
        : JSON.stringify(cols.map((c) => `${c.table}:${c.col}${c.num ? " (num)" : ""} ${c.n}`)),
    );
    await context.close();
  }

  // --- A4: the back button, ✕ -------------------------------------------------------------------
  {
    const { context, page, errors } = await visit(COMMUNE);
    await drawn(page);
    await page.waitForTimeout(1200);
    const back = page.locator("#registre .mback");
    const first = (await back.textContent())?.trim();
    // a section of the commune (its tabs), then another fiche (its département, in the head)
    const tab = page.locator("#registre .band nav a[href*='#']").nth(2);
    const section = new URL(await tab.evaluate((a) => a.href)).hash;
    await tab.click();
    await page.waitForTimeout(800);
    // a link of that section to another fiche, where the reader is (a click scrolls to its link)
    const other = page
      .locator(
        `#registre ${section} a[href^='/registre/']:not([href*='#']):not([href^='${COMMUNE}'])`,
      )
      .first();
    await other.scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(
      () => document.querySelector("#registre .scroll")?.scrollTop ?? 0,
    );
    await other.click();
    await page.waitForFunction((p) => !location.pathname.startsWith(p), COMMUNE);
    await drawn(page);
    await page.waitForTimeout(1200);
    const second = (await back.textContent())?.trim();
    await back.click();
    // a check, not a crash, when the button goes elsewhere
    await page
      .waitForFunction((p) => location.pathname === p, COMMUNE, { timeout: 10000 })
      .then(() => drawn(page))
      .catch(() => {});
    await page.waitForTimeout(1500);
    const there = await page.evaluate(() => ({
      path: location.pathname,
      hash: location.hash,
      top: document.querySelector("#registre .scroll")?.scrollTop ?? 0,
    }));
    check(
      "A4: a commune opened cold says « ← Carte »; its section, another fiche: « ← Retour » brings the commune back with its section and its scroll",
      first === "← Carte" &&
        second === "← Retour" &&
        there.path === COMMUNE &&
        there.hash === section &&
        Math.abs(there.top - scrolled) <= 2 &&
        scrolled > 0,
      JSON.stringify({ first, second, section, scrolled, there }),
    );
    await page.locator("#registre [data-fermer]").first().click();
    await page.waitForTimeout(1000);
    const map = await page.evaluate(() => ({
      path: location.pathname,
      hidden: document.getElementById("registre")?.hidden,
      open: document.body.classList.contains("registre-ouvert"),
    }));
    check(
      "A4: ✕: the map, the register gone",
      !/^\/registre/.test(map.path) && map.hidden === true && !map.open && errors.length === 0,
      JSON.stringify({ map, errors }),
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok).length;
console.log(
  `${checks.length - failed}/${checks.length} checks passed (${engine}, commune ${INSEE})`,
);
process.exit(failed ? 1 : 0);
