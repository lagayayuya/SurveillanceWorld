"""List links of an HTML page whose href or text matches a regex. Usage: python -I links.py <html> <regex>"""
import html, re, sys
t = open(sys.argv[1], encoding="utf-8", errors="replace").read()
seen = set()
for h, txt in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', t, re.S):
    s = re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", " ", txt))).strip()
    if h in seen:
        continue
    seen.add(h)
    if re.search(sys.argv[2], h + " " + s, re.I):
        print(h, "|", s[:100])
