-- Manual validation (rules/participation.yaml `validation: review`): a contribution is
-- pending until the review account validates or rejects it, and the decision keeps who
-- took it and on which day (never a time). Other contributors' opinions on a proposal
-- ("Je confirme" / "Ce n'est pas ça") are contributions of kind agree / disagree pointing
-- at it; they are counted, they validate nothing in review mode.

-- Validation is manual now: the automatic "confirmed" goes back to pending.
UPDATE contributions SET status = 'pending' WHERE status = 'confirmed';

-- 001's checks on status, kind and answer were named by PostgreSQL: find them and replace
-- them by named ones (the uuid and duration checks stay).
DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'contributions'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ '(status|kind|answer)'
    LOOP
        EXECUTE format('ALTER TABLE contributions DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE contributions
    ADD COLUMN target uuid REFERENCES contributions (uuid),
    ADD COLUMN decided_by text,
    ADD COLUMN decided_on date,
    ADD CONSTRAINT contributions_status CHECK (status IN ('pending', 'validated', 'rejected')),
    ADD CONSTRAINT contributions_kind CHECK (kind IN ('verify', 'move', 'agree', 'disagree')),
    ADD CONSTRAINT contributions_answer CHECK (answer IN ('present', 'not_found', 'unsure')),
    ADD CONSTRAINT contributions_answer_for_verify CHECK ((kind = 'verify') = (answer IS NOT NULL)),
    ADD CONSTRAINT contributions_target_for_opinion
        CHECK ((kind IN ('agree', 'disagree')) = (target IS NOT NULL)),
    ADD CONSTRAINT contributions_decision CHECK ((decided_by IS NULL) = (decided_on IS NULL));
CREATE INDEX contributions_target ON contributions (target);

-- Once written, the API changes only the decision: status, who, which day.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        REVOKE UPDATE ON contributions FROM preview_api;
        GRANT UPDATE (status, decided_by, decided_on) ON contributions TO preview_api;
    END IF;
END $$;
