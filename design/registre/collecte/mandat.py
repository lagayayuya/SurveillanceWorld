"""Label an act with the municipal mandate in force on its date (never an elected person's name).

Usage: python -I mandat.py <mandats_municipaux.csv> <AAAA-MM-JJ> [...]

Before the first round of a renewal: the outgoing mandate. Between the first and second round:
« renouvellement en cours » (a commune may be decided on the first round or the second).
After the second round: the new mandate.
"""

import csv
import sys

rows = list(csv.DictReader(open(sys.argv[1])))


def label(date: str) -> str:
    current = "avant 2020"
    for r in rows:
        if date < r["premier_tour"]:
            return current
        if date < r["second_tour"]:
            return "renouvellement en cours"
        current = f"mandat {r['mandat']}"
    return current


for d in sys.argv[2:]:
    print(d, label(d))
