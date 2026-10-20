-- Phase D3: two "Compléter" questions on one screen, "Hauteur et inclinaison".
--   height     answer: the class of rules/questions.yaml height.classes (ground, first,
--              upper, pole) or unknown ("Je ne sais pas"); never metres
--   tilt       answer: a class of tilt.classes (horizon, slight, steep) or unknown;
--              never degrees
-- Same privacy as the other answers (no new column: the class is the answer), the
-- served OSM tags copied by the API (the 006 trigger refuses a row without them), on_site
-- as for any contribution.
-- A tilt the build cannot apply for want of a height stays `validated` (the deploy writes
-- apply_detail.reason no_height): that settle moves it back from applied or superseded to
-- validated, which is not a review decision, so the guard no longer renumbers
-- decision_seq for that move (it would reorder the camera's same-day answers).

ALTER TABLE contributions
    DROP CONSTRAINT contributions_kind,
    DROP CONSTRAINT contributions_answer;

ALTER TABLE contributions
    ADD CONSTRAINT contributions_kind CHECK (kind IN (
        'verify', 'move', 'agree', 'disagree', 'shape', 'direction', 'operator', 'add',
        'height', 'tilt')),
    -- A CHECK passes on NULL: every branch says whether the answer is there.
    ADD CONSTRAINT contributions_answer CHECK (CASE kind
        WHEN 'verify' THEN answer IS NOT NULL AND answer IN ('present', 'not_found', 'unsure')
        WHEN 'shape' THEN answer IS NOT NULL
            AND answer IN ('dome', 'bullet', 'ptz', 'multi', 'unknown')
        WHEN 'direction' THEN (answer IS NULL AND direction_deg IS NOT NULL)
            OR (answer IS NOT NULL AND answer = 'not_visible' AND direction_deg IS NULL)
        WHEN 'operator' THEN answer IS NOT NULL
            AND answer IN ('public', 'business', 'household', 'unknown')
        WHEN 'height' THEN answer IS NOT NULL
            AND answer IN ('ground', 'first', 'upper', 'pole', 'unknown')
        WHEN 'tilt' THEN answer IS NOT NULL
            AND answer IN ('horizon', 'slight', 'steep', 'unknown')
        ELSE answer IS NULL END);

CREATE OR REPLACE FUNCTION contributions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner boolean := pg_has_role(current_user,
                                 (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER');
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('applied', 'superseded', 'conflict') AND NOT owner THEN
        RAISE EXCEPTION 'status % is written by the deploy only', NEW.status
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'withdrawn' AND NOT owner
       AND (NEW.status, NEW.decided_by, NEW.decided_on)
           IS DISTINCT FROM (OLD.status, OLD.decided_by, OLD.decided_on) THEN
        RAISE EXCEPTION 'a withdrawn contribution does not change'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'withdrawn' AND OLD.status IS DISTINCT FROM 'withdrawn' THEN
        IF OLD.status <> 'pending' THEN
            RAISE EXCEPTION 'only a pending contribution is withdrawn'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.decided_by IS DISTINCT FROM OLD.author OR NEW.decided_on IS NULL THEN
            RAISE EXCEPTION 'a contribution is withdrawn by its author only'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    -- The deploy (owner) setting validated back on an applied or superseded row: not a
    -- decision, its rank stays.
    IF NEW.status IN ('validated', 'rejected') AND NEW.decided_on IS NOT NULL
       AND NOT (owner AND NEW.status = 'validated'
                AND OLD.status IN ('applied', 'superseded')
                AND NEW.decided_on IS NOT DISTINCT FROM OLD.decided_on
                AND NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by)
       AND (NEW.status IS DISTINCT FROM OLD.status
            OR NEW.decided_on IS DISTINCT FROM OLD.decided_on
            OR NEW.decided_by IS DISTINCT FROM OLD.decided_by) THEN
        NEW.decision_seq := (SELECT coalesce(max(decision_seq), 0) + 1 FROM contributions
                             WHERE camera_id = NEW.camera_id);
    END IF;
    RETURN NEW;
END $$;
