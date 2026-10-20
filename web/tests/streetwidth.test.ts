// Punk streets as wide as the basemap's road of their class, never under the old pink
// stroke (src/streetwidth.ts; pipeline rules/streets.yaml tile_class): the one expression,
// evaluated by MapLibre's own style code, against the flavour's layers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { expression as mle } from "@maplibre/maplibre-gl-style-spec";
import { layers, namedFlavor } from "@protomaps/basemaps";
import {
  at,
  CLASSES,
  curve,
  PUNK_PORTION_WIDTH as FLOOR,
  streetWidth,
} from "../src/streetwidth.ts";

const flavour = layers("protomaps", namedFlavor("light"), { lang: "fr" });
const spec = { type: "number", "property-type": "data-driven", expression: { interpolated: true, parameters: ["zoom", "feature"] } };

function widthAt(expr: unknown, z: number, c?: string) {
  const e = mle.createExpression(expr, spec as never);
  assert.equal(e.result, "success", JSON.stringify((e as { value: unknown }).value));
  const props = c === undefined ? {} : { c };
  return (e.value as { evaluate: (g: object, f: object) => number }).evaluate(
    { zoom: z },
    { type: 2, properties: props },
  );
}

test("every class is the basemap's road width where it is wider, the floor elsewhere", () => {
  const w = streetWidth(flavour as never, FLOOR as never);
  const floor = curve(FLOOR)!;
  for (const c of CLASSES) {
    const road = curve(flavour.find((l) => l.id === `roads_${c}`)!.paint!["line-width" as never])!;
    for (let z = 12; z <= 20; z += 0.1) {
      const want = Math.max(at(road, z), at(floor, z));
      assert.ok(Math.abs(widthAt(w, z, c) - want) < 0.03, `${c} z${z.toFixed(1)}`);
    }
  }
});

test("a filmed boulevard and a motorway get the basemap's width at the street level", () => {
  const w = streetWidth(flavour as never, FLOOR as never);
  // roads_major 15 -> 3, 18 -> 13; roads_highway 15 -> 5, 18 -> 15 (exponential 1.6).
  assert.ok(Math.abs(widthAt(w, 18, "major") - 13) < 0.01);
  assert.ok(Math.abs(widthAt(w, 18, "highway") - 15) < 0.01);
  assert.ok(widthAt(w, 16.4, "major") > 6);
  // A path keeps the old stroke (the basemap's is narrower).
  assert.ok(Math.abs(widthAt(w, 16, "other") - 3.5) < 0.01);
});

test("a segment without a class, or another basemap, takes the floor", () => {
  const w = streetWidth(flavour as never, FLOOR as never);
  assert.ok(Math.abs(widthAt(w, 13, undefined) - widthAt(FLOOR, 13)) < 0.05);
  assert.ok(Math.abs(widthAt(w, 18, "nonsense") - 6) < 0.01);
  assert.deepEqual(streetWidth([], FLOOR as never), FLOOR);
});
