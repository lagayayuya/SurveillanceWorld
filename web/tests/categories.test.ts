// The category a piece just sent earns, told on the phone for 8a's tickets (src/profile/
// award.ts), against the server's rule (pipeline/lacarte/api/leaderboard.py awards(),
// rules/leaderboard.yaml known). bench/smoke-score.mjs compares it with the real API.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { awardOf, known } from "../src/profile/award.ts";

// 8a's dome on the CI extract (n998633844) as its tile says it: camera:type dome, height 7
// and an operator from OSM; its direction 180° a contribution's (OSM's camera:direction=360
// is out of range for the pipeline), its month with it.
const DOME = { k: "dome", kc: 1, d: 180, dc: 1, dm: "2026-10", hc: 1, h: 7, o: "pub" };
const on = (kind: string, extra: object = {}) => ({
  kind: kind as "shape",
  camera: "n998633844",
  on_site: null,
  ...extra,
});

test("on 8a's dome: the height and the operator correct, the direction an answer gave adds", () => {
  assert.equal(awardOf(on("height", { answer: "first" }), DOME), "correction");
  assert.equal(awardOf(on("operator", { answer: "public" }), DOME), "correction");
  assert.equal(awardOf(on("direction"), DOME), "info");
  assert.equal(awardOf(on("shape", { answer: "bullet" }), DOME), "correction");
  assert.equal(awardOf(on("tilt", { answer: "slight" }), DOME), "info");
});

test("a default or a contribution's value is not known; nothing in the tile, an info", () => {
  assert.equal(known("shape", { k: "fixed", kc: 0 }), false);
  assert.equal(known("shape", { k: "dome", kc: 1, km: "2026-09" }), false);
  assert.equal(known("direction", { d: -1, dc: 0 }), false);
  assert.equal(known("direction", { d: 90, dc: 1 }), true);
  assert.equal(known("height", { hc: 0 }), false);
  assert.equal(known("height", { hc: 1, hm: "2026-09" }), false);
  assert.equal(known("tilt", { t: "steep" }), true);
  assert.equal(known("operator", { o: "unk" }), false);
  assert.equal(awardOf(on("height", { answer: "upper" }), {}), "info");
});

test("« Je ne sais pas » and « Je ne vois pas » earn nothing", () => {
  assert.equal(awardOf(on("height", { answer: "unknown" }), DOME), null);
  assert.equal(awardOf(on("direction", { answer: "not_visible" }), DOME), null);
});

test("an add, its answers (infos whatever the tile), a move", () => {
  assert.equal(awardOf({ kind: "add", on_site: null }, {}), "add");
  const added = { kind: "height" as const, answer: "first" as const, camera: "c7410150b5b72" };
  assert.equal(awardOf({ ...added, on_site: null }, DOME), "info");
  assert.equal(awardOf(on("move"), DOME), "correction");
});

test("« Toujours là ? » scores on site only, present or not found", () => {
  const verify = (answer: string, on_site: boolean | null) =>
    awardOf({ kind: "verify", answer: answer as "present", on_site, camera: "n1" }, {});
  assert.equal(verify("present", true), "verification");
  assert.equal(verify("not_found", true), "verification");
  assert.equal(verify("present", false), null);
  assert.equal(verify("present", null), null);
  assert.equal(verify("unsure", true), null);
});
