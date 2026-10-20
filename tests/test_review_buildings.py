"""The build's QA list of cameras drawn inside buildings (lacarte.review.cameras_in_buildings):
an added camera (a contribution's `c…` id, no OSM element yet) inside a footprint is listed
without OpenStreetMap links, and never stops the build."""

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point, box

from lacarte import review

CRS = "EPSG:2154"


def test_an_added_camera_inside_a_building_is_listed_without_osm_links():
    cams = gpd.GeoDataFrame(
        {"is_camera": [True, True], "indoor": [False, False]},
        index=["n1925222793", "c5eed0a030000"],
        geometry=[Point(650005, 6860005), Point(650008, 6860008)],
        crs=CRS,
    )
    blds = gpd.GeoDataFrame(geometry=[box(650000, 6860000, 650010, 6860010)], crs=CRS)
    communes = gpd.GeoDataFrame(
        {"name": ["Courbevoie"], "insee": ["92026"]},
        geometry=[box(649000, 6859000, 651000, 6861000)],
        crs=CRS,
    )
    out = review.cameras_in_buildings(cams, blds, communes).set_index("camera_id")
    assert out.loc["n1925222793", "osm_url"] == "https://www.openstreetmap.org/node/1925222793"
    assert (
        out.loc["n1925222793", "edit_url"] == "https://www.openstreetmap.org/edit?node=1925222793"
    )
    assert pd.isna(out.loc["c5eed0a030000", "osm_url"])
    assert pd.isna(out.loc["c5eed0a030000", "edit_url"])
    assert set(out["commune"]) == {"Courbevoie"}
