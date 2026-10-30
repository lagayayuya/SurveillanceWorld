#!/usr/bin/env bash
# Load the register's search rows (`lacarte-registre construire` → recherche.tsv.gz, migration
# 027) into the participation database: a new table filled and indexed, then swapped in one
# transaction, so the search never sees half a register. The table it replaces stays as
# registre_recherche_prev (one build back; dropped at the next load).
# Needs psql and gzip only, so it also runs on the server.
#   db/load_registre.sh FILE [DSN]        (without DSN: the PG* environment)
set -euo pipefail
file="$1"
psql=(psql -X -q -v ON_ERROR_STOP=1 ${2:+"$2"})
"${psql[@]}" <<'SQL'
SET client_min_messages = warning;
DROP TABLE IF EXISTS registre_recherche_new;
CREATE TABLE registre_recherche_new (LIKE registre_recherche INCLUDING ALL);
SQL
gzip -dc "$file" | "${psql[@]}" -c \
  "COPY registre_recherche_new (id, t, d, p, y, date, rang, mots, doc, dico) FROM STDIN"
"${psql[@]}" -c "ANALYZE registre_recherche_new"
# The swap; the grants follow the default privileges set by deploy/bootstrap.sh, and the
# API's SELECT is given again (a new table has none of the old one's).
"${psql[@]}" -1 <<'SQL'
SET client_min_messages = warning;
DROP TABLE IF EXISTS registre_recherche_prev;
ALTER TABLE registre_recherche RENAME TO registre_recherche_prev;
ALTER TABLE registre_recherche_new RENAME TO registre_recherche;
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT SELECT ON registre_recherche TO preview_api;
    END IF;
END $$;
SQL
"${psql[@]}" -At -c "SELECT 'register search loaded: ' || count(*) || ' documents' FROM registre_recherche"
