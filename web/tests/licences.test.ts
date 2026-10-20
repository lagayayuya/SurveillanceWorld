// The third-party licence notices (scripts/licences.mjs, served at /licences.txt): from the
// files the bundle ships, every package and the packages bundled inside a prebuilt one
// (maplibre-gl's dist, by its source maps), each with its licence's full text, the vendored
// ones where npm has none; the fonts and the basemap's glyphs and icons after them.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { notices, packageOf, shippedPackages } from "../scripts/licences.mjs";

const FR = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
) as Record<string, string>;
const require = createRequire(import.meta.url);
const dir = (name: string) => dirname(require.resolve(`${name}/package.json`));
// What the bundle takes of each package (the entries Vite resolves, maplibre's worker).
const SHIPPED = [
  join(dir("maplibre-gl"), "dist/maplibre-gl.mjs"),
  join(dir("maplibre-gl"), "dist/maplibre-gl-shared.mjs"),
  join(dir("maplibre-gl"), "dist/maplibre-gl-worker.mjs"),
  join(dir("pmtiles"), "dist/esm/index.js"),
  join(dir("fflate"), "esm/browser.js"),
  join(dir("@protomaps/basemaps"), "dist/esm/index.js"),
  "/abs/web/src/main.ts",
];

test("a file's package: the last node_modules in its path, scoped or not; our own files none", () => {
  assert.deepEqual(packageOf("/a/node_modules/x/node_modules/@s/p/dist/i.js"), {
    name: "@s/p",
    dir: "/a/node_modules/x/node_modules/@s/p",
  });
  assert.equal(packageOf("/a/web/src/main.ts"), null);
});

test("the packages shipped: the bundle's, and those maplibre-gl's dist was built from", () => {
  const p = shippedPackages(SHIPPED);
  for (const name of ["maplibre-gl", "pmtiles", "fflate", "@protomaps/basemaps"])
    assert.equal(p.get(name)?.via, null, name);
  for (const name of ["earcut", "pbf", "kdbush", "@mapbox/vector-tile", "murmurhash-js"])
    assert.equal(p.get(name)?.via, "maplibre-gl", name);
});

test("the notices: every package's licence in full, Protomaps' and MapLibre's BSD-3 among them", () => {
  const text = notices(shippedPackages(SHIPPED), FR);
  for (const words of [
    // maplibre-gl's own LICENSE.txt, its four notices.
    "Copyright (c) 2023, MapLibre contributors",
    "Copyright (c) 2020, Mapbox",
    "Copyright (C) 2011 by Evan Wallace",
    "Copyright 2010-2016 Mike Bostock",
    // Protomaps' two packages, vendored (npm ships no licence file for them).
    "Copyright 2021 Protomaps LLC",
    "Copyright 2019-2023 Protomaps LLC, Kelso Cartography",
    "Neither the name of the copyright holder nor the names of its contributors",
    // murmurhash-js: its README's licence, vendored.
    "Copyright (c) 2011 Gary Court",
    // The fonts, the basemap's glyphs and icons.
    "Copyright 2020 The Archivo Project Authors",
    "Apache License",
    "Copyright 2022 The Noto Project Authors",
    "Copyright (c) 2015-2018 Mapzen",
  ])
    assert.ok(text.includes(words), words);
  assert.ok(text.startsWith(`\uFEFF${FR["legal.licences.head"]}`));
  assert.match(text, /^pmtiles \d+\.\d+\.\d+ — BSD-3-Clause$/m);
  assert.match(text, /^earcut \d+\.\d+\.\d+ — ISC \(contenu dans maplibre-gl\)$/m);
});

test("a shipped package with no licence text stops the build", () => {
  const root = mkdtempSync(join(tmpdir(), "licences-"));
  const pkg = join(root, "node_modules", "bare");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), '{"name":"bare","version":"1.0.0","license":"MIT"}');
  writeFileSync(join(pkg, "index.js"), "");
  try {
    assert.throws(
      () => notices(shippedPackages([join(pkg, "index.js")]), FR),
      /no licence text for bare/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
