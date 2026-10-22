// The kinds the basemap's archive goes without (pipeline rules/basemap.yaml undrawn_kinds,
// `lacarte basemap strip --undrawn`) are drawn by no layer of the style: every flavour,
// every zoom, each filter evaluated by MapLibre's own style code. A Protomaps upgrade that
// draws one of them fails here before a map shows a hole.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { layers, namedFlavor } from "@protomaps/basemaps";

function undrawn(): Record<string, string[]> {
  const text = readFileSync(new URL("../../rules/basemap.yaml", import.meta.url), "utf8");
  const out: Record<string, string[]> = {};
  let layer: string | null = null;
  for (const line of text.split("\n")) {
    const named = /^ {2}([a-z_]+):\s*$/.exec(line);
    const item = /^ {4}- ([a-z_]+)\s*$/.exec(line);
    if (named) out[(layer = named[1])] = [];
    else if (item && layer) out[layer].push(item[1]);
    else if (!line.startsWith("  ")) layer = null;
  }
  return out;
}

test("the rules name landuse kinds, farmland and meadows among them", () => {
  const kinds = undrawn();
  assert.deepEqual(Object.keys(kinds), ["landuse"]);
  for (const k of ["farmland", "meadow", "residential"]) assert.ok(kinds.landuse.includes(k));
});

test("no layer of any flavour draws an undrawn kind, at any zoom", () => {
  const kinds = undrawn();
  for (const flavour of ["light", "dark", "white", "grayscale", "black"]) {
    const style = layers("protomaps", namedFlavor(flavour), { lang: "fr" });
    for (const [source, list] of Object.entries(kinds)) {
      const drawing = style.filter((l) => "source-layer" in l && l["source-layer"] === source);
      assert.ok(drawing.length > 0, `${flavour}: no layer reads ${source}`);
      for (const l of drawing) {
        const f = featureFilter("filter" in l ? l.filter : undefined, `layers.${l.id}.filter`);
        for (const kind of list)
          for (let zoom = 0; zoom <= 22; zoom++) {
            const feature = { type: 3 as const, properties: { kind }, geometry: [] };
            assert.equal(
              f.filter({ zoom }, feature as never),
              false,
              `${flavour} ${l.id} draws ${source} ${kind} at z${zoom}`,
            );
          }
      }
    }
  }
});

test("the drawn landuse kinds stay drawn (the check can fail)", () => {
  const style = layers("protomaps", namedFlavor("light"), { lang: "fr" });
  const park = style.find((l) => l.id === "landuse_park");
  assert.ok(park && "filter" in park);
  const f = featureFilter(park.filter, "layers.landuse_park.filter");
  const forest = { type: 3 as const, properties: { kind: "forest" }, geometry: [] };
  assert.equal(f.filter({ zoom: 7 }, forest as never), true);
});
