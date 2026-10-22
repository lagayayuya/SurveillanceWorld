"""Participation database: migrations and `lacarte db load` on the La Défense fixture."""

import subprocess

import geopandas as gpd
import pytest
import shapely

from lacarte import buildinfo, db, participation


def sql(dsn: str, query: str) -> list[list[str]]:
    out = subprocess.run(
        ["psql", "-X", "-At", "-F", "\t", dsn, "-c", query],
        check=True, capture_output=True, text=True,
    ).stdout  # fmt: skip
    return [line.split("\t") for line in out.splitlines()]


def acct(name: str) -> str:
    """SQL for the id of the account `name` (ensure() makes it)."""
    return f"(SELECT id FROM accounts WHERE pseudonym = '{name}')"


def ensure_sql(name: str) -> str:
    """SQL making a fictitious account (migration 014) that cannot sign in, as the owner."""
    return ("INSERT INTO accounts (pseudonym, password_hash, created_month)"
            f" VALUES ('{name}', 'x', '2026-10-01') ON CONFLICT DO NOTHING; ")  # fmt: skip


def ensure(dsn: str, *names: str) -> None:
    for n in names:
        sql(dsn, ensure_sql(n))


def test_migrations_apply_once(pg_dsn):
    db.migrate(pg_dsn)
    assert db.migrate(pg_dsn) == []
    versions = [r[0] for r in sql(pg_dsn, "SELECT version FROM schema_migrations ORDER BY 1")]
    assert versions == [
        "001_init", "002_api_grants", "003_api_update_status_only", "004_validation",
        "005_apply", "006_complete", "007_add", "008_withdraw", "009_test_authors",
        "010_commune", "011_height_tilt", "012_batch", "013_position_source",
        "014_accounts", "015_osm", "016_osm_publish", "017_height_operator",
        "018_hidden_cameras", "019_review_labels", "020_admin", "021_site_counters",
        "022_osm_sync", "023_retention", "024_history_pseudonym"]  # fmt: skip


def test_004_moves_confirmed_rows_back_to_pending_and_names_its_checks(pg_dsn, pg_loaded):
    """The first migration on live rows: applied on a database left at 003 with data."""
    sql(pg_dsn, "DROP DATABASE IF EXISTS at_003")
    sql(pg_dsn, "CREATE DATABASE at_003")
    other = other_database(pg_dsn, "at_003")
    sql(other, "CREATE TABLE schema_migrations (version text PRIMARY KEY)")
    for f in sorted(db.MIGRATIONS.glob("00[123]_*.sql")):
        subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", other, "-1", "-f", str(f)],
                       check=True, capture_output=True)  # fmt: skip
        sql(other, f"INSERT INTO schema_migrations VALUES ('{f.stem}')")
    row = ("'{}'::uuid, '{}', 'n1', 'n', 1, 1, 'b', 'ana', '2026-09-29', 0, '{}',"
           " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{{}}', 'x'")  # fmt: skip
    cols = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author, day,"
            " duration_ms, status, geom, payload, body_sha256")  # fmt: skip
    for uid, kind, status, answer in (
        ("00000000-0000-4000-8000-000000000001", "verify", "confirmed", "present"),
        ("00000000-0000-4000-8000-000000000002", "move", "rejected", None),
    ):
        extra = ", answer" if answer else ""
        value = f", '{answer}'" if answer else ""
        sql(other, f"INSERT INTO contributions ({cols}{extra}) VALUES"
                   f" ({row.format(uid, kind, status)}{value})")  # fmt: skip
    assert db.migrate(other) == [
        "004_validation", "005_apply", "006_complete", "007_add", "008_withdraw",
        "009_test_authors", "010_commune", "011_height_tilt", "012_batch",
        "013_position_source", "014_accounts", "015_osm", "016_osm_publish",
        "017_height_operator", "018_hidden_cameras", "019_review_labels", "020_admin",
        "021_site_counters", "022_osm_sync", "023_retention",
        "024_history_pseudonym"]  # fmt: skip
    assert sql(other, "SELECT status FROM contributions ORDER BY uuid") == [
        ["pending"],
        ["rejected"],
    ]
    checks = sql(
        other,
        "SELECT conname FROM pg_constraint"
        " WHERE conrelid = 'contributions'::regclass AND contype = 'c'",
    )
    names = {r[0] for r in checks}
    # 007 replaced 004's contributions_target_for_opinion (an add's target), 014 its
    # contributions_decision (the decider's account may be deleted, the day stays).
    assert {"contributions_status", "contributions_kind", "contributions_answer",
            "contributions_target", "contributions_decided_by", "contributions_osm_element",
            "contributions_add"} <= names  # fmt: skip
    with pytest.raises(subprocess.CalledProcessError):
        sql(other, "UPDATE contributions SET status = 'confirmed'")


def other_database(dsn: str, name: str) -> str:
    """The same server, another database (libpq keyword string or URL)."""
    if dsn.startswith("postgresql://"):
        return dsn.rsplit("/", 1)[0] + "/" + name
    return " ".join(p for p in dsn.split() if not p.startswith("dbname=")) + f" dbname={name}"


def test_the_api_role_reads_everything_and_writes_contributions_only(pg_dsn, pg_loaded):
    """As bootstrap.sh sets it up: default privileges for SELECT, then the migrations."""
    _, out = pg_loaded
    sql(pg_dsn, "DROP DATABASE IF EXISTS grants_test")
    sql(pg_dsn, "CREATE DATABASE grants_test")
    other = other_database(pg_dsn, "grants_test")
    sql(other, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api')"
               " THEN CREATE ROLE preview_api; END IF; END $$")  # fmt: skip
    sql(other, "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO preview_api")
    db.migrate(other)
    db.load(out, other)  # swapped tables keep the default privileges

    def can(table, privilege):
        return sql(other, f"SELECT has_table_privilege('preview_api', '{table}', '{privilege}')")

    for table in ("meta", "buildings", "cameras", "contributions"):
        assert can(table, "SELECT") == [["t"]], table
    assert can("contributions", "INSERT") == [["t"]]
    assert can("contributions", "DELETE") == [["f"]] and can("cameras", "INSERT") == [["f"]]
    # Once written, only the decision changes (status, who, which day, and since 017 the
    # operator name a reviewer accepts).
    assert can("contributions", "UPDATE") == [["f"]]  # not on the whole table
    columns = sql(other, "SELECT column_name FROM information_schema.column_privileges"
                         " WHERE grantee = 'preview_api' AND table_name = 'contributions'"
                         " AND privilege_type = 'UPDATE'")  # fmt: skip
    assert sorted(columns) == [["decided_by_id"], ["decided_on"], ["operator_choice"],
                               ["operator_name"], ["status"]]  # fmt: skip
    as_api = "SET ROLE preview_api; UPDATE contributions SET {} WHERE false"
    sql(other, as_api.format("status = 'validated', decided_by_id = NULL"))  # allowed
    with pytest.raises(subprocess.CalledProcessError):
        sql(other, as_api.format("payload = '{}'"))  # permission denied
    # 018: the hidden cameras, read (the proposals leave them out); since 020 an
    # administrator hides and shows them; when one left the map is the deploy's.
    for privilege, allowed in (("SELECT", "t"), ("INSERT", "t"), ("DELETE", "t"),
                               ("UPDATE", "f"), ("TRUNCATE", "f")):  # fmt: skip
        assert can("hidden_cameras", privilege) == [[allowed]], privilege
    # 020: the journal is written and read, never changed nor emptied; the settings changed
    # (their value and day), never added nor removed; a role and the disabled flag change;
    # 024: the person's choice to show her pseudonym in the cameras' history.
    for table, privilege, allowed in (
        ("admin_log", "SELECT", "t"), ("admin_log", "INSERT", "t"), ("admin_log", "UPDATE", "f"),
        ("admin_log", "DELETE", "f"), ("admin_log", "TRUNCATE", "f"),
        ("site_settings", "SELECT", "t"), ("site_settings", "INSERT", "f"),
        ("site_settings", "UPDATE", "f"), ("site_settings", "DELETE", "f"),
        ("accounts", "UPDATE", "f"),
    ):  # fmt: skip
        assert can(table, privilege) == [[allowed]], (table, privilege)
    assert sql(other, "SELECT has_sequence_privilege('preview_api', 'admin_log_seq_seq',"
                      " 'USAGE')") == [["t"]]  # fmt: skip
    updatable = sql(other, "SELECT table_name, column_name"
                           " FROM information_schema.column_privileges"
                           " WHERE grantee = 'preview_api' AND privilege_type = 'UPDATE'"
                           " AND table_name IN ('accounts', 'site_settings')"
                           " ORDER BY 1, 2")  # fmt: skip
    assert updatable == [["accounts", "disabled"], ["accounts", "history_pseudonym"],
                         ["accounts", "leaderboard"],
                         ["accounts", "osm_id"], ["accounts", "osm_server"],
                         ["accounts", "password_hash"], ["accounts", "role"],
                         ["site_settings", "changed_on"], ["site_settings", "value"]]  # fmt: skip
    with pytest.raises(subprocess.CalledProcessError):
        sql(other, "SET ROLE preview_api; UPDATE accounts SET test = true WHERE false")


def test_005_reserves_the_deploy_statuses_and_counts_the_decisions(pg_dsn, pg_loaded):
    """The API role validates and rejects (the trigger numbers each decision per camera,
    without a column grant); applied, superseded and conflict are the owner's alone; an
    applied contribution may still be rejected."""
    sql(pg_dsn, "DROP DATABASE IF EXISTS guard_test")
    sql(pg_dsn, "CREATE DATABASE guard_test")
    other = other_database(pg_dsn, "guard_test")
    sql(other, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api')"
               " THEN CREATE ROLE preview_api; END IF; END $$")  # fmt: skip
    sql(other, "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO preview_api")
    db.migrate(other)
    ensure(other, "ana", "joe")
    row = ("'{}'::uuid, 'move', '{}', 'n', 1, 1, 'b', " + acct("ana") + ", '2026-09-29',"
           " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{{}}', 'x', '{{}}'")  # fmt: skip
    cols = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
            " geom, payload, body_sha256, osm_tags")  # fmt: skip
    a, b, c = (f"00000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3))
    for uid, cam in ((a, "n1"), (b, "n1"), (c, "n2")):
        sql(other, f"INSERT INTO contributions ({cols}) VALUES ({row.format(uid, cam)})")

    def as_api(uid, status):
        sql(
            other,
            f"SET ROLE preview_api; UPDATE contributions SET status = '{status}',"
            f" decided_by_id = {acct('joe')}, decided_on = '2026-09-30' WHERE uuid = '{uid}'",
        )

    def seq(uid):
        return sql(other, f"SELECT status, decision_seq FROM contributions WHERE uuid = '{uid}'")

    as_api(b, "validated")
    as_api(a, "validated")
    as_api(c, "rejected")
    assert (seq(b), seq(a), seq(c)) == ([["validated", "1"]], [["validated", "2"]],
                                        [["rejected", "1"]])  # fmt: skip
    as_api(a, "validated")  # the same decision again: no new number
    assert seq(a) == [["validated", "2"]]
    for status in ("applied", "superseded", "conflict"):
        with pytest.raises(subprocess.CalledProcessError) as e:
            as_api(a, status)
        assert "written by the deploy only" in e.value.stderr
    # The owner (the deploy role) writes them, with the build and the detail.
    sql(other, f"UPDATE contributions SET status = 'applied', apply_build = 'idf-x',"
               f" apply_detail = '{{\"osm_version\": 1}}' WHERE uuid = '{a}'")  # fmt: skip
    as_api(a, "rejected")  # rejecting an applied contribution: allowed, numbered
    assert seq(a) == [["rejected", "3"]]
    with pytest.raises(subprocess.CalledProcessError):
        sql(other, f"SET ROLE preview_api; UPDATE contributions SET apply_build = 'x'"
                   f" WHERE uuid = '{a}'")  # fmt: skip


def test_008_withdrawn_by_its_author_from_pending_only(pg_dsn, pg_loaded):
    """As the API role: a pending contribution is withdrawn with decided_by_id = its author,
    never with another name, never from another status; once withdrawn nothing changes it
    (validated, rejected, pending again, another day); the owner still may (the reset)."""
    sql(pg_dsn, "DROP DATABASE IF EXISTS withdraw_test")
    sql(pg_dsn, "CREATE DATABASE withdraw_test")
    other = other_database(pg_dsn, "withdraw_test")
    sql(other, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api')"
               " THEN CREATE ROLE preview_api; END IF; END $$")  # fmt: skip
    sql(other, "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO preview_api")
    db.migrate(other)
    ensure(other, "ana", "bob", "rev")
    row = ("'{}'::uuid, 'move', 'n1', 'n', 1, 1, 'b', " + acct("ana") + ", '2026-09-29',"
           " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{{}}', 'x', '{{}}'")  # fmt: skip
    cols = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
            " geom, payload, body_sha256, osm_tags")  # fmt: skip
    a, b = (f"00000000-0000-4000-8000-00000000001{i}" for i in (1, 2))
    for uid in (a, b):
        sql(other, f"INSERT INTO contributions ({cols}) VALUES ({row.format(uid)})")

    def as_api(uid, status, by, day="2026-10-02"):
        sql(
            other,
            f"SET ROLE preview_api; UPDATE contributions SET status = '{status}',"
            f" decided_by_id = {acct(by)}, decided_on = '{day}' WHERE uuid = '{uid}'",
        )

    def refused(uid, status, by, message, day="2026-10-02"):
        with pytest.raises(subprocess.CalledProcessError) as e:
            as_api(uid, status, by, day)
        assert message in e.value.stderr

    def status(uid):
        return sql(
            other,
            "SELECT status, (SELECT pseudonym FROM accounts"
            f" WHERE id = decided_by_id) FROM contributions WHERE uuid = '{uid}'",
        )

    refused(a, "withdrawn", "bob", "withdrawn by its author only")
    as_api(b, "validated", "rev")
    refused(b, "withdrawn", "ana", "only a pending contribution is withdrawn")
    as_api(a, "withdrawn", "ana")
    assert status(a) == [["withdrawn", "ana"]]
    as_api(a, "withdrawn", "ana")  # the same again: nothing changes, allowed
    for s_, by in (("validated", "rev"), ("rejected", "rev"), ("pending", "ana")):
        refused(a, s_, by, "a withdrawn contribution does not change")
    refused(a, "withdrawn", "ana", "a withdrawn contribution does not change", day="2026-10-03")
    assert status(a) == [["withdrawn", "ana"]]
    sql(other, f"UPDATE contributions SET status = 'pending' WHERE uuid = '{a}'")  # the owner


def test_load_fills_the_served_build(pg_loaded, ci_build, pg_dsn):
    info, _ = pg_loaded
    cams = gpd.read_parquet(ci_build.build_dir / "cameras_norm.parquet")
    [[bid, region, n_cams, n_blds]] = sql(
        pg_dsn,
        "SELECT build_id, region, (SELECT count(*) FROM cameras),"
        " (SELECT count(*) FROM buildings) FROM meta",
    )
    assert bid == info["build_id"] == buildinfo.build_id(ci_build)
    assert region == "ci"
    assert int(n_cams) == int(cams.is_camera.sum())
    assert int(n_blds) == info["buildings"] > 0


def test_cameras_keep_the_osm_element_and_the_field_inputs(pg_loaded, ci_build, pg_dsn):
    cams = gpd.read_parquet(ci_build.build_dir / "cameras_norm.parquet").set_index("camera_id")
    rows = sql(
        pg_dsn,
        "SELECT camera_id, osm_type, osm_id, osm_version, ST_X(geom), ST_Y(geom), kind,"
        " array_length(directions, 1), range_m, coalesce(tilt_deg::text, 'null') FROM cameras",
    )
    for cid, t, osm_id, version, x, y, kind, ndir, rng, tilt in rows:
        c = cams.loc[cid]
        assert (t, int(osm_id), int(version)) == (cid[0], int(cid[1:]), c.osm_version)
        assert (float(x), float(y)) == (c.geometry.x, c.geometry.y)
        assert kind == c.kind and float(rng) == c.range_m
        assert int(ndir or 0) == len(c.directions)
        assert (tilt == "null") == (c.tilt_deg != c.tilt_deg)  # NaN <-> NULL


def test_a_camera_is_named_by_the_nearest_named_way_within_the_distance():
    """Migration 019, frozen: the nearest named way wins over a farther named one; an
    unnamed way, even nearer, names nothing; past street_within_m, no street; a tie goes
    to the first name in sort order."""
    within = participation.rules()["review"]["street_within_m"]
    assert within == 60
    line = shapely.LineString
    ways = gpd.GeoDataFrame(
        {"highway": ["residential", "service", "primary", "footway", None],
         "name": ["Rue Proche", None, "Avenue Lointaine", " ", "Pas une voie"]},
        geometry=[line([(0, 10), (100, 10)]),     # 10 m north of the first camera
                  line([(0, 2), (100, 2)]),       # nearer, without a name
                  line([(0, -30), (100, -30)]),   # 30 m south
                  line([(0, 1), (100, 1)]),       # a blank name
                  line([(0, 0.5), (100, 0.5)])],  # a name without a highway
        crs="EPSG:2154",
    )  # fmt: skip
    cams = [shapely.Point(50, 0), shapely.Point(50, -100), shapely.Point(50, -10)]
    assert db.streets(cams, ways, within) == ["Rue Proche", None, "Avenue Lointaine"]
    tie = gpd.GeoDataFrame({"highway": ["primary", "primary"], "name": ["Rue B", "Rue A"]},
                           geometry=[line([(0, 5), (9, 5)]), line([(0, -5), (9, -5)])],
                           crs="EPSG:2154")  # fmt: skip
    assert db.streets([shapely.Point(4, 0)], tie, within) == ["Rue A"]
    assert db.streets([], ways, within) == []


def test_the_load_names_the_cameras_by_their_street(pg_loaded, ci_build, pg_dsn):
    """The fixture's cameras get a street from its ways.parquet (one named way at least)."""
    names = set(gpd.read_parquet(ci_build.build_dir / "ways.parquet").name.dropna())
    rows = [r[0] for r in sql(pg_dsn, "SELECT coalesce(street, '') FROM cameras")]
    assert any(rows)
    assert {r for r in rows if r} <= names


def test_a_second_load_swaps_whole_tables(pg_loaded, pg_dsn):
    _, out = pg_loaded
    db.load(out, pg_dsn)
    rows = sql(pg_dsn, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    tables = {r[0] for r in rows}
    assert {"buildings", "cameras", "meta", "contributions"} <= tables
    assert not {"buildings_new", "cameras_new"} & tables
    indexes = {r[0] for r in sql(pg_dsn, "SELECT indexname FROM pg_indexes")}
    assert {"buildings_geom", "cameras_geom", "buildings_pkey", "cameras_pkey"} <= indexes


def test_the_build_before_stays_and_rollback_swaps_it_back(pg_loaded, pg_dsn, tmp_path):
    """France after the Île-de-France: the replaced tables stay one build back (load.sh), and
    db/rollback.sh swaps them back at once, then forward again; a load with unchanged
    buildings keeps no buildings_prev (the build before had the same)."""
    import gzip
    import shutil

    info, out = pg_loaded
    other = tmp_path / "other"
    shutil.copytree(out, other)
    meta = (other / "meta.tsv").read_text().rstrip("\n").split("\t")
    (other / "meta.tsv").write_text("\t".join([meta[0], "ci-other", *meta[2:5], "0" * 64]) + "\n")
    with gzip.open(out / "cameras.tsv.gz", "rt") as f:
        rows = f.readlines()
    with gzip.open(other / "cameras.tsv.gz", "wt") as f:
        f.writelines(rows[:-1])
    state = ("SELECT build_id, (SELECT count(*) FROM cameras), (SELECT count(*) FROM buildings),"
             " (SELECT count(*) FROM cameras_prev) FROM meta")  # fmt: skip
    rollback = [str(db.LOAD_SCRIPT.with_name("rollback.sh")), pg_dsn]
    try:
        db.load(other, pg_dsn)
        n, b = str(info["cameras"]), str(info["buildings"])
        assert sql(pg_dsn, state) == [["ci-other", str(len(rows) - 1), b, n]]
        assert sql(pg_dsn, "SELECT build_id FROM meta_prev") == [[info["build_id"]]]
        assert sql(pg_dsn, "SELECT to_regclass('buildings_prev') IS NOT NULL") == [["t"]]
        subprocess.run(rollback, check=True, capture_output=True)
        assert sql(pg_dsn, state) == [[info["build_id"], n, b, str(len(rows) - 1)]]
        indexes = {r[0] for r in sql(pg_dsn, "SELECT indexname FROM pg_indexes")}
        assert {"cameras_pkey", "cameras_geom", "cameras_prev_pkey", "cameras_prev_geom",
                "buildings_pkey", "buildings_geom", "buildings_prev_pkey"} <= indexes  # fmt: skip
        subprocess.run(rollback, check=True, capture_output=True)
        assert sql(pg_dsn, state)[0][0] == "ci-other"
    finally:
        db.load(out, pg_dsn)
    assert sql(pg_dsn, "SELECT build_id FROM meta") == [[info["build_id"]]]
    db.load(out, pg_dsn)  # the same buildings: none kept back
    assert sql(pg_dsn, "SELECT to_regclass('buildings_prev') IS NULL") == [["t"]]
    sql(pg_dsn, "DROP TABLE cameras_prev")
    run = subprocess.run(rollback, capture_output=True, text=True)
    assert run.returncode == 1 and "no cameras_prev" in run.stderr


def test_unchanged_buildings_are_kept_and_need_no_file(pg_loaded, pg_dsn, tmp_path):
    """Phase "Ajouter": every building of the region is loaded; a load whose buildings'
    digest is the database's keeps the table (deploy.sh then does not send the file), and
    one without the file and with another digest stops."""
    import shutil

    info, out = pg_loaded
    have = sql(pg_dsn, "SELECT buildings_sha256, (SELECT count(*) FROM buildings) FROM meta")
    assert have == [[info["buildings_sha256"], str(info["buildings"])]]
    oid = sql(pg_dsn, "SELECT 'buildings'::regclass::oid")
    light = tmp_path / "light"
    shutil.copytree(out, light)
    (light / "buildings.tsv.gz").unlink()
    run = subprocess.run([str(db.LOAD_SCRIPT), str(light), pg_dsn], capture_output=True, text=True)
    assert run.returncode == 0 and "buildings unchanged" in run.stdout
    assert sql(pg_dsn, "SELECT 'buildings'::regclass::oid") == oid  # the same table
    meta = (light / "meta.tsv").read_text().rstrip("\n").split("\t")
    (light / "meta.tsv").write_text("\t".join([*meta[:5], "0" * 64]) + "\n")
    run = subprocess.run([str(db.LOAD_SCRIPT), str(light), pg_dsn], capture_output=True, text=True)
    assert run.returncode == 1 and "buildings.tsv.gz missing" in run.stderr
    assert sql(pg_dsn, "SELECT buildings_sha256 FROM meta") == [[info["buildings_sha256"]]]


def test_every_building_is_prepared(ci_build, pg_loaded, pg_dsn):
    """Not only those around cameras: a camera may be added anywhere (phase "Ajouter"). Every
    raw building of the extract lies under a loaded one (clusters merge them)."""
    import geopandas as gpd
    import shapely

    raw = gpd.read_parquet(ci_build.build_dir / "buildings.parquet").geometry.values
    loaded = shapely.from_wkt([r[0] for r in sql(pg_dsn, "SELECT ST_AsText(geom) FROM buildings")])
    tree = shapely.STRtree(loaded)
    points = shapely.point_on_surface(raw)
    covered = set(tree.query(points, predicate="dwithin", distance=0.5)[0].tolist())
    assert len(covered) == len(raw), f"{len(raw) - len(covered)} of {len(raw)} not loaded"


def test_settle_writes_the_build_s_outcome_as_the_owner(pg_dsn, pg_loaded, tmp_path):
    """db/settle.sh after db/load.sh: statuses, build and detail from contrib_outcome.json;
    a contribution rejected since the export is left alone; another build's outcome fails."""
    import json

    info, _ = pg_loaded
    ensure(pg_dsn, "ana")
    cols = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
            " status, geom, payload, body_sha256, osm_tags")  # fmt: skip
    ids = [f"00000000-0000-4000-8000-0000000005{i:02d}" for i in range(4)]
    for uid, status in zip(ids, ("validated", "validated", "applied", "rejected"), strict=True):
        sql(pg_dsn, f"INSERT INTO contributions ({cols}) VALUES ('{uid}', 'move', 'n7', 'n', 7,"
                    f" 1, 'b', {acct('ana')}, '2026-09-29', '{status}',"
                    f" ST_SetSRID(ST_MakePoint(0, 0), 2154), '{{}}', 'x', '{{}}')")  # fmt: skip
    sql(
        pg_dsn,
        f"UPDATE contributions SET apply_build = 'older', apply_detail ="
        f' \'{{"osm_version": 1, "result": "applied"}}\' WHERE uuid = \'{ids[2]}\'',
    )
    outcome = {"build_id": info["build_id"], "contributions": [
        {"uuid": ids[0], "result": "applied", "osm_version": 1},
        {"uuid": ids[1], "result": "conflict", "reason": "osm_version", "osm_version": 2,
         "now": {"lon": 2.2, "lat": 48.9, "tags": {"man_made": "surveillance"}}},
        {"uuid": ids[2], "result": "applied", "osm_version": 1},
        {"uuid": ids[3], "result": "applied", "osm_version": 1},
    ]}  # fmt: skip
    (tmp_path / "contrib_outcome.json").write_text(json.dumps(outcome))
    try:
        out = subprocess.run([str(db.regions.ROOT / "db" / "settle.sh"), str(tmp_path), pg_dsn],
                             check=True, capture_output=True, text=True).stdout  # fmt: skip
        assert "settled applied: 1" in out and "settled conflict: 1" in out
        assert "left alone (decided again since the export): 1" in out
        got = {r[0]: r[1:] for r in sql(pg_dsn, "SELECT uuid, status, apply_build,"
               " apply_detail::text FROM contributions WHERE camera_id = 'n7'")}  # fmt: skip
        assert got[ids[0]][:2] == ["applied", info["build_id"]]
        assert got[ids[1]][:2] == ["conflict", info["build_id"]]
        assert json.loads(got[ids[1]][2])["now"]["tags"] == {"man_made": "surveillance"}
        assert got[ids[2]][:2] == ["applied", "older"]  # unchanged: its first build stays
        assert got[ids[3]][:2] == ["rejected", ""]
        outcome["build_id"] = "another"
        (tmp_path / "contrib_outcome.json").write_text(json.dumps(outcome))
        with pytest.raises(subprocess.CalledProcessError) as e:
            subprocess.run([str(db.regions.ROOT / "db" / "settle.sh"), str(tmp_path), pg_dsn],
                           check=True, capture_output=True, text=True)  # fmt: skip
        assert "contribution outcome of build another" in e.value.stderr
    finally:
        sql(pg_dsn, "DELETE FROM contributions WHERE camera_id = 'n7'")
