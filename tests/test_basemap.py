"""The basemap without its points of interest (lacarte.basemap): the layer gone from every
tile, every other layer and every untouched tile byte for byte, the names of places kept."""

import gzip
import re
from pathlib import Path

import pytest
from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write

from lacarte import basemap, cli

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


def test_features_of_undrawn_kinds_go_the_others_stay_byte_for_byte():
    keys = ["kind", "name"]
    values = ["forest", "farmland", "Bois", "meadow"]
    forest = _feature([0, 0, 1, 2])
    farmland = _feature([0, 1])
    meadow = _feature([1, 2, 0, 3])  # the kind after another key
    nameless = _feature([1, 2])
    tail = (
        b"".join(_field(3, k.encode()) for k in keys)
        + b"".join(_field(4, _string_value(v)) for v in values)
        + b"\x28\x80\x20\x78\x02"  # extent 4096, version 2
    )
    landuse = _field(1, b"landuse") + forest + farmland + meadow + nameless + tail
    landcover = _field(1, b"landcover") + farmland + tail  # another layer: kept whole
    tile = _field(3, landuse) + _field(3, landcover)
    kinds = {"landuse": frozenset({"farmland", "meadow"})}
    lighter = basemap.drop_kinds(tile, kinds)
    assert lighter == _field(3, _field(1, b"landuse") + forest + nameless + tail) + _field(
        3, landcover
    )
    # A tile without such a feature, or a layer not named: the same bytes.
    assert basemap.drop_kinds(lighter, kinds) is lighter
    assert basemap.drop_kinds(tile, {"water": frozenset({"farmland"})}) is tile


def test_the_undrawn_kinds_are_landuse_ones_and_never_a_drawn_one():
    kinds = basemap.undrawn_kinds()
    assert set(kinds) == {"landuse"}
    assert {"farmland", "meadow", "residential"} <= kinds["landuse"]
    # web/tests/basemap.test.ts checks them against every layer of the style.
    assert not {"forest", "wood", "park", "grass", "cemetery"} & kinds["landuse"]


def test_the_archive_without_undrawn_kinds(tmp_path):
    src, out = tmp_path / "full.pmtiles", tmp_path / "light.pmtiles"
    tail = _field(3, b"kind") + _field(4, _string_value("farmland")) + b"\x78\x02"
    landuse = _field(3, _field(1, b"landuse") + _feature([0, 0]) + tail)
    roads = _layer("roads", b"\x78\x02")
    _archive(src, {(0, 0, 0): landuse + roads, (1, 0, 0): roads})
    stats = basemap.strip(src, out, [], kinds=basemap.undrawn_kinds())
    got = _tiles(out)
    assert got[(0, 0, 0)] == _field(3, _field(1, b"landuse") + tail) + roads
    assert got[(1, 0, 0)] == roads
    assert stats["changed"] == 1 and stats["tiles"] == 2


# --- the basemap's id (user decision 2026-10-23: out of the build's id, its own) ----------


def _meta(path: Path) -> dict:
    with open(path, "rb") as f:
        return Reader(MmapSource(f)).metadata()


def _stripped(tmp_path: Path) -> tuple[Path, Path]:
    """A small source archive and its strip by the command (`main`): pois and names, undrawn."""
    src, out = tmp_path / "full.pmtiles", tmp_path / "light.pmtiles"
    _archive(src, {(14, 8290, 5634): _layer("places") + _layer("pois", b"\x78\x02")})
    basemap.main(str(src), str(out), ["pois", "pois"], ["fr", "en"], undrawn=True)
    return src, out


def test_the_strip_writes_its_id_and_the_check_accepts_it(tmp_path, capsys):
    src, out = _stripped(tmp_path)
    meta = _meta(out)
    args = {"drop": ["pois"], "names": ["en", "fr"], "undrawn": True}
    assert meta["basemap_args"] == args
    assert meta["basemap_source"] == basemap.source_identity(src)
    assert re.fullmatch(r"[0-9a-f]{16}", meta["basemap_id"])
    assert meta["basemap_id"] == basemap.basemap_id(basemap.source_identity(src), args)
    assert basemap.check(out)["basemap_id"] == meta["basemap_id"]
    assert [v["id"] for v in meta["vector_layers"]] == ["places", "roads"]  # as before
    capsys.readouterr()
    cli.main(["basemap", "check", str(out)])
    assert capsys.readouterr().out.startswith(f"basemap {meta['basemap_id']}: made by this code")
    # Other args or another source: another id.
    other = basemap.strip_args(["pois"], None, True)
    assert basemap.basemap_id(meta["basemap_source"], other) != meta["basemap_id"]
    assert basemap.basemap_id("0" * 64, args) != meta["basemap_id"]


def test_the_check_refuses_an_archive_made_by_other_code(tmp_path, monkeypatch):
    _, out = _stripped(tmp_path)
    code = tmp_path / "basemap.py"
    code.write_text(basemap.CODE_FILE.read_text() + "# one more line\n")
    monkeypatch.setattr(basemap, "CODE_FILE", code)
    with pytest.raises(basemap.NotThisCode, match="made by other code"):
        basemap.check(out)
    with pytest.raises(SystemExit, match="made by other code.*strip it again"):
        cli.main(["basemap", "check", str(out)])
    monkeypatch.undo()
    basemap.check(out)
    rules = tmp_path / "basemap.yaml"  # the rules too
    rules.write_text(basemap.RULES_FILE.read_text() + "# one more line\n")
    monkeypatch.setattr(basemap, "RULES_FILE", rules)
    with pytest.raises(basemap.NotThisCode, match="made by other code"):
        basemap.check(out)


def test_the_check_refuses_an_archive_without_id(tmp_path):
    src, out = _stripped(tmp_path)
    with pytest.raises(SystemExit, match="no basemap id"):
        cli.main(["basemap", "check", str(src)])
    # A strip by the function alone writes no id, and never keeps its source's.
    again = tmp_path / "again.pmtiles"
    basemap.strip(out, again, ["roads"])
    assert not set(basemap.STAMP) & set(_meta(again))
    with pytest.raises(basemap.NotThisCode, match="no basemap id"):
        basemap.check(again)
