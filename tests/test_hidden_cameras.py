"""Hidden cameras (migration 018, regions.hidden): the build leaves them out from its first
stage, so that the camera, its field, its streets and the counts lose it in every output —
tiles, meta.json, areas, cameras.json, exposure, the database's load files — and nothing
said about it is applied. On the La Défense fixture with its synthetic contributions: one
OSM camera and one added camera, both with applied contributions, both counted in a
commune."""

import gzip
import json

import geopandas as gpd
import pandas as pd
import pytest
from conftest import run_pipeline
from pmtiles.reader import MmapSource, all_tiles

from lacarte import apply, buildinfo, db, regions

OSM = "n12035135119"  # four answers applied
ADDED = "cadd000020000"  # an applied add, three answers on it
HIDDEN = (OSM, ADDED)
FIXTURE = regions.ROOT / "tests" / "fixtures" / "contrib-ci.jsonl"


@pytest.fixture(scope="session")
def hidden_pipeline(tmp_path_factory, ci_contrib_pipeline):
    """The same pipeline as ci_contrib_pipeline, the two cameras hidden."""
    return run_pipeline(tmp_path_factory, "hidden", FIXTURE.read_bytes(), list(HIDDEN))


def fixture_cameras() -> dict[str, str]:
    """uuid -> camera of the fixture's contributions."""
    rows = [json.loads(x) for x in FIXTURE.read_text().splitlines() if x.strip()]
    return {r["uuid"]: r["camera_id"] for r in rows}


def tile_strings(path) -> bytes:
    """Every tile of a PMTiles file, decompressed and joined: an MVT string value is the
    protobuf field 1 (0x0a), its length, its bytes."""
    out = []
    with path.open("rb") as fh:
        for _, data in all_tiles(MmapSource(fh)):
            out.append(gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data)
    return b"".join(out)


def as_mvt_string(value: str) -> bytes:
    raw = value.encode()
    return bytes([0x0A, len(raw)]) + raw


def test_both_were_on_the_map_before(ci_contrib_pipeline):
    """The test means something: without the list, both are cameras with a field, streets,
    applied contributions, in the tiles."""
    b = ci_contrib_pipeline.build_dir
    cams = gpd.read_parquet(b / apply.CAMERAS)
    assert set(HIDDEN) <= set(cams.camera_id)
    assert set(HIDDEN) <= set(pd.read_parquet(b / "views.parquet").camera_id)
    assert set(HIDDEN) <= set(pd.read_parquet(b / "camera_street.parquet").camera_id)
    detail = tile_strings(b / "tiles" / "detail.pmtiles")
    assert all(as_mvt_string(i) in detail for i in HIDDEN)
    outcome = json.loads((b / apply.OUTCOME).read_text())["contributions"]
    on = fixture_cameras()
    assert {on[c["uuid"]] for c in outcome if c["result"] == "applied"} >= set(HIDDEN)


def test_a_hidden_camera_is_in_no_build_file(hidden_pipeline, ci_contrib_pipeline):
    b = hidden_pipeline.build_dir
    before = gpd.read_parquet(ci_contrib_pipeline.build_dir / apply.CAMERAS)
    for name in ("cameras.parquet", "cameras_norm.parquet", apply.CAMERAS, "views.parquet",
                 "bands.parquet", "camera_street.parquet"):  # fmt: skip
        ids = set(pd.read_parquet(b / name, columns=["camera_id"]).camera_id)
        assert not ids & set(HIDDEN), name
    assert len(gpd.read_parquet(b / apply.CAMERAS)) == len(before) - 2
    portions = pd.read_parquet(b / "street_portions.parquet")
    assert not {c for cs in portions.cameras for c in cs} & set(HIDDEN)


def test_a_hidden_camera_is_in_no_tile_nor_served_file(hidden_pipeline, ci_contrib_pipeline):
    b = hidden_pipeline.build_dir
    for path in sorted((b / "tiles").glob("*.pmtiles")):
        strings = tile_strings(path)
        for i in HIDDEN:
            assert as_mvt_string(i) not in strings, (path.name, i)
    for path in sorted((b / "tiles").glob("*.json")) + sorted((b / "tiles_src").glob("*")):
        text = path.read_text()
        for i in HIDDEN:
            assert f'"{i}"' not in text, (path.name, i)
    table = json.loads((b / "tiles" / "cameras.json").read_text())
    before = json.loads((ci_contrib_pipeline.build_dir / "tiles" / "cameras.json").read_text())
    assert len(table["o"]) == len(before["o"]) - 2


def test_the_counts_lose_it(hidden_pipeline, ci_contrib_pipeline):
    def counts(region):
        areas = pd.read_parquet(region.build_dir / "areas.parquet")
        return areas.groupby("level").camera_count.sum().to_dict()

    before, after = counts(ci_contrib_pipeline), counts(hidden_pipeline)
    assert before.keys() == after.keys() and before
    for level in before:
        assert after[level] == before[level] - 2, level


def test_nothing_said_about_it_is_applied_nor_reported(hidden_pipeline):
    """Left as they are in the database: neither applied nor in conflict."""
    outcome = json.loads((hidden_pipeline.build_dir / apply.OUTCOME).read_text())
    on = fixture_cameras()
    assert outcome["contributions"]
    assert not [c for c in outcome["contributions"] if on[c["uuid"]] in HIDDEN]


def test_the_database_load_files_lose_it(hidden_pipeline, tmp_path):
    info = db.export(hidden_pipeline, tmp_path, workers=2)
    with gzip.open(tmp_path / "cameras.tsv.gz", "rt") as f:
        ids = {line.split("\t", 1)[0] for line in f}
    assert not ids & set(HIDDEN) and len(ids) == info["cameras"]


def test_the_list_enters_the_build_id(hidden_pipeline, ci_contrib_pipeline):
    def bid(region):
        return json.loads((region.build_dir / "tiles" / "meta.json").read_text())["build_id"]

    assert bid(hidden_pipeline) != bid(ci_contrib_pipeline)
    assert buildinfo.hidden(hidden_pipeline) == hidden_pipeline.hidden_file
    assert buildinfo.hidden(ci_contrib_pipeline) is None


def test_an_added_camera_alone_changes_the_build_id(ci_contrib_pipeline, tmp_path):
    """Hiding an added camera changes no extract file: the list itself changes the id."""
    b = ci_contrib_pipeline.build_dir
    contrib = buildinfo.contributions(ci_contrib_pipeline)
    listed = tmp_path / "ci-hidden.txt"
    listed.write_text(f"{ADDED}\n")
    assert buildinfo.digest(b, contrib, listed) != buildinfo.digest(b, contrib)


# --- the list's file -----------------------------------------------------------------------


@pytest.fixture
def region(tmp_path):
    from conftest import pinned

    return pinned("ci", tmp_path / "build", tmp_path)


def test_no_file_no_hidden_camera(region):
    assert regions.hidden(region) == frozenset()


def test_ids_one_per_line_blank_lines_ignored(region):
    region.hidden_file.write_text(f"{OSM}\n\n  {ADDED}  \nw42\nr7\n")
    assert regions.hidden(region) == {OSM, ADDED, "w42", "r7"}


@pytest.mark.parametrize("line", ["n0", "x12", "n12 # note", "c123", "cADD000020000", "12"])
def test_anything_else_stops_the_build_by_line_number_never_its_content(region, line):
    region.hidden_file.write_text(f"{OSM}\n{line}\n")
    with pytest.raises(ValueError, match="on line\\(s\\) 2$") as e:
        regions.hidden(region)
    assert line not in str(e.value)


def test_a_build_from_a_later_stage_needs_the_list_its_extract_applied(hidden_pipeline,
                                                                         monkeypatch):  # fmt: skip
    """The extract records the list it left out; a build started after it (--from, --only)
    refuses a list changed since, which no later stage would apply to the OSM cameras."""
    from lacarte import cli, extract

    applied = hidden_pipeline.build_dir / extract.HIDDEN_APPLIED
    assert applied.read_text().split() == sorted(HIDDEN)
    ran = []
    monkeypatch.setattr(regions, "load", lambda name: hidden_pipeline)
    monkeypatch.setattr(cli, "STAGES", {k: lambda r, k=k: ran.append(k) for k in cli.STAGES})
    cli.main(["build", "--region", "ci", "--from", "normalize"])  # the same list: it runs
    assert ran and "extract" not in ran
    listed = hidden_pipeline.hidden_file.read_text()
    try:
        hidden_pipeline.hidden_file.write_text(listed + "n1\n")
        ran.clear()
        with pytest.raises(SystemExit):
            cli.main(["build", "--region", "ci", "--from", "views"])
        assert ran == []
        cli.main(["build", "--region", "ci"])  # from the extract: fine
        assert ran[0] == "extract"
    finally:
        hidden_pipeline.hidden_file.write_text(listed)
