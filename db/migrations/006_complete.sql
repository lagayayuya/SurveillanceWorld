-- Phase D2, "Compléter" (rules/questions.yaml): three new kinds of contribution, each one
-- answer to one question on a camera.
--   shape      answer dome | bullet | ptz | multi | unknown ("Je ne sais pas")
--   direction  direction_deg 0-359 (bearing from the camera to the target), or answer
--              not_visible ("Je ne vois pas")
--   operator   answer public | business | household | unknown, and optionally
--              operator_name, a name from the list the server offered (public, business)
-- Every new contribution, of any kind, keeps the OSM tags of its camera as the served
-- build had them (osm_tags), copied by the API from the cameras table with the version:
-- the build tells from them whether the tag a D2 answer concerns changed in OSM since.
-- Rows made before this migration have none. Same privacy as D1: no time, no position.

ALTER TABLE contributions
    DROP CONSTRAINT contributions_kind,
    DROP CONSTRAINT contributions_answer,
    DROP CONSTRAINT contributions_answer_for_verify;

ALTER TABLE contributions
    ADD COLUMN direction_deg smallint,
    ADD COLUMN operator_name text,
    ADD COLUMN osm_tags jsonb,
    ADD CONSTRAINT contributions_kind CHECK (kind IN (
        'verify', 'move', 'agree', 'disagree', 'shape', 'direction', 'operator')),
    -- A CHECK passes on NULL: every branch says IS NOT NULL / IS NULL explicitly.
    ADD CONSTRAINT contributions_answer CHECK (CASE kind
        WHEN 'verify' THEN answer IS NOT NULL AND answer IN ('present', 'not_found', 'unsure')
        WHEN 'shape' THEN answer IS NOT NULL
            AND answer IN ('dome', 'bullet', 'ptz', 'multi', 'unknown')
        WHEN 'direction' THEN (answer IS NULL AND direction_deg IS NOT NULL)
            OR (answer IS NOT NULL AND answer = 'not_visible' AND direction_deg IS NULL)
        WHEN 'operator' THEN answer IS NOT NULL
            AND answer IN ('public', 'business', 'household', 'unknown')
        ELSE answer IS NULL END),
    ADD CONSTRAINT contributions_direction CHECK (
        direction_deg IS NULL OR (kind = 'direction' AND direction_deg BETWEEN 0 AND 359)),
    ADD CONSTRAINT contributions_operator_name CHECK (
        operator_name IS NULL
        OR (kind = 'operator' AND answer IN ('public', 'business')
            AND length(operator_name) BETWEEN 1 AND 120)),
    ADD CONSTRAINT contributions_osm_tags CHECK (
        osm_tags IS NULL OR jsonb_typeof(osm_tags) = 'object');

-- New rows must carry the tags. A CHECK cannot say "new rows only" (PostgreSQL checks it
-- again when the review updates an old row's status), so a trigger on insert does.
CREATE FUNCTION contributions_tags_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.osm_tags IS NULL THEN
        RAISE EXCEPTION 'a contribution keeps its camera''s OSM tags'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER contributions_tags_required BEFORE INSERT ON contributions
    FOR EACH ROW EXECUTE FUNCTION contributions_tags_required();

-- The served build's cameras gain what D2 reads: their OSM tags (copied into each
-- contribution), and for the "who films" list their operator class, normalised name and
-- the town's own operator name ("Ville de <commune>", the parent commune for a municipal
-- arrondissement). Filled by the next `lacarte db load`.
ALTER TABLE cameras
    ADD COLUMN tags jsonb,
    ADD COLUMN operator_class text,
    ADD COLUMN operator_norm text,
    ADD COLUMN town_operator text;
