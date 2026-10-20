-- Lot of 2026-10-12, points 5 and 6 (rules/questions.yaml height and operator).
--
-- Height: three classes in metres, no « Poteau » (it did not say the height). The stored
-- answers keep their keys (ground, first, upper: the same buckets, now ~2 m, ~4 m, 6 m et +);
-- a stored `pole` becomes `first` (~4 m, the author's mapping), and so does a tilt's
-- payload.aim_height `pole` (what the same journey answered, stored for /revue). The frozen
-- classique still sends `pole`: the API stores it as `first` (height.legacy), so the new
-- CHECK, 011's without `pole`, never refuses it. Nothing else holds a height class:
-- cameras.height_m is metres the next build recomputes, osm_publications / osm_write /
-- osm_nodes hold no answer, the build's contribution export is made again at every build.
-- The count of answers changed is printed as a WARNING (migrate.sh shows warnings only).
--
-- Operator: a name the contributor typed (`operator_proposed`, after public or business
-- only, 2-60 characters, validated by the API) is shown nowhere but /revue until a reviewer
-- accepts it, choosing (`operator_choice`): the name as typed (`proposed`), a name of the
-- list (`listed`) or no name (`none`: the class answer stands). The accepted name goes to
-- operator_name, which is all the build, the publication and every other read take; while
-- no choice is made, or once the contribution is rejected, operator_name stays empty. The
-- API's role writes both columns, when the review decides only.

DO $$
DECLARE
    n integer;
    m integer;
BEGIN
    UPDATE contributions SET answer = 'first' WHERE kind = 'height' AND answer = 'pole';
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE contributions SET payload = jsonb_set(payload, '{aim_height}', '"first"')
        WHERE kind = 'tilt' AND payload ->> 'aim_height' = 'pole';
    GET DIAGNOSTICS m = ROW_COUNT;
    RAISE WARNING '017: % height answers pole -> first, % tilt aim_height pole -> first', n, m;
END $$;

ALTER TABLE contributions
    DROP CONSTRAINT contributions_answer;

ALTER TABLE contributions
    ADD COLUMN operator_proposed text,
    ADD COLUMN operator_choice text,
    -- 011's, without `pole`. A CHECK passes on NULL: every branch says whether the answer
    -- is there.
    ADD CONSTRAINT contributions_answer CHECK (CASE kind
        WHEN 'verify' THEN answer IS NOT NULL AND answer IN ('present', 'not_found', 'unsure')
        WHEN 'shape' THEN answer IS NOT NULL
            AND answer IN ('dome', 'bullet', 'ptz', 'multi', 'unknown')
        WHEN 'direction' THEN (answer IS NULL AND direction_deg IS NOT NULL)
            OR (answer IS NOT NULL AND answer = 'not_visible' AND direction_deg IS NULL)
        WHEN 'operator' THEN answer IS NOT NULL
            AND answer IN ('public', 'business', 'household', 'unknown')
        WHEN 'height' THEN answer IS NOT NULL
            AND answer IN ('ground', 'first', 'upper', 'unknown')
        WHEN 'tilt' THEN answer IS NOT NULL
            AND answer IN ('horizon', 'slight', 'steep', 'unknown')
        ELSE answer IS NULL END),
    ADD CONSTRAINT contributions_operator_proposed CHECK (
        operator_proposed IS NULL
        OR (kind = 'operator' AND answer IN ('public', 'business')
            AND char_length(operator_proposed) BETWEEN 2 AND 60)),
    ADD CONSTRAINT contributions_operator_choice CHECK (
        operator_choice IS NULL
        OR (operator_proposed IS NOT NULL
            AND operator_choice IN ('proposed', 'listed', 'none'))),
    -- What a proposed name's operator_name may be: the name itself once accepted as is,
    -- a listed one, nothing otherwise (no choice yet, or no name).
    ADD CONSTRAINT contributions_operator_accepted CHECK (
        operator_proposed IS NULL OR CASE operator_choice
            WHEN 'proposed' THEN operator_name IS NOT NULL AND operator_name = operator_proposed
            WHEN 'listed' THEN operator_name IS NOT NULL
            ELSE operator_name IS NULL END);

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT UPDATE (operator_name, operator_choice) ON contributions TO preview_api;
    END IF;
END $$;
