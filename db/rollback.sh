#!/usr/bin/env bash
# Swap the build's tables back to the build before (db/load.sh keeps cameras_prev,
# buildings_prev when the buildings changed, and meta_prev), in one transaction: run twice,
# it swaps forward again. Refused when a migration changed the tables since (their columns
# differ): then the deploy's dump restores, db/restore.sh. The contributions the newer build
# settled (db/settle.sh) stay settled. deploy/rollback.sh runs it with the release before.
#   db/rollback.sh [DSN]        (without DSN: the PG* environment)
set -euo pipefail
psql=(psql -X -q -v ON_ERROR_STOP=1 ${1:+"$1"})

have() { [ "$("${psql[@]}" -At -c "SELECT to_regclass('$1') IS NOT NULL")" = t ]; }
for t in cameras_prev meta_prev; do
  have "$t" || { echo "refused: no $t, nothing to go back to" >&2; exit 1; }
done
columns() {
  "${psql[@]}" -At -c "SELECT string_agg(column_name || ' ' || data_type, ', '
    ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = '$1'"
}
for t in cameras meta $(have buildings_prev && echo buildings); do
  [ "$(columns "$t")" = "$(columns "${t}_prev")" ] ||
    { echo "refused: $t and ${t}_prev differ (a migration since): restore the dump" >&2; exit 1; }
done

swap() {  # table: the two tables and their indexes trade names
  cat <<SQL
ALTER TABLE $1 RENAME TO $1_swap;
ALTER INDEX $1_pkey RENAME TO $1_swap_pkey;
ALTER INDEX $1_geom RENAME TO $1_swap_geom;
ALTER TABLE $1_prev RENAME TO $1;
ALTER INDEX $1_prev_pkey RENAME TO $1_pkey;
ALTER INDEX $1_prev_geom RENAME TO $1_geom;
ALTER TABLE $1_swap RENAME TO $1_prev;
ALTER INDEX $1_swap_pkey RENAME TO $1_prev_pkey;
ALTER INDEX $1_swap_geom RENAME TO $1_prev_geom;
SQL
}
{
  swap cameras
  if have buildings_prev; then swap buildings; fi
  cat <<'SQL'
CREATE TEMP TABLE meta_swap AS TABLE meta;
DELETE FROM meta;
INSERT INTO meta SELECT * FROM meta_prev;
DELETE FROM meta_prev;
INSERT INTO meta_prev SELECT * FROM meta_swap;
SQL
} | "${psql[@]}" -1
"${psql[@]}" -At -c "SELECT 'now ' || build_id || ': ' || (SELECT count(*) FROM cameras)
  || ' cameras, ' || (SELECT count(*) FROM buildings) || ' buildings' FROM meta"
