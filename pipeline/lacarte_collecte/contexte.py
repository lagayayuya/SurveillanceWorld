"""What every source receives: where to write, its network, its time budget, today, the erased
notices. One run of the server's unit has a few hours (RuntimeMaxSec): each source stops
cleanly when its budget is spent, its state saying where it stopped, and the next night
goes on from there."""

from __future__ import annotations

import datetime as dt
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from lacarte_registre import fetch


def rules(name: str, folder: Path) -> dict[str, Any]:
    return yaml.safe_load((folder / name).read_text("utf-8")) or {}


@dataclass
class Contexte:
    root: Path
    sortie: Path
    rules_dir: Path
    today: dt.date = field(default_factory=dt.date.today)
    deadline: float = float("inf")  # time.monotonic() after which a source stops
    contact: str | None = None
    conf: dict[str, Any] | None = None  # rules/registre_sources.yaml (the tests' own)
    clock: Callable[[], float] = time.monotonic
    fetcher_kw: dict[str, Any] = field(default_factory=dict)
    _fetchers: dict[str, fetch.Fetcher] = field(default_factory=dict)

    def fetcher(self, source: str) -> fetch.Fetcher:
        if source not in self._fetchers:
            self._fetchers[source] = fetch.Fetcher(
                source, self.root, conf=self.conf, contact=self.contact, **self.fetcher_kw
            )
        return self._fetchers[source]

    def out_of_time(self) -> bool:
        return self.clock() >= self.deadline

    def effaces(self) -> set[str]:
        """The notices to erase everywhere (rules/registre_effacements.yaml), by idweb."""
        conf = rules("registre_effacements.yaml", self.rules_dir)
        return {str(e["idweb"]) for e in conf.get("avis") or []}

    def requetes(self) -> dict[str, int]:
        return {s: f.requests for s, f in self._fetchers.items()}
