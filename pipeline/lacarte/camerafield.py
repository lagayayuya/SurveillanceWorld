"""One camera's field at one position: the per-camera work of the views stage.

Shared by the batch (views.py, every camera of a region) and the participation API (the
live field of a camera being moved), so that both draw the same thing at the same position.
Light on purpose: shapely and numpy only, no geopandas, so the API process stays small.
"""

from __future__ import annotations

import math

import numpy as np
import shapely
import shapely.affinity

from lacarte import buildings, optics, participation, qa, robust
from lacarte.viewshed import ObstacleIndex, Sector, compute_camera_viewshed

BAND_SIMPLIFY_M = 0.05
SELECT_MARGIN_M = 5.0  # extra distance when selecting buildings around a camera disk
# Selection disks are drawn around the given position; a snapped origin may move by up to
# MAX_SNAP_M + SNAP_OFFSET_M, so the disk must cover that too.
SELECT_RADIUS_EXTRA_M = SELECT_MARGIN_M + buildings.MAX_SNAP_M + buildings.SNAP_OFFSET_M


def mount(tilt_deg: float | None, height_m: float, height_certainty: str):
    """Height and tilt, only when both are at least estimated (else no blind zone)."""
    if tilt_deg is None or (isinstance(tilt_deg, float) and math.isnan(tilt_deg)):
        return None
    if height_certainty == "default":
        return None
    return (float(height_m), float(tilt_deg))


def select_radius(kind: str, range_m: float) -> float:
    """Radius of the disk around a camera's given position whose buildings can change its
    field: its range (PTZ: also the zoomed-reach outline), the snap's reach and a margin."""
    rng = max(range_m, optics.tele_reach_m()) if kind == "ptz" else range_m
    return rng + SELECT_RADIUS_EXTRA_M


def under_roof_m() -> float:
    """How far a building a participant placed a camera in is no obstacle to it."""
    return float(participation.contributions()["under_roof"]["under_roof_m"])


def field(r: dict, index: ObstacleIndex, with_qa: bool = True) -> dict:
    """Snap the origin, cut the view, the DORI bands and the PTZ outline of camera `r`.

    `r` is a camera record (views._records: camera_id, x, y, directions, fov_deg, range_m,
    geom_certainty, kind, mount, placed). `with_qa` adds the per-camera QA metrics of the
    batch.

    A position a participant placed (`placed`: an add or a move) inside a building's
    footprint is under a roof (an awning, a porch, a garage entrance): the camera stays
    there and that building is no obstacle within under_roof_m around it (a porch's depth,
    rules/contributions.yaml under_roof), an obstacle again beyond. Any other position
    inside or against a building is a mapping one: snap_origin moves it out (DECISIONS
    2026-09-27).
    """
    rng = r["range_m"]
    host = index.host(r["x"], r["y"]) if r.get("placed") else None
    if host is None:
        near = index.near(r["x"], r["y"], rng + buildings.MAX_SNAP_M + buildings.SNAP_OFFSET_M)
        x, y, snapped = buildings.snap_origin(r["x"], r["y"], near)
    else:
        x, y, snapped = r["x"], r["y"], False
        index = index.carved(host, shapely.Point(x, y).buffer(under_roof_m(), quad_segs=32))
    inside = index.contains(x, y)
    sectors = sectors_for(x, y, r["directions"], r["fov_deg"], rng)
    view = compute_camera_viewshed(sectors, index)
    bands = observation_bands(r, x, y, view)
    reach = ptz_reach(r, x, y, index) if r["kind"] == "ptz" and not view.is_empty else None
    out = {
        "camera_id": r["camera_id"],
        "geom_certainty": r["geom_certainty"],
        "x": x,
        "y": y,
        "snapped": snapped,
        "snap_m": float(math.hypot(x - r["x"], y - r["y"])),
        "inside_building": inside,
        "under_roof": host is not None,
        "area_m2": float(view.area),
        "view": view,
        "bands": bands,
        "reach": reach,
    }
    if with_qa:
        near_obs, near_shrunk = index.near_with_shrunk(x, y, rng, qa.OVERLAP_SHRINK_M)
        spike, leak = qa.spike_and_leak(view, list(near_obs))
        overlap = qa.building_overlap_m2(view, near_obs, near_shrunk)
        nominal = sum(s.nominal_polygon().area for s in sectors)
        out.update({
            "clipped": bool(view.area < 0.999 * nominal),
            "n_obstacles": len(near_obs),
            "qa_outside_sector": qa.outside_sector(view, sectors),
            "qa_overlap_m2": overlap,
            "qa_spike_m2": spike,
            "qa_leak_m2": leak,
            "qa_uncut": qa.is_uncut(view, sectors, near_obs, view_overlap=overlap),
        })  # fmt: skip
    return out


def observation_bands(r: dict, x: float, y: float, view) -> list[dict]:
    """Coverage bands of every DORI level, cut by the visible area.

    One row per (level, reach estimate); `band` is the estimate's index (0 = most certain).
    PTZ cameras pan, so their wide-angle bands are full circles; they also get a `reach`
    outline: the visible area within the zoomed-in observation range. A multi-dome's bands
    are full circles too, whatever its directions: its domes face every way
    (rules/optics.yaml assemblies; its sector is the full circle by its fov_deg, 360).
    """
    if view.is_empty:
        return []
    # The exact view carries ~3 vertices per building corner (rays at -eps, 0, +eps).
    # Simplified once at 5 cm, far below OSM precision, it divides band vertices by ~20;
    # every band is cut by the same geometry, so bands stay exactly nested.
    view = shapely.simplify(view, BAND_SIMPLIFY_M, preserve_topology=True)
    # Cut in camera-centred coordinates: at ~6.8e6 m GEOS silently returned wrong overlays
    # for nearly coincident arcs. Results are stored on the 1 mm grid.
    local_view = shapely.affinity.translate(view, -x, -y)
    rules = optics.rules()
    samples = optics.samples(r["kind"])
    cam_mount = optics.Mount(*r["mount"]) if r["mount"] else None
    pans = r["kind"] == "ptz"
    around = pans or optics.full_circle(r["kind"])
    directions = [None] if around or not r["directions"] else r["directions"]
    rows = []
    for level, ppm in rules["levels"].items():
        for t_idx, t in enumerate(optics.thresholds()):
            parts = [optics.coverage(d, samples, ppm, t, cam_mount) for d in directions]
            band = robust.union_all(parts) if len(parts) > 1 else parts[0]
            # Welded again after the cut (optics.closed), in the camera's frame.
            band = optics.closed(robust.intersection(band, local_view))
            # Farthest point of the drawn band from the camera: the reach written on its
            # outline in focus mode (buildings and the range cap included).
            reach_m = float(np.hypot(*shapely.get_coordinates(band).T).max(initial=0.0))
            band = robust.polygonal(robust.on_grid(shapely.affinity.translate(band, x, y)))
            if not band.is_empty and band.area > 0.01:
                rows.append({
                    "level": level, "band": t_idx, "reach_m": reach_m,
                    "wkb": shapely.to_wkb(band),
                })  # fmt: skip
    return rows


def ptz_reach(r: dict, x: float, y: float, index: ObstacleIndex):
    """Outline of what a PTZ camera can observe once aimed and zoomed in (optics.py:
    tele_reach_m), cut by buildings."""
    visible = compute_camera_viewshed([Sector(x, y, optics.tele_reach_m())], index)
    return None if visible.is_empty else visible.exterior


def sectors_for(
    x: float, y: float, directions: list[float], fov: float, rng: float
) -> list[Sector]:
    if not directions or fov >= 360:
        return [Sector(x, y, rng)]
    return [Sector(x, y, rng, d, fov) for d in directions]
