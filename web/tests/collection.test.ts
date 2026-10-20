// « Mes caméras » as data (src/profile/collection.ts, lot U): the person's contributions
// gathered by camera, the counts by kind, what a tap opens, the little map's frame.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CameraLabel, Mine } from "../src/participate/api.ts";
import { collect, DOT_R, frameOf, labelPlace, whatOf } from "../src/profile/collection.ts";

const label = (kind: string | null, extra: Partial<CameraLabel> = {}): CameraLabel => ({
  add: false,
  built: true,
  kind,
  operator: null,
  operator_class: null,
  street: "Rue de Bezons",
  commune: "Courbevoie",
  ...extra,
});
let n = 0;
const sent = (camera: string, kind: string, state: string | null, extra = {}) => ({
  uuid: `u${++n}`,
  kind,
  camera,
  day: "2026-10-04",
  status: "applied",
  answer: kind === "verify" ? "present" : null,
  move_m: null,
  apply_build: null,
  direction: null,
  operator_name: null,
  lng: 2.24,
  lat: 48.9,
  state,
  ...extra,
});
const data = (contributions: ReturnType<typeof sent>[], cameras: Record<string, CameraLabel>) =>
  ({ author: "ju_93", contributions, cameras }) as unknown as Mine;

test("a change in the history's words", () => {
  assert.equal(whatOf("verify", "present"), "seen");
  assert.equal(whatOf("verify", "not_found"), "gone");
  assert.equal(whatOf("move", null), "moved");
  assert.equal(whatOf("add", null), "added");
  assert.equal(whatOf("direction", null), "direction");
});

test("each camera once, its pieces under it; what says nothing is left out", () => {
  const c = collect(
    data(
      [
        sent("n1", "verify", "map"),
        sent("n1", "direction", "validated"),
        sent("n2", "agree", null),
        sent("n3", "shape", "osm", { day: "2026-09-12" }),
      ],
      { n1: label("dome"), n2: label("ptz"), n3: label("fixed") },
    ),
  );
  assert.deepEqual(
    c.cameras.map((o) => [o.camera, o.pieces.map((p) => `${p.what}:${p.state}:${p.month}`)]),
    [
      ["n1", ["seen:map:2026-10", "direction:validated:2026-10"]],
      ["n3", ["shape:osm:2026-09"]],
    ],
  );
  assert.equal(c.total, 2);
  assert.deepEqual(c.byKind, [
    { kind: "dome", n: 1 },
    { kind: "fixed", n: 1 },
  ]);
});

test("a camera only refused is listed, not counted; a refused add opens nothing", () => {
  const add = label("fixed", { add: true, built: false });
  const c = collect(
    data(
      [
        sent("c0123456789ab", "add", "refused"),
        sent("c0123456789cd", "add", "pending"),
        sent("n9", "move", "refused"),
      ],
      { c0123456789ab: add, c0123456789cd: add, n9: label("whatever") },
    ),
  );
  assert.deepEqual(
    c.cameras.map((o) => [o.camera, o.opens, o.counted, o.kind]),
    [
      ["c0123456789ab", null, false, "fixed"],
      ["c0123456789cd", "pending", true, "fixed"],
      ["n9", "camera", false, "unknown"],
    ],
  );
  assert.equal(c.total, 1);
});

test("an older API without `state`: an empty collection, not an error", () => {
  const c = collect({ author: "x", contributions: [sent("n1", "verify", null)] } as unknown as Mine);
  assert.deepEqual([c.cameras, c.byKind, c.total], [[], [], 0]);
});

test("the little map's frame holds every camera, at the box's proportions", () => {
  assert.equal(frameOf([], 2), null);
  const one = frameOf([[2.24, 48.9]], 2) ?? [0, 0, 0, 0];
  assert.ok(one[0] < 2.24 && 2.24 < one[2] && one[1] < 48.9 && 48.9 < one[3]);
  const pts: [number, number][] = [
    [2.2, 48.85],
    [2.4, 48.95],
  ];
  const [w, s, e, n] = frameOf(pts, 320 / 150) ?? [0, 0, 0, 0];
  for (const [x, y] of pts) assert.ok(w < x && x < e && s < y && y < n);
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  assert.ok(Math.abs(((e - w) * k) / (n - s) - 320 / 150) < 1e-9);
});

test("the mini-map's names cover no dot and no other name, or are left out", () => {
  const meets = (b, [x, y]) =>
    x + DOT_R > b.l && x - DOT_R < b.r && y + DOT_R > b.t && y - DOT_R < b.b;
  // Lot U2's case: a camera just under its commune's cameras' middle, where the name went.
  const dots = [
    [150, 60],
    [160, 70],
    [155, 85],
  ];
  const first = labelPlace("Courbevoie", 155, 71, dots, [], 320, 150);
  assert.ok(first && dots.every((d) => !meets(first, d)), JSON.stringify(first));
  assert.ok(first.l >= 0 && first.r <= 320 && first.t >= 0 && first.b <= 150);
  // A second name near the first: placed elsewhere, never over it.
  const second = labelPlace("Puteaux", 157, 72, dots, [first], 320, 150);
  assert.ok(second, "placed");
  assert.ok(second.r <= first.l || second.l >= first.r || second.b <= first.t || second.t >= first.b);
  // No room at all (the drawing full of dots): left out.
  const full = [];
  for (let x = 0; x <= 320; x += 8) for (let y = 0; y <= 150; y += 8) full.push([x, y]);
  assert.equal(labelPlace("Courbevoie", 160, 75, full, [], 320, 150), null);
});
