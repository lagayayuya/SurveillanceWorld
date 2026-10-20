// The points scored at the send (board 8a; src/participate/points.ts, drawn by score.ts):
// each ticket shows exactly what the server gave for its piece, the bonus apart, never a
// number of its own; the tickets fall on 8a's times; 8a's spring as the map turns the field.
// The strings the scene says are in fr.json. bench/smoke-score.mjs checks it in the browser.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BANG,
  bonusOf,
  cubicBezier,
  fallTimes,
  LAND,
  type Points,
  pointsOf,
  TOTAL,
} from "../src/participate/points.ts";

const item = (uuid: string, category: string, points: number, bonus = false) => ({
  uuid,
  kind: "x",
  category: category as "info",
  points,
  bonus,
  accepted: false,
});

test("a ticket's points are the server's items for its uuid, the bonus apart", () => {
  const p: Points = {
    items: [
      item("a", "add", 50),
      item("a", "add", 10, true),
      item("b", "info", 10),
      item("c", "correction", 20),
    ],
    total: 90,
  };
  assert.deepEqual(pointsOf(p, "a"), { points: 50, category: "add" });
  assert.deepEqual(pointsOf(p, "c"), { points: 20, category: "correction" });
  assert.equal(pointsOf(p, "d"), null, "a piece that earns nothing has no item: no number");
  assert.equal(bonusOf(p), 10);
  const shown = ["a", "b", "c"].reduce((s, u) => s + (pointsOf(p, u)?.points ?? 0), 0) + bonusOf(p);
  assert.equal(shown, p.total, "the tickets add up to the server's total");
  assert.equal(bonusOf({ items: [], total: 0 }), 0);
});

test("the tickets fall on 8a's times: 330 ms apart up to three, more within the same second", () => {
  assert.deepEqual(fallTimes(3), [LAND + 650, LAND + 980, LAND + 1310]);
  const six = fallTimes(6);
  assert.equal(six[0], LAND + 650);
  assert.equal(six[5], LAND + 650 + 990);
  assert.ok(six.at(-1)! < LAND + TOTAL, "the last ticket lands before the total falls");
  assert.ok(LAND + TOTAL < LAND + BANG, "the cannon bursts after the total");
  assert.ok(LAND <= 400, "the sheet is gone within 400 ms (DECISIONS 2026-10-06, animations)");
});

test("8a's spring: from 0 to 1, overshooting on the way", () => {
  const ease = cubicBezier(0.2, 1.6, 0.4, 1);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  const peak = Math.max(...Array.from({ length: 99 }, (_, i) => ease((i + 1) / 100)));
  assert.ok(peak > 1.05, `overshoot ${peak}`);
  const linear = cubicBezier(0, 0, 1, 1);
  assert.ok(Math.abs(linear(0.3) - 0.3) < 1e-6);
});

test("every string the scene says is in fr.json", () => {
  const fr = JSON.parse(
    readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
  ) as Record<string, string>;
  const code = ["participate/score.ts", "participate/modify.ts", "participate/index.ts"]
    .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"))
    .join("\n");
  const keys = [...code.matchAll(/t\(\s*"(score\.[\w.]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 5);
  for (const k of keys) assert.ok(k in fr, `fr.json has no ${k}`);
  // The leaderboard's words (profile/categories.ts): the legend's, in the singular.
  for (const cat of ["add", "info", "correction", "verification"])
    assert.ok(`board.count.one.${cat}` in fr && `board.count.${cat}` in fr);
  for (const k of ["board.scale.bonus.title", "board.pending.unit", "board.pending.waiting"])
    assert.ok(k in fr, k);
  // « Toujours là ? » earns on site only (profile/award.ts): its tickets say so.
  for (const a of ["present", "not_found"]) {
    assert.ok(`score.what.${a}` in fr && `score.det.${a}_on_site` in fr);
  }
  // A send that earns nothing: the short confirmation, no scene.
  assert.equal(fr["score.sent"], "Envoyé · en attente de revue");
});
