// Theme A's shared pieces: a chart's value axis (Ju 10/11: the unit from the largest value, round
// graduations, every chart of the register). SYNTHETIC values.
import assert from "node:assert/strict";
import { test } from "node:test";
import { axeA } from "../src/registre/socle-a.ts";

const NB = " ";
const labels = (a: ReturnType<typeof axeA>) => a.ticks.map((x) => x.l);

test("an amount below 1 M€ is in euros, its graduations round", () => {
  const a = axeA(100_000);
  assert.equal(a.u, "e");
  assert.equal(a.pas, 25_000);
  assert.equal(a.haut, 100_000);
  assert.deepEqual(labels(a), ["0", `25${NB}000`, `50${NB}000`, `75${NB}000`, `100${NB}000`]);
  assert.deepEqual(
    a.ticks.map((x) => x.v),
    [0, 25_000, 50_000, 75_000, 100_000],
  );
});

test("never 0,03 / 0,05 / 0,08: a 0,1 M€ chart reads in euros", () => {
  const a = axeA(83_000);
  assert.equal(a.u, "e");
  assert.equal(a.pas, 25_000);
  assert.ok(a.ticks.every((x) => x.v % 25_000 === 0));
  assert.equal(a.val(83_456.7), `83${NB}457`);
});

test("just under 1 M€: 250 000 € steps", () => {
  const a = axeA(950_000);
  assert.equal(a.u, "e");
  assert.equal(a.pas, 250_000);
  assert.equal(a.haut, 1_000_000);
});

test("from 1 M€, millions, one decimal at most", () => {
  const a = axeA(1_200_000);
  assert.equal(a.u, "me");
  assert.equal(a.pas, 500_000);
  assert.deepEqual(labels(a), ["0", "0,5", "1", "1,5"]);
  assert.equal(a.val(1_234_567), "1,2");
  assert.equal(a.val(20_000), "< 0,1");
  const b = axeA(35_000_000);
  assert.equal(b.pas, 10_000_000);
  assert.deepEqual(labels(b), ["0", "10", "20", "30", "40"]);
  // 2,5 is round in its unit, 0,25 is not
  assert.equal(axeA(9_000_000).pas, 2_500_000);
  assert.notEqual(axeA(1_000_000).pas, 250_000);
});

test("more lines allowed: the board's 5, 10, 15, 20 under 21 M€", () => {
  const a = axeA(20_500_000, "eur", 5);
  assert.equal(a.pas, 5_000_000);
  assert.deepEqual(
    labels(a).filter((_, i) => a.ticks[i].v <= 20_500_000),
    ["0", "5", "10", "15", "20"],
  );
});

test("a count keeps whole steps and no unit", () => {
  const a = axeA(25, "nb");
  assert.equal(a.u, null);
  assert.equal(a.pas, 10);
  assert.deepEqual(labels(a), ["0", "10", "20", "30"]);
  assert.equal(axeA(3, "nb").pas, 1);
  assert.equal(axeA(9, "nb").pas, 5);
  assert.equal(axeA(12, "nb").pas, 5);
  assert.equal(axeA(250, "nb").pas, 100);
});

test("an amount per inhabitant keeps its unit, one decimal at most", () => {
  const a = axeA(0.8, "reel");
  assert.equal(a.u, null);
  assert.equal(a.pas, 0.2);
  assert.deepEqual(labels(a), ["0", "0,2", "0,4", "0,6", "0,8"]);
  assert.equal(axeA(61, "reel").pas, 20);
});

test("nothing above 0, no graduation", () => {
  assert.deepEqual(axeA(0).ticks, []);
  assert.deepEqual(axeA(Number.NaN, "nb").ticks, []);
  assert.equal(axeA(0).val(0), "0");
});
