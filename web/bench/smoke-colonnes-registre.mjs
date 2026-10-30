// The register's tables, laid out (v2.1, A6): a column of numbers has its head and its values
// right, with the same inset; a column of text, both left. On each page given, in Chromium, for
// every table.t of the register's view:
// - classes: a column's head is `num` exactly when its values are (the cells that hold something);
// - layout: the words of a `num` column's head end where its values end (their text's right edge,
//   1 px at most), those of a text column start where its values start (left edges, a value's
//   pictogram included); a sorted head's arrow is left out of the measure (the words alone).
// Pages: Lyon's fiche (its territories) and a buyer's (its contracts, its sellers, its calls for
// tenders) by default. It needs the register's data (web/public/data), so it runs against a
// server that has them: the dev server, or a build served with them.
//   node bench/smoke-colonnes-registre.mjs [--base http://localhost:5173] [--pages /registre/…,…]
// Exits non-zero if a check failed.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = arg("--base", "http://localhost:5173");
const PAGES = arg("--pages", "/registre/commune/69123,/registre/acheteur/176901205").split(",");

const failed = [];
const report = (ok, name, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed.push(name);
};

const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// nothing but the server: no third party
await ctx.route(/^https?:\/\//, (r) =>
  r.request().url().startsWith(BASE) ? r.continue() : r.abort(),
);
const page = await ctx.newPage();
for (const path of PAGES) {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector("#registre table.t", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  const tables = await page.evaluate(() => {
    // the words of a cell: the union of its text's boxes, an arrow or a sorted mark left out
    const words = (el) => {
      const r = { l: Infinity, r: -Infinity };
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim() || n.parentElement.closest("[aria-hidden='true']")) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const b of range.getClientRects()) {
          if (!b.width) continue;
          r.l = Math.min(r.l, b.left);
          r.r = Math.max(r.r, b.right);
        }
      }
      // a value's pictogram (a link's square) is where its words start
      for (const svg of el.querySelectorAll("svg")) {
        const b = (svg.closest(".mini") ?? svg).getBoundingClientRect();
        if (b.width) r.l = Math.min(r.l, b.left);
      }
      return Number.isFinite(r.l) ? r : null;
    };
    return [...document.querySelectorAll("#registre table.t")]
      .filter((t) => t.getClientRects().length)
      .map((t, ti) => {
        const heads = [...t.tHead.rows[0].cells];
        const body = [...t.tBodies].flatMap((b) => [...b.rows]);
        return {
          name: t.caption?.textContent.trim().slice(0, 40) || `table ${ti + 1}`,
          cols: heads.map((th, i) => {
            const cells = body.map((tr) => tr.cells[i]).filter((td) => td?.textContent.trim());
            return {
              head: th.textContent.replace(/[↑↓]/g, "").trim(),
              num: th.classList.contains("num"),
              cellsNum: cells.filter((td) => td.classList.contains("num")).length,
              cells: cells.length,
              hw: words(th),
              cw: cells.map(words).filter(Boolean),
            };
          }),
        };
      });
  });
  if (!tables.length) report(false, `${path}: a table`, "none shown");
  for (const tb of tables)
    for (const c of tb.cols) {
      const name = `${path} · ${tb.name} · « ${c.head} »`;
      const classes = c.num ? c.cellsNum === c.cells : c.cellsNum === 0;
      report(
        classes,
        `${name}: ${c.num ? "num" : "text"}`,
        classes ? "" : `${c.cellsNum} of ${c.cells} values num`,
      );
      if (!c.hw || !c.cw.length) continue;
      const edge = c.num ? "r" : "l";
      const off = c.cw.map((w) => Math.abs(w[edge] - c.hw[edge]));
      const worst = Math.max(...off);
      report(
        worst <= 1,
        `${name}: ${c.num ? "right" : "left"} edges`,
        `${worst.toFixed(1)} px at most`,
      );
    }
}
await browser.close();
console.log(failed.length ? `${failed.length} failed` : "all passed");
process.exit(failed.length ? 1 : 0);
