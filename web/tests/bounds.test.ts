// Zoomed out, France stays whole and in the middle (bounds.ts): the lowest zoom fits it on a
// phone, and the view comes back only when it has left the region by more than the margin.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Bounds,
  fitZoom,
  LOWEST_ZOOM_CAP,
  lowestZoom,
  MARGIN,
  recentre,
} from "../src/bounds.ts";

// Metropolitan France with Corsica, as the pipeline writes it (meta.json `bounds`).
const FRANCE: Bounds = [-5.142, 41.333, 9.56, 51.089];
const PHONE = [390, 844] as const;

test("on a phone, France's lowest zoom makes it fill the screen's width", () => {
  const z = lowestZoom(FRANCE, ...PHONE);
  assert.ok(z > 4.1 && z < 4.3, String(z));
  // Width-bound on a portrait phone: its width is what fits, not its height.
  const widthFit = Math.log2(390 / (512 * ((9.56 + 5.142) / 360)));
  assert.ok(Math.abs(z - widthFit) < 1e-9);
});

test("a small region keeps today's lowest zoom", () => {
  const ci: Bounds = [2.2, 48.88, 2.26, 48.9];
  assert.ok(fitZoom(ci, ...PHONE) > LOWEST_ZOOM_CAP);
  assert.equal(lowestZoom(ci, ...PHONE), LOWEST_ZOOM_CAP);
});

test("zoomed out, an off-centre France comes back to the middle", () => {
  const z = lowestZoom(FRANCE, ...PHONE);
  const back = recentre([6, 44], z, FRANCE, ...PHONE);
  assert.ok(back);
  assert.ok(Math.abs(back[0] - (FRANCE[0] + FRANCE[2]) / 2) < 1e-9);
  // Already in the middle: left alone.
  assert.equal(recentre(back, z, FRANCE, ...PHONE), null);
});

test("closer in, the view stays wherever its centre is over France or within the margin", () => {
  assert.equal(recentre([2.35, 48.86], 8, FRANCE, ...PHONE), null); // Paris
  assert.equal(recentre([8.7, 41.9], 9, FRANCE, ...PHONE), null); // Ajaccio
  // Just beyond the east edge but within MARGIN of the screen: stays.
  const px = 512 * 2 ** 8; // CSS px per world unit at z8
  const within = 9.56 + ((MARGIN * 390 * 0.9) / px) * 360;
  assert.equal(recentre([within, 46], 8, FRANCE, ...PHONE), null);
});

test("taken out over the sea or abroad, the view comes back to the margin's edge", () => {
  const back = recentre([15, 46], 8, FRANCE, ...PHONE);
  assert.ok(back);
  const edge = 9.56 + ((MARGIN * 390) / (512 * 2 ** 8)) * 360;
  assert.ok(Math.abs(back[0] - edge) < 1e-6, String(back[0]));
  assert.ok(Math.abs(back[1] - 46) < 1e-6);
  const south = recentre([3, 30], 7, FRANCE, ...PHONE);
  assert.ok(south && south[1] > 40 && south[1] < FRANCE[1]);
});
