"""The site file fits in a shared Caddyfile. Private preview: without the password the
server answers a generic 401 that names neither the project nor the deployment's own words
(SITE_FORBIDDEN); with it, the API gets no client address and no author (accounts sign in
to the API itself, migration 014), and /revue opens past the gate (its API answers the
reviewer role only). Public: the same file, open and indexable, /revue and its API alone
behind a password, and www.<host> redirected for good to the bare host."""

import base64
import http.server
import importlib.util
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("site_deploy", ROOT / "deploy" / "site.py")
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)

CADDY = shutil.which("caddy")
needs_caddy = pytest.mark.skipif(
    CADDY is None and not os.environ.get("REQUIRE_CADDY"),
    reason="caddy not installed (CI installs it and sets REQUIRE_CADDY)",
)
HASH = "$2a$14$placeholderplaceholderplaceholderplaceholderplaceho"
ENV = {
    "PREVIEW_HOST": "a1b2c3d4e5f6.example.org",
    "PREVIEW_ACCOUNTS": f"tester {HASH};reviewer {HASH}",
    "API_PORT": "8791",
}


def test_render_fills_every_placeholder_and_drops_comments():
    out = site.render(ENV)
    assert "${" not in out and "#" not in out
    assert out.startswith("a1b2c3d4e5f6.example.org {")
    assert site.leaks(out) == []
    assert "\t\ttester $2a$14$" in out and "\t\treviewer $2a$14$" in out
    assert "\t@gated path *\n" in out and "X-Robots-Tag" in out
    assert "Strict-Transport-Security" not in out
    with pytest.raises(SystemExit):
        site.render({"PREVIEW_HOST": "x"})


PUBLIC = {"PREVIEW_HOST": "example.org", "SITE_MODE": "public", "REVIEW_ACCOUNTS": f"joe {HASH}"}


def test_one_template_two_modes():
    """Public: the same file, with the password on the review paths only, HSTS instead of
    X-Robots-Tag, and the www name's redirect after it; the preview's accounts are not
    needed, the review's are."""
    out = site.render(PUBLIC)
    assert "\t@gated path /revue /revue.html /api/review/*\n" in out
    assert "\t\tjoe $2a$14$" in out and "X-Robots-Tag" not in out
    assert '\t\tStrict-Transport-Security "max-age=31536000"\n' in out
    www = ("\nwww.example.org {\n\theader {\n\t\t-Server\n"
           '\t\tStrict-Transport-Security "max-age=31536000"\n\t}\n'
           "\tredir https://example.org{uri} 308\n}\n")  # fmt: skip
    assert out.endswith("}\n" + www) and out.count("www.") == 1
    # Line for line, with the same accounts: only what the password covers and one header,
    # then the www block (none in the preview: its random host has no www).
    pre = site.render({**PUBLIC, "SITE_MODE": "preview", "PREVIEW_ACCOUNTS": f"joe {HASH}"})
    assert "www." not in pre and "redir" not in pre and pre.endswith("\t}\n}\n")
    out = out.removesuffix(www)
    diff = [(a, b) for a, b in zip(pre.splitlines(), out.splitlines(), strict=True) if a != b]
    assert diff == [('\t\tX-Robots-Tag "noindex, nofollow, noarchive"',
                     '\t\tStrict-Transport-Security "max-age=31536000"'),
                    ("\t@gated path *",
                     "\t@gated path /revue /revue.html /api/review/*")]  # fmt: skip
    for change, message in (({"REVIEW_ACCOUNTS": None}, "missing environment: REVIEW_ACCOUNTS"),
                            ({"REVIEW_ACCOUNTS": "a/b x"}, "REVIEW_ACCOUNTS: expected"),
                            ({"SITE_MODE": "open"}, "SITE_MODE: preview or public")):  # fmt: skip
        env = {k: v for k, v in {**PUBLIC, **change}.items() if v is not None}
        with pytest.raises(SystemExit, match=message):
            site.render(env)


@pytest.mark.parametrize(
    "change",
    [{"PREVIEW_ACCOUNTS": "bad name here"},
     {"PREVIEW_ACCOUNTS": f"x/y {HASH}"}, {"API_PORT": "80; evil"}],
)  # fmt: skip
def test_render_refuses_bad_accounts_and_ports(change):
    with pytest.raises(SystemExit):
        site.render({**ENV, **change})


def test_leaks_are_case_insensitive(monkeypatch):
    monkeypatch.delenv("SITE_FORBIDDEN", raising=False)
    assert site.leaks("<title>La-Carte</title>") == ["la-carte"]
    assert site.leaks("x-by: Example-Brand.test") == []
    monkeypatch.setenv("SITE_FORBIDDEN", " Example-Brand , other-word,")
    assert site.leaks("x-by: Example-Brand.test") == ["example-brand"]
    assert site.leaks("401 Unauthorized") == []


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Echo(http.server.BaseHTTPRequestHandler):
    """Stands for the API: answers with the headers it received (and the length of the
    body it read)."""

    def do_GET(self):  # noqa: N802
        got = dict(self.headers.items())
        if self.command == "POST":
            got["read"] = str(len(self.rfile.read(int(self.headers.get("Content-Length", 0)))))
        body = json.dumps(got).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    do_POST = do_GET  # noqa: N815

    def log_message(self, *_args):
        pass


@pytest.fixture
def caddy_server(tmp_path):
    yield from serve(tmp_path, "preview")


@pytest.fixture
def public_server(tmp_path):
    yield from serve(tmp_path, "public")


@pytest.fixture
def named_server(tmp_path):
    """The public site under a host name (site.test), asked on 127.0.0.1 with Host headers:
    the bare name and its www are two sites of the file."""
    yield from serve(tmp_path, "public", "site.test")


def serve(tmp_path, mode, name="127.0.0.1"):
    """The rendered site imported by a Caddyfile that has its own global options and
    another site, as on the shared server; served over plain HTTP on a local port, with
    an echo server in the API's place."""
    if CADDY is None:
        pytest.fail("REQUIRE_CADDY is set but caddy is not installed")
    port = free_port()
    web = tmp_path / "web"
    (web / "tiles").mkdir(parents=True)
    (web / "index.html").write_text("<title>la-carte</title>example-brand")
    (web / "revue.html").write_text("<title>revue</title>")
    (web / "registre.html").write_text("<title>registre</title>")
    (web / "data" / "registre").mkdir(parents=True)
    (web / "data" / "registre" / "index.json").write_text('{"v": 1}')
    (web / "tiles" / "meta.json").write_text('{"name": "la-carte"}')
    (web / "tiles" / "streets.pmtiles").write_bytes(b"PM" + bytes(62))
    (web / "assets").mkdir()
    (web / "assets" / "main-0123abcd.js").write_text("export {};")
    # bcrypt's lowest cost: each request checks the password, and the default cost (14)
    # took over the 5 s of a request on a loaded machine (a test failed one run in six).
    hashed = subprocess.run(
        [CADDY, "hash-password", "--plaintext", "secret", "--bcrypt-cost", "4"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    echo = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Echo)
    threading.Thread(target=echo.serve_forever, daemon=True).start()
    env = {**ENV, "PREVIEW_HOST": f"http://{name}:{port}", "PREVIEW_ROOT": str(web),
           "PREVIEW_ACCOUNTS": f"tester {hashed};reviewer {hashed}",
           "SITE_MODE": mode, "REVIEW_ACCOUNTS": f"reviewer {hashed}",
           "API_PORT": str(echo.server_address[1])}  # fmt: skip
    (tmp_path / "sites.d").mkdir()
    (tmp_path / "sites.d" / "preview.caddy").write_text(site.render(env))
    # Two free ports picked one after the other can be the same one: Caddy then fails to
    # bind the second site ("address already in use", seen once).
    other = free_port()
    while other == port:
        other = free_port()
    (tmp_path / "Caddyfile").write_text(
        "{\n\tadmin off\n\tauto_https off\n}\n\n"
        f'http://127.0.0.1:{other} {{\n\trespond "other site"\n}}\n\n'
        "import sites.d/*.caddy\n"
    )
    proc = subprocess.Popen(
        [CADDY, "run", "--adapter", "caddyfile", "--config", str(tmp_path / "Caddyfile")],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    base = f"http://{name}:{port}"
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.1).close()
            break
        except OSError:
            if proc.poll() is not None:
                pytest.fail(proc.stderr.read().decode())
            time.sleep(0.05)
    yield base
    proc.terminate()
    proc.wait(timeout=10)
    echo.shutdown()


def authed(url: str, who: str | None = "tester", headers: dict | None = None,
           data: bytes | None = None):  # fmt: skip
    """A request with the password of `who` (None: without it)."""
    token = base64.b64encode(f"{who}:secret".encode()).decode()
    auth = {"Authorization": f"Basic {token}"} if who else {}
    req = urllib.request.Request(url, data=data, headers={**auth, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:  # noqa: S310
            return r.status, dict(r.headers.items()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()


@needs_caddy
def test_anonymous_requests_get_a_generic_401(caddy_server):
    assert site.check(caddy_server) == []


@needs_caddy
def test_the_password_opens_the_preview(caddy_server):
    status, headers, body = authed(caddy_server + "/")
    assert status == 200 and b"la-carte" in body
    assert "Server" not in headers
    assert headers["X-Robots-Tag"] == "noindex, nofollow, noarchive"
    assert "Strict-Transport-Security" not in headers
    for name, value in site.HEADERS.items():
        assert headers[name] == value, name


@needs_caddy
def test_public_mode_is_open_indexable_and_keeps_the_review_behind_a_password(public_server):
    """No password for the site, its tiles and its API; /revue and /api/review/* behind
    their own; the review page's sign-in (POST /api/session) outside it."""
    assert site.check(public_server, mode="public", resolve=lambda *_: ["unused"]) == []
    status, headers, body = authed(public_server + "/", None)
    assert status == 200 and b"la-carte" in body and "X-Robots-Tag" not in headers
    assert headers["Strict-Transport-Security"] == "max-age=31536000"
    status, _, body = authed(public_server + "/api/session", None, data=b"{}")
    assert status == 200 and "authorization" not in body.decode().lower()
    for path in ("/revue", "/revue.html", "/api/review/queue"):
        assert authed(public_server + path, None)[0] == 401, path
        status, _, body = authed(public_server + path, "reviewer")
        assert status == 200, path
        assert "authorization" not in body.decode().lower()  # the gate's stays at the gate
    # The preview's testers are not the review's accounts.
    assert authed(public_server + "/revue", "tester")[0] == 401


@needs_caddy
def test_the_public_check_sees_a_password_asked_outside_the_review(caddy_server):
    """The preview served where the public site is expected: every path asks a password."""
    problems = site.check(caddy_server, mode="public")
    assert "/: status 401, a password asked outside /revue" in problems
    assert "/api/session: status 401, a password asked outside /revue" in problems
    assert not [p for p in problems if p.startswith(("/revue", "/api/review"))], problems


def test_the_public_check_refuses_an_aaaa_record_and_another_a_record():
    """IPv4 only, on the site's address, for the host and its www: the resolver is the
    test's (no network)."""
    seen = []

    def resolve(host, family):
        seen.append((host, family))
        return ["2001:db8::1"] if family == socket.AF_INET6 else ["192.0.2.7"]

    problems = site.dns_problems("example.org", "198.51.100.4", resolve)
    assert problems == [
        "DNS: AAAA record(s) for example.org: 2001:db8::1",
        "DNS: A record(s) for example.org: ['192.0.2.7'], expected ['198.51.100.4']",
        "DNS: AAAA record(s) for www.example.org: 2001:db8::1",
        "DNS: A record(s) for www.example.org: ['192.0.2.7'], expected ['198.51.100.4']",
    ]
    assert seen == [(name, family) for name in ("example.org", "www.example.org")
                    for family in (socket.AF_INET6, socket.AF_INET)]  # fmt: skip
    ok = site.dns_problems("example.org", "192.0.2.7",
                           lambda h, f: [] if f == socket.AF_INET6 else ["192.0.2.7"])  # fmt: skip
    assert ok == []
    # www missing (no A record), or on another address: both seen.
    only = {"example.org": ["192.0.2.7"]}
    assert site.dns_problems("example.org", "192.0.2.7",
                             lambda h, f: only.get(h, []) if f == socket.AF_INET else []) == [
        "DNS: A record(s) for www.example.org: [], expected ['192.0.2.7']"
    ]  # fmt: skip
    assert site.dns_problems("example.org", None, lambda h, f: []) == []


def local(port: int):
    """`fetch` for site.check: the request goes to the local Caddy, the URL's host name
    in the Host header (no DNS)."""

    def fetch(url, method="GET"):
        parts = urlsplit(url)
        return site.anonymous(parts._replace(netloc=f"127.0.0.1:{port}").geturl(), method,
                              host=parts.netloc)  # fmt: skip

    return fetch


@needs_caddy
def test_www_redirects_for_good_to_the_bare_host_with_path_and_query(named_server):
    """www.<host>: 308 to the same path and query on the bare host, nothing else said,
    never followed by the check; the bare host itself answers. The whole public check
    passes through the same Caddy with a resolver that has both names on SITE_IP."""
    port = urlsplit(named_server).port
    fetch = local(port)
    www = named_server.replace("site.test", "www.site.test")
    status, headers, body = fetch(www + "/a/b?page=sources&x=%C3%A9")
    assert status == 308 and body == b""
    assert headers["Location"] == named_server + "/a/b?page=sources&x=%C3%A9"
    assert "Server" not in headers
    assert headers["Strict-Transport-Security"] == "max-age=31536000"
    status, _, body = fetch(www + "/api/contributions", "POST")  # 308: the method stays
    assert status == 308 and _["Location"] == named_server + "/api/contributions"
    assert fetch(named_server + "/")[0] == 200
    assert site.www_problems(named_server, fetch) == []
    on_site = lambda host, family: ["192.0.2.7"] if family == socket.AF_INET else []  # noqa: E731
    assert site.check(named_server, mode="public", site_ip="192.0.2.7", resolve=on_site,
                      fetch=fetch) == []  # fmt: skip


def test_the_www_check_sees_a_temporary_redirect_another_target_or_no_answer():
    def answer(status, location, server=None):
        headers = {"Location": location, **({"Server": server} if server else {})}
        return lambda url, method="GET": (status, headers, b"")

    base = "https://example.org"
    good = base + site.WWW_PROBE
    assert site.www_problems(base, answer(301, good)) == []
    assert site.www_problems(base, answer(302, good, "Caddy")) == [
        "www: status 302, expected a permanent redirect (301, 308)",
        "www: Server header 'Caddy'",
    ]
    assert site.www_problems(base, answer(308, "https://example.org/")) == [
        f"www: Location 'https://example.org/', expected {good!r}"
    ]

    def down(url, method="GET"):
        raise urllib.error.URLError("certificate verify failed")

    assert site.www_problems(base, down) == [
        "www: https://www.example.org unreachable: <urlopen error certificate verify failed>"
    ]


@needs_caddy
def test_a_body_over_the_cap_never_reaches_the_api(public_server):
    """request_body: 256 KB at most (the largest request, a publication of 1000 ids, is
    about 50 kB): 413, empty, no Server header; under the cap the API reads it whole."""
    status, headers, body = authed(public_server + "/api/contributions", None, data=b"x" * 200_000)
    assert status == 200 and json.loads(body)["read"] == "200000"
    status, headers, body = authed(public_server + "/api/contributions", None, data=b"x" * 300_000)
    assert (status, body) == (413, b"") and "Server" not in headers


@needs_caddy
def test_the_api_gets_no_author_and_no_client_address(caddy_server):
    """The gate's user is nobody's author any more, and an X-Author a client sends is
    dropped; the session cookie reaches the API."""
    sent = {"X-Forwarded-For": "203.0.113.7", "X-Real-IP": "203.0.113.7",
            "Forwarded": "for=203.0.113.7", "X-Author": "someone-else",
            "Cookie": "__Host-session=abc"}  # fmt: skip
    status, _, body = authed(caddy_server + "/api/anything", headers=sent)
    assert status == 200
    got = {k.lower(): v for k, v in json.loads(body).items()}
    assert "x-author" not in got and "tester" not in body.decode()
    assert got["cookie"] == "__Host-session=abc"
    for name in ("x-forwarded-for", "x-real-ip", "forwarded", "x-forwarded-proto",
                 "x-forwarded-host", "authorization"):  # fmt: skip
        assert name not in got, name  # the gate's credentials stay at the gate
    assert "203.0.113.7" not in body.decode()


@needs_caddy
def test_the_review_page_opens_past_the_gate(caddy_server):
    """No 404 by user any more: the page asks the API, which answers the reviewer role
    only (403), and says « Réservé aux relecteurs »."""
    for path in ("/revue", "/revue.html"):
        for who in ("tester", "reviewer"):
            status, _, body = authed(caddy_server + path, who)
            assert status == 200 and b"revue" in body


def test_the_review_page_and_the_register_alone_have_a_content_security_policy():
    """Both modes render the review's on /revue and /revue.html, the register's on every
    /registre path; the check wants each there (on the 401 too) and none elsewhere. The
    register's is the stricter: no inline style at all."""
    line = (f'\t@review path /revue /revue.html\n'
            f'\theader @review Content-Security-Policy "{site.REVIEW_CSP}"\n')  # fmt: skip
    assert line in site.render(ENV) and line in site.render(PUBLIC)
    line = (f'\t@registre path /registre /registre/* /registre.html\n'
            f'\theader @registre Content-Security-Policy "{site.REGISTRE_CSP}"\n')  # fmt: skip
    assert line in site.render(ENV) and line in site.render(PUBLIC)
    assert site.render(ENV).count("Content-Security-Policy") == 2
    assert "script-src 'self';" in site.REVIEW_CSP and "'unsafe-eval'" not in site.REVIEW_CSP
    assert "style-src 'self';" in site.REGISTRE_CSP and "unsafe" not in site.REGISTRE_CSP
    bare = {k.lower(): v for k, v in site.HEADERS.items()}
    assert site.header_problems("preview", "/revue", 401, {}) == [
        "/revue: Content-Security-Policy None, expected the review's"]  # fmt: skip
    csp = {"content-security-policy": site.REVIEW_CSP}
    assert site.header_problems("preview", "/revue.html", 401, csp) == []
    assert site.header_problems("public", "/", 200, {**bare, **csp,
                                "strict-transport-security": "max-age=31536000"}) == [
        f"/: Content-Security-Policy {site.REVIEW_CSP!r} outside /revue and /registre"]  # fmt: skip
    assert site.header_problems("preview", "/registre/commune/69283", 401, csp) == [
        f"/registre/commune/69283: Content-Security-Policy {site.REVIEW_CSP!r},"
        " expected the register's"]  # fmt: skip
    ours = {"content-security-policy": site.REGISTRE_CSP}
    assert site.header_problems("preview", "/registre", 401, ours) == []
    assert site.registre_page("/registre/") and not site.registre_page("/registres")


@needs_caddy
@pytest.mark.parametrize("server", ["caddy_server", "public_server"])
def test_the_review_page_is_served_with_its_policy(request, server):
    base = request.getfixturevalue(server)
    for path in ("/revue", "/revue.html"):
        status, headers, _ = authed(base + path, "reviewer")
        assert status == 200 and headers["Content-Security-Policy"] == site.REVIEW_CSP
        status, headers, _ = authed(base + path, None)  # the gate's 401 carries it
        assert status == 401 and headers["Content-Security-Policy"] == site.REVIEW_CSP
    for path in ("/registre/", "/registre/commune/69283/documents"):
        status, headers, body = authed(base + path, "reviewer")
        assert status == 200 and b"registre" in body, path
        assert headers["Content-Security-Policy"] == site.REGISTRE_CSP, path
    for path in ("/", "/tiles/meta.json", "/data/registre/index.json", "/api/review/queue"):
        _, headers, _ = authed(base + path, "reviewer")
        assert "Content-Security-Policy" not in headers, path


@needs_caddy
def test_cache_headers(caddy_server):
    """Hashed assets kept a year, the pages and the build's JSON asked again each time
    (no-cache: a deploy shows at once), the tiles a day; all private (behind the gate)."""
    want = {
        "/assets/main-0123abcd.js": "private, max-age=31536000, immutable",
        "/": "no-cache",
        "/revue": "no-cache",
        "/registre/commune/69283": "no-cache",
        "/data/registre/index.json": "no-cache",
        "/tiles/meta.json": "no-cache",
        "/tiles/streets.pmtiles": "private, max-age=86400",
    }
    for path, cache in want.items():
        status, headers, _ = authed(caddy_server + path)
        assert status == 200, path
        assert headers.get("Cache-Control") == cache, path
        # Without the password: the bare 401, never kept.
        try:
            urllib.request.urlopen(caddy_server + path, timeout=5)  # noqa: S310
            raise AssertionError(path)
        except urllib.error.HTTPError as e:
            assert e.code == 401 and "Cache-Control" not in e.headers, path


@needs_caddy
def test_a_build_mismatch_is_a_problem(caddy_server):
    assert site.check(caddy_server, ("ci-1-aaaa", "ci-1-aaaa")) == []
    assert site.check(caddy_server, ("ci-1-aaaa", "ci-2-bbbb")) == [
        "build: tiles/meta.json 'ci-1-aaaa' != database 'ci-2-bbbb'"
    ]


# Fictitious, shaped as OSM shows them (the key: 32 bytes in base64); never real ones.
# Sign-in on OSM's test server (OSM_LOGIN_SERVER dev, the default): the live client is
# needed only with OSM_LOGIN_SERVER=live.
OSM_LIVE = {
    "OSM_LIVE_CLIENT_ID": "fake-live-id_0123456789",
    "OSM_LIVE_CLIENT_SECRET": "fake-live-secret-not-a-secret",
}
OSM_ENV = {
    "OSM_DEV_CLIENT_ID": "fake-dev-id_0123456789",
    "OSM_DEV_CLIENT_SECRET": "fake-dev-secret-not-a-secret",
    "OSM_TOKEN_KEY": base64.b64encode(b"fictitious key, thirty-two bytes").decode(),
}


def deploy_env(**changes) -> dict:
    # The machine's lock (lacarte/lock.py) in the tests' own place (conftest.py).
    env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"],
           "LACARTE_LOCK": os.environ["LACARTE_LOCK"],
           "DEPLOY_TARGET": "nobody@invalid.test", "PREVIEW_HOST": "x.invalid.test",
           "TEST_AUTHORS": "", "STAGE": "", "CONTACT_EMAIL": "contact@example.org",
           **OSM_ENV}  # fmt: skip
    env.update(changes)
    return {k: v for k, v in env.items() if v is not None}


def dry_deploy(env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(ROOT / "deploy" / "deploy.sh"), "--dry-run"], env=env,
                          capture_output=True, text=True, timeout=120)  # fmt: skip


@pytest.mark.parametrize("missing", ["TEST_AUTHORS", "STAGE", "CONTACT_EMAIL", *OSM_ENV])
def test_deploy_refuses_to_run_without_test_authors_stage_or_contact(missing):
    """deploy.sh stops at once when TEST_AUTHORS or STAGE is not defined (an empty value
    is allowed), or CONTACT_EMAIL or one of the OpenStreetMap settings is empty or
    missing: before anything is built, sent or asked over ssh."""
    r = dry_deploy(deploy_env(**{missing: None}))
    assert r.returncode != 0 and f"set {missing}" in r.stderr, r.stderr
    if missing in OSM_ENV:
        assert dry_deploy(deploy_env(**{missing: ""})).stderr == r.stderr


def test_deploy_accepts_empty_test_authors_and_stage():
    """Both defined but empty: the guard lets it go on (it then stops on the site file's
    own missing accounts, still before any network)."""
    r = dry_deploy(deploy_env())
    assert r.returncode != 0
    assert "set TEST_AUTHORS" not in r.stderr and "set STAGE" not in r.stderr, r.stderr
    assert "OSM" not in r.stderr and "refused" not in r.stderr, r.stderr


def test_deploy_takes_stage_public_and_the_reset_refuses_it():
    """STAGE=public (the public site) goes past deploy.sh's guard; the reset of the
    contributions refuses it before asking the database anything."""
    r = dry_deploy(deploy_env(STAGE="public"))
    assert "set STAGE" not in r.stderr and "refused" not in r.stderr, r.stderr
    assert "missing environment: PREVIEW_ACCOUNTS" in r.stderr  # the next guard, no network
    reset = subprocess.run(["bash", str(ROOT / "db" / "reset_contributions.sh"), "--dry-run",
                            "idf", "dbname=never_asked"], env={**os.environ, "STAGE": "public"},
                           capture_output=True, text=True)  # fmt: skip
    assert reset.returncode == 1
    assert reset.stderr == "refused: STAGE is 'public', not preview (deploy.env)\n"


def test_deploy_builds_with_the_contact_and_checks_a_route_without_session():
    """The address « Me contacter » writes to is built into the page (VITE_CONTACT_EMAIL),
    never in the repository, as the share tags' host (VITE_SITE_URL, from PREVIEW_HOST); the
    API's health is asked on the proposals, which answer 200
    without a session (no X-Author: nobody is the author by a header any more)."""
    text = (ROOT / "deploy" / "deploy.sh").read_text()
    assert 'VITE_CONTACT_EMAIL="$CONTACT_EMAIL" VITE_SITE_URL="https://$PREVIEW_HOST"' in text
    assert "npm --prefix web run build" in text
    assert "/api/proposals?bbox=" in text and "X-Author" not in text
    example = (ROOT / "deploy" / "deploy.env.example").read_text()
    assert "CONTACT_EMAIL=\n" in example and "REVIEW_USER" not in example
    assert "REVIEW_USER" not in (ROOT / "deploy" / "preview.caddy").read_text()


def test_deploy_checks_the_basemap_id_before_anything_is_built():
    """The served basemap made by the current code (`lacarte basemap check`, its own id since
    2026-10-23), checked before the tables are exported, the site built or anything sent."""
    text = (ROOT / "deploy" / "deploy.sh").read_text()
    check = text.index('uv run lacarte basemap check "data/basemap/$REGION.pmtiles"')
    assert check < text.index("uv run lacarte db load") < text.index("npm --prefix web run build")
    assert check < text.index("rsync")


# --- sign in with OpenStreetMap: deploy/osm_env.sh, the unit's EnvironmentFile ----------------

OSM_ENV_SH = ROOT / "deploy" / "osm_env.sh"


def osm_env(*argv, env: dict, path: str | None = None) -> subprocess.CompletedProcess:
    full = {"PATH": path or os.environ["PATH"], "HOME": os.environ["HOME"], **env}
    return subprocess.run(["bash", str(OSM_ENV_SH), *argv], env=full, capture_output=True,
                          text=True, timeout=30)  # fmt: skip


@pytest.mark.parametrize(("changes", "message"), [
    ({"OSM_WRITE_SERVER": "live"}, "OSM_WRITE_SERVER is dev (the live server is /revue's"),
    ({"OSM_WRITE_SERVER": "live", "OSM_WRITE_LIVE_APPROVED": "yes", **OSM_LIVE},
     "OSM_WRITE_SERVER is dev"),
    ({"OSM_WRITE_SERVER": "production"}, "OSM_WRITE_SERVER is dev"),
    ({"OSM_LIVE_CLIENT_ID": "only-the-id"}, "set OSM_LIVE_CLIENT_SECRET"),
    ({"OSM_LOGIN_SERVER": "live", **OSM_LIVE, "OSM_LIVE_CLIENT_SECRET": "with space$and'quote"},
     "OSM_LIVE_CLIENT_SECRET holds characters other than"),
    ({"OSM_LOGIN_SERVER": "live"}, "set OSM_LIVE_CLIENT_ID"),
    ({"OSM_LOGIN_SERVER": "beta"}, "OSM_LOGIN_SERVER is dev or live"),
    ({"OSM_DEV_CLIENT_ID": "abc\nOSM_WRITE_SERVER=live"}, "OSM_DEV_CLIENT_ID holds characters"),
    ({"OSM_TOKEN_KEY": "not base64!"}, "OSM_TOKEN_KEY is not base64"),
])  # fmt: skip
def test_the_osm_settings_are_refused_when_unsafe(changes, message):
    """The write server is dev (the live one is /revue's switch, migration 022); a live
    client half given is refused; a value systemd would read otherwise than written is
    refused, the refusal never quoting it. deploy.sh stops on them before anything is built
    (a dry run)."""
    r = osm_env("check", env={**OSM_ENV, **changes})
    assert r.returncode == 1 and message in r.stderr, r.stderr
    assert not [v for v in changes.values() if len(v) > 4 and v in r.stderr + r.stdout]
    d = dry_deploy(deploy_env(**changes))
    assert d.returncode != 0 and message in d.stderr, d.stderr


@pytest.mark.parametrize("changes", [{}, {"OSM_WRITE_SERVER": "dev"},
                                     {"OSM_LOGIN_SERVER": "live", **OSM_LIVE},
                                     OSM_LIVE])  # fmt: skip
def test_the_osm_settings_pass(changes):
    r = osm_env("check", env={**OSM_ENV, **changes})
    assert (r.returncode, r.stdout, r.stderr) == (0, "", "")


def test_the_old_live_approval_is_said_unread_and_never_written():
    r = osm_env("check", env={**OSM_ENV, "OSM_WRITE_LIVE_APPROVED": "yes"})
    assert r.returncode == 0 and "OSM_WRITE_LIVE_APPROVED is no longer read" in r.stderr


@pytest.fixture
def fake_osm():
    import fakeosm

    f = fakeosm.FakeOsm()
    yield f
    f.close()


def test_the_probe_refuses_a_client_osm_does_not_know_without_showing_it(fake_osm):
    """2026-10-11: the deployed secret was refused by OSM's test server (invalid_client) and
    every sign-in failed; the deploy now asks first. A code no one was given, with the right
    client, is refused as a code: the deploy goes on."""
    import fakeosm

    good = {**OSM_ENV, "OSM_DEV_URL": fake_osm.url, "OSM_DEV_CLIENT_ID": fakeosm.CLIENT_ID,
            "OSM_DEV_CLIENT_SECRET": fakeosm.CLIENT_SECRET}  # fmt: skip
    r = osm_env("probe", env=good)
    assert (r.returncode, r.stdout, r.stderr) == (0, "OSM_DEV client known to OSM\n", "")
    secret = fakeosm.CLIENT_SECRET[:-1]  # a character lost when copied
    r = osm_env("probe", env={**good, "OSM_DEV_CLIENT_SECRET": secret})
    assert r.returncode == 1 and "invalid_client" in r.stderr, r.stderr
    assert secret not in r.stdout + r.stderr and fakeosm.CLIENT_ID not in r.stdout + r.stderr
    assert [t["code"] for t in fake_osm.tokens] == ["deploy-probe", "deploy-probe"]


def test_the_probe_concludes_only_on_a_refused_code(fake_osm):
    """Review finding: OSM in maintenance (5xx) answers nothing about the client: a warning,
    never « known »."""
    import fakeosm

    fake_osm.token_status = 503
    env = {**OSM_ENV, "OSM_DEV_URL": fake_osm.url, "OSM_DEV_CLIENT_ID": fakeosm.CLIENT_ID,
           "OSM_DEV_CLIENT_SECRET": fakeosm.CLIENT_SECRET}  # fmt: skip
    r = osm_env("probe", env=env)
    assert r.returncode == 0 and "known" not in r.stdout, r.stdout
    assert "OSM answered 503, client not checked" in r.stderr, r.stderr


def test_the_probe_only_warns_when_osm_does_not_answer():
    r = osm_env("probe", env={**OSM_ENV, "OSM_DEV_URL": "http://127.0.0.1:9"})
    assert r.returncode == 0 and "no answer from OSM" in r.stderr, r.stderr


@pytest.fixture
def fake_ssh(tmp_path):
    """An `ssh` that runs the remote command here (bash -c, its stdin passed on) and keeps
    its command line: what deploy.sh would run on the server, on a temporary folder."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    argv = tmp_path / "ssh-argv"
    script = f"#!/usr/bin/env bash\nprintf '%s\\n' \"$@\" >> '{argv}'\nshift\nexec bash -c \"$1\"\n"
    (bin_dir / "ssh").write_text(script)
    (bin_dir / "ssh").chmod(0o755)
    return f"{bin_dir}:{os.environ['PATH']}", argv


def test_the_osm_env_file_is_written_600_through_stdin_and_never_shown(tmp_path, fake_ssh):
    path, argv = fake_ssh
    dest = tmp_path / "api" / "osm.env"
    dest.parent.mkdir()
    dest.write_text("OLD=1\n")
    dest.chmod(0o644)  # a file left readable before: replaced by a 600 one
    env = {**OSM_ENV, **OSM_LIVE, "DEPLOY_TARGET": "deploy@vps.invalid",
           "OSM_WRITE_LIVE_APPROVED": "yes"}  # fmt: skip
    r = osm_env("write", str(dest), env=env, path=path)
    assert r.returncode == 0, r.stderr
    # The live client given: written (/revue may switch writing to it), the old approval not.
    assert dest.read_text() == "".join(f"{k}={v}\n" for k, v in {**OSM_ENV, **OSM_LIVE}.items()) + (
        "OSM_LOGIN_SERVER=dev\nOSM_WRITE_SERVER=dev\n")  # fmt: skip
    assert stat.S_IMODE(dest.stat().st_mode) == 0o600
    assert not (tmp_path / "api" / "osm.env.new").exists()
    sent = argv.read_text()
    assert sent.startswith("deploy@vps.invalid\n") and "umask 077" in sent
    for value in {**OSM_ENV, **OSM_LIVE}.values():  # never in ssh's command line nor printed
        assert value not in sent and value not in r.stdout + r.stderr
    assert r.stdout == "osm.env written (values not shown)\n"
    # Without OSM_WRITE_SERVER: dev, and no approval line.
    env = {**OSM_ENV, "DEPLOY_TARGET": "deploy@vps.invalid"}
    assert osm_env("write", str(dest), env=env, path=path).returncode == 0
    assert dest.read_text().endswith(f"OSM_TOKEN_KEY={OSM_ENV['OSM_TOKEN_KEY']}\n"
                                     "OSM_LOGIN_SERVER=dev\nOSM_WRITE_SERVER=dev\n")  # fmt: skip
    # Sign-in on the live server: its client written too.
    env = {**OSM_ENV, **OSM_LIVE, "OSM_LOGIN_SERVER": "live", "DEPLOY_TARGET": "deploy@vps.invalid"}
    assert osm_env("write", str(dest), env=env, path=path).returncode == 0
    assert (
        "OSM_LIVE_CLIENT_SECRET=" in dest.read_text()
        and "OSM_LOGIN_SERVER=live" in dest.read_text()
    )


def test_the_osm_env_is_not_written_when_a_setting_is_refused(tmp_path, fake_ssh):
    path, argv = fake_ssh
    env = {**OSM_ENV, "DEPLOY_TARGET": "deploy@vps.invalid", "OSM_WRITE_SERVER": "live"}
    r = osm_env("write", str(tmp_path / "osm.env"), env=env, path=path)
    assert r.returncode == 1 and not argv.exists() and not (tmp_path / "osm.env").exists()


def test_deploy_writes_the_osm_env_before_the_api_restarts():
    text = (ROOT / "deploy" / "deploy.sh").read_text()
    check, write = text.index("deploy/osm_env.sh check"), text.index("deploy/osm_env.sh write")
    assert check < text.index("deploy/site.py render")  # before anything is built
    assert text.index('if [ -n "$DRY" ]') < write < text.index("systemctl restart preview-api")
    assert 'deploy/osm_env.sh write "$API/osm.env"' in text
    assert "$OSM_" not in text  # deploy.sh never handles a value itself
    example = (ROOT / "deploy" / "deploy.env.example").read_text()
    for name in (*OSM_ENV, "OSM_WRITE_SERVER=dev"):
        assert f"\n{name}" in example, name
    assert "\nOSM_WRITE_LIVE_APPROVED" not in example  # no longer read (migration 022)


# --- the API's site settings: deploy/site_env.sh, SITE_MODE ----------------------------------

SITE_ENV_SH = ROOT / "deploy" / "site_env.sh"
# Every character systemd's double quotes treat specially, an apostrophe, accents.
IDENTITY = """Jeanne d'Exemple "J." $HOME `id` \\ 12 rue de l'Essai, 75000 Ville"""


def site_env(*argv, env: dict, path: str | None = None) -> subprocess.CompletedProcess:
    full = {"PATH": path or os.environ["PATH"], "HOME": os.environ["HOME"], **env}
    return subprocess.run(["bash", str(SITE_ENV_SH), *argv], env=full, capture_output=True,
                          text=True, timeout=30)  # fmt: skip


@pytest.mark.parametrize(("changes", "message"), [
    ({"PUBLISHER_IDENTITY": "Name\nCONTRIBUTIONS_OPEN=yes"}, "PUBLISHER_IDENTITY holds a control"),
    ({"PUBLISHER_IDENTITY": "x" * 201}, "PUBLISHER_IDENTITY is longer than 200"),
])  # fmt: skip
def test_the_site_settings_are_refused_when_unsafe(changes, message):
    """A newline would write a second setting; deploy.sh stops on them before anything is
    built (a dry run)."""
    r = site_env("check", env=changes)
    assert r.returncode == 1 and message in r.stderr, r.stderr
    d = dry_deploy(deploy_env(**changes))
    assert d.returncode != 0 and message in d.stderr, d.stderr


def test_the_site_env_is_written_600_quoted_for_systemd_and_never_shown(tmp_path, fake_ssh):
    """Default: no identity. A free-text identity is written in double quotes with
    systemd's escapes (systemd.exec(5), EnvironmentFile=), read back as given (checked by
    systemd itself in the bootstrap rehearsal). Contributions open or closed are no longer
    written (lot 2: the database's); CONTRIBUTIONS_OPEN, still set, is said ignored."""
    path, argv = fake_ssh
    dest = tmp_path / "site.env"
    env = {"DEPLOY_TARGET": "deploy@vps.invalid"}
    r = site_env("write", str(dest), env=env, path=path)
    assert (r.returncode, r.stdout) == (0, "site.env written (values not shown)\n"), r.stderr
    assert dest.read_text() == 'PUBLISHER_IDENTITY=""\n' and r.stderr == ""
    assert stat.S_IMODE(dest.stat().st_mode) == 0o600
    env |= {"CONTRIBUTIONS_OPEN": "no", "PUBLISHER_IDENTITY": IDENTITY}
    r = site_env("write", str(dest), env=env, path=path)
    assert r.returncode == 0, r.stderr
    assert "CONTRIBUTIONS_OPEN is ignored" in r.stderr
    assert dest.read_text() == (
        """PUBLISHER_IDENTITY="Jeanne d'Exemple \\"J.\\" \\$HOME \\`id\\` \\\\ 12 rue de l'Essai,"""
        ' 75000 Ville"\n'
    )
    assert IDENTITY not in argv.read_text() and "Jeanne" not in r.stdout + r.stderr
    # What a POSIX shell's double quotes give back is the identity, unchanged.
    value = dest.read_text().splitlines()[0].removeprefix("PUBLISHER_IDENTITY=")
    back = subprocess.run(["bash", "-c", f"printf %s {value}"], capture_output=True, text=True)
    assert back.stdout == IDENTITY


@pytest.mark.parametrize(("changes", "message"), [
    ({"SITE_MODE": "open"}, "SITE_MODE is preview or public"),
    ({"SITE_MODE": "public"}, "set SITE_IP"),
    ({"SITE_MODE": "public", "SITE_IP": "2001:db8::1"}, "SITE_IP is an IPv4 address"),
    ({"SITE_MODE": "public", "SITE_IP": "192.0.2.7"}, "missing environment: REVIEW_ACCOUNTS"),
])  # fmt: skip
def test_deploy_refuses_a_public_mode_without_its_address_or_review_password(changes, message):
    r = dry_deploy(deploy_env(**changes))
    assert r.returncode != 0 and message in r.stderr, r.stderr


def test_deploy_writes_the_site_env_before_the_api_restarts():
    text = (ROOT / "deploy" / "deploy.sh").read_text()
    check, write = text.index("deploy/site_env.sh check"), text.index("deploy/site_env.sh write")
    assert check < text.index("deploy/site.py render")
    assert text.index('if [ -n "$DRY" ]') < write < text.index("systemctl restart preview-api")
    assert 'deploy/site_env.sh write "$API/site.env"' in text
    example = (ROOT / "deploy" / "deploy.env.example").read_text()
    for name in ("SITE_MODE=preview", "SITE_IP=\n", "REVIEW_ACCOUNTS=''",
                 "PUBLISHER_IDENTITY=\n"):  # fmt: skip
        assert f"\n{name}" in example, name
    assert "\nCONTRIBUTIONS_OPEN=" not in example


# --- deploy/bootstrap.sh: a dry run prints every file instead of writing it; nothing is run ---

BIND_IP = "192.0.2.10"  # RFC 5737: documentation only
MAIN_IP = "192.0.2.20"
FAKES = Path(__file__).parent / "fixtures" / "bootstrap-bin"


def dry_bootstrap(*extra: str, ips: str = f"{MAIN_IP} {BIND_IP}", sessions: str = ""):
    """A dry run on a machine whose global IPv4 addresses are `ips` and whose established
    ssh connections come to `sessions` (local addresses): fake `ip` and `ss` first in PATH,
    the same on the Mac (none) and on Linux (the real ones)."""
    env = {**os.environ, "PATH": f"{FAKES}:{os.environ['PATH']}", "FAKE_IPS": ips,
           "FAKE_SSH_SESSIONS": sessions}  # fmt: skip
    return subprocess.run(["bash", str(ROOT / "deploy" / "bootstrap.sh"), "--dry-run",
                           "--deploy-user", "preview", "--host", "preview.example.test",
                           "--bind-ip", BIND_IP, *extra],
                          capture_output=True, text=True, timeout=60, env=env)  # fmt: skip


def written(out: str, path: str) -> str:
    """The content a dry run prints for `path` (its `    | ` lines)."""
    after = out.split(f"+ write {path} (")[1].split("\n", 1)[1]
    lines = []
    for line in after.splitlines():
        if not line.startswith("    | "):
            break
        lines.append(line.removeprefix("    | "))
    return "\n".join(lines) + "\n"


def test_bootstrap_s_unit_reads_the_osm_and_site_env_when_they_are_there():
    """The unit's second and third EnvironmentFile, optional (`-`), under DEPLOY_PATH,
    after the first."""
    r = dry_bootstrap("--deploy-path", "/srv/elsewhere")
    assert r.returncode == 0, r.stderr
    assert "command not found" not in r.stderr
    lines = written(r.stdout, "/etc/systemd/system/preview-api.service").splitlines()
    files = [line for line in lines if line.startswith("EnvironmentFile=")]
    assert files == ["EnvironmentFile=/etc/preview-api.env",
                     "EnvironmentFile=-/srv/elsewhere/api/osm.env",
                     "EnvironmentFile=-/srv/elsewhere/api/site.env"]  # fmt: skip
    assert lines.index(files[0]) < lines.index(files[2]) < lines.index("[Install]")
    # deploy.sh swaps releases in both folders and writes the site file: the deploy user's.
    for d in ("/srv/elsewhere", "/srv/elsewhere/releases", "/srv/elsewhere/api",
              "/etc/caddy/sites.d"):  # fmt: skip
        assert f"+ install -d -o preview -g preview -m 755 {d}\n" in r.stdout, d
    sudo = written(r.stdout, "/etc/sudoers.d/preview-api")
    assert sudo.endswith(", /usr/bin/systemctl reload caddy\n")


@pytest.mark.parametrize(("extra", "message"), [
    (("--bind-ip", "2001:db8::1"), "bad --bind-ip"),
    (("--bind-ip", "192.0.2.256"), "bad --bind-ip"),
    (("--bind-ip", "192.0.2.1; reboot"), "bad --bind-ip"),
    (("--main-ip", "192.0.2.300"), "bad --main-ip"),
    (("--main-ip", "eth0"), "bad --main-ip"),
    (("--ssh-key", "/no/such/key.pub"), "--ssh-key: no file"),
])  # fmt: skip
def test_bootstrap_refuses_a_bad_address_or_key(extra, message):
    r = dry_bootstrap(*extra)
    assert r.returncode == 2 and message in r.stderr, r.stderr


def test_bootstrap_refuses_a_private_key(tmp_path):
    key = tmp_path / "id"
    key.write_text("-----BEGIN OPENSSH PRIVATE KEY-----\nxx\n-----END OPENSSH PRIVATE KEY-----\n")
    r = dry_bootstrap("--ssh-key", str(key))
    assert r.returncode == 2 and "a public key, not a private one" in r.stderr, r.stderr


def test_bootstrap_adds_the_deploy_key_and_locks_down_ssh_the_firewall_and_ipv6(tmp_path):
    key = tmp_path / "deploy.pub"
    key.write_text("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeFakeFakeFakeFakeFakeFakeFakeFake x\n")
    r = dry_bootstrap("--ssh-key", str(key))
    assert r.returncode == 0, r.stderr
    assert "+ append to /home/preview/.ssh/authorized_keys: ssh-ed25519 AAAAC3NzaC1" in r.stdout
    sshd = written(r.stdout, "/etc/ssh/sshd_config.d/10-keys-only.conf")
    for line in ("PasswordAuthentication no", "KbdInteractiveAuthentication no",
                 "PermitRootLogin no", "AddressFamily inet",
                 f"ListenAddress {MAIN_IP}"):  # fmt: skip
        assert f"\n{line}\n" in sshd, line
    nft = written(r.stdout, "/etc/nftables.conf")
    assert "policy drop;" in nft and "ct state established,related accept" in nft
    assert "ip6" not in nft and "\t\tip daddr " in nft
    # Each port on its own address: 22 on the main one, the site's ports on the site's.
    ports = [line.strip() for line in nft.splitlines() if "dport" in line]
    assert ports == [f"ip daddr {MAIN_IP} tcp dport 22 accept",
                     f"ip daddr {BIND_IP} tcp dport {{ 80, 443 }} accept",
                     f"ip daddr {BIND_IP} udp dport 443 accept"]  # fmt: skip
    assert "disable_ipv6 = 1" in written(r.stdout, "/etc/sysctl.d/90-ipv6-off.conf")
    # sshd at boot binds its address even before it is configured (else: exit 255, for good).
    bind = written(r.stdout, "/etc/sysctl.d/91-nonlocal-bind.conf")
    assert "\nnet.ipv4.ip_nonlocal_bind = 1\n" in bind
    apt = written(r.stdout, "/etc/apt/apt.conf.d/52unattended-upgrades-local")
    assert "#clear Unattended-Upgrade::Origins-Pattern;" in apt
    assert 'label=Debian"' not in apt and "label=Debian-Security" in apt
    # The cluster's version as the dry run read it (pg_lsclusters: "<version>" on a machine
    # without a Debian cluster, the runner's own elsewhere).
    version = re.search(r"^cluster: (\S+) main$", r.stdout, re.M)[1]
    pg = written(r.stdout, f"/etc/postgresql/{version}/main/conf.d/preview.conf")
    assert "listen_addresses = ''" in pg


def test_bootstrap_turns_llmnr_and_mdns_off():
    r = dry_bootstrap()
    assert r.returncode == 0, r.stderr
    resolved = written(r.stdout, "/etc/systemd/resolved.conf.d/10-no-llmnr.conf")
    assert "\n[Resolve]\nLLMNR=no\nMulticastDNS=no\n" in resolved


def test_bootstrap_finds_the_main_address_only_when_there_is_one_candidate():
    """Without --main-ip: the only global IPv4 address other than --bind-ip; none or two:
    refused, never guessed."""
    r = dry_bootstrap()
    assert r.returncode == 0, r.stderr
    found = f"main address: {MAIN_IP} (the only global IPv4 address other than --bind-ip)"
    assert found in r.stdout
    for ips, listed in ((BIND_IP, "[]"), (f"{MAIN_IP} 198.51.100.4 {BIND_IP}",
                                          f"[{MAIN_IP} 198.51.100.4]")):  # fmt: skip
        r = dry_bootstrap(ips=ips)
        assert r.returncode == 2, r.stdout
        assert f"addresses other than --bind-ip are {listed}; pass --main-ip" in r.stderr
        assert "== 1." not in r.stdout  # before anything
    # Given, it wins over the others.
    r = dry_bootstrap("--main-ip", "198.51.100.4", ips=f"{MAIN_IP} 198.51.100.4 {BIND_IP}")
    assert r.returncode == 0, r.stderr
    sshd = written(r.stdout, "/etc/ssh/sshd_config.d/10-keys-only.conf")
    assert "\nListenAddress 198.51.100.4\n" in sshd


@pytest.mark.parametrize(("extra", "ips", "message"), [
    (("--main-ip", "198.51.100.4"), f"{MAIN_IP} {BIND_IP}",
     "198.51.100.4 is not an address of this machine"),
    (("--main-ip", MAIN_IP), MAIN_IP, f"{BIND_IP} is not an address of this machine"),
])  # fmt: skip
def test_bootstrap_refuses_addresses_this_machine_does_not_hold(extra, ips, message):
    """sshd -t does not try to bind: an address the machine does not hold would stop ssh at
    the reload (« Cannot bind any address »); the site's, Caddy."""
    r = dry_bootstrap(*extra, ips=ips)
    assert r.returncode == 2 and message in r.stderr, r.stderr


def test_bootstrap_takes_one_address_for_ssh_and_the_site():
    """A server with one IPv4 (the VPS 3): --main-ip = --bind-ip, ssh (by key only, no
    root) and the site on it, the firewall opening 22, 80, 443 and udp 443 there."""
    r = dry_bootstrap("--main-ip", MAIN_IP, "--bind-ip", MAIN_IP, ips=MAIN_IP)
    assert r.returncode == 0, r.stderr
    assert f"one address: ssh and the site both on {MAIN_IP}" in r.stdout
    sshd = written(r.stdout, "/etc/ssh/sshd_config.d/10-keys-only.conf")
    for line in ("PasswordAuthentication no", "KbdInteractiveAuthentication no",
                 "PermitRootLogin no", f"ListenAddress {MAIN_IP}"):  # fmt: skip
        assert f"\n{line}\n" in sshd, line
    assert written(r.stdout, "/etc/caddy/Caddyfile").startswith(f"{{\n\tdefault_bind {MAIN_IP}\n")
    nft = written(r.stdout, "/etc/nftables.conf")
    for rule in (f"ip daddr {MAIN_IP} tcp dport 22 accept",
                 f"ip daddr {MAIN_IP} tcp dport {{ 80, 443 }} accept",
                 f"ip daddr {MAIN_IP} udp dport 443 accept"):  # fmt: skip
        assert f"\t\t{rule}\n" in nft, rule
    assert BIND_IP not in nft
    # Without --main-ip, one address is not guessed to be both: the hint says how.
    r = dry_bootstrap("--bind-ip", MAIN_IP, ips=MAIN_IP)
    assert r.returncode == 2 and "the same as --bind-ip on a server with one address" in r.stderr


def test_bootstrap_refuses_while_an_ssh_session_came_to_another_address():
    """The way in is never cut: a session that came to the site's address could not come
    back once ssh listens on the main one alone; one on the main address is fine."""
    r = dry_bootstrap(sessions=f"{BIND_IP} {MAIN_IP}")
    assert r.returncode == 1, r.stdout
    assert (f"refused: an ssh session came to {BIND_IP}, not to the main address {MAIN_IP}"
            in r.stderr)  # fmt: skip
    assert f"Sign in to {MAIN_IP} (ssh -4" in r.stderr and "== 1." not in r.stdout
    assert dry_bootstrap(sessions=MAIN_IP).returncode == 0


def test_bootstrap_s_caddyfile_binds_the_site_s_address_and_imports_the_sites():
    r = dry_bootstrap()
    assert r.returncode == 0, r.stderr
    caddyfile = written(r.stdout, "/etc/caddy/Caddyfile")
    assert caddyfile.startswith(f"{{\n\tdefault_bind {BIND_IP}\n")
    assert caddyfile.endswith("\nimport sites.d/*.caddy\n")
    assert "admin off" not in caddyfile  # deploy.sh reloads through Caddy's admin endpoint
    sources = written(r.stdout, "/etc/apt/sources.list.d/caddy-stable.sources")
    assert "Signed-By: /etc/apt/keyrings/caddy-stable.asc" in sources


@needs_caddy
def test_no_client_address_in_caddy_s_logs(tmp_path):
    """Bootstrap's Caddyfile (its global options, the bind address made local, at DEBUG so
    that every message shows) with the public site and a site whose upstream is down and
    which has no handle_errors (an ERROR line, with the request): no field that carries a
    client's address, no request header (an X-Forwarded-For a client sends included)."""
    if CADDY is None:
        pytest.fail("REQUIRE_CADDY is set but caddy is not installed")
    caddyfile = written(dry_bootstrap().stdout, "/etc/caddy/Caddyfile")
    port, down, closed = free_port(), free_port(), free_port()
    local = "default_bind 127.0.0.1\n\tadmin off\n\tauto_https off"
    caddyfile = caddyfile.replace(f"default_bind {BIND_IP}", local)
    caddyfile = caddyfile.replace("level INFO", "level DEBUG")
    (tmp_path / "sites.d").mkdir()
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("ok")
    env = {**PUBLIC, "PREVIEW_HOST": f"http://127.0.0.1:{port}",
           "PREVIEW_ROOT": str(tmp_path / "web"), "API_PORT": str(closed)}  # fmt: skip
    (tmp_path / "sites.d" / "site.caddy").write_text(site.render(env))
    (tmp_path / "sites.d" / "down.caddy").write_text(
        f"http://127.0.0.1:{down} {{\n\treverse_proxy 127.0.0.1:{closed}\n}}\n"
    )
    (tmp_path / "Caddyfile").write_text(caddyfile)
    log = tmp_path / "caddy.log"
    with log.open("wb") as err:
        proc = subprocess.Popen([CADDY, "run", "--adapter", "caddyfile", "--config",
                                 str(tmp_path / "Caddyfile")],
                                stdout=subprocess.DEVNULL, stderr=err)  # fmt: skip
        try:
            for p in (port, down):
                for _ in range(100):
                    try:
                        socket.create_connection(("127.0.0.1", p), timeout=0.1).close()
                        break
                    except OSError:
                        assert proc.poll() is None, log.read_text()
                        time.sleep(0.05)
            spoof = {"X-Forwarded-For": "203.0.113.9", "X-Real-IP": "203.0.113.9"}
            assert authed(f"http://127.0.0.1:{down}/", None, spoof)[0] == 502
            assert authed(f"http://127.0.0.1:{port}/api/x", None, spoof)[0] == 502
            assert authed(f"http://127.0.0.1:{port}/nothing", None, spoof)[0] == 404
            assert authed(f"http://127.0.0.1:{port}/revue", None, spoof)[0] == 401
            time.sleep(0.3)
        finally:
            proc.terminate()
            proc.wait(timeout=10)
    text = log.read_text()
    assert '"logger":"http.log.error"' in text and "connection refused" in text, text
    for field in ('"remote_ip"', '"remote_port"', '"client_ip"', '"remote_addr"', '"remote"',
                  '"headers"', "203.0.113.9"):  # fmt: skip
        assert field not in text, field


def test_bootstrap_s_unquoted_heredocs_substitute_nothing_but_variables():
    """A heredoc with an unquoted delimiter expands `…` and $(…): written text, a comment
    included, would run them as root (bootstrap 2026-10-10: « -: command not found »)."""
    text = (ROOT / "deploy" / "bootstrap.sh").read_text()
    bodies = re.findall(r"<<([A-Z]+)\n(.*?)\n\1\n", text, re.S)
    assert {name for name, _ in bodies} >= {"ENV", "UNIT", "SUDO", "CADDYFILE", "SOURCES"}
    for name, body in bodies:
        assert "`" not in body and "$(" not in body, name


# --- publishing to OpenStreetMap: what the backups take (migration 016) ----------------------


def test_the_deploy_s_dump_takes_the_publishing_tables():
    """Before the migrations: the write tokens (sealed), the publications and the nodes, in
    the deploy user's 700 folder, with the contributions they point at."""
    text = (ROOT / "deploy" / "deploy.sh").read_text()
    dump = text[
        text.index("pg_dump -Fc -t contributions") : text.index("contributions-$STAMP.dump")
    ]
    for table in ("contributions", "accounts", "schema_migrations", "osm_write",
                  "osm_publications", "osm_nodes", "hidden_cameras", "admin_log",
                  "site_settings", "site_counters_hour", "site_counters",
                  "site_counters_month", "registre_reports"):  # fmt: skip
        assert f"-t {table} " in dump, table
    assert text.index("pg_dump -Fc -t contributions") < text.index("db/migrate.sh '$DB_DSN'")


def test_the_deploy_bounds_the_publisher_as_the_api_does():
    from lacarte.api import app as api

    text = (ROOT / "deploy" / "site_env.sh").read_text()
    assert f'"${{#PUBLISHER_IDENTITY}}" -gt {api.PUBLISHER_MAX} ]' in text


def test_the_deploy_s_dumps_are_kept_14_days_at_most():
    """They hold accounts and tokens: pruned by age as the nightly backups are, not only by
    count (the privacy page promises 14 days)."""
    text = (ROOT / "deploy" / "deploy.sh").read_text()
    assert "find '$API/backups' -maxdepth 1 -name 'contributions-*.dump' -mtime +13 -delete" in text
    nightly = (ROOT / "deploy" / "bootstrap.sh").read_text()
    assert "-name 'contributions-*.dump' -mtime +13 -delete" in nightly


def test_a_dump_naming_tables_not_there_yet_does_not_fail(pg_dsn, pg_loaded, tmp_path):
    """The first deploy of 016 dumps before migrating: osm_* do not exist yet. pg_dump fails
    only when no -t matches at all (its --strict-names documentation, read on pg_dump 14)."""
    out = tmp_path / "c.dump"
    r = subprocess.run(["pg_dump", "-Fc", "-t", "contributions", "-t", "no_such_table",
                        "-t", "osm_not_yet", pg_dsn, "-f", str(out)],
                       capture_output=True, text=True)  # fmt: skip
    assert r.returncode == 0 and out.stat().st_size > 0, r.stderr
    none = subprocess.run(["pg_dump", "-Fc", "-t", "no_such_table", pg_dsn, "-f", str(out)],
                          capture_output=True, text=True)  # fmt: skip
    assert none.returncode != 0  # what --strict-names says: none matching fails


def test_bootstrap_s_daily_backup_takes_publications_and_nodes_never_tokens():
    r = dry_bootstrap()
    assert r.returncode == 0, r.stderr
    script = written(r.stdout, "/usr/local/sbin/preview-backup")
    assert "-t osm_publications" in script and "-t osm_nodes" in script
    assert "-t hidden_cameras" in script  # migration 018
    assert "-t admin_log" in script and "-t site_settings" in script  # migration 020
    assert "-t site_counters " in script and "-t site_counters_month " in script  # 021
    assert "-t site_counters_hour " in script  # 021's hours: up to 8 days not yet folded
    assert "-t registre_reports " in script  # 026
    assert "osm_write" not in script


def test_the_deploy_ships_the_hidden_cameras_its_build_left_out():
    """Migration 020: settle marks them gone from the map with this build (« Retraits »)."""
    text = (ROOT / "deploy" / "deploy.sh").read_text()
    copy = text.index('cp "data/build/$REGION/hidden-applied.txt" "$EXPORT/"')
    assert text.index('rm -f "$EXPORT/hidden-applied.txt"') < copy
    assert copy < text.index('"$EXPORT/" "$DEPLOY_TARGET:$API/exports/$STAMP/"')
    assert text.index("db/settle.sh '$API/exports/$STAMP'") > copy


def test_the_deploy_keeps_the_journal_12_months(pg_dsn, pg_loaded):
    """db/retention.sql, run as the owner after settle: older lines go, the rest stays."""
    text = (ROOT / "deploy" / "deploy.sh").read_text()
    run = "psql -X -q -At -v ON_ERROR_STOP=1 '$DB_DSN' -f db/retention.sql"
    assert text.index("db/settle.sh '$API/exports/$STAMP'") < text.index(run)
    assert text.index(run) < text.index("systemctl restart preview-api")
    sql = (
        # Today in Paris: lacarte_retention()'s day (migration 023).
        "DELETE FROM admin_log; CREATE TEMP TABLE t AS SELECT"
        " (now() AT TIME ZONE 'Europe/Paris')::date AS today;"
        " INSERT INTO admin_log (day, actor, action) SELECT d, a, 'cut' FROM t, LATERAL"
        " (VALUES (today - interval '12 months' - interval '1 day', 'a'),"
        " (today - interval '12 months', 'b'), (today, 'c')) v(d, a)"
    )
    subprocess.run(["psql", "-X", "-q", pg_dsn, "-c", sql], check=True)
    out = subprocess.run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", pg_dsn, "-f",
                          str(ROOT / "db" / "retention.sql")], check=True, capture_output=True,
                         text=True).stdout  # fmt: skip
    assert out == "journal lines older than 12 months deleted: 1\n"
    left = subprocess.run(["psql", "-X", "-At", pg_dsn, "-c",
                           "SELECT string_agg(actor, ',' ORDER BY actor) FROM admin_log"],
                          check=True, capture_output=True, text=True).stdout  # fmt: skip
    assert left == "b,c\n"


# --- France (2026-10-22): an unchanged basemap is not sent again; back at once --------------


def test_the_web_release_links_what_the_release_in_service_holds():
    """5 GB of basemap for France: a file the release in service holds unchanged is
    hard-linked on the server, not sent again (rsync --link-dest)."""
    text = (ROOT / "deploy" / "deploy.sh").read_text()
    rsync = text[text.index("rsync -azL") : text.index('"$DEPLOY_TARGET:$RELEASE/"')]
    assert '--link-dest="$DEPLOY_PATH/current/"' in rsync


def test_rollback_swaps_the_tables_back_before_the_releases():
    """deploy/rollback.sh: the tables first (db/rollback.sh refuses when a migration changed
    them, and nothing else moves), then both releases, the API's health and the site."""
    text = (ROOT / "deploy" / "rollback.sh").read_text()
    assert text.index("db/rollback.sh '$DB_DSN'") < text.index("current.new")
    assert text.index("current.new") < text.index("systemctl restart preview-api")
    assert "deploy/site.py check" in text and "lacarte.lock acquire" in text
    # Not twice: the tables kept back must be the release before's build.
    assert text.index("SELECT build_id FROM meta_prev") < text.index("db/rollback.sh '$DB_DSN'")
