// « Télécharger mes données » end to end, the page on the production build of the CI extract
// and the real API on a throwaway database (web/bench/states/apiserver.py, tests/apiserver.py's
// accounts and password): two accounts each write a contribution, one with a password and
// one opened with OpenStreetMap (no password, an OSM id). Each presses the button on its
// account's screen; the browser saves the API's file under its name, the same bytes the API
// sent, and the file holds that account (pseudonym, role, password or not, its OSM link),
// its contribution and its session's count and date, the secrets only signalled (no
// password hash, no session token or its hash), and nothing of the other account.
// Exits non-zero if a check failed.
//   node bench/smoke-export.mjs [--browser webkit|chromium] [--port N] [--api N]
// WebKit runs a phone, Chromium a wide screen. Needs PostgreSQL with PostGIS (as make smoke).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { DIST, preview, requireTiles, WEB } from "./dist.mjs";
import { COOKIE, sessionOf } from "./session.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci", true);
const engine = arg("--browser", "webkit");
const PORT = Number(arg("--port", "4474"));
const API_PORT = Number(arg("--api", "8874"));
const APP = `http://localhost:${PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const ROOT = resolve(WEB, "..");
const STREET = [2.2377, 48.8977];
const BUILD = JSON.parse(readFileSync(join(DIST, "tiles/meta.json"), "utf8")).build_id;
const FILE = "surveillance-world-mes-donnees.json";
const TODAY = new Date().toISOString().slice(0, 10);
const DEVICE =
  engine === "webkit"
    ? { ...devices["iPhone 14"], viewport: { width: 390, height: 845 } }
    : { viewport: { width: 960, height: 581 } };
const ACCOUNTS = {
  ana: { osm: false, uuid: "e4b0e700-0000-4000-8000-000000000001", answer: "present" },
  eve: { osm: true, uuid: "e4b0e700-0000-4000-8000-000000000002", answer: "not_found" },
};

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const tmp = mkdtempSync(join(tmpdir(), "smoke-export-"));
const dsnFile = join(tmp, "dsn.txt");
const servers = [];
const start = (cmd, argv, cwd) => {
  const p = spawn(cmd, argv, { cwd, stdio: "ignore", detached: true });
  servers.push(p);
  return p;
};
const up = async (url) => {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
};
async function waitFor(what, ok, ms = 180000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} not up after ${ms / 1000} s`);
}
const db = { dsn: "", bin: "" };
/** One SQL statement as the tables' owner; its rows, tab-separated. */
const psql = (sql) =>
  execFileSync(db.bin ? join(db.bin, "psql") : "psql", [db.dsn, "-tAXc", sql])
    .toString()
    .trim();

let browser;
const tokens = {};
/** `who` presses « Télécharger mes données »; the other account's pseudonym, uuid and
 * session must not be in the file. */
async function exportFlow(who, other) {
  const { osm, uuid, answer } = ACCOUNTS[who];
  const token = tokens[who];
  const context = await browser.newContext({ ...DEVICE, locale: "fr-FR", acceptDownloads: true });
  await context.addCookies([{ name: COOKIE, value: token, url: APP }]);
  await context.addInitScript(() => {
    try {
      localStorage.setItem("lacarte.welcome", "1");
    } catch {}
  });
  // The page's /api/* to the API, as the site's Caddy does (smoke-delete.mjs); what
  // GET /api/me/export answered kept, to compare with the file the browser saved.
  const sent = [];
  await context.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const { host: _, ...headers } = await req.allHeaders();
    const jar = await context.cookies(APP);
    if (jar.length) headers.cookie = jar.map((c) => `${c.name}=${c.value}`).join("; ");
    const response = await route.fetch({ url: `${API}${url.pathname}${url.search}`, headers });
    if (url.pathname === "/api/me/export")
      sent.push({ status: response.status(), body: await response.text() });
    await route.fulfill({ response });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${APP}/?ui=punk#18/${STREET[1]}/${STREET[0]}`);
  await page.waitForSelector('#account-square[data-signed="true"]', { timeout: 60000 });
  await page.locator("#account-square").click();
  await page.waitForSelector("#sheet .board-export", { timeout: 20000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.locator("#sheet .board-export").click(),
  ]);
  const text = readFileSync(await download.path(), "utf8");
  const got = JSON.parse(text);
  const kind = osm ? "an account opened with OpenStreetMap" : "an account with a password";
  check(
    `${kind}: the button saves the API's file under its name, byte for byte`,
    sent.length === 1 &&
      sent[0].status === 200 &&
      download.suggestedFilename() === FILE &&
      text === sent[0].body,
    JSON.stringify({ sent: sent.map((s) => s.status), name: download.suggestedFilename() }),
  );
  const a = got.account ?? {};
  check(
    `${kind}: the account — pseudonym, role, ${osm ? "no password, linked to OSM with its id" : "a password (a yes), not linked to OSM"}`,
    a.pseudonym === who &&
      a.role === "contributor" &&
      a.password === !osm &&
      a.osm?.linked === osm &&
      a.osm?.id === (osm ? 424242 : null) &&
      a.publish?.on === false,
    JSON.stringify(a),
  );
  const c = got.contributions ?? [];
  check(
    `${kind}: its one contribution, as sent (camera, answer, day, on site)`,
    c.length === 1 &&
      c[0].uuid === uuid &&
      c[0].camera === "n1925180657" &&
      c[0].answer === answer &&
      c[0].day === TODAY &&
      c[0].on_site === true,
    JSON.stringify(c.map((x) => [x.uuid, x.camera, x.answer, x.day, x.on_site])),
  );
  check(
    `${kind}: its sessions as a count and dates, its points; no secret (no hash, no token)`,
    got.sessions?.count >= 1 &&
      got.sessions.expires_on.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) &&
      typeof got.points?.pending === "number" &&
      !text.includes(token) &&
      !/[0-9a-f]{64}|\$argon2|"(password_hash|token|token_sha256|hash)"\s*:/i.test(text),
    JSON.stringify(got.sessions),
  );
  check(
    `${kind}: nothing of the other account (${other}: pseudonym, contribution, session)`,
    !text.includes(`"${other}"`) &&
      !text.includes(ACCOUNTS[other].uuid) &&
      !text.includes(tokens[other]) &&
      !/\brev\b/.test(text),
    "",
  );
  check(`${kind}: no page error`, errors.length === 0, errors.join(" | "));
  await context.close();
  return c.length;
}

const counts = {};
try {
  start(
    "uv",
    ["run", "python", "web/bench/states/apiserver.py", "--dsn-file", dsnFile, "--region", "ci",
     "--port", String(API_PORT), "--origin", APP, "--accounts", "ana,eve,rev",
     "--review-user", "rev", "--reset"],
    ROOT,
  ); // biome-ignore format: argv
  await waitFor("the API", async () => existsSync(dsnFile) && (await up(`${API}/api/me`)));
  [db.dsn, db.bin] = readFileSync(dsnFile, "utf8").split("\n");
  for (const [who, { osm, uuid, answer }] of Object.entries(ACCOUNTS)) {
    tokens[who] = await sessionOf(API, APP, who);
    if (osm)
      psql(
        `UPDATE accounts SET password_hash = NULL, osm_id = 424242, osm_server = 'dev' WHERE pseudonym = '${who}'`,
      );
    const r = await fetch(`${API}/api/contributions`, {
      method: "POST",
      headers: {
        cookie: `${COOKIE}=${tokens[who]}`,
        origin: APP,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...{ uuid, kind: "verify", camera: "n1925180657", answer, build_id: BUILD },
        ...{ day: TODAY, on_site: true },
      }),
    });
    if (r.status !== 200) throw new Error(`${who}'s contribution: ${r.status}`);
  }
  start("npx", preview(PORT), WEB);
  await waitFor("vite preview", () => up(`${APP}/`));
  browser = await (engine === "chromium" ? chromium : webkit).launch();
  counts.ana = await exportFlow("ana", "eve");
  counts.eve = await exportFlow("eve", "ana");
  counts.all = Number(psql("SELECT count(*) FROM contributions"));
} catch (e) {
  check("the run", false, String(e).split("\n")[0]);
} finally {
  await browser?.close();
  // SIGTERM to each group (the API stops and removes its database as it exits).
  for (const p of servers) {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 3000));
  rmSync(tmp, { recursive: true, force: true });
}
const failed = checks.filter((c) => !c.ok);
console.log(`contributions in the file: ${JSON.stringify(counts)}`);
console.log(`${checks.length - failed.length} ok, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
