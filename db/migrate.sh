#!/usr/bin/env bash
# Apply the migrations of db/migrations not yet applied, each in its own transaction, and
# print "applied <version>" for each. Needs psql only, so it also runs on the server;
# `lacarte db migrate` calls it. MIGRATE_UNTIL=<version>: none after it (db/restore.sh).
#   db/migrate.sh [DSN]        (without DSN: the PG* environment)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export PGOPTIONS="-c client_min_messages=warning"
psql=(psql -X -q -v ON_ERROR_STOP=1 ${1:+"$1"})
"${psql[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY)"
applied="$("${psql[@]}" -At -c "SELECT version FROM schema_migrations")"
for f in "$here"/migrations/*.sql; do
  v="$(basename "$f" .sql)"
  if [ -n "${MIGRATE_UNTIL:-}" ] && [[ "$v" > "$MIGRATE_UNTIL" ]]; then break; fi
  if grep -qx "$v" <<<"$applied"; then continue; fi
  { cat "$f"; printf "\nINSERT INTO schema_migrations VALUES ('%s');\n" "$v"; } | "${psql[@]}" -1
  echo "applied $v"
done
