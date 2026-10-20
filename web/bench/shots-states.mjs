// Captures of every interface state docs/interface.md lists as reachable on the CI extract,
// each in light and dark ("clair", "sombre": the punk interface only has a dark mode), on a
// phone (WebKit, iPhone 14) and a wide screen (Chromium, 1440 × 900):
// <state>-<clair|sombre>-<phone|desktop>.png, and an index.md (state, captures, drawn in the
// mockup or improvised, failures).
//   node bench/shots-states.mjs --out DIR [--only PREFIX[,PREFIX…]] [--ui punk|classique]
//     [--device phone|desktop] [--mode clair|sombre] [--cnil] [--list]
// --cnil: the build served (LACARTE_DIST) was made with VITE_CNIL_SIGNAL=true, as the
// private preview's is: its sheets show the CNIL box, and the states that need it are
// captured. Whether the build shows it is checked against the option before any capture.
// DIR is outside any git repository, or in a folder its repository ignores, as git says
// from DIR's deepest existing folder (the captures are never committed).
// Needs data/build/ci built with the fixture's contributions (the API loads it, read only)
// and `npm run build` serving it. The participation states are made on a throwaway database
// (tests/apiserver.py, through states/apiserver.py), filled through the API as accounts would
// (states/seed.mjs) and settled as a deploy does; the states list is states/catalogue.mjs,
// their description, code, mockup screen and data docs/interface.md.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { requireTiles } from "./dist.mjs";
import { cnilShown, STATES } from "./states/catalogue.mjs";
import {
  API_PORT,
  APP_PORT,
  closeProxy,
  halt,
  killServers,
  newContext,
  ROOT,
  STATIC_PORT,
  serversUp,
  startServers,
  stopServers,
  takenPorts,
} from "./states/harness.mjs";
import { kit } from "./states/kit.mjs";
import { SEEDS } from "./states/seed.mjs";

const USAGE =
  "node bench/shots-states.mjs --out DIR [--only PREFIX[,PREFIX…]] [--ui punk|classique]\n" +
  "  [--device phone|desktop] [--mode clair|sombre] [--cnil] [--list]\n" +
  "DIR: outside the repository, or in a folder git ignores (the captures are never committed)";
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
// Every option known, every value given and, where there is a list, in it: a typo would
// otherwise select nothing, or everything.
const VALUES = {
  "--out": null,
  "--only": null,
  "--ui": ["punk", "classique"],
  "--device": ["phone", "desktop"],
  "--mode": ["clair", "sombre"],
};
const usage = (why) => {
  console.log(`FAIL ${why}\n${USAGE}`);
  process.exit(2);
};
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  if (name === "--cnil" || name === "--list") continue;
  if (!Object.hasOwn(VALUES, name)) usage(`unknown option ${name}`);
  const value = args[++i];
  if (value === undefined || value.startsWith("--")) usage(`${name} needs a value`);
  if (VALUES[name] && !VALUES[name].includes(value))
    usage(`${name} ${value}: one of ${VALUES[name].join(", ")}`);
}
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const UI = arg("--ui", "punk");
const OUT = args.includes("--out") ? resolve(arg("--out")) : null;
if (!OUT && !args.includes("--list")) {
  console.log("FAIL --out DIR is required: outside the repository, or in a folder git ignores");
  process.exit(2);
}
/** Why `out` cannot take the captures, or null. Asked of git itself from the deepest folder
 * of `out` that exists: a path in another case, through a symlink, or into another checkout
 * of the repository is the same folder to it, which comparing strings missed. Outside any
 * repository: fine; in a working tree: only where it ignores index.md. */
function outRefused(out) {
  let base = out;
  while (!existsSync(base)) base = dirname(base);
  // A GIT_DIR or GIT_WORK_TREE inherited from a hook would answer for another repository.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  const git = (...argv) => spawnSync("git", ["-C", base, ...argv], { encoding: "utf8", env });
  const said = (r) => String(r.stderr || r.error || `exit ${r.status}`).trim();
  const inside = git("rev-parse", "--is-inside-work-tree");
  if (inside.status !== 0)
    return /not a git repository/.test(inside.stderr ?? "") ? null : `git: ${said(inside)}`;
  if (inside.stdout.trim() !== "true") return "inside a repository's git folder";
  const ignored = git("check-ignore", "-q", "--", relative(base, join(out, "index.md")));
  if (ignored.status === 0) return null;
  return ignored.status === 1
    ? "inside a git working tree, and not ignored by it"
    : `git check-ignore: ${said(ignored)}`;
}
const refused = OUT && outRefused(OUT);
if (refused) {
  console.log(`FAIL --out ${OUT}: ${refused}`);
  process.exit(2);
}
const only = (arg("--only", "") || "").split(",").filter(Boolean);
const CNIL = args.includes("--cnil");

/** What docs/interface.md says of each state: its screen (the section), whether the
 * mockup draws it, whether it is reachable, on which screens and in which interface it is
 * captured. Rows of the catalogue start with `| `id` |`. */
const duplicates = [];
function catalogue() {
  const doc = readFileSync(join(ROOT, "docs/interface.md"), "utf8");
  const rows = new Map();
  let screen = "";
  for (const line of doc.split("\n")) {
    const h = /^### (.+)/.exec(line);
    if (h) screen = h[1];
    const m = /^\| `([a-z0-9-]+)` \|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const cells = m[2].split(" | ").map((c) => c.trim());
    // id | description | code | mockup | data | capture | reachable
    const capture = cells[4] ?? "";
    const device = /\((phone|desktop)\b/.exec(capture)?.[1];
    if (rows.has(m[1])) duplicates.push(m[1]);
    rows.set(m[1], {
      screen,
      description: cells[0],
      mockup: cells[2],
      capture,
      // Captured by this script: reachable, and its own name in the capture column (not
      // "—", nor another state's capture); on both kinds of screen unless the cell names one.
      captured: /^yes/i.test(cells[5] ?? "") && capture.includes(`\`${m[1]}\``),
      devices: device ? [device] : ["phone", "desktop"],
      // In one interface only when the cell says so: "(punk)".
      ui: /\((punk|classique)\b/.exec(capture)?.[1],
      // Only from a build with the CNIL box: "(`--cnil`)".
      cnil: capture.includes("`--cnil`"),
      reachable: cells[5] ?? "",
    });
  }
  return rows;
}

const doc = catalogue();

/** The "Counts" table of docs/interface.md against its rows: one line per screen, then the
 * total; returns the disagreements. */
function countsDisagree() {
  const text = readFileSync(join(ROOT, "docs/interface.md"), "utf8");
  const section = /### Counts\n([\s\S]*?)\n### /.exec(text)?.[1] ?? "";
  const stated = new Map();
  for (const line of section.split("\n")) {
    const m =
      /^\| (?:\*\*)?([^|*]+?)(?:\*\*)? \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/.exec(
        line,
      );
    if (m) stated.set(m[1], m.slice(2).map(Number));
  }
  const actual = new Map();
  const add = (key, row) => {
    const reach = /^yes/i.test(row.reachable);
    const [n, imp, r, cap, files, no] = actual.get(key) ?? [0, 0, 0, 0, 0, 0];
    actual.set(key, [
      n + 1,
      imp + (/IMPROVISED/.test(row.mockup) ? 1 : 0),
      r + (reach ? 1 : 0),
      cap + (row.captured ? 1 : 0),
      files + (row.captured ? row.devices.length * 2 : 0),
      no + (reach ? 0 : 1),
    ]);
  };
  for (const row of doc.values()) {
    add(row.screen, row);
    add("Total", row);
  }
  const out = [];
  for (const [key, numbers] of actual)
    if (String(stated.get(key)) !== String(numbers))
      out.push(
        `Counts, ${key}: the table says ${stated.get(key) ?? "nothing"}, the rows ${numbers}`,
      );
  for (const key of stated.keys()) if (!actual.has(key)) out.push(`Counts, ${key}: no such screen`);
  return out;
}
// The catalogue against itself and against the registry (states/catalogue.mjs), before
// anything runs: the same states, captured on the same screens, in the same interfaces,
// and the counts those of the rows. A disagreement fails the run (exit 1), --list included.
const disagreements = countsDisagree();
const registered = new Map();
for (const id of duplicates) disagreements.push(`${id}: two rows in docs/interface.md`);
for (const s of STATES) {
  if (registered.has(s.id)) disagreements.push(`${s.id}: twice in states/catalogue.mjs`);
  registered.set(s.id, s);
  const row = doc.get(s.id);
  if (!row) disagreements.push(`${s.id}: in states/catalogue.mjs, not in docs/interface.md`);
  else if (!row.captured)
    disagreements.push(`${s.id}: in states/catalogue.mjs, not a captured row of docs/interface.md`);
  else {
    if (String(s.devices ?? ["phone", "desktop"]) !== String(row.devices))
      disagreements.push(
        `${s.id}: captured on ${s.devices ?? "phone,desktop"}, docs/interface.md says ${row.devices}`,
      );
    if (s.ui !== row.ui)
      disagreements.push(
        `${s.id}: interface ${s.ui ?? "any"}, docs/interface.md says ${row.ui ?? "any"}`,
      );
    if (Boolean(s.cnil) !== row.cnil)
      disagreements.push(
        `${s.id}: ${s.cnil ? "" : "not "}--cnil only, docs/interface.md says the reverse`,
      );
  }
}
for (const [id, row] of doc)
  if (row.captured && !registered.has(id))
    disagreements.push(`${id}: captured in docs/interface.md, not in states/catalogue.mjs`);
for (const e of disagreements) console.log(`FAIL ${e}`);
if (disagreements.length) process.exit(1);

// This run: the captured rows its options select, on the screens and modes they select.
const modes = UI === "classique" ? ["clair"] : ["clair", "sombre"];
const combos = ["phone", "desktop"]
  .flatMap((device) => modes.map((mode) => ({ ui: UI, device, mode })))
  .filter((c) => arg("--device", c.device) === c.device && arg("--mode", c.mode) === c.mode);
const selected = new Set(
  [...doc]
    .filter(([, row]) => row.captured && (!row.ui || row.ui === UI) && (!row.cnil || CNIL))
    .filter(([id]) => !only.length || only.some((p) => id.startsWith(p)))
    .map(([id]) => id),
);
const states = STATES.filter((s) => selected.has(s.id));
const filesOf = (id, row, run) =>
  run.filter((c) => row.devices.includes(c.device)).map((c) => `${id}-${c.mode}-${c.device}.png`);
// What the catalogue asks of this run, and every file it names whatever the options: a
// file of the folder outside the latter is an orphan.
const expected = new Set([...selected].flatMap((id) => filesOf(id, doc.get(id), combos)));
const everyCombo = ["phone", "desktop"].flatMap((device) =>
  ["clair", "sombre"].map((mode) => ({ device, mode })),
);
const named = new Set(
  [...doc].filter(([, row]) => row.captured).flatMap(([id, row]) => filesOf(id, row, everyCombo)),
);
if (!expected.size) {
  console.log(
    `FAIL no capture selected (--only ${only.join(",") || "—"}, --ui ${UI}${CNIL ? ", --cnil" : ""})`,
  );
  process.exit(1);
}
if (args.includes("--list")) {
  for (const s of states) console.log(s.id);
  process.exit(0);
}

requireTiles("ci", true);
const taken = await takenPorts();
if (taken.length) {
  console.log(
    `FAIL port ${taken.join(", ")} already in use (this script needs ${APP_PORT}, ${STATIC_PORT} ` +
      `and ${API_PORT}): another run, or servers it left; lsof -nP -iTCP:${taken[0]} -sTCP:LISTEN`,
  );
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const results = []; // { id, file, ok, error }
let browsers;
let restarts = 0; // servers or browsers found killed and started again
const t0 = Date.now();

// The browsers without Playwright's signal handlers: its SIGINT one exits (130) before the
// servers are stopped, its SIGTERM and SIGHUP ones close the browsers and let the run
// launch them again.
const LAUNCH = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
let stopping = false;
let shuttingDown = null;
/** The browsers closed, the servers stopped (the API's database with them), the proxy
 * closed and the temporary folder removed. Once: a second call (a signal during the
 * shutdown that ends the run) waits for the first. */
function shutdown() {
  shuttingDown ??= (async () => {
    stopping = true;
    halt();
    const closing = [browsers?.webkit, browsers?.chromium].map((b) => b?.close().catch(() => {}));
    await Promise.race([Promise.all(closing), new Promise((r) => setTimeout(r, 10000))]);
    await stopServers();
    closeProxy();
  })();
  return shuttingDown;
}
// A signal or an uncaught error stops everything before the exit (128 + the signal's
// number, or 1); a second one kills what is left at once.
let aborting = false;
function abort(why, code) {
  if (aborting) {
    console.log(`STOP ${why} again: servers killed, database stopped`);
    killServers();
    closeProxy();
    process.exit(code);
  }
  aborting = true;
  console.log(`STOP ${why}: stopping the browsers and the servers`);
  shutdown().finally(() => {
    console.log("STOP done: browsers and servers stopped, temporary folder removed");
    process.exit(code);
  });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => abort(signal, 128 + constants.signals[signal]));
process.on("uncaughtException", (e) => abort(`uncaught ${e?.stack ?? e}`, 1));
process.on("unhandledRejection", (e) => abort(`unhandled ${e?.stack ?? e}`, 1));

let fatal = null; // what stopped the run before its end
try {
  let fixtures = await startServers();
  browsers = { webkit: await webkit.launch(LAUNCH), chromium: await chromium.launch(LAUNCH) };
  // The CNIL box as --cnil says: without it, a VITE_CNIL_SIGNAL=true build would put the box
  // in sheets the catalogue describes without it.
  const probe = { ui: UI, device: "desktop", mode: modes[0] };
  const probeContext = await newContext(browsers, probe);
  const shown = await cnilShown(kit(await probeContext.newPage(), probeContext, probe));
  await probeContext.close();
  if (shown !== CNIL)
    throw new Error(
      shown
        ? "the build served shows the CNIL box (VITE_CNIL_SIGNAL=true): run with --cnil"
        : "--cnil, but the build served has no CNIL box: build it with VITE_CNIL_SIGNAL=true and serve it with LACARTE_DIST",
    );
  let seeded = null; // the seed the database holds, null once a state wrote to it
  const broken = new Map(); // seed -> why it failed (not tried again: the rate limit)
  const ensure = async (seed) => {
    if (broken.has(seed)) throw new Error(`seed ${seed}: ${broken.get(seed)}`);
    if (seeded === seed) return;
    seeded = null;
    await SEEDS[seed](fixtures).catch((e) => {
      broken.set(seed, String(e).split("\n")[0]);
      throw e;
    });
    seeded = seed;
  };
  /** Browsers, servers and database back if another process killed them (the variants of a
   * state run side by side: one recovery for all). True when something was restarted. */
  let recovering = null;
  const recover = () => {
    recovering ??= (async () => {
      let restarted = false;
      if (stopping) return false;
      for (const [name, type] of [
        ["webkit", webkit],
        ["chromium", chromium],
      ]) {
        if (browsers[name].isConnected()) continue;
        console.log(`WARN ${name} gone: launched again`);
        browsers[name] = await type.launch(LAUNCH);
        restarted = true;
      }
      if (!(await serversUp())) {
        console.log("WARN servers or database gone: started again, data set again");
        await stopServers();
        fixtures = await startServers();
        seeded = null;
        broken.clear();
        restarted = true;
      }
      if (restarted) restarts++;
      return restarted;
    })().finally(() => {
      recovering = null;
    });
    return recovering;
  };
  /** One capture in a context of its own (its storage, its send queue, its routes); tried
   * once more when what it runs on had been killed. */
  const capture = async (state, combo, retry = true) => {
    const file = `${state.id}-${combo.mode}-${combo.device}.png`;
    let context;
    let error = null;
    try {
      await ensure(state.seed ?? "empty");
      context = await newContext(browsers, combo, {
        who: state.who,
        geolocation: state.geolocation,
        landscape: state.landscape,
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => process.env.SHOTS_VERBOSE && console.log(`  page: ${e}`));
      await state.run(kit(page, context, combo), fixtures);
      await page.screenshot({ path: join(OUT, file) });
    } catch (e) {
      error = String(e).split("\n")[0];
    } finally {
      await context?.close().catch(() => {});
      // A state that sent something leaves the database for the next one to set again.
      if (state.writes) seeded = null;
    }
    if (stopping) return; // a signal closed what it ran on: not a failure of the state
    if (error && retry && (await recover())) return capture(state, combo, false);
    results.push({ id: state.id, file, ok: !error, ...(error ? { error } : {}) });
    console.log(error ? `FAIL ${file}: ${error}` : `ok   ${file}`);
  };
  for (const state of states) {
    if (stopping) break;
    const mine = combos.filter((c) => !state.devices || state.devices.includes(c.device));
    if (state.writes) {
      // One after the other, the data set again before each.
      for (const combo of mine) await capture(state, combo);
    } else {
      // Read only: the variants side by side (the phone in WebKit, the wide screen in
      // Chromium), the data set once.
      await ensure(state.seed ?? "empty").catch(() => {});
      await Promise.all(mine.map((combo) => capture(state, combo)));
    }
  }
} catch (e) {
  fatal = e;
} finally {
  if (!aborting) await shutdown();
}
if (aborting) await new Promise(() => {}); // abort() exits once everything is stopped
if (fatal) {
  console.log(`FAIL ${fatal?.message ?? fatal}`);
  process.exit(1);
}

// --- the files against the catalogue, and index.md: the improvised states first, then
// those the mockup draws, then those the CI extract cannot reach, with the counts ----------
const byState = new Map();
for (const r of results) byState.set(r.id, [...(byState.get(r.id) ?? []), r]);
const isImprovised = (row) => /IMPROVISED/.test(row?.mockup ?? "");
const variant = (r) => r.file.slice(r.id.length + 1, -4);
const cell = (t) => String(t).replaceAll("|", "/");
const table = (ids) => [
  "| État | Écran | Description | Maquette | Captures | Échecs |",
  "|---|---|---|---|---|---|",
  ...ids.map((id) => {
    const row = doc.get(id) ?? { screen: "?", mockup: "?", description: "?" };
    const rs = byState.get(id);
    const ok = rs.filter((r) => r.ok).map((r) => `[${variant(r)}](${r.file})`);
    const ko = rs.filter((r) => !r.ok).map((r) => `${variant(r)} : ${r.error}`);
    return `| \`${id}\` | ${row.screen} | ${cell(row.description)} | ${cell(row.mockup)} | ${ok.join(" · ")} | ${cell(ko.join(" ; "))} |`;
  }),
];
// What the catalogue asks of this run against what it wrote, and the folder's files against
// the whole catalogue.
const written = new Set(results.filter((r) => r.ok).map((r) => r.file));
const missing = [...expected].filter((f) => !written.has(f));
const orphans = readdirSync(OUT).filter((f) => f.endsWith(".png") && !named.has(f));
for (const f of missing) console.log(`FAIL ${f}: asked by the catalogue, not written`);
for (const f of orphans) console.log(`FAIL ${f}: in ${OUT}, named by no row of the catalogue`);
const rows = [...doc.values()];
const reachable = [...doc].filter(([, row]) => /^yes/i.test(row.reachable));
const shared = reachable.filter(([, row]) => !row.captured);
const unreachable = [...doc].filter(([, row]) => /^no/i.test(row.reachable));
const captured = rows.filter((row) => row.captured);
const oneScreen = captured.filter((row) => row.devices.length === 1).length;
const improvised = rows.filter(isImprovised).length;
const improvisedReachable = reachable.filter(([, row]) => isImprovised(row)).length;
const tried = [...byState.keys()];
const failed = results.filter((r) => !r.ok).length;
const minutes = ((Date.now() - t0) / 60000).toFixed(1);
const lines = [
  "# États de l'interface : captures",
  "",
  `Interface ${UI}${CNIL ? ", build de la préversion (--cnil : encart CNIL affiché)" : ""}, ` +
    `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, ` +
    `${minutes} min. Catalogue : docs/interface.md (états, code, maquette, données de test). ` +
    "Fichiers : `<état>-<clair|sombre>-<phone|desktop>.png` ; un état propre à un seul " +
    "type d'écran (survol à la souris, feuille d'un téléphone…) n'a que ses deux captures.",
  "",
  `- états catalogués : ${doc.size}, dont ${improvised} improvisés ;`,
  `- atteignables sur l'extrait CI : ${reachable.length} (dont ${improvisedReachable} improvisés), ` +
    `capturés sous leur nom : ${captured.length} (${captured.length - oneScreen} × 4 captures, ` +
    `${oneScreen} × 2) ; sans capture propre : ${shared.length} ;`,
  `- non atteignables : ${unreachable.length} (liste en fin de page) ;`,
  `- cette exécution : ${tried.length} états essayés, ${written.size} captures écrites sur ` +
    `${expected.size} attendues, ${failed} échecs, ${missing.length} manquantes, ` +
    `${orphans.length} fichiers du dossier hors catalogue, ${restarts} relances (navigateurs ou ` +
    "serveurs tués par un autre processus).",
  "",
  ...(missing.length || orphans.length
    ? [
        "## Désaccords avec le catalogue",
        "",
        ...missing.map((f) => `- manquante : \`${f}\``),
        ...orphans.map((f) => `- hors catalogue : \`${f}\``),
        "",
      ]
    : []),
  "## Improvisés (la maquette ne les dessine pas)",
  "",
  ...table(tried.filter((id) => isImprovised(doc.get(id)))),
  "",
  "## Dessinés dans la maquette",
  "",
  ...table(tried.filter((id) => !isImprovised(doc.get(id)))),
  "",
  ...(shared.length
    ? [
        "## Atteignables sans capture propre",
        "",
        "| État | Écran | Description | Capture |",
        "|---|---|---|---|",
        ...shared.map(
          ([id, row]) =>
            `| \`${id}\` | ${row.screen} | ${cell(row.description)} | ${cell(row.capture)} |`,
        ),
        "",
      ]
    : []),
  "## Non atteignables sur l'extrait CI",
  "",
  "| État | Écran | Description | Maquette | Ce qui manque |",
  "|---|---|---|---|---|",
  ...unreachable.map(
    ([id, row]) =>
      `| \`${id}\` | ${row.screen} | ${cell(row.description)} | ${cell(row.mockup)} | ${cell(row.reachable.replace(/^no:\s*/i, ""))} |`,
  ),
];
writeFileSync(join(OUT, "index.md"), `${lines.join("\n")}\n`);
console.log(
  `${doc.size} catalogued (${improvised} improvised), ${reachable.length} reachable, ` +
    `${captured.length} captured rows, ${unreachable.length} unreachable; this run: ` +
    `${written.size}/${expected.size} files in ${minutes} min, ${failed} failures, ` +
    `${missing.length} missing, ${orphans.length} orphans, ${restarts} restarts -> ${OUT}`,
);
process.exit(failed || missing.length || orphans.length ? 1 : 0);
