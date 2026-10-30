"""Strip natural persons from BOAMP records, at collection time and over files already held.

Usage (rewrite in place): python -I sanitize.py <file.jsonl> [...]
Imported by boamp_fetch.py: `clean(record) -> record`.

Kept: legal entities (buyer), SIRET/SIREN, functions ("le maire"), places, the notice text.
Removed: contact blocks (names, e-mails, phones, faxes) in both schemas, holders' names (a holder
can be a sole trader: holders come from DECP by SIREN, checked against SIRENE), and, in free
text, e-mail addresses, phone numbers and a civility followed by a name.
"""

import json
import re
import sys

DROP_KEYS = {
    "CORRESPONDANT", "CONTACT", "MEL", "TEL", "FAX", "nomContact", "telContact", "adresseMailContact",
    "PersonnePhysique", "cac:Contact", "titulaire",
    # Contact-heavy sections with no analytic use (the bulk of the names left after the rest).
    "RENS_COMPLEMENT", "ADRESSES_COMPLEMENTAIRES",
}
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?:\(\+33\)|\+33|\b0)\s*[1-9](?:[\s.-]*\d{2}){4}\b")
# No word boundary before the civility: the text often glues it to the previous word (« patrimoineM. »).
CIVILITY = re.compile(r"(?:M\.|Mme|MME|Mlle|MLLE|Monsieur|MONSIEUR|Madame|MADAME|Mr)\s+(?:[A-ZÉÈÀÂÎÔÛÇ][\w'’-]+\s*){1,3}")
# A rank or title followed by a name: keep the function, drop the name.
RANK = re.compile(r"\b((?:adjudant|brigadier)(?:-chef)?|capitaine|lieutenant(?:-colonel)?|commandant|colonel|major"
                  r"|gardien de la paix|chef de service|directeur|directrice|interlocuteur|interlocutrice)\s+"
                  r"(?:[A-ZÉÈÀÂÎÔÛÇ][\w'’-]+\s+){1,2}", re.I)


# A tribute or a memorial names a person: « marche en hommage à Prénom NOM ».
TRIBUTE = re.compile(r"\b((?:en\s+)?(?:hommage|m[ée]moire)\s+(?:à|a|de|d['’])\s*)(?:[A-ZÉÈÀÂÎÔÛÇ][\w'’-]+\s*){1,3}")
# A street named after a rank keeps its name (« rue du Colonel Chambonnet »): a way type
# within the two words before the rank.
STREET_BEFORE = re.compile(r"\b(?:rue|avenue|av\.|boulevard|bd|quai|place|cours|allée|allee|chemin|route|impasse|montée|montee|pont|passage|square|esplanade|rond-point|voie|parvis)\s+(?:\S+\s+)?$", re.I)


# The signature block of an order: the line(s) after « ORIGINAL SIGNE » give the signatory's name.
SIGNED = re.compile(r"(?im)^(\s*original sign[ée]\s*\n)((?:[ \t]*[A-ZÉÈÀÂÎÔÛÇ][\w'’.\-]*(?:[ \t]+[A-ZÉÈÀÂÎÔÛÇ][\w'’.\-]*){1,3}[ \t]*(?:\n|$)){1,2})")


def _rank(m, s):
    if STREET_BEFORE.search(s[max(0, m.start() - 40):m.start()]):
        return m.group(0)
    return f"{m.group(1)} [nom retiré] "


def _text(s: str) -> str:
    s = EMAIL.sub("[courriel retiré]", s)
    s = PHONE.sub("[téléphone retiré]", s)
    s = CIVILITY.sub("[nom retiré] ", s)
    s = TRIBUTE.sub(lambda m: f"{m.group(1)}[nom retiré] ", s)
    s = SIGNED.sub(lambda m: f"{m.group(1)} [nom retiré]\n", s)
    return RANK.sub(lambda m: _rank(m, s), s)


def _walk(o):
    if isinstance(o, dict):
        natural = str(o.get("efbc:NaturalPersonIndicator", "")).lower() == "true"
        out = {}
        for k, v in o.items():
            if k in DROP_KEYS:
                continue
            if k == "TITULAIRE":  # keep only the identifier of the holder
                v = [_holder(x) for x in v] if isinstance(v, list) else _holder(v)
            elif natural and k in ("cac:PartyName", "cac:PostalAddress"):
                continue
            out[k] = _walk(v)
        return out
    if isinstance(o, list):
        return [_walk(v) for v in o]
    if isinstance(o, str):
        return _text(o)
    return o


def _holder(h):
    if not isinstance(h, dict):
        return {}
    return {k: v for k, v in h.items() if k in ("CODE_IDENT_NATIONAL", "TYPE_IDENT_NATIONAL")}


def clean(rec: dict) -> dict:
    rec = {k: v for k, v in rec.items() if k not in DROP_KEYS}
    for f in ("donnees", "gestion"):
        if rec.get(f):
            rec[f] = json.dumps(_walk(json.loads(rec[f])), ensure_ascii=False)
    if rec.get("objet"):
        rec["objet"] = _text(rec["objet"])
    return rec


if __name__ == "__main__":
    for path in sys.argv[1:]:
        lines = [json.dumps(clean(json.loads(line)), ensure_ascii=False) for line in open(path)]
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")
        print(path, len(lines), "records cleaned")
