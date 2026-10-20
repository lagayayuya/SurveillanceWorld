"""Region definitions (regions.yaml) and where their files live."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
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

    @property
    def build_dir(self) -> Path:
        return BUILD_ROOT / self.name

    @property
    def contrib_file(self) -> Path:
        """The region's exported contributions, read by the `apply` stage (may not exist)."""
        return CONTRIB_ROOT / f"{self.name}.jsonl"

    @property
    def hidden_file(self) -> Path:
        """The cameras the build leaves out, one id per line (`lacarte contrib export`, from
        the participation database's hidden_cameras; may not exist), beside the
        contributions."""
        return self.contrib_file.with_name(f"{self.name}-hidden.txt")

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
