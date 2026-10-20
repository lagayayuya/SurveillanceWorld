-- Phase "Retours terrain": an author withdraws their own contribution while it is pending
-- (status withdrawn). The row stays, so that the phone's send queue cannot create it
-- again (same uuid and body: no-op), and nothing changes it afterwards: it is neither
-- exported, nor shown on the map, nor counted in /revue (but under its own filter).
-- The database does not know who sends a request (one API role for every author): the API
-- writes the requester in decided_by, and the trigger refuses any other name than the
-- contribution's author. Withdrawing an add withdraws the same author's pending answers
-- on it (the API, in the same transaction). The API role's grants do not change (UPDATE
-- status, decided_by, decided_on).
ALTER TABLE contributions DROP CONSTRAINT contributions_status;
ALTER TABLE contributions
    ADD CONSTRAINT contributions_status CHECK (status IN (
        'pending', 'validated', 'rejected', 'applied', 'superseded', 'conflict', 'withdrawn'));

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
    IF NEW.status IN ('validated', 'rejected') AND NEW.decided_on IS NOT NULL
       AND (NEW.status IS DISTINCT FROM OLD.status
            OR NEW.decided_on IS DISTINCT FROM OLD.decided_on
            OR NEW.decided_by IS DISTINCT FROM OLD.decided_by) THEN
        NEW.decision_seq := (SELECT coalesce(max(decision_seq), 0) + 1 FROM contributions
                             WHERE camera_id = NEW.camera_id);
    END IF;
    RETURN NEW;
END $$;
