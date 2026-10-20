// The third-party licence notices the site serves at /licences.txt (the author's request of
// 2026-10-14), linked from the Sources page. A build plugin: what the bundle ships is read
// from the bundle itself, every npm package a chunk or an emitted file comes from, and the
// packages those were built from when they ship prebuilt (maplibre-gl's dist bundles
// earcut, pbf…: their source maps name them). Each with its licence's full text, read from
// the package (LICENSE, LICENCE, COPYING), else from web/licences/ (a package published
// without one: its upstream text, the URL in the file's first line). Then what is served
// beside the code: the punk fonts (theme/fonts) and the basemap's glyphs and icons
// (fetch-assets.sh, Protomaps' basemaps-assets). A package with no text found stops the
// build: nothing ships without its notice. Its header and section titles are fr.json's
// (`legal.licences.*`), as the page's.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const WEB = resolve(import.meta.dirname, "..");
const VENDORED = join(WEB, "licences");
const ROOT_MODULES = join(WEB, "node_modules");
const TEXT = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

/** What is served beside the code, each with its licence's text (a file of the repository). */
const ASSETS = [
  { name: "Archivo", what: "fonts", licence: "OFL-1.1", file: "src/theme/fonts/OFL-Archivo.txt" },
  {
    name: "Special Elite",
    what: "fonts",
    licence: "Apache-2.0",
    file: "src/theme/fonts/LICENSE-SpecialElite.txt",
  },
  {
    name: "Noto Sans (protomaps/basemaps-assets fonts/)",
    what: "glyphs",
    licence: "OFL-1.1",
    file: "licences/basemaps-assets-fonts.txt",
  },
  {
    name: "tangrams/icons (protomaps/basemaps-assets sprites/)",
    what: "sprites",
    licence: "MIT",
    file: "licences/tangrams-icons.txt",
  },
];

/** The package a file belongs to: its name and folder (the last node_modules in its path; a
 * relative path is web/'s, as an emitted file's original name). */
export function packageOf(file) {
  const path = resolve(WEB, file).replace(/\\/g, "/");
  const m = /^(.*\/node_modules\/)((?:@[^/]+\/)?[^/]+)/.exec(path);
  return m ? { name: m[2], dir: m[1] + m[2] } : null;
}

/** A package's folder by name, looked for beside `from` (a package's folder), then at the root. */
function findPackage(name, from) {
  for (const dir of [join(from, "node_modules", name), join(ROOT_MODULES, name)])
    if (existsSync(join(dir, "package.json"))) return dir;
  return null;
}

/** The packages a prebuilt file was made from: its source map's sources under node_modules. */
function builtFrom(file, pkgDir) {
  const map = `${file}.map`;
  if (!existsSync(map)) return [];
  const { sources = [], sourceRoot = "" } = JSON.parse(readFileSync(map, "utf8"));
  const found = new Map();
  for (const s of sources) {
    const p = packageOf(resolve(dirname(map), sourceRoot, s));
    if (!p || found.has(p.name)) continue;
    const dir = findPackage(p.name, pkgDir);
    if (!dir) throw new Error(`licences: ${p.name}, bundled in ${file}, is not installed`);
    found.set(p.name, dir);
  }
  return [...found];
}

/** Every package the shipped files come from, by name: { dir, via } (via: the package whose
 * prebuilt files bundle it). */
export function shippedPackages(files) {
  const out = new Map();
  for (const raw of files) {
    const file = raw.replace(/^\0/, "").replace(/\?.*$/, "");
    const p = packageOf(file);
    if (!p) continue;
    if (!out.has(p.name)) out.set(p.name, { dir: p.dir, via: null });
    for (const [name, dir] of builtFrom(file, p.dir))
      if (name !== p.name && !out.has(name)) out.set(name, { dir, via: p.name });
  }
  return out;
}

/** A package's licence text: its own file, else the vendored one. */
function licenceText(name, dir) {
  const own = readdirSync(dir).find((f) => TEXT.test(f));
  if (own) return readFileSync(join(dir, own), "utf8");
  const vendored = join(VENDORED, `${name.replace("/", "__")}.txt`);
  if (existsSync(vendored)) return readFileSync(vendored, "utf8");
  // A licence written at the end of the README (murmurhash-js): vendored too, never parsed.
  throw new Error(
    `licences: no licence text for ${name} (${dir}); add web/licences/${name.replace("/", "__")}.txt`,
  );
}

const RULE = "=".repeat(78);

/** The file's text: `words` the catalogue's strings (fr.json). It opens on a byte order
 * mark: a browser then reads it as UTF-8 whatever charset the server's header gives (or
 * none), its French and its authors' names intact. */
export function notices(packages, words) {
  const parts = [words["legal.licences.head"], ""];
  const names = [...packages.keys()].sort();
  parts.push(words["legal.licences.code"], "");
  for (const name of names) {
    const { dir, via } = packages.get(name);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const line = `${name} ${pkg.version} — ${pkg.license}${via ? ` (${words["legal.licences.via"]} ${via})` : ""}`;
    parts.push(RULE, line, RULE, "", licenceText(name, dir).trim(), "");
  }
  parts.push(words["legal.licences.assets"], "");
  for (const a of ASSETS)
    parts.push(
      RULE,
      `${a.name} — ${a.licence}`,
      RULE,
      "",
      readFileSync(join(WEB, a.file), "utf8").trim(),
      "",
    );
  return `\uFEFF${parts.join("\n").trim()}\n`;
}

/** The Vite plugin: licences.txt emitted beside index.html, from what the bundle holds. */
export function licences(words) {
  return {
    name: "licences",
    apply: "build",
    generateBundle(_, bundle) {
      const files = [];
      for (const out of Object.values(bundle)) {
        if (out.type === "chunk") files.push(...out.moduleIds);
        else files.push(...(out.originalFileNames ?? []));
      }
      const packages = shippedPackages(files);
      if (!packages.has("maplibre-gl")) throw new Error("licences: no maplibre-gl in the bundle?");
      this.emitFile({ type: "asset", fileName: "licences.txt", source: notices(packages, words) });
    },
  };
}
