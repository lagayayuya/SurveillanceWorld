"""Region definitions (regions.yaml) and where their files live."""

from __future__ import annotations

import dataclasses
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
# Where builds go; the tests point it at a temporary folder.
BUILD_ROOT = ROOT / "data" / "build"
# Validated contributions exported from the participation database (`lacarte contrib
# export`), one file per region; never versioned. The tests point it at a temporary folder.
CONTRIB_ROOT = ROOT / "data" / "contrib"
# A camera's id: an OSM element's (n123, w456, r789) or an added camera's (c and 12 hex).
CAMERA_ID = re.compile(r"[nwr][1-9][0-9]{0,18}|c[0-9a-f]{12}")


@dataclass(frozen=True)
class Region:
    name: str
    crs: str
    pbf: Path | None = None
    url: str | None = None
    parent: str | None = None
    communes: list[str] = field(default_factory=list)
    buffer_m: float = 0.0
    # IGN ADMIN EXPRESS COG CARTO: {source: folder of the layers, departements: [codes]}
    admin: dict = field(default_factory=dict)
    # A region built in parts (France): their names, each a region whose `aggregate` is this
    # one; built one at a time, then merged (merge.py). `covers`: the regions it replaces,
    # whose database it may follow (contrib check-fresh).
    parts: list[str] = field(default_factory=list)
    covers: list[str] = field(default_factory=list)
    # A part's aggregate: the part reads its contributions, hidden cameras and data date,
    # and is cut from its .pbf along its own units (admin) widened by buffer_m.
    aggregate: str | None = None

    @property
    def build_dir(self) -> Path:
        return BUILD_ROOT / self.name

    @property
    def contrib_name(self) -> str:
        """The name of the contributions' and hidden cameras' files: a part reads its
        aggregate's (the database exports one file for the region it serves)."""
        return self.aggregate or self.name

    @property
    def contrib_file(self) -> Path:
        """The region's exported contributions, read by the `apply` stage (may not exist)."""
        return CONTRIB_ROOT / f"{self.contrib_name}.jsonl"

    @property
    def hidden_file(self) -> Path:
        """The cameras the build leaves out, one id per line (`lacarte contrib export`, from
        the participation database's hidden_cameras; may not exist), beside the
        contributions."""
        return self.contrib_file.with_name(f"{self.contrib_name}-hidden.txt")

    @property
    def data_date_file(self) -> Path:
        """A part's data date (merge.py writes it: the latest edit of the whole aggregate),
        so that every part dates freshness from the same day as one build would."""
        return self.build_dir / "data_date.txt"

    def data_date(self) -> date | None:
        """The date written by merge.py for a part, None otherwise (the cameras' own)."""
        path = self.data_date_file
        return date.fromisoformat(path.read_text().strip()) if path.exists() else None

    @property
    def source_pbf(self) -> Path:
        """The region's own .osm.pbf (downloaded, fixture, or cut from its parent)."""
        return self.pbf if self.pbf else self.build_dir / f"{self.name}.osm.pbf"


def hidden(region: Region) -> frozenset[str]:
    """The region's hidden cameras (Region.hidden_file): none without the file; a line that
    is not a camera id stops the build (said by line number, never by its content)."""
    path = region.hidden_file
    if not path.exists():
        return frozenset()
    lines = [(n, v.strip()) for n, v in enumerate(path.read_text().splitlines(), 1) if v.strip()]
    bad = [n for n, v in lines if not CAMERA_ID.fullmatch(v)]
    if bad:
        raise ValueError(f"{path.name}: not a camera id on line(s) {', '.join(map(str, bad))}")
    return frozenset(v for _, v in lines)


def load(name: str, path: Path = ROOT / "regions.yaml") -> Region:
    conf = yaml.safe_load(path.read_text())
    if name not in conf:
        raise KeyError(f"unknown region {name!r}, known: {', '.join(conf)}")
    c = dict(conf[name])
    if "pbf" in c:
        c["pbf"] = ROOT / c["pbf"]
    return Region(name=name, **c)


def parts(region: Region, path: Path = ROOT / "regions.yaml") -> list[Region]:
    """An aggregate's parts, as `region` itself is built: a test's region pinned to its own
    folders gives parts pinned to the same ones (dataclasses.replace keeps them)."""
    out = []
    for name in region.parts:
        part = load(name, path)
        if part.aggregate != region.name:
            raise ValueError(f"part {name} names aggregate {part.aggregate}, not {region.name}")
        fields = {f.name: getattr(part, f.name) for f in dataclasses.fields(Region)}
        out.append(dataclasses.replace(region, **fields))
    return out
