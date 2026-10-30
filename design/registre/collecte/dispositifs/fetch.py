"""Polite fetcher: obeys robots.txt, >=2 s between requests per host, fixed UA, manifest log.

Usage: python -I fetch.py <out_dir> <url> [<filename>]
Prints status, content-type, size and saved path. Appends to <out_dir>/manifest.tsv.
"""
import sys
import datetime, hashlib, json, os, sys, time, urllib.parse, urllib.robotparser
import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))  # scripts/: robots_rule
from robots_rule import decide  # noqa: E402

UA = "SurveillanceWorld-research (+<contact>)"
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".last_request.json")


def wait_host(host):
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    last = st.get(host, 0)
    d = time.time() - last
    if d < 2.5:
        time.sleep(2.5 - d)
    st[host] = time.time()
    json.dump(st, open(STATE, "w"))


def robots_ok(url):
    p = urllib.parse.urlparse(url)
    rurl = f"{p.scheme}://{p.netloc}/robots.txt"
    wait_host(p.netloc)
    try:
        r = requests.get(rurl, headers={"User-Agent": UA}, timeout=30)
        status, text = r.status_code, r.text
    except Exception as e:  # unreachable: RFC 9309 says full disallow
        print("robots fetch error", e)
        status, text = None, ""
    return decide(status, text, url, UA)


def main():
    out, url = sys.argv[1], sys.argv[2]
    name = sys.argv[3] if len(sys.argv) > 3 else None
    ok, info = robots_ok(url)
    if not ok:
        print("DISALLOWED by robots.txt:", url)
        print(info)
        sys.exit(2)
    host = urllib.parse.urlparse(url).netloc
    for attempt in range(3):
        wait_host(host)
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=90)
            break
        except Exception as e:
            print("error", e)
            time.sleep(5 * (attempt + 1))
    else:
        sys.exit(1)
    if not name:
        name = hashlib.sha1(url.encode()).hexdigest()[:12]
        ct = r.headers.get("content-type", "")
        ext = ".pdf" if "pdf" in ct else ".html" if "html" in ct else ".json" if "json" in ct else ".bin"
        name += ext
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, name)
    with open(path, "wb") as f:
        f.write(r.content)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    with open(os.path.join(out, "manifest.tsv"), "a") as f:
        f.write(f"{now}\t{r.status_code}\t{len(r.content)}\t{hashlib.sha256(r.content).hexdigest()}\t{name}\t{r.url}\n")
    print(r.status_code, r.headers.get("content-type"), len(r.content), path, "final:", r.url)


if __name__ == "__main__":
    main()
