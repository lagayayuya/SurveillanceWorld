"""The registre's only way to the network: every collection module asks through a Fetcher.

- robots.txt, RFC 9309: read once per host (and kept `robots.cache_h` hours, § 2.4); a 2xx
  robots file is obeyed for our User-Agent, a 4xx means no rule (§ 2.3.1.3), a 5xx or no
  answer forbids everything (§ 2.3.1.4), an HTML page instead of a robots file is taken for
  an anti-robot check and forbids everything too (the exploration's robots_rule.py).
- Who asks: `SurveillanceWorld/<version> (+<contact>)`, the contact from LACARTE_ROBOT_CONTACT;
  without it the Fetcher refuses to start (NoContact). No address is written in the repository.
- How fast: at most one request per `interval_s` on a host (rules/registre_sources.yaml).
- What it keeps: a response's ETag and Last-Modified beside its body (brut/<source>/cache/),
  sent again as If-None-Match and If-Modified-Since: a 304 gives the kept body back.
- Large files (`download`): written to <dest>.part, resumed with Range (and If-Range, so a
  changed file starts over), renamed when complete.
- Trying again: a network error, a 429, a 502, a 503 or a 504, with a wait that doubles
  (Retry-After honoured within its bound), at most `retries.attempts` tries.
- Never around a refusal: a 403, a 401 or an anti-robot check page stops the source (Blocked);
  a robots.txt disallow too (Forbidden). Either is written in the source's state
  (brut/<source>/etat.json): `statut` "bloque", its `raison`, and the coverage says it.
- Resuming: the state file keeps the collection's cursor (`curseur`, the module's own: a
  page, a month); `--resume` starts from it, a new collection from scratch.

Nothing here knows a source: decp.py, boamp.py, sirene.py and communes.py say what to ask.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import email.utils
import hashlib
import http.client
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

import lacarte_registre as registre

CONTACT_ENV = "LACARTE_ROBOT_CONTACT"
STATE = "etat.json"
RETRY_STATUS = frozenset({429, 502, 503, 504})
BLOCK_STATUS = frozenset({401, 403})
# An anti-robot check: a page asking the browser to prove itself, whatever its status.
CHALLENGE = re.compile(
    rb"cf-chl|challenge-platform|captcha|just a moment\.\.\.|attention required|"
    rb"verify you are (a )?human|access denied|datadome|perimeterx|incapsula",
    re.I,
)


class NoContact(RuntimeError):
    """LACARTE_ROBOT_CONTACT is not set: the robot would not say how to reach us."""


class Forbidden(RuntimeError):
    """robots.txt forbids the address (or its host's robots.txt could not be read)."""

    def __init__(self, url: str, raison: str):
        super().__init__(f"{url}: {raison}")
        self.url, self.raison = url, raison


class Blocked(RuntimeError):
    """The host refused us (403, 401) or answered with an anti-robot check: we stop there."""

    def __init__(self, url: str, raison: str):
        super().__init__(f"{url}: {raison}")
        self.url, self.raison = url, raison


class Failed(RuntimeError):
    """Still no answer after every try (network errors, 429, 5xx), or an unexpected status."""

    def __init__(self, url: str, raison: str, status: int | None = None):
        super().__init__(f"{url}: {raison}")
        self.url, self.raison, self.status = url, raison, status


@dataclass
class Response:
    url: str
    status: int
    body: bytes
    headers: dict[str, str]
    from_cache: bool = False

    def json(self) -> Any:
        return json.loads(self.body)


def rules(path: Path | None = None) -> dict[str, Any]:
    return yaml.safe_load((path or registre.RULES / "registre_sources.yaml").read_text("utf-8"))


def user_agent(conf: dict[str, Any], contact: str | None) -> str:
    contact = (contact or "").strip()
    if not contact or any(c in contact for c in "()\r\n"):
        raise NoContact(
            f"{CONTACT_ENV} is not set (or not one line without parentheses): the robot says "
            "how to reach whoever runs it, `SurveillanceWorld/<version> (+<contact>)`"
        )
    robot = conf["robot"]
    return f"{robot['name']}/{robot['version']} (+{contact})"


def robots_decision(status: int | None, text: str, url: str, agent: str) -> tuple[bool, str]:
    """May `agent` fetch `url`, given its host's robots.txt answer (RFC 9309 § 2.3.1)?"""
    if status is None or status >= 500:
        return False, f"robots.txt injoignable ({status or 'pas de réponse'}) : tout est interdit"
    if 400 <= status < 500:
        return True, f"robots.txt {status} : aucune règle"
    if "<html" in text[:500].lower():
        return False, "robots.txt répond par une page HTML (vérification anti-robot ?)"
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    ok = rp.can_fetch(agent, url)
    return ok, "robots.txt autorise" if ok else "robots.txt interdit cette adresse"


def _host(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    return p.netloc.lower()


def _key(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:32]


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


class Fetcher:
    """One source's way to the network (its cache and state under `<root>/brut/<source>/`)."""

    def __init__(
        self,
        source: str,
        root: Path | None = None,
        *,
        conf: dict[str, Any] | None = None,
        contact: str | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        opener: urllib.request.OpenerDirector | None = None,
    ):
        self.source = source
        self.conf = conf or rules()
        if contact is None:
            contact = os.environ.get(CONTACT_ENV)
        self.agent = user_agent(self.conf, contact)
        self.dir = (root or registre.ROOT) / "brut" / source
        self.cache = self.dir / "cache"
        self.cache.mkdir(parents=True, exist_ok=True)
        self.sleep, self.clock = sleep, clock
        self.opener = opener or urllib.request.build_opener()
        self._last: dict[str, float] = {}
        self._robots: dict[str, tuple[int | None, str, float]] = {}
        self.requests = 0  # every request sent, robots.txt included (tests, reports)
        self.retries = 0

    # --- the state of the source's collection -------------------------------------------
    def state(self) -> dict[str, Any]:
        path = self.dir / STATE
        if not path.is_file():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def save_state(self, **changes: Any) -> dict[str, Any]:
        """Merge `changes` into the state and write it (a temporary file renamed: never half)."""
        st = {**self.state(), **changes, "source": self.source, "le": _now()}
        tmp = self.dir / f".{STATE}.tmp-{os.getpid()}"
        tmp.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.dir / STATE)
        return st

    def _stop(self, exc: Forbidden | Blocked) -> None:
        self.save_state(statut="bloque", raison=exc.raison, adresse=exc.url)

    # --- pace and robots ----------------------------------------------------------------
    def interval(self, host: str) -> float:
        hosts = self.conf["hosts"]
        return float((hosts.get(host.split(":")[0]) or hosts["default"])["interval_s"])

    def _wait_turn(self, host: str) -> None:
        last = self._last.get(host)
        if last is not None:
            wait = self.interval(host) - (self.clock() - last)
            if wait > 0:
                self.sleep(wait)
        self._last[host] = self.clock()

    def _robots_txt(self, url: str) -> tuple[int | None, str]:
        p = urllib.parse.urlsplit(url)
        host = _host(url)
        kept = self._robots.get(host)
        if kept and self.clock() - kept[2] < self.conf["robots"]["cache_h"] * 3600:
            return kept[0], kept[1]
        robots = f"{p.scheme}://{p.netloc}/robots.txt"
        status: int | None
        try:
            # robots.txt is asked with the same patience as any address (§ 2.3.1.4: an
            # unreachable one forbids everything, a passing failure would stop the source)
            r = self._send(robots, {}, retry=True)
            status, text = r.status, r.body.decode("utf-8", "replace")
        except Failed as e:
            status, text = e.status, ""
        self._robots[host] = (status, text, self.clock())
        with contextlib.suppress(OSError):
            (self.dir / "robots").mkdir(exist_ok=True)
            (self.dir / "robots" / f"{host.replace(':', '_')}.txt").write_text(
                f"# {robots} {status} {_now()}\n{text}", encoding="utf-8"
            )
        return status, text

    def allowed(self, url: str) -> tuple[bool, str]:
        status, text = self._robots_txt(url)
        return robots_decision(status, text, url, self.agent)

    def check(self, url: str) -> None:
        ok, why = self.allowed(url)
        if not ok:
            exc = Forbidden(url, why)
            self._stop(exc)
            raise exc

    # --- sending ------------------------------------------------------------------------
    def _send(
        self,
        url: str,
        headers: dict[str, str],
        *,
        retry: bool = True,
        stream_to: Path | None = None,
        on_headers: Callable[[dict[str, str]], None] | None = None,
    ) -> Response:
        """One request, tried again on what may pass; a refusal raises Blocked at once. With
        `stream_to`, the body goes to that file, and a try after a cut asks for the rest only
        (Range, If-Range on the file's validator)."""
        r = self.conf["retries"]
        wait = float(r["first_wait_s"])
        host = _host(url)
        why = ""
        status: int | None = None
        validator = headers.get("If-Range", "")
        attempt = 0
        for attempt in range(int(r["attempts"]) if retry else 1):
            if attempt:
                self.retries += 1
                self.sleep(min(wait, float(r["max_wait_s"])))
                wait *= 2
                if stream_to is not None and stream_to.is_file() and stream_to.stat().st_size:
                    headers = {"Range": f"bytes={stream_to.stat().st_size}-"}
                    if validator:
                        headers["If-Range"] = validator
            self._wait_turn(host)
            req = urllib.request.Request(url, headers={"User-Agent": self.agent, **headers})
            self.requests += 1
            try:
                with self.opener.open(req, timeout=float(r["timeout_s"])) as resp:
                    status = resp.status
                    hdrs = {k.lower(): v for k, v in resp.headers.items()}
                    if stream_to is None:
                        body = resp.read()
                        if CHALLENGE.search(body[:4000]) and "html" in hdrs.get("content-type", ""):
                            raise Blocked(url, "page de vérification anti-robot")
                        return Response(url, status, body, hdrs)
                    if "html" in hdrs.get("content-type", ""):
                        head = resp.read(4000)
                        if CHALLENGE.search(head):
                            raise Blocked(url, "page de vérification anti-robot")
                    else:
                        head = b""
                    validator = hdrs.get("etag") or hdrs.get("last-modified") or validator
                    if on_headers:
                        on_headers(hdrs)
                    kept = stream_to.is_file() and status == 206
                    before = stream_to.stat().st_size if kept else 0
                    with stream_to.open("ab" if status == 206 else "wb") as f:
                        f.write(head)
                        while chunk := resp.read(1 << 20):
                            f.write(chunk)
                    _complete(stream_to, status, hdrs, before)
                    return Response(url, status, b"", hdrs)
            except urllib.error.HTTPError as e:
                status = e.code
                hdrs = {k.lower(): v for k, v in (e.headers or {}).items()}
                body = e.read() or b""
                if status == 304:
                    return Response(url, 304, b"", hdrs)
                if status in BLOCK_STATUS:
                    raise Blocked(url, f"refus HTTP {status}") from None
                if CHALLENGE.search(body[:4000]):
                    raise Blocked(url, f"page de vérification anti-robot (HTTP {status})") from None
                if status == 416 and stream_to is not None:
                    # asked past the end: the kept part is the whole file
                    return Response(url, 206, b"", hdrs)
                if status not in RETRY_STATUS:
                    if 400 <= status < 500:
                        return Response(url, status, body, hdrs)
                    raise Failed(url, f"HTTP {status}", status) from None
                why = f"HTTP {status}"
                ra = hdrs.get("retry-after", "")
                if ra.isdigit():
                    wait = max(wait, float(ra))
                elif ra:
                    with contextlib.suppress(TypeError, ValueError):
                        when = email.utils.parsedate_to_datetime(ra).timestamp()
                        wait = max(wait, when - time.time())
            except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
                status = None
                why = f"réseau : {getattr(e, 'reason', e)}"
        raise Failed(url, f"sans réponse après {attempt + 1} essais ({why})", status)

    def get(
        self, url: str, params: dict[str, Any] | None = None, *, cache: bool = True
    ) -> Response:
        """GET `url` (with its query `params`), robots.txt first, kept by ETag/Last-Modified."""
        if params:
            url = f"{url}{'&' if '?' in url else '?'}{urllib.parse.urlencode(params)}"
        try:
            self.check(url)
            meta_path = self.cache / f"{_key(url)}.json"
            body_path = self.cache / f"{_key(url)}.body"
            headers = {}
            meta = None
            if cache and meta_path.is_file() and body_path.is_file():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if meta.get("etag"):
                    headers["If-None-Match"] = meta["etag"]
                if meta.get("last_modified"):
                    headers["If-Modified-Since"] = meta["last_modified"]
            resp = self._send(url, headers)
        except Blocked as e:
            self._stop(e)
            raise
        if resp.status == 304 and meta is not None:
            return Response(url, 200, body_path.read_bytes(), meta.get("headers", {}), True)
        if (
            cache
            and resp.status == 200
            and (resp.headers.get("etag") or resp.headers.get("last-modified"))
        ):
            body_path.write_bytes(resp.body)
            meta_path.write_text(
                json.dumps(
                    {
                        "url": url,
                        "etag": resp.headers.get("etag"),
                        "last_modified": resp.headers.get("last-modified"),
                        "headers": {"content-type": resp.headers.get("content-type", "")},
                        "le": _now(),
                    }
                ),
                encoding="utf-8",
            )
        return resp

    def get_json(self, url: str, params: dict[str, Any] | None = None, **kw: Any) -> Any:
        r = self.get(url, params, **kw)
        if r.status != 200:
            raise Failed(r.url, f"HTTP {r.status}", r.status)
        return r.json()

    def download(self, url: str, dest: Path) -> dict[str, Any]:
        """A large file to `dest`, through <dest>.part: a cut download resumes with Range,
        within this run and the next one (If-Range: a changed file starts over); unchanged
        since the last download (its ETag or Last-Modified: a 304), it stays.
        Returns {"statut": "telecharge" | "inchange", "octets": n}."""
        meta_path = dest.with_name(dest.name + ".meta.json")
        part = dest.with_name(dest.name + ".part")
        meta = json.loads(meta_path.read_text("utf-8")) if meta_path.is_file() else {}
        headers: dict[str, str] = {}
        if part.is_file() and part.stat().st_size and meta.get("partiel"):
            headers = {"Range": f"bytes={part.stat().st_size}-", "If-Range": meta["partiel"]}
        elif dest.is_file():
            if meta.get("etag"):
                headers["If-None-Match"] = meta["etag"]
            if meta.get("last_modified"):
                headers["If-Modified-Since"] = meta["last_modified"]

        def keep_validator(h: dict[str, str]) -> None:
            v = h.get("etag") or h.get("last-modified") or ""
            meta_path.write_text(json.dumps({**meta, "partiel": v}), encoding="utf-8")

        try:
            self.check(url)
            resp = self._send(url, headers, stream_to=part, on_headers=keep_validator)
        except Blocked as e:
            self._stop(e)
            raise
        if resp.status == 304:
            return {"statut": "inchange", "octets": dest.stat().st_size}
        if resp.status not in (200, 206):
            raise Failed(url, f"HTTP {resp.status}", resp.status)
        part.replace(dest)
        meta_path.write_text(
            json.dumps(
                {
                    "url": url,
                    "etag": resp.headers.get("etag"),
                    "last_modified": resp.headers.get("last-modified"),
                    "le": _now(),
                }
            ),
            encoding="utf-8",
        )
        return {"statut": "telecharge", "octets": dest.stat().st_size}


def _complete(path: Path, status: int, hdrs: dict[str, str], before: int) -> None:
    """Raise a ConnectionError (a network error: tried again for the rest) when the body
    stopped short of what the headers announced."""
    got = path.stat().st_size
    if status == 206:
        total = hdrs.get("content-range", "").rsplit("/", 1)[-1]
        if total.isdigit() and got < int(total):
            raise ConnectionError(f"coupé à {got} octets sur {total}")
        return
    length = hdrs.get("content-length", "")
    if length.isdigit() and got - before < int(length):
        raise ConnectionError(f"coupé à {got} octets sur {length}")
