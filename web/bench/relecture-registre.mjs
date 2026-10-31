// A proofreading of the register's words on the production build (v2.3 point 10): the sentences
// written for the pilot's three départements went wrong at the national scale. It reads, in the
// light mode on a wide screen, 30 fiches drawn at random across the country (a fixed seed: the
// same fiches each run, for a given build of the register) and every list, and fails on:
// - « département » followed by a number (a département without its name);
// - « SIREN » without a name beside it (« acheteur SIREN 130001902 »);
// - « de » before a vowel (« Contrat de octobre », « La mairie de Antony »);
// - a sentence that starts in lower case;
// - a ticket « — »;
// - undefined, NaN, null, [object;
// - « Île-de-France » or « Bouches-du-Rhône » in a fiche's sentence outside those territories;
// - words cut or spilling out of their box.
// The server: the build (LACARTE_DIST, bench/dist.mjs) then web/public (the register's data, the
// developer's link), as smoke-registre.mjs serves them; every /registre path the page.
//   node bench/relecture-registre.mjs [--browser chromium|webkit] [--port N] [--n 30] [--seed 2026]
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { DIST, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const engine = arg("--browser", "chromium");
const PORT = Number(arg("--port", "4641"));
const N = Number(arg("--n", "30"));
const SEED = Number(arg("--seed", "2026"));
const APP = `http://127.0.0.1:${PORT}`;
const DATA = resolve(WEB, "public/data/registre");
if (!existsSync(join(DIST, "index.html")) || !existsSync(join(DATA, "index.json"))) {
  console.log(`FAIL no build in ${DIST} or no register data in ${DATA}`);
  process.exit(2);
}

// --- the server: the build, then web/public; a register path the page -----------------------
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".pmtiles": "application/octet-stream",
};
function file(path) {
  for (const root of [DIST, resolve(WEB, "public")]) {
    const f = join(root, path);
    if (f.startsWith(root) && existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, APP).pathname);
  const f = /^\/registre(\/|$)/.test(path) && !path.startsWith("/registre/") ? null : file(path);
  const page =
    f ?? (path.startsWith("/registre") || path === "/" ? join(DIST, "index.html") : null);
  if (!page) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(page)] ?? "application/octet-stream" });
  createReadStream(page).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// --- what is read: 30 fiches at random, every list --------------------------------------------
/** A fixed sequence of numbers in [0, 1) (mulberry32): the same fiches for the same seed. */
function hasard(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = hasard(SEED);
const fichesDe = (dir) =>
  existsSync(join(DATA, dir))
    ? readdirSync(join(DATA, dir))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .sort()
    : [];
// the documents open at their typed address; a file says its affair's kind
const genre = (id) => {
  if (/^avis-/.test(id)) return "avis";
  if (/^(sub|detr|region)-/.test(id)) return "subvention";
  if (/^(\d{2,3}|2[AB])-\d/.test(id)) return "arrete";
  return "contrat";
};
const tirer = (xs, n) => {
  const out = [];
  const pool = [...xs];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
};
// the shares: communes and documents are most, every type has some
const parts = [
  ["commune", 9],
  ["departement", 4],
  ["entreprise", 6],
  ["acheteur", 5],
  ["document", 6],
];
const fiches = parts.flatMap(([dir, k]) =>
  tirer(fichesDe(dir), Math.round((k * N) / 30)).map((id) =>
    dir === "document"
      ? `/registre/${genre(id)}/${encodeURIComponent(id)}`
      : `/registre/${dir}/${id}`,
  ),
);
const listes = [
  "/registre/communes",
  "/registre/intercommunalites",
  "/registre/departements",
  "/registre/acheteurs?cat=etat",
  "/registre/acheteurs?cat=bailleur",
  "/registre/acheteurs?cat=transports",
  "/registre/acheteurs?cat=autres",
  "/registre/entreprises",
  "/registre/contrats",
  "/registre/modifications",
  "/registre/appels-d-offres",
  "/registre/arretes",
  "/registre/subventions",
  "/registre/",
];
const IDF = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);

// --- the reading --------------------------------------------------------------------------------
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "fr-FR",
  colorScheme: "light",
});
await context.addInitScript(() => {
  try {
    localStorage.setItem("lacarte.welcome", "1");
  } catch {}
});
const page = await context.newPage();
// a list of documents asks the search API: none here, its rows are not read (the build's files are)
await page.route("**/api/**", (x) =>
  x.fulfill({ status: 401, contentType: "application/json", body: '{"error":"no_session"}' }),
);
const found = [];
try {
  for (const path of [...fiches, ...listes]) {
    await page.goto(`${APP}${path}`);
    try {
      await page.waitForFunction(
        () =>
          document.querySelector("#registre #vue *") && !document.getElementById("registre").hidden,
        null,
        { timeout: 20000 },
      );
    } catch {
      found.push({ path, k: "not drawn", what: "" });
      continue;
    }
    await page.waitForTimeout(700);
    const dep = await page.evaluate(() => {
      const d = document.querySelector("#registre .idline a[href^='/registre/departement/']");
      return d?.getAttribute("href")?.split("/").pop()?.split("?")[0] ?? null;
    });
    const fiche = /^\/registre\/(commune|departement)\//.test(path);
    const own = path.match(/^\/registre\/departement\/([^/?]+)/)?.[1] ?? dep;
    const bad = await page.evaluate(
      ({ hors }) => {
        const out = [];
        const root = document.querySelector("#registre #vue");
        const cut = (s) => s.replace(/\s+/g, " ").trim().slice(0, 110);
        // the words of every block, as read (no hidden ones, no screen reader's own)
        const blocks = [
          ...root.querySelectorAll(
            "p, li, td, th, h1, h2, h3, .ticket, .ptile, .lead, .idline, dd, dt",
          ),
        ]
          .filter((x) => x.getClientRects().length && !x.closest(".sr, [aria-hidden=true], svg"))
          .filter((x) => !x.querySelector("p, li, td, h1, h2, h3, .ticket"));
        for (const x of blocks) {
          const s = x.innerText.replace(/\s+/g, " ").trim();
          if (!s) continue;
          const m = (k, re) => {
            const r = re.exec(s);
            if (r) out.push({ k, what: cut(s.slice(Math.max(0, r.index - 30), r.index + 60)) });
          };
          m("département + number", /\bdépartement \d/i);
          m("SIREN without a name", /\b(acheteur|entreprise|intercommunalité,?)\s+SIREN\b/i);
          m("« de » before a vowel", /\b[Dd]e (?=[AEIOUYÀÂÉÈÊËÎÏÔÖÛÜaeiouyàâéèêëîïôöûü])/);
          m("undefined / NaN / null / [object", /\b(undefined|NaN|null)\b|\[object/);
          if (hors) m("a pilot's territory outside it", /Île-de-France|Bouches-du-Rhône/);
          // a sentence: a block of more than five words that starts in lower case; a block that
          // opens on a label or a date (an element of its own: « mars 2024 », a sticker) is read
          // from the words after it
          const first = [...x.childNodes].find((n) => n.textContent.trim());
          // a figure set apart (« 330 000 € » de contrats…) begins the sentence, it is no label
          const label =
            first?.nodeType === 1 &&
            !first.matches("a, strong, em, b, .rl, .lk") &&
            !/^\d/.test(first.textContent.trim());
          const lead = label ? s.slice(first.textContent.trim().length).trim() : s;
          if (
            /^[a-zàâéèêëîïôöûüç]/.test(lead) &&
            lead.split(" ").length > 5 &&
            /[.!?…]$/.test(lead)
          )
            out.push({ k: "a sentence in lower case", what: cut(lead) });
        }
        for (const v of root.querySelectorAll(".ticket .v, .ptile b"))
          if (v.textContent.trim() === "—")
            out.push({ k: "a « — » ticket", what: cut(v.parentElement.innerText) });
        // words cut or spilling out of their box
        for (const x of root.querySelectorAll(
          "p, h1, h2, h3, td, th, a, button, span, .ticket .v",
        )) {
          if (!x.getClientRects().length || x.closest(".sr, svg, [aria-hidden=true]")) continue;
          const st = getComputedStyle(x);
          if (/auto|scroll/.test(st.overflowX) || st.textOverflow === "ellipsis") continue;
          if (x.closest("table") && x.tagName !== "TD" && x.tagName !== "TH") continue;
          if (x.scrollWidth > x.clientWidth + 2 && x.clientWidth > 0 && st.display !== "inline")
            out.push({
              k: "words out of their box",
              what: `${x.tagName.toLowerCase()}.${[...x.classList].join(".")} « ${cut(x.innerText).slice(0, 50)} »`,
            });
        }
        return out;
      },
      { hors: fiche && own && !IDF.has(own) && own !== "13" },
    );
    for (const b of bad) found.push({ path, ...b });
  }
} finally {
  await browser.close();
  server.close();
}

const kinds = {};
for (const f of found) kinds[f.k] = (kinds[f.k] ?? 0) + 1;
for (const f of found) console.log(`FAIL [${engine}] ${f.path} — ${f.k}: ${f.what}`);
console.log(
  `${found.length ? "FAIL" : "ok  "} [${engine}] proofreading: ${fiches.length} fiches at random (seed ${SEED}) and ${listes.length} lists, ${found.length} findings ${JSON.stringify(kinds)}`,
);
process.exit(found.length ? 1 : 0);
