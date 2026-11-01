"""The pace of the robot per IP address, not per host name: hosts that share a server share
its queue. The 101 sites of the prefectures (www.<département>.gouv.fr) answer on one
address; paced by name, parallel collections sent it about a request per second and it cut
us (2026-10-31).

- One queue per address: a host name is resolved (the resolver is given, the tests' is
  fake), and every host met on an address joins its file `<dir>/<address>.json`, read and
  written under an exclusive lock (fcntl), so two processes on one machine wait for each
  other's turn.
- The interval of an address is the largest of the hosts met on it within a day
  (rules/registre_sources.yaml `hosts`, an exact name before a pattern, then `default`, and
  a host's robots.txt crawl-delay), so a host never makes its server's other hosts faster.
- Slowing down: a 429 or a 5xx doubles the address's factor (at most `slow_max`), each
  answer that is not one halves it back towards 1.
- Cuts: a network error (refused, reset, timed out) is a strike; `strikes` in a row pause
  the address `pause_s` seconds, for every process (`Paused`); an answer clears them.
- Journal: one line per request in `<journal>/requetes-<YYYY-MM>.tsv`: date (UTC), address,
  URL, status (or the network error), duration in milliseconds, source.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import fcntl
import fnmatch
import json
import os
import socket
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any


class Paused(RuntimeError):
    """The address was cut too many times in a row: no request before `until` (epoch s)."""

    def __init__(self, address: str, until: float):
        when = dt.datetime.fromtimestamp(until, dt.UTC).isoformat(timespec="seconds")
        super().__init__(f"adresse en pause jusqu'à {when} (coupures répétées)")
        self.address, self.until = address, until


def resolve(host: str) -> str:
    """The host's first address, IPv4 first (the order the system gives within a family)."""
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    v4 = [i[4][0] for i in infos if i[0] == socket.AF_INET]
    v6 = [i[4][0] for i in infos if i[0] == socket.AF_INET6]
    return str((v4 or v6 or [host])[0])


def interval_of(hosts: dict[str, Any], host: str) -> float:
    """A host's interval: its exact name, else the longest matching pattern, else default."""
    name = host.split(":")[0].lower()
    if name in hosts:
        return float(hosts[name]["interval_s"])
    patterns = [p for p in hosts if any(c in p for c in "*?[") and fnmatch.fnmatch(name, p)]
    if patterns:
        return float(hosts[max(patterns, key=len)]["interval_s"])
    return float(hosts["default"]["interval_s"])


class Cadence:
    def __init__(
        self,
        folder: Path,
        conf: dict[str, Any],
        *,
        source: str = "",
        resolver: Callable[[str], str] = resolve,
        clock: Callable[[], float],
        sleep: Callable[[float], None],
        journal: Path | None = None,
    ):
        self.dir = folder
        self.dir.mkdir(parents=True, exist_ok=True)
        self.conf = conf
        self.source = source
        self.resolver = resolver
        self.clock, self.sleep = clock, sleep
        self.journal = journal
        self._addresses: dict[str, str] = {}
        p = conf.get("pace") or {}
        self.strikes = int(p.get("strikes", 3))
        self.pause_s = float(p.get("pause_s", 2700))
        self.slow_max = float(p.get("slow_max", 8))

    def address(self, host: str) -> str:
        name = host.split(":")[0].lower()
        if name not in self._addresses:
            try:
                self._addresses[name] = self.resolver(name)
            except OSError:
                self._addresses[name] = name  # unresolved: its own queue, the request will say
        return self._addresses[name]

    @contextlib.contextmanager
    def _locked(self, address: str) -> Iterator[dict[str, Any]]:
        path = self.dir / f"{address.replace(':', '_')}.json"
        with (self.dir / f"{address.replace(':', '_')}.lock").open("a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                st = json.loads(path.read_text("utf-8")) if path.is_file() else {}
                yield st
                tmp = path.with_name(f".{path.name}.{os.getpid()}")
                tmp.write_text(json.dumps(st), "utf-8")
                tmp.replace(path)
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)

    def turn(self, host: str, crawl_delay: float | None = None) -> str:
        """Wait for the address's turn (the lock held while waiting: one request at a time on
        that server, across processes), mark it taken; returns the address."""
        address = self.address(host)
        own = max(interval_of(self.conf["hosts"], host), crawl_delay or 0.0)
        with self._locked(address) as st:
            now = self.clock()
            if st.get("pause_until", 0) > now:
                raise Paused(address, st["pause_until"])
            # the hosts met on this address within a day, each with its own interval
            hosts = {h: v for h, v in st.get("hosts", {}).items() if now - v[1] < 86400}
            hosts[host.split(":")[0].lower()] = [own, now]
            st["hosts"] = hosts
            slowest = max(v[0] for v in hosts.values())
            wait = slowest * st.get("slow", 1.0) - (now - st.get("last", -1e18))
            if wait > 0:
                self.sleep(wait)
            st["last"] = self.clock()
        return address

    def answered(self, address: str, status: int) -> None:
        with self._locked(address) as st:
            st["strikes"] = 0
            slow = st.get("slow", 1.0)
            st["slow"] = (
                min(slow * 2, self.slow_max)
                if status == 429 or status >= 500
                else max(1.0, slow / 2)
            )

    def cut(self, address: str) -> None:
        with self._locked(address) as st:
            st["strikes"] = st.get("strikes", 0) + 1
            if st["strikes"] >= self.strikes:
                st["pause_until"] = self.clock() + self.pause_s
                st["strikes"] = 0

    def log(self, address: str, url: str, status: int | str, ms: float) -> None:
        if self.journal is None:
            return
        self.journal.mkdir(parents=True, exist_ok=True)
        now = dt.datetime.now(dt.UTC)
        line = "\t".join(
            [
                now.isoformat(timespec="milliseconds"),
                address,
                url,
                str(status),
                f"{ms:.0f}",
                self.source,
            ]  # fmt: skip
        )
        with (self.journal / f"requetes-{now:%Y-%m}.tsv").open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
