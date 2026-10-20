-- The API changes nothing but a contribution's status once written (confirmations,
-- rejection): its role may update that column only, not the author, day, position or
-- payload. Replaces the table-wide UPDATE of 002. Nothing where the role does not exist.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        REVOKE UPDATE ON contributions FROM preview_api;
        GRANT UPDATE (status) ON contributions TO preview_api;
    END IF;
END $$;
