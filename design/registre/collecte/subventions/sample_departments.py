"""Draw the random sample of 10 departments for the DETR publication check.

Usage: python -I sample_departments.py <departements.json>
Excludes 75 (no DETR), 69 and 13 (already measured). Seed 20261023, fixed.
"""
import json, random, sys
deps = [d for d in json.load(open(sys.argv[1])) if d["code"] not in ("75", "69", "13")]
random.seed(20261023)
for d in sorted(random.sample(deps, 10), key=lambda d: d["code"]):
    print(d["code"], d["nom"])
