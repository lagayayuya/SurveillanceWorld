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
import { launchOptions } from "./ui.mjs";

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

const browser = await (engine === "webkit" ? webkit : chromium).launch(launchOptions(engine));
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
      // the row's link covers the row (the rows' contract) and the band may lie over it once
      // scrolled: the keyboard's way, Enter on the row's link, chooses it
      await page.locator("#registre table.t tr.r a.rl").first().focus();
      await page.keyboard.press("Enter");
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
          // words read by a screen reader only (.sr: a head's help) are not on the edge
          if (n.parentElement?.closest(".sr, .sr-only")) continue;
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

  // --- the type (v2.3 point 2): a `font` shorthand the browser drops takes its rule's font with it
  // (the minifier once fused `font` and `font-stretch: 75%` into an invalid value, 24 rules) ---
  {
    const assets = join(DIST, "assets");
    const values = [];
    for (const f of readdirSync(assets).filter((n) => n.endsWith(".css")))
      for (const m of readFileSync(join(assets, f), "utf8").matchAll(/[{;]font:([^;}]+)/g))
        values.push(`${f}: ${m[1]}`);
    const { context, page } = await visit(`/registre/commune/${INSEE}`);
    await drawn(page);
    const bad = await page.evaluate(
      (vs) => vs.filter((v) => !CSS.supports("font", v.slice(v.indexOf(": ") + 2))),
      values,
    );
    check(
      "type: every `font` declaration of the built stylesheets is valid (CSS.supports)",
      values.length > 0 && bad.length === 0,
      `${values.length} declarations${bad.length ? `, invalid: ${bad.slice(0, 5).join(" | ")}` : ""}`,
    );
    // every control of the register in its fonts (a button inherits nothing by default: it would
    // be the system's), on a fiche and on a list
    const families = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#registre :is(button, input, select, textarea, a)")]
          .filter((x) => x.getClientRects().length > 0)
          .map((x) => ({
            what: `${x.tagName.toLowerCase()}.${[...x.classList].join(".")} « ${x.textContent.trim().slice(0, 20)} »`,
            family: getComputedStyle(x).fontFamily.split(",")[0].replace(/["']/g, "").trim(),
          }))
          .filter((x) => !/^(Archivo|Special Elite)$/.test(x.family)),
      );
    const onFiche = await families();
    await page.goto(`${APP}/registre/communes`);
    await drawn(page);
    const onList = await families();
    check(
      "type: every control of the register, on a fiche and a list, in Archivo or Special Elite",
      onFiche.length === 0 && onList.length === 0,
      JSON.stringify([...onFiche, ...onList].slice(0, 6)),
    );
    await context.close();
  }

  // --- the tree (v2.3 point 4): one name per type, the rail's; one rule for the breadcrumb ---
  {
    const { context, page } = await visit("/registre/");
    await drawn(page);
    const crumbs = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#registre .mtop .crumbs :is(a, .here)")].map((a) => ({
          l: a.textContent.trim(),
          href: a.getAttribute("href"),
        })),
      );
    const go = async (path) => {
      await page.evaluate((p) => {
        history.pushState({ rg: 2 }, "", p);
        dispatchEvent(new PopStateEvent("popstate", { state: { rg: 2 } }));
      }, path);
      await page.waitForTimeout(1500);
      await drawn(page);
    };
    // every list: its title, its rail row and its breadcrumb's last step say one name
    const lists = [];
    for (const path of [
      "/registre/communes",
      "/registre/intercommunalites",
      "/registre/departements",
      "/registre/acheteurs?cat=etat",
      "/registre/acheteurs?cat=transports",
      "/registre/entreprises",
      "/registre/contrats",
      "/registre/arretes",
    ]) {
      await go(path);
      const got = await page.evaluate(() => ({
        title: document.querySelector("#registre .v-liste h1")?.textContent.trim(),
        rail: document.querySelector("#registre .v-liste .ri.on")?.textContent.trim(),
        here: document.querySelector("#registre .mtop .crumbs .here")?.textContent.trim(),
      }));
      lists.push({ path, ...got });
    }
    check(
      "tree: each list's title is its rail row's name and its breadcrumb's step (« Titulaires », « Transports »)",
      lists.every((x) => x.title && x.rail?.startsWith(x.title) && x.here === x.title),
      JSON.stringify(
        lists.filter((x) => !(x.title && x.rail?.startsWith(x.title) && x.here === x.title)),
      ),
    );
    // a fiche: Registre › its list (reopening on its row) › the fiche; under a commune, the commune
    const want = [
      [
        "/registre/acheteur/256900994",
        ["Registre", "Transports"],
        "acheteurs?cat=transports&ligne=256900994",
      ],
      [
        "/registre/commune/69290/carte",
        ["Registre", "Communes", "Saint-Priest"],
        "communes?ligne=69290",
      ],
      [
        "/registre/commune/69290/documents",
        ["Registre", "Communes", "Saint-Priest"],
        "communes?ligne=69290",
      ],
      ["/registre/departement/69", ["Registre", "Départements"], "departements?ligne=69"],
    ];
    const fiches = [];
    for (const [path, steps, list] of want) {
      if (
        !existsSync(
          join(DATA, path.replace("/registre/", "").split("/").slice(0, 2).join("/") + ".json"),
        )
      )
        continue;
      await go(path);
      const c = await crumbs();
      const links = c.slice(0, -1);
      fiches.push({
        path,
        ok:
          links.map((x) => x.l).join(" › ") === steps.join(" › ") &&
          links[1]?.href === `/registre/${list}`,
        c: c.map((x) => x.l).join(" › "),
      });
    }
    check(
      "tree: a fiche's breadcrumb is Registre › its list › the fiche (› what is under it), the list's step on the fiche's row",
      fiches.length > 0 && fiches.every((x) => x.ok),
      JSON.stringify(fiches),
    );
    // a document opened from a fiche goes under that fiche
    await go(`/registre/commune/${INSEE}`);
    const nomCommune = (await crumbs()).at(-1)?.l;
    await page.locator('#registre a[href^="/registre/contrat/"]').first().click();
    await page.waitForURL(/\/registre\/contrat\//);
    await drawn(page);
    await page.waitForTimeout(800);
    const sous = (await crumbs()).map((x) => x.l);
    check(
      "tree: a document opened from its commune's fiche: Registre › Communes › the commune › the document",
      sous.length === 4 && sous[1] === "Communes" && sous[2] === nomCommune,
      JSON.stringify({ nomCommune, sous }),
    );
    // Drones et algorithmes is a door, not a section; the summary and a département open the
    // decrees on their drones
    await go("/registre/commune/69290");
    const band = await page.evaluate(() => ({
      secs: [...document.querySelectorAll("#registre .band nav a")].map((a) =>
        a.textContent.trim(),
      ),
      door: document.querySelector('#registre .band a.bporte[href$="/carte"]')?.textContent.trim(),
    }));
    await go("/registre/");
    const sommaire = await page.evaluate(
      () => !!document.querySelector('#registre a[href="/registre/arretes?disp=dr"]'),
    );
    await go("/registre/departement/69");
    const dep = await page.evaluate(
      () => document.querySelector("#registre .band a.bporte")?.getAttribute("href") ?? null,
    );
    check(
      "tree: « Drones et algorithmes » a door of the band, not a section; the summary's and the Rhône's open the drone decrees",
      !band.secs.some((x) => /drones/i.test(x)) &&
        /drones/i.test(band.door ?? "") &&
        sommaire &&
        dep === "/registre/arretes?dep=69&disp=dr",
      JSON.stringify({ band, sommaire, dep }),
    );
    // the list's step reopens the list on the fiche's row: marked, in view
    await go("/registre/communes?ligne=69290");
    await page.waitForTimeout(800);
    const row = await page.evaluate(() => {
      const tr = document.querySelector("#registre .v-liste tr.on");
      const r = tr?.getBoundingClientRect();
      return {
        name: tr?.textContent.replace(/\s+/g, " ").trim().slice(0, 30),
        top: r?.top,
        h: innerHeight,
      };
    });
    check(
      "tree: a list opened from the breadcrumb marks the fiche's row and scrolls to it",
      !!row.name?.includes("Saint-Priest") && row.top > 0 && row.top < row.h,
      JSON.stringify(row),
    );
    await context.close();
  }

  // --- the lists (v2.3 point 5): one « Départements » menu, one « Classer par », the panel ---
  {
    const { context, page } = await visit("/registre/communes");
    await drawn(page);
    const buttons = await page.locator("#registre .v-liste .tools .key").count();
    await page.click("#registre .v-liste .dancre.dep > button");
    await page.locator("#registre .v-liste .dmenu [role=option]").first().waitFor();
    const options = await page.locator("#registre .v-liste .dmenu [role=option]").count();
    await page.locator("#registre .v-liste .dmenu .dq input").fill("69");
    await page.locator("#registre .v-liste .dmenu [role=option]").first().click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const menu = await page.evaluate(() => ({
      url: location.search,
      open: !!document.querySelector("#registre .v-liste .dmenu"),
      chips: [...document.querySelectorAll("#registre .v-liste .dchip")].map((x) =>
        x.textContent.trim(),
      ),
      focus: document.activeElement?.closest(".dancre")?.className,
    }));
    check(
      "lists: one « Départements » button, its menu (every département with rows), chosen ones as chips, Escape back to the button",
      buttons === 0 &&
        options > 90 &&
        menu.url === "?dep=69" &&
        !menu.open &&
        menu.chips.length === 1 &&
        /Rhône/.test(menu.chips[0]) &&
        /dep/.test(menu.focus ?? ""),
      JSON.stringify({ buttons, options, menu }),
    );
    // the pointer away first: the menu closed over the rows, it may be on one already
    await page.mouse.move(5, 5);
    await page.hover("#registre .v-liste tbody tr >> nth=1", { force: true });
    await page.waitForTimeout(300);
    const panel = await page.evaluate(() => ({
      tiles: document.querySelectorAll("#registre .v-liste .panel .ptile").length,
      ouvrir: document.querySelector("#registre .v-liste .panel .pouvrir")?.getAttribute("href"),
      keys: !!document.querySelector("#registre .v-liste .panel .pclavier"),
    }));
    check(
      "lists: the hovered row's panel, its five figures, « Ouvrir la fiche », the keys' line",
      panel.tiles === 5 && /^\/registre\/commune\//.test(panel.ouvrir ?? "") && panel.keys,
      JSON.stringify(panel),
    );
    await context.close();
  }

  // --- the band follows the right section (v2.2 point 4): clicked, marked at once and after its
  // scroll; scrolled, the one whose title has passed under the stuck band ---
  {
    const { context, page } = await visit(`/registre/commune/${INSEE}`);
    await drawn(page);
    await page.waitForTimeout(800);
    const secs = await page.evaluate(() =>
      [...document.querySelectorAll("#registre .band nav a[data-sec]")].map((a) => a.dataset.sec),
    );
    const cur = () =>
      page.evaluate(
        () =>
          document.querySelector('#registre .band nav a[aria-current="true"]')?.dataset.sec ?? null,
      );
    const clicks = [];
    for (const id of secs) {
      await page.click(`#registre .band nav a[data-sec="${id}"]`);
      const now = await cur();
      await page.waitForTimeout(1600);
      clicks.push({ id, now, after: await cur() });
    }
    // scrolled by hand: each section's title just under the band, then just above its bottom
    const scrolled = [];
    for (const id of secs.slice(1)) {
      await page.evaluate((x) => {
        const s = document.querySelector("#registre .scroll");
        const band = document.querySelector("#registre .band").getBoundingClientRect().height;
        const sec = document.getElementById(x);
        s.scrollTo({
          top:
            s.scrollTop +
            sec.getBoundingClientRect().top -
            s.getBoundingClientRect().top -
            band +
            2,
          behavior: "instant",
        });
      }, id);
      await page.waitForTimeout(300);
      scrolled.push({
        id,
        got: await cur(),
        // at the page's end a title cannot reach the band: its last section is the current one
        fin: await page.evaluate(() => {
          const s = document.querySelector("#registre .scroll");
          return s.scrollTop + s.clientHeight >= s.scrollHeight - 4;
        }),
      });
    }
    check(
      "the band: a section clicked is marked at once and after its scroll; scrolled, the one under the band",
      secs.length > 2 &&
        clicks.every((c) => c.now === c.id && c.after === c.id) &&
        scrolled.every((x) => x.got === (x.fin ? secs.at(-1) : x.id)),
      JSON.stringify({ clicks, scrolled }),
    );
    await context.close();
  }

  // --- accessibility (v2.3 point 9): no aria-selected outside a listbox, a tab list or a grid; the
  // focus leaving a list's table takes its row out of the panel; a key's focus visible ---
  {
    const { context, page } = await visit(`/registre/commune/${INSEE}`);
    await drawn(page);
    const orphelins = async () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll("#registre [aria-selected]")].filter(
            (x) => !x.closest('[role="listbox"], [role="tablist"], [role="grid"]'),
          ).length,
      );
    const surFiche = await orphelins();
    await page.goto(`${APP}/registre/communes`);
    await drawn(page);
    const surListe = await orphelins();
    // the keyboard into the table's first row, then out of it
    await page.locator("#registre .v-liste tbody tr a").first().focus();
    await page.waitForTimeout(300);
    const dedans = await page.evaluate(
      () => document.querySelectorAll("#registre .v-liste .panel .ptile").length,
    );
    await page.locator("#registre .v-liste .pied button").first().focus();
    await page.waitForTimeout(300);
    const dehors = await page.evaluate(
      () => document.querySelectorAll("#registre .v-liste .panel .ptile").length,
    );
    // a key focused by the keyboard shows it (a ring of 2 px or more, solid or dashed: WebKit's Tab
    // lands on another control than Chromium's, each with its own ring)
    await page.keyboard.press("Shift+Tab");
    await page.locator("#registre .v-liste .dbtn").first().focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const outline = await page.evaluate(() => {
      const x = document.activeElement;
      const st = x ? getComputedStyle(x) : null;
      return st ? `${st.outlineStyle} ${st.outlineWidth}` : "";
    });
    check(
      "accessibility: no aria-selected out of a listbox, tabs or grid; Tab out of a list empties its panel; a focused key shows it",
      surFiche === 0 &&
        surListe === 0 &&
        dedans > 0 &&
        dehors === 0 &&
        /^(solid|dashed) [2-9]px/.test(outline),
      JSON.stringify({ surFiche, surListe, dedans, dehors, outline }),
    );
    await context.close();
  }

  // --- the drone view frames its commune (v2.4 point 1): Lyon, a commune of the Rhône without a
  // drone act, a commune of a département not collected; opened by its address, then reached in
  // the site (from Lyon's view: its fiche, then its « Drones » door); framed once, its outline
  // drawn, the map tilted, the centre in the commune ---
  {
    const box = (insee) => {
      const f = join(DATA, "commune", `${insee}.json`);
      return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")).commune?.bbox ?? null) : null;
    };
    const cases = ["69123", "69149", "94081"].filter((x) => box(x));
    // the act's zone's box, from Lyon's file (its site's polygon)
    const ACTE = "69-2026-10-05-00003";
    const zone = (() => {
      const f = join(DATA, "commune", "69123.json");
      if (!existsSync(f)) return null;
      const d = JSON.parse(readFileSync(f, "utf8"));
      const z = d.zones?.zones?.find((x) => x.acte === ACTE);
      const site = d.zones?.sites?.find((x) => x.id === z?.site);
      const g = site?.parts?.["69123"]?.in;
      const pts =
        g?.type === "MultiPolygon" ? g.coordinates.flat(2) : (g?.coordinates?.flat() ?? []);
      if (!pts.length) return null;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    })();
    const VIEWS = [
      [1440, 900],
      [390, 845],
    ];
    const found = [];
    const seen = [];
    for (const [w, h] of VIEWS) {
      const context = await browser.newContext({
        viewport: { width: w, height: h },
        locale: "fr-FR",
        colorScheme: w < 600 ? "dark" : "light",
        // the framing as it lands, the slow turn aside (its own check below): a box turned
        // spills by its corners
        reducedMotion: "reduce",
      });
      await context.addInitScript(() => {
        try {
          localStorage.setItem("lacarte.welcome", "1");
        } catch {}
      });
      const page = await context.newPage();
      await page.route("**/api/**", (r) =>
        r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"no_session"}' }),
      );
      // the CI extract is a few streets of Clichy, and the map brings a view taken outside its
      // region back into it (bounds.ts): here the region is France, as in production
      await page.route("**/tiles/meta.json", async (r) => {
        const res = await r.fetch();
        const meta = await res.json();
        r.fulfill({ response: res, json: { ...meta, bounds: [-5.2, 41.3, 9.6, 51.1] } });
      });
      /** Where the map is once the view has framed it, and whether it moved again after. */
      const framed = async (insee, how) => {
        await page.waitForFunction(() => document.querySelector("#registre .v-carte"), null, {
          timeout: 20000,
        });
        await page.waitForTimeout(2500);
        const at = () =>
          page.evaluate(
            ([b]) => {
              const m = window.__map;
              const c = m.getCenter();
              const pad = m.getPadding();
              const W = m.getCanvas().clientWidth;
              const H = m.getCanvas().clientHeight;
              // the commune's corners on the screen, in the part of the map left free
              const pts = [
                [b[0], b[1]],
                [b[2], b[1]],
                [b[2], b[3]],
                [b[0], b[3]],
              ].map((p) => m.project(p));
              const free = [pad.left, pad.top, W - pad.right, H - pad.bottom];
              const fits = pts.every(
                (p) =>
                  p.x >= free[0] - 2 &&
                  p.x <= free[2] + 2 &&
                  p.y >= free[1] - 2 &&
                  p.y <= free[3] + 2,
              );
              return {
                c: [+c.lng.toFixed(4), +c.lat.toFixed(4)],
                z: +m.getZoom().toFixed(2),
                pitch: Math.round(m.getPitch()),
                dans: c.lng > b[0] && c.lng < b[2] && c.lat > b[1] && c.lat < b[3],
                fits,
                outline: !!(m.getLayer("rg-cd-commune") || m.getLayer("rg-cd-commune-admin")),
              };
            },
            [box(insee)],
          );
        const a = await at();
        await page.waitForTimeout(4500);
        const b = await at();
        const r = { insee, how, w, ...a, moved: a.c.join() !== b.c.join() || a.z !== b.z };
        seen.push(r);
        if (!r.dans || !r.fits || !r.outline || r.pitch < 30 || r.moved) found.push(r);
      };
      for (const insee of cases) {
        await page.goto(`${APP}/registre/commune/${insee}/carte`);
        await framed(insee, "address");
      }
      // « Voir sur la carte » on an act opened by its address (Lyon, 5 October 2026, « Périmètre
      // Université… »): the button there, the zone within the free part, the tilt capped, the
      // camera above the tallest volume
      if (zone) {
        await page.goto(`${APP}/registre/commune/69123/carte?acte=${ACTE}`);
        await page.waitForFunction(() => document.querySelector("#registre .v-carte"), null, {
          timeout: 20000,
        });
        await page.waitForTimeout(2500);
        const voir = page.locator("#registre .cd-lieux button.lk").first();
        const there = (await voir.count()) > 0;
        if (there) {
          await voir.scrollIntoViewIfNeeded();
          await voir.click();
          await page.waitForTimeout(3000);
        }
        const r = await page.evaluate(
          ([b]) => {
            const m = window.__map;
            const pad = m.getPadding();
            const W = m.getCanvas().clientWidth;
            const H = m.getCanvas().clientHeight;
            const fits = [
              [b[0], b[1]],
              [b[2], b[1]],
              [b[2], b[3]],
              [b[0], b[3]],
            ]
              .map((p) => m.project(p))
              .every(
                (p) =>
                  p.x >= pad.left - 2 &&
                  p.x <= W - pad.right + 2 &&
                  p.y >= pad.top - 2 &&
                  p.y <= H - pad.bottom + 2,
              );
            const hs = m
              .querySourceFeatures("rg-cd-zones")
              .filter((f) => f.geometry.type !== "Point" && !f.properties.e)
              .map((f) => f.properties.h ?? 0);
            const pxm =
              (512 * 2 ** m.getZoom()) /
              (40075016.686 * Math.cos((m.getCenter().lat * Math.PI) / 180));
            const alt = (1.5 * H * Math.cos((m.getPitch() * Math.PI) / 180)) / pxm;
            return {
              fits,
              pitch: Math.round(m.getPitch()),
              alt: Math.round(alt),
              hmax: Math.max(0, ...hs),
            };
          },
          [zone],
        );
        const ok = there && r.fits && r.pitch === (w < 600 ? 35 : 50) && r.alt >= 2 * r.hmax - 1;
        seen.push({ insee: "69123", how: "voir", w });
        if (!ok) found.push({ voir: there, w, ...r });
      }
      // reached in the site: from Lyon's drone view, the fiche (a link), then its door
      for (const insee of cases.filter((x) => x !== "69123")) {
        await page.goto(`${APP}/registre/commune/69123/carte`);
        await framed("69123", "address");
        await page.evaluate((i) => {
          const a = document.createElement("a");
          a.href = `/registre/commune/${i}`;
          a.id = "smoke-aller";
          a.textContent = "aller";
          document.querySelector("#registre #vue").append(a);
        }, insee);
        await page.click("#smoke-aller");
        await page.waitForSelector('#registre a.bporte[href$="/carte"]', { timeout: 20000 });
        await page.click('#registre a.bporte[href$="/carte"]');
        await framed(insee, "site");
      }
      await context.close();
    }
    check(
      "the drone view frames its commune, once, outlined, tilted (by its address and in the site); « Voir sur la carte » frames its zone",
      cases.length === 3 && zone !== null && found.length === 0,
      JSON.stringify(found.length ? found : seen.map((r) => `${r.insee}/${r.how}/${r.w}`)),
    );
  }

  // --- the slow turn at the opening (v2.4 point 3): it turns, a drag stops it for good; none
  // under reduced motion ---
  {
    const turn = {};
    for (const reduce of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        locale: "fr-FR",
        reducedMotion: reduce ? "reduce" : "no-preference",
      });
      await context.addInitScript(() => {
        try {
          localStorage.setItem("lacarte.welcome", "1");
        } catch {}
      });
      const page = await context.newPage();
      await page.route("**/api/**", (r) =>
        r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"no_session"}' }),
      );
      await page.goto(`${APP}/registre/commune/${INSEE}/carte`);
      await page.waitForFunction(() => document.querySelector("#registre .v-carte"), null, {
        timeout: 20000,
      });
      await page.waitForTimeout(2500);
      const bearing = () => page.evaluate(() => window.__map.getBearing());
      const during = async (ms) => {
        const a = await bearing();
        await page.waitForTimeout(ms);
        return Math.abs((await bearing()) - a);
      };
      if (reduce) turn.reduced = await during(2500);
      else {
        turn.turns = await during(2500);
        await page.mouse.move(300, 500);
        await page.mouse.down();
        await page.mouse.move(380, 540, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        turn.afterDrag = await during(2500);
      }
      await context.close();
    }
    check(
      "the drone view turns slowly at its opening, stops for good under a hand, never under reduced motion",
      turn.turns > 5 && turn.afterDrag < 0.01 && turn.reduced < 0.01,
      JSON.stringify(turn),
    );
  }

  // --- the head and the band never overflow (v2.3 points 2 and 6, Ju: « Lyon » touching
  // « Drones »): on a wide screen and a phone, long names, the drone view's panel ---
  {
    const pages = [
      "/registre/commune/69123/carte",
      "/registre/commune/38384",
      "/registre/commune/38384/carte",
      "/registre/entreprise/314684960",
    ].filter((p) => existsSync(join(DATA, `${p.split("/").slice(2, 4).join("/")}.json`)));
    const found = [];
    for (const [w, h] of [
      [1280, 800],
      [390, 845],
    ]) {
      const context = await browser.newContext({
        viewport: { width: w, height: h },
        locale: "fr-FR",
      });
      await context.addInitScript(() => {
        try {
          localStorage.setItem("lacarte.welcome", "1");
        } catch {}
      });
      const page = await context.newPage();
      await page.route("**/api/**", (r) =>
        r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"no_session"}' }),
      );
      for (const path of pages) {
        await page.goto(`${APP}${path}`);
        await drawn(page);
        await page.waitForTimeout(1200);
        const bad = await page.evaluate(() => {
          const out = [];
          const name = (x) =>
            `${x.tagName.toLowerCase()}.${[...x.classList].join(".")} « ${x.textContent.trim().slice(0, 24)} »`;
          for (const box of document.querySelectorAll(
            "#registre :is(.mtop, .ttop, .band, .tband)",
          )) {
            const B = box.getBoundingClientRect();
            if (!B.width) continue;
            for (const x of box.querySelectorAll("*")) {
              const r = x.getBoundingClientRect();
              if (!r.width || x.closest("svg, .sr")) continue;
              const s = getComputedStyle(x);
              const scrolls = /auto|scroll/.test(s.overflowX) || x.closest('[style*="overflow"]');
              // its words wider than itself, not ended by an ellipsis nor in a strip that scrolls:
              // cut, or spilling over its neighbour when its overflow is visible
              if (x.scrollWidth > x.clientWidth + 1 && s.textOverflow !== "ellipsis" && !scrolls)
                out.push(`${s.overflowX === "visible" ? "spill" : "cut"}: ${name(x)}`);
              // out of its box (a strip that scrolls aside)
              if (!x.closest("nav") && (r.right > B.right + 1 || r.left < B.left - 1))
                out.push(`out: ${name(x)}`);
            }
            // a tab or a door cut by its strip, when the strip does not scroll
            for (const nav of box.querySelectorAll("nav")) {
              const N = nav.getBoundingClientRect();
              if (/auto|scroll/.test(getComputedStyle(nav).overflowX)) continue;
              for (const a of nav.children) {
                const r = a.getBoundingClientRect();
                if (r.width && (r.right > N.right + 1 || r.right > B.right + 1))
                  out.push(`clipped: ${name(a)}`);
              }
            }
            // two steps of the breadcrumb on one line never overlap
            const steps = [...box.querySelectorAll(".crumbs > *")].map((x) => [
              x,
              x.getBoundingClientRect(),
            ]);
            for (let i = 1; i < steps.length; i++) {
              const [, a] = steps[i - 1];
              const [x, b] = steps[i];
              if (Math.abs(a.top - b.top) < 4 && a.right > b.left + 1)
                out.push(`overlap: ${name(x)}`);
            }
          }
          return out;
        });
        for (const b of bad) found.push(`${w}px ${path}: ${b}`);
      }
      await context.close();
    }
    check(
      "the head and the band, 1 280 and 390 px, long names and the drone view's panel: no step cut, none overlapping, none out",
      pages.length > 0 && found.length === 0,
      JSON.stringify(found.slice(0, 8)),
    );
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
