#!/usr/bin/env bash
# Set the test accounts (accounts.test, migration 014) to those given, in one transaction,
# as the tables' owner; deploy/deploy.sh passes TEST_AUTHORS. Names are pseudonyms, matched
# without case; a name no account has yet becomes a placeholder (no password: it cannot sign
# in), which `lacarte accounts create` claims later with its flag. Every other account is
# not a test account.
#   db/test_authors.sh "ivo,zz" [DSN]        (an empty list: no test account)
set -euo pipefail
list="$(printf '%s' "${1:-}" | tr -s ' ,' ',' | sed 's/^,//; s/,$//')"
if [ -n "$list" ] && ! printf '%s' "$list" | grep -Eqx '[A-Za-z0-9._-]{2,32}(,[A-Za-z0-9._-]{2,32})*'; then
  echo "test_authors: not pseudonyms" >&2
  exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 -v "list=$list" ${2:+"$2"} -1 <<'SQL'
CREATE TEMP TABLE listed ON COMMIT DROP AS
SELECT DISTINCT ON (lower(n)) n FROM unnest(string_to_array(:'list', ',')) n ORDER BY lower(n), n;
INSERT INTO accounts (pseudonym, created_month)
SELECT n, date_trunc('month', current_date)::date FROM listed
WHERE NOT EXISTS (SELECT FROM accounts a WHERE lower(a.pseudonym) = lower(n));
UPDATE accounts a SET test = EXISTS (SELECT FROM listed WHERE lower(n) = lower(a.pseudonym))
WHERE test IS DISTINCT FROM EXISTS (SELECT FROM listed WHERE lower(n) = lower(a.pseudonym));
SQL
echo "test accounts: $(printf '%s' "$list" | tr ',' '\n' | grep -c . || true)"
