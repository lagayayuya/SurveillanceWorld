#!/usr/bin/env bash
# Remove every contribution (opinions included: they are contributions too) of the
# preview's database, after dumping them: the test data of the participation prototype
# (phase "Retours terrain"). Run as the tables' owner on the server, like db/settle.sh.
# Refused unless STAGE=preview (deploy.env) and REGION is the database's own region
# (meta.region). --dry-run prints what would go (by status and kind) and changes nothing.
# A real run needs --backup FILE: the contributions are dumped there first (pg_dump -Fc,
# checked with pg_restore --list), then deleted in one transaction. The accounts (their
# test flags and sessions included) and the served build's tables are left as they are.
#   STAGE=preview db/reset_contributions.sh [--dry-run | --backup FILE] REGION [DSN]
set -euo pipefail
dry="" backup=""
case "${1:-}" in
  --dry-run) dry=1; shift ;;
  --backup) backup="${2:?--backup FILE}"; shift 2 ;;
esac
region="${1:?REGION}"
dsn="${2:-}"
psql=(psql -X -q -v ON_ERROR_STOP=1 -At ${dsn:+"$dsn"})

if [ "${STAGE:-}" != "preview" ]; then
  echo "refused: STAGE is '${STAGE:-}', not preview (deploy.env)" >&2
  exit 1
fi
have="$("${psql[@]}" -c "SELECT region FROM meta")"
if [ "$have" != "$region" ]; then
  echo "refused: REGION $region, the database holds '$have'" >&2
  exit 1
fi
if [ -z "$dry" ] && [ -z "$backup" ]; then
  echo "refused: a real run needs --backup FILE (or --dry-run)" >&2
  exit 1
fi

echo "contributions by status and kind:"
"${psql[@]}" -F $'\t' -c "SELECT status, kind, count(*) FROM contributions
                         GROUP BY 1, 2 ORDER BY 1, 2"
total="$("${psql[@]}" -c "SELECT count(*) FROM contributions")"
echo "total: $total"
if [ -n "$dry" ]; then
  echo "dry run: nothing deleted"
  exit 0
fi

pg_dump -Fc -t contributions ${dsn:+"$dsn"} -f "$backup"
pg_restore --list "$backup" | grep -q "TABLE DATA public contributions" ||
  { echo "the backup $backup holds no contributions table: nothing deleted" >&2; exit 1; }
echo "backup: $backup ($(wc -c < "$backup" | tr -d ' ') bytes)"
"${psql[@]}" -1 -c "DELETE FROM contributions" >/dev/null
echo "deleted: $total; left: $("${psql[@]}" -c "SELECT count(*) FROM contributions")"
