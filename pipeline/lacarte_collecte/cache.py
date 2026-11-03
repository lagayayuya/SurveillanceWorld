"""The surveillance recueils' texts, kept on the server only (DECISIONS 2026-11-03): in the
collection's private folder (<root>/textes/, the unit's 750 data folder), one gzip file per
recueil holding at least one surveillance act, never brought back to the Mac nor written to
SORTIE; deleted after `jours` days (12 months by default) or at once by `effacer`. A new
reader or instruction reads them again there (`lacarte-collecte relire`) without a request
to attrap.fr."""

from __future__ import annotations

import datetime as dt
import gzip
import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

JOURS = 365


class Cache:
    def __init__(self, root: Path):
        self.dir = root / "textes"

    def _path(self, rid: str) -> Path:
        return self.dir / rid[:2] / f"{rid}.json.gz"

    def put(self, rec: dict[str, Any], content: str) -> None:
        path = self._path(rec["id"])
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}")
        data = {**{k: rec.get(k) for k in ("id", "administration", "date", "name", "url")},
                "content": content, "garde_le": dt.date.today().isoformat()}  # fmt: skip
        with gzip.open(tmp, "wt", encoding="utf-8") as g:
            json.dump(data, g, ensure_ascii=False)
        tmp.replace(path)

    def get(self, rid: str) -> dict[str, Any] | None:
        path = self._path(rid)
        if not path.is_file():
            return None
        with gzip.open(path, "rt", encoding="utf-8") as g:
            return json.load(g)

    def all(self) -> Iterator[dict[str, Any]]:
        for p in sorted(self.dir.glob("*/*.json.gz")) if self.dir.is_dir() else []:
            with gzip.open(p, "rt", encoding="utf-8") as g:
                yield json.load(g)

    def effacer(self, rid: str) -> bool:
        path = self._path(rid)
        if path.is_file():
            path.unlink()
            return True
        return False

    def purger(self, today: dt.date, jours: int = JOURS) -> int:
        """Delete the texts kept longer than `jours` days."""
        gone = 0
        for p in list(self.dir.glob("*/*.json.gz")) if self.dir.is_dir() else []:
            if (today - dt.date.fromtimestamp(p.stat().st_mtime)).days > jours:
                p.unlink()
                gone += 1
        return gone

    def taille(self) -> dict[str, int]:
        files = list(self.dir.glob("*/*.json.gz")) if self.dir.is_dir() else []
        return {"recueils": len(files), "octets": sum(p.stat().st_size for p in files)}
