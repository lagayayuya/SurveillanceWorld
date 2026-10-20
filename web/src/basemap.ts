// The theme's basemap (the map, and the review page's camera window): a Protomaps
// flavour (--basemap) with its own colours overridden by --basemap-<key> (and
// --basemap-landcover-<key>); --basemap-pois: none drops the points of interest;
// --basemap-hide names basemap layers the theme does not draw (space-separated ids);
// --map-label-halo-width writes every label of the basemap in the map's one label colour;
// --map-road-edge edges the roads and the paths and sets the street names (roadedge.ts).

import { layers, namedFlavor } from "@protomaps/basemaps";
import type { LayerSpecification } from "maplibre-gl";
import { edgeCasings, edged } from "./roadedge";
import { labelHalo, token } from "./theme";

export type Basemap = {
  flavor: ReturnType<typeof namedFlavor>;
  sprite: string;
  /** Ids of the flavour's layers left out (--basemap-hide). */
  hide: Set<string>;
  /** Every text label in one colour on one halo (theme.labelHalo), else the flavour's. */
  labels: ReturnType<typeof labelHalo>;
  /** The roads' and paths' edge (--map-road-edge), else the flavour's casings and names. */
  roadEdge: string | null;
};

/** The basemap of the theme in force, and the name of its sprites. */
export function basemap(): Basemap {
  const s = getComputedStyle(document.documentElement);
  const flavor = { ...namedFlavor(token(s, "basemap") || "grayscale") };
  const record = flavor as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === "string") {
      const o = token(s, `basemap-${key}`);
      if (o) record[key] = o;
    } else if (key === "landcover" && value && typeof value === "object") {
      const cover = { ...(value as Record<string, string>) };
      for (const k of Object.keys(cover)) {
        const o = token(s, `basemap-landcover-${k}`);
        if (o) cover[k] = o;
      }
      record[key] = cover;
    }
  }
  const roadEdge = token(s, "map-road-edge") || null;
  if (roadEdge) edgeCasings(record, roadEdge);
  if (token(s, "basemap-pois") === "none") delete record.pois;
  const hide = new Set(token(s, "basemap-hide").split(/\s+/).filter(Boolean));
  return {
    flavor,
    sprite: token(s, "basemap-sprite") || "grayscale",
    hide,
    labels: labelHalo(),
    roadEdge,
  };
}

/** The basemap's layers (source `protomaps`, French labels), without the hidden ones. The
 * theme hides the same layers in light and dark, so that a change of mode keeps the same
 * layers (main.ts restyle; web/tests/theme.test.ts). With the theme's labels (punk), every
 * text of the basemap, place, street and water names alike, takes the one label colour on
 * the map's halo, as wide and unblurred: the flavour gives the country names the earth's
 * colour as a halo, the water names the water's, and every halo 1 px (Protomaps 5.7). */
/** The punk earth's pattern: its colour with 20a's dot screen (icons.ts registers it, its
 * name icons.ts MARKS.paper). Drawn as the earth's own fill, the dots cost no pass of their
 * own over the whole map (a background layer of dots made the streets slower, 2026-10-09). */
export const PAPER_EARTH = "punk-paper";

export function basemapLayers(b: Basemap): LayerSpecification[] {
  let all = layers("protomaps", b.flavor, { lang: "fr" }).filter((l) => !b.hide.has(l.id));
  if (b.roadEdge) all = edged(all, b.roadEdge);
  const labels = b.labels;
  if (!labels) return all;
  return all.map((l) =>
    l.id === "earth" && l.type === "fill"
      ? ({ ...l, paint: { "fill-pattern": PAPER_EARTH } } as LayerSpecification)
      : l.type === "symbol" && l.layout?.["text-field"] !== undefined
        ? ({
            ...l,
            paint: {
              ...l.paint,
              "text-color": labels.colour,
              "text-halo-color": labels.halo,
              "text-halo-width": labels.width,
              "text-halo-blur": 0,
            },
          } as LayerSpecification)
        : l,
  );
}
