"""The NAF labels' reader (naf.py): a dBase III file as INSEE publishes it, cp850."""

from __future__ import annotations

import struct

from lacarte_registre import naf


def _dbf(rows: list[tuple[str, str]]) -> bytes:
    fields = [("CODE", 6), ("LIBELLÉ", 40)]
    size = 1 + sum(w for _, w in fields)
    header = 32 + 32 * len(fields) + 1
    out = bytearray(b"\x03\x7e\x0b\x08" + struct.pack("<IHH", len(rows), header, size) + bytes(20))
    for name, w in fields:
        d = bytearray(32)
        d[: len(name.encode("cp850"))] = name.encode("cp850")
        d[11], d[16] = ord("C"), w
        out += d
    out += b"\x0d"
    for i, (code, label) in enumerate(rows):
        flag = b"*" if i == 2 else b" "
        out += flag + code.ljust(6).encode("cp850") + label.ljust(40).encode("cp850")
    return bytes(out)


def test_the_labels_are_read_by_their_codes_a_deleted_record_left_out():
    data = _dbf([("26.52Z", "Horlogerie"), ("80.20Z", "Activités liées aux systèmes de sécurité"),
                 ("99.99Z", "effacé")])  # fmt: skip
    rows = naf.lire_dbf(data, "cp850")
    assert len(rows) == 2 and list(rows[0]) == ["CODE", "LIBELLÉ"]
    assert naf.libelles(rows) == {"26.52Z": "Horlogerie",
                                  "80.20Z": "Activités liées aux systèmes de sécurité"}  # fmt: skip
