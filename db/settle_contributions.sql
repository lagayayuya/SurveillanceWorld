-- db/settle.sh: the build's contribution outcome (psql variable `doc`) into contributions.
-- An add (phase "Ajouter") keeps the OSM cameras of a duplicate conflict (near) or those
-- it was told apart from (accepted): the export carries them, so a kept add stays kept.
SET client_min_messages = warning;
CREATE TEMP TABLE outcome_doc ON COMMIT DROP AS SELECT :'doc'::jsonb AS doc;

-- The outcome must be the loaded build's.
DO $$
DECLARE got text := (SELECT doc ->> 'build_id' FROM outcome_doc);
DECLARE loaded text := (SELECT build_id FROM meta);
BEGIN
    IF got IS DISTINCT FROM loaded THEN
        RAISE EXCEPTION 'contribution outcome of build %, the database holds %', got, loaded;
    END IF;
END $$;

CREATE TEMP TABLE outcome ON COMMIT DROP AS
SELECT x.uuid, x.result, jsonb_strip_nulls(jsonb_build_object(
           'result', x.result, 'reason', x.reason, 'osm_version', x.osm_version, 'now', x.now,
           'moved_m', x.moved_m, 'near', x.near, 'accepted', x.accepted
       )) AS detail
FROM outcome_doc,
     jsonb_to_recordset(doc -> 'contributions')
         AS x(uuid uuid, result text, reason text, osm_version integer, now jsonb,
              moved_m numeric, near jsonb, accepted jsonb);

-- Decided again since the export (rejected, back to pending): not touched.
SELECT 'left alone (decided again since the export): ' || count(*)
FROM outcome o JOIN contributions c USING (uuid)
WHERE c.status NOT IN ('validated', 'applied', 'superseded')
HAVING count(*) > 0;

-- The build where the current status was set: kept while the status does not change.
WITH changed AS (
    UPDATE contributions c
    SET status = o.result,
        apply_build = CASE WHEN c.status = o.result THEN c.apply_build
                           ELSE (SELECT build_id FROM meta) END,
        apply_detail = o.detail
    FROM outcome o
    WHERE c.uuid = o.uuid
      AND c.status IN ('validated', 'applied', 'superseded')
      AND (c.status IS DISTINCT FROM o.result OR c.apply_detail IS DISTINCT FROM o.detail)
    RETURNING c.status
)
SELECT 'settled ' || status || ': ' || count(*) FROM changed GROUP BY status ORDER BY status;
