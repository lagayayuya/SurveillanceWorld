"""Render the site's Caddy file, and check what the site shows without a password. Host,
accounts and hashes come from the environment; the repository names no server. One
template, two modes (SITE_MODE, default preview):
  preview  everything behind the password (PREVIEW_ACCOUNTS), never indexed;
  public   open and indexable; /revue and /api/review/* alone behind a password
           (REVIEW_ACCOUNTS); HSTS; www.<host> redirects permanently to the bare host.

    python deploy/site.py render            # site file on stdout
    python deploy/site.py check <base-url> [--builds SERVED DATABASE]
        # anonymous requests; exit 1 on any leak (preview: anything but a generic 401;
        # public: a missing header, a password asked outside the review paths or not on
        # them, www.<host> not redirecting permanently to the host with path and query, an
        # AAAA record for either name, an A record other than SITE_IP when set; both: the
        # review page without its Content-Security-Policy, another path with one), or when
        # the build id of the served tiles/meta.json differs from the database's
"""

from __future__ import annotations

import os
import re
import socket
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

TEMPLATE = Path(__file__).with_name("preview.caddy")
VARS = ("PREVIEW_HOST", "PREVIEW_ROOT", "API_PORT")
MODES = ("preview", "public")
# What the password covers, and the accounts' variable, by mode.
GATED = {"preview": "*", "public": "/revue /revue.html /api/review/*"}
ACCOUNTS = {"preview": "PREVIEW_ACCOUNTS", "public": "REVIEW_ACCOUNTS"}
# Headers only one mode sends (the others are the template's own).
MODE_HEADERS = {
    "preview": ('X-Robots-Tag "noindex, nofollow, noarchive"',),
    "public": ('Strict-Transport-Security "max-age=31536000"',),
}
# Every answer carries them, in both modes; errors are answered again, bare (handle_errors).
HEADERS = {
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
}
# The review page's Content-Security-Policy (both modes, /revue and /revue.html only): its
# own scripts, styles (inline allowed: the theme), fonts and API; images and workers from
# data: and blob: too (the map); no plugin, no <base>, never framed, forms to itself.
REVIEW_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
    " img-src 'self' data: blob:; font-src 'self'; connect-src 'self';"
    " worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none';"
    " form-action 'self'"
)
REVIEW_PAGES = ("/revue", "/revue.html")
# The gate's basic-auth users (not the API's accounts, which sign in with a session).
ACCOUNT_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")
# Words that must never be readable without the password (case-insensitive): the project's
# names, plus the deployment's own words from SITE_FORBIDDEN (comma-separated, kept with the
# host outside the repository).
FORBIDDEN = ("la-carte", "lacarte", "la carte")
# Paths probed anonymously in preview mode, all behind the password: the page, a tile file,
# the API (read and write), the review page and its API, a missing file.
PROBES = (
    ("GET", "/"),
    ("GET", "/index.html"),
    ("GET", "/tiles/meta.json"),
    ("GET", "/api/"),
    ("GET", "/api/proposals?bbox=2.2,48.8,2.3,48.9"),
    ("POST", "/api/preview"),
    ("POST", "/api/contributions"),
    ("POST", "/api/review/decide"),
    ("GET", "/api/review/export.csv"),
    ("GET", "/revue"),
    ("GET", "/no-such-file"),
)
# Public mode: what anyone reads, never a 401 (the page, a tile file, the API's reads, the
# review page's own sign-in, a missing file), and the review paths, behind the password.
OPEN_PROBES = (
    ("GET", "/"),
    ("GET", "/index.html"),
    ("GET", "/tiles/meta.json"),
    ("GET", "/api/proposals?bbox=2.2,48.8,2.3,48.9"),
    ("POST", "/api/session"),
    ("GET", "/no-such-file"),
)
REVIEW_PROBES = (
    ("GET", "/revue"),
    ("GET", "/revue.html"),
    ("GET", "/api/review/contributions"),
    ("GET", "/api/review/export.csv"),
    ("POST", "/api/review/decide"),
)
# Public mode: asked of www.<host>, answered by a permanent redirect to the same path and
# query on the bare host.
WWW_PROBE = "/?page=sources&check=1"
PERMANENT = (301, 308)


def accounts(value: str, name: str = "PREVIEW_ACCOUNTS") -> str:
    """`name hash;name hash;...` -> one `name hash` line per account, for basic_auth."""
    lines = []
    for item in value.split(";"):
        parts = item.split()
        if not parts:
            continue
        if len(parts) != 2 or not ACCOUNT_RE.fullmatch(parts[0]):
            raise SystemExit(f"{name}: expected 'name hash;...', got {parts[0]!r}")
        lines.append(f"\t\t{parts[0]} {parts[1]}")
    if not lines:
        raise SystemExit(f"{name}: no account")
    return "\n".join(lines)


def site_mode(env: dict[str, str]) -> str:
    mode = env.get("SITE_MODE") or "preview"
    if mode not in MODES:
        raise SystemExit(f"SITE_MODE: preview or public, got {mode!r}")
    return mode


def www_site(host: str) -> tuple[str, str]:
    """The www name's site address and the bare URL it redirects to: `example.org` gives
    (`www.example.org`, `https://example.org`); a host written with its scheme and port
    (the tests' local Caddy) keeps them."""
    if "://" not in host:
        return f"www.{host}", f"https://{host}"
    scheme, rest = host.split("://", 1)
    return f"{scheme}://www.{rest}", host


def render(env: dict[str, str] | None = None) -> str:
    env = dict(os.environ if env is None else env)
    env.setdefault("PREVIEW_ROOT", "/srv/preview/current")
    env.setdefault("API_PORT", "8791")
    mode = site_mode(env)
    missing = [v for v in (*VARS, ACCOUNTS[mode]) if not env.get(v)]
    if missing:
        raise SystemExit(f"missing environment: {', '.join(missing)}")
    if not env["API_PORT"].isdigit():
        raise SystemExit("API_PORT must be a port number")
    env["GATE_ACCOUNTS"] = accounts(env[ACCOUNTS[mode]], ACCOUNTS[mode])
    env["GATED_PATHS"] = GATED[mode]
    env["REVIEW_CSP"] = REVIEW_CSP
    env["MODE_HEADERS"] = "\n".join(f"\t\t{h}" for h in MODE_HEADERS[mode])
    env["WWW_SITE"], env["BARE_URL"] = www_site(env["PREVIEW_HOST"])
    text = TEMPLATE.read_text()
    # The www redirect: public mode only (the preview's random host has no www).
    if mode != "public":
        text = re.sub(r"(?ms)\n^#public$.*?^#/public$\n?", "", text)
    out = re.sub(r"\$\{(\w+)\}", lambda m: env[m.group(1)], text)
    # Comments of the template may say what the site is; the rendered file keeps none.
    return "\n".join(line for line in out.splitlines() if not line.lstrip().startswith("#")) + "\n"


def forbidden() -> tuple[str, ...]:
    extra = os.environ.get("SITE_FORBIDDEN", "").split(",")
    return FORBIDDEN + tuple(w.strip().lower() for w in extra if w.strip())


def leaks(text: str) -> list[str]:
    low = text.lower()
    return [w for w in forbidden() if w in low]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is an answer to check, never followed (it raises HTTPError instead)."""

    def redirect_request(self, *_args, **_kwargs):
        return None


OPENER = urllib.request.build_opener(_NoRedirect)


def anonymous(
    url: str, method: str = "GET", host: str | None = None
) -> tuple[int, dict[str, str], bytes]:
    """One request without the password; `host` sends another Host header (the tests ask
    a local Caddy for a site name)."""
    body = b"{}" if method in ("POST", "PUT") else None
    headers = {"User-Agent": "preview-check", "Content-Type": "application/json"}
    if host:
        headers["Host"] = host
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with OPENER.open(req, timeout=10) as r:  # noqa: S310 (our own host)
            return r.status, dict(r.headers.items()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()


def certificate_names(base: str) -> str:
    """Subject and alternative names of the certificate served for the host."""
    host = urlsplit(base).hostname or ""
    ctx = ssl.create_default_context()
    with (
        socket.create_connection((host, urlsplit(base).port or 443), timeout=10) as sock,
        ctx.wrap_socket(sock, server_hostname=host) as tls,
    ):
        cert = tls.getpeercert() or {}
    return repr(cert.get("subject", ())) + repr(cert.get("subjectAltName", ()))


def addresses(host: str, family: int) -> list[str]:
    """The host's addresses of one family as the system resolver gives them (none: []).
    Run from the Mac: a DNS64 network would synthesize AAAA records (64:ff9b::/96), and a
    mapped address (::ffff:a.b.c.d) is an A record, so neither counts."""
    try:
        infos = socket.getaddrinfo(host, 443, family, socket.SOCK_STREAM)
    except socket.gaierror:
        return []
    found = {info[4][0] for info in infos}
    return sorted(a for a in found if not a.startswith(("::ffff:", "64:ff9b::")))


def is_ip(host: str) -> bool:
    try:
        socket.inet_pton(socket.AF_INET6 if ":" in host else socket.AF_INET, host)
    except OSError:
        return False
    return True


def dns_problems(host: str, site_ip: str | None, resolve=addresses) -> list[str]:
    """IPv4 only, for the host and its www: an AAAA record would send visitors to an
    address nothing serves; the A record is the site's own address (SITE_IP, Caddy's
    default_bind), when given."""
    problems = []
    for name in (host, f"www.{host}"):
        if v6 := resolve(name, socket.AF_INET6):
            problems.append(f"DNS: AAAA record(s) for {name}: {', '.join(v6)}")
        if site_ip and (v4 := resolve(name, socket.AF_INET)) != [site_ip]:
            problems.append(f"DNS: A record(s) for {name}: {v4}, expected [{site_ip!r}]")
    return problems


def www_problems(base: str, fetch=anonymous) -> list[str]:
    """www.<host> answers a permanent redirect to the bare host, path and query kept,
    bare (no Server header), over a certificate valid for that name (the HTTPS request
    verifies it)."""
    parts = urlsplit(base)
    www = parts._replace(netloc=f"www.{parts.netloc}").geturl()
    try:
        status, raw, body = fetch(www + WWW_PROBE)
    except OSError as e:  # no address, refused, a certificate not valid for www
        return [f"www: {www} unreachable: {e}"]
    headers = {k.lower(): v for k, v in raw.items()}
    problems = []
    if status not in PERMANENT:
        problems.append(f"www: status {status}, expected a permanent redirect {PERMANENT}")
    if (location := headers.get("location")) != base + WWW_PROBE:
        problems.append(f"www: Location {location!r}, expected {base + WWW_PROBE!r}")
    if "server" in headers:
        problems.append(f"www: Server header {headers['server']!r}")
    if leaks(body.decode("utf-8", "replace")):
        problems.append(f"www: body names {leaks(body.decode('utf-8', 'replace'))}")
    return problems


def gate_problems(path: str, status: int, headers: dict[str, str], body: bytes) -> list[str]:
    """A password asked as Caddy asks it, and nothing else said: status, realm, no name."""
    problems = []
    if status != 401:
        problems.append(f"{path}: status {status}, expected 401")
    auth = headers.get("www-authenticate", "")
    if not re.fullmatch(r'Basic realm="restricted"', auth):
        problems.append(f"{path}: authenticate header {auth!r}")
    head = "\n".join(f"{k}: {v}" for k, v in headers.items())
    for where, text in (("headers", head), ("body", body.decode("utf-8", "replace"))):
        if leaks(text):
            problems.append(f"{path}: {where} name {leaks(text)}")
    return problems


def header_problems(mode: str, path: str, status: int, headers: dict[str, str]) -> list[str]:
    problems = []
    if "server" in headers:
        problems.append(f"{path}: Server header {headers['server']!r}")
    # The review page's policy, also on its 401 (set before the gate); no other path has one.
    csp = headers.get("content-security-policy")
    if urlsplit(path).path in REVIEW_PAGES:
        if csp != REVIEW_CSP:
            problems.append(f"{path}: Content-Security-Policy {csp!r}, expected the review's")
    elif csp is not None:
        problems.append(f"{path}: Content-Security-Policy {csp!r} outside /revue")
    if status >= 400:  # an error is answered again by handle_errors, empty and bare
        return problems
    want = {k.lower(): v for k, v in HEADERS.items()}
    if mode == "public":
        want["strict-transport-security"] = "max-age=31536000"
        if "x-robots-tag" in headers:
            problems.append(f"{path}: X-Robots-Tag {headers['x-robots-tag']!r} (not indexable)")
    else:
        want["x-robots-tag"] = "noindex, nofollow, noarchive"
    for name, value in want.items():
        if headers.get(name) != value:
            problems.append(f"{path}: {name} {headers.get(name)!r}, expected {value!r}")
    return problems


def check(
    base: str,
    builds: tuple[str, str] | None = None,
    mode: str = "preview",
    site_ip: str | None = None,
    resolve=addresses,
    fetch=anonymous,
) -> list[str]:
    """Problems seen by someone without the password, and a build mismatch between the
    served tiles and the participation database; empty when all is well. `resolve(host,
    family)` gives the host's addresses, `fetch(url, method)` makes a request (tests pass
    their own: no network, a local Caddy)."""
    base = base.rstrip("/")
    problems = []
    if builds is not None and builds[0] != builds[1]:
        problems.append(f"build: tiles/meta.json {builds[0]!r} != database {builds[1]!r}")
    if leaks(base):
        problems.append(f"host name: {leaks(base)}")
    host = urlsplit(base).hostname or ""
    if mode == "public" and not is_ip(host):
        problems += dns_problems(host, site_ip, resolve)
        problems += www_problems(base, fetch)
    if base.startswith("https://"):
        names = certificate_names(base)
        if leaks(names):
            problems.append(f"certificate: {leaks(names)}")
    gated = PROBES if mode == "preview" else REVIEW_PROBES
    for method, path in (*gated, *(OPEN_PROBES if mode == "public" else ())):
        status, raw, body = fetch(base + path, method)
        headers = {k.lower(): v for k, v in raw.items()}
        problems += header_problems(mode, path, status, headers)
        if (method, path) in gated:
            problems += gate_problems(path, status, headers, body)
        elif status == 401 or "www-authenticate" in headers:
            # The site itself is open: a password asked here would lock everyone out.
            problems.append(f"{path}: status {status}, a password asked outside /revue")
    return problems


def main(argv: list[str]) -> int:
    if argv[:1] == ["render"]:
        sys.stdout.write(render())
        return 0
    if argv[:1] == ["check"] and len(argv) in (2, 5) and (len(argv) == 2 or argv[2] == "--builds"):
        mode = site_mode(dict(os.environ))
        problems = check(argv[1], (argv[3], argv[4]) if len(argv) == 5 else None, mode,
                         os.environ.get("SITE_IP") or None)  # fmt: skip
        for p in problems:
            print(p, file=sys.stderr)
        ok = {"preview": "anonymous view: generic 401 only",
              "public": "public view: open, headers set, /revue behind its password, "
                        "www redirected"}  # fmt: skip
        print(ok[mode] if not problems else "PROBLEM", file=sys.stderr)
        return 1 if problems else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
