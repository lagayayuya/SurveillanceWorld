#!/usr/bin/env bash
# Write what the build did with each exported contribution (contrib_outcome.json of the
# `apply` stage, rules/contributions.yaml) into the participation database, after
# db/load.sh swapped that build in: status applied / superseded / conflict, the build, and
# the detail (the OSM version found; for a conflict the element's position and tags now).
# Run as the tables' owner (the deploy role): the migration 005 trigger refuses these
# statuses to anyone else. A contribution the review rejected or sent back to pending
# since the export is left alone. Then the hidden cameras the build left out
# (hidden-applied.txt, the extract's list) are marked gone from the map with this build
# (db/settle_hidden.sql). Needs psql only.
#   db/settle.sh DIR [DSN]        (without DSN: the PG* environment)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
f="$1/contrib_outcome.json"
if [ -f "$f" ]; then
  psql -X -q -At -v ON_ERROR_STOP=1 ${2:+"$2"} -v doc="$(cat "$f")" -1 \
    -f "$here/settle_contributions.sql"
else
  echo "settled: no contribution in this build"
fi
h="$1/hidden-applied.txt"
if [ -f "$h" ]; then
  psql -X -q -At -v ON_ERROR_STOP=1 ${2:+"$2"} -v ids="$(cat "$h")" -1 \
    -f "$here/settle_hidden.sql"
fi
