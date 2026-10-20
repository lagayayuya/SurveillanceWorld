// The phone's magnet against Python's: every frozen case of tests/fixtures/magnet-cases.json
// (written by tests/test_magnet_cases.py from buildings.magnet) within 1e-6 m.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { magnet, type Poly, toLocal, toLonLat } from "../src/participate/magnet.ts";

type Case = {
  scene: string;
  drop: [number, number];
  x: number;
  y: number;
  pulled: boolean;
  facade: [number, number][] | null;
};
const data = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/magnet-cases.json", import.meta.url), "utf8"),
) as { capture_m: number; scenes: Record<string, Poly[]>; cases: Case[] };

test(`${data.cases.length} frozen cases give Python's result`, () => {
  const wrong: string[] = [];
  for (const c of data.cases) {
    const r = magnet(c.drop[0], c.drop[1], data.scenes[c.scene], data.capture_m);
    const off = Math.hypot(r.x - c.x, r.y - c.y);
    const edge =
      c.facade === null
        ? r.facade === null
        : r.facade !== null &&
          r.facade.every((p, i) => Math.hypot(p[0] - c.facade![i][0], p[1] - c.facade![i][1]) < 1e-9);
    if (r.pulled !== c.pulled || off > 1e-6 || !edge)
      wrong.push(`${c.scene} ${c.drop}: got ${r.x},${r.y} ${r.pulled}, want ${c.x},${c.y} ${c.pulled}`);
  }
  assert.deepEqual(wrong, []);
});

test("the local frame goes and comes back", () => {
  const f = { lon0: 2.2, lat0: 48.9, to_m: [[73000, 1500], [-1000, 111000]], to_ll: [] as number[][] };
  const [[a, b], [c, d]] = f.to_m;
  const det = a * d - b * c;
  f.to_ll = [[d / det, -b / det], [-c / det, a / det]];
  const [x, y] = toLocal(f, 2.2003, 48.9002);
  const [lon, lat] = toLonLat(f, x, y);
  assert.ok(Math.abs(lon - 2.2003) < 1e-12 && Math.abs(lat - 48.9002) < 1e-12);
});
