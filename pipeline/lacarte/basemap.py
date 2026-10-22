"""The self-hosted basemap, lighter: a Protomaps extract (README, `pmtiles extract`) written
again without some of its vector layers. The points of interest (`pois`) were 53 % of the
bytes of a z15 tile over Paris and most of what a pan downloaded (the author's point 7 of
the launch, after the latency bench of 2026-10-12); the names of districts and places are
in `places`, which stays. Every other layer and every tile without the dropped ones is kept
byte for byte; the archive's metadata loses the dropped layers.

With `--names fr en`, the names in other languages go too (`name:<lang>`, `pgf:name:<lang>`):
the flavour writes `name:fr`, else `name:en`, else `name` (Protomaps basemaps 5.7, lang
"fr"). A layer without such a name is kept byte for byte.

With `--undrawn`, the features of the kinds no layer of the style draws go too
(rules/basemap.yaml undrawn_kinds: most of `landuse`'s bytes at low zooms, farmland and
meadows). A layer without such a feature is kept byte for byte.

    lacarte basemap strip data/basemap/idf.pmtiles data/basemap/idf-light.pmtiles --drop pois
"""

from __future__ import annotations

import gzip
import json
import re
from collections.abc import Callable, Iterable, Iterator, Mapping
from pathlib import Path

import yaml
from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import Compression, deserialize_directory, zxy_to_tileid
from pmtiles.writer import write

from lacarte import regions

# --- the protobuf of a Mapbox Vector Tile, as little of it as is needed -----------------
# A tile is a message whose field 3 (length-delimited) repeats the layers; a layer's field 1
# is its name. Nothing else is decoded: a kept layer is copied as its bytes.


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = buf[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, i
        shift += 7


def _fields(buf: bytes) -> Iterator[tuple[int, int, int, int, int]]:
    """(field number, wire type, start of the field, start of its value, end) for each field."""
    i = 0
    while i < len(buf):
        start = i
        key, i = _varint(buf, i)
        number, wire = key >> 3, key & 7
        if wire == 0:
            _, end = _varint(buf, i)
            value = i
        elif wire == 1:
            value, end = i, i + 8
        elif wire == 2:
            length, value = _varint(buf, i)
            end = value + length
        elif wire == 5:
            value, end = i, i + 4
        else:
            raise ValueError(f"wire type {wire} in a vector tile")
        yield number, wire, start, value, end
        i = end


def _key(number: int, wire: int) -> bytes:
    return _uvarint(number << 3 | wire)


def _uvarint(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        if n:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _bytes_field(number: int, data: bytes) -> bytes:
    return _key(number, 2) + _uvarint(len(data)) + data


def layer_name(layer: bytes) -> str:
    for number, wire, _, value, end in _fields(layer):
        if number == 1 and wire == 2:
            return layer[value:end].decode()
    raise ValueError("a layer without a name")


def layer_names(tile: bytes) -> list[str]:
    """The layers of an uncompressed vector tile, in order."""
    return [layer_name(tile[v:e]) for n, w, _, v, e in _fields(tile) if n == 3 and w == 2]


def drop_layers(tile: bytes, drop: Iterable[str]) -> bytes:
    """The uncompressed vector tile without the layers named in `drop`; the same bytes when
    it has none of them."""
    drop = set(drop)
    kept: list[bytes] = []
    dropped = False
    for number, wire, start, value, end in _fields(tile):
        if number == 3 and wire == 2 and layer_name(tile[value:end]) in drop:
            dropped = True
            continue
        kept.append(tile[start:end])
    return b"".join(kept) if dropped else tile


def name_keys(langs: Iterable[str]) -> Callable[[str], bool]:
    """Whether a property is a name in a language not in `langs` (to drop)."""
    kept = {f"name:{lang}" for lang in langs}
    other = re.compile(r"^(pgf:)?name:.+$")
    return lambda k: bool(other.match(k)) and k not in kept


def drop_keys_in_layer(layer: bytes, dropped: Callable[[str], bool]) -> bytes:
    """The layer message without the properties whose key `dropped` says, its keys and values
    renumbered (the values no feature uses any more go too); the same bytes when it has none."""
    keys: list[str] = []
    values: list[bytes] = []
    for number, wire, _, value, end in _fields(layer):
        if number == 3 and wire == 2:
            keys.append(layer[value:end].decode())
        elif number == 4 and wire == 2:
            values.append(layer[value:end])
    if not any(dropped(k) for k in keys):
        return layer
    new_key = {}
    for i, k in enumerate(keys):
        if not dropped(k):
            new_key[i] = len(new_key)
    new_value: dict[int, int] = {}
    features: list[bytes] = []
    for number, wire, _, value, end in _fields(layer):
        if number != 2 or wire != 2:
            continue
        feature = layer[value:end]
        out = bytearray()
        for fn, fw, fs, fv, fe in _fields(feature):
            if fn != 2 or fw != 2:
                out += feature[fs:fe]
                continue
            tags, i = [], fv
            while i < fe:
                t, i = _varint(feature, i)
                tags.append(t)
            packed = bytearray()
            for k, v in zip(tags[0::2], tags[1::2], strict=True):
                if k in new_key:
                    v = new_value.setdefault(v, len(new_value))
                    packed += _uvarint(new_key[k]) + _uvarint(v)
            if packed:
                out += _bytes_field(2, bytes(packed))
        features.append(_bytes_field(2, bytes(out)))
    by_new = sorted(new_value, key=new_value.get)
    out = bytearray()
    written = False
    for number, wire, start, _, end in _fields(layer):
        if number in (2, 3, 4) and wire == 2:
            if not written:  # features, keys and values where the first of them was
                out += b"".join(features)
                out += b"".join(_bytes_field(3, keys[i].encode()) for i in new_key)
                out += b"".join(_bytes_field(4, values[v]) for v in by_new)
                written = True
            continue
        out += layer[start:end]
    return bytes(out)


def drop_keys(tile: bytes, dropped: Callable[[str], bool]) -> bytes:
    """The uncompressed vector tile without the properties `dropped` says, in every layer;
    the same bytes when no layer has one."""
    parts: list[bytes] = []
    changed = False
    for number, wire, start, value, end in _fields(tile):
        if number == 3 and wire == 2:
            layer = tile[value:end]
            lighter = drop_keys_in_layer(layer, dropped)
            if lighter is not layer:
                changed = True
                parts.append(_bytes_field(3, lighter))
                continue
        parts.append(tile[start:end])
    return b"".join(parts) if changed else tile


def undrawn_kinds() -> dict[str, frozenset[str]]:
    """Layer -> the kinds of its features no layer of the style draws (rules/basemap.yaml)."""
    rules = yaml.safe_load((regions.ROOT / "rules" / "basemap.yaml").read_text())
    return {layer: frozenset(kinds) for layer, kinds in rules["undrawn_kinds"].items()}


def drop_kinds_in_layer(layer: bytes, kinds: frozenset[str]) -> bytes:
    """The layer message without its features whose `kind` is one of `kinds`; the same bytes
    when it has none. Keys and values stay as they were (a value no feature uses any more is
    a few bytes, and still a valid layer)."""
    keys: list[str] = []
    values: list[bytes] = []
    for number, wire, _, value, end in _fields(layer):
        if number == 3 and wire == 2:
            keys.append(layer[value:end].decode())
        elif number == 4 and wire == 2:
            values.append(layer[value:end])
    if "kind" not in keys:
        return layer
    kind_key = keys.index("kind")
    # Value messages whose string_value (field 1) is a dropped kind.
    dropped_values = set()
    for i, v in enumerate(values):
        for number, wire, _, start, end in _fields(v):
            if number == 1 and wire == 2 and v[start:end].decode() in kinds:
                dropped_values.add(i)
    if not dropped_values:
        return layer
    out = bytearray()
    dropped = False
    for number, wire, start, value, end in _fields(layer):
        if number == 2 and wire == 2 and _kind_value(layer[value:end], kind_key) in dropped_values:
            dropped = True
            continue
        out += layer[start:end]
    return bytes(out) if dropped else layer


def _kind_value(feature: bytes, kind_key: int) -> int | None:
    """The index of the value a feature gives the key `kind_key`, if any."""
    for number, wire, _, value, end in _fields(feature):
        if number == 2 and wire == 2:
            i = value
            while i < end:
                k, i = _varint(feature, i)
                v, i = _varint(feature, i)
                if k == kind_key:
                    return v
    return None


def drop_kinds(tile: bytes, kinds: Mapping[str, frozenset[str]]) -> bytes:
    """The uncompressed vector tile without the features of the kinds `kinds` names for their
    layer; the same bytes when it has none."""
    parts: list[bytes] = []
    changed = False
    for number, wire, start, value, end in _fields(tile):
        if number == 3 and wire == 2:
            layer = tile[value:end]
            wanted = kinds.get(layer_name(layer))
            if wanted:
                lighter = drop_kinds_in_layer(layer, wanted)
                if lighter is not layer:
                    changed = True
                    parts.append(_bytes_field(3, lighter))
                    continue
        parts.append(tile[start:end])
    return b"".join(parts) if changed else tile


# --- the archive --------------------------------------------------------------------------


def _entries(get_bytes, header) -> Iterator[tuple[int, int, int, int]]:
    """(tile id, run length, offset, length) of every tile entry, in tile id order."""

    def walk(offset: int, length: int):
        for e in deserialize_directory(get_bytes(offset, length)):
            if e.run_length:
                yield e.tile_id, e.run_length, e.offset, e.length
            else:
                yield from walk(header["leaf_directory_offset"] + e.offset, e.length)

    yield from walk(header["root_offset"], header["root_length"])


def strip(
    src: Path,
    dst: Path,
    drop: Iterable[str],
    names: Iterable[str] | None = None,
    kinds: Mapping[str, frozenset[str]] | None = None,
) -> dict:
    """Write `src` again as `dst` without the layers `drop`, with `names` without the names
    in other languages (name_keys), with `kinds` without the features of those kinds
    (drop_kinds). Returns what it did: the tiles changed, the bytes of tile data before and
    after."""
    drop = sorted(set(drop))
    dropped = name_keys(names) if names is not None else None
    with open(src, "rb") as f:
        reader = Reader(MmapSource(f))
        header = reader.header()
        metadata = reader.metadata()
        if header["tile_compression"] not in (Compression.GZIP, Compression.NONE):
            raise ValueError(f"tile compression {header['tile_compression']} not handled")
        gz = header["tile_compression"] == Compression.GZIP
        stats = {"tiles": 0, "changed": 0, "bytes_before": 0, "bytes_after": 0}
        done: dict[int, bytes] = {}  # a content's offset -> its new bytes (shared runs)
        with write(dst) as writer:
            for tile_id, run, offset, length in _entries(reader.get_bytes, header):
                if offset not in done:
                    data = reader.get_bytes(header["tile_data_offset"] + offset, length)
                    raw = gzip.decompress(data) if gz else data
                    lighter = drop_layers(raw, drop)
                    if dropped is not None:
                        lighter = drop_keys(lighter, dropped)
                    if kinds:
                        lighter = drop_kinds(lighter, kinds)
                    if lighter is not raw:
                        stats["changed"] += 1
                        data = gzip.compress(lighter, mtime=0) if gz else lighter
                    done[offset] = data
                    stats["bytes_before"] += length
                    stats["bytes_after"] += len(data)
                for i in range(run):
                    writer.write_tile(tile_id + i, done[offset])
                    stats["tiles"] += 1
            layers = metadata.get("vector_layers")
            if isinstance(layers, list):
                layers = [v for v in layers if v.get("id") not in drop]
                if dropped is not None:
                    layers = [_without_fields(v, dropped) for v in layers]
                metadata = {**metadata, "vector_layers": layers}
            writer.finalize(header, metadata)
    return stats


def _without_fields(layer: dict, dropped: Callable[[str], bool]) -> dict:
    fields = layer.get("fields")
    if not isinstance(fields, dict):
        return layer
    return {**layer, "fields": {k: v for k, v in fields.items() if not dropped(k)}}


def tile(path: Path, z: int, x: int, y: int) -> bytes | None:
    """One tile of an archive, uncompressed (tests, checks)."""
    with open(path, "rb") as f:
        reader = Reader(MmapSource(f))
        data = reader.get(z, x, y)
        if data is None:
            return None
        gz = reader.header()["tile_compression"] == Compression.GZIP
        return gzip.decompress(data) if gz else data


def main(
    src: str, dst: str, drop: list[str], names: list[str] | None = None, undrawn: bool = False
) -> None:
    kinds = undrawn_kinds() if undrawn else None
    stats = strip(Path(src), Path(dst), drop, names, kinds)
    shown = {k: sorted(v) for k, v in kinds.items()} if kinds else None
    print(json.dumps({"dropped": sorted(set(drop)), "names": names, "kinds": shown, **stats}))


__all__ = [
    "drop_keys",
    "drop_kinds",
    "drop_layers",
    "layer_names",
    "name_keys",
    "strip",
    "tile",
    "undrawn_kinds",
    "zxy_to_tileid",
]
