"""A camera's live field at a position: the batch's own computation (camerafield) on the
prepared buildings read from PostGIS around that position.

At the camera's served position the result is the batch's field, band for band on the
1 mm grid (tests/test_api_live.py). A moved camera gets what the batch will draw once the
new position is merged: the magnet only decides where the camera is, then the pipeline's
snap and viewshed run unchanged.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

import numpy as np
import shapely
import shapely.geometry
from pyproj import Transformer
from shapely import Point, Polygon

from lacarte import buildings, camerafield, optics, participation
from lacarte.viewshed import ObstacleIndex

SRID = 2154
TO_M = Transformer.from_crs("EPSG:4326", f"EPSG:{SRID}", always_xy=True)
TO_LL = Transformer.from_crs(f"EPSG:{SRID}", "EPSG:4326", always_xy=True)
# A requested point this close to the served position is the served position: longitude
# and latitude round trips move it by nanometres, which could flip a band vertex on the
# 1 mm grid.
SAME_POINT_M = 1e-3

CAMERA_COLUMNS = (
    "camera_id, osm_type, osm_id, osm_version, osm_timestamp::text, ST_X(geom), ST_Y(geom),"
    " indoor, kind, mount_group, directions, fov_deg, range_m, height_m, height_certainty,"
    " tilt_deg, geom_certainty, position_source"
)


@dataclass(frozen=True)
class Camera:
    camera_id: str
    osm_type: str | None  # None: an added camera (phase "Ajouter"), no OSM element
    osm_id: int | None
    osm_version: int | None
    osm_timestamp: str | None
    x: float
    y: float
    indoor: bool
    kind: str
    mount_group: str
    directions: list[float]
    fov_deg: float
    range_m: float
    height_m: float
    height_certainty: str
    tilt_deg: float | None
    geom_certainty: str
    position_source: str | None = None  # 'contribution': moved or added (migration 013)

    def record(self, x: float, y: float) -> dict:
        """The camera as views._records gives it to camerafield, placed at (x, y): a
        participant's placement when it is an add, (x, y) is not the served position, or
        the served position is a contribution's."""
        return {
            "camera_id": self.camera_id,
            "x": x,
            "y": y,
            "directions": list(self.directions),
            "fov_deg": self.fov_deg,
            "range_m": self.range_m,
            "geom_certainty": self.geom_certainty,
            "kind": self.kind,
            "mount": camerafield.mount(self.tilt_deg, self.height_m, self.height_certainty),
            "placed": self.osm_type is None
            or self.position_source == "contribution"
            or (x, y) != (self.x, self.y),
        }


def camera(conn, camera_id: str) -> Camera | None:
    row = conn.execute(
        f"SELECT {CAMERA_COLUMNS} FROM cameras WHERE camera_id = %s", (camera_id,)
    ).fetchone()
    return Camera(*row) if row else None


def add_template(conn) -> dict | None:
    """The default camera an add creates (meta.add_camera, written by `lacarte db load`)."""
    row = conn.execute("SELECT add_camera FROM meta").fetchone()
    return row[0] if row else None


def added(template: dict, camera_id: str, x: float, y: float) -> Camera:
    """An added camera not yet in a build: the default camera at (x, y), no OSM element."""
    return Camera(camera_id=camera_id, osm_type=None, osm_id=None, osm_version=None,
                  osm_timestamp=None, x=x, y=y, **template)  # fmt: skip


def aimed(cam: Camera, direction: int, kind: str | None = None) -> Camera:
    """The camera turned towards `direction` (degrees from north), with the optics of
    `kind` when a shape answer gives one: as the build would normalise it (the kind's
    opening bounds the sector: its samples' widest field, a multi-dome's full circle; its
    farthest reach the range)."""
    changes: dict = {"directions": [float(direction)]}
    if kind is not None and kind != cam.kind:
        changes.update(kind=kind, fov_deg=optics.opening_deg(kind), range_m=optics.max_reach(kind))
    return replace(cam, **changes)


def answered(
    cam: Camera,
    kind: str | None = None,
    direction: int | None = None,
    height_m: float | None = None,
    tilt_deg: float | None = None,
) -> Camera:
    """The camera as "Compléter" answers would make it (phase D3: height and tilt, with the
    shape and direction given on the same journey): an answered height is estimated, so
    with a tilt it gives the blind zone the build would draw."""
    if direction is not None:
        cam = aimed(cam, direction, kind)
    elif kind is not None and kind != cam.kind:
        cam = replace(cam, kind=kind, fov_deg=optics.opening_deg(kind),
                      range_m=optics.max_reach(kind))  # fmt: skip
    changes: dict = {}
    if height_m is not None:
        changes.update(height_m=float(height_m), height_certainty="estimated")
    if tilt_deg is not None:
        changes["tilt_deg"] = float(tilt_deg)
    return replace(cam, **changes)


def buildings_near(conn, x: float, y: float, radius: float) -> list[Polygon]:
    rows = conn.execute(
        "SELECT ST_AsBinary(geom) FROM buildings"
        " WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(%s, %s), 2154), %s)",
        (x, y, radius),
    ).fetchall()
    return list(shapely.from_wkb([r[0] for r in rows])) if rows else []


def to_metres(lon: float, lat: float) -> tuple[float, float]:
    return TO_M.transform(lon, lat)


def to_lonlat(x: float, y: float) -> tuple[float, float]:
    lon, lat = TO_LL.transform(x, y)
    return round(lon, 7), round(lat, 7)  # ~1 cm


@dataclass
class Placed:
    x: float
    y: float
    pulled: bool  # moved by the magnet
    facade: shapely.LineString | None  # the facade the magnet used
    move_m: float  # from the served position
    facade_m: float | None  # to the nearest building outline; None: no building near
    inside_footprint: bool  # in a building's footprint: an awning or an arcade


def place(cam: Camera, x: float, y: float, magnet: bool, polys: list[Polygon]) -> Placed:
    """Where the camera goes: the requested point, pulled by the magnet if it is on."""
    if math.hypot(x - cam.x, y - cam.y) < SAME_POINT_M:
        x, y = cam.x, cam.y
    pulled, facade = False, None
    if magnet:
        capture = participation.rules()["magnet"]["capture_m"]
        x, y, pulled, facade = buildings.magnet(x, y, polys, capture)
    pt = Point(x, y)
    near = min((p.boundary.distance(pt) for p in polys), default=None)
    inside = any(p.contains(pt) for p in polys)
    return Placed(x, y, pulled, facade, math.hypot(x - cam.x, y - cam.y), near, inside)


def fetch_radius(cam: Camera) -> float:
    """Buildings needed around a requested point: the batch's selection disk, plus what the
    magnet may move the point by."""
    extra = participation.rules()["magnet"]["capture_m"] + buildings.SNAP_OFFSET_M
    return camerafield.select_radius(cam.kind, cam.range_m) + extra


def field(cam: Camera, x: float, y: float, polys: list[Polygon]) -> dict | None:
    """camerafield.field at (x, y); None for an indoor camera (the batch draws none)."""
    if cam.indoor:
        return None
    return camerafield.field(cam.record(x, y), ObstacleIndex(polys), with_qa=False)


def shown_bands(f: dict | None) -> list[dict]:
    """The bands the map draws (displayed levels, shown estimates) as GeoJSON features in
    longitude / latitude, with the tiles' attributes: lv 1-3, b estimate, r reach."""
    if f is None:
        return []
    levels = {name: i for i, name in enumerate(optics.DISPLAYED_LEVELS, start=1)}
    shown = optics.shown_estimates()
    out = []
    for b in f["bands"]:
        if b["level"] not in levels or b["band"] not in shown:
            continue
        geom = shapely.transform(shapely.from_wkb(b["wkb"]), _xy_to_lonlat)
        out.append({
            "type": "Feature",
            "geometry": shapely.geometry.mapping(geom),
            "properties": {"lv": levels[b["level"]], "b": b["band"],
                           "r": optics.label_m(b["reach_m"])},
        })  # fmt: skip
    return out


def _xy_to_lonlat(xy):
    lon, lat = TO_LL.transform(xy[:, 0], xy[:, 1])
    return np.round(np.column_stack([lon, lat]), 7)


def local_frame(cam: Camera) -> dict:
    """An affine map between longitude / latitude and metres (EPSG:2154) relative to the
    camera, for the phone's magnet: the Jacobian of the projection at the camera, by
    central differences. Over the 60 m the phone uses it, the linearisation error stays
    under a millimetre (tests/test_api_live.py)."""
    lon0, lat0 = TO_LL.transform(cam.x, cam.y)
    h = 1e-4
    xe, ye = TO_M.transform(lon0 + h, lat0)
    xw, yw = TO_M.transform(lon0 - h, lat0)
    xn, yn = TO_M.transform(lon0, lat0 + h)
    xs, ys = TO_M.transform(lon0, lat0 - h)
    j = np.array([[(xe - xw) / (2 * h), (xn - xs) / (2 * h)],
                  [(ye - yw) / (2 * h), (yn - ys) / (2 * h)]])  # fmt: skip
    inv = np.linalg.inv(j)
    return {"lon0": lon0, "lat0": lat0, "to_m": j.tolist(), "to_ll": inv.tolist()}


def local_polygons(cam: Camera, polys: list[Polygon]) -> list[list[list[list[float]]]]:
    """Polygons as rings (exterior first, then holes) of [x, y] in metres relative to the
    camera, in shapely's vertex order (the phone's facade choice follows that order)."""

    def ring(r):
        return [[round(x - cam.x, 4), round(y - cam.y, 4)] for x, y in r.coords]

    return [[ring(p.exterior), *(ring(h) for h in p.interiors)] for p in polys]
