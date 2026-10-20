// The roads read on the earth (lot U2, the owner's « B », 2026-10-19; basemap.ts applies it
// where the theme sets --map-road-edge, punk in light and dark): the flavour's casings
// above ground take the edge's colour, the paths, which the flavour draws without one, get
// it as a casing just under their line, and the street names are larger, in Medium. The
// white roads stood 1.02 to 1.38:1 on what they cross; edged, 4.5:1 (light) and 4.0:1
// (dark) on the earth (web/tests/theme.test.ts).
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

/** The paths' edge in CSS px on each side: thinner than the roads' (the flavour's 1 px), as
 * the paths are (a footway's line is 1.6 px wide at z16). */
export const PATH_EDGE = 0.75;
/** The street names, larger from z14 (the flavour's 12 px at every zoom), in Medium (Noto
 * Sans Medium, self-hosted beside Regular: web/scripts/fetch-assets.sh). */
const ROAD_NAME_SIZE: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  14,
  12,
  15,
  13,
  17,
  15,
];
export const ROAD_NAME_FONT = "Noto Sans Medium";
/** The minor streets' names from z14 (the flavour's from z15). */
export const ROAD_NAME_MIN = 14;

/** The flavour's casing colours above ground set to `edge`, in place (Protomaps 5.7 keys:
 * `minor_casing`, `major_casing_late`, `bridges_other_casing`…); the tunnels' stay dim,
 * under the ground. */
export function edgeCasings(flavour: Record<string, unknown>, edge: string): void {
  for (const key of Object.keys(flavour))
    if (/_casing/.test(key) && !key.startsWith("tunnel_")) flavour[key] = edge;
}

/** The paths' casing (`roads_other_casing`) just under their line, lifted with them from
 * z16 as layers.ts drawnBasemap does with every road line, and the street names larger, in
 * Medium, the minor ones from z14. */
export function edged(all: LayerSpecification[], edge: string): LayerSpecification[] {
  return all.flatMap((l): LayerSpecification[] => {
    if (l.id === "roads_other" && l.type === "line") {
      const casing = {
        ...l,
        id: "roads_other_casing",
        paint: {
          "line-color": edge,
          "line-gap-width": l.paint?.["line-width"],
          "line-width": PATH_EDGE,
        },
      } as LayerSpecification;
      return [casing, l];
    }
    if (/^roads_labels_(minor|major)$/.test(l.id) && l.type === "symbol")
      return [
        {
          ...l,
          minzoom: Math.min(l.minzoom ?? 0, ROAD_NAME_MIN),
          layout: { ...l.layout, "text-size": ROAD_NAME_SIZE, "text-font": [ROAD_NAME_FONT] },
        } as LayerSpecification,
      ];
    return [l];
  });
}
