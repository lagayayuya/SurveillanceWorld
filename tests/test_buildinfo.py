import re

import pyarrow as pa
import pyarrow.parquet as pq

from lacarte import buildinfo, regions


def _build(tmp_path, stamps, extra=b""):
    d = tmp_path / "build" / "r"
    d.mkdir(parents=True)
    pq.write_table(pa.table({"osm_timestamp": stamps}), d / "cameras_norm.parquet")
    (d / "buildings.parquet").write_bytes(b"buildings" + extra)
    return regions.Region(name="r", crs="EPSG:2154"), d


def test_build_id_names_region_latest_edit_and_inputs(tmp_path, monkeypatch):
    region, d = _build(tmp_path, ["2026-09-01T10:00:00+00:00", None, "2026-09-28T20:15:02+00:00"])
    monkeypatch.setattr(regions.Region, "build_dir", property(lambda self: d))
    bid = buildinfo.build_id(region)
    assert re.fullmatch(r"r-20260928T201502Z-[0-9a-f]{8}", bid)
    assert buildinfo.build_id(region) == bid  # deterministic


def test_build_id_changes_with_any_input(tmp_path, monkeypatch):
    a_region, a = _build(tmp_path / "a", ["2026-09-28T20:15:02+00:00"])
    b_region, b = _build(tmp_path / "b", ["2026-09-28T20:15:02+00:00"], extra=b"!")
    assert buildinfo.digest(a) != buildinfo.digest(b)


def _code(root):
    """A small copy of a pipeline tree: sources, a test, a doc and a bytecode cache."""
    (root / "api").mkdir(parents=True)
    (root / "tests").mkdir()
    (root / "__pycache__").mkdir()
    (root / "__init__.py").write_text("")
    (root / "api" / "__init__.py").write_text("")
    (root / "stage.py").write_text("STEP = 1\n")
    (root / "tests" / "test_stage.py").write_text("def test(): pass\n")
    (root / "notes.md").write_text("notes\n")
    (root / "__pycache__" / "stage.cpython-313.pyc").write_bytes(b"\0")
    (root / "__pycache__" / "cached.py").write_text("")


def test_build_id_changes_with_the_pipeline_code_only(tmp_path, monkeypatch):
    _, d = _build(tmp_path, ["2026-09-28T20:15:02+00:00"])
    code = tmp_path / "pipeline" / "lacarte"
    _code(code)
    monkeypatch.setattr(buildinfo, "CODE", code)
    assert [label for label, _ in buildinfo.code_files()] == [
        "pipeline/lacarte/__init__.py", "pipeline/lacarte/stage.py"]  # fmt: skip
    before = buildinfo.digest(d)
    (code / "tests" / "test_stage.py").write_text("def test(): assert True\n")
    (code / "notes.md").write_text("other notes\n")
    (code / "__pycache__" / "stage.cpython-313.pyc").write_bytes(b"\1")
    (code / "__pycache__" / "cached.py").write_text("X = 1\n")
    (code / "api" / "__init__.py").write_text("SERVED = 1\n")  # the API serves the build
    assert buildinfo.digest(d) == before
    (code / "stage.py").write_text("STEP = 2\n")
    assert buildinfo.digest(d) != before


def test_the_real_pipeline_sources_enter_the_id():
    labels = [label for label, _ in buildinfo.code_files()]
    assert "pipeline/lacarte/buildinfo.py" in labels
    # What makes the build and the loaded tables is in, the API that serves them is not.
    assert {"pipeline/lacarte/db.py", "pipeline/lacarte/tiles.py",
            "pipeline/lacarte/apply.py"} <= set(labels)  # fmt: skip
    assert not any(label.startswith("pipeline/lacarte/api/") for label in labels)
    assert labels.count("pipeline/lacarte/__init__.py") == 1
    assert all(label.endswith(".py") and "__pycache__" not in label for label in labels)
