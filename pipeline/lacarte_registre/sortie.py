"""Writing the registre's folders: all or nothing.

A folder is written whole into a temporary sibling (`.<name>.tmp-<pid>`), then put in place
by two renames on the same file system: the old folder aside, the new one in its place, the
old one removed. An interrupted command leaves the previous folder as it was and no
temporary folder behind it (removed on the way out; a killed process's is removed by the
next run). The files are compact UTF-8 JSON, the web server sends them `no-cache`.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any


def dump(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def _leftovers(target: Path) -> Iterator[Path]:
    yield from target.parent.glob(f".{target.name}.tmp-*")
    yield from target.parent.glob(f".{target.name}.old-*")


def replace_dir(target: Path, write: Callable[[Path], None]) -> None:
    """Call write(tmp) on an empty temporary folder, then put it at `target`."""
    target.parent.mkdir(parents=True, exist_ok=True)
    for stale in _leftovers(target):
        shutil.rmtree(stale, ignore_errors=True)
    tmp = target.parent / f".{target.name}.tmp-{os.getpid()}"
    old = target.parent / f".{target.name}.old-{os.getpid()}"
    tmp.mkdir()
    try:
        write(tmp)
        if target.exists():
            target.rename(old)
        tmp.rename(target)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        if old.exists() and not target.exists():
            old.rename(target)
        raise
    with contextlib.suppress(FileNotFoundError):
        shutil.rmtree(old)
