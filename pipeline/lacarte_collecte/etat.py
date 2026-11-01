"""The collection's memory: a state per source and administration, and the records kept.

- `Etat(root, source)`: one JSON file per administration (`<root>/etat/<source>/<admin>.json`,
  `_` for a source without administrations), merged and written whole at each `save`
  (a temporary file renamed: never half written), with the day of the last new document
  (`dernier_document`) the freshness check reads.
- `Store(root, name)`: the records, one JSON line per record in `<root>/donnees/<name>.jsonl`,
  appended; `records()` reads them back, the last line of an id winning, so a replay never
  makes a duplicate; `forget(ids)` removes ids everywhere in the file (an erasure);
  `compact()` rewrites the file with each id once.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


class Etat:
    def __init__(self, root: Path, source: str):
        self.dir = root / "etat" / source
        self.source = source

    def _path(self, admin: str) -> Path:
        return self.dir / f"{admin or '_'}.json"

    def get(self, admin: str = "") -> dict[str, Any]:
        p = self._path(admin)
        return json.loads(p.read_text("utf-8")) if p.is_file() else {}

    def save(self, admin: str = "", **changes: Any) -> dict[str, Any]:
        st = {**self.get(admin), **changes, "source": self.source, "le": _now()}
        if admin:
            st["administration"] = admin
        _write(self._path(admin), json.dumps(st, ensure_ascii=False, indent=1))
        return st

    def all(self) -> dict[str, dict[str, Any]]:
        if not self.dir.is_dir():
            return {}
        return {p.stem: json.loads(p.read_text("utf-8")) for p in sorted(self.dir.glob("*.json"))}


class Store:
    def __init__(self, root: Path, name: str):
        self.path = root / "donnees" / f"{name}.jsonl"

    def add(self, items: Iterable[dict[str, Any]]) -> int:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        n = 0
        with self.path.open("a", encoding="utf-8") as fh:
            for x in items:
                fh.write(json.dumps(x, ensure_ascii=False, separators=(",", ":")) + "\n")
                n += 1
        return n

    def records(self) -> Iterator[dict[str, Any]]:
        if not self.path.is_file():
            return iter(())
        last: dict[str, dict[str, Any]] = {}
        with self.path.open(encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    r = json.loads(line)
                    last.pop(r["id"], None)  # the last line of an id, in its own place
                    last[r["id"]] = r
        return iter(last.values())

    def ids(self) -> set[str]:
        return {r["id"] for r in self.records()}

    def compact(self, drop: set[str] | frozenset[str] = frozenset()) -> int:
        kept = [r for r in self.records() if r["id"] not in drop]
        _write(
            self.path,
            "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in kept),
        )
        return len(kept)

    def forget(self, ids: set[str]) -> int:
        before = len(self.ids())
        return before - self.compact(ids)
