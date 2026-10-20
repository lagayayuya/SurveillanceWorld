-- db/settle.sh: the hidden cameras the loaded build left out (psql variable `ids`, the
-- build's hidden-applied.txt, one camera id a line) are gone from the served map with it:
-- hidden_cameras.applied_build (migration 020) = the loaded build, for those still NULL.
-- A camera hidden after that build was made stays NULL until a build leaves it out.
SET client_min_messages = warning;
WITH gone AS (
    UPDATE hidden_cameras SET applied_build = (SELECT build_id FROM meta)
    WHERE applied_build IS NULL AND camera_id = ANY(string_to_array(:'ids', E'\n'))
    RETURNING 1
)
SELECT 'hidden cameras gone from the map: ' || count(*) FROM gone HAVING count(*) > 0;
