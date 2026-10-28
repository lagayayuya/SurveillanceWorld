"""`lacarte-registre importer-pilote [DIR]`: the pilot export, read as data.

The pilot's files are scripts of assignments, `window.NAME = <JSON>;`, one or several per
file, between `//` comment lines; a file of départements also merges keyed values
(`window.DEP = window.DEP || {};` then `window.DEP["69"] = <JSON>;`). They are read as JSON
and never evaluated: any other statement refuses the whole file. One file of hand-written
labels is an object literal (bare keys, trailing commas, comments): it is read through a
narrow relaxed reader that quotes the keys and drops the commas, and refuses any other
bare word, so a function call or a variable never passes.

Out: data/registre/pilote/<NAME>.json, one per global, and pilote.json: each source file
with its sha256 and the globals it gave, the import date and the export's own build date.
The export's site address (site.js) and its pre-drawn neighbour maps (geo/mini.js) are not
read: the registre needs neither.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from pathlib import Path
from typing import Any

import lacarte_registre as registre
from lacarte_registre import sortie

# The pilot export's files, relative to its folder; the first one is required.
SOURCES = (
    "prototype-v4/registre.js",
    "prototype-v12/acheteurs.js",
    "prototype-v12/zones.js",
    "prototype-v12/faits.js",
    "prototype-v12/libelles.js",
    "prototype-v12/epcis.js",
    "prototype-v12/lieux_avis.js",
    "prototype-v12/seuils.js",
    "prototype-v12/geo/cartes.js",
    "prototype-v12/geo/voisins.js",
)
DEP_FILES = "prototype-v12/geo/dep-*.js"
# The tilted commune maps' layers (cameras, filmed streets, fields of view, the commune's outline),
# cut from the map's build by commune: plain JSON, OpenStreetMap-derived (ODbL); kept as they are
# under pilote/carte/ and served by construire beside the register's files.
MAP_FILES = "prototype-v10/carte/*.json"
MAP_KEYS = ("insee", "bbox", "contour", "cams")

_NAME = r"[A-Za-z_$][\w$]*"
_ASSIGN = re.compile(rf'window\.({_NAME})(\["[^"\\]*"\])?[ \t]*=[ \t]*')
_INIT = re.compile(rf"window\.({_NAME})[ \t]*=[ \t]*window\.\1[ \t]*\|\|[ \t]*\{{\}}[ \t]*;")
_WORDS = {"true", "false", "null"}
_STRING = re.compile(r'"(?:[^"\\\n]|\\.)*"')
_WORD = re.compile(_NAME)
_BLANKS = re.compile(r"[ \t]*")
# Globals that several files fill, one key each (the départements' outlines).
MERGED = frozenset({"DEP"})


class NotPilotFile(ValueError):
    """A file that is not made of `window.NAME = <JSON>;` assignments."""


def _skip(text: str, pos: int) -> int:
    """Past blanks and `//` comments."""
    while pos < len(text):
        if text[pos].isspace():
            pos += 1
        elif text.startswith("//", pos):
            end = text.find("\n", pos)
            pos = len(text) if end < 0 else end + 1
        else:
            break
    return pos


def _line(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def _relaxed(text: str, pos: int, where: str) -> tuple[Any, int]:
    """An object or array literal whose keys may be bare words and whose lists may end
    with a comma, as JSON; any other bare word refuses it."""
    if text[pos : pos + 1] not in ("{", "["):
        raise NotPilotFile(f"{where}: line {_line(text, pos)}: not a JSON value")
    out: list[str] = []
    depth = 0
    i = pos
    while i < len(text):
        c = text[i]
        if c == '"':
            m = _STRING.match(text, i)
            if not m:
                raise NotPilotFile(f"{where}: line {_line(text, i)}: unterminated string")
            out.append(m.group())
            i = m.end()
            continue
        if text.startswith("//", i):
            i = _skip(text, i)
            continue
        if c in "{[":
            depth += 1
        elif c in "}]":
            while out and out[-1].isspace():
                out.pop()
            if out and out[-1] == ",":
                out.pop()
            depth -= 1
            if depth == 0:
                out.append(c)
                return json.loads("".join(out)), i + 1
        elif re.match(r"[A-Za-z_$]", c):
            m = _WORD.match(text, i)
            assert m
            word, after = m.group(), _skip(text, m.end())
            if text[after : after + 1] == ":":
                out.append(json.dumps(word))
            elif word in _WORDS:
                out.append(word)
            else:
                raise NotPilotFile(f"{where}: line {_line(text, i)}: `{word}` is not data")
            i = m.end()
            continue
        out.append(c)
        i += 1
    raise NotPilotFile(f"{where}: unterminated literal")


def parse(text: str, where: str = "<text>") -> dict[str, Any]:
    """The globals a pilot file assigns, {NAME: value}."""
    decoder = json.JSONDecoder()
    found: dict[str, Any] = {}
    pos = _skip(text, 0)
    while pos < len(text):
        init = _INIT.match(text, pos)
        if init:
            if not isinstance(found.setdefault(init.group(1), {}), dict):
                raise NotPilotFile(f"{where}: line {_line(text, pos)}: {init.group(1)} redefined")
            pos = _skip(text, init.end())
            continue
        m = _ASSIGN.match(text, pos)
        if not m:
            raise NotPilotFile(
                f"{where}: line {_line(text, pos)}: not a `window.NAME = <JSON>;` assignment"
            )
        try:
            value, end = decoder.raw_decode(text, m.end())
        except json.JSONDecodeError:
            try:
                value, end = _relaxed(text, m.end(), where)
            except json.JSONDecodeError as e:
                raise NotPilotFile(f"{where}: line {_line(text, m.end())}: {e}") from e
        end = _BLANKS.match(text, end).end()
        if text[end : end + 1] != ";":
            raise NotPilotFile(f"{where}: line {_line(text, end)}: `;` expected after the value")
        name, key = m.group(1), m.group(2)
        if key:
            target = found.get(name)
            if not isinstance(target, dict):
                raise NotPilotFile(f"{where}: line {_line(text, pos)}: {name} is not an object")
            target[json.loads(key[1:-1])] = value
        elif name in found:
            raise NotPilotFile(f"{where}: line {_line(text, pos)}: {name} assigned twice")
        else:
            found[name] = value
        pos = _skip(text, end + 1)
    return found


def sources(folder: Path) -> list[str]:
    """The export's files present in `folder`, relative paths; registre.js is required."""
    if not (folder / SOURCES[0]).is_file():
        raise FileNotFoundError(f"{folder}: no {SOURCES[0]} (the pilot export's folder?)")
    found = [rel for rel in SOURCES if (folder / rel).is_file()]
    found += sorted(p.relative_to(folder).as_posix() for p in folder.glob(DEP_FILES))
    return found


def run(folder: Path, root: Path | None = None) -> dict[str, Any]:
    """Import the export at `folder` into <root>/pilote; returns pilote.json's content."""
    root = root or registre.ROOT
    globals_: dict[str, Any] = {}
    files: dict[str, dict[str, Any]] = {}
    for rel in sources(folder):
        raw = (folder / rel).read_bytes()
        names = parse(raw.decode("utf-8"), rel)
        for name, value in names.items():
            if name in globals_ and name not in MERGED:
                raise NotPilotFile(f"{rel}: {name} already given by another file")
            if name in globals_:
                globals_[name].update(value)
            else:
                globals_[name] = value
        files[rel] = {"sha256": hashlib.sha256(raw).hexdigest(), "globales": sorted(names)}
    maps: dict[str, bytes] = {}
    for path in sorted(folder.glob(MAP_FILES)):
        raw = path.read_bytes()
        rel = path.relative_to(folder).as_posix()
        try:
            layer = json.loads(raw)
        except ValueError as e:
            raise NotPilotFile(f"{rel}: not JSON ({e})") from e
        if not isinstance(layer, dict) or any(k not in layer for k in MAP_KEYS):
            raise NotPilotFile(f"{rel}: a commune map needs {', '.join(MAP_KEYS)}")
        if not re.fullmatch(r"\d[\dAB]\d{3}", str(layer["insee"])) or path.stem != layer["insee"]:
            raise NotPilotFile(f"{rel}: its name is not its commune's code")
        maps[path.stem] = raw
        files[rel] = {"sha256": hashlib.sha256(raw).hexdigest(), "globales": []}
    reg = globals_.get("REG")
    if not isinstance(reg, dict) or not isinstance(reg.get("evenements"), list):
        raise NotPilotFile(f"{SOURCES[0]}: no REG with its evenements")
    manifest = {
        "v": 1,
        "date": date.today().isoformat(),
        "construit": (reg.get("meta") or {}).get("construit"),
        "fichiers": files,
    }

    def write(tmp: Path) -> None:
        for name, value in globals_.items():
            sortie.dump(tmp / f"{name}.json", value)
        sortie.dump(tmp / "pilote.json", manifest)
        if maps:
            (tmp / "carte").mkdir()
            for insee, raw in maps.items():
                (tmp / "carte" / f"{insee}.json").write_bytes(raw)

    sortie.replace_dir(root / "pilote", write)
    return manifest
