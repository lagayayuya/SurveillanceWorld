#!/usr/bin/env bash
# Restore a dump of the participation database into a fresh one, then migrate it: the
# accounts, the contributions, what publishing to OSM keeps (write tokens, publications,
# nodes), the hidden cameras, the journal, the settings, the site's counters (021, by hour,
# day and month), and
# the meta row (its region: `lacarte contrib export` reads it before any deploy) — never
# the sessions nor the cameras and buildings, which the next deploy loads (db/load.sh, the
# buildings whatever their digest) and settles (db/settle.sh).
#   db/restore.sh DUMP [DSN]       (without DSN: the PG* environment)
# DUMP: pg_dump -Fc of the database, whole or with -t (the nightly backup, the deploy's).
# As the tables' owner (on the server the deploy user, over the local socket), on a
# database where the postgis extension exists and nothing else (bootstrap.sh makes it so,
# before the first deploy): it refuses a database already migrated.
# How: the migrations up to the dump's own last one, the dump's rows (data only, the
# owner's triggers off while they load: each row was checked when it was written), then
# the migrations after it, as a deploy would. Owners and grants are the migrations' own,
# whatever role owned the dumped tables.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dump="${1:?usage: db/restore.sh DUMP [DSN]}"
dsn="${2:-}"
[ -f "$dump" ] || { echo "no dump at $dump" >&2; exit 1; }
export PGOPTIONS="-c client_min_messages=warning"
psql=(psql -X -q -v ON_ERROR_STOP=1 ${dsn:+"$dsn"})

if [ "$("${psql[@]}" -At -c "SELECT to_regclass('schema_migrations') IS NOT NULL")" = t ]; then
  echo "refused: this database is not fresh (schema_migrations exists)" >&2
  exit 1
fi
# The dump's last migration: its schema_migrations rows (COPY text, one version a line).
version="$(pg_restore -a -t schema_migrations -f - "$dump" |
  awk '/^COPY /{on=1; next} /^\\\.$/{on=0} on{print $1}' | sort | tail -n 1)"
if [ -z "$version" ] || [ ! -f "$here/migrations/$version.sql" ]; then
  echo "refused: the dump's last migration (${version:-none}) is not one of db/migrations" >&2
  exit 1
fi
echo "dump at $version"
MIGRATE_UNTIL="$version" "$here/migrate.sh" ${dsn:+"$dsn"}

# Its rows: every table's but the cameras', buildings', sessions' and the migrations' list; the
# tables others point at first (accounts, then contributions), each table whole in one COPY.
list="$(mktemp)"
trap 'rm -f "$list"' EXIT
pg_restore -l "$dump" |
  awk '$4 == "TABLE" && $5 == "DATA" && $6 == "public" &&
       $7 !~ /^(buildings|cameras|sessions|schema_migrations|spatial_ref_sys)$/ {
         print ($7 == "accounts" ? 0 : $7 == "contributions" ? 1 : 2) "\t" $0 }' |
  sort -s -t "$(printf '\t')" -k1,1n | cut -f2- >"$list"
tables="$(awk '{print $7}' "$list")"
[ -n "$tables" ] || { echo "refused: the dump holds no rows to restore" >&2; exit 1; }
# A migration may seed a table (020: the site's settings): the dump's rows replace what the
# migrations wrote, in the same transaction (the database is fresh: nothing else is there).
{
  for t in $tables; do echo "ALTER TABLE public.$t DISABLE TRIGGER USER;"; done
  for t in $tables; do echo "DELETE FROM public.$t;"; done
  pg_restore -a -L "$list" -f - "$dump"
  for t in $tables; do echo "ALTER TABLE public.$t ENABLE TRIGGER USER;"; done
} | "${psql[@]}" -1 >/dev/null  # pg_restore's own set_config() answers a row
echo "restored: $(echo $tables)"
"$here/migrate.sh" ${dsn:+"$dsn"}
# Only the tables' rows were restored, not their sequences' positions: each serial column
# continues after its largest restored value (020: the journal's numbers).
"${psql[@]}" -c "SELECT setval('admin_log_seq_seq', coalesce(max(seq), 0) + 1, false)
  FROM admin_log" >/dev/null
# The buildings were not restored: the next deploy must load them, whatever its digest.
"${psql[@]}" -c "UPDATE meta SET buildings_sha256 = NULL"

"${psql[@]}" -At -c "SELECT 'last migration: ' || max(version) FROM schema_migrations"
for t in accounts contributions osm_write osm_publications osm_nodes hidden_cameras \
  admin_log site_settings site_counters_hour site_counters site_counters_month meta; do
  "${psql[@]}" -At -c "SELECT '$t: ' || count(*) FROM $t"
done
echo "next: the contributions export reads it; a deploy then loads the build and settles them"
