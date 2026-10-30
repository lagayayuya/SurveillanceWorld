"""Polite fetcher for the subsidies strand.

Obeys robots.txt (cached per host), waits >=2.5 s between requests to a host,
fixed User-Agent, appends url / UTC date / status / bytes / sha256 / file to
<out_dir>/manifest.tsv.

Usage: python -I fetch.py <out_dir> <url> <filename> [--no-robots-cache]
Exit 2 if robots.txt disallows, 3 if HTTP >= 400 (file still saved for evidence).
"""
import datetime, hashlib, json, os, sys, time, urllib.parse, urllib.robotparser
import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))  # scripts/: robots_rule
from robots_rule import decide  # noqa: E402

UA = "SurveillanceWorld-research (+<contact>)"
HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, ".last_request.json")


def wait_host(host):
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    d = time.time() - st.get(host, 0)
    if d < 2.5:
        time.sleep(2.5 - d)
    st[host] = time.time()
    json.dump(st, open(STATE, "w"))


def robots_ok(url, out):
    p = urllib.parse.urlparse(url)
    cache = os.path.join(out, "robots")
    os.makedirs(cache, exist_ok=True)
    cpath = os.path.join(cache, p.netloc + ".txt")
    if os.path.exists(cpath):
        txt, status = open(cpath).read(), 200
        if txt.startswith("#STATUS "):
            status = int(txt.split()[1])
    else:
        wait_host(p.netloc)
        try:
            r = requests.get(f"{p.scheme}://{p.netloc}/robots.txt", headers={"User-Agent": UA}, timeout=30)
            status, txt = r.status_code, r.text
        except Exception as e:
            status, txt = 599, str(e)
        with open(cpath, "w") as f:
            f.write(txt if status < 400 else f"#STATUS {status}\n")
    return decide(None if status == 599 else status, txt, url, UA)  # RFC 9309: 5xx/unreachable = full disallow


def main():
    out, url, name = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)
    ok, info = robots_ok(url, out)
    if not ok:
        print("DISALLOWED by robots.txt:", url)
        sys.exit(2)
    host = urllib.parse.urlparse(url).netloc
    for attempt in range(3):
        wait_host(host)
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=120)
            break
        except Exception as e:
            print("error", e)
            time.sleep(5 * (attempt + 1))
    else:
        sys.exit(1)
    path = os.path.join(out, name)
    with open(path, "wb") as f:
        f.write(r.content)
    sha = hashlib.sha256(r.content).hexdigest()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    mpath = os.path.join(out, "manifest.tsv")
    new = not os.path.exists(mpath)
    with open(mpath, "a") as f:
        if new:
            f.write("utc\tstatus\tbytes\tsha256\tfile\turl\tfinal_url\tcontent_type\n")
        f.write(f"{now}\t{r.status_code}\t{len(r.content)}\t{sha}\t{name}\t{url}\t{r.url}\t{r.headers.get('content-type','')}\n")
    print(r.status_code, r.headers.get("content-type"), len(r.content), name, info, "final:", r.url)
    sys.exit(3 if r.status_code >= 400 else 0)


if __name__ == "__main__":
    main()
