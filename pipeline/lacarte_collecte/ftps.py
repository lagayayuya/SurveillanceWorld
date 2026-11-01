"""The DILA's archives over FTPS, the bulk channel data.gouv.fr announces for the BOAMP's
dataset, for the history only (2024 onwards, one XML per notice): the daily flow stays on
HTTP (dila.Http). Ju's decision (2026-11-01): one connection, a capped rate, each file read
in memory then dropped.

- One connection for a run (FTP over explicit TLS, `PROT P`: the data channel encrypted too),
  anonymous, opened after the address's turn in the HTTP queue (cadence.py: an address
  resting after cuts is not asked over FTPS either); a cut ends FTPS for the run, the rest
  goes over HTTP, and the cut counts in the address's strikes.
- No request rate: the files follow one another on the one connection, the bytes held to
  `debit_ko_s` (rules/registre_sources.yaml `sources.boamp.ftps`).
- robots.txt (RFC 9309) is HTTP's: it does not cover FTP. The archive has none on HTTP either
  (a 404: no rule), read again before the connection.
- Each file is journaled like an HTTP request (date, address, its address, the FTP reply's
  code, duration, `dila`).
"""

from __future__ import annotations

import ftplib
import ssl
import time
from collections.abc import Callable
from typing import Any

from lacarte_collecte.contexte import Contexte
from lacarte_registre import cadence, fetch


class Indisponible(RuntimeError):
    """No FTPS today (refused, unreachable, the address resting): the history goes over HTTP."""


class Ftps:
    canal = "ftps"

    def __init__(
        self,
        ftp: Any,
        root: str,
        rate_kb: float,
        log: Callable[[str, int | str, float], None] = lambda *a: None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.ftp, self.root, self.rate = ftp, root.rstrip("/") + "/", rate_kb * 1024
        self.log, self.sleep, self.clock = log, sleep, clock

    def files(self, folder: str) -> list[str] | None:
        t0 = self.clock()
        try:
            names = self.ftp.nlst(self.root + folder)
        except ftplib.error_perm as e:  # 550: no such folder
            self.log(self.root + folder, str(e)[:3], (self.clock() - t0) * 1000)
            return None
        self.log(self.root + folder, 226, (self.clock() - t0) * 1000)
        return sorted({n.rsplit("/", 1)[-1] for n in names if n.endswith(".xml")})

    def read(self, path: str) -> tuple[bytes, str] | None:
        chunks: list[bytes] = []
        t0 = self.clock()
        got = 0

        def take(b: bytes) -> None:
            nonlocal got
            chunks.append(b)
            got += len(b)
            # the rate: never ahead of `debit_ko_s` since the file's start
            ahead = got / self.rate - (self.clock() - t0)
            if ahead > 0:
                self.sleep(ahead)

        try:
            reply = self.ftp.retrbinary(f"RETR {self.root}{path}", take, blocksize=64 * 1024)
        except ftplib.error_perm as e:
            self.log(self.root + path, str(e)[:3], (self.clock() - t0) * 1000)
            return None
        self.log(self.root + path, reply[:3], (self.clock() - t0) * 1000)
        try:
            when = self.ftp.sendcmd(f"MDTM {self.root}{path}")[4:].strip()
        except ftplib.Error:
            when = ""
        return b"".join(chunks), when

    def close(self) -> None:
        try:
            self.ftp.quit()
        except (OSError, EOFError, ftplib.Error):
            self.ftp.close()


def open_from(ctx: Contexte, conf: dict[str, Any], f: fetch.Fetcher) -> Ftps:
    host = conf["hote"]
    try:
        f.check(f"https://{host}{conf['racine']}")  # the HTTP side's rule for the same path
        address = f.cadence.turn(host)
    except (fetch.Forbidden, cadence.Paused) as e:
        raise Indisponible(str(e)) from None
    t0 = time.perf_counter()
    try:
        ftp = ftplib.FTP_TLS(host, timeout=int(conf.get("timeout_s", 60)),
                             context=ssl.create_default_context())  # fmt: skip
        ftp.login()
        ftp.prot_p()
    except (OSError, EOFError, ftplib.Error) as e:
        f.cadence.cut(address)
        f.cadence.log(address, f"ftps://{host}/", "réseau", (time.perf_counter() - t0) * 1000)
        raise Indisponible(f"{type(e).__name__}: {e}") from None
    f.cadence.answered(address, 200)

    def log(path: str, status: int | str, ms: float) -> None:
        f.cadence.log(address, f"ftps://{host}{path}", status, ms)

    return Ftps(ftp, conf["racine"], float(conf["debit_ko_s"]), log)
