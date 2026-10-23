// Smoke test of the punk camera sheet's rows (lot 3.2, mockup 17a: src/chips.ts,
// src/theme/punk/chips.css and sheet.css), on the production build of the CI extract, in
// light and dark, on a phone and a wide screen: real sheets of the CI cameras whose facts
// come from every source the data has (OSM, a default, answers and contributions on site or
// not, a field drawn almost nil, a camera verified gone), then every certainty against every
// source drawn by chips.ts itself in the open sheet (states the CI data does not hold:
// identified from OSM, « en attente de revue »…). For each row: a definition list's `div`
// of `dt` and `dd`, nothing in it a button, a link or focusable; a source tag whenever it
// has a certainty (but a default value's « supposé », which the box's title says); the
// certainty in 17a's language — the value alone (identified), « ~ » before it (estimated),
// in the « Supposé » box (default), its « ? » only where « Compléter » can answer — and its word in the row's
// hidden text; its text 4.5:1 and its leader 3:1 on what is painted under them (computed
// colours). « Calcul ? » opens the explanations (aria-expanded) and closes them. With
// axe-core (the dev dependency, or --axe PATH / LACARTE_AXE): no violation of WCAG 2.2 A/AA
// in the sheet, label-content-name-mismatch included. With --out, captures of every state.
// Exits non-zero if a check failed.
//   node bench/smoke-chips.mjs [--browser chromium|webkit] [--axe PATH] [--out DIR] [--port N]
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { join, resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { returning } from "./ui.mjs";

/** The map at rest (its next idle, 4 s at most), then a short pause. */
async function idle(page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        window.__map.once("idle", r);
        window.__map.triggerRepaint();
        setTimeout(r, 4000);
      }),
  );
  await page.waitForTimeout(400);
}

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const engine = arg("--browser", "chromium");
// axe-core is a dev dependency (package.json); --axe or LACARTE_AXE point at another copy.
const AXE = arg(
  "--axe",
  process.env.LACARTE_AXE ?? createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
);
const OUT = arg("--out", null) && resolve(arg("--out"));
const PORT = Number(arg("--port", "4188"));
const APP = `http://localhost:${PORT}/`;
if (OUT) mkdirSync(OUT, { recursive: true });

// CI cameras (tests/fixtures/contrib-ci.jsonl applied by the CI build), the source each row
// must show, by its label, and the rows the box must hold.
const CAMERAS = [
  // Answers on site (height) and elsewhere (type, direction, tilt), seen on site.
  [
    "n12035135119",
    "#18/48.897946/2.233871",
    { Type: "answer", Direction: "answer", Hauteur: "site", Inclinaison: "answer" },
    ["Angle de champ", "Vision de nuit"],
  ],
  // Unknown type and direction, height by default; who films from an answer.
  ["n9622344411", "#18/48.897581/2.240147", { Statut: "answer" }, ["Type", "Direction", "Hauteur"]],
  // Verified gone, on site: the « Disparue » stamp, no tickets.
  ["n1923568277", "#18/48.895771/2.239842", { Type: "osm" }, []],
  // Moved and seen on site.
  ["n1925222790", "#18/48.896031/2.237693", { Position: "site", Type: "osm" }, []],
  // Added (not on site) with answers.
  ["cadd000020000", "#18/48.897519/2.234453", { Position: "contrib", Type: "answer" }, []],
  // A field drawn almost nil: a band, neither source nor certainty.
  ["n1932117216", "#18/48.896421/2.239843", { Type: "osm" }, []],
  // 17a's twin: a public dome, its operator's name from OSM, a verification.
  ["n998633844", "#18/48.897281/2.238583", { Exploitant: "osm", Statut: "osm" }, []],
];

// Every certainty against every source, as chips.ts draws them; then what has none and long
// values that wrap.
const SOURCES = ["site", "answer", "contrib", "osm", "assumed", "pending"];
const LONG = "1er étage (≈ 5 m), d'après une réponse sur place (octobre 2026)";
const MATRIX = [
  ...[2, 1, 0].map((cert) => [
    `cert${cert}`,
    SOURCES.map((source) => ({
      key: "type",
      label: "Type",
      value: "fixe",
      cert,
      source,
      month: "2026-10",
    })),
  ]),
  [
    "other",
    [
      { label: "Exploitant", value: "Ville de Courbevoie", source: "osm" },
      { key: "height", label: "Hauteur", value: LONG, cert: 1, source: "site", month: "2026-10" },
      {
        key: "fov",
        label: "Angle de champ",
        value: "~58° grand angle, orientable sur 360°",
        cert: 0,
      },
      { key: "direction", label: "Direction", value: "non relevée", cert: 0, source: "pending" },
    ],
  ],
];

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Every row of the open sheet: its label, source, certainty as written and as said,
 * whether something in it acts, and contrast against what is painted under it. */
const audit = (page) =>
  page.evaluate(() => {
    const rgba = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      const v = m[1]
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return [v[0], v[1], v[2], v[3] ?? 1];
    };
    const lum = ([r, g, b]) => {
      const f = (x) => {
        const c = x / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    // What is painted under an element: its backgrounds, blended up to an opaque one.
    const under = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const c = rgba(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let out = [255, 255, 255];
      for (const [r, g, b, a] of layers.reverse())
        out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
      return out;
    };
    const said = (e) => [...e.querySelectorAll(".sheet-sr")].map((s) => s.textContent).join("");
    return [...document.querySelectorAll("#sheet .facts > .fact")].map((row) => {
      const dt = row.querySelector(":scope > dt");
      const dd = row.querySelector(":scope > dd");
      const tag = dt?.querySelector(".chip-tag");
      const r = row.getBoundingClientRect();
      const low = [];
      for (const part of [dt, dd, tag].filter(Boolean)) {
        // The parts' own text: the hidden words are not painted.
        const fg = rgba(getComputedStyle(part).color);
        low.push([part.tagName === "SPAN" ? "tag" : part.tagName, ratio(fg, under(part)), 4.5]);
      }
      const leader = getComputedStyle(row, "::after");
      low.push(["leader", ratio(rgba(leader.borderBottomColor), under(row)), 3]);
      const label = dt ? ([...dt.childNodes].find((n) => n.nodeType === 3)?.nodeValue ?? "") : "";
      return {
        label: label.trim(),
        structure:
          row.tagName === "DIV" &&
          row.parentElement?.tagName === "DL" &&
          [...row.children].map((c) => c.tagName).join(",") === "DT,DD",
        acts:
          Boolean(row.querySelector("button, a, input, [tabindex]")) ||
          row.hasAttribute("tabindex"),
        source: tag ? tag.className.replace("chip-tag ", "") : null,
        month: tag ? /\d\d\/\d\d/.test(tag.textContent) : false,
        approx: Boolean(dd?.querySelector(".approx")),
        mark: Boolean(dd?.querySelector(".q")),
        box: Boolean(row.closest(".sheet-assumed")),
        word: dd ? said(dd).replace(/^,\s*/, "") : "",
        value: dd?.innerText ?? "",
        h: Math.round(r.height),
        poor: low.filter(([, v, min]) => v < min).map(([k, v]) => `${k} ${v.toFixed(2)}`),
        least: Math.min(...low.filter(([, , min]) => min === 4.5).map(([, v]) => v)),
      };
    });
  });

const WORDS = ["identifiée", "estimée", "par défaut"];
/** The rows whose value is a number (chips.ts NUMERIC): height, field of view, zoom. */
const NUMERIC_LABELS = ["Hauteur", "Angle de champ", "Zoom"];
/** The row checks, for one sheet. */
function judge(where, rows, want = {}, boxed = [], marks = false) {
  check(`${where}: rows drawn`, rows.length >= 3, `${rows.length}`);
  const bad = (f) => rows.filter(f).map((c) => `${c.label}: ${JSON.stringify(c)}`);
  check(
    `${where}: rows are a dl's div of dt and dd, nothing in them acts`,
    bad((c) => !c.structure || c.acts).length === 0,
    bad((c) => !c.structure || c.acts).join(" | "),
  );
  // 17a's language: an estimated number « ~ » (a category its value alone: DECISIONS
  // 2026-10-08), default the box, its « ? » only where « Compléter » can answer (`marks`:
  // every default row in the matrix; on a camera, its sheet's own, below), the word in the
  // hidden text, whenever there is a certainty.
  const numeric = (c) => NUMERIC_LABELS.includes(c.label);
  const wrong = (c) =>
    (c.word === "estimée" && numeric(c)) !== c.approx ||
    (c.word === "par défaut") !== c.box ||
    (marks ? c.mark !== c.box : c.mark && !c.box) ||
    (c.word === "identifiée" && (c.approx || c.box)) ||
    (c.word && !WORDS.includes(c.word));
  check(
    `${where}: certainty in 17a's language, its word said`,
    bad(wrong).length === 0,
    bad(wrong).join(" | "),
  );
  // A row with a certainty says its source: its tag, or the box's title (a default's).
  const unsourced = (c) => c.word && !c.source && !(c.box && c.word === "par défaut");
  check(
    `${where}: a certainty always with its source`,
    bad(unsourced).length === 0,
    bad(unsourced).join(" | "),
  );
  const monthless = (c) => ["site", "answer", "contrib"].includes(c.source) && !c.month;
  check(
    `${where}: a contribution's tag says its month`,
    bad(monthless).length === 0,
    bad(monthless).join(" | "),
  );
  check(
    `${where}: text 4.5:1, leader 3:1`,
    bad((c) => c.poor.length).length === 0,
    `least ${Math.min(...rows.map((c) => c.least)).toFixed(2)} ${bad((c) => c.poor.length).join(" | ")}`,
  );
  const missing = Object.entries(want).filter(
    ([label, source]) => !rows.some((c) => c.label === label && c.source === source),
  );
  if (Object.keys(want).length)
    check(
      `${where}: sources`,
      missing.length === 0,
      `${missing.map(([l, s]) => `${l} wants ${s}`).join(", ")} | ${rows.map((c) => `${c.label}=${c.source}/${c.word}`).join(", ")}`,
    );
  const notBoxed = boxed.filter((label) => !rows.some((c) => c.label === label && c.box));
  if (boxed.length)
    check(`${where}: the box holds the default values`, notBoxed.length === 0, notBoxed.join(", "));
}

async function axe(page, where) {
  if (!AXE) return;
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    const nodes = (r) => r.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(" ")}`));
    // axe leaves out what is not on the screen: the sheet in view in turn, top to bottom
    // (the paper scrolls, under its pinned head on a phone).
    const sheet = document.querySelector("#sheet");
    const scroller =
      [sheet.querySelector(".sheet-body"), sheet.querySelector(".sheet-paper")].find(
        (e) =>
          e &&
          e.scrollHeight > e.clientHeight + 1 &&
          /auto|scroll/.test(getComputedStyle(e).overflowY),
      ) ?? null;
    const out = new Set();
    let passes = 0;
    const steps = scroller ? Math.ceil(scroller.scrollHeight / scroller.clientHeight) + 1 : 1;
    for (let i = 0; i < steps; i++) {
      if (scroller) scroller.scrollTop = i * scroller.clientHeight;
      await new Promise((r) => setTimeout(r, 50));
      const r = await window.axe.run(sheet, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      for (const n of nodes(r.violations)) out.add(n);
      passes += r.passes.flatMap((v) => v.nodes).length;
    }
    if (scroller) scroller.scrollTop = 0;
    return { violations: [...out], passes };
  });
  check(
    `${where}: axe WCAG 2.2 A/AA none in the sheet (${found.passes} passes)`,
    found.violations.length === 0,
    found.violations.join(" | "),
  );
}

/** The phone's sheet at full height (the handle steps peek, half, full). */
async function fullSheet(page) {
  for (let i = 0; i < 3; i++) {
    const state = await page.evaluate(() => document.getElementById("sheet").dataset.state);
    if (state === "full" || !(await page.locator("#sheet .sheet-grab").isVisible())) return;
    await page.locator("#sheet .sheet-grab").click();
    await page.waitForTimeout(400);
  }
}

/** The sheet, its facts in view (its scroller brought to them, never the page). */
const shot = async (page, name) => {
  if (!OUT) return;
  await page.evaluate(() => {
    const facts = document.querySelector("#sheet .sheet-facts");
    const scroller = [
      document.querySelector("#sheet .sheet-body"),
      document.querySelector("#sheet .sheet-paper"),
    ].find(
      (e) =>
        e &&
        e.scrollHeight > e.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(e).overflowY),
    );
    if (facts && scroller)
      scroller.scrollTop +=
        facts.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  });
  await page.locator("#sheet").screenshot({ path: join(OUT, `${name}.png`) });
};

const CHIPS_JS = stripTypeScriptTypes(readFileSync(join(WEB, "src/chips.ts"), "utf8"));
const FR = JSON.parse(readFileSync(join(WEB, "src/locales/fr.json"), "utf8"));

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = returning(await (engine === "chromium" ? chromium : webkit).launch());
try {
  for (const [device, options] of [
    ["phone", devices["iPhone 14"]],
    ["desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
  ]) {
    for (const mode of ["clair", "sombre"]) {
      const context = await browser.newContext({ ...options, locale: "fr-FR" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      for (const [cam, hash, want, boxed] of CAMERAS) {
        const where = `${device} ${mode} ${cam}`;
        // A sheet that does not come fails its own check, not the run.
        try {
          await sheetChecks(page, where, cam, hash, mode, device, want, boxed);
        } catch (e) {
          check(`${where}: the sheet opens`, false, String(e).split("\n")[0]);
        }
      }
      try {
        await calculAndMatrix(page, device, mode);
      } catch (e) {
        check(`${device} ${mode}: « Calcul ? » and the matrix`, false, String(e).split("\n")[0]);
      }
      try {
        await longTitle(page, device, mode);
      } catch (e) {
        check(`${device} ${mode}: a long title`, false, String(e).split("\n")[0]);
      }
      check(`${device} ${mode}: no page error`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);

/** One camera's sheet: its rows, its stamp, axe, a capture. */
async function sheetChecks(page, where, cam, hash, mode, device, want, boxed) {
  await page.goto(`${APP}?mode=${mode}&cam=${cam}${hash}`);
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById("sheet").hidden, null, {
    timeout: 20000,
  });
  // The punk sheet (its chunk in), and an Archivo face actually loaded: fonts.check() is true
  // while no face of the family is registered yet, and the punk fonts are registered at the
  // map's first idle.
  await page.waitForSelector("#sheet .sheet-paper", { timeout: 20000 });
  await page.waitForFunction(
    () =>
      [...document.fonts].some(
        (f) => f.family.replace(/["']/g, "") === "Archivo" && f.status === "loaded",
      ),
    null,
    { timeout: 20000 },
  );
  if (device === "phone") await fullSheet(page);
  const rows = await audit(page);
  judge(where, rows, want, boxed);
  // The « ? » only where « Modifier » asks (questions.ts editorAnswerable): never the field
  // of view nor the night vision; the box is 17a's « Supposé · à compléter » with one, 4b's
  // « Supposé d'après le type » without.
  const boxTitle = await page.evaluate(
    () => document.querySelector("#sheet .sheet-assumed h3")?.textContent ?? null,
  );
  const marked = rows.filter((c) => c.mark).map((c) => c.label);
  if (boxTitle !== null)
    check(
      `${where}: the box's title says whether « Modifier » asks one of its rows`,
      boxTitle === (marked.length ? "Supposé · à compléter" : "Supposé d'après le type") &&
        !marked.some((l) => ["Angle de champ", "Vision de nuit", "Zoom"].includes(l)),
      `${boxTitle} | « ? » on ${marked.join(", ") || "nothing"}`,
    );
  // No decorative tape over the paper (DECISIONS 2026-10-09, « Punk map after the iPhone
  // test… »): the sheet's pseudo-elements draw nothing.
  const tapes = await page.evaluate(() =>
    ["::before", "::after"].map(
      (pseudo) => getComputedStyle(document.getElementById("sheet"), pseudo).content,
    ),
  );
  check(
    `${where}: no decorative tape`,
    tapes.every((c) => c === "none" || c === "normal"),
    tapes.join(" "),
  );
  if (cam === "n1923568277")
    check(
      `${where}: verified gone, its stamp in place of the tickets`,
      await page.evaluate(
        () =>
          Boolean(document.querySelector("#sheet .sheet-stamp.gone")) &&
          !document.querySelector("#sheet .tickets"),
      ),
    );
  await axe(page, where);
  await shot(page, `${device}-${mode}-${cam}`);
  // Let the sheet's fit and its tiles settle before the next link: WebKit reports the
  // fetches a navigation cancels as "access control" page errors (seen in CI).
  await idle(page);
}

/** « Calcul ? » on the last sheet, then every certainty against every source. */
async function calculAndMatrix(page, device, mode) {
  // « Calcul ? » opens the explanations, a second press closes them.
  const toggle = page.locator("#sheet .how-toggle");
  await toggle.click();
  await page.waitForTimeout(150);
  const open = await page.evaluate(() => ({
    expanded: document.querySelector("#sheet .how-toggle")?.getAttribute("aria-expanded"),
    text: document.querySelector("#sheet .how")?.textContent ?? "",
    shown: !document.querySelector("#sheet .how")?.hidden,
  }));
  check(
    `${device} ${mode}: « Calcul ? » opens the explanations, each row's with its certainty`,
    open.expanded === "true" && open.shown && /estimée/.test(open.text),
    open.text.slice(0, 120),
  );
  await shot(page, `${device}-${mode}-calcul`);
  await toggle.click();
  await page.waitForTimeout(150);
  check(
    `${device} ${mode}: a second press closes them`,
    await page.evaluate(
      () =>
        document.querySelector("#sheet .how-toggle")?.getAttribute("aria-expanded") === "false" &&
        document.querySelector("#sheet .how")?.hidden,
    ),
  );
  // Every certainty against every source, drawn by chips.ts in the open sheet: the sourced
  // rows on the paper, the default ones in the box.
  for (const [name, facts] of MATRIX) {
    await page.evaluate(
      async ([code, fr, list]) => {
        const m = await import(
          `data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(code)))}`
        );
        const t = (k, p = {}) => fr[k].replace(/\{(\w+)\}/g, (_, n) => String(p[n] ?? ""));
        const month = (x) =>
          new Date(`${x}-15T12:00:00`).toLocaleDateString("fr", {
            year: "numeric",
            month: "long",
          });
        const paper = document.querySelector("#sheet .sheet-facts .facts");
        let box = document.querySelector("#sheet .sheet-assumed .facts");
        if (!box) {
          const section = document.createElement("section");
          section.className = "sheet-assumed";
          box = document.createElement("dl");
          box.className = "facts";
          section.append(box);
          paper.closest(".sheet-facts").after(section);
        }
        paper.replaceChildren(
          ...list.filter((f) => f.cert !== 0).map((f) => m.factRow(f, t, month)),
        );
        box.replaceChildren(
          ...list.filter((f) => f.cert === 0).map((f) => m.factRow(f, t, month, true)),
        );
      },
      [CHIPS_JS, FR, facts],
    );
    judge(`${device} ${mode} matrix ${name}`, await audit(page), {}, [], true);
    await axe(page, `${device} ${mode} matrix ${name}`);
    await shot(page, `${device}-${mode}-matrix-${name}`);
  }
}

/** A title longer than the line (DECISIONS 2026-10-09, « Punk sheets on a phone… »: it wraps
 * on two lines or shrinks, never under ↑ and ×), drawn by chips.ts in the open sheet's head:
 * « Paris 12e Arrondissement », whose « ARRONDISSEMENT » is wider than the phone's column;
 * every word whole on one line, left of the buttons, and nothing makes the sheet scroll
 * sideways. */
async function longTitle(page, device, mode) {
  const got = await page.evaluate(async (code) => {
    const m = await import(
      `data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(code)))}`
    );
    const name = "Paris 12e Arrondissement";
    const h2 = m.cutout(name, name);
    document.querySelector("#sheet .sheet-head .headline").replaceWith(h2);
    m.fitTitle(h2);
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 300));
    const words = [...h2.querySelectorAll(".cut-word")].map((w) => {
      const letters = [...w.children].map((c) => c.getBoundingClientRect().top);
      return {
        right: w.getBoundingClientRect().right,
        // A word broken inside spans more than one line of letters.
        whole: Math.max(...letters) - Math.min(...letters) < 12,
      };
    });
    const buttons = [...document.querySelectorAll("#sheet .sheet-head :is(.sheet-grab, .close)")]
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width > 0);
    // What runs out of the paper's sides (which clip sideways: a width measure would hide it).
    const paper = document.querySelector("#sheet .sheet-paper").getBoundingClientRect();
    const sideways = [...document.querySelectorAll("#sheet .sheet-paper *")]
      .map((e) => [e, e.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && (r.left < paper.left - 1 || r.right > paper.right + 1));
    return {
      right: Math.round(Math.max(...words.map((w) => w.right))),
      buttons: Math.round(Math.min(...buttons.map((b) => b.left))),
      whole: words.every((w) => w.whole),
      zoom: h2.querySelector(".cutout").style.zoom,
      sideways: sideways.map(([e, r]) => `${e.className} ${r.left | 0}-${r.right | 0}`),
    };
  }, CHIPS_JS);
  check(
    `${device} ${mode}: a long title shrinks, whole words left of ↑ and ×, no sideways scroll`,
    got.right <= got.buttons && got.whole && got.sideways.length === 0,
    JSON.stringify(got),
  );
  await shot(page, `${device}-${mode}-long-title`);
}
