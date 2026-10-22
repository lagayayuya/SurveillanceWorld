#!/usr/bin/env bash
# Load an export of `lacarte db load --to-dir DIR` (meta.tsv, cameras.tsv.gz,
# buildings.tsv.gz) into the participation database: fill new tables, index them, then swap
# them in with the meta row in one transaction, so the API never sees half a build. The
# tables they replace stay as cameras_prev, buildings_prev and meta_prev (one build back,
# the older ones dropped): db/rollback.sh swaps them back at once.
# The buildings (every prepared building of the region, a few hundred MB) are loaded again
# only when their digest (meta.tsv's last column) differs from the one in the database;
# when it does not, buildings.tsv.gz may be absent (deploy/deploy.sh then does not send it).
# Needs psql and gzip only, so it also runs on the server.
#   db/load.sh DIR [DSN]        (without DSN: the PG* environment)
set -euo pipefail
dir="$1"
psql=(psql -X -q -v ON_ERROR_STOP=1 ${2:+"$2"})

want="$(cut -f6 "$dir/meta.tsv")"
# Before migration 007 there is no digest column: the buildings are loaded.
have="$("${psql[@]}" -At -c "SELECT buildings_sha256 FROM meta" 2>/dev/null || true)"
buildings=1
if [ -n "$want" ] && [ "$want" = "$have" ]; then
  buildings=0
  echo "buildings unchanged (${want:0:8}): table kept"
elif [ ! -f "$dir/buildings.tsv.gz" ]; then
  echo "buildings.tsv.gz missing and the database holds other buildings (${have:0:8})" >&2
  exit 1
fi

"${psql[@]}" <<'SQL'
SET client_min_messages = warning;
DROP TABLE IF EXISTS buildings_new, cameras_new;
CREATE TABLE cameras_new (LIKE cameras INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
SQL
if [ "$buildings" = 1 ]; then
  "${psql[@]}" <<'SQL'
CREATE TABLE buildings_new (LIKE buildings INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
SQL
  gzip -dc "$dir/buildings.tsv.gz" | "${psql[@]}" -c "COPY buildings_new FROM STDIN"
  "${psql[@]}" <<'SQL'
ALTER TABLE buildings_new ADD PRIMARY KEY (id);
CREATE INDEX buildings_new_geom ON buildings_new USING gist (geom);
ANALYZE buildings_new;
SQL
fi
gzip -dc "$dir/cameras.tsv.gz" | "${psql[@]}" -c "COPY cameras_new FROM STDIN"
"${psql[@]}" <<'SQL'
ALTER TABLE cameras_new ADD PRIMARY KEY (camera_id);
CREATE INDEX cameras_new_geom ON cameras_new USING gist (geom);
ANALYZE cameras_new;
SQL
# The swap, the replaced tables kept one build back. Unchanged buildings keep no
# buildings_prev: the build before had the same ones. Grants follow the default privileges
# set by deploy/bootstrap.sh (a renamed table keeps its own).
swap_buildings="DROP TABLE IF EXISTS buildings_prev;"
if [ "$buildings" = 1 ]; then
  swap_buildings="$swap_buildings
ALTER TABLE buildings RENAME TO buildings_prev;
ALTER INDEX buildings_pkey RENAME TO buildings_prev_pkey;
ALTER INDEX buildings_geom RENAME TO buildings_prev_geom;
ALTER TABLE buildings_new RENAME TO buildings;
ALTER INDEX buildings_new_pkey RENAME TO buildings_pkey;
ALTER INDEX buildings_new_geom RENAME TO buildings_geom;"
fi
"${psql[@]}" -1 <<SQL
SET client_min_messages = warning;
$swap_buildings
DROP TABLE IF EXISTS cameras_prev, meta_prev;
ALTER TABLE cameras RENAME TO cameras_prev;
ALTER INDEX cameras_pkey RENAME TO cameras_prev_pkey;
ALTER INDEX cameras_geom RENAME TO cameras_prev_geom;
ALTER TABLE cameras_new RENAME TO cameras;
ALTER INDEX cameras_new_pkey RENAME TO cameras_pkey;
ALTER INDEX cameras_new_geom RENAME TO cameras_geom;
CREATE TABLE meta_prev AS TABLE meta;
DELETE FROM meta;
\copy meta FROM '$dir/meta.tsv'
SQL
"${psql[@]}" -At -c "SELECT 'loaded ' || build_id || ': ' || (SELECT count(*) FROM cameras)
  || ' cameras, ' || (SELECT count(*) FROM buildings) || ' buildings' FROM meta"
