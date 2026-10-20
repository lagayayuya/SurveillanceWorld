-- Participation prototype (phase D1): the served build's cameras and prepared buildings
-- (replaced by `lacarte db load` at each build), and the contributions (kept).
-- Coordinates in the regions' metric CRS (EPSG:2154, regions.yaml).
-- No column holds a time of day, an IP or a contributor position (DECISIONS.md 2026-09-29).

CREATE EXTENSION IF NOT EXISTS postgis;

-- The build the tables were loaded from; one row.
CREATE TABLE meta (
    one boolean PRIMARY KEY DEFAULT true CHECK (one),
    build_id text NOT NULL,
    region text NOT NULL,
    bounds geometry(Polygon, 4326) NOT NULL  -- input validation: coordinates inside it
);

-- Buildings prepared exactly as the views stage does (clusters closer than 1 m merged and
-- closed, buildings.prepare), around every camera out to its range plus the largest move.
CREATE TABLE buildings (
    id integer PRIMARY KEY,
    geom geometry(Polygon, 2154) NOT NULL
);
CREATE INDEX buildings_geom ON buildings USING gist (geom);

-- Snapshot of the served build's cameras: what the field computation reads
-- (views._records) and the OSM element the map showed.
CREATE TABLE cameras (
    camera_id text PRIMARY KEY,           -- n123, w456, r789
    osm_type char(1) NOT NULL CHECK (osm_type IN ('n', 'w', 'r')),
    osm_id bigint NOT NULL,
    osm_version integer NOT NULL,
    osm_timestamp timestamptz,
    geom geometry(Point, 2154) NOT NULL,
    indoor boolean NOT NULL,
    kind text NOT NULL,
    kind_certainty text NOT NULL,
    mount_group text NOT NULL,
    directions double precision[] NOT NULL,
    direction_certainty text NOT NULL,
    fov_deg double precision NOT NULL,
    range_m double precision NOT NULL,
    height_m double precision NOT NULL,
    height_certainty text NOT NULL,
    tilt_deg double precision,
    geom_certainty text NOT NULL,
    optics_certainty text NOT NULL
);
CREATE INDEX cameras_geom ON cameras USING gist (geom);

CREATE TABLE contributions (
    uuid uuid PRIMARY KEY CHECK (substr(uuid::text, 15, 1) = '4'),  -- v4: no time inside
    kind text NOT NULL CHECK (kind IN ('verify', 'move')),
    camera_id text NOT NULL,              -- no foreign key: the snapshot is replaced
    osm_type char(1) NOT NULL,
    osm_id bigint NOT NULL,
    osm_version integer NOT NULL,
    osm_timestamp timestamptz,
    build_id text NOT NULL,
    author text NOT NULL,
    day date NOT NULL,                    -- set by the phone at gesture time
    duration_ms integer NOT NULL CHECK (duration_ms >= 0),
    on_site boolean,                      -- null: unknown
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'rejected')),
    answer text CHECK (answer IN ('present', 'not_found', 'unsure')),
    geom geometry(Point, 2154) NOT NULL,  -- verify: the camera; move: its new position
    payload jsonb NOT NULL,
    body_sha256 text NOT NULL,            -- idempotence: same uuid, same body
    CHECK ((kind = 'verify') = (answer IS NOT NULL))
);
CREATE INDEX contributions_camera ON contributions (camera_id);
CREATE INDEX contributions_geom ON contributions USING gist (geom);
CREATE INDEX contributions_author ON contributions (author);
