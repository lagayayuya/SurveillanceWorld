// The shortest move into the part of the map the panels leave free (src/nudge.ts): a
// tapped camera already in it does not move; under the sheet, it rises just above it.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { nudge } from "../src/nudge.ts";

// A phone: 390 x 664, the estimate bar's 70 px at the top, a half sheet's 352 px at the bottom.
const PHONE = { top: 70, bottom: 352, left: 16, right: 16 };
const R = 20;

test("a point already in the free part does not move", () => {
  assert.equal(nudge({ x: 195, y: 200 }, 390, 664, PHONE, R), null);
  // Its disc touching the edges counts as in.
  assert.equal(nudge({ x: 36, y: 90 }, 390, 664, PHONE, R), null);
  assert.equal(nudge({ x: 354, y: 292 }, 390, 664, PHONE, R), null);
});

test("under the sheet, it rises just above it, no sideways move", () => {
  assert.deepEqual(nudge({ x: 195, y: 500 }, 390, 664, PHONE, R), [0, 292 - 500]);
});

test("under the bar or at a side, the least move on each axis", () => {
  assert.deepEqual(nudge({ x: 5, y: 40 }, 390, 664, PHONE, R), [36 - 5, 90 - 40]);
  assert.deepEqual(nudge({ x: 385, y: 200 }, 390, 664, PHONE, R), [354 - 385, 0]);
});

test("off the screen, or no room for the disc: no move", () => {
  assert.equal(nudge({ x: 195, y: 700 }, 390, 664, PHONE, R), null);
  assert.equal(nudge({ x: -3, y: 200 }, 390, 664, PHONE, R), null);
  // A full sheet: 34 px left between the bar and the sheet, less than the disc.
  const full = { ...PHONE, bottom: 560 };
  assert.equal(nudge({ x: 195, y: 600 }, 390, 664, full, R), null);
});

test("a wide screen: out from under the side sheet, to its left", () => {
  const wide = { top: 166, bottom: 40, left: 20, right: 425 };
  assert.deepEqual(nudge({ x: 1000, y: 400 }, 1280, 800, wide, R), [835 - 1000, 0]);
  assert.equal(nudge({ x: 600, y: 400 }, 1280, 800, wide, R), null);
});
