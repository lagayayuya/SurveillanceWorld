"""`lacarte-registre corrections exporter`: the corrections /revue accepted, out of the
participation database, into data/registre/corrections.yaml, which `lacarte-registre
construire` applies after rules/registre_corrections.yaml (regles.py).

    lacarte-registre corrections exporter [--dsn DSN | --ssh HOST]

Runs db/export_registre_corrections.sql in a read-only transaction, as `lacarte contrib
export` does (its _psql_lines): over SSH on the preview's server (--ssh, default
DEPLOY_TARGET; the database DB_DSN, default dbname=preview), or on a local database with
--dsn (tests). The file has the rules file's format (id, evenement, field, value, source,
rationale) plus `le`, the day the correction was accepted; nothing about the reader or the
reviewer. It is never versioned (data/ is ignored), and written also when empty, so that a
correction no longer accepted leaves the next build.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

import yaml

import lacarte_registre as registre
from lacarte import regions
from lacarte_registre import corrections

SQL = regions.ROOT / "db" / "export_registre_corrections.sql"
FILE = "corrections.yaml"
HEAD = (
    "# The register's corrections accepted in /revue « Registre » (`lacarte-registre corrections\n"
    "# exporter`, db/export_registre_corrections.sql): applied by `lacarte-registre construire`\n"
    "# after rules/registre_corrections.yaml. Generated: never edited, never versioned.\n"
)


def _psql_lines(dsn: str | None, ssh: str | None, sql: str) -> list[str]:
    from lacarte.contrib import _psql_lines as run  # the contributions' export, as is

    return run(dsn, ssh, sql)


def entry(row: dict[str, Any]) -> dict[str, Any]:
    """One accepted report as the build reads it; refuses anything the API would not have
    kept (a field, a value, an id)."""
    try:
        if not corrections.ID.fullmatch(row["evenement"]):
            raise ValueError(f"not a document id: {row['evenement']!r}")
        value = corrections.value(row["field"], row["value"])
        if not (row.get("reason") and corrections.DAY.fullmatch(row.get("le") or "")):
            raise ValueError("no reason or no day")
    except (KeyError, TypeError, ValueError) as e:
        raise SystemExit(f"export failed: report {row.get('id')}: {e}") from None
    return {
        "id": f"registre_reports:{row['id']}",
        "evenement": row["evenement"],
        "field": row["field"],
        "value": value,
        "source": row.get("source") or "a reader's report, accepted in /revue",
        "rationale": row["reason"],
        "le": row["le"],
    }


def write(path: Path, entries: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = yaml.safe_dump({"version": 1, "corrections": entries}, allow_unicode=True,
                          sort_keys=False, width=100)  # fmt: skip
    tmp = path.with_suffix(".tmp")
    tmp.write_text(HEAD + body, encoding="utf-8")
    tmp.replace(path)


def export(dsn: str | None = None, ssh: str | None = None, root: Path | None = None) -> dict:
    """Write <root>/corrections.yaml (root: data/registre); a summary of what it holds."""
    if ssh:
        dsn = dsn or os.environ.get("DB_DSN", "dbname=preview")
    rows = [json.loads(line) for line in _psql_lines(dsn, ssh, SQL.read_text())]
    entries = [entry(r) for r in rows]
    path = (root or registre.ROOT) / FILE
    write(path, entries)
    return {"file": str(path.relative_to(regions.ROOT)) if path.is_relative_to(regions.ROOT)
            else path.name, "corrections": len(entries),
            **Counter(e["field"] for e in entries)}  # fmt: skip
