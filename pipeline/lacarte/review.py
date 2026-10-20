"""QA stage: summary (qa.json), visual review page (review.html) and the list of cameras
drawn inside buildings (cameras_in_buildings.csv), all in qa/out/<region>/.

The page overlays the viewshed, the prepared obstacles, the raw OSM buildings, the
buildings ignored as obstacles (dashed) and the camera origin, for: 20 random cameras,
the 20 worst by the spike detector, 20 random CNIL-signal cases, and the uncut circles
of each focus area (with an automatic verdict).
"""

from __future__ import annotations

import html
import json
import random
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely
from pyproj import Transformer

from lacarte import apply, buildings, exposure, qa, regions

SAMPLE = 20
SIZE_PX = 360
TO_FIX_DEPTH_M = 2.0  # deeper inside a building than this: "to fix in OSM" [TO ADJUST]
# Areas reviewed by hand: (name, lon, lat, radius in m).
FOCUS_AREAS = [("Gare de Lyon", 2.3736, 48.8443, 350)]
# Ten IDF cameras drawn with their three reach estimates, to compare calibrations. Drawn with
# seed 2026: 2 domes without direction, 1 with, 3 fixed with direction, 2 PTZ, 1 ALPR,
# 1 unknown type. Missing ids (other regions) are skipped.
REFERENCE_CAMERAS = [
    "n12597008491", "n13374467186", "n8309069494", "n1923568282", "n7506608002",
    "n12511054870", "n13453245204", "n8824455755", "n7506593070", "n9010357721",
]  # fmt: skip


def run(region: regions.Region) -> dict[str, Path]:
    out = regions.ROOT / "qa" / "out" / region.name
    out.mkdir(parents=True, exist_ok=True)
    b = region.build_dir
    views = gpd.read_parquet(b / "views.parquet")
    cams = gpd.read_parquet(b / apply.CAMERAS).set_index("camera_id")
    blds = gpd.read_parquet(b / "buildings.parquet")
    ignored = gpd.read_parquet(b / "ignored_buildings.parquet")
    street = pd.read_parquet(b / "camera_street.parquet").set_index("camera_id")
    communes = gpd.read_parquet(b / "communes.parquet")

    summary = summarize(views)
    bands = gpd.read_parquet(b / "bands.parquet")
    summary["violations"]["d_band_nesting"] = qa.band_nesting_violations(bands)
    edges = pd.read_parquet(b / "edges.parquet")
    summary["violations"]["e_street_estimates"] = qa.street_estimate_violations(
        edges, exposure.LEVELS, exposure.ESTIMATES
    )
    portions = gpd.read_parquet(b / "street_portions.parquet")
    summary["violations"]["f_portions_outside_fields"] = qa.portion_violations(portions, bands)
    summary["portions"] = int(len(portions))
    summary["bands"] = int(len(bands))
    (out / "qa.json").write_text(json.dumps(summary, indent=2))
    in_blds = cameras_in_buildings(cams, blds, communes)
    in_blds.to_csv(out / "cameras_in_buildings.csv", index=False)

    ctx = _Context(cams, blds, ignored)
    rnd = random.Random(42).sample(range(len(views)), min(SAMPLE, len(views)))
    worst = views.sort_values("qa_spike_m2", ascending=False).head(SAMPLE)
    cards = ["<h2>20 caméras tirées au hasard (graine 42)</h2>"]
    cards += [ctx.card(views.iloc[i]) for i in rnd]
    cards.append("<h2>20 pires selon le détecteur de pics</h2>")
    cards += [ctx.card(row) for _, row in worst.iterrows()]
    leaks = views[views.qa_leak_m2 > qa.SPIKE_MIN_AREA_M2].sort_values(
        "qa_leak_m2", ascending=False
    )
    if len(leaks):
        cards.append(
            f"<h2>Fuites entre bâtiments : {min(SAMPLE, len(leaks))} pires sur {len(leaks)}</h2>"
        )
        cards += [ctx.card(row) for _, row in leaks.head(SAMPLE).iterrows()]
    cards += _reference_cards(ctx, views, bands)
    cards += _cnil_cards(ctx, views, street)
    cards += _focus_cards(ctx, views, region.crs)
    page = _page(region.name, summary, "\n".join(cards))
    (out / "review.html").write_text(page)
    failures = blocking_failures(summary)
    if failures:
        raise QAError(f"viewshed QA failed: {failures} (see {out / 'review.html'})")
    return {"qa": out / "qa.json", "review": out / "review.html"}


def cameras_in_buildings(
    cams: gpd.GeoDataFrame, blds: gpd.GeoDataFrame, communes: gpd.GeoDataFrame
) -> pd.DataFrame:
    """Cameras (not tagged indoor) whose OSM position lies inside a building footprint."""
    outdoor = cams[cams.is_camera & ~cams.indoor]
    tree = shapely.STRtree(blds.geometry.values)
    p_idx, b_idx = tree.query(outdoor.geometry.values, predicate="within")
    rows = {}
    for p, bi in zip(p_idx, b_idx, strict=True):
        cid = outdoor.index[p]
        depth = blds.geometry.values[bi].boundary.distance(outdoor.geometry.values[p])
        rows[cid] = max(depth, rows.get(cid, 0.0))
    df = pd.DataFrame({"camera_id": list(rows), "depth_m": [round(d, 2) for d in rows.values()]})
    if df.empty:
        return df.assign(osm_url=[], edit_url=[], commune=[], insee=[], to_fix=[])
    pts = gpd.GeoDataFrame(df, geometry=outdoor.loc[df.camera_id].geometry.values, crs=cams.crs)
    joined = gpd.sjoin(pts, communes[["name", "insee", "geometry"]], how="left", predicate="within")
    joined = joined[~joined.index.duplicated()]
    kind = {"n": "node", "w": "way", "r": "relation"}
    # An added camera (`c…`, a contribution's id) has no OSM element yet: no link.
    osm = [(kind.get(c[0]), c[1:]) for c in df.camera_id]
    df["osm_url"] = [k and f"https://www.openstreetmap.org/{k}/{i}" for k, i in osm]
    df["edit_url"] = [k and f"https://www.openstreetmap.org/edit?{k}={i}" for k, i in osm]
    df["commune"] = joined["name"].values
    df["insee"] = joined["insee"].values
    df["to_fix"] = df.depth_m > TO_FIX_DEPTH_M
    return df.sort_values("depth_m", ascending=False).reset_index(drop=True)


def _cnil_cards(ctx, views, street) -> list[str]:
    ids = sorted(street.index[street.cnil_signal])
    pick = random.Random(7).sample(ids, min(SAMPLE, len(ids)))
    by_id = views.set_index("camera_id")
    out = [f"<h2>Signal CNIL : {len(pick)} cas tirés au hasard sur {len(ids)} (graine 7)</h2>"]
    for cid in pick:
        s = street.loc[cid]
        tags = html.escape(
            json.dumps(json.loads(ctx.cams.loc[cid].tags), ensure_ascii=False, indent=1)
        )
        why = "films_street" if s.films_street else "surveillance=public"
        extra = (
            f"voie publique : {100 * s.street_share:.0f} % du champ, {s.street_len_m:.0f} m · "
            f"motif : {why}<details><summary>tags</summary><pre>{tags}</pre></details>"
        )
        out.append(ctx.card(by_id.loc[cid], extra, cid=cid))
    return out


def _reference_cards(ctx, views, bands) -> list[str]:
    """Reference cameras: bands of the probable estimate filled by level, the certain
    estimate outlined thick and the cautious one dashed (display floor level), buildings."""
    ids = [c for c in REFERENCE_CAMERAS if c in set(views.camera_id)]
    if not ids:
        return []
    out = [f"<h2>{len(ids)} caméras de référence : les trois estimations de portée</h2>"]
    by_id = views.set_index("camera_id")
    mine = bands[bands.camera_id.isin(ids)]
    floor = "detection"
    for cid in ids:
        cam = ctx.cams.loc[cid]
        b = mine[mine.camera_id == cid]
        extent = shapely.union_all(b.geometry.values) if len(b) else by_id.loc[cid].geometry
        x, y = cam.geometry.x, cam.geometry.y
        minx, miny, maxx, maxy = extent.bounds if not extent.is_empty else (x, y, x, y)
        r = max(abs(minx - x), abs(maxx - x), abs(miny - y), abs(maxy - y), 20.0) + 5
        frame = shapely.box(x - r, y - r, x + r, y + r)
        scale = SIZE_PX / (2 * r)

        def path(geom, cls, frame=frame, x0=x - r, y0=y + r, scale=scale):
            if geom is None or geom.is_empty:
                return ""
            d = _svg_path(geom.intersection(frame), x0, y0, scale)
            return f'<path class="{cls}" d="{d}"/>'

        raw = ctx.blds.geometry.values[ctx.tree.query(frame, predicate="intersects")]
        parts = [path(g, "raw") for g in raw]
        for level in ("detection", "recognition", "identification"):
            sel = b[(b.level == level) & (b.band == 1)]
            parts += [path(g, f"lv-{level}") for g in sel.geometry]
        for band, cls in ((0, "est-certain"), (2, "est-cautious")):
            sel = b[(b.level == floor) & (b.band == band)]
            parts += [path(g.boundary.buffer(0.2 / scale), cls) for g in sel.geometry]
        parts.append(f'<circle cx="{SIZE_PX / 2}" cy="{SIZE_PX / 2}" r="3" class="cam"/>')
        link = f"https://www.openstreetmap.org/node/{cid[1:]}"
        info = (
            f"{html.escape(str(cam.kind))} · direction {cam.direction_certainty} · "
            f"cadre {2 * r:.0f} m"
        )
        out.append(
            f'<figure><svg viewBox="0 0 {SIZE_PX} {SIZE_PX}" width="{SIZE_PX}" '
            f'height="{SIZE_PX}">{"".join(parts)}</svg><figcaption><a href="{link}">{cid}</a>'
            f"<br>{info}</figcaption></figure>"
        )
    return out


def _focus_cards(ctx, views, crs) -> list[str]:
    to_m = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    out = []
    for name, lon, lat, radius in FOCUS_AREAS:
        centre = shapely.Point(*to_m.transform(lon, lat))
        pos = ctx.cams.loc[views.camera_id].geometry.values
        near = views[shapely.distance(pos, centre) <= radius]
        uncut = near[~near.clipped]
        if near.empty:
            continue
        out.append(
            f"<h2>{html.escape(name)} : {len(uncut)} cercles non coupés sur {len(near)}</h2>"
        )
        for _, row in uncut.iterrows():
            out.append(ctx.card(row, ctx.verdict(row)))
    return out


class _Context:
    """Geometry needed to draw a card."""

    def __init__(self, cams, blds, ignored):
        self.cams, self.blds, self.ignored = cams, blds, ignored
        self.tree = shapely.STRtree(blds.geometry.values)
        self.ign_tree = shapely.STRtree(ignored.geometry.values)

    def verdict(self, row) -> str:
        """Why a circle is not cut: ignored buildings in range, or nothing to cut it."""
        cam = self.cams.loc[row.camera_id]
        disk = cam.geometry.buffer(float(cam.range_m))
        hits = self.ignored.iloc[self.ign_tree.query(disk, predicate="intersects")]
        if len(hits):
            kinds = ", ".join(f"{k} ×{n}" for k, n in _kinds(hits).items())
            return f"<b>Élément ignoré à portée</b> : {html.escape(kinds)}"
        nearest = self.blds.geometry.values[self.tree.nearest(cam.geometry)]
        gap = nearest.distance(cam.geometry)
        text = (
            f"<b>Aucun bâtiment OSM à portée</b> ({cam.range_m:.0f} m) : le plus proche est à "
            f"{gap:.0f} m, rien ne peut couper le cercle"
        )
        if cam.mount_group == "ceiling":
            text += " · fixée au plafond : probablement sous un auvent absent d'OSM"
        return text

    def card(self, row, extra: str = "", cid: str | None = None) -> str:
        cid = cid or row.camera_id
        cam = self.cams.loc[cid]
        view = row.geometry
        r = float(cam.range_m) + 5
        x, y = cam.geometry.x, cam.geometry.y
        frame = shapely.box(x - r, y - r, x + r, y + r)
        raw = self.blds.geometry.values[self.tree.query(frame, predicate="intersects")]
        ign = self.ignored.geometry.values[self.ign_tree.query(frame, predicate="intersects")]
        prepared = buildings.prepare(raw)

        def path(geom, cls):
            if geom is None or geom.is_empty:
                return ""
            d = _svg_path(geom.intersection(frame), x - r, y + r, SIZE_PX / (2 * r))
            return f'<path class="{cls}" d="{d}"/>'

        svg = "".join(
            [
                *(path(g, "prep") for g in prepared),
                *(path(g, "raw") for g in raw),
                *(path(g, "ign") for g in ign),
                path(view, "view"),
                f'<circle cx="{SIZE_PX / 2}" cy="{SIZE_PX / 2}" r="3" class="cam"/>',
            ]
        )
        link = f"https://www.openstreetmap.org/{'node' if cid[0] == 'n' else 'way'}/{cid[1:]}"
        info = (
            f"{html.escape(str(cam.kind))} · {html.escape(str(cam.operator_class))} · "
            f"{cam.range_m:.0f} m · dir {[round(float(d)) for d in cam.directions] or 'aucune'} · "
            f"pic {row.qa_spike_m2:.2f} m² · fuite {row.qa_leak_m2:.2f} m² · "
            f"{'recalée' if row.snapped else ''}"
        )
        return (
            f'<figure><svg viewBox="0 0 {SIZE_PX} {SIZE_PX}" width="{SIZE_PX}" '
            f'height="{SIZE_PX}">{svg}</svg><figcaption><a href="{link}">{cid}</a><br>{info}'
            f"<br>{extra}</figcaption></figure>"
        )


def _kinds(hits: gpd.GeoDataFrame) -> dict[str, int]:
    labels = []
    for h in hits.itertuples(index=False):
        if h.location == "underground":
            labels.append("location=underground")
        elif h.layer is not None and str(h.layer).lstrip("-").isdigit() and int(h.layer) < 0:
            labels.append(f"layer={h.layer}")
        else:
            labels.append(f"building={h.building}")
    return pd.Series(labels).value_counts().to_dict()


def blocking_failures(summary: dict) -> dict:
    """Property violations (a, b, c), uncut views and leaks stop the build.

    Grazing wedges (spikes that are not leaks) are accepted.
    """
    failures = {k: v for k, v in summary["violations"].items() if not k.endswith("_checked") and v}
    for key in ("uncut_views", "leaky_views"):
        if summary.get(key):
            failures[key] = summary[key]
    return failures


class QAError(RuntimeError):
    """Raised when a viewshed property is violated: the build must stop."""


def summarize(views: gpd.GeoDataFrame) -> dict:
    n = len(views)
    spiky = int((views.qa_spike_m2 > qa.SPIKE_MIN_AREA_M2).sum())
    leaky = int((views.qa_leak_m2 > qa.SPIKE_MIN_AREA_M2).sum())
    checked = views.block_diff_m2.dropna()
    return {
        "cameras": n,
        "violations": {
            "a_outside_sector": int(views.qa_outside_sector.sum()),
            "b_building_overlap_over_0_5_m2": int(
                (views.qa_overlap_m2 >= qa.MAX_BUILDING_OVERLAP_M2).sum()
            ),
            "c_block_diff_over_0_01_m2": int((checked > 0.01).sum()),
            "c_block_checked": int(len(checked)),
        },
        "spiky_views": spiky,
        "spiky_share": round(spiky / n, 4) if n else 0.0,
        "leaky_views": leaky,
        "leaky_share": round(leaky / n, 4) if n else 0.0,
        "uncut_views": int(views.qa_uncut.sum()),
        "snapped": int(views.snapped.sum()),
        "inside_building_empty": int(views.inside_building.sum()),
        "clipped_share": round(float(views.clipped.mean()), 4) if n else 0.0,
        "geom_certainty": views.geom_certainty.value_counts().to_dict(),
    }


def _svg_path(geom, x0: float, y0: float, scale: float) -> str:
    parts = []
    for poly in getattr(geom, "geoms", [geom]):
        if poly.geom_type != "Polygon":
            continue
        for ring in [poly.exterior, *poly.interiors]:
            pts = [f"{(px - x0) * scale:.1f},{(y0 - py) * scale:.1f}" for px, py in ring.coords]
            parts.append("M" + "L".join(pts) + "Z")
    return " ".join(parts)


def _page(name: str, summary: dict, body: str) -> str:
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Revue des champs de vision — {html.escape(name)}</title>
<style>
body{{font:14px system-ui,sans-serif;margin:16px;background:#fafafa;color:#222}}
figure{{display:inline-block;margin:6px;background:#fff;border:1px solid #ddd;padding:6px;
vertical-align:top}}
figcaption{{max-width:{SIZE_PX}px;font-size:12px}}
.raw{{fill:none;stroke:#555;stroke-width:1}} .prep{{fill:#bbb;stroke:none}}
.view{{fill:rgba(220,40,120,.35);stroke:#c02070;stroke-width:1;fill-rule:evenodd}}
.ign{{fill:none;stroke:#1a6;stroke-width:1.2;stroke-dasharray:4 3}}
details pre{{max-width:{SIZE_PX}px;white-space:pre-wrap;font-size:11px}}
.cam{{fill:#000}} pre{{background:#fff;border:1px solid #ddd;padding:8px}}
.lv-detection{{fill:rgba(220,40,120,.15)}} .lv-recognition{{fill:rgba(220,40,120,.25)}}
.lv-identification{{fill:rgba(160,10,80,.45)}}
.est-certain{{fill:#8a0f4f}} .est-cautious{{fill:#d3689b;opacity:.8}}
</style></head><body>
<h1>Revue des champs de vision — {html.escape(name)}</h1>
<p>Gris plein : bâtiments prétraités (fusionnés, interstices fermés).
Trait gris : bâtiments OSM bruts. Tirets verts : bâtiments ignorés (toitures, souterrains).
Rose : champ de vision.
Point noir : position OSM de la caméra (avant recalage).
Caméras de référence : remplissage = estimation probable par niveau (détection, reconnaissance,
identification) ; trait épais foncé = minimum certain, trait clair = prudent (niveau détection).</p>
<pre>{html.escape(json.dumps(summary, indent=2, ensure_ascii=False))}</pre>
{body}
</body></html>"""
