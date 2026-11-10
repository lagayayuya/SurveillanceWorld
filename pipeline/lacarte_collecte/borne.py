"""A recueil's reading bounded in time (rules/collecte_actes.yaml `lecture`): the reader runs
in a child process, and a reading past the limit kills it. A bound in a thread cannot work:
`re` keeps the GIL while it matches, so neither a timer nor the run's deadline comes back
(2026-11-05 to 11-08: one recueil's summary held every server run until systemd killed it
at 6 h). The child is started once (`spawn`: the run has threads, a fork could inherit a
lock held by one), reused from one recueil to the next, started again after a kill.
"""

from __future__ import annotations

import multiprocessing as mp
import threading
import time
from collections.abc import Callable
from multiprocessing.connection import Connection
from typing import Any

DEMARRAGE = 120.0  # seconds a child may take to start


class TropLong(Exception):
    """The reading did not end within the limit; its child was killed."""


def _servir(conn: Connection) -> None:
    """The child: ready said once, then a function and its arguments in, its result (or its
    error) out."""
    conn.send(("pret", None))
    while True:
        try:
            fn, args = conn.recv()
        except EOFError:
            return
        try:
            conn.send(("ok", fn(*args)))
        except Exception as e:  # noqa: BLE001 (sent back, raised again in the parent)
            conn.send(("erreur", f"{type(e).__name__}: {e}"))


class Lecteur:
    """Calls a module-level function in the child, `limite` seconds at most per call."""

    def __init__(self, limite: float):
        self.limite = limite
        self._ctx = mp.get_context("spawn")
        self._proc: Any = None
        self._conn: Connection | None = None
        self._lock = threading.Lock()

    def _demarrer(self) -> None:
        parent, child = self._ctx.Pipe()
        self._proc = self._ctx.Process(target=_servir, args=(child,), daemon=True)
        self._proc.start()
        child.close()
        self._conn = parent
        # the limit is the reading's, not the child's start (a loaded machine takes seconds to
        # spawn one: 2026-11-10, the test's 0.5 s spent before the first line was read)
        if not parent.poll(DEMARRAGE) or parent.recv()[0] != "pret":
            self._tuer()
            raise TropLong("processus de lecture pas démarré")

    def _tuer(self) -> None:
        if self._proc is not None:
            self._proc.kill()
            self._proc.join(10)
        if self._conn is not None:
            self._conn.close()
        self._proc = self._conn = None

    def __call__(self, fn: Callable[..., Any], *args: Any) -> Any:
        with self._lock:
            if self._proc is None or not self._proc.is_alive():
                self._tuer()
                self._demarrer()
            assert self._conn is not None
            self._conn.send((fn, args))
            if not self._conn.poll(self.limite):
                self._tuer()
                raise TropLong(f"plus de {self.limite:.0f} s")
            try:
                status, value = self._conn.recv()
            except EOFError:  # the child died (memory): as a reading that never ended
                self._tuer()
                raise TropLong("processus de lecture mort") from None
            if status == "erreur":
                raise RuntimeError(value)
            return value

    def fermer(self) -> None:
        with self._lock:
            self._tuer()


_LECTEURS: dict[float, Lecteur] = {}


def lecteur(limite: float) -> Lecteur:
    """The process's reader for this limit: one child for the run (and for the tests)."""
    if limite not in _LECTEURS:
        _LECTEURS[limite] = Lecteur(limite)
    return _LECTEURS[limite]


def dormir(s: float) -> float:
    """A reading that takes `s` seconds (the tests')."""
    time.sleep(s)
    return s
