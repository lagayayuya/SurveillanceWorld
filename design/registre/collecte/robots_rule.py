"""The robots.txt decision every fetcher of the exploration applies (RFC 9309, section 2.3.1).

- 2xx with a robots file: parse it and obey it for our User-Agent.
- 4xx ("unavailable"): no rules, everything may be fetched.
- 5xx, network error or no answer ("unreachable"): complete disallow.
- A 2xx that is an HTML page (an anti-bot challenge, not a robots file): treated as unreachable.
Redirects are followed by the HTTP client (RFC: at least five hops).
"""

import urllib.robotparser


def decide(status: int | None, text: str, url: str, ua: str) -> tuple[bool, str]:
    if status is None or status >= 500:
        return False, f"robots unreachable ({status}): full disallow (RFC 9309 2.3.1.4)"
    if 400 <= status < 500:
        return True, f"robots {status}: no rules (RFC 9309 2.3.1.3)"
    if "<html" in text.lower()[:500]:
        return False, "robots answered with an HTML page (challenge?): treated as unreachable"
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    ok = rp.can_fetch(ua, url)
    return ok, "robots ok" if ok else "robots disallow"
