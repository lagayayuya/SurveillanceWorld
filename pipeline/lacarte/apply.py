"""Stage `apply`: validated contributions enter the build (rules/contributions.yaml).

Reads the normalised cameras and the region's exported contributions
(data/contrib/<region>.jsonl, `lacarte contrib export`), writes the cameras every later
stage reads (cameras_applied.parquet) and what became of each contribution
(contrib_outcome.json: applied, superseded or conflict, with the OSM version found in the
extract — or validated, reason no_height, for a tilt waiting for a height; deploy/deploy.sh
writes it into the participation database).

When nothing is applied (no file, an empty file, or only conflicts),
cameras_applied.parquet is a byte copy of cameras_norm.parquet: the build is then the one
before this stage, byte for byte. Otherwise it gains, for every camera, `position_source`,
`position_certainty`, `position_month`, `seen_month`, `gone` and `gone_month` (months of
observation, YYYY-MM: the day never leaves the database), and for the "Compléter" answers
(phase D2) `kind_month`, `direction_month`, `operator_month` and `operator_kind`
(business | household), and (phase D3) `height_class`, `height_month` and `tilt_month`
(the tilt's class is read from its degrees, rules/questions.yaml tilt.bounds); a camera
they change is normalised again (normalize_row with its
overrides), so its kind, optics, direction and operator class follow. A validated add
(phase "Ajouter") creates a camera with no OSM element (id `c…`, no tag, osm_version null),
after the OSM cameras, with `added_month`. `on_site` (rules: on_site) says which of these
months come from a contribution made on site: an integer of ON_SITE bits.

The contributions on a hidden camera (regions.hidden: an OSM camera the extract already
left out, or an added one) are left out before anything else: never applied, never in the
outcome (the deploy then leaves them as they are in the database).
"""

from __future__ import annotations

import json
import math
import shutil
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely
from pyproj import Transformer

from lacarte import buildinfo, direction, normalize, participation, regions

CAMERAS = "cameras_applied.parquet"
OUTCOME = "contrib_outcome.json"
# The only keys an exported contribution may carry (no author, no day, no time).
KEYS = {
    "uuid", "kind", "answer", "camera_id", "osm_type", "osm_id", "osm_version",
    "x", "y", "placement", "month", "rank", "direction", "operator_name", "tags", "near",
    "on_site",
}  # fmt: skip
# rules: on_site — which shown month a contribution made on site backs; SEEN_BY_ADD: the
# sighting is the add itself (and the answers on it), said by the position already.
ON_SITE = {"position": 1, "seen": 2, "gone": 4, "added": 8, "kind": 32, "direction": 64,
           "operator": 128, "height": 256, "tilt": 512}  # fmt: skip
SEEN_BY_ADD = 16
MONTH_LEN = 7  # YYYY-MM
SEEN = ("present", "move")  # a sighting: the camera is there
# "Compléter" (rules/questions.yaml); height and tilt since phase D3.
D2 = ("shape", "direction", "operator", "height", "tilt")
CLASSED = ("height", "tilt")  # answers are classes of rules/questions.yaml
# Answers a build applies; "Je ne sais pas" / "Je ne vois pas" are never exported.
ANSWERS = {
    "verify": ("present", "not_found"),
    "shape": ("dome", "bullet", "ptz", "multi"),
    "operator": ("public", "business", "household"),
}
D2_COLUMNS = (
    "kind_month", "direction_month", "operator_month", "operator_kind",
    "height_class", "height_month", "tilt_month",
)  # fmt: skip
KINDS = ("move", "verify", "add", *D2)


# Phase "Ajouter": an added camera has no OSM element and no tag (participation.is_added).
is_added, added_id = participation.is_added, participation.added_id
ADD_TAGS = "{}"  # normalize_row on no tag: every value by default
# What the API needs of the default added camera (live.Camera without id nor position).
TEMPLATE_COLUMNS = (
    "indoor", "kind", "mount_group", "directions", "fov_deg", "range_m", "height_m",
    "height_certainty", "tilt_deg", "geom_certainty",
)  # fmt: skip


def add_template() -> dict:
    """The camera an add creates before any answer, as the API places and draws it."""
    row, _ = normalize.normalize_row(added_id("0" * 32), None, None, ADD_TAGS)
    return {k: row[k] for k in TEMPLATE_COLUMNS}


def rules() -> dict:
    return participation.contributions()


@dataclass(frozen=True)
class Contribution:
    uuid: str
    kind: str  # move | verify | add | shape | direction | operator | height | tilt
    camera_id: str
    osm_version: int | None  # the version it is held against; None on an added camera
    month: str  # of observation, YYYY-MM
    rank: int  # order within its camera (rules: order), 1 = oldest
    answer: str | None = None  # verify: present | not_found; shape; operator; height; tilt
    x: float | None = None  # move: final position; direction: aimed from (metres, CRS)
    y: float | None = None
    placement: str | None = None
    direction: int | None = None  # direction: bearing, degrees from north
    operator_name: str | None = None  # operator: a name from the offered list
    tags: dict | None = field(default=None, hash=False, compare=False)  # served OSM tags
    # add: OSM cameras within duplicate_m taken for other cameras (seen at receipt, or kept
    # by the review: rules duplicate)
    near: tuple[str, ...] = ()
    on_site: bool = False  # the phone was within on_site_m (true only; false or unknown)

    @property
    def what(self) -> str:
        """move | present | not_found | shape | direction | operator"""
        return self.answer if self.kind == "verify" else self.kind


def read(path: Path) -> list[Contribution]:
    """The exported contributions; refuses a key outside KEYS (an author, a day...)."""
    out = []
    if not path.exists():
        return out
    for n, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        extra = set(row) - KEYS
        if extra:
            raise ValueError(f"{path.name}:{n}: unexpected keys {sorted(extra)}")
        kind = row["kind"]
        if kind not in KINDS:
            raise ValueError(f"{path.name}:{n}: kind {kind!r}")
        if kind in ANSWERS and row.get("answer") not in ANSWERS[kind]:
            raise ValueError(f"{path.name}:{n}: answer {row.get('answer')!r}")
        if kind in CLASSED and row.get("answer") not in participation.questions()[kind]["classes"]:
            raise ValueError(f"{path.name}:{n}: answer {row.get('answer')!r}")
        added = is_added(row["camera_id"])
        if added != (row.get("osm_version") is None):
            raise ValueError(f"{path.name}:{n}: an OSM version exactly for OSM cameras")
        if (kind == "add") != (added and row["camera_id"] == added_id(row["uuid"])):
            raise ValueError(f"{path.name}:{n}: an add's camera id comes from its uuid")
        if kind in ("move", "direction", "add") and (row.get("x") is None or row.get("y") is None):
            raise ValueError(f"{path.name}:{n}: a {kind} without its position")
        if kind == "direction" and not 0 <= int(row.get("direction", -1)) <= 359:
            raise ValueError(f"{path.name}:{n}: direction {row.get('direction')!r}")
        if kind in D2 and not added and not isinstance(row.get("tags"), dict):
            raise ValueError(f"{path.name}:{n}: a {kind} answer without its OSM tags")
        if len(row["month"]) != MONTH_LEN:
            raise ValueError(f"{path.name}:{n}: month {row['month']!r} is not YYYY-MM")
        out.append(
            Contribution(
                uuid=row["uuid"], kind=kind, camera_id=row["camera_id"],
                osm_version=None if added else int(row["osm_version"]), month=row["month"],
                rank=int(row["rank"]), near=tuple(row.get("near") or ()),
                on_site=row.get("on_site") is True,
                answer=row.get("answer"), x=row.get("x"), y=row.get("y"),
                placement=row.get("placement"), direction=row.get("direction"),
                operator_name=row.get("operator_name"), tags=row.get("tags"),
            )
        )  # fmt: skip
    return out


@dataclass
class State:
    """What the contributions change on one camera."""

    position: tuple[float, float] | None = None
    position_month: str | None = None
    seen_month: str | None = None
    gone_month: str | None = None
    kind: str | None = None  # a shape answer's kind (rules/questions.yaml shape.kinds)
    kind_month: str | None = None
    direction: int | None = None
    direction_month: str | None = None
    # who films: (answer public | business | household, or None when answers disagree;
    # the chosen name, None when none or when names disagree)
    operator: tuple[str | None, str | None] | None = None
    operator_month: str | None = None
    height: str | None = None  # a height answer's class (rules/questions.yaml height.classes)
    height_month: str | None = None
    tilt: str | None = None  # a tilt answer's class
    tilt_month: str | None = None
    added: tuple[float, float] | None = None  # an add: the camera it creates, its position
    added_month: str | None = None
    on_site: int = 0  # ON_SITE bits, and SEEN_BY_ADD


@dataclass(frozen=True)
class Osm:
    """What the extract says of a camera now: version, tags, position, normalised kind."""

    version: int
    tags: dict = field(default_factory=dict, hash=False, compare=False)
    xy: tuple[float, float] | None = None
    kind: str = "unknown"


def tags_changed(c: Contribution, now: dict) -> bool:
    """rules: fine_conflict — a tag the answer concerns differs from the one it saw."""
    keys = rules()["fine_conflict"]["keys"][c.kind]
    return any(c.tags.get(k) != now.get(k) for k in keys)


def osm_conflict(c: Contribution, osm: Osm | None) -> str | None:
    """rules: osm_conflict, fine_conflict — the reason it cannot apply, or None. An added
    camera has no OSM element to conflict with (rules: add)."""
    if is_added(c.camera_id):
        return None
    if osm is None:
        return "osm_deleted"
    if osm.version == c.osm_version:
        return None
    if c.kind in D2 and c.tags is not None:
        return "osm_tags" if tags_changed(c, osm.tags) else None
    return "osm_version"


def settle(
    contribs: list[Contribution], versions: dict[str, int | Osm]
) -> tuple[dict[str, dict], dict[str, State]]:
    """Outcome of every contribution and the resulting state of every camera touched.

    `versions`: every camera in the extract, its OSM version or what the extract says of
    it (Osm: version, tags, position, kind; the D2 rules need it, the add's duplicate rule
    reads the positions). Outcome: {"result": applied | superseded | conflict | validated,
    "reason": osm_version | osm_deleted | osm_tags | same_day | kind | moved | duplicate
    (conflicts), diverge (applied operator answers), no_height (a tilt left validated)};
    a duplicate add lists the OSM cameras `near` it, an applied add the ones it was told
    apart from (`accepted`). The contributions on an added camera whose add is not applied
    get no outcome: they wait for the review's decision.
    """
    outcome: dict[str, dict] = {}
    states: dict[str, State] = {}
    by_camera: dict[str, list[Contribution]] = defaultdict(list)
    for c in contribs:
        by_camera[c.camera_id].append(c)
    q = participation.questions()
    for camera_id, rows in sorted(by_camera.items()):
        v = versions.get(camera_id)
        osm = Osm(v) if isinstance(v, int) else v
        add = None
        if is_added(camera_id):
            add = next((c for c in rows if c.kind == "add"), None)
            if add is None:
                continue  # its add is not exported (pending, conflict or rejected)
            osm = Osm(0, {}, (add.x, add.y))  # no OSM element: the default camera
        live = []
        for c in rows:
            reason = osm_conflict(c, osm)
            if reason:
                outcome[c.uuid] = {"result": "conflict", "reason": reason}
            else:
                live.append(c)
        if not live:
            continue
        state = State()
        won: set[str] = set()
        tied: set[str] = set()
        refused: dict[str, dict] = {}  # live but not applicable: conflict with a reason
        # Position: the latest move (rules: move); a tie is a conflict (rules: same_day).
        moves = [c for c in live if c.kind == "move"]
        top_moves = _top(moves)
        if len(top_moves) > 1:
            tied.update(c.uuid for c in top_moves)
        # A tie on the position or on presence leaves presence undecided; a tie on a
        # "Compléter" answer does not (the camera was seen either way).
        blocking = set(tied)
        if len(top_moves) == 1:
            m = top_moves[0]
            state.position, state.position_month = (m.x, m.y), m.month
            won.add(m.uuid)
        if add is not None:
            # rules: add, duplicate — an OSM camera within duplicate_m of where the added
            # camera ends up, and not told apart from it, may be the same camera.
            xy = state.position or (add.x, add.y)
            near = osm_near(versions, xy)
            if dup := [i for i in near if i not in add.near]:
                outcome[add.uuid] = {"result": "conflict", "reason": "duplicate", "near": dup}
                continue
            state.added, state.added_month = (add.x, add.y), add.month
            refused[add.uuid] = {"result": "applied", **({"accepted": near} if near else {})}
        # Shape: the latest answer (rules: shape); different answers on a tie conflict.
        top = _top([c for c in live if c.kind == "shape"])
        if len({c.answer for c in top}) > 1:
            tied.update(c.uuid for c in top)
        elif top:
            state.kind, state.kind_month = q["shape"]["kinds"][top[0].answer], top[0].month
            won.update(c.uuid for c in top)
        # Direction (rules: direction): only for a final kind under the direction rule and
        # a camera still where it was aimed from.
        kind_now = state.kind or (osm.kind if osm else "unknown")
        xy_now = state.position or (osm.xy if osm else None)
        aims = []
        for c in (c for c in live if c.kind == "direction"):
            if kind_now not in direction.kinds():
                refused[c.uuid] = {"result": "conflict", "reason": "kind"}
            elif (
                xy_now is not None
                and (gap := math.hypot(xy_now[0] - c.x, xy_now[1] - c.y))
                > q["direction"]["moved_max_m"]
            ):
                refused[c.uuid] = {"result": "conflict", "reason": "moved",
                                   "moved_m": round(gap, 1)}  # fmt: skip
            else:
                aims.append(c)
        top = _top(aims)
        if len({c.direction for c in top}) > 1:
            tied.update(c.uuid for c in top)
        elif top:
            state.direction, state.direction_month = top[0].direction, top[0].month
            won.update(c.uuid for c in top)
        # Height (rules: height): the latest answer; different classes on a tie conflict.
        top = _top([c for c in live if c.kind == "height"])
        if len({c.answer for c in top}) > 1:
            tied.update(c.uuid for c in top)
        elif top:
            state.height, state.height_month = top[0].answer, top[0].month
            won.update(c.uuid for c in top)
        # Tilt (rules: tilt): only for a final tilt kind, and only with a final height at
        # least estimated (an answer, or OSM's height tag); else it waits, validated.
        has_height = state.height is not None or (
            osm is not None and normalize.parse_height(osm.tags.get("height")) is not None
        )
        tilts = []
        for c in (c for c in live if c.kind == "tilt"):
            if kind_now not in q["tilt"]["kinds"]:
                refused[c.uuid] = {"result": "conflict", "reason": "kind"}
            elif not has_height:
                refused[c.uuid] = {"result": "validated", "reason": "no_height"}
            else:
                tilts.append(c)
        top = _top(tilts)
        if len({c.answer for c in top}) > 1:
            tied.update(c.uuid for c in top)
        elif top:
            state.tilt, state.tilt_month = top[0].answer, top[0].month
            won.update(c.uuid for c in top)
        # Who films (rules: operator): every validated answer counts.
        ops = [c for c in live if c.kind == "operator"]
        if ops:
            answers = {c.answer for c in ops}
            names = {c.operator_name for c in ops if c.operator_name}
            agreed = len(answers) == 1
            name = next(iter(names)) if agreed and len(names) == 1 else None
            state.operator = (next(iter(answers)) if agreed else None, name)
            state.operator_month = max(c.month for c in ops)
            diverge = not agreed or len(names) > 1
            for c in ops:
                won.add(c.uuid)
                if diverge:
                    refused[c.uuid] = {"result": "applied", "reason": "diverge"}
        # Presence: the latest sighting or "not found" (rules: seen, not_found); a tie
        # conflicts only between "not found" and a sighting. Every answer kept here is a
        # sighting but "not found" (refused directions included: the camera was seen).
        top_presence = _top(live)
        if len({c.what == "not_found" for c in top_presence}) > 1:
            tied.update(c.uuid for c in top_presence)
            blocking.update(c.uuid for c in top_presence)
        if top_presence and not blocking & {c.uuid for c in top_presence}:
            head = top_presence[0]
            if head.what == "not_found":
                state.gone_month = head.month
            else:
                state.seen_month = head.month
            won.update(c.uuid for c in top_presence if c.uuid not in refused)
        for c in live:
            if c.uuid in tied:
                outcome[c.uuid] = {"result": "conflict", "reason": "same_day"}
            elif c.uuid in refused:
                outcome[c.uuid] = refused[c.uuid]
            elif c.uuid in won:
                outcome[c.uuid] = {"result": "applied"}
            else:
                outcome[c.uuid] = {"result": "superseded"}
        if add is not None:
            outcome[add.uuid] = refused[add.uuid]  # it made the camera, whatever came after
        state.on_site = on_site_bits(state, live, add)
        if state != State():
            states[camera_id] = state
    return outcome, states


def on_site_bits(state: State, live: list[Contribution], add: Contribution | None) -> int:
    """rules: on_site — a shown month is "sur place" when one of the contributions of that
    kind and that month was made on site; SEEN_BY_ADD when the month's sightings are the
    add and the answers on it only."""

    def any_on_site(month, pick) -> bool:
        return month is not None and any(c.on_site for c in live if c.month == month and pick(c))

    bits = 0
    if any_on_site(state.position_month, lambda c: c.kind == "move"):
        bits |= ON_SITE["position"]
    if any_on_site(state.seen_month, lambda c: c.what != "not_found"):
        bits |= ON_SITE["seen"]
    if any_on_site(state.gone_month, lambda c: c.what == "not_found"):
        bits |= ON_SITE["gone"]
    if add is not None and state.added is not None and add.on_site:
        bits |= ON_SITE["added"]
    for what, month in (("kind", state.kind_month), ("direction", state.direction_month),
                        ("operator", state.operator_month), ("height", state.height_month),
                        ("tilt", state.tilt_month)):  # fmt: skip
        kind = "shape" if what == "kind" else what
        if any_on_site(month, lambda c, kind=kind: c.kind == kind):
            bits |= ON_SITE[what]
    seen = [c for c in live if c.month == state.seen_month and c.what != "not_found"]
    if state.added is not None and seen and all(c.kind in ("add", *D2) for c in seen):
        bits |= SEEN_BY_ADD
    return bits


def osm_near(versions: dict[str, int | Osm], xy: tuple[float, float]) -> list[str]:
    """OSM cameras of the extract within duplicate_m of a point (rules: duplicate)."""
    d = rules()["duplicate"]["duplicate_m"]
    return sorted(
        i for i, o in versions.items()
        if isinstance(o, Osm) and o.xy is not None and not is_added(i)
        and math.hypot(o.xy[0] - xy[0], o.xy[1] - xy[1]) <= d
    )  # fmt: skip


def _top(rows: list[Contribution]) -> list[Contribution]:
    """The rows of the highest rank (the latest observation)."""
    if not rows:
        return []
    best = max(c.rank for c in rows)
    return [c for c in rows if c.rank == best]


def overrides(state: State, tags: dict) -> normalize.Overrides | None:
    """What normalize_row must take from the contributions (phase D2), or None."""
    op = None
    if state.operator is not None:
        answer, name = state.operator
        if answer is None:
            op = ("unknown", None, False)
        else:
            cls = participation.questions()["operator"]["classes"][answer]["class"]
            if cls == "private_outdoor" and "indoor" in normalize.values(tags.get("surveillance")):
                cls = "private_indoor"  # the tags say it films indoors
            op = (cls, name, True)
    q = participation.questions()
    height = float(q["height"]["classes"][state.height]) if state.height else None
    tilt = float(q["tilt"]["classes"][state.tilt]) if state.tilt else None
    if all(v is None for v in (state.kind, state.direction, op, height, tilt)):
        return None
    dirs = [float(state.direction)] if state.direction is not None else None
    return normalize.Overrides(
        kind=state.kind, directions=dirs, operator=op, height_m=height, tilt_deg=tilt
    )


def operator_kind(state: State | None) -> str | None:
    if state is None or state.operator is None or state.operator[0] is None:
        return None
    return participation.questions()["operator"]["classes"][state.operator[0]].get("operator_kind")


def applied_cameras(
    cams: gpd.GeoDataFrame, states: dict[str, State], places: normalize.Places | None = None
) -> gpd.GeoDataFrame:
    """The cameras with their contributions' state (columns of the module docstring);
    `places` as the normalize stage had them (admin.place_names)."""
    out = with_added(cams, states)
    ids = out.camera_id.to_numpy()
    st = [states.get(i) for i in ids]
    # "Compléter" answers: the camera normalised again with them (whole columns rebuilt:
    # list values such as directions do not go through a cell assignment).
    changed: dict[int, dict] = {}
    for i, s in enumerate(st):
        if s is None:
            continue
        rec = out.iloc[i]
        over = overrides(s, json.loads(rec.tags))
        if over is not None:
            changed[i], _ = normalize.normalize_row(
                rec.camera_id, rec.osm_version, rec.osm_timestamp, rec.tags, over, places
            )
    if changed:
        for col in next(iter(changed.values())):
            values = out[col].tolist()
            for i, row in changed.items():
                values[i] = row[col]
            out[col] = values
    geom = out.geometry.to_numpy().copy()
    for i, s in enumerate(st):
        if s is not None and s.position is not None:
            geom[i] = shapely.Point(*s.position)
    out = out.set_geometry(gpd.GeoSeries(geom, index=out.index, crs=cams.crs))
    # Placed on site: moved, or added (rules: move, add).
    placed = [s is not None and (s.position or s.added) is not None for s in st]
    out["position_source"] = ["contribution" if m else None for m in placed]
    out["position_certainty"] = ["identified" if m else None for m in placed]
    out["position_month"] = [(s.position_month or s.added_month) if s else None for s in st]
    out["seen_month"] = [s.seen_month if s else None for s in st]
    out["gone"] = [bool(s and s.gone_month) for s in st]
    out["gone_month"] = [s.gone_month if s else None for s in st]
    out["kind_month"] = [s.kind_month if s else None for s in st]
    out["direction_month"] = [
        s.direction_month if s and s.direction is not None else None for s in st
    ]
    out["operator_month"] = [s.operator_month if s else None for s in st]
    out["operator_kind"] = [operator_kind(s) for s in st]
    out["height_class"] = [s.height if s else None for s in st]
    out["height_month"] = [s.height_month if s else None for s in st]
    out["tilt_month"] = [s.tilt_month if s else None for s in st]
    out["added_month"] = [s.added_month if s else None for s in st]
    out["on_site"] = [s.on_site if s else 0 for s in st]
    if out["osm_version"].isna().any():  # added cameras: nullable integers, never floats
        out["osm_version"] = out["osm_version"].astype("Int64")
    if "dome_count" in out:  # rebuilt above from a list: nullable integers again
        out["dome_count"] = out["dome_count"].astype("Int64")
    return out


def with_added(cams: gpd.GeoDataFrame, states: dict[str, State]) -> gpd.GeoDataFrame:
    """The cameras and, after them in id order, those validated adds create (rules: add):
    the default camera of no tag at the add's position, no OSM element (osm_version null:
    applied_cameras makes the column nullable integers). Unchanged when no add applies."""
    ids = sorted(i for i, s in states.items() if s.added is not None)
    if not ids:
        return cams.copy()
    rows = [normalize.normalize_row(i, None, None, ADD_TAGS)[0] for i in ids]
    new = gpd.GeoDataFrame(
        rows, geometry=[shapely.Point(*states[i].added) for i in ids], crs=cams.crs
    )[list(cams.columns)]
    out = pd.concat([cams, new], ignore_index=True)
    return gpd.GeoDataFrame(out, geometry="geometry", crs=cams.crs)


def gone(cams: pd.DataFrame) -> pd.Series:
    """Cameras verified gone (rules: not_found); none before any contribution."""
    if "gone" not in cams:
        return pd.Series(False, index=cams.index)
    return cams["gone"].fillna(False).astype(bool)


def household(cams: pd.DataFrame) -> pd.Series:
    """Cameras a validated answer says a private individual installed (rules: operator)."""
    if "operator_kind" not in cams:
        return pd.Series(False, index=cams.index)
    return cams["operator_kind"].eq("household")


def standing(cams: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """The cameras not verified gone: those that film, count and enter the statistics."""
    return cams[~gone(cams)]


def extract_state(cams: gpd.GeoDataFrame) -> dict[str, Osm]:
    """What the extract says of every camera (settle's `versions`)."""
    real = cams[cams.is_camera]
    return {
        cid: Osm(int(v), json.loads(tags), (geom.x, geom.y), kind)
        for cid, v, tags, geom, kind in zip(
            real.camera_id, real.osm_version, real.tags, real.geometry, real.kind, strict=True
        )
    }


def run(region: regions.Region) -> dict[str, Path]:
    b = region.build_dir
    src, dst, out_path = b / "cameras_norm.parquet", b / CAMERAS, b / OUTCOME
    hidden = regions.hidden(region)
    contribs = [c for c in read(region.contrib_file) if c.camera_id not in hidden]
    if not contribs:
        shutil.copyfile(src, dst)
        out_path.unlink(missing_ok=True)
        return {"cameras": dst}
    cams = gpd.read_parquet(src)
    extract = extract_state(cams)
    outcome, states = settle(contribs, extract)
    if states:
        from lacarte import admin  # admin imports this module

        applied_cameras(cams, states, admin.place_names(region)).to_parquet(dst)
    else:
        shutil.copyfile(src, dst)
    to_ll = Transformer.from_crs(region.crs, "EPSG:4326", always_xy=True)
    rows = cams.set_index("camera_id")
    report = []
    for c in sorted(contribs, key=lambda c: c.uuid):
        o = {"uuid": c.uuid, **outcome[c.uuid]}
        # The version the deploy writes: the one this contribution is now held against
        # (for a conflict, what a revalidation accepts); None when the element is gone.
        o["osm_version"] = extract[c.camera_id].version if c.camera_id in extract else None
        if o["result"] == "conflict" and c.camera_id in extract:
            cam = rows.loc[c.camera_id]
            lon, lat = to_ll.transform(cam.geometry.x, cam.geometry.y)
            o["now"] = {"lon": round(lon, 7), "lat": round(lat, 7), "tags": json.loads(cam.tags)}
        report.append(o)
    doc = {"build_id": buildinfo.build_id(region), "contributions": report}
    out_path.write_text(json.dumps(doc, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
    return {"cameras": dst, "outcome": out_path}
