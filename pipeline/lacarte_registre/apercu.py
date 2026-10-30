"""The records' preview images (lot R3 § 6): 1200 × 630 PNG, one per territory, buyer and
company, one per type of document, drawn here (Pillow), no third-party service.

The template is the mockup's (design/registre/v2/maquettes/V2-Partage.dc.html, capture 06),
one for every type: its fixed layers cut from the mockup as it renders
(web/scripts/apercu-calques.mjs → apercu/fond.png: the dark map, the logo, « Le registre »;
apercu/etiquette-<type>.png: the type's label, pictogram, word and colour), then what changes,
set as the mockup's CSS sets it (the constants below): the name (two lines at most), the line
under it, the three figures. The fonts are the site's own (web/src/theme/fonts).

Only what changed is drawn again: an image's fingerprint covers what it shows and the
template (this file, the layers, the fonts); the drawn images are kept by fingerprint in
data/registre/apercu-cache/ and linked into the site at each build, the unused ones dropped.
"""

from __future__ import annotations

import functools
import hashlib
import json
import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from lacarte import regions

HERE = Path(__file__).with_name("apercu")
FONTS = regions.ROOT / "web" / "src" / "theme" / "fonts"
ARCHIVO = FONTS / "archivo-800-900-62-100.woff2"
ELITE = FONTS / "special-elite.woff2"
W, H = 1200, 630
# The mockup's CSS (.og .ogname, .ogsub, .ogfig): positions in pixels, colours, sizes.
LEFT = 60
NAME = {"size": 76, "weight": 900, "width": 72, "line": 0.98, "max": 1060, "lines": 2,
        "colour": "#f2efe6", "shadow": "#7fd4ff", "offset": 5}  # fmt: skip
SUB = {"size": 24, "colour": "#d9d3c7", "max": 1000, "gap": 12}
FIG = {"bottom": 44, "gap": 22, "border": 3, "pad": (10, 18, 12), "min": 200, "line": 1.45,
       "bg": "#f2efe6", "ink": "#111111", "shadow": "#7fd4ff", "offset": 6,
       "n": {"size": 54, "weight": 900, "width": 62}, "label": 21}  # fmt: skip


# The colours every image keeps exactly: the template's own (the cream, the ink, the shadow, the
# logo's pink, the types' colours).
EXACT = ("#f2efe6", "#111111", "#7fd4ff", "#d9d3c7", "#ff48b0", "#ff7cc6", "#ffe800", "#9be7c4",
         "#c9b8ff")  # fmt: skip


@functools.cache
def _palette() -> Any:
    """One palette for every image: the map's colours (fond.png, 240 of them) and EXACT; an
    image mapped onto it without dithering is a third of its full colour size, the same
    colours in every image, and fast to write."""
    from PIL import Image

    fond = Image.open(HERE / "fond.png").convert("RGB")
    pal = fond.quantize(256 - len(EXACT) - 7, method=Image.Quantize.FASTOCTREE).getpalette()
    colours = pal[: 3 * (256 - len(EXACT) - 7)]
    for c in EXACT:
        colours += [int(c[i : i + 2], 16) for i in (1, 3, 5)]
    out = Image.new("P", (1, 1))
    out.putpalette(colours + [0] * (768 - len(colours)))
    return out


@functools.cache
def _layers() -> dict[str, Any]:
    return json.loads((HERE / "calques.json").read_text(encoding="utf-8"))


@functools.cache
def version() -> str:
    """The template's fingerprint: this file, its layers, its fonts."""
    h = hashlib.sha256()
    for p in [Path(__file__), *sorted(HERE.iterdir()), ARCHIVO, ELITE]:
        h.update(p.name.encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:16]


def empreinte(spec: dict[str, Any]) -> str:
    shown = {k: spec.get(k) for k in ("titre", "identite", "chiffres", "etiquette")}
    data = json.dumps([version(), shown], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(data.encode()).hexdigest()[:24]


@functools.cache
def _font(path: Path, size: int, weight: int | None = None, width: int | None = None) -> Any:
    from PIL import ImageFont

    f = ImageFont.truetype(str(path), size)
    if weight is not None:
        f.set_variation_by_axes([weight, width])
    return f


def _ellipsis(draw: Any, text: str, font: Any, width: float) -> str:
    if draw.textlength(text, font=font) <= width:
        return text
    while text and draw.textlength(text + "…", font=font) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _lines(draw: Any, text: str, font: Any, width: float, most: int) -> list[str]:
    """Words wrapped to `width`, at most `most` lines, the last one cut with « … »."""
    out: list[str] = []
    cur = ""
    words = text.split()
    for i, w in enumerate(words):
        nxt = f"{cur} {w}".strip()
        if draw.textlength(nxt, font=font) <= width or not cur:
            cur = nxt
            continue
        out.append(cur)
        cur = w
        if len(out) == most - 1:
            cur = " ".join(words[i:])
            break
    out.append(cur)
    out = out[:most]
    out[-1] = _ellipsis(draw, out[-1], font, width)
    return out


def _baseline(font: Any, top: float, line: float) -> float:
    """Where the baseline of a line of height `line` starting at `top` falls (CSS: the
    half-leading above the font's ascent)."""
    asc, desc = font.getmetrics()
    return top + (line - (asc + desc)) / 2 + asc


def dessiner(spec: dict[str, Any], out: Path) -> None:
    from PIL import Image, ImageDraw

    img = Image.open(HERE / "fond.png").convert("RGB")
    lab = _layers()["etiquettes"][spec["etiquette"]]
    sticker = Image.open(HERE / f"etiquette-{spec['etiquette']}.png").convert("RGBA")
    img.paste(sticker, (lab["x"], lab["y"]), sticker)
    d = ImageDraw.Draw(img)
    # the name, in capitals, two lines at most, its shadow under it
    nf = _font(ARCHIVO, NAME["size"], NAME["weight"], NAME["width"])
    lh = NAME["size"] * NAME["line"]
    top = lab["nom_y"]
    for line in _lines(d, spec["titre"].upper(), nf, NAME["max"], NAME["lines"]):
        y = _baseline(nf, top, lh)
        o = NAME["offset"]
        d.text((LEFT + o, y + o), line, font=nf, fill=NAME["shadow"], anchor="ls")
        d.text((LEFT, y), line, font=nf, fill=NAME["colour"], anchor="ls")
        top += lh
    # the line under it
    if spec.get("identite"):
        sf = _font(ELITE, SUB["size"])
        asc, desc = sf.getmetrics()
        y = _baseline(sf, top + SUB["gap"], asc + desc)
        text = _ellipsis(d, spec["identite"], sf, SUB["max"])
        d.text((LEFT, y), text, font=sf, fill=SUB["colour"], anchor="ls")
    # the three figures, in boxes along the bottom
    bf = _font(ARCHIVO, FIG["n"]["size"], FIG["n"]["weight"], FIG["n"]["width"])
    lf = _font(ELITE, FIG["label"])
    pt, px, pb = FIG["pad"]
    b = FIG["border"]
    lab_h = FIG["label"] * FIG["line"]
    box_h = FIG["n"]["size"] + lab_h + pt + pb + 2 * b
    y0 = H - FIG["bottom"] - box_h
    x = LEFT
    for f in spec["chiffres"][:3]:
        inner = max(FIG["min"], d.textlength(f["n"], font=bf), d.textlength(f["libelle"], font=lf))
        w = inner + 2 * px + 2 * b
        o = FIG["offset"]
        d.rectangle([x + o, y0 + o, x + w - 1 + o, y0 + box_h - 1 + o], fill=FIG["shadow"])
        d.rectangle([x, y0, x + w - 1, y0 + box_h - 1], fill=FIG["bg"], outline=FIG["ink"], width=b)
        ny = _baseline(bf, y0 + b + pt, FIG["n"]["size"])
        d.text((x + b + px, ny), f["n"], font=bf, fill=FIG["ink"], anchor="ls")
        ly = _baseline(lf, y0 + b + pt + FIG["n"]["size"], lab_h)
        d.text((x + b + px, ly), f["libelle"], font=lf, fill=FIG["ink"], anchor="ls")
        x += w + FIG["gap"]
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.name}.tmp")
    img.quantize(palette=_palette(), dither=Image.Dither.NONE).save(tmp, "PNG", compress_level=6)
    tmp.replace(out)


CACHE_ENV = "LACARTE_REGISTRE_APERCUS"


def write(specs: Iterable[dict[str, Any]], site: Path, cache: Path) -> dict[str, Any]:
    """Every preview into site/apercu/<ref>.png, drawn only when its fingerprint is not in
    `cache`; the cache keeps only this build's. Returns the counts and the weight. A cache
    named by LACARTE_REGISTRE_APERCUS (the tests': one for the whole run) is shared, never
    pruned."""
    shared = os.environ.get(CACHE_ENV)
    if shared:
        cache = Path(shared)
    import time

    t0 = time.monotonic()
    cache.mkdir(parents=True, exist_ok=True)
    used, drawn, weight = set(), 0, 0
    for spec in specs:
        fp = empreinte(spec)
        kept = cache / f"{fp}.png"
        if not kept.is_file():
            dessiner(spec, kept)
            drawn += 1
        used.add(kept.name)
        dest = site / "apercu" / f"{spec['ref']}.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(kept, dest)
        except OSError:
            dest.write_bytes(kept.read_bytes())
        weight += kept.stat().st_size
    for old in [] if shared else cache.glob("*.png"):
        if old.name not in used:
            old.unlink()
    return {"images": len(used), "dessinees": drawn, "octets": weight,
            "duree_s": round(time.monotonic() - t0, 2)}  # fmt: skip
