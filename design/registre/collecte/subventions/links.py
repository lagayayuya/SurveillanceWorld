"""Print links of a saved HTML page whose text or href matches a regex.

Usage: python -I links.py <html_file> <regex>
"""
import html, re, sys
t = open(sys.argv[1], encoding="utf-8", errors="replace").read()
pat = re.compile(sys.argv[2], re.I)
seen = set()
for h, x in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', t, re.S):
    x = html.unescape(re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", x))).strip()
    if h in seen or "recherche" in h or "facebook" in h or "twitter" in h or "linkedin" in h:
        continue
    seen.add(h)
    if pat.search(x) or pat.search(h):
        print(h, "|", x[:110])
