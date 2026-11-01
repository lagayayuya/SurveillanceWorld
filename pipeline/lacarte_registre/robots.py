"""robots.txt read by RFC 9309, which urllib.robotparser is not: it ignores the `*` and `$`
special characters (§ 2.2.3) and takes the first matching rule instead of the longest.

- Groups (§ 2.1): consecutive `user-agent` lines open one group; the rules of every group
  whose user-agent equals our product token (case-insensitive, § 2.2.1) are merged; when none
  matches, the `*` groups' rules apply.
- Matching (§ 2.2.2): the most specific rule wins, by the length of its path; on a tie
  between an allow and a disallow, allow wins. An empty disallow matches nothing.
- `/robots.txt` itself is always allowed (§ 2.2.2).
- `crawl-delay` is not in RFC 9309; a host that writes one is still honoured (`crawl_delay`).
"""

from __future__ import annotations

import contextlib
import re
import urllib.parse
from dataclasses import dataclass


@dataclass
class Group:
    agents: list[str]
    rules: list[tuple[str, str]]  # ("allow" | "disallow", path)
    crawl_delay: float | None = None


def groups(text: str) -> list[Group]:
    out: list[Group] = []
    cur: Group | None = None
    last_agent = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        k, v = (x.strip() for x in line.split(":", 1))
        k = k.lower()
        if k == "user-agent":
            if not last_agent or cur is None:
                cur = Group([], [])
                out.append(cur)
            cur.agents.append(v.lower())
            last_agent = True
            continue
        last_agent = False
        if cur is None:
            continue
        if k in ("allow", "disallow"):
            cur.rules.append((k, v))
        elif k == "crawl-delay":
            with contextlib.suppress(ValueError):
                cur.crawl_delay = float(v)
    return out


def _pattern(path: str) -> re.Pattern[str]:
    end = path.endswith("$")
    body = re.escape(path[:-1] if end else path).replace(r"\*", ".*")
    return re.compile(body + ("$" if end else ""))


def _mine(text: str, product: str) -> list[Group]:
    gs = groups(text)
    product = product.lower()
    mine = [g for g in gs if product in g.agents]
    return mine or [g for g in gs if "*" in g.agents]


def _path(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    path = (p.path or "/") + (f"?{p.query}" if p.query else "")
    return urllib.parse.unquote(path)


def allowed(text: str, url: str, product: str) -> tuple[bool, str | None]:
    """May `product` fetch `url`? Returns the decision and the rule that made it (None when
    no rule applies)."""
    path = _path(url)
    if path == "/robots.txt":
        return True, None
    best: tuple[tuple[int, bool], str, str] | None = None
    for g in _mine(text, product):
        for k, v in g.rules:
            if k == "disallow" and not v:
                continue
            if _pattern(v).match(path):
                key = (len(v), k == "allow")
                if best is None or key > best[0]:
                    best = (key, k, v)
    if best is None:
        return True, None
    return best[1] == "allow", f"{best[1]}: {best[2]}"


def crawl_delay(text: str, product: str) -> float | None:
    """The crawl-delay of the groups that apply to us, the largest when several give one."""
    delays = [g.crawl_delay for g in _mine(text, product) if g.crawl_delay is not None]
    return max(delays) if delays else None
