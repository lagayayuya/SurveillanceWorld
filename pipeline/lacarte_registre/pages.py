"""`lacarte-registre pages SHELL OUT --site URL`: the records' entry pages, at the deploy.

construire writes each record's entry page as its two parts (partage.entree:
site/entree/<ref>.html, its head's tags and its body). Here they go into the page the
register opens on, as the web build made it (SHELL: web/dist/index.html, the map's page since
the redesign v2, its scripts and styles by their hashed names): its <title> replaced by the
record's tags, the map's own share tags dropped (Open Graph but og:site_name, Twitter,
canonical: a preview reads one set), the record's body in a <noscript> right after <body>
(read by whoever runs no JavaScript; the register's app draws the page for everyone else),
`%site%` replaced by the site's address (VITE_SITE_URL, the same as the site's own preview
tags). Out: OUT/registre/<ref>.html, which Caddy serves at /registre/<ref> when it exists
(deploy/preview.caddy), the map's page otherwise.
"""

from __future__ import annotations

import re
from pathlib import Path

from lacarte_registre.partage import BODY, HEAD

TITLE = re.compile(r"<title>.*?</title>", re.S)
ROBOTS = re.compile(r'\s*<meta name="robots"[^>]*>', re.S)
DESCRIPTION = re.compile(r'\s*<meta name="description"[^>]*>', re.S)
SHARE_TAGS = re.compile(
    r'\s*<meta (?:property="og:(?!site_name")|name="twitter:)[^>]*>'
    r'|\s*<link rel="canonical"[^>]*>',
    re.S,
)
BODY_OPEN = re.compile(r"<body[^>]*>")


def page(shell: str, fragment: str, site: str) -> str:
    head, body = fragment.split(BODY, 1)
    head = head.replace(HEAD, "").strip()
    # the record's own title, description and robots tag instead of the register's
    out = ROBOTS.sub("", DESCRIPTION.sub("", SHARE_TAGS.sub("", shell), count=1), count=1)
    out = TITLE.sub(lambda _m: head, out, count=1)
    m = BODY_OPEN.search(out)
    if m is None:
        raise ValueError("the register's page has no <body>")
    out = f"{out[: m.end()]}\n<noscript>{body.strip()}</noscript>{out[m.end() :]}"
    return out.replace("%site%", site)


def run(shell: Path, site_dir: Path, out: Path, site: str) -> int:
    if not re.fullmatch(r"https://[a-z0-9.-]+(:\d+)?", site):
        raise ValueError(f"the site's address: https://<host> expected, got {site!r}")
    text = shell.read_text(encoding="utf-8")
    n = 0
    for frag in sorted((site_dir / "entree").rglob("*.html")):
        rel = frag.relative_to(site_dir / "entree")
        dest = out / "registre" / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(page(text, frag.read_text(encoding="utf-8"), site), encoding="utf-8")
        n += 1
    return n
