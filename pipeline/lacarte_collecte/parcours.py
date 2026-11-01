"""Our own slow crawl of a prefecture's recueils, where Attrap does not read (its collector
stopped: Loir-et-Cher, Nouvelle-Calédonie) or does not go (8 regional prefectures,
Saint-Pierre-et-Miquelon, Saint-Barthélemy and Saint-Martin, Wallis-et-Futuna, once their
index is known): the index page, link by link, every request through fetch.py (robots.txt
read first, the pace of the host's server: the prefectures share one, ten seconds), within
the index's own path, at most `pages_max` pages a run. A link to a PDF (`.pdf`, or the
prefectures' « /contenu/telechargement/ ») is a recueil, its id the same as Attrap's (the
SHA-256 of its decoded address): downloaded, read, deleted. A host that answers with an
anti-robot check is « fermé aux robots », never asked again by this run (fetch.Blocked)."""

from __future__ import annotations

import datetime as dt
import html
import re
import urllib.parse
from typing import Any

from lacarte_collecte import parse_raa
from lacarte_collecte.contexte import Contexte
from lacarte_collecte.etat import Etat, Store

SOURCE = "parcours"
HREF = re.compile(r"""<a\b[^>]*href=["']([^"'#]+)["'][^>]*>(.*?)</a>""", re.I | re.S)
DATE = re.compile(r"(\d{1,2})[/.-](\d{1,2})[/.-](20\d\d)|(20\d\d)[/.-](\d{1,2})[/.-](\d{1,2})")


def links(page: str, base: str) -> list[tuple[str, str]]:
    out = []
    for href, label in HREF.findall(page):
        url = urllib.parse.urljoin(base, html.unescape(href.strip()))
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(label))).strip()
        out.append((url.split("#")[0], text))
    return out


def is_document(url: str) -> bool:
    path = urllib.parse.urlsplit(url).path.lower()
    return path.endswith(".pdf") or "/contenu/telechargement/" in path


def day_of(label: str, url: str) -> dt.date | None:
    for s in (label, urllib.parse.unquote(url)):
        m = DATE.search(s)
        if m:
            g = m.groups()
            y, mo, d = (g[2], g[1], g[0]) if g[0] else (g[3], g[4], g[5])
            try:
                return dt.date(int(y), int(mo), int(d))
            except ValueError:
                continue
    return None


def collect_admin(
    ctx: Contexte,
    admin: str,
    conf: dict[str, Any],
    kinds: list[parse_raa.Type],
    communes: parse_raa.Communes,
) -> dict[str, Any]:
    from lacarte_collecte import arretes  # the recueil's reading is the same as Attrap's

    f = ctx.fetcher(SOURCE)
    src = f.conf["sources"]["parcours"]
    since = dt.date.fromisoformat(str(f.conf["sources"]["attrap"]["depuis"]))
    st = Etat(ctx.root, SOURCE)
    index = conf["index"]
    prefix = urllib.parse.urlsplit(index).path.rsplit("/", 1)[0]
    store = Store(ctx.root, "recueils")
    known = {r["id"] for r in store.records() if arretes.is_read(r)}
    seen_pages: set[str] = set(st.get(admin).get("pages_lues") or [])
    queue, pages, newest = [index], 0, st.get(admin).get("dernier_document")
    while queue and pages < int(src["pages_max"]):
        url = queue.pop(0)
        if url in seen_pages and url != index:
            continue
        if ctx.out_of_time():
            break
        r = f.get(url, cache=False)
        pages += 1
        seen_pages.add(url)
        if r.status != 200:
            continue
        for link, label in links(r.body.decode("utf-8", "replace"), url):
            parts = urllib.parse.urlsplit(link)
            if parts.netloc != urllib.parse.urlsplit(index).netloc:
                continue
            if is_document(link):
                rid = arretes.recueil_id(link)
                day = day_of(label, link)
                if rid in known or (day and day < since):
                    continue
                rec = {
                    "id": rid,
                    "administration": admin,
                    "date": (day or ctx.today).isoformat(),
                    "name": parse_raa.mask(label)[:200],
                    "url": link,
                    "familles": [],
                    "decouverte": "parcours",
                }
                rec = arretes.read_recueil(
                    ctx, admin, {**conf, "defi": False}, rec, None, kinds, communes, "pdf"
                )
                store.add([rec])
                known.add(rid)
                if day and (newest is None or day.isoformat() > newest):
                    newest = day.isoformat()
            elif parts.path.startswith(prefix) and link not in seen_pages:
                queue.append(link)
    return st.save(
        admin,
        statut="termine" if not queue else "en_cours",
        pages_lues=sorted(seen_pages),
        dernier_document=newest,
    )
