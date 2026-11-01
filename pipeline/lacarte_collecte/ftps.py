"""The DILA's archives over FTPS, the bulk channel data.gouv.fr announces for the BOAMP's
dataset, for the history only (2024 onwards, one XML per notice): the daily flow stays on
HTTP (dila.Http). Ju's decision (2026-11-01): one connection, a capped rate, each file read
in memory then dropped.

- One connection for a run (FTP over implicit TLS on port 990, `PROT P`: the data channel
  encrypted too; the archive's tree is under /BOAMP/ there, not /OPENDATA/BOAMP/),
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


class Implicite(ftplib.FTP_TLS):
    """FTP over implicit TLS (port 990: the DILA's port 21 does not answer, measured on
    2026-11-01): the control connection is TLS from its first byte, and each data connection
    reuses its TLS session (vsFTPd asks for it)."""

    def __init__(self, *args: Any, **kw: Any):
        super().__init__(*args, **kw)
        self._sock: Any = None

    @property  # type: ignore[override]
    def sock(self) -> Any:
        return self._sock

    @sock.setter
    def sock(self, value: Any) -> None:
        if value is not None and not isinstance(value, ssl.SSLSocket):
            value = self.context.wrap_socket(value, server_hostname=self.host)
        self._sock = value

    def ntransfercmd(self, cmd: str, rest: Any = None) -> tuple[Any, int | None]:
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(
                conn, server_hostname=self.host, session=self.sock.session
            )
        return conn, size


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
        xml = sorted({n.rsplit("/", 1)[-1] for n in names if n.endswith(".xml")})
        # the DILA's server lists a folder that does not exist as empty (no 550, measured
        # 2026-11-01): an empty day is not taken for read, HTTP is asked instead
        return xml or None

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
        f.check(f.conf["sources"]["boamp"]["archive"])  # the HTTP side's rule, read again
        address = f.cadence.turn(host)
    except (fetch.Forbidden, cadence.Paused) as e:
        raise Indisponible(str(e)) from None
    t0 = time.perf_counter()
    try:
        ftp = Implicite(
            context=ssl.create_default_context(), timeout=int(conf.get("timeout_s", 60))
        )
        ftp.connect(host, int(conf.get("port", 990)))
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
