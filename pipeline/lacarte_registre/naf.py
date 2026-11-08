"""The labels of INSEE's activity nomenclature (NAF rév. 2, its 732 sous-classes): what turns a
company's NAF code (SIRENE) into the words a page says (« 26.52Z » → « Horlogerie »).

Where (rules/registre_sources.yaml `sources.naf`): INSEE's file of the sous-classes as dBase
(naf2008_liste_n5.dbf); its Excel copies are forbidden to robots by www.insee.fr's
robots.txt (`Disallow: *.xls`, read on 2026-11-08), the dBase is not. One request, kept by
ETag / Last-Modified.

Out: <root>/national/naf.json {"source": url, "libelles": {code: label}}.
"""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path
from typing import Any

from lacarte_registre import fetch

SOURCE = "naf"
CODE = re.compile(r"^\d{2}\.\d{2}[A-Z]$")


def lire_dbf(data: bytes, encoding: str) -> list[dict[str, str]]:
    """The records of a dBase III file: its field descriptors (32 bytes each after the
    32-byte header, up to 0x0D), then fixed-width records, a deleted one (« * ») left out."""
    n, header, size = struct.unpack("<IHH", data[4:12])
    fields, pos = [], 32
    while data[pos] != 0x0D:
        name = data[pos : pos + 11].split(b"\0")[0].decode(encoding)
        fields.append((name, data[pos + 16]))
        pos += 32
    out = []
    for i in range(n):
        rec = data[header + i * size : header + (i + 1) * size]
        if not rec or rec[:1] == b"*":
            continue
        row, at = {}, 1
        for name, width in fields:
            row[name] = rec[at : at + width].decode(encoding).strip()
            at += width
        out.append(row)
    return out


def libelles(rows: list[dict[str, str]]) -> dict[str, str]:
    """{code: label}: the field whose values are NAF codes, and the longest text beside it."""
    if not rows:
        return {}
    code_f = next(k for k in rows[0] if all(CODE.match(r[k]) for r in rows[:50]))
    label_f = max((k for k in rows[0] if k != code_f), key=lambda k: sum(len(r[k]) for r in rows))
    return {r[code_f]: r[label_f] for r in rows if CODE.match(r[code_f])}


def collect(f: fetch.Fetcher, out_dir: Path) -> dict[str, Any]:
    src = f.conf["sources"][SOURCE]
    resp = f.get(src["url"])
    labels = libelles(lire_dbf(resp.body, src["encodage"]))
    out = out_dir / "naf.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"source": src["url"], "libelles": labels}, ensure_ascii=False),
                   "utf-8")  # fmt: skip
    return {"source": SOURCE, "libelles": len(labels), "requetes": f.requests}
