"""lacarte_collecte's memory: a replay never duplicates, an erasure removes everywhere."""

from __future__ import annotations

from lacarte_collecte.etat import Etat, Store


# --- the state and the records --------------------------------------------------------------------
def test_a_replay_never_makes_a_duplicate_and_an_erasure_removes_everywhere(tmp_path):
    s = Store(tmp_path, "avis")
    s.add([{"id": "26-1", "v": 1}, {"id": "26-2", "v": 1}])
    s.add([{"id": "26-1", "v": 2}])
    assert [(r["id"], r["v"]) for r in s.records()] == [("26-2", 1), ("26-1", 2)]
    assert s.forget({"26-1"}) == 1 and s.ids() == {"26-2"}
    e = Etat(tmp_path, "dila")
    e.save("jour-2026-10-14", lus=["a.xml"])
    e.save("jour-2026-10-14", termine=True)
    assert e.get("jour-2026-10-14")["lus"] == ["a.xml"] and e.all().keys() == {"jour-2026-10-14"}
