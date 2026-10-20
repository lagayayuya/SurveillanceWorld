-- Phase "apply" (rules/contributions.yaml): validated contributions enter the build, and
-- the deploy writes back what became of each one.
--   applied     the build applied it (apply_build: the build where it first was)
--   superseded  a later observation of the same camera won
--   conflict    the camera's OSM version changed, the element is gone, or a tie the rank
--               cannot break; the review revalidates (accepting the version the deploy
--               found, apply_detail.osm_version) or rejects
-- These three are written by the deploy role alone (the tables' owner): the trigger below
-- refuses them to any other role, since a column grant cannot restrict values. The API
-- role's grants do not change (UPDATE status, decided_by, decided_on). Rejecting an
-- applied contribution stays allowed: the next build puts the camera back.
-- decision_seq orders the review's decisions without a time: set by the trigger when the
-- review validates or rejects, one more than the camera's highest (decisions of a camera
-- are serialised by the API's advisory lock); the export ranks a camera's contributions
-- by day of observation, then by it.

ALTER TABLE contributions DROP CONSTRAINT contributions_status;
ALTER TABLE contributions
    ADD CONSTRAINT contributions_status CHECK (status IN (
        'pending', 'validated', 'rejected', 'applied', 'superseded', 'conflict')),
    ADD COLUMN decision_seq integer,
    ADD COLUMN apply_build text,
    ADD COLUMN apply_detail jsonb;

CREATE FUNCTION contributions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('applied', 'superseded', 'conflict')
       AND NOT pg_has_role(current_user,
                           (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
        RAISE EXCEPTION 'status % is written by the deploy only', NEW.status
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status IN ('validated', 'rejected') AND NEW.decided_on IS NOT NULL
       AND (NEW.status IS DISTINCT FROM OLD.status
            OR NEW.decided_on IS DISTINCT FROM OLD.decided_on
            OR NEW.decided_by IS DISTINCT FROM OLD.decided_by) THEN
        NEW.decision_seq := (SELECT coalesce(max(decision_seq), 0) + 1 FROM contributions
                             WHERE camera_id = NEW.camera_id);
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER contributions_guard BEFORE UPDATE ON contributions
    FOR EACH ROW EXECUTE FUNCTION contributions_guard();
