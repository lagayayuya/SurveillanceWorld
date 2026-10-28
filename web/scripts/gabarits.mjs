// The register's templates from the prototype's (the mockups' markup, every change logged where they
// were made): one pass, so that a template keeps the mockup's tags, attributes and inline styles as
// they are and only these change —
//   · every word of the interface becomes a path into the catalogue: a text with no hole becomes
//     {{t.<view>.<key>}}, a text with holes {{f.<view>.<key>}} (the page fills its placeholders from
//     the view's values: registre/vues/formats.json says which path fills which placeholder); the
//     words go to locales/fr.json as registre.<view>.<key>;
//   · the kit's colours that are named otherwise on the site (the kit's --card is --bg-2, its --link
//     and blue --accent are --blue, its --hover is --accent-fill, its --warn fill is --warn-bg);
//   · the prototype's links (#/…) become the register's paths (/registre/…).
// Usage: node scripts/gabarits.mjs <prototype's vues/ folder> <name> […]
//   writes src/registre/vues/<name>.html, src/registre/vues/formats.json and the keys into fr.json;
//        node scripts/gabarits.mjs --css <prototype's kit.css>
//   writes src/registre/registre.css (the kit without its own colour values, the site's names).
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WEB = resolve(import.meta.dirname, "..");
const OUT = join(WEB, "src/registre/vues");
const CATALOGUE = join(WEB, "src/locales/fr.json");

/** The kit's names → the site's (DECISIONS 2026-10-28, the register's tokens). */
const COLOURS = [
  [/var\(--card\)/g, "var(--bg-2)"],
  [/var\(--link\)/g, "var(--blue)"],
  [/var\(--accent\)/g, "var(--blue)"],
  [/var\(--warn\)/g, "var(--warn-bg)"],
  // pink as a text colour (on hover) is the site's text pink; anywhere else, the fill
  [/(^|[;{\s"])color:\s*var\(--hover\)/g, "$1color: var(--accent)"],
  [/var\(--hover\)/g, "var(--accent-fill)"],
];
export const colours = (css) => COLOURS.reduce((s, [re, to]) => s.replace(re, to), css);

/** #/registre/chiffres → /registre/chiffres; #/ → /registre/; #/commune/… → /registre/commune/… */
export const path = (href) =>
  href === "#/" ? "/registre/" : href.replace(/^#\/(?:registre\/)?/, "/registre/");

const ATTRS = new Set(["aria-label", "placeholder", "title", "alt", "aria-description", "aria-roledescription"]);
const HOLE = /\{\{\{?\s*([\w.]+)\s*\}?\}\}/g;
const WORD = /\p{L}{2,}/u;

/** A key from the text's first words: ascii, lower case, at most five words. */
function slug(text, used) {
  const base =
    text
      .replace(HOLE, " ")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, 5)
      .join("_") || "texte";
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`;
  used.add(key);
  return key;
}

/** A text of the interface → its path, its words into `keys`, its placeholders into `formats`. */
function word(view, text, keys, formats, used, reuse) {
  const lead = text.match(/^\s*/)[0];
  const tail = text.match(/\s*$/)[0];
  const body = text.trim().replace(/\s+/g, " ");
  const holes = [...body.matchAll(HOLE)];
  if (holes.some((h) => h[0].startsWith("{{{"))) return text; // a rich value stays the view's
  const message = body.replace(HOLE, (_, p) => `{${p.replace(/\./g, "_")}}`);
  let key = reuse.get(message);
  if (!key) {
    key = slug(body, used);
    reuse.set(message, key);
    keys[`registre.${view}.${key}`] = message;
    if (holes.length) formats[`${view}.${key}`] = Object.fromEntries(holes.map((h) => [h[1].replace(/\./g, "_"), h[1]]));
  }
  return `${lead}{{${holes.length ? "f" : "t"}.${view}.${key}}}${tail}`;
}

/** The register's keys written into fr.json as lines of their own, after the others, by view; the
 * other lines are left byte for byte (their escapes as they are), no-break spaces escaped as most
 * of the file does. */
export function writeCatalogue(catalogue) {
  const lines = readFileSync(CATALOGUE, "utf8").trimEnd().split("\n");
  const kept = lines.slice(1, -1).filter((l) => !l.startsWith('  "registre.'));
  kept[kept.length - 1] = kept[kept.length - 1].replace(/,?$/, ",");
  const register = Object.keys(catalogue)
    .filter((k) => k.startsWith("registre."))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(catalogue[k]).replace(/\u00a0/g, "\\u00a0")}`);
  const body = register.length ? [...kept, ...register.map((l, n) => (n < register.length - 1 ? `${l},` : l))] : kept;
  if (!register.length) body[body.length - 1] = body[body.length - 1].replace(/,$/, "");
  writeFileSync(CATALOGUE, `{\n${body.join("\n")}\n}\n`);
}

export function pass(view, html) {
  const keys = {};
  const formats = {};
  const used = new Set();
  const reuse = new Map();
  let out = "";
  let i = 0;
  let raw = null; // inside <svg>, <style> or <script>: copied as is
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i) + 3;
      out += html.slice(i, end);
      i = end;
      continue;
    }
    if (html[i] === "<") {
      const end = html.indexOf(">", i) + 1;
      let tag = html.slice(i, end);
      const name = (tag.match(/^<\/?([\w-]+)/) || [])[1]?.toLowerCase();
      if (raw) {
        if (tag.startsWith(`</${raw}`)) raw = null;
        out += tag;
        i = end;
        continue;
      }
      if (!tag.startsWith("</") && ["svg", "style", "script"].includes(name) && !tag.endsWith("/>")) raw = name;
      tag = tag.replace(/\s([\w-]+)="([^"]*)"/g, (m, attr, value) => {
        if (attr === "style") return ` style="${colours(value)}"`;
        if (attr === "href" && value.startsWith("#/")) return ` href="${path(value)}"`;
        if (ATTRS.has(attr) && WORD.test(value.replace(HOLE, "")))
          return ` ${attr}="${word(view, value, keys, formats, used, reuse)}"`;
        return m;
      });
      out += tag;
      i = end;
      continue;
    }
    const next = html.indexOf("<", i);
    const text = html.slice(i, next < 0 ? html.length : next);
    out += raw || !WORD.test(text.replace(HOLE, "")) ? text : word(view, text, keys, formats, used, reuse);
    i = next < 0 ? html.length : next;
  }
  return { html: out, keys, formats };
}

const CSS_HEAD = `/* The register (registre.html): its kit, the wide mockups' « socle » (their kit-grand-ecran, § 1), as the
   mockups write it, then each view's own rules scoped by its class (.v-<name>), then what the site adds:
   the fluid column under 1280 px, the map's frame, the dialogs, the phone (under 960 px, one column, a fixed
   band for the panel, rows that unfold) and the accessibility fixes. Made by scripts/gabarits.mjs --css from
   the prototype's kit.css. Colours are the punk tokens (theme/punk/tokens.css, light and dark): the kit's
   --card is --bg-2, its --link and blue --accent are --blue, its --hover is --accent-fill (pink text on
   hover is --accent), its --warn fill is --warn-bg. */

/* Archivo 400-900 and Special Elite, served by the site (theme/fonts, README there). */
@font-face { font-family: Archivo; src: url(../theme/fonts/archivo-400-900-62-100.woff2) format("woff2"); font-weight: 400 900; font-stretch: 62% 100%; font-display: swap; }
@font-face { font-family: "Special Elite"; src: url(../theme/fonts/special-elite.woff2) format("woff2"); font-weight: 400; font-display: swap; }

`;
/** The kit's stylesheet from its « kit, § 1 » section on, without its own colour values. */
export function css(kit) {
  const lines = kit.split("\n");
  const start = lines.findIndex((l) => l.startsWith("/* --- kit, § 1"));
  const body = lines
    .slice(start)
    .filter((l) => !/^\.(th|v-carte)(\.dark)?\{--page/.test(l))
    .join("\n");
  return `${CSS_HEAD}${colours(body).trimEnd()}\n`;
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "--css") {
  writeFileSync(join(WEB, "src/registre/registre.css"), css(readFileSync(process.argv[3], "utf8")));
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, ...names] = process.argv.slice(2);
  if (!from || !names.length) {
    console.error("usage: node scripts/gabarits.mjs <prototype vues/> <name> […]");
    process.exit(2);
  }
  const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8"));
  const formatsFile = join(OUT, "formats.json");
  let allFormats = {};
  try {
    allFormats = JSON.parse(readFileSync(formatsFile, "utf8"));
  } catch {
    // first run
  }
  for (const name of names) {
    const source = readFileSync(join(from, `${name}.html`), "utf8");
    const { html, keys, formats } = pass(name, source);
    for (const k of Object.keys(catalogue)) if (k.startsWith(`registre.${name}.`)) delete catalogue[k];
    for (const k of Object.keys(allFormats)) if (k.startsWith(`${name}.`)) delete allFormats[k];
    Object.assign(catalogue, keys);
    Object.assign(allFormats, formats);
    writeFileSync(join(OUT, `${name}.html`), html);
    console.log(`${name}: ${Object.keys(keys).length} keys, ${Object.keys(formats).length} with placeholders`);
  }
  writeCatalogue(catalogue);
  writeFileSync(formatsFile, `${JSON.stringify(allFormats, null, 2)}\n`);
}
