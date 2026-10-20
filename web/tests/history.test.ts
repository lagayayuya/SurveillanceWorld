// A camera's history in words (src/historytext.ts, lot U): what the page keeps of the API's
// answer — months only, OpenStreetMap's live server only — and how each entry is said, in
// both interfaces, every key in fr.json.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { lineText, osmLinks, parseHistory, WHATS, whatText, whoText } from "../src/historytext.ts";

const FR = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
) as Record<string, string>;
const t = (key: string, params: Record<string, string | number> = {}) => {
  assert.ok(key in FR, `fr.json has no ${key}`);
  return FR[key].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));
};
const month = (m: string) => (m === "2026-09" ? "septembre 2026" : m);
const entry = (x: Record<string, unknown>) =>
  parseHistory({ history: [{ what: "seen", month: "2026-09", on_site: true, by: null, osm: null, ...x }] });

test("each change has its own word, every one in fr.json", () => {
  const words = WHATS.map((w) => whatText(w, t));
  assert.equal(new Set(words).size, WHATS.length);
  const keys = Object.keys(FR).filter((k) => k.startsWith("history.what."));
  assert.deepEqual(keys.map((k) => k.slice(13)).sort(), [...WHATS].sort());
});

test("anonymous unless a pseudonym is given", () => {
  assert.equal(whoText(null, t), "par un contributeur");
  assert.equal(whoText("ju_93", t), "par ju_93");
});

test("an entry's first line: the change and the month in words, nothing else", () => {
  const [seen] = entry({}) ?? [];
  assert.equal(lineText(seen, t, month), "Vérifiée · septembre 2026");
  const [moved] = entry({ what: "moved", on_site: false, by: "ju_93" }) ?? [];
  assert.equal(lineText(moved, t, month), "Position corrigée · septembre 2026");
});

test("months only: a day, an unknown change or a malformed answer is left out", () => {
  assert.equal(parseHistory(null), null);
  assert.equal(parseHistory({ history: "x" }), null);
  assert.deepEqual(entry({ month: "2026-09-14" }), []);
  assert.deepEqual(entry({ what: "agree" }), []);
  assert.equal(entry({ by: "" })?.[0].by, null);
});

test("a link to OpenStreetMap's live server only, one per object", () => {
  const live = "https://www.openstreetmap.org/node/42/history";
  assert.equal(entry({ osm: live })?.[0].osm, live);
  assert.equal(entry({ osm: "https://master.apis.dev.openstreetmap.org/node/42/history" })?.[0].osm, null);
  const two = parseHistory({
    history: [
      { what: "seen", month: "2026-09", osm: live },
      { what: "moved", month: "2026-08", osm: live },
    ],
  });
  assert.deepEqual(osmLinks(two ?? []), [live]);
});
