"""Validated contributions out of the participation database, into the build.

    lacarte contrib export [--dsn DSN]     # data/contrib/<region>.jsonl, <region>-hidden.txt
    lacarte contrib check-fresh --region R # deploy/deploy.sh: refuses a stale export
    lacarte contrib check-test --region R  # deploy/deploy.sh: refuses a test account's

Runs db/export_contributions.sql in a read-only transaction: over SSH on the preview's
server (DEPLOY_TARGET, DB_DSN: deploy/deploy.env.example), or on a local database with
--dsn (tests). The file holds only the keys the `apply` stage reads (apply.KEYS): no
author, no day, no time; it is never versioned (data/ is ignored). The same export writes
the hidden cameras' ids (the table hidden_cameras, migration 018), one per line, beside it
(Region.hidden_file): the build leaves them out of everything (regions.hidden). Written
also when empty, so that a camera no longer hidden comes back at the next build.

Test accounts (TEST_AUTHORS, comma-separated, outside the repository like the rest of
deploy.env): their contributions stay in the database and show as proposals, but never
leave it. Since the file carries no author, the deploy checks the file's uuids against
the database (check_test). Since migration 014 the database flags them (accounts.test, set
by db/test_authors.sh from TEST_AUTHORS at each deploy); the export and the check read the
flag and the names both.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

from lacarte import apply, regions

SQL = regions.ROOT / "db" / "export_contributions.sql"
REQUIRED = {"uuid", "kind", "camera_id", "month", "rank"}
OSM_KEYS = {"osm_type", "osm_id", "osm_version"}  # every camera's but an added one's
READ_ONLY = "-c default_transaction_read_only=on"
ACCOUNT = re.compile(r"[A-Za-z0-9._-]{2,32}")  # a pseudonym (migration 014)


def test_authors(value: str | None = None) -> list[str]:
    """TEST_AUTHORS ("ivo" or "ivo, zz"): the test accounts, checked as pseudonyms."""
    value = os.environ.get("TEST_AUTHORS", "") if value is None else value
    names = [n for n in re.split(r"[,\s]+", value) if n]
    for n in names:
        if not ACCOUNT.fullmatch(n):
            raise SystemExit(f"TEST_AUTHORS: {n!r} is not an account name")
    return sorted(set(names))


def _psql_lines(dsn: str | None, ssh: str | None, sql: str | None = None) -> list[str]:
    psql = ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
            "-v", f"test_authors={','.join(test_authors())}"]  # fmt: skip
    sql = SQL.read_text() if sql is None else sql
    if ssh:
        remote = f"PGOPTIONS={shlex.quote(READ_ONLY)} " + shlex.join([*psql, dsn])
        cmd = ["ssh", "-o", "BatchMode=yes", ssh, remote]
        env = None
    else:
        cmd = [*psql, *([dsn] if dsn else [])]
        env = {**os.environ, "PGOPTIONS": READ_ONLY}
    out = subprocess.run(cmd, input=sql, capture_output=True, text=True, env=env)
    if out.returncode:
        # ssh quotes the destination in its errors: never print the host.
        err = out.stderr.strip()[-500:]
        if ssh:
            err = err.replace(ssh, "<DEPLOY_TARGET>").replace(ssh.split("@")[-1], "<host>")
        raise SystemExit(f"export failed ({out.returncode}): {err}")
    return [line for line in out.stdout.splitlines() if line.strip()]


def parse(lines: list[str]) -> tuple[str, list[dict]]:
    """(region, rows) from the query's output; refuses any key the build does not read."""
    if not lines:
        raise ValueError("no output: the database has no meta row")
    head = json.loads(lines[0])
    if set(head) != {"region"}:
        raise ValueError(f"unexpected first line keys {sorted(head)}")
    rows = []
    for line in lines[1:]:
        row = json.loads(line)
        if set(row) - apply.KEYS:
            raise ValueError(f"unexpected keys {sorted(set(row) - apply.KEYS)}")
        required = REQUIRED | (set() if apply.is_added(row["camera_id"]) else OSM_KEYS)
        if required - set(row):
            raise ValueError(f"missing keys {sorted(required - set(row))}")
        rows.append(row)
    return head["region"], rows


def check_test(region: regions.Region, dsn: str | None = None, ssh: str | None = None) -> int:
    """How many contributions the region's file (and the build's outcome) holds that a test
    account made, read in the database: the deploy refuses any (deploy/deploy.sh)."""
    uuids = set()
    if region.contrib_file.exists():
        uuids |= {json.loads(x)["uuid"] for x in region.contrib_file.read_text().splitlines()
                  if x.strip()}  # fmt: skip
    outcome = region.build_dir / "contrib_outcome.json"
    if outcome.exists():
        uuids |= {c["uuid"] for c in json.loads(outcome.read_text())["contributions"]}
    names = test_authors()
    if not uuids:
        return 0
    for u in uuids:
        if not re.fullmatch(r"[0-9A-Za-z-]{1,40}", u):
            raise SystemExit(f"not a uuid in {region.contrib_file.name}: {u!r}")
    if ssh:
        dsn = dsn or os.environ.get("DB_DSN", "dbname=preview")
    # Literals checked above (uuids, account names): no quoting to get wrong. A test account
    # is flagged (migration 014) or named in TEST_AUTHORS; before 014, named (psql's \if).
    listed = ",".join(f"'{n.lower()}'" for n in names) or "NULL"
    sql = (
        "SELECT to_regclass('accounts') IS NOT NULL AS accounts \\gset\n"
        "SELECT count(*) FROM contributions c WHERE uuid::text IN ("
        + ",".join(f"'{u}'" for u in sorted(uuids)) + ")\n"
        "\\if :accounts\n"
        "AND EXISTS (SELECT FROM accounts t WHERE t.id = c.author_id"
        f" AND (t.test OR lower(t.pseudonym) IN ({listed})))\n"
        "\\else\n"
        f"AND lower(author) IN ({listed})\n"
        "\\endif\n;\n"
    )  # fmt: skip
    return int(_psql_lines(dsn, ssh, sql)[0])


# Nothing before migration 018 (a deploy exports before it migrates): no camera hidden.
HIDDEN_SQL = (
    "SELECT to_regclass('hidden_cameras') IS NOT NULL AS hidden \\gset\n"
    "\\if :hidden\n"
    "SELECT camera_id FROM hidden_cameras ORDER BY camera_id;\n"
    "\\endif\n"
)


def write_hidden(path: Path, ids: list[str]) -> None:
    """One id per line, sorted, replaced in one rename; refuses anything but a camera id."""
    if any(not regions.CAMERA_ID.fullmatch(i) for i in ids):
        raise SystemExit("export failed: hidden_cameras holds something that is not a camera id")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text("".join(f"{i}\n" for i in sorted(set(ids))))
    tmp.replace(path)


def write(path: Path, rows: list[dict]) -> None:
    """One sorted, compact JSON object per line (a stable file: its digest enters the id)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(rows, key=lambda r: (r["camera_id"], r["rank"], r["uuid"]))
    tmp = path.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(r, sort_keys=True, separators=(",", ":")) + "\n"
                           for r in rows))  # fmt: skip
    tmp.replace(path)


def export(dsn: str | None = None, ssh: str | None = None, to: str | None = None) -> dict:
    """Write the region's file; `ssh`: the server's DB_DSN (default dbname=preview). `to`:
    a region that covers the one the database serves (regions.yaml `covers`: France after
    the Île-de-France), written under its name."""
    if ssh:
        dsn = dsn or os.environ.get("DB_DSN", "dbname=preview")
    region, rows = parse(_psql_lines(dsn, ssh))
    if to:
        if to != region and region not in regions.load(to).covers:
            raise SystemExit(f"region {to} does not cover {region}, which the database serves")
        region = to
    hidden = _psql_lines(dsn, ssh, HIDDEN_SQL)
    path = regions.load(region).contrib_file
    write(path, rows)
    write_hidden(regions.load(region).hidden_file, hidden)
    kinds = Counter(r["answer"] or r["kind"] if r["kind"] == "verify" else r["kind"] for r in rows)
    return {"region": region, "file": path.name, "contributions": len(rows), **kinds,
            "hidden": len(hidden)}  # fmt: skip


def check_fresh(
    region: regions.Region, dsn: str | None = None, ssh: str | None = None
) -> list[str]:
    """What the database would export now that the region's files (the build's input: their
    digest enters the build id) do not hold: the names of the files that differ, none when
    the export is current. A build from an older export would drop from the map a
    contribution applied since, or show a camera hidden since (deploy/deploy.sh refuses)."""
    if ssh:
        dsn = dsn or os.environ.get("DB_DSN", "dbname=preview")
    name, rows = parse(_psql_lines(dsn, ssh))
    if name != region.name and name not in region.covers:
        return [f"the database serves region {name}, not {region.name}"]
    hidden = _psql_lines(dsn, ssh, HIDDEN_SQL)
    stale = []
    with tempfile.TemporaryDirectory() as tmp:
        fresh, fresh_hidden = Path(tmp) / "c.jsonl", Path(tmp) / "h.txt"
        write(fresh, rows)
        write_hidden(fresh_hidden, hidden)
        for have, want in ((region.contrib_file, fresh), (region.hidden_file, fresh_hidden)):
            held = have.read_bytes() if have.exists() else b""
            if held != want.read_bytes():
                stale.append(have.name)
    return stale


# --- report: what the contributions changed, build against build --------------------------

FLOOR = "detection"  # the drawn field (optics.yaml display_floor)
ESTIMATES = {1: "standard", 2: "prudent"}  # shown estimates, by band index


def _camera_measures(build: Path, ids: set[str]) -> dict[str, dict]:
    """Per camera: position (lon, lat), view area, drawn field per estimate (m2), filmed
    street length per estimate (street portions listing it) and the streets' names."""
    import geopandas as gpd
    import pandas as pd

    # A build made before the `apply` stage has only the normalised cameras.
    path = build / apply.CAMERAS
    cams = gpd.read_parquet(path if path.exists() else build / "cameras_norm.parquet")
    cams = cams.set_index("camera_id")
    ll = cams.to_crs("EPSG:4326").geometry
    views = pd.read_parquet(build / "views.parquet", columns=["camera_id", "area_m2"])
    views = views.set_index("camera_id").area_m2
    bands = gpd.read_parquet(build / "bands.parquet")
    bands = bands[(bands.level == FLOOR) & bands.camera_id.isin(ids)]
    portions = gpd.read_parquet(build / "street_portions.parquet")
    edges = pd.read_parquet(build / "edges.parquet", columns=["edge_id", "name"])
    names = dict(zip(edges.edge_id, edges.name, strict=True))
    cnil = pd.read_parquet(build / "camera_street.parquet", columns=["camera_id", "cnil_signal"])
    cnil = cnil.set_index("camera_id").cnil_signal
    hits: dict[str, list[int]] = {}
    for i, listed in enumerate(portions.cameras):
        for c in listed:
            cid = c.split(":")[0]
            if cid in ids:
                hits.setdefault(cid, []).append(i)
    out = {}
    for cid in sorted(ids):
        if cid not in cams.index:
            continue
        m = {"lon": round(ll[cid].x, 6), "lat": round(ll[cid].y, 6),
             "gone": bool(apply.gone(cams.loc[[cid]]).iloc[0]),
             "view_m2": round(float(views.get(cid, 0.0)), 1),
             # What the "Compléter" answers change (phase D2).
             "kind": cams.at[cid, "kind"],
             "direction": [round(float(d)) for d in cams.at[cid, "directions"]],
             "operator": cams.at[cid, "operator_class"],
             "operator_kind": cams.at[cid, "operator_kind"] if "operator_kind" in cams else None,
             "cnil": bool(cnil.get(cid, False))}  # fmt: skip
        for b, est in ESTIMATES.items():
            sel = bands[(bands.camera_id == cid) & (bands.band == b)]
            m[f"field_m2_{est}"] = round(float(sel.geometry.area.sum()), 1)
            mine = portions.iloc[hits.get(cid, [])]
            mine = mine[mine.band == b]
            m[f"street_m_{est}"] = round(float(mine.geometry.length.sum()), 1)
            if est == "prudent":
                streets = {names.get(e) for e in mine.edge_id} - {None}
                m["streets"] = sorted(s for s in streets if isinstance(s, str))
        out[cid] = m
    return out


def report(region: regions.Region, before: Path) -> dict:
    """Each contribution's outcome with its camera before (`before`, the build without
    them) and after (the region's build); the areas whose published figures changed."""
    import math

    import pandas as pd

    after = region.build_dir
    outcome = json.loads((after / apply.OUTCOME).read_text())
    contribs = {c.uuid: c for c in apply.read(region.contrib_file)}
    ids = {c.camera_id for c in contribs.values()}
    a, b = _camera_measures(before, ids), _camera_measures(after, ids)
    rows = []
    for o in outcome["contributions"]:
        c = contribs[o["uuid"]]
        row = {"uuid": o["uuid"], "what": c.what, "camera": c.camera_id,
               "month": c.month, "rank": c.rank, "result": o["result"],
               "reason": o.get("reason"), "before": a.get(c.camera_id),
               "after": b.get(c.camera_id)}  # fmt: skip
        if row["before"] and row["after"]:
            x0, y0 = row["before"]["lon"], row["before"]["lat"]
            x1, y1 = row["after"]["lon"], row["after"]["lat"]
            row["moved_m"] = round(math.hypot((x1 - x0) * 111_320 * math.cos(math.radians(y0)),
                                              (y1 - y0) * 110_540), 1)  # fmt: skip
        rows.append(row)
    cols = ["filmed_ratio_probable_dir", "filmed_ratio_cautious", "camera_count"]
    keys = ["level", "code", "name"]
    old = pd.read_parquet(before / "areas.parquet", columns=keys + cols)
    new = pd.read_parquet(after / "areas.parquet", columns=keys + cols)
    both = old.merge(new, on=keys, suffixes=("_before", "_after"))
    changed = both[
        (both[[f"{c}_before" for c in cols]].to_numpy()
         != both[[f"{c}_after" for c in cols]].to_numpy()).any(axis=1)
    ]  # fmt: skip
    areas = [
        {k: (round(float(v) * 100, 3) if "ratio" in k else v) for k, v in r.items()}
        for r in changed.to_dict("records")
    ]

    # The map's colour class of each area changed: the quantile class of Y (the cautious
    # share, "Qui filme" all), 0-4, against each build's own breaks (tiles/meta.json).
    def scale(build: Path, level: str) -> list[float]:
        meta = json.loads((build / "tiles" / "meta.json").read_text())
        return meta["departements" if level == "departement" else "communes"]["hi"]["breaks"]

    for r in areas:
        for side, build in (("before", before), ("after", after)):
            y = r[f"filmed_ratio_cautious_{side}"]
            r[f"class_{side}"] = sum(y >= b for b in scale(build, r["level"]))
    breaks = {lv: (scale(before, lv), scale(after, lv)) for lv in ("commune", "departement")}
    return {"build": outcome["build_id"], "contributions": rows, "areas": areas,
            "breaks": breaks}  # fmt: skip
