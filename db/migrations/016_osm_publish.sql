-- Publish to OpenStreetMap (OSM lot 2, its contract): the person reviews
-- and publishes her own accepted, on-site contributions herself, under her OSM name, on the
-- write server (`dev`, OSM's test server, unless the author approved `live`).
--
-- osm_write: present = the person chose to publish on that server. Her OSM user id there
-- (the id_token's `sub`: users are numbered apart on each server) and her write token,
-- encrypted with AES-256-GCM under OSM_TOKEN_KEY (12-byte random nonce || ciphertext and
-- tag, associated data "<account_id>:<server>": a row copied onto another account or
-- server does not decrypt). OSM's tokens do not expire: going back to « keep on
-- Surveillance.Fun only » revokes it at OSM and deletes the row; so does deleting the
-- account (the API revokes first, the row goes with the account).
CREATE TABLE osm_write (
    account_id uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    server text NOT NULL CONSTRAINT osm_write_server CHECK (server IN ('dev', 'live')),
    osm_uid bigint NOT NULL CONSTRAINT osm_write_osm_uid CHECK (osm_uid > 0),
    token bytea NOT NULL,
    since_month date NOT NULL
        CONSTRAINT osm_write_since_month CHECK (extract(day FROM since_month) = 1)
);

-- What became of a contribution on a server: `sending` from just before the upload (a
-- crash after it must not publish the contribution twice), then `published` (changeset
-- NULL: OSM already had it, nothing was sent) or `conflict` (OSM changed since the
-- observation, or holds another value: the review sees it). A month, never a day.
CREATE TABLE osm_publications (
    uuid uuid REFERENCES contributions (uuid) ON DELETE CASCADE,
    server text CONSTRAINT osm_publications_server CHECK (server IN ('dev', 'live')),
    state text NOT NULL
        CONSTRAINT osm_publications_state CHECK (state IN ('sending', 'published', 'conflict')),
    reason text CONSTRAINT osm_publications_reason
        CHECK (reason IN ('osm_version', 'osm_tags', 'osm_value', 'osm_deleted')),
    changeset bigint CONSTRAINT osm_publications_changeset CHECK (changeset > 0),
    month date NOT NULL CONSTRAINT osm_publications_month CHECK (extract(day FROM month) = 1),
    PRIMARY KEY (uuid, server),
    CONSTRAINT osm_publications_conflict CHECK ((state = 'conflict') = (reason IS NOT NULL))
);

-- The node a camera is on a server, as we last left it (its version after our upload): an
-- added camera's node once created, an OSM camera's once we modified it.
CREATE TABLE osm_nodes (
    server text CONSTRAINT osm_nodes_server CHECK (server IN ('dev', 'live')),
    camera_id text,
    node_id bigint NOT NULL CONSTRAINT osm_nodes_node_id CHECK (node_id > 0),
    version integer NOT NULL CONSTRAINT osm_nodes_version CHECK (version > 0),
    PRIMARY KEY (server, camera_id)
);

-- The API's role: it enables and disables publishing, records what became of each
-- publication, and keeps the nodes (never deleted: a camera's node stays on OSM). Nothing
-- on contributions changes.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON osm_write TO preview_api;
        GRANT SELECT, INSERT, UPDATE, DELETE ON osm_publications TO preview_api;
        GRANT SELECT, INSERT, UPDATE ON osm_nodes TO preview_api;
    END IF;
END $$;
