-- The API's role (created by deploy/bootstrap.sh) writes contributions; it reads every
-- table through the default privileges bootstrap.sh sets, which also cover the tables
-- `lacarte db load` swaps in. Nothing happens where the role does not exist (tests, CI).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT SELECT, INSERT, UPDATE ON contributions TO preview_api;
    END IF;
END $$;
