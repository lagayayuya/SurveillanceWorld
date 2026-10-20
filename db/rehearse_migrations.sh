#!/usr/bin/env bash
# Rehearse the pending migrations on a copy of the preview database, before the deploy that
# applies them. The owner downloads the copy from the VPS (pg_dump -Fc, without the
# buildings' rows; e.g. data/backups/repetition-014.dump, under data/: never committed).
# Here it is restored into a throwaway database of a LOCAL PostgreSQL with PostGIS — a
# restore creates PostGIS, which needs a superuser the VPS's deploy user is not —, migrated,
# summed up (the accounts and how many contributions and decisions each holds, the
# contributions left without an author), then dropped. The dump file is kept.
#   make rehearse DUMP=data/backups/repetition-014.dump   (a throwaway local cluster)
#   db/rehearse_migrations.sh DUMP DSN                     (DSN: a local server, superuser)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dump="${1:?usage: db/rehearse_migrations.sh DUMP DSN}"
src="${2:?usage: db/rehearse_migrations.sh DUMP DSN}"
[ -f "$dump" ] || { echo "no dump at $dump" >&2; exit 1; }
copy="rehearsal_$(date +%Y%m%d%H%M%S)_$$"
# The same server, the copy's database: a URI's path, or a keyword string's dbname.
case "$src" in
  postgres://* | postgresql://*)
    base="${src%%\?*}"
    dst="${base%/*}/$copy${src#"$base"}"
    ;;
  *) dst="$(printf '%s' "$src" | sed -E 's/(^| )dbname=[^ ]*//g') dbname=$copy" ;;
esac
psql=(psql -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="-c client_min_messages=warning"

"${psql[@]}" "$src" -c "CREATE DATABASE $copy"
# Gone whatever happens (a session left by an interrupted restore included), and closed to
# every other role while it exists (a new database lets PUBLIC connect).
trap '"${psql[@]}" "$src" -c "DROP DATABASE IF EXISTS $copy WITH (FORCE)"' EXIT
"${psql[@]}" "$src" -c "REVOKE CONNECT, TEMPORARY ON DATABASE $copy FROM PUBLIC"
# The API's role, which the migrations grant to (bootstrap.sh makes it on the VPS).
"${psql[@]}" "$src" -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname =
  'preview_api') THEN CREATE ROLE preview_api; END IF; END \$\$"
# The VPS's owners and grants mean nothing here: the tables as this server's superuser's.
pg_restore --no-owner --no-acl -d "$dst" "$dump"

echo "before:"
"${psql[@]}" -At "$dst" -c "SELECT 'last migration: ' || max(version) FROM schema_migrations"
"${psql[@]}" -At "$dst" -c "SELECT 'contributions: ' || count(*) FROM contributions"
"$here/migrate.sh" "$dst"
echo "after:"
"${psql[@]}" -At -F ' ' "$dst" -c "
  SELECT 'account ' || a.pseudonym,
         CASE WHEN a.password_hash IS NULL THEN 'placeholder' ELSE 'claimed' END,
         CASE WHEN a.test THEN 'test' ELSE 'not-test' END,
         (SELECT count(*) FROM contributions c WHERE c.author_id = a.id) || ' contributions',
         (SELECT count(*) FROM contributions c WHERE c.decided_by_id = a.id) || ' decisions'
  FROM accounts a ORDER BY a.pseudonym COLLATE \"C\""
"${psql[@]}" -At "$dst" -c "SELECT 'contributions without an author: ' || count(*)
                            FROM contributions WHERE author_id IS NULL"
echo "rehearsal done: the copy $copy is dropped, $dump kept"
