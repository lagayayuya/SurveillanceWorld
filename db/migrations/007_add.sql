-- Phase "Ajouter": a camera the map does not have, placed on site (kind `add`).
--   add        the exact position (geom, metres), payload.placement, and what the server
--              computed: inside_footprint, the facade, the field of a default camera, and
--              `near`, the cameras within duplicate_m it knew of at receipt (the
--              contributor saw them and said "Non, c'en est une autre").
-- An added camera has no OSM element: osm_type, osm_id and osm_version are null, osm_tags
-- is {}, and its id is `c` + the first 12 hex digits of the add's uuid (48 random bits of
-- a v4 uuid: the version digit is the 13th), stable from one build to the next, with no
-- time and no author in it; `c` is none of OSM's n, w, r. Every other contribution on an
-- added camera (D2 answers, moves, "Elle est là", opinions) carries the add's uuid in
-- `target` and the same camera_id. Once a build applied it, the camera is in the served
-- snapshot (cameras) under that id, with no OSM element either.

ALTER TABLE contributions
    ALTER COLUMN osm_type DROP NOT NULL,
    ALTER COLUMN osm_id DROP NOT NULL,
    ALTER COLUMN osm_version DROP NOT NULL,
    DROP CONSTRAINT contributions_kind,
    DROP CONSTRAINT contributions_target_for_opinion;

ALTER TABLE contributions
    ADD CONSTRAINT contributions_kind CHECK (kind IN (
        'verify', 'move', 'agree', 'disagree', 'shape', 'direction', 'operator', 'add')),
    -- No OSM element exactly for the added cameras' ids.
    ADD CONSTRAINT contributions_osm_element CHECK (CASE
        WHEN camera_id ~ '^c[0-9a-f]{12}$'
            THEN osm_type IS NULL AND osm_id IS NULL AND osm_version IS NULL
        ELSE osm_type IS NOT NULL AND osm_type IN ('n', 'w', 'r')
            AND osm_id IS NOT NULL AND osm_version IS NOT NULL END),
    ADD CONSTRAINT contributions_add CHECK (kind <> 'add' OR (
        camera_id = 'c' || substr(replace(uuid::text, '-', ''), 1, 12)
        AND osm_tags IS NOT NULL AND osm_tags = '{}'::jsonb)),
    -- An opinion points at a proposal; anything else on an added camera at its add.
    ADD CONSTRAINT contributions_target CHECK (CASE
        WHEN kind IN ('agree', 'disagree') THEN target IS NOT NULL
        WHEN kind = 'add' THEN target IS NULL
        ELSE (target IS NULL) = (osm_type IS NOT NULL) END);

-- Two adds cannot share an id (48 bits: refused, never merged).
CREATE UNIQUE INDEX contributions_add_id ON contributions (camera_id) WHERE kind = 'add';

-- What a CHECK cannot read, another row: a contribution on an added camera points at that
-- camera's add. Joins the 006 trigger on insert (rows already written are not touched).
CREATE FUNCTION contributions_add_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.target IS NOT NULL AND NEW.kind NOT IN ('agree', 'disagree') AND NOT EXISTS (
        SELECT FROM contributions
        WHERE uuid = NEW.target AND kind = 'add' AND camera_id = NEW.camera_id) THEN
        RAISE EXCEPTION 'a contribution on an added camera points at its add'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER contributions_add_target BEFORE INSERT ON contributions
    FOR EACH ROW EXECUTE FUNCTION contributions_add_target();

-- The served snapshot: an added camera a build applied has no OSM element. 001's check on
-- osm_type was named by PostgreSQL.
DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'cameras'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ 'osm_type'
    LOOP
        EXECUTE format('ALTER TABLE cameras DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE cameras
    ALTER COLUMN osm_type DROP NOT NULL,
    ALTER COLUMN osm_id DROP NOT NULL,
    ALTER COLUMN osm_version DROP NOT NULL,
    ADD CONSTRAINT cameras_osm_element CHECK (CASE
        WHEN camera_id ~ '^c[0-9a-f]{12}$'
            THEN osm_type IS NULL AND osm_id IS NULL AND osm_version IS NULL
        ELSE osm_type IS NOT NULL AND osm_type IN ('n', 'w', 'r')
            AND osm_id IS NOT NULL AND osm_version IS NOT NULL END);

-- The camera an add creates before any answer: normalize_row on no tag (every value by
-- default), written by `lacarte db load` — the API cannot normalise (no geopandas).
-- buildings_sha256: the loaded buildings' digest (their uncompressed COPY text). The table
-- now holds every prepared building of the region, wherever a camera may be added; a deploy
-- sends and loads it again only when the digest changed (db/load.sh, deploy/deploy.sh).
ALTER TABLE meta
    ADD COLUMN add_camera jsonb,
    ADD COLUMN buildings_sha256 text;
