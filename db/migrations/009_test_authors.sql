-- Phase "Retours terrain": the test accounts (TEST_AUTHORS in deploy.env, outside the
-- repository), written at every deploy by db/test_authors.sh as the tables' owner. The API
-- reads it to mark their contributions "test" in /revue and leave them out of the
-- statistics; the export reads TEST_AUTHORS itself (db/export_contributions.sql), since it
-- runs before the deploy that would fill this table.
CREATE TABLE test_authors (
    author text PRIMARY KEY CHECK (author ~ '^[A-Za-z0-9._-]{1,64}$')
);
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT SELECT ON test_authors TO preview_api;
    END IF;
END $$;
