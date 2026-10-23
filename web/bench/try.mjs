// `make try`: the site on this machine to try the participation by hand, in one command —
// the working tree's web build, the participation API on a throwaway database loaded with
// the CI extract, and the CI test data (the state captures' "full" seed: proposals, adds,
// answers, decisions, the fixture's history settled as a deploy does). The bench's
// accounts (tests/apiserver.py: ivo, a contributor; rev, an administrator; rvw, a reviewer;
// ana, bob… — all with web/bench/session.mjs's password, fictitious): a page opened without a
// session signs in as ivo. Ctrl-C stops everything and removes the database.
//   node web/bench/try.mjs [--seed full|empty] [--port 4470]
// The map at http://127.0.0.1:4470/ as ivo; ?as=rev (or ?as=rvw, ?as=ivo) on any page
// signs in as that account (POST /api/session; rev and rvw by /revue's privileged entry,
// POST /api/review/session, as /revue's form does), ?as= signs out; /revue as rev (every
// tab) or rvw (« File » only). The servers are the state captures' (states/
// harness.mjs) on ports of their own (4470, 4471, 8797), so that captures and the gate run
// beside it. It builds in build/try/ (ignored by git), never in web/dist nor web/public.
// Without the CI extract (data/build/ci) it builds it first, from the CI fixture, as CI does.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BENCH_PASSWORD } from "./session.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const ROOT = resolve(import.meta.dirname, "../..");
const WEB = join(ROOT, "web");
const OUT = join(ROOT, "build/try");
const seed = arg("--seed", "full");
const port = Number(arg("--port", "4470"));
if (!["full", "empty"].includes(seed)) {
  console.error("try: --seed full or empty");
  process.exit(2);
}
const sh = (script, opts = {}) =>
  execFileSync("bash", ["-euo", "pipefail", "-c", script], {
    cwd: ROOT,
    stdio: "inherit",
    ...opts,
  });

// --- the CI extract: what the API loads and the map shows ---------------------------------
const tiles = join(ROOT, "data/build/ci/tiles");
const fixture = join(ROOT, "tests/fixtures/contrib-ci.jsonl");
const contrib = join(ROOT, "data/contrib/ci.jsonl");
if (!existsSync(join(tiles, "meta.json"))) {
  console.log("try: no CI extract in data/build/ci, built now from the CI fixture (a minute)");
  sh(`mkdir -p data/contrib && cp ${fixture} ${contrib} && uv run lacarte build --region ci`);
} else if (
  !existsSync(contrib) ||
  readFileSync(contrib, "utf8") !== readFileSync(fixture, "utf8")
) {
  console.log(
    "try: data/contrib/ci.jsonl is not the CI fixture: the map's history differs from the" +
      " seed's (mkdir -p data/contrib && cp tests/fixtures/contrib-ci.jsonl data/contrib/ci.jsonl" +
      " && make build REGION=ci)",
  );
}
for (const f of ["fonts/Noto Sans Regular", "sprites/grayscale.json"])
  if (!existsSync(join(WEB, "public/basemap", f))) {
    console.error(
      "try: no basemap fonts and sprites in web/public/basemap: web/scripts/fetch-assets.sh ci",
    );
    process.exit(2);
  }
if (!existsSync(join(WEB, "node_modules"))) {
  console.error("try: no web/node_modules: npm --prefix web ci");
  process.exit(2);
}

// --- the front: the working tree's web files, built apart (as web/scripts/gate.sh does) -----
console.log("try: building the web interface in build/try/web");
const basemap = existsSync(join(ROOT, "data/basemap/ci.pmtiles"))
  ? join(ROOT, "data/basemap/ci.pmtiles")
  : join(ROOT, "tests/fixtures/ci-basemap.pmtiles");
sh(`
  rm -rf "${OUT}" && mkdir -p "${OUT}/web"
  git ls-files -co --exclude-standard -- web | sed -n 's#^web/##p' |
    grep -v -e '^node_modules$' -e '^public/basemap/' -e '^public/tiles' |
    while IFS= read -r f; do [ -f "web/$f" ] && printf '%s\\n' "$f"; done |
    (cd web && tar -cf - -T -) | (cd "${OUT}/web" && tar -xf -)
  mkdir -p "${OUT}/web/public/basemap"
  ln -s "${WEB}/public/basemap/fonts" "${OUT}/web/public/basemap/fonts"
  ln -s "${WEB}/public/basemap/sprites" "${OUT}/web/public/basemap/sprites"
  ln -s "${WEB}/node_modules" "${OUT}/web/node_modules"
  (cd "${OUT}/web" && npm run --silent build -- --logLevel warn)
  cp -R "${tiles}/" "${OUT}/web/dist/tiles"
  cp "${basemap}" "${OUT}/web/dist/basemap/basemap.pmtiles"
`);

// --- the servers and the data -------------------------------------------------------------
process.env.LACARTE_DIST = join(OUT, "web/dist");
process.env.STATES_PORTS = `${port},${port + 1},${port + 327}`;
const h = await import("./states/harness.mjs");
const { SEEDS } = await import("./states/seed.mjs");
h.setDefaultAccount("ivo");
let stopping = false;
const stop = async (code) => {
  if (stopping) {
    h.killServers(); // a second Ctrl-C: at once
    process.exit(code);
  }
  stopping = true;
  console.log("\ntry: stopping the servers and removing the database…");
  h.halt();
  await h.stopServers();
  h.closeProxy();
  process.exit(code);
};
for (const [signal, n] of [
  ["SIGINT", 2],
  ["SIGTERM", 15],
  ["SIGHUP", 1],
])
  process.on(signal, () => void stop(128 + n));
try {
  console.log("try: starting the API (a throwaway PostGIS database) and the site");
  await h.startServers();
  console.log(`try: seeding the "${seed}" test data through the API`);
  try {
    await SEEDS[seed]();
  } catch (e) {
    // The extract was built before the rules or the code changed (its build id differs from
    // the one the code gives): the contributions are in, the build's outcome is not.
    if (!/contribution outcome of build/.test(String(e.message))) throw e;
    console.log(
      "try: the CI extract is older than the code (another build id): the test data is in, " +
        "not settled as a deploy would (no applied, superseded nor conflict status); to " +
        "settle it, build the extract again (make build REGION=ci with the CI fixture)",
    );
  }
} catch (e) {
  console.error(`try: ${e.message}`);
  await stop(1);
}
const app = `http://127.0.0.1:${port}`;
console.log(`
  La carte, compte ivo                 :  ${app}/?as=ivo#17/48.8967/2.2388
  La revue, compte rev (administrateur):  ${app}/revue?as=rev
  La revue, compte rvw (relecteur)     :  ${app}/revue?as=rvw
  Changer de compte                    :  ajouter ?as=ivo, ?as=rev ou ?as=rvw à n'importe quelle page
  Se déconnecter                       :  ajouter ?as= (le formulaire de connexion ensuite)
  Mot de passe de chaque compte        :  ${BENCH_PASSWORD}

  Ctrl-C arrête tout.`);
await new Promise(() => {}); // until a signal
