import dataclasses
import os
import tempfile
from pathlib import Path

import pytest
from hypothesis import settings

from lacarte import regions

settings.register_profile("default", max_examples=300, deadline=None)
settings.register_profile("stress", max_examples=5000, deadline=None)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "default"))

# The machine's lock (lacarte/lock.py) in a place of the tests' own, for the whole run and
# the processes it starts: a test that runs `lacarte build` must neither take the real one
# nor fail while a real build, gate or deploy holds it.
os.environ["LACARTE_LOCK"] = str(Path(tempfile.mkdtemp(prefix="lacarte-test-lock-")) / "build.lock")
os.environ.pop("LACARTE_LOCK_TOKEN", None)
# The API's OSM synchronisation thread (lacarte.api.sync) stays off in every test that
# starts the app: a test runs its passes itself (sync_once), against tests/fakeosm.py only.
os.environ["OSM_SYNC_THREAD"] = "off"
# Nor the retention's (lacarte.api.retention): a test runs lacarte_retention() itself.
os.environ["RETENTION_THREAD"] = "off"
# The register's preview images, drawn once for the whole run: every test that builds the
# extract shows the same ones (apercu.py, kept by fingerprint).
os.environ["LACARTE_REGISTRE_APERCUS"] = tempfile.mkdtemp(prefix="lacarte-test-apercus-")


@dataclasses.dataclass(frozen=True)
class PinnedRegion(regions.Region):
    """A region whose build and contribution folders are its own, not the module's
    BUILD_ROOT and CONTRIB_ROOT: session fixtures live side by side."""

    root: Path | None = None
    contrib_root: Path | None = None

    @property
    def build_dir(self) -> Path:
        return self.root / self.name

    @property
    def contrib_file(self) -> Path:
        return self.contrib_root / f"{self.contrib_name}.jsonl"


def pinned(name: str, root: Path, contrib_root: Path) -> PinnedRegion:
    fields = {
        f.name: getattr(regions.load(name), f.name) for f in dataclasses.fields(regions.Region)
    }
    return PinnedRegion(**fields, root=root, contrib_root=contrib_root)


@pytest.fixture(scope="session")
def ci_build(tmp_path_factory):
    """The La Défense fixture through extract, normalize and apply (no contribution), in a
    temporary build root: the tests that need cameras and buildings do not depend on
    `make build REGION=ci`."""
    from lacarte import apply, extract, normalize

    region = pinned("ci", tmp_path_factory.mktemp("build"), tmp_path_factory.mktemp("none"))
    extract.run(region)
    normalize.run(region)
    apply.run(region)
    return region


@pytest.fixture(scope="session")
def pg_dsn():
    """A PostGIS database (tests/pgcluster.py): skipped when none is available, except with
    REQUIRE_PG=1 (CI), where its absence fails."""
    import pgcluster

    try:
        with pgcluster.database() as dsn:
            yield dsn
    except LookupError as e:
        if os.environ.get("REQUIRE_PG") == "1":
            raise
        pytest.skip(str(e))


@pytest.fixture(scope="session")
def pg_loaded(ci_build, pg_dsn, tmp_path_factory):
    """The database migrated and loaded with the La Défense build: (export info, folder)."""
    from lacarte import db

    db.migrate(pg_dsn)
    out = tmp_path_factory.mktemp("export")
    info = db.export(ci_build, out, workers=2)
    db.load(out, pg_dsn)
    return info, out


def run_pipeline(tmp_path_factory, name: str, contributions: bytes | None,
                 hidden: list[str] | None = None):  # fmt: skip
    """The whole pipeline on the La Défense fixture in its own build root, with the given
    contribution file (None: no file) and hidden cameras' list (None: no file)."""
    from lacarte import cli

    contrib = tmp_path_factory.mktemp(f"{name}-contrib")
    if contributions is not None:
        (contrib / "ci.jsonl").write_bytes(contributions)
    if hidden is not None:
        (contrib / "ci-hidden.txt").write_text("".join(f"{i}\n" for i in hidden))
    region = pinned("ci", tmp_path_factory.mktemp(name), contrib)
    for stage in cli.STAGES.values():
        stage(region)
    return region


@pytest.fixture(scope="session")
def ci_pipeline(tmp_path_factory):
    """The whole pipeline on the La Défense fixture, tiles included, no contribution
    (about 10 s): the streets checks decode its tiles and read its parquet files."""
    return run_pipeline(tmp_path_factory, "pipeline", None)


@pytest.fixture(scope="session")
def ci_contrib_pipeline(tmp_path_factory):
    """The same with the synthetic contributions of tests/fixtures/contrib-ci.jsonl."""
    data = (regions.ROOT / "tests" / "fixtures" / "contrib-ci.jsonl").read_bytes()
    return run_pipeline(tmp_path_factory, "contrib", data)
