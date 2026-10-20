-- /revue « Administrer » (lot 2, its contract): three roles, a journal of
-- what reviewers and administrators do, the site's settings in the database, and when a
-- hidden camera left the map.
--
-- Roles: contributor, reviewer (decides in /revue), admin (also manages accounts, hidden
-- cameras, settings, the journal). Every reviewer becomes an administrator: until now the
-- one review account was the owner's.
ALTER TABLE accounts DROP CONSTRAINT accounts_role;
UPDATE accounts SET role = 'admin' WHERE role = 'reviewer';
ALTER TABLE accounts ADD CONSTRAINT accounts_role
    CHECK (role IN ('contributor', 'reviewer', 'admin'));

-- The journal: a running number and a day, never a time of day nor an address; who acted
-- (their pseudonym kept as text when their account is deleted: the journal is kept 12
-- months, CNIL recommendation n° 2021-122 on logging, 6 months to a year; db/retention.sql,
-- run by the deploy as the owner, deletes older lines), what, on whom (the account and its
-- pseudonym, kept likewise), on what (a camera id, a contribution's uuid, a setting's key)
-- and the detail the API writes (statuses, counts, ids: never a person's free text).
-- A sign-in refused three times in a row has no actor (actor ''): the target is the
-- account whose password was tried.
CREATE TABLE admin_log (
    seq bigserial PRIMARY KEY,
    day date NOT NULL DEFAULT current_date,         -- a day, never a time
    actor_id uuid REFERENCES accounts ON DELETE SET NULL,
    actor text NOT NULL,
    action text NOT NULL CONSTRAINT admin_log_action CHECK (action IN (
        'decide', 'undo', 'on_site', 'role', 'disable', 'enable', 'cut', 'reset', 'delete',
        'export_account', 'export_csv', 'suspend', 'hide', 'unhide', 'setting',
        'signin_refused')),
    target_account uuid REFERENCES accounts ON DELETE SET NULL,
    target_name text,
    target text,
    detail jsonb
);
CREATE INDEX admin_log_actor ON admin_log (actor_id);
CREATE INDEX admin_log_target_account ON admin_log (target_account);
CREATE INDEX admin_log_day ON admin_log (day);

-- The site's switches, changed in /revue without a restart (they were CONTRIBUTIONS_OPEN in
-- the API's environment, rewritten by every deploy): contributions open, sign-ups open.
-- The day of the last change, never a time.
CREATE TABLE site_settings (
    key text PRIMARY KEY
        CONSTRAINT site_settings_key CHECK (key IN ('contributions_open', 'signups_open')),
    value boolean NOT NULL,
    changed_on date
);
INSERT INTO site_settings (key, value) VALUES ('contributions_open', true),
                                              ('signups_open', true);

-- The build that left a hidden camera out (db/settle.sh, from the build's
-- hidden-applied.txt); NULL: still on the served map, until the next build is deployed.
ALTER TABLE hidden_cameras ADD COLUMN applied_build text;

-- The API's role: an administrator changes a role and disables an account (its password,
-- OSM link and deletion were granted by 014 and 015), hides and shows cameras, writes the
-- journal (never changes nor deletes a line) and the settings. Nothing else.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT UPDATE (role, disabled) ON accounts TO preview_api;
        REVOKE ALL ON hidden_cameras FROM preview_api;
        GRANT SELECT, INSERT, DELETE ON hidden_cameras TO preview_api;
        REVOKE ALL ON admin_log FROM preview_api;
        GRANT SELECT, INSERT ON admin_log TO preview_api;
        GRANT USAGE ON SEQUENCE admin_log_seq_seq TO preview_api;
        REVOKE ALL ON site_settings FROM preview_api;
        GRANT SELECT ON site_settings TO preview_api;
        GRANT UPDATE (value, changed_on) ON site_settings TO preview_api;
    END IF;
END $$;
