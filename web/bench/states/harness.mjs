// What shots-states.mjs runs on: the servers (the throwaway API on the CI build, vite
// preview of web/dist, and a Node proxy doing what the site file does), the participation
// database (emptied, seeded through the API, settled as a deploy does), and a browser
// context per capture (the interface, the mode and the account set before the page loads).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { devices } from "playwright";
import { DIST, preview, WEB } from "../dist.mjs";
import { COOKIE, forgetSessions, sessionCookie, sessionOf } from "../session.mjs";

export const ROOT = resolve(WEB, "..");
// Ports of their own: other scripts and the local gate keep theirs. Every server listens on
// the loopback only: the throwaway API (its review account included) is not for the
// network. STATES_PORTS="app,static,api" moves them (`make try`, web/bench/try.mjs, runs
// beside the captures).
const PORTS = (process.env.STATES_PORTS ?? "4460,4461,8799").split(",").map(Number);
export const APP_PORT = PORTS[0];
export const STATIC_PORT = PORTS[1];
export const API_PORT = PORTS[2];
export const APP = `http://127.0.0.1:${APP_PORT}/`;
/** The served build's id (DIST's tiles/meta.json, DIST being web/dist or LACARTE_DIST), which
 * the seed's contributions carry; read by startServers(), once requireTiles() has checked
 * that DIST serves the CI build (a missing web/dist must not stop --list). */
export let BUILD = null;

let children = []; // the servers running
// The servers sent SIGTERM and not gone yet: killServers finds them there, whichever
// stopServers is waiting for them.
const stopping = new Set();
let halted = false; // set by halt(): the run is stopping, nothing is started any more
// A temporary folder for the run (the DSN, the fixtures, the settle outcomes), made on
// first use and removed by closeProxy().
let tmpPath = null;
const tmp = () => (tmpPath ??= mkdtempSync(join(tmpdir(), "shots-states-")));
const db = { dsn: "", bin: "" };
let proxy = null; // the Node proxy on APP_PORT: in this process, it outlives a restart
// The account a browser without a session is signed in as when it opens a page (`make try`:
// ivo); null: it stays signed out.
let defaultWho = "ana";
export const setDefaultAccount = (who) => {
  defaultWho = who;
};

/** A server in a process group of its own: a Ctrl-C reaches this script alone, which stops
 * the servers itself (stopServers), and a server that does not stop is killed with its
 * children, but for the API's Postgres, which pg_ctl detaches (stopDatabase). */
function run(cmd, argv, opts = {}) {
  if (halted) throw new Error("stopping: no server started any more");
  const p = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], detached: true, ...opts });
  children.push(p);
  let tail = "";
  p.stderr.on("data", (d) => {
    tail = `${tail}${d}`.slice(-600);
    if (process.env.SHOTS_VERBOSE) process.stderr.write(d);
  });
  p.stdout.resume();
  p.stderrTail = () => tail.trim().split("\n").slice(-3).join(" / ");
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `test` true within `ms`; fails at once when `child`, the server waited for, exits. */
const waitFor = async (what, test, child = null, ms = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (child && (child.exitCode ?? child.signalCode) !== null)
      throw new Error(
        `${what} exited (${child.exitCode ?? child.signalCode}): ${child.stderrTail()}`,
      );
    if (await test()) return;
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${what}`);
};
const up = async (url) => {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
};
const API_PROBE = `http://127.0.0.1:${API_PORT}/api/proposals?bbox=0,0,0,0`;

/** Whether something accepts connections on `port` of `host`. */
const answers = (port, host) =>
  new Promise((done) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1000);
    const end = (yes) => {
      socket.destroy();
      done(yes);
    };
    socket.once("connect", () => end(true));
    socket.once("error", () => end(false));
    socket.once("timeout", () => end(false));
  });

/** The ports of `ports` that something already listens on (IPv4 or IPv6 loopback): a
 * stale API there would answer for the new one. */
export async function takenPorts(ports = [APP_PORT, STATIC_PORT, API_PORT]) {
  const taken = [];
  for (const port of ports)
    if ((await answers(port, "127.0.0.1")) || (await answers(port, "::1"))) taken.push(port);
  return taken;
}

/** The API on a throwaway database loaded with data/build/ci (read only: its export goes to
 * a temporary folder) with the bench's accounts (tests/apiserver.py), vite preview, and the
 * proxy: the account is the session cookie the API gave (a sign-in through POST
 * /api/session), /revue and /revue.html the review page for everyone, as the site file
 * (deploy/preview.caddy) does; the API answers the reviewer role only. Called
 * again after stopServers() when they were killed: a new database, the same proxy. Fails
 * when a port it needs is taken, or when a server exits before it answers. */
export async function startServers() {
  BUILD ??= JSON.parse(readFileSync(join(DIST, "tiles/meta.json"), "utf8")).build_id;
  const taken = await takenPorts(proxy ? [STATIC_PORT, API_PORT] : undefined);
  if (taken.length) throw new Error(`port ${taken.join(", ")} taken`);
  forgetSessions(); // a new database: new sessions
  const dsnFile = join(tmp(), "dsn.txt");
  const fixtures = join(tmp(), "fixtures.json");
  rmSync(dsnFile, { force: true });
  rmSync(fixtures, { force: true });
  const api = run(
    "uv",
    ["run", "python", "web/bench/states/apiserver.py", "--dsn-file", dsnFile,
     "--region", "ci", "--port", String(API_PORT), "--origin", APP.slice(0, -1),
     "--review-user", "rvw", "--fixtures", fixtures, "--reset"],
    { cwd: ROOT },
  ); // biome-ignore format: argv
  // Ready once it answers HTTP: tests/apiserver.py says "api ready" before uvicorn binds.
  await waitFor("the API", async () => existsSync(dsnFile) && (await up(API_PROBE)), api);
  [db.dsn, db.bin] = readFileSync(dsnFile, "utf8").split("\n");
  const vite = run("npx", preview(STATIC_PORT, "127.0.0.1"), { cwd: WEB });
  await waitFor("vite preview", () => up(`http://127.0.0.1:${STATIC_PORT}/`), vite);
  proxy ??= await listenProxy();
  return JSON.parse(readFileSync(fixtures, "utf8"));
}

/** The session of the bench account `who`, opened through POST /api/session — a reviewer's
 * (rvw) or an administrator's (rev) through /revue's privileged entry, POST
 * /api/review/session (session.mjs entryOf) — cached until the next startServers. */
export const login = (who) => sessionOf(`http://127.0.0.1:${API_PORT}`, APP.slice(0, -1), who);

/** Set-Cookie headers that sign a browser in as `who` (null: out, and kept out). */
async function signIn(who) {
  if (!who) return [`${COOKIE}=; Path=/; Max-Age=0`, "nodefault=1; Path=/; SameSite=Lax"];
  const token = await login(who);
  return [
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
    "nodefault=; Path=/; Max-Age=0",
  ];
}

/** The Node proxy on APP_PORT, listening (its listen error fails the start). */
function listenProxy() {
  const server = http.createServer((req, res) => {
    forward(req, res).catch((e) => {
      res.writeHead(502);
      res.end(String(e.message));
    });
  });
  return new Promise((resolve, reject) => {
    const failed = (e) =>
      reject(new Error(`the proxy cannot listen on ${APP_PORT}: ${e.code ?? e}`));
    server.once("error", failed);
    server.listen(APP_PORT, "127.0.0.1", () => {
      server.off("error", failed);
      resolve(server);
    });
  });
}

/** One request through the proxy. ?as=NAME on a page: signed in as that account from now
 * on, the same page without it (`make try` switches between ivo and rev so); ?as= (empty):
 * signed out. A page opened without a session is signed in as the default account, if any.
 * The API gets the browser's cookies and never an X-Author. */
async function forward(req, res) {
  const url = new URL(req.url, "http://x");
  const page = !url.pathname.startsWith("/api/");
  const as = url.searchParams.get("as");
  const cookie = req.headers.cookie ?? "";
  const opening = req.method === "GET" && /text\/html/.test(req.headers.accept ?? "") && defaultWho;
  if (page && as !== null && /^[a-z]*$/.test(as)) {
    url.searchParams.delete("as");
    res.writeHead(302, {
      "set-cookie": await signIn(as),
      location: `${url.pathname}${url.search}`,
    });
    res.end();
    return;
  }
  if (page && opening && !sessionCookie(cookie) && !/(?:^|;\s*)nodefault=1/.test(cookie)) {
    res.writeHead(302, { "set-cookie": await signIn(defaultWho), location: req.url });
    res.end();
    return;
  }
  const headers = { ...req.headers };
  delete headers["x-author"];
  let port = STATIC_PORT;
  let path = req.url;
  if (!page) port = API_PORT;
  else if (url.pathname === "/revue" || url.pathname === "/revue.html")
    path = `/revue.html${url.search}`;
  const r = http.request({ host: "127.0.0.1", port, path, method: req.method, headers }, (u) => {
    res.writeHead(u.statusCode, u.headers);
    u.pipe(res);
  });
  r.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(r);
}

const groupAlive = (child) => {
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
};
const killGroup = (child) => {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already gone.
  }
};

/** The servers stopped: SIGTERM to each (uv and npx pass it on; the API's database is
 * stopped and removed by tests/pgcluster.py as the API exits), then, after `ms`, whatever
 * is left of its process group killed, and the database with it if the API was. Waits for
 * every server being stopped, those of another call included. */
export async function stopServers(ms = 20000) {
  for (const c of children) {
    if (!c.pid) continue;
    stopping.add(c);
    c.kill("SIGTERM");
  }
  children = [];
  const t0 = Date.now();
  while ([...stopping].some(groupAlive) && Date.now() - t0 < ms) await sleep(100);
  for (const c of stopping) {
    if (groupAlive(c)) killGroup(c);
    stopping.delete(c);
  }
  stopDatabase();
}

/** Every server killed at once, running or being stopped (a second signal while stopping),
 * the database stopped and removed. Only a cluster still being made, whose DSN the API has
 * not written yet, is left to tests/pgcluster.py, which removes it at the next start. */
export function killServers() {
  for (const c of [...children, ...stopping]) if (c.pid && groupAlive(c)) killGroup(c);
  children = [];
  stopping.clear();
  stopDatabase();
}

/** The API's cluster stopped (pg_ctl -m immediate) and its folder removed when the API did
 * not do it, being killed: pg_ctl leaves Postgres in a process group of its own, under
 * launchd, out of reach of a group kill. Only a cluster of tests/pgcluster.py (lacarte-pg-*,
 * the DSN's host), never a TEST_DSN server; nothing when it is gone already. */
function stopDatabase() {
  const host = /(?:^|\s)host=(\S+)/.exec(db.dsn)?.[1];
  if (!db.bin || !host || !basename(host).startsWith("lacarte-pg-") || !existsSync(host)) return;
  try {
    execFileSync(join(db.bin, "pg_ctl"), ["-D", join(host, "data"), "-m", "immediate", "stop"], {
      stdio: "ignore",
      timeout: 15000,
    });
  } catch {
    // Not running any more: its folder goes all the same.
  }
  rmSync(host, { recursive: true, force: true });
}

/** No server started any more (startServers fails): the run is stopping. */
export function halt() {
  halted = true;
}

/** The proxy closed and the temporary folder removed, at the very end. */
export function closeProxy() {
  proxy?.closeAllConnections();
  proxy?.close();
  proxy = null;
  if (tmpPath) rmSync(tmpPath, { recursive: true, force: true });
  tmpPath = null;
}

/** Whether vite preview, the API and its database still answer (another process may kill
 * them: a run once lost its browsers, its API and its database at once, mid-way). */
export async function serversUp() {
  if (!(await up(`http://127.0.0.1:${STATIC_PORT}/`))) return false;
  if (!(await up(API_PROBE))) return false;
  try {
    psql("SELECT 1;");
    return true;
  } catch {
    return false;
  }
}

// --- the participation database ------------------------------------------------------

const psql = (sql) =>
  execFileSync(db.bin ? join(db.bin, "psql") : "psql", [db.dsn, "-X", "-q", "-c", sql], {
    stdio: "pipe",
  });

/** Every contribution gone (what tests/apiserver.py --reset does at startup), and the
 * accounts' flags (test, shown in the leaderboard, the pseudonym in the cameras' history:
 * lot U) back to off. */
export function resetContributions() {
  psql(
    "TRUNCATE contributions CASCADE;" +
      " UPDATE accounts SET test = false, leaderboard = false, history_pseudonym = false;",
  );
}

/** Keep the contributions as they are now under `name`, to put them back later without
 * the API: its rate limit (30 writes a minute per account) would refuse a seed made again
 * for every state that changed it. */
export function snapshot(name) {
  psql(
    `DROP TABLE IF EXISTS shots_${name}, shots_${name}_test;` +
      ` CREATE TABLE shots_${name} AS SELECT * FROM contributions;` +
      ` CREATE TABLE shots_${name}_test AS SELECT id, test, leaderboard, history_pseudonym` +
      " FROM accounts;",
  );
}

/** The contributions kept by snapshot(`name`) back, row for row (triggers off: they are
 * the rows the API and the deploy wrote). False when there is no such snapshot. */
export function restore(name) {
  try {
    psql(
      "BEGIN; SET LOCAL session_replication_role = replica; TRUNCATE contributions CASCADE;" +
        ` INSERT INTO contributions SELECT * FROM shots_${name};` +
        " UPDATE accounts a SET test = s.test, leaderboard = s.leaderboard," +
        " history_pseudonym = s.history_pseudonym" +
        ` FROM shots_${name}_test s WHERE s.id = a.id; COMMIT;`,
    );
    return true;
  } catch {
    return false;
  }
}

/** The fixture's move e1 was made on version 2 of its camera, which OpenStreetMap moved to
 * version 3 since (the CI build's outcome says so); posted now, it keeps the served build's
 * version 3. Written back as the fixture has it, as the tables' owner. */
export function madeOnVersion(uuid, version) {
  psql(`UPDATE contributions SET osm_version = ${Number(version)} WHERE uuid = '${uuid}';`);
}

/** A test account (TEST_AUTHORS): what db/test_authors.sh writes at a deploy. */
export function testAuthor(author) {
  if (!/^[A-Za-z0-9._-]{2,32}$/.test(author)) throw new Error(`not a pseudonym: ${author}`);
  psql(
    "INSERT INTO accounts (pseudonym, created_month, test)" +
      ` VALUES ('${author}', date_trunc('month', current_date), true)` +
      " ON CONFLICT ((lower(pseudonym))) DO UPDATE SET test = true;",
  );
}

/** What a deploy does after the build: db/settle.sh with the CI build's outcome, as the
 * tables' owner. The fixture's made-up ids that are no uuid (k1, l1, h1…) are left out: the
 * SQL casts every id to uuid and stops on them, and no contribution can carry them. */
export function settle() {
  const outcome = JSON.parse(
    readFileSync(join(ROOT, "data/build/ci/contrib_outcome.json"), "utf8"),
  );
  outcome.contributions = outcome.contributions.filter((c) =>
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(c.uuid),
  );
  const dir = mkdtempSync(join(tmp(), "settle-"));
  writeFileSync(join(dir, "contrib_outcome.json"), JSON.stringify(outcome));
  return execFileSync("bash", ["db/settle.sh", dir, db.dsn], {
    cwd: ROOT,
    env: { ...process.env, PATH: `${db.bin}:${process.env.PATH}` },
  }).toString();
}

/** One API call as `who` (signed in: its session cookie; null: signed out), with what the
 * page adds (Origin, JSON); a 429 (30 writes a minute per account) waits and tries again. */
export async function api(who, method, path, body, tries = 4) {
  const r = await fetch(`http://127.0.0.1:${API_PORT}${path}`, {
    method,
    headers: {
      ...(who ? { cookie: `${COOKIE}=${await login(who)}` } : {}),
      ...(body === undefined
        ? {}
        : { origin: APP.slice(0, -1), "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (r.status === 429 && tries > 1) {
    await new Promise((res) => setTimeout(res, 20000));
    return api(who, method, path, body, tries - 1);
  }
  if (!r.ok) throw new Error(`${method} ${path} as ${who}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

// --- browsers and contexts -------------------------------------------------------------

/** A browser context for one capture: the mode kept on the device (as ?mode= does), the
 * punk fonts loaded at once (as on a second visit), the account
 * (`opts.who`, ana by default, signed in through the API; null: signed out); a phone held
 * upright, or in landscape with `opts.landscape`. */
export async function newContext(browsers, combo, opts = {}) {
  const phone = combo.device === "phone";
  const browser = phone ? browsers.webkit : browsers.chromium;
  const context = await browser.newContext({
    ...(phone
      ? devices[opts.landscape ? "iPhone 14 landscape" : "iPhone 14"]
      : { viewport: { width: 1440, height: 900 } }),
    colorScheme: combo.mode === "sombre" ? "dark" : "light",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    ...(opts.geolocation ? { geolocation: opts.geolocation, permissions: ["geolocation"] } : {}),
  });
  await context.addInitScript((mode) => {
    try {
      localStorage.setItem("lacarte.mode", mode);
      localStorage.setItem("lacarte.fonts", "1");
      // Not a first visit (welcome.ts): the welcome's own states set it back.
      localStorage.setItem("lacarte.welcome", "1");
    } catch {
      // about:blank has no storage.
    }
  }, combo.mode);
  const who = opts.who === undefined ? "ana" : opts.who;
  await context.addCookies(
    who
      ? [{ name: COOKIE, value: await login(who), url: APP, httpOnly: true, sameSite: "Strict" }]
      : [{ name: "nodefault", value: "1", url: APP }],
  );
  return context;
}
