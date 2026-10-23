// « Supprimer mon compte » end to end, the page on the production build of the CI extract and
// the real API on a throwaway database (web/bench/states/apiserver.py, tests/apiserver.py's
// accounts and password): for an account with a password and for an account opened with
// OpenStreetMap (no password: the pseudonym retyped), each with a contribution of its own.
// The account's screen asks the confirmation before any request; a wrong one is said (401
// for a password, 400 for a pseudonym) and keeps the account; the right one closes the
// sheet, the account square goes back to « se connecter », the session is refused
// (GET /api/me 401), the account is gone from the database and its contribution stays,
// without author. Exits non-zero if a check failed.
//   node bench/smoke-delete.mjs [--browser webkit|chromium] [--port N] [--api N]
// WebKit runs a phone, Chromium a wide screen. Needs PostgreSQL with PostGIS (as make smoke).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { DIST, preview, requireTiles, WEB } from "./dist.mjs";
import { BENCH_PASSWORD, COOKIE, sessionOf } from "./session.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci", true);
const engine = arg("--browser", "webkit");
const PORT = Number(arg("--port", "4472"));
const API_PORT = Number(arg("--api", "8872"));
const APP = `http://localhost:${PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const ROOT = resolve(WEB, "..");
const STREET = [2.2377, 48.8977];
const BUILD = JSON.parse(readFileSync(join(DIST, "tiles/meta.json"), "utf8")).build_id;
const DEVICE =
  engine === "webkit"
    ? { ...devices["iPhone 14"], viewport: { width: 390, height: 845 } }
    : { viewport: { width: 960, height: 581 } };

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const tmp = mkdtempSync(join(tmpdir(), "smoke-delete-"));
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
/** An API call with `token`'s session and the page's Origin. */
async function api(token, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      cookie: `${COOKIE}=${token}`,
      ...(body === undefined ? {} : { origin: APP, "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.status;
}

let browser;
/** `who` signs in, writes a contribution, opens the account's screen and deletes the
 * account, `wrong` then the right confirmation. `osm`: the account has no password, an
 * OpenStreetMap id instead (what an account opened with OpenStreetMap is). */
async function deleteFlow(who, { osm, uuid, wrong, right, field, said }) {
  const token = await sessionOf(API, APP, who);
  if (osm)
    psql(
      `UPDATE accounts SET password_hash = NULL, osm_id = 424242, osm_server = 'dev' WHERE pseudonym = '${who}'`,
    );
  const posted = await api(token, "POST", "/api/contributions", {
    uuid,
    kind: "verify",
    camera: "n1925180657",
    answer: "present",
    build_id: BUILD,
    day: new Date().toISOString().slice(0, 10),
    on_site: true,
  });
  const context = await browser.newContext({ ...DEVICE, locale: "fr-FR" });
  await context.addCookies([{ name: COOKIE, value: token, url: APP }]);
  await context.addInitScript(() => {
    try {
      localStorage.setItem("lacarte.welcome", "1");
    } catch {}
  });
  // The page's /api/* to the API, as the site's Caddy does (same origin for the page): the
  // page's own headers, Origin included, and the context's cookies for the page (WebKit's
  // intercepted requests carry none; the API is another host for the browser's cookies).
  await context.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const { host: _, ...headers } = await req.allHeaders();
    const jar = await context.cookies(APP);
    if (jar.length) headers.cookie = jar.map((c) => `${c.name}=${c.value}`).join("; ");
    const response = await route.fetch({ url: `${API}${url.pathname}${url.search}`, headers });
    await route.fulfill({ response });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${APP}/#18/${STREET[1]}/${STREET[0]}`);
  await page.waitForSelector('#account-square[data-signed="true"]', { timeout: 60000 });
  await page.locator("#account-square").click();
  await page.waitForSelector("#sheet .board-delete", { timeout: 20000 });
  await page.locator("#sheet .board-delete").click();
  const input = page.locator("#sheet .board-delete-form input");
  const type = await input.getAttribute("type");
  const before = psql(`SELECT count(*) FROM accounts WHERE pseudonym = '${who}'`);
  await input.fill(wrong);
  await page.locator("#sheet .board-delete-confirm").click();
  await page.waitForFunction(
    () => document.querySelector("#sheet .board-delete-error")?.textContent,
    null,
    { timeout: 20000 },
  );
  const error = await page.locator("#sheet .board-delete-error").textContent();
  const kept = psql(`SELECT count(*) FROM accounts WHERE pseudonym = '${who}'`);
  const held = psql(
    `SELECT count(*) FROM sessions WHERE token_sha256 = sha256(convert_to('${token}', 'UTF8'))`,
  );
  await input.fill(right);
  await page.locator("#sheet .board-delete-confirm").click();
  await page.waitForFunction(() => document.getElementById("sheet").hidden, null, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () => !document.getElementById("account-square")?.dataset.signed,
    null,
    { timeout: 10000 },
  );
  const square = await page.locator("#account-square").getAttribute("aria-label");
  const me = await api(token, "GET", "/api/me");
  const gone = psql(`SELECT count(*) FROM accounts WHERE pseudonym = '${who}'`);
  const left = psql(
    `SELECT count(*) FROM contributions WHERE uuid = '${uuid}' AND author_id IS NULL`,
  );
  // The session's own row (its token's SHA-256, lacarte.api.auth.digest), gone with it.
  const sessions = psql(
    `SELECT count(*) FROM sessions WHERE token_sha256 = sha256(convert_to('${token}', 'UTF8'))`,
  );
  const kind = osm ? "an account opened with OpenStreetMap" : "an account with a password";
  check(
    `${kind}: its contribution posted, « Supprimer mon compte » asks ${osm ? "the pseudonym retyped (a text field)" : "the password (a password field)"}`,
    posted === 200 && type === field && before === "1",
    JSON.stringify({ posted, type, before }),
  );
  check(
    `${kind}: a wrong confirmation is said and keeps the account and its session`,
    said.test(error ?? "") && kept === "1" && held === "1",
    JSON.stringify({ error, kept, held }),
  );
  check(
    `${kind}: the right one closes the sheet, the square says « se connecter », GET /api/me 401, the account gone, its contribution kept without author, its session gone`,
    /se connecter/.test(square ?? "") &&
      me === 401 &&
      gone === "0" &&
      left === "1" &&
      sessions === "0",
    JSON.stringify({ square, me, gone, left, sessions }),
  );
  check(`${kind}: no page error`, errors.length === 0, errors.join(" | "));
  await context.close();
}

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
  start("npx", preview(PORT), WEB);
  await waitFor("vite preview", () => up(`${APP}/`));
  browser = await (engine === "chromium" ? chromium : webkit).launch();
  await deleteFlow("ana", {
    osm: false,
    uuid: "de1e7e00-0000-4000-8000-000000000001",
    wrong: "not the password",
    right: BENCH_PASSWORD,
    field: "password",
    said: /incorrect/i,
  });
  await deleteFlow("eve", {
    osm: true,
    uuid: "de1e7e00-0000-4000-8000-000000000002",
    wrong: "pas_eve",
    right: "eve",
    field: "text",
    said: /pseudonyme exact/i,
  });
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
console.log(`${checks.length - failed.length} ok, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
