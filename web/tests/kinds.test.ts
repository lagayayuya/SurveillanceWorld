// The camera kinds the web knows, against the build's (pipeline/lacarte/camerafilters.py
// KIND_ORDER, the order of meta.json segment_bits `kind:*`): the map's layers keep only
// the kinds of icons.ts KINDS (filters.ts, `["in", ["get", "k"], …]`), so a kind the build
// writes and a list here lacks takes its cameras and their fields off the map (the
// multi-dome, 2026-10-23). Every hard-coded copy (chunks that import nothing at run time)
// is checked too, and each kind has its words in fr.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { KINDS as COLLECTION } from "../src/profile/collection.ts";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const FR = JSON.parse(read("../src/locales/fr.json")) as Record<string, string>;

/** The strings of a bracketed list, found after `anchor` in a source. */
function listAfter(source: string, anchor: string | RegExp): string[] {
  const at = typeof anchor === "string" ? source.indexOf(anchor) : source.search(anchor);
  assert.ok(at >= 0, `no ${anchor}`);
  const open = source.indexOf("[", source.indexOf("=", at));
  const body = source.slice(open + 1, source.indexOf("]", open));
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

const BUILD = listAfter(read("../../pipeline/lacarte/camerafilters.py"), "KIND_ORDER =");

test("the build's kinds include the multi-dome", () => {
  assert.ok(BUILD.includes("multidome"), BUILD.join(","));
  assert.equal(BUILD.at(-1), "unknown");
});

test("icons.ts KINDS is the build's list, in its order", () => {
  assert.deepEqual(listAfter(read("../src/icons.ts"), "export const KINDS ="), BUILD);
});

test("every other list of kinds holds the build's kinds", () => {
  const sorted = (l: readonly string[]) => [...l].sort();
  const lists: [string, readonly string[]][] = [
    ["areapunk.ts KINDS", listAfter(read("../src/areapunk.ts"), /^const KINDS =/m)],
    ["machine.ts order", listAfter(read("../src/machine.ts"), "const order: Kind[] =")],
    ["profile/collection.ts KINDS", COLLECTION],
  ];
  for (const [name, list] of lists) assert.deepEqual(sorted(list), sorted(BUILD), name);
  // /revue words every known kind; an unknown one (or null) is « Caméra ».
  const words = listAfter(read("../src/review/rows.ts"), "const KIND_WORDS =");
  assert.deepEqual(sorted([...words, "unknown"]), sorted(BUILD));
});

test("every kind has its words in fr.json", () => {
  const prefixes = [
    "kind",
    "sheet.kind",
    "filters.kind",
    "area.punk.kind",
    "sheet.punk.title",
    "review.kind",
  ];
  const missing = BUILD.flatMap((k) =>
    [...prefixes.map((p) => `${p}.${k}`), `sheet.kind.${k}.gender`].filter((key) => !(key in FR)),
  );
  assert.deepEqual(missing, []);
});
