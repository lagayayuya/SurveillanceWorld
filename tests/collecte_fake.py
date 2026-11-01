"""The collection tests' fixtures and fake server (tests/fixtures/collecte)."""

from __future__ import annotations

import datetime as dt
import http.server
import json
import threading
import urllib.parse
from collections.abc import Iterator
from pathlib import Path

import lacarte_registre as registre
from lacarte_collecte import parse_raa
from lacarte_collecte.contexte import Contexte
from lacarte_registre import fetch

FIX = Path(__file__).parent / "fixtures" / "collecte"
DILA = FIX / "dila"
COMMUNES = {
    "communes": {
        "69133": {"nom": "Mions", "dep": "69"}, "69282": {"nom": "Meyzieu", "dep": "69"},
        "69072": {"nom": "Décines-Charpieu", "dep": "69"},
        "69290": {"nom": "Saint-Bonnet-de-Mure", "dep": "69"},
        "57463": {"nom": "Metz", "dep": "57"}, "57751": {"nom": "Woippy", "dep": "57"},
        "97407": {"nom": "Le Port", "dep": "974"}, "97411": {"nom": "Saint-Denis", "dep": "974"},
    }
}  # fmt: skip
KINDS = parse_raa.types(registre.RULES / "collecte_actes.yaml")


def raa(name: str) -> dict:
    return json.loads((FIX / "attrap" / f"raa_{name}.json").read_text("utf-8"))


def communes(dep: str) -> parse_raa.Communes:
    return parse_raa.Communes(COMMUNES["communes"], {dep})


# --- the sources, on a fake server ----------------------------------------------------------------
class Fake(http.server.ThreadingHTTPServer):
    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), Handler)
        self.asked: list[str] = []
        self.rows = json.loads((FIX / "dgcl" / "lignes-2025.json").read_text("utf-8"))

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"


ATTRAP = {"pref69": raa("pref69"), "pref974": raa("pref974")}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        srv: Fake = self.server  # type: ignore[assignment]
        url = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        srv.asked.append(self.path)
        status, ctype, body = 200, "application/json", b""
        path = url.path
        if path == "/robots.txt":
            status, ctype, body = 404, "text/plain", b"no rule"
        elif path.startswith("/dila/"):
            local = DILA / path.removeprefix("/dila/")
            if local.is_dir() and (local / "index.html").is_file():
                ctype, body = "text/html", (local / "index.html").read_bytes()
            elif local.is_file():
                ctype, body = "application/octet-stream", local.read_bytes()
            else:
                status, ctype, body = 404, "text/plain", b"not found"
        elif path == "/dgcl/dataset":
            body = (FIX / "dgcl" / "dataset.json").read_bytes()
        elif path.startswith("/tabular/"):
            year_2025 = "e621419d" in path
            rows = [r for r in srv.rows if q["intitule__contains"].lower() in r["intitule"].lower()]
            rows = rows if year_2025 else []
            body = json.dumps({"data": rows, "meta": {"page": 1, "page_size": 200,
                                                      "total": len(rows)}}).encode()  # fmt: skip
        elif path.startswith("/api/v1/administration/"):
            aid = path.rsplit("/", 1)[-1]
            body = json.dumps(
                {"elements": [{"date": ATTRAP[aid]["date"]}] if aid in ATTRAP else []}
            ).encode()
        elif path == "/api/v1/search":
            d = ATTRAP.get(q["administration"])
            ok = d and q["start_date"] <= d["date"] <= q["end_date"] and "aéronefs" in q["s"]
            el = [{k: d[k] for k in ("id", "date", "name", "url")}] if ok else []
            body = json.dumps({"total": len(el), "elements": el}).encode()
        elif path.startswith("/api/v1/raa/"):
            rid = path.rsplit("/", 1)[-1]
            d = next(v for v in ATTRAP.values() if v["id"] == rid)
            body = json.dumps(d).encode()
        elif path.startswith("/pdf/"):
            ctype, body = "application/pdf", b"%PDF-1.7 first bytes"
        else:
            status, ctype, body = 404, "text/plain", b"not found"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", "Wed, 14 Oct 2026 22:15:00 GMT")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


def serve() -> Iterator[Fake]:
    """The fake server, for conftest's `collecte_server` fixture."""
    s = Fake()
    threading.Thread(target=s.serve_forever, daemon=True).start()
    yield s
    s.shutdown()
    s.server_close()


def ctx_for(
    server: Fake, tmp_path: Path, today: dt.date, rules_dir: Path | None = None
) -> Contexte:
    conf = fetch.rules()
    conf["hosts"]["default"]["interval_s"] = 0
    conf["retries"].update(attempts=1, first_wait_s=0, timeout_s=10)
    b = server.base
    src = conf["sources"]
    src["boamp"].update(archive=f"{b}/dila/", first_year=2024)
    src["dgcl"].update(dataset=f"{b}/dgcl/dataset", tabular=f"{b}/tabular/{{resource}}/data/")
    src["attrap"].update(api=f"{b}/api/v1/", depuis="2026-06-01")
    (tmp_path / "communes.json").write_text(json.dumps(COMMUNES), "utf-8")
    return Contexte(
        root=tmp_path, sortie=tmp_path / "sortie", rules_dir=rules_dir or registre.RULES,
        today=today, contact="https://example.org/contact", conf=conf,
    )  # fmt: skip
