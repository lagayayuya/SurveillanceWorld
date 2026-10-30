"""fetch.py, the registre's only way to the network, against a fake server on 127.0.0.1:
robots.txt (5xx forbids everything, 4xx allows everything, a disallow), the pace per host,
the cache by ETag, a cut download resumed, the state of a source, the refusal without a
contact and the stop on a 403 or an anti-robot check."""

from __future__ import annotations

import http.server
import json
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from lacarte_registre import fetch

CONTACT = "https://example.org/contact"


class Server(http.server.ThreadingHTTPServer):
    """A host whose answers each test sets: {path: handler(request) -> (status, headers, body)}."""

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), Handler)
        self.routes: dict[str, object] = {}
        self.log: list[tuple[str, dict[str, str]]] = []

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (the standard library's name)
        srv: Server = self.server  # type: ignore[assignment]
        srv.log.append((self.path, dict(self.headers.items())))
        route = srv.routes.get(self.path.split("?")[0])
        if route is None:
            status, headers, body = 404, {}, b"not found"
        else:
            status, headers, body = route(self)  # type: ignore[operator]
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        if "Content-Length" not in headers:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


@pytest.fixture
def server() -> Iterator[Server]:
    s = Server()
    t = threading.Thread(target=s.serve_forever, daemon=True)
    t.start()
    yield s
    s.shutdown()
    s.server_close()


class Clock:
    """Time that only the Fetcher's sleeps move: the pace and the waits, measured exactly."""

    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []

    def now(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.t += s


def make(tmp_path: Path, clock: Clock | None = None, **kw) -> fetch.Fetcher:
    clock = clock or Clock()
    conf = fetch.rules()
    conf["hosts"]["default"]["interval_s"] = 1.0
    conf["retries"]["first_wait_s"] = 2
    conf["retries"]["attempts"] = 4
    conf["retries"]["timeout_s"] = 5
    return fetch.Fetcher(
        "essai", tmp_path, conf=conf, contact=kw.pop("contact", CONTACT),
        sleep=clock.sleep, clock=clock.now, **kw,
    )  # fmt: skip


def text(body: str, status: int = 200, **headers: str):
    return lambda _req: (status, {"Content-Type": "text/plain", **headers}, body.encode())


def test_no_contact_no_robot(tmp_path, monkeypatch):
    monkeypatch.delenv(fetch.CONTACT_ENV, raising=False)
    with pytest.raises(fetch.NoContact):
        fetch.Fetcher("essai", tmp_path, contact="")
    with pytest.raises(fetch.NoContact):
        fetch.Fetcher("essai", tmp_path)
    monkeypatch.setenv(fetch.CONTACT_ENV, CONTACT)
    f = fetch.Fetcher("essai", tmp_path)
    assert f.agent == f"SurveillanceWorld/1.0 (+{CONTACT})"


def test_the_robot_says_who_it_is(server, tmp_path):
    server.routes["/robots.txt"] = text("", 404)
    server.routes["/a"] = text("ok")
    make(tmp_path).get(f"{server.base}/a")
    assert {h["User-Agent"] for _, h in server.log} == {f"SurveillanceWorld/1.0 (+{CONTACT})"}


def test_robots_5xx_forbids_everything_and_stops_the_source(server, tmp_path):
    server.routes["/robots.txt"] = text("oops", 500)
    server.routes["/a"] = text("ok")
    f = make(tmp_path)
    with pytest.raises(fetch.Forbidden):
        f.get(f"{server.base}/a")
    assert "/a" not in [p for p, _ in server.log]
    # a 500 is an answer, not a passing failure: asked once
    assert [p for p, _ in server.log] == ["/robots.txt"]
    st = f.state()
    assert st["statut"] == "bloque" and "injoignable" in st["raison"]


def test_robots_4xx_means_no_rule(server, tmp_path):
    server.routes["/robots.txt"] = text("gone", 410)
    server.routes["/a"] = text("ok")
    assert make(tmp_path).get(f"{server.base}/a").body == b"ok"


def test_robots_disallow_is_obeyed_for_our_agent(server, tmp_path):
    server.routes["/robots.txt"] = text(
        "User-agent: SurveillanceWorld\nDisallow: /prive\n\nUser-agent: *\nDisallow:\n"
    )
    server.routes["/prive/x"] = text("secret")
    server.routes["/public"] = text("ok")
    f = make(tmp_path)
    assert f.get(f"{server.base}/public").body == b"ok"
    with pytest.raises(fetch.Forbidden):
        f.get(f"{server.base}/prive/x")
    assert "/prive/x" not in [p for p, _ in server.log]
    # read once for the host, not before each request
    assert [p for p, _ in server.log].count("/robots.txt") == 1


def test_an_html_page_for_robots_is_a_check_not_a_robots_file(server, tmp_path):
    server.routes["/robots.txt"] = lambda _r: (
        200, {"Content-Type": "text/html"}, b"<html><body>Please wait</body></html>"
    )  # fmt: skip
    server.routes["/a"] = text("ok")
    with pytest.raises(fetch.Forbidden):
        make(tmp_path).get(f"{server.base}/a")


def test_one_request_per_interval_on_a_host(server, tmp_path):
    server.routes["/robots.txt"] = text("", 404)
    server.routes["/a"] = text("ok")
    clock = Clock()
    f = make(tmp_path, clock)
    for _ in range(3):
        f.get(f"{server.base}/a", cache=False)
    # robots, then three requests: each waits for the interval since the previous one
    assert len(server.log) == 4
    assert clock.sleeps == [1.0, 1.0, 1.0]


def test_429_and_503_are_tried_again_with_a_growing_wait(server, tmp_path):
    server.routes["/robots.txt"] = text("", 404)
    answers = iter([429, 503, 200])
    server.routes["/a"] = lambda _r: (s := next(answers), {}, b"ok" if s == 200 else b"busy")
    clock = Clock()
    f = make(tmp_path, clock)
    assert f.get(f"{server.base}/a").body == b"ok"
    assert f.retries == 2
    # the waits: 2 s then 4 s (each already past the interval of 1 s)
    assert [s for s in clock.sleeps if s > 1] == [2.0, 4.0]


def test_a_403_stops_the_source_never_tried_again(server, tmp_path):
    server.routes["/robots.txt"] = text("", 404)
    server.routes["/a"] = text("forbidden", 403)
    f = make(tmp_path)
    with pytest.raises(fetch.Blocked):
        f.get(f"{server.base}/a")
    assert [p for p, _ in server.log].count("/a") == 1
    st = f.state()
    assert (st["statut"], st["raison"]) == ("bloque", "refus HTTP 403")


def test_an_anti_robot_page_stops_the_source(server, tmp_path):
    server.routes["/robots.txt"] = text("", 404)
    server.routes["/a"] = lambda _r: (
        200, {"Content-Type": "text/html"},
        b"<html><title>Just a moment...</title><div id='cf-chl-widget'></div></html>",
    )  # fmt: skip
    f = make(tmp_path)
    with pytest.raises(fetch.Blocked):
        f.get(f"{server.base}/a")
    assert f.state()["statut"] == "bloque"


def test_the_cache_sends_the_etag_and_keeps_the_body(server, tmp_path):
    server.routes["/robots.txt"] = text("", 404)

    def etag(req):
        if req.headers.get("If-None-Match") == '"v1"':
            return 304, {"ETag": '"v1"'}, b""
        return 200, {"ETag": '"v1"', "Content-Type": "application/json"}, b'{"n": 1}'

    server.routes["/d.json"] = etag
    f = make(tmp_path)
    first = f.get(f"{server.base}/d.json")
    second = f.get(f"{server.base}/d.json")
    assert first.json() == second.json() == {"n": 1}
    assert (first.from_cache, second.from_cache) == (False, True)
    assert server.log[-1][1].get("If-None-Match") == '"v1"'


BIG = bytes(range(256)) * 400  # 102 400 bytes


def ranged(cut_at: int | None, etag: str = '"big"'):
    """A file served with Range; the first answer stops after `cut_at` bytes."""
    state = {"cut": cut_at}

    def handler(req):
        rng = req.headers.get("Range")
        start = int(rng.split("=")[1].split("-")[0]) if rng else 0
        if rng and req.headers.get("If-Range") not in (None, etag):
            start = 0
        body = BIG[start:]
        headers = {"ETag": etag, "Content-Type": "application/octet-stream",
                   "Content-Length": str(len(body))}  # fmt: skip
        status = 200
        if start:
            status = 206
            headers["Content-Range"] = f"bytes {start}-{len(BIG) - 1}/{len(BIG)}"
        if state["cut"] is not None:
            body, state["cut"] = body[: state["cut"]], None
        return status, headers, body

    return handler


def test_a_cut_download_resumes_with_range(server, tmp_path):
    server.routes["/robots.txt"] = text("", 404)
    server.routes["/big.bin"] = ranged(cut_at=30_000)
    f = make(tmp_path)
    dest = tmp_path / "big.bin"
    got = f.download(f"{server.base}/big.bin", dest)
    assert got == {"statut": "telecharge", "octets": len(BIG)}
    assert dest.read_bytes() == BIG
    asks = [h for p, h in server.log if p == "/big.bin"]
    assert len(asks) == 2
    assert asks[1]["Range"] == "bytes=30000-" and asks[1]["If-Range"] == '"big"'
    assert not dest.with_name("big.bin.part").exists()


def test_a_download_cut_in_an_earlier_run_resumes_in_the_next(server, tmp_path):
    server.routes["/robots.txt"] = text("", 404)
    server.routes["/big.bin"] = ranged(cut_at=None)
    dest = tmp_path / "big.bin"
    # what a killed run left: a part and its validator
    dest.with_name("big.bin.part").write_bytes(BIG[:50_000])
    dest.with_name("big.bin.meta.json").write_text(json.dumps({"partiel": '"big"'}))
    make(tmp_path).download(f"{server.base}/big.bin", dest)
    assert dest.read_bytes() == BIG
    [(_, h)] = [x for x in server.log if x[0] == "/big.bin"]
    assert h["Range"] == "bytes=50000-"


def test_an_unchanged_file_is_not_downloaded_again(server, tmp_path):
    server.routes["/robots.txt"] = text("", 404)

    def handler(req):
        if req.headers.get("If-None-Match") == '"big"':
            return 304, {"ETag": '"big"'}, b""
        return ranged(None)(req)

    server.routes["/big.bin"] = handler
    f = make(tmp_path)
    dest = tmp_path / "big.bin"
    f.download(f"{server.base}/big.bin", dest)
    assert f.download(f"{server.base}/big.bin", dest)["statut"] == "inchange"
    assert dest.read_bytes() == BIG


def test_the_state_keeps_a_cursor_for_resume(tmp_path):
    f = make(tmp_path)
    f.save_state(statut="en_cours", curseur={"page": 7})
    again = make(tmp_path)
    assert again.state()["curseur"] == {"page": 7}
    assert (tmp_path / "brut" / "essai" / "etat.json").is_file()
    assert not list((tmp_path / "brut" / "essai").glob(".etat.json.tmp-*"))


def test_robots_decision_follows_rfc9309():
    url, ua = "https://h/x", "SurveillanceWorld/1.0"
    assert fetch.robots_decision(None, "", url, ua)[0] is False
    assert fetch.robots_decision(503, "", url, ua)[0] is False
    assert fetch.robots_decision(404, "", url, ua)[0] is True
    assert fetch.robots_decision(200, "User-agent: *\nDisallow: /x", url, ua)[0] is False
    assert fetch.robots_decision(200, "User-agent: *\nDisallow: /y", url, ua)[0] is True
    # data.gouv.fr's own (read on 2026-10-30): its files are under /resources
    robots = "User-agent: *\nDisallow: /resources\nDisallow: /api/1/datasets/r/\n"
    pq = "https://static.data.gouv.fr/resources/donnees-essentielles/x/decp.parquet"
    assert fetch.robots_decision(200, robots, pq, ua)[0] is False
