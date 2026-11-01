"""An official PDF, read then thrown away: its text page by page with pdftotext (poppler), and
OCR (tesseract, French: the accents kept) for the pages that have no text layer. Used only
when Attrap's text of a recueil is missing or unreadable, and by our own slow crawl; never
on the hosts behind an anti-robot check. The PDF is written to a temporary file in the
collection's folder and deleted in every case, the text is never kept."""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

from lacarte_registre import fetch

FUNCTION_WORDS = re.compile(r"\b(?:le|la|les|de|des|du|et|en|est|par|au|aux)\b", re.I)


def readable(text: str) -> bool:
    """A page (or a recueil's text) a reader can use: enough letters and French words."""
    s = re.sub(r"\s+", "", text)
    if len(s) < 80:
        return False
    letters = sum(c.isalpha() for c in s) / len(s)
    return letters >= 0.55 and len(FUNCTION_WORDS.findall(text)) >= 2


def _run(cmd: list[str], data: bytes | None = None) -> bytes:
    return subprocess.run(cmd, input=data, capture_output=True, check=False, timeout=600).stdout


def pages(path: Path, ocr: bool = True) -> tuple[list[str], int]:
    """The PDF's text, one string per page; the number of pages read by OCR."""
    info = _run(["pdfinfo", str(path)]).decode("utf-8", "replace")
    m = re.search(r"Pages:\s+(\d+)", info)
    n = int(m.group(1)) if m else 0
    out, scanned = [], 0
    for p in range(1, n + 1):
        t = _run(["pdftotext", "-f", str(p), "-l", str(p), "-layout", str(path), "-"])
        text = t.decode("utf-8", "replace").rstrip("\f")
        if ocr and not readable(text):
            png = _run(
                ["pdftoppm", "-f", str(p), "-l", str(p), "-r", "200", "-gray", "-png", str(path)]
            )
            if png:
                text = _run(["tesseract", "-", "-", "-l", "fra"], png).decode("utf-8", "replace")
                scanned += 1
        out.append(text)
    return out, scanned


def read(f: fetch.Fetcher, url: str, tmp_dir: Path) -> tuple[str | None, dict[str, int]]:
    """Download `url`, read it, delete it: (its text, pages separated by form feeds, or None
    when it is not a PDF), {"pages", "pages_ocr"}."""
    tmp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=tmp_dir) as d:
        dest = Path(d) / "document.pdf"
        f.download(url, dest)
        if dest.read_bytes()[:4] != b"%PDF":
            return None, {"pages": 0, "pages_ocr": 0}
        texts, scanned = pages(dest)
    return "\f".join(texts), {"pages": len(texts), "pages_ocr": scanned}
