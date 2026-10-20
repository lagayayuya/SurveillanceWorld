-- Sign in with OpenStreetMap (OSM lot 1, its contract): an account may
-- hold the numeric id of an OSM user (the id_token's `sub`) with the server it is on
-- (`dev`, OSM's test server, or `live`: their users are numbered apart, the same number is
-- two people), unique per server, never the OSM name. An OSM sign-up creates an account with that id and no password.
--
-- What a placeholder is changes: since 014 it was « no password » (a name the
-- contributions held, which cannot sign in until `lacarte accounts create` claims it); it
-- is now « no password AND no osm_id ». An account with osm_id and no password is an OSM
-- account: it signs in through OSM, has a session, may appear in the leaderboard. Every
-- check that meant « not a placeholder » follows (lacarte.api.auth.CLAIMED). The existing
-- rows have no osm_id: every one of them keeps what it was.

ALTER TABLE accounts
    ADD COLUMN osm_id bigint CONSTRAINT accounts_osm_id CHECK (osm_id > 0),
    ADD COLUMN osm_server text CONSTRAINT accounts_osm_server CHECK (osm_server IN ('dev', 'live')),
    ADD CONSTRAINT accounts_osm_pair CHECK ((osm_id IS NULL) = (osm_server IS NULL)),
    ADD CONSTRAINT accounts_osm_id_key UNIQUE (osm_server, osm_id);

-- The API's role: it links and unlinks an account (osm_id), and an OSM sign-up creates
-- one with its pseudonym, month and osm_id only (role, password, flags keep their
-- defaults: a contributor, no password, not disabled, not shown, not a test account).
-- Nothing else new.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT UPDATE (osm_id, osm_server) ON accounts TO preview_api;
        GRANT INSERT (pseudonym, created_month, osm_id, osm_server) ON accounts TO preview_api;
    END IF;
END $$;
