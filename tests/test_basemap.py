"""The basemap without its points of interest (lacarte.basemap): the layer gone from every
tile, every other layer and every untouched tile byte for byte, the names of places kept."""

import gzip
from pathlib import Path

from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write

from lacarte import basemap

FIXTURE = Path(__file__).parent / "fixtures" / "ci-basemap.pmtiles"


def _layer(name: str, body: bytes = b"") -> bytes:
    """A layer message (field 3 of a tile): its name (field 1) then `body`."""
    msg = bytes([0x0A, len(name)]) + name.encode() + body
    return bytes([0x1A, len(msg)]) + msg


def test_a_tile_loses_the_named_layer_only():
    places = _layer("places", b"\x78\x02")  # version 2 (field 15, varint)
    pois = _layer("pois", b"\x78\x02")
    roads = _layer("roads")
    tile = places + pois + roads
    assert basemap.layer_names(tile) == ["places", "pois", "roads"]
    assert basemap.drop_layers(tile, ["pois"]) == places + roads
    assert basemap.drop_layers(places + roads, ["pois"]) == places + roads


def _tiles(path: Path) -> dict:
    with open(path, "rb") as f:
        return {zxy: gzip.decompress(d) for zxy, d in all_tiles(Reader(MmapSource(f)).get_bytes)}


def _archive(path: Path, tiles: dict) -> None:
    """A small gzip vector archive of `tiles` ((z, x, y) -> raw tile), as Protomaps' are."""
    with write(path) as w:
        for (z, x, y), raw in sorted(tiles.items(), key=lambda t: zxy_to_tileid(*t[0])):
            w.write_tile(zxy_to_tileid(z, x, y), gzip.compress(raw, mtime=0))
        w.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_lon_e7": 22000000,
                "min_lat_e7": 488000000,
                "max_lon_e7": 24000000,
                "max_lat_e7": 490000000,
                "center_zoom": 14,
                "center_lon_e7": 23000000,
                "center_lat_e7": 489000000,
            },  # fmt: skip
            {"vector_layers": [{"id": "places"}, {"id": "pois"}, {"id": "roads"}]},
        )


def test_the_archive_without_pois(tmp_path):
    src, out = tmp_path / "full.pmtiles", tmp_path / "light.pmtiles"
    places, pois, roads = _layer("places"), _layer("pois", b"\x78\x02"), _layer("roads")
    _archive(src, {(14, 8290, 5634): places + pois + roads, (14, 8291, 5634): places + roads,
                   (15, 16580, 11268): pois, (15, 16581, 11268): roads})  # fmt: skip
    stats = basemap.strip(src, out, ["pois"])
    before, after = _tiles(src), _tiles(out)
    assert before.keys() == after.keys() and stats["tiles"] == len(after) == 4
    assert stats["changed"] == 2 and stats["bytes_after"] < stats["bytes_before"]
    for zxy, raw in before.items():
        names = basemap.layer_names(after[zxy])
        assert names == [n for n in basemap.layer_names(raw) if n != "pois"]
        if "pois" not in basemap.layer_names(raw):
            assert after[zxy] == raw
    assert after[(14, 8290, 5634)] == places + roads
    with open(out, "rb") as f:
        r = Reader(MmapSource(f))
        assert [v["id"] for v in r.metadata()["vector_layers"]] == ["places", "roads"]
        assert (r.header()["min_zoom"], r.header()["max_zoom"]) == (14, 15)


def test_the_ci_fixture_has_no_pois_and_keeps_its_places():
    """tests/fixtures/ci-basemap.pmtiles is stripped as the served basemap is."""
    tiles = _tiles(FIXTURE)
    assert tiles and all("pois" not in basemap.layer_names(t) for t in tiles.values())
    assert any("places" in basemap.layer_names(t) for t in tiles.values())


def _varint(n: int) -> bytes:
    out = bytearray()
    while n > 0x7F:
        out.append(n & 0x7F | 0x80)
        n >>= 7
    return bytes(out + bytes([n]))


def _field(number: int, data: bytes) -> bytes:
    return _varint(number << 3 | 2) + _varint(len(data)) + data


def _string_value(s: str) -> bytes:
    return _field(1, s.encode())  # Value.string_value


def _feature(tags: list[int], geometry: bytes = b"\x09\x02\x04") -> bytes:
    packed = b"".join(_varint(t) for t in tags)
    return _field(2, b"\x18\x02" + _field(2, packed) + _field(4, geometry))  # LineString


def _read_layer(layer: bytes) -> tuple[list[str], list[bytes], list[dict]]:
    """Keys, values and each feature's properties (key -> value bytes) of a layer message."""
    keys, values, tags = [], [], []
    for number, _, _, v, e in basemap._fields(layer):
        if number == 3:
            keys.append(layer[v:e].decode())
        elif number == 4:
            values.append(layer[v:e])
        elif number == 2:
            for fn, _, _, fv, fe in basemap._fields(layer[v:e]):
                if fn == 2:
                    feature, packed, i = layer[v:e], [], fv
                    while i < fe:
                        t, i = basemap._varint(feature, i)
                        packed.append(t)
                    tags.append(packed)
    props = [{keys[k]: values[x] for k, x in zip(t[0::2], t[1::2], strict=True)} for t in tags]
    return keys, values, props


def test_names_in_other_languages_go_the_others_stay_renumbered():
    keys = ["name", "name:de", "name:fr", "kind", "pgf:name:ja", "name:en", "pgf:name"]
    values = ["Seine", "Seine (de)", "la Seine", "river", "セーヌ", "Seine (en)", "S"]
    body = (
        _field(1, b"water")
        + _feature([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
        + _feature([1, 1, 3, 3, 5, 5, 6, 6])
        + b"".join(_field(3, k.encode()) for k in keys)
        + b"".join(_field(4, _string_value(v)) for v in values)
        + b"\x28\x80\x20"  # extent 4096
        + b"\x78\x02"  # version 2
    )
    tile = _field(3, body) + _layer("roads", b"\x78\x02")
    lighter = basemap.drop_keys(tile, basemap.name_keys(["fr", "en"]))
    layers = [lighter[v:e] for n, _, _, v, e in basemap._fields(lighter) if n == 3]
    assert basemap.layer_names(lighter) == ["water", "roads"]
    assert layers[1] == _layer("roads", b"\x78\x02")[2:]  # untouched, byte for byte
    k, v, props = _read_layer(layers[0])
    assert k == ["name", "name:fr", "kind", "name:en", "pgf:name"]
    s = _string_value
    assert props == [
        {"name": s("Seine"), "name:fr": s("la Seine"), "kind": s("river")},
        {"kind": s("river"), "name:en": s("Seine (en)"), "pgf:name": s("S")},
    ]
    # Only the values a feature still uses; extent and version kept.
    assert len(v) == 5 and s("Seine (de)") not in v and s("セーヌ") not in v
    assert layers[0].endswith(b"\x28\x80\x20\x78\x02")
    # Geometry and type of each feature as they were.
    assert layers[0].count(_field(4, b"\x09\x02\x04")) == 2
    # A tile without such names is the same bytes.
    plain = _layer("roads", b"\x78\x02")
    assert basemap.drop_keys(plain, basemap.name_keys(["fr"])) is plain
