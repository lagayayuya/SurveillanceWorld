-- The register's search for all of France (lot R3, GET /api/registre/recherche,
-- lacarte.api.registre): recherche.json held every document of the pilot and loaded in the
-- browser; the national procurement does not fit there, so the search runs here.
--
-- One row per document, written by `lacarte-registre construire` (recherche.py:
-- data/registre/recherche.tsv.gz) and loaded at the deploy with the rest of the database
-- (db/load_registre.sh: a new table filled, indexed, then swapped in one transaction, the
-- previous one kept as registre_recherche_prev for db/rollback.sh). Public data only, as
-- the register's files: no reader's query is ever stored or logged.
CREATE TABLE registre_recherche (
    id text PRIMARY KEY,                -- the document's id (an evenement of the register)
    t text NOT NULL,                    -- its kind: con, mod, ao, aut, sub
    d text NOT NULL,                    -- its département ('' when unknown)
    p text NOT NULL,                    -- its device: vp, csu, vsa, lapi, pi, vv, dr, na
    y text NOT NULL,                    -- its year group: 2018 … , <2018, '' (no date)
    date text NOT NULL,                 -- the sort by date (regles.sort_key)
    rang double precision NOT NULL,     -- the sort by amount: a counted contract's, a subsidy's
    mots text NOT NULL,                 -- its words, accents and case folded
    texte tsvector GENERATED ALWAYS AS (to_tsvector('french', mots)) STORED,
    doc jsonb NOT NULL,                 -- the document as the register's files serve it
    dico jsonb NOT NULL                 -- the names it needs: its companies, buyer, commune
);
CREATE INDEX registre_recherche_texte ON registre_recherche USING gin (texte);
CREATE INDEX registre_recherche_date ON registre_recherche (date DESC);
CREATE INDEX registre_recherche_rang ON registre_recherche (rang DESC, date DESC);

-- The API reads it, never writes it.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        REVOKE ALL ON registre_recherche FROM preview_api;
        GRANT SELECT ON registre_recherche TO preview_api;
    END IF;
END $$;
