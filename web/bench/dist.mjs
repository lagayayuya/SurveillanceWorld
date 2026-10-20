// The production build a bench script serves: web/dist, or the folder named by LACARTE_DIST
// (the local gate, web/scripts/gate.sh, builds the current code and the reference one in
// folders of their own, so that web/dist and the region linked in web/public stay the
// developer's).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const WEB = resolve(import.meta.dirname, "..");
export const DIST = process.env.LACARTE_DIST
  ? resolve(process.env.LACARTE_DIST)
  : resolve(WEB, "dist");

/** `npx` arguments for `vite preview` serving DIST on `port` (and `host`, when given); run
 * them with `cwd: WEB`. */
export const preview = (port, host = null) => [
  "vite",
  "preview",
  ...(host ? ["--host", host] : []),
  "--port",
  String(port),
  "--strictPort",
  "--outDir",
  DIST,
];

const buildId = (meta) =>
  existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")).build_id : null;

/** Stop (exit 2) unless DIST serves `region`'s tiles: `npm run build` copies the region
 * linked in web/public, and a test reading another region's cameras fails for nothing (the
 * participation tests failed so on a machine linked to IDF). With `exact`, they must be the
 * build in data/build/<region>, the one tests/apiserver.py loads. */
export function requireTiles(region, exact = false) {
  const served = buildId(resolve(DIST, "tiles/meta.json"));
  const built = buildId(resolve(WEB, `../data/build/${region}/tiles/meta.json`));
  if (exact ? served && served === built : served?.startsWith(`${region}-`)) return;
  console.log(
    `FAIL ${DIST} serves the tiles of ${served ?? "no build"}, not ${exact ? (built ?? `a ${region} build`) : `region ${region}`}: ` +
      `web/scripts/fetch-assets.sh ${region} && npm --prefix web run build, or make smoke (its own build)`,
  );
  process.exit(2);
}
