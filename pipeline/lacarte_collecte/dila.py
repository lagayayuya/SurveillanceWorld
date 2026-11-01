"""The BOAMP from the DILA's open data archives (echanges.dila.gouv.fr/OPENDATA/BOAMP/, no
robots.txt: no rule; Licence Ouverte 2.0), France since `first_year`.

The archive's layout (its indexes, read on 2026-11-01):
- from 2024, one XML per notice, named by its idweb, in a folder per day: `<year>/MM/DD/` for
  the current year, `FluxHistorique/Boamp_v240/<year>/MM/DD/` once the year is over
  (schema 3.2.x: GESTION, then DONNEES/EFORMS, the eForms notice);
- before, files per year and family: `FluxHistorique/Boamp_v240/2022|2023/*.tar.gz` (and six
  small ones in 2024, January's notices in the former schema) and
  `FluxHistorique/Boamp_v230/2015…2021/<family>/…`; archives in archives (a tar.gz holds
  `.taz` zips, each a tar of one XML and one HTML per notice; schema 2.x: GESTION, then
  DONNEES with IDENTITE, OBJET, ATTRIBUTION…).

Reading (`collect`): the days not yet read, newest first: today's folder (the daily flow),
then back to 2024-01-01; then the yearly files, newest first. Every file is read in memory
(the yearly ones written to a temporary file, then deleted): nothing of the raw notice is
kept. Each notice becomes the record the BOAMP's API used to give (idweb, date,
départements, buyer, object, nature, family, linked notices, the notice's data as JSON),
cleaned by boamp.clean (no natural person) and kept only when boamp.notice says it is about
video surveillance, in its object or in its text (not its contact blocks: the Vanves notice
26-98610 says it in its body only). Each kept notice says where it comes from (`mention`):
the DILA, the download address, the file's name and date, as the DILA asks.
"""

from __future__ import annotations

import datetime as dt
import io
import re
import tarfile
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from lacarte_collecte.contexte import Contexte
from lacarte_collecte.etat import Etat, Store
from lacarte_registre import boamp, fetch

SOURCE = "dila"
FIRST_DAILY = dt.date(2024, 1, 1)
NATURES = {
    "APPEL_OFFRE": "Avis de marché",
    "ATTRIBUTION": "Résultat de marché",
    "RECTIFICATIF": "Rectificatif",
    "ANNULATION": "Rectificatif",
}
# The eForms namespaces, as the BOAMP's API wrote them (its JSON kept the prefixes)
PREFIXES = {
    "CommonBasicComponents-2": "cbc",
    "CommonAggregateComponents-2": "cac",
    "CommonExtensionComponents-2": "ext",
    "eforms-extension-basic": "efbc",
    "eforms-extension-aggregate": "efac",
    "eforms-extension-components": "efext",
}
LINK = re.compile(r'href="([^"?/][^"]*)"')
IDWEB = re.compile(r"\d{2}-\d{3,7}")


# --- a notice's XML, read ---------------------------------------------------------------
def _tag(t: str) -> str:
    if t.startswith("{"):
        uri, local = t[1:].split("}", 1)
        for end, prefix in PREFIXES.items():
            if uri.endswith(end):
                return f"{prefix}:{local}"
        return local
    return t


def as_dict(e: ET.Element) -> Any:
    """An element as the BOAMP's API gave it in JSON: its text when it is only text, else a
    mapping (a repeated child becomes a list, an attribute `@name`, text beside children or
    attributes `#text`); an empty element is ""."""
    kids = list(e)
    text = (e.text or "").strip()
    if not kids and not e.attrib:
        return text
    out: dict[str, Any] = {f"@{_tag(k)}": v for k, v in e.attrib.items()}
    for k in kids:
        key, val = _tag(k.tag), as_dict(k)
        if key in out:
            out[key] = out[key] if isinstance(out[key], list) else [out[key]]
            out[key].append(val)
        else:
            out[key] = val
    if text:
        out["#text"] = text
    return out


def _local(e: ET.Element) -> str:
    return _tag(e.tag).split(":")[-1]


def _find(e: ET.Element, name: str) -> ET.Element | None:
    return next((x for x in e.iter() if _local(x) == name), None)


def _text(e: ET.Element | None, *path: str) -> str:
    for name in path:
        if e is None:
            return ""
        e = next((x for x in e if _local(x) == name), None)
    return (e.text or "").strip() if e is not None else ""


def _first_child(e: ET.Element | None) -> str:
    kids = list(e) if e is not None else []
    return _local(kids[0]) if kids else ""


def record(xml: bytes) -> dict[str, Any] | None:
    """A notice's XML (either schema) as the API's record; None when it is not a notice."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    gestion = _find(root, "GESTION")
    donnees = _find(root, "DONNEES")
    if gestion is None:
        return None
    idweb = _text(_find(gestion, "REFERENCE"), "IDWEB")
    if not idweb:
        return None
    ix = _find(gestion, "INDEXATION")
    avis = _find(gestion, "TYPE_AVIS")
    nature = _first_child(_find(avis, "NATURE") if avis is not None else None)
    eforms = _find(donnees, "EFORMS") if donnees is not None else None
    body = list(eforms)[0] if eforms is not None and len(eforms) else donnees
    data = as_dict(body) if body is not None else {}
    buyer = _text(ix, "NOMORGANISME") or _text(donnees, "IDENTITE", "DENOMINATION")
    objet = _text(ix, "RESUME_OBJET") or _text(donnees, "OBJET", "OBJET_COMPLET")
    before = _find(gestion, "ANNONCE_ANTERIEUR")
    olds = before.iter() if before is not None else iter(())
    linked = sorted({t for x in olds if IDWEB.fullmatch(t := (x.text or "").strip())} - {idweb})
    deps = [
        x.text.strip()
        for x in (ix.iter() if ix is not None else [])
        if _local(x) == "DEP_PUBLICATION" and x.text
    ]
    nm = _find(ix, "NATURE_MARCHE") if ix is not None else None
    return {
        "idweb": idweb,
        "id": idweb,
        "dateparution": _text(ix, "DATE_PUBLICATION"),
        "code_departement": deps,
        "nomacheteur": buyer,
        "objet": objet,
        "nature": nature,
        "nature_libelle": NATURES.get(nature, ""),
        "famille": _first_child(_find(avis, "FAMILLE") if avis is not None else None),
        "annonce_lie": None,
        "annonces_anterieures": linked or None,
        "url_avis": f"https://www.boamp.fr/pages/avis/?q=idweb:{idweb}",
        "type_marche": [_local(x) for x in nm] if nm is not None else [],
        "donnees": data,
    }


def notice(xml: bytes, mention: dict[str, str]) -> dict[str, Any] | None:
    """A notice's XML, cleaned and read; None when it is not about video surveillance."""
    rec = record(xml)
    if rec is None:
        return None
    n = boamp.notice(boamp.clean(rec))
    if n is None:
        return None
    return {**n, "id": n["idweb"], "mention": mention}


# --- the archive's folders --------------------------------------------------------------
def listing(html: str) -> list[str]:
    """The entries of an index page (`Index of …`), folders ending with `/`."""
    return [x for x in LINK.findall(html) if not x.startswith(("http", "mailto"))]


def day_paths(day: dt.date, today: dt.date) -> list[str]:
    """Where a day's folder may be: the current year's place first, then the history's."""
    current = f"{day:%Y/%m/%d}/"
    history = f"FluxHistorique/Boamp_v240/{day:%Y/%m/%d}/"
    return [current, history] if day.year == today.year else [history, current]


def _members(name: str, data: bytes) -> Iterator[tuple[str, bytes]]:
    """Every XML file inside archives inside archives (tar, gzip, zip), by its magic."""
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for n in z.namelist():
                yield from _members(n, z.read(n))
        return
    try:
        tf = tarfile.open(fileobj=io.BytesIO(data))  # noqa: SIM115 (closed by `with` below)
    except tarfile.TarError:
        if name.lower().endswith(".xml"):
            yield name, data
        return
    with tf:
        for m in tf:
            if m.isfile() and (f := tf.extractfile(m)) is not None:
                yield from _members(m.name, f.read())


def _members_of(path: Path) -> Iterator[tuple[str, bytes]]:
    """A yearly file's XML files, its outer archive read from disk as a stream."""
    try:
        tf = tarfile.open(path)  # noqa: SIM115 (closed by `with` below)
    except tarfile.TarError:
        yield from _members(path.name, path.read_bytes())
        return
    with tf:
        for m in tf:
            if m.isfile() and (x := tf.extractfile(m)) is not None:
                yield from _members(m.name, x.read())


def _keep(store: Store, items: list[dict[str, Any]], erased: set[str]) -> int:
    kept = [x for x in items if x["idweb"] not in erased]
    store.add(kept)
    return len(kept)


class Http:
    """A day's folder and its files over HTTP, through fetch.py (robots.txt, the pace per
    address): the daily flow, and everything when there is no FTPS."""

    canal = "https"

    def __init__(self, f: fetch.Fetcher):
        self.f = f
        self.base = f.conf["sources"]["boamp"]["archive"]

    def files(self, folder: str) -> list[str] | None:
        r = self.f.get(self.base + folder, cache=False)
        if r.status != 200:
            return None
        return sorted(x for x in listing(r.body.decode("utf-8", "replace")) if x.endswith(".xml"))

    def read(self, path: str) -> tuple[bytes, str] | None:
        r = self.f.get(self.base + path, cache=False)
        return (r.body, r.headers.get("last-modified", "")) if r.status == 200 else None


def collect_day(ctx: Contexte, canal: Any, day: dt.date, store: Store) -> dict[str, Any]:
    """One day's folder through `canal` (Http, or ftps.Ftps for the history): every notice
    not yet read, in memory; the state saved every 50 files."""
    st = Etat(ctx.root, SOURCE)
    key = f"jour-{day.isoformat()}"
    done = set(st.get(key).get("lus") or [])
    base = ctx.fetcher(SOURCE).conf["sources"]["boamp"]["archive"]
    folder, files = None, []
    for p in day_paths(day, ctx.today):
        names = canal.files(p)
        if names is not None:
            folder, files = p, names
            break
    if folder is None:
        return st.save(key, statut="absent", termine=day < ctx.today)
    erased = ctx.effaces()
    found = st.get(key).get("avis_video") or 0
    for name in files:
        if name in done:
            continue
        if ctx.out_of_time():
            return st.save(key, statut="en_cours", lus=sorted(done), fichiers=len(files))
        got = canal.read(folder + name)
        if got is not None:
            # the address to cite is the archive's public one, whatever the channel read
            mention = {
                "source": "DILA",
                "adresse": base + folder + name,
                "fichier": name,
                "date_fichier": got[1],
                "canal": canal.canal,
            }
            n = notice(got[0], mention)
            found += _keep(store, [n] if n else [], erased)
        done.add(name)
        if len(done) % 50 == 0:
            st.save(key, statut="en_cours", lus=sorted(done), avis_video=found)
    # today's folder fills during the day: read again until the day is over
    return st.save(
        key,
        statut="termine",
        lus=sorted(done),
        fichiers=len(files),
        avis_video=found,
        termine=day < ctx.today,
        canal=canal.canal,
    )


def collect_yearly(ctx: Contexte, f: fetch.Fetcher, year: int, store: Store) -> dict[str, Any]:
    """A year before 2024 (and 2024's six files of the former schema): its files, each read
    from a temporary file, then deleted."""
    st = Etat(ctx.root, SOURCE)
    key = f"annee-{year}"
    done = set(st.get(key).get("lus") or [])
    base = f.conf["sources"]["boamp"]["archive"]
    schema = "Boamp_v240" if year >= 2022 else "Boamp_v230"
    queue = [f"FluxHistorique/{schema}/{year}/"]
    erased = ctx.effaces()
    found = st.get(key).get("avis_video") or 0
    tmp_dir = ctx.root / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    while queue:
        folder = queue.pop(0)
        r = f.get(base + folder, cache=False)
        if r.status != 200:
            continue
        for name in listing(r.body.decode("utf-8", "replace")):
            path = folder + name
            if name.endswith("/"):
                if not (year >= 2024 and re.fullmatch(r"\d{2}/", name)):  # 2024's days: daily
                    queue.append(path)
                continue
            if path in done or not re.search(r"\.(tar\.gz|tgz|taz|zip|tar)$", name):
                continue
            if ctx.out_of_time():
                return st.save(key, statut="en_cours", lus=sorted(done), avis_video=found)
            dest = tmp_dir / (re.sub(r"\W", "_", path) + ".arc")
            meta = dest.with_name(dest.name + ".meta.json")
            try:
                f.download(base + path, dest)
                mention = {
                    "source": "DILA",
                    "adresse": base + path,
                    "fichier": name,
                    "date_fichier": _last_modified(meta.read_text("utf-8")),
                }
                items = [
                    n
                    for m, xml in _members_of(dest)
                    if (n := notice(xml, {**mention, "fichier": f"{name}/{m}"}))
                ]
                found += _keep(store, items, erased)
            finally:
                for p in (dest, meta):
                    p.unlink(missing_ok=True)
            done.add(path)
            st.save(key, statut="en_cours", lus=sorted(done), avis_video=found)
    return st.save(key, statut="termine", lus=sorted(done), avis_video=found, termine=True)


def _last_modified(meta: str) -> str:
    m = re.search(r'"last_modified":\s*"([^"]*)"', meta)
    return m.group(1) if m else ""


def days_to_read(ctx: Contexte) -> list[dt.date]:
    """Today, then every day back to 2024-01-01 not yet over, newest first."""
    st = Etat(ctx.root, SOURCE)
    days = []
    d = ctx.today
    while d >= FIRST_DAILY:
        if not st.get(f"jour-{d.isoformat()}").get("termine"):
            days.append(d)
        d -= dt.timedelta(days=1)
    return days


def collect(ctx: Contexte) -> dict[str, Any]:
    """The daily flow over HTTP (the last `flux_jours` days), then the history: over FTPS
    when the rules give it (one connection, a capped rate), else over HTTP; then the yearly
    files. Never both channels at once: the archive's server has one queue."""
    f = ctx.fetcher(SOURCE)
    conf = f.conf["sources"]["boamp"]
    store = Store(ctx.root, "avis")
    first_year = int(conf["first_year"])
    http = Http(f)
    flow = ctx.today - dt.timedelta(days=int(conf.get("flux_jours", 2)) - 1)
    days = days_to_read(ctx)
    read_days, canal_used = 0, "https"
    for day in [d for d in days if d >= flow]:
        if ctx.out_of_time():
            break
        collect_day(ctx, http, day, store)
        read_days += 1
    history = [d for d in days if d < flow]
    canal: Any = http
    ftp = None
    if history and conf.get("ftps") and not ctx.out_of_time():
        from lacarte_collecte import ftps

        try:
            ftp = ftps.open_from(ctx, conf["ftps"], f)
            canal, canal_used = ftp, "ftps"
        except ftps.Indisponible as e:
            Etat(ctx.root, SOURCE).save("", ftps=f"indisponible : {e}")
    try:
        for day in history:
            if ctx.out_of_time():
                break
            try:
                got = collect_day(ctx, canal, day, store)
                if ftp is not None and got.get("statut") == "absent":
                    # a folder FTPS does not show: asked over HTTP before calling it absent
                    collect_day(ctx, http, day, store)
            except Exception as e:  # a cut FTPS connection: the rest over HTTP
                if ftp is None or not ftps_cut(e):
                    raise
                Etat(ctx.root, SOURCE).save("", ftps=f"coupé : {e}")
                ftp.close()
                ftp, canal, canal_used = None, http, "ftps puis https"
                collect_day(ctx, canal, day, store)
            read_days += 1
    finally:
        if ftp is not None:
            ftp.close()
    st = Etat(ctx.root, SOURCE)
    for year in range(min(ctx.today.year, 2024), first_year - 1, -1):
        if ctx.out_of_time():
            break
        if not st.get(f"annee-{year}").get("termine"):
            collect_yearly(ctx, f, year, store)
    left = len(days_to_read(ctx)) - (0 if ctx.out_of_time() else 1)  # today, always again
    years_left = [y for y in range(first_year, 2025) if not st.get(f"annee-{y}").get("termine")]
    return {
        "source": SOURCE,
        "jours_lus": read_days,
        "jours_restants": max(left, 0),
        "annees_restantes": years_left,
        "canal_historique": canal_used,
        "requetes": f.requests,
    }


def ftps_cut(e: Exception) -> bool:
    import ftplib

    return isinstance(e, (OSError, EOFError, ftplib.Error))
