#!/usr/bin/env bash
# The test accounts and what they wrote, out of a RESTORED copy of the database (db/restore.sh,
# before its first deploy), never out of a database in service. Lists first; deletes only
# with --delete, in one transaction.
#   TEST_AUTHORS="ivo,zz" db/purge_test_accounts.sh [--keep NAMES] [--delete] [DSN]
# A test account: one flagged test (accounts.test, db/test_authors.sh) or named in
# TEST_AUTHORS (any case). --keep NAMES (comma-separated): never deleted, even so.
# Deleted with them: their contributions, and every contribution about one of those (an
# opinion on it, an answer on their add, and so on down), whoever wrote it — data about test
# data, that never reaches the map; with the contributions, what became of them on OSM
# (osm_publications, by cascade), and with the accounts their sessions and publishing
# choice. Their decisions on contributions that stay keep their status, without decider.
# The listing says each of these counts; every other account and contribution stays.
set -euo pipefail
keep="" delete=0 dsn=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep="${2:?--keep NAMES}"; shift ;;
    --delete) delete=1 ;;
    -*) echo "usage: db/purge_test_accounts.sh [--keep NAMES] [--delete] [DSN]" >&2; exit 2 ;;
    *) dsn="$1" ;;
  esac
  shift
done
names() { printf '%s' "$1" | tr -s ' ,' ',' | sed 's/^,//; s/,$//'; }
listed="$(names "${TEST_AUTHORS:-}")" kept="$(names "$keep")"
for v in "$listed" "$kept"; do
  if [ -n "$v" ] && ! printf '%s' "$v" | grep -Eqx '[A-Za-z0-9._-]{2,32}(,[A-Za-z0-9._-]{2,32})*'; then
    echo "refused: TEST_AUTHORS and --keep are pseudonyms, comma-separated" >&2
    exit 1
  fi
done
export PGOPTIONS="-c client_min_messages=warning"
psql -X -q -At -F ' ' -v ON_ERROR_STOP=1 -v "listed=$listed" -v "kept=$kept" \
  -v "delete=$delete" ${dsn:+"$dsn"} <<'SQL'
BEGIN;
CREATE TEMP TABLE doomed_accounts ON COMMIT DROP AS
SELECT a.id, a.pseudonym, a.test,
       lower(a.pseudonym) = ANY (string_to_array(lower(:'listed'), ',')) AS named
FROM accounts a
WHERE (a.test OR lower(a.pseudonym) = ANY (string_to_array(lower(:'listed'), ',')))
  AND lower(a.pseudonym) <> ALL (string_to_array(lower(:'kept'), ','));
-- Their contributions, and everything about them, down the targets.
CREATE TEMP TABLE doomed ON COMMIT DROP AS
WITH RECURSIVE d(uuid, theirs) AS (
    SELECT uuid, true FROM contributions WHERE author_id IN (SELECT id FROM doomed_accounts)
    UNION
    SELECT c.uuid, false FROM contributions c JOIN d ON c.target = d.uuid
)
SELECT uuid, bool_or(theirs) AS theirs FROM d GROUP BY uuid;

SELECT 'test accounts: ' || count(*) || ' (flagged test or named in TEST_AUTHORS'
       || CASE WHEN :'kept' <> '' THEN '; kept: ' || :'kept' ELSE '' END || ')'
FROM doomed_accounts;
SELECT 'account ' || d.pseudonym,
       CASE WHEN d.test THEN 'flagged' ELSE 'not-flagged' END,
       CASE WHEN d.named THEN 'named' ELSE 'not-named' END,
       a.role,
       CASE WHEN a.password_hash IS NULL AND a.osm_id IS NULL THEN 'placeholder'
            ELSE 'claimed' END,
       (SELECT count(*) FROM contributions c WHERE c.author_id = d.id) || ' contributions',
       (SELECT count(*) FROM contributions c WHERE c.decided_by_id = d.id
          AND c.uuid NOT IN (SELECT uuid FROM doomed)) || ' decisions on contributions that stay',
       (SELECT count(*) FROM sessions s WHERE s.account_id = d.id) || ' sessions',
       'publishing ' || coalesce((SELECT w.server FROM osm_write w WHERE w.account_id = d.id), '-')
FROM doomed_accounts d JOIN accounts a USING (id)
ORDER BY d.pseudonym COLLATE "C";
SELECT 'their contributions: ' || count(*) FILTER (WHERE theirs) FROM doomed;
SELECT 'contributions of other accounts about them, deleted with them: '
       || count(*) FILTER (WHERE NOT theirs) FROM doomed;
SELECT 'by status: ' || coalesce(string_agg(status || ' ' || n, ', ' ORDER BY status), 'none')
FROM (SELECT c.status, count(*) AS n FROM contributions c JOIN doomed USING (uuid)
      GROUP BY c.status) s;
SELECT 'their OSM publications (deleted with them): ' || count(*)
FROM osm_publications p JOIN doomed USING (uuid);
SELECT 'staying: ' || (SELECT count(*) FROM accounts) - (SELECT count(*) FROM doomed_accounts)
       || ' accounts, ' || (SELECT count(*) FROM contributions)
       - (SELECT count(*) FROM doomed) || ' contributions';
SELECT 'kept by --keep though flagged or named: ' || coalesce(string_agg(a.pseudonym, ', '
       ORDER BY a.pseudonym COLLATE "C"), 'none')
FROM accounts a
WHERE (a.test OR lower(a.pseudonym) = ANY (string_to_array(lower(:'listed'), ',')))
  AND lower(a.pseudonym) = ANY (string_to_array(lower(:'kept'), ','));

SELECT :delete = 1 AS deleting \gset
\if :deleting
DELETE FROM contributions WHERE uuid IN (SELECT uuid FROM doomed);
DELETE FROM osm_write WHERE account_id IN (SELECT id FROM doomed_accounts);
DELETE FROM accounts WHERE id IN (SELECT id FROM doomed_accounts);
SELECT 'deleted: ' || (SELECT count(*) FROM doomed_accounts) || ' accounts, '
       || (SELECT count(*) FROM doomed) || ' contributions';
COMMIT;
\else
SELECT 'listed only: nothing deleted (--delete deletes the above)';
ROLLBACK;
\endif
SQL
