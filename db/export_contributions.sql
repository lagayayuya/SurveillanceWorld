-- The contributions the build applies (`lacarte contrib export`, rules/contributions.yaml):
-- every one the review accepted and has not rejected (validated, applied, superseded),
-- replayed at every build. As JSON lines: first the database's region, then one line per
-- contribution. No author, no day and no time leave the database: the month of
-- observation and the rank within the camera (day of observation, then the review's
-- decision order) are computed here.
-- Phase D2: the "Compléter" answers (shape, direction, operator) that say something ("Je
-- ne sais pas" and "Je ne vois pas" change nothing on the map, not even freshness), and
-- the OSM tags each contribution kept (migration 006), from which the build tells whether
-- the tag an answer concerns changed in OSM since.
-- Phase "Ajouter": the adds (kind add, an added camera `c…` with no OSM element: no
-- version), with `near`, the OSM cameras the add is told apart from (those within
-- duplicate_m at receipt, payload.near, and those the review kept it beside: the deploy's
-- apply_detail near / accepted). A contribution on an added camera leaves only with its add
-- (target): a pending, conflicting or rejected add keeps them all out.
-- Phase "Retours terrain": the test accounts' contributions (TEST_AUTHORS, comma-separated,
-- passed as the psql variable test_authors; none when it is not set) never leave, nor
-- anything said of a test account's add. Since migration 014 a contribution points at its
-- account (author_id): a test account is one flagged test (db/test_authors.sh) or named in
-- TEST_AUTHORS (any case: the export runs before the deploy that sets the flag); a deleted
-- account's contributions (no author) are nobody's test. A database before 014 (the first
-- deploy with accounts exports before it migrates) still names the author: the names.
-- Read only. decision_seq and apply_detail come from migration 005, osm_tags,
-- direction_deg and operator_name from 006: read through to_jsonb, they are null before it (a decision taken before the counter existed ranks
-- first on its day; ties are the build's same_day conflicts).
\if :{?test_authors}
\else
\set test_authors ''
\endif
BEGIN TRANSACTION READ ONLY;
SELECT to_regclass('accounts') IS NOT NULL AS accounts \gset
SELECT json_build_object('region', region) FROM meta;
SELECT json_strip_nulls(json_build_object(
    'uuid', c.uuid,
    'kind', c.kind,
    'answer', c.answer,
    'camera_id', c.camera_id,
    'osm_type', c.osm_type,
    'osm_id', c.osm_id,
    -- The version it is held against: the one the deploy last settled it on (a revalidated
    -- conflict accepts the version the deploy found), else the one it was made on.
    'osm_version', CASE WHEN c.osm_type IS NOT NULL THEN
        coalesce((c.j -> 'apply_detail' ->> 'osm_version')::integer, c.osm_version) END,
    -- A move's final position, exact metres (payload.position is rounded to 1e-7 degree);
    -- for a direction, the position it was aimed from (the served one).
    'x', CASE WHEN c.kind IN ('move', 'direction', 'add') THEN ST_X(c.geom) END,
    'y', CASE WHEN c.kind IN ('move', 'direction', 'add') THEN ST_Y(c.geom) END,
    'placement', CASE WHEN c.kind IN ('move', 'add') THEN c.payload ->> 'placement' END,
    'near', CASE WHEN c.kind = 'add' THEN (
        SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(
            coalesce(c.payload -> 'near', '[]') || coalesce(c.j -> 'apply_detail' -> 'near', '[]')
            || coalesce(c.j -> 'apply_detail' -> 'accepted', '[]')) v
        WHERE v !~ '^c[0-9a-f]{12}$') END,
    'direction', (c.j ->> 'direction_deg')::integer,
    'operator_name', c.j ->> 'operator_name',
    'tags', CASE WHEN c.osm_type IS NOT NULL THEN c.j -> 'osm_tags' END,
    'month', to_char(c.day, 'YYYY-MM'),
    -- "sur place" on the map only when true (rules: on_site): false and unknown say nothing.
    'on_site', CASE WHEN c.on_site THEN true END,
    'rank', dense_rank() OVER (
        PARTITION BY c.camera_id
        ORDER BY c.day, (c.j ->> 'decision_seq')::bigint NULLS FIRST)
))
FROM (SELECT k.*, to_jsonb(k) AS j FROM contributions k) c
WHERE c.status IN ('validated', 'applied', 'superseded')
\if :accounts
  AND NOT EXISTS (SELECT FROM accounts t WHERE t.id = c.author_id AND (t.test
       OR lower(t.pseudonym) = ANY (string_to_array(lower(:'test_authors'), ','))))
\else
  AND c.author <> ALL (string_to_array(:'test_authors', ','))
\endif
  AND (c.osm_type IS NOT NULL OR c.kind = 'add' OR EXISTS (
       SELECT FROM contributions a WHERE a.uuid = c.target AND a.kind = 'add'
       AND a.status IN ('validated', 'applied', 'superseded')
\if :accounts
       AND NOT EXISTS (SELECT FROM accounts t WHERE t.id = a.author_id AND (t.test
            OR lower(t.pseudonym) = ANY (string_to_array(lower(:'test_authors'), ','))))))
\else
       AND a.author <> ALL (string_to_array(:'test_authors', ','))))
\endif
  AND (c.kind IN ('move', 'add')
       OR (c.kind = 'verify' AND c.answer IN ('present', 'not_found'))
       OR (c.kind IN ('shape', 'direction', 'operator', 'height', 'tilt')
           AND c.answer IS DISTINCT FROM 'unknown'
           AND c.answer IS DISTINCT FROM 'not_visible'))
ORDER BY c.camera_id, c.uuid;
COMMIT;
