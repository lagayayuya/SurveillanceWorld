"""Identity of a build: which OSM data and which inputs the served map was computed from.

The id is written into tiles/meta.json by the tiles stage and into the participation
database by `lacarte db load`; a contribution keeps the id of the build its phone showed,
and the deploy check fails when the two differ.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path

import pyarrow.parquet as pq

from lacarte import regions

# Inputs of the cameras snapshot and of the live field: a change in any of them changes the id.
# The validated contributions and their rules enter it too, when there is one (contributions),
# the hidden cameras' list when it lists one (hidden), and so does the pipeline's own code
# (code_files): the same data through other code is another build. The participation API
# (pipeline/lacarte/api) is left out: no build file and no loaded table depends on it
# (nothing outside it imports it), so deploying the API alone needs no build.
INPUTS = ("cameras_norm.parquet", "buildings.parquet")
# questions.yaml: the tiles class every tilt by its bounds (phase D3), contributions or not;
# admin.yaml: the communes' rescue distance and the punk map's classes (meta.json);
# streets.yaml: which ways are drawn and counted (the streets tiles, the areas' shares).
RULES = (
    "optics.yaml",
    "defaults.yaml",
    "mounts.yaml",
    "direction.yaml",
    "questions.yaml",
    "admin.yaml",
    "streets.yaml",
)
CODE = regions.ROOT / "pipeline" / "lacarte"
SERVING = ("api",)  # code that serves the build, not code that makes it


def latest_edit(build_dir: Path) -> datetime:
    """Latest OSM edit among the region's cameras: the date of the extract."""
    stamps = pq.read_table(build_dir / "cameras_norm.parquet", columns=["osm_timestamp"])
    return max(datetime.fromisoformat(t) for t in stamps.column(0).to_pylist() if t)


def contributions(region: regions.Region) -> Path | None:
    """The region's contribution file when it holds at least one contribution: only then
    does it enter the id (without one, the id is the one before the `apply` stage)."""
    path = region.contrib_file
    if path.exists() and path.read_bytes().strip():
        return path
    return None


def hidden(region: regions.Region) -> Path | None:
    """The region's hidden cameras' file when it lists one: it enters the id (an added
    camera left out changes the build without changing any other input)."""
    path = region.hidden_file
    if path.exists() and path.read_bytes().strip():
        return path
    return None


def code_files() -> list[tuple[str, Path]]:
    """The pipeline's Python sources as (label, path), sorted: every `*.py` under
    pipeline/lacarte but tests, __pycache__ and the API (SERVING). The label is the path
    from the repository root, the same on every machine."""
    found = []
    for path in CODE.rglob("*.py"):
        rel = path.relative_to(CODE)
        if {"__pycache__", "tests"} & set(rel.parts) or rel.parts[0] in SERVING:
            continue
        found.append(((Path("pipeline") / "lacarte" / rel).as_posix(), path))
    return sorted(found)


def digest(build_dir: Path, extra: Path | None = None, hidden_file: Path | None = None) -> str:
    h = hashlib.sha256()
    paths = [build_dir / f for f in INPUTS] + [regions.ROOT / "rules" / f for f in RULES]
    if extra is not None:
        paths += [extra, regions.ROOT / "rules" / "contributions.yaml"]
    if hidden_file is not None:
        paths.append(hidden_file)
    for label, path in [(p.name, p) for p in paths] + code_files():
        h.update(label.encode())
        with path.open("rb") as stream:
            h.update(hashlib.file_digest(stream, "sha256").digest())
    return h.hexdigest()


def build_id(region: regions.Region) -> str:
    """`<region>-<latest edit, UTC>-<8 hex of the inputs>`, e.g. idf-20260928T201502Z-1a2b3c4d.
    A region built in parts (merge.py): the latest edit among its parts, and the digest of
    its parts' names and digests (each with the code, the rules, the contributions and the
    hidden cameras' list)."""
    if region.parts:
        parts = regions.parts(region)
        when = max(latest_edit(p.build_dir) for p in parts).strftime("%Y%m%dT%H%M%SZ")
        h = hashlib.sha256()
        for p in parts:
            h.update(p.name.encode())
            h.update(digest(p.build_dir, contributions(p), hidden(p)).encode())
        return f"{region.name}-{when}-{h.hexdigest()[:8]}"
    when = latest_edit(region.build_dir).strftime("%Y%m%dT%H%M%SZ")
    inputs = digest(region.build_dir, contributions(region), hidden(region))
    return f"{region.name}-{when}-{inputs[:8]}"
