// The Position ticket's words (src/participate/place.ts): the nearest named street within
// 50 m and the commune holding the camera, from the loaded tiles' features.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { communeAt, nearestStreet } from "../src/participate/place.ts";

const AT: [number, number] = [2.24, 48.9];
const M = 1 / 111_320; // a metre of latitude
const K = Math.cos((48.9 * Math.PI) / 180);
const east = (m: number) => AT[0] + (m * M) / K;
const north = (m: number) => AT[1] + m * M;
const road = (name: Record<string, string>, coordinates: [number, number][]) => ({
  geometry: { type: "LineString" as const, coordinates },
  properties: { kind: "minor_road", ...name },
});
const tram = (coordinates: [number, number][]) => ({
  geometry: { type: "LineString" as const, coordinates },
  properties: { kind: "rail", kind_detail: "tram", name: "Tram T2" },
});

test("the street: the nearest named road within 50 m, in French when it has a name in French", () => {
  const roads = [
    road({ name: "Rue Loin" }, [[east(-100), north(30)], [east(100), north(30)]]),
    road({ name: "Allee Baltard", "name:fr": "Allée Baltard" }, [
      [east(-100), north(-12)],
      [east(100), north(-12)],
    ]),
    road({}, [[east(-100), north(2)], [east(100), north(2)]]), // unnamed, nearer
  ];
  assert.equal(nearestStreet(roads, AT), "Allée Baltard");
  // A segment's end counts, not only its line.
  assert.equal(nearestStreet([road({ name: "Impasse" }, [[east(20), north(0)], [east(80), north(0)]])], AT), "Impasse");
  // A tramway or a railway is no street, however near.
  assert.equal(nearestStreet([tram([[east(-100), north(1)], [east(100), north(1)]]), ...roads], AT), "Allée Baltard");
  // None within 50 m: no name (the ticket says « Position posée »).
  assert.equal(nearestStreet([road({ name: "Rue Loin" }, [[east(-100), north(60)], [east(100), north(60)]])], AT), undefined);
}); // biome-ignore format: compact

test("the commune: the polygon holding the camera, not one whose hole holds it", () => {
  const square = (r: number): [number, number][] => [
    [east(-r), north(-r)],
    [east(r), north(-r)],
    [east(r), north(r)],
    [east(-r), north(r)],
    [east(-r), north(-r)],
  ];
  const ring = {
    geometry: { type: "Polygon" as const, coordinates: [square(500), square(100)] },
    properties: { nm: "Autour" },
  };
  const inner = {
    geometry: { type: "MultiPolygon" as const, coordinates: [[square(100)]] },
    properties: { nm: "Courbevoie" },
  };
  assert.equal(communeAt([ring, inner], AT), "Courbevoie");
  assert.equal(communeAt([ring], AT), undefined);
});
