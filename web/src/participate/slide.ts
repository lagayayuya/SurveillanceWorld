// What move mode and the direction question share: the map slides under a fixed point
// (pan and pinch stay the map's own, without inertia, no rotation), and every other
// camera's field and street highlight is hidden (the classique) or dimmed (punk), since it
// would read as the one at hand.
import type { AllPaintProperties, ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { Map as MlMap, PaddingOptions } from "maplibre-gl";
import { fieldPaint, focusedPortionColour, NO_CAMERA, opacities, stickerImage } from "../layers";

type PaintName = keyof AllPaintProperties;
type Saved = [string, PaintName, AllPaintProperties[PaintName]][];

/** The proposals: a pending ghost, its move or its field. */
const PROPOSALS = ["proposals", "proposal-moves", "proposal-field"];

/** Set `prop` of every layer of `sources` to 0 (`symbols`: their icons and texts too);
 * returns what was there. */
function zero(map: MlMap, sources: string[], symbols: boolean): Saved {
  const props: Record<string, PaintName[]> = {
    fill: ["fill-opacity"],
    line: ["line-opacity"],
    circle: ["circle-opacity", "circle-stroke-opacity"],
    ...(symbols ? { symbol: ["icon-opacity", "text-opacity"] as PaintName[] } : {}),
  };
  const hidden: Saved = [];
  for (const layer of map.getStyle().layers) {
    const source = "source" in layer ? String(layer.source) : "";
    if (!sources.includes(source)) continue;
    for (const prop of props[layer.type] ?? []) {
      hidden.push([layer.id, prop, map.getPaintProperty(layer.id, prop)]);
      map.setPaintProperty(layer.id, prop, 0);
    }
  }
  return hidden;
}

const put = (map: MlMap, saved: Saved) => {
  for (const [id, prop, v] of saved) if (map.getLayer(id)) map.setPaintProperty(id, prop, v);
};

/** Hide the fields and street highlights (with `everything`, the pictograms and proposals
 * too); returns what puts them back. Hidden by
 * opacity, not visibility: MapLibre leaves hidden layers out of the tiles it parses, and
 * tiles loaded meanwhile came back without fields (smoke test, WebKit). */
export function hideFields(map: MlMap, everything = false): () => void {
  // `everything` ("Compléter"): every camera's pictogram, the focus marks and the
  // proposals too; only the basemap stays, with the camera the questions are about.
  const sources = everything
    ? ["detail", "streets", "focus-points", ...PROPOSALS]
    : ["detail", "streets"];
  const hidden = zero(map, sources, everything);
  return () => put(map, hidden);
}

/** Punk, while adding or modifying (DECISIONS 2026-10-09, « « Je ne sais pas » comes
 * first… »): the cameras, their fields and the filmed streets around stay, dimmed as the
 * map dims them around a camera in focus (filters.ts apply), no camera in focus — the one
 * at hand is the editor's own pin and field; the proposals hidden (a pending ghost or field
 * would read as the one at hand). Kept on every idle: the filters may set the map's own
 * paint meanwhile (setting an equal value is a no-op, MapLibre's Style.setPaintProperty).
 * Returns what puts the map back. */
export function dimAround(map: MlMap): () => void {
  const dims = (
    [
      ...opacities(NO_CAMERA, null, true).filter(([id]) => id === "streets"),
      ...fieldPaint(NO_CAMERA),
      ["portions", "line-color", focusedPortionColour(null, false)],
    ] as Saved
  ).filter(([id]) => map.getLayer(id));
  const saved: Saved = dims.map(([id, prop]) => [id, prop, map.getPaintProperty(id, prop)]);
  const cameras = map.getLayer("cameras") !== undefined;
  const image = cameras ? map.getLayoutProperty("cameras", "icon-image") : undefined;
  const dimImage: ExpressionSpecification = stickerImage(NO_CAMERA);
  const apply = () => {
    put(map, dims);
    if (cameras && map.getLayer("cameras"))
      map.setLayoutProperty("cameras", "icon-image", dimImage);
  };
  apply();
  const hidden = zero(map, PROPOSALS, true);
  map.on("idle", apply);
  return () => {
    map.off("idle", apply);
    put(map, saved);
    if (cameras && map.getLayer("cameras")) map.setLayoutProperty("cameras", "icon-image", image);
    put(map, hidden);
  };
}

/** What follows a panel's size: `padding()` set on the map, then `after()` — never under a
 * finger. MapLibre's setPadding is a jumpTo, and jumpTo stops every gesture handler before
 * anything else (Camera.jumpTo → stop → HandlerManager.stop: each handler reset), so a
 * panel growing mid-drag (a status line appearing) dropped the rest of the drag: the map
 * stopped following the finger. While a finger is down or the map moves, it looks again
 * on the next frame; an unchanged padding is not set again. Returns the scheduler (one
 * pending application at a time), for the panel's ResizeObserver. */
export function paddingFollower(
  map: MlMap,
  padding: () => PaddingOptions | null,
  after: () => void = () => {},
): () => void {
  let pending = false;
  const apply = () => {
    if (map.dragPan.isActive() || map.touchZoomRotate.isActive() || map.isMoving()) {
      requestAnimationFrame(apply);
      return;
    }
    pending = false;
    const p = padding();
    if (!p) return;
    const now = map.getPadding();
    if (
      p.top !== now.top ||
      p.bottom !== now.bottom ||
      p.left !== now.left ||
      p.right !== now.right
    )
      map.setPadding(p);
    after();
  };
  return () => {
    if (pending) return;
    pending = true;
    // A frame later: the padding moves the map, whose "move" can rewrite a status line and
    // change the panel's height within the observer's own notification (WebKit:
    // "ResizeObserver loop completed with undelivered notifications").
    requestAnimationFrame(apply);
  };
}

/** The map slides under a fixed point: no inertia, no rotation. Returns the undo. */
export function slideMode(map: MlMap): () => void {
  map.dragPan.enable({ maxSpeed: 0, deceleration: 1e6 });
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  return () => {
    map.dragPan.enable();
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
  };
}
