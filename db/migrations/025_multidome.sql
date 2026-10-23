-- The multi-dome (DECISIONS 2026-10-23; rules/questions.yaml shape and dome_count): several
-- dome cameras around one housing, one object. « À quoi ressemble-t-elle ? » gains the
-- answer `multidome` (« Multi-boules »), and with it the number of domes, or « Je ne sais
-- pas » (no number: dome_count NULL). The bounds are rules/questions.yaml dome_count's
-- (2 to 6), checked by the API first; the build reads the number (export_contributions.sql)
-- and the publication writes it as camera:count, only when it is there.
--
-- Nothing stored changes: no answer was `multidome` before, and dome_count is NULL on every
-- existing row. The API's role inserts the column through its table grant (002).

ALTER TABLE contributions
    DROP CONSTRAINT contributions_answer;

ALTER TABLE contributions
    ADD COLUMN dome_count smallint,
    -- 017's, with `multidome` among the shapes. A CHECK passes on NULL: every branch says
    -- whether the answer is there.
    ADD CONSTRAINT contributions_answer CHECK (CASE kind
        WHEN 'verify' THEN answer IS NOT NULL AND answer IN ('present', 'not_found', 'unsure')
        WHEN 'shape' THEN answer IS NOT NULL
            AND answer IN ('dome', 'bullet', 'ptz', 'multi', 'multidome', 'unknown')
        WHEN 'direction' THEN (answer IS NULL AND direction_deg IS NOT NULL)
            OR (answer IS NOT NULL AND answer = 'not_visible' AND direction_deg IS NULL)
        WHEN 'operator' THEN answer IS NOT NULL
            AND answer IN ('public', 'business', 'household', 'unknown')
        WHEN 'height' THEN answer IS NOT NULL
            AND answer IN ('ground', 'first', 'upper', 'unknown')
        WHEN 'tilt' THEN answer IS NOT NULL
            AND answer IN ('horizon', 'slight', 'steep', 'unknown')
        ELSE answer IS NULL END),
    -- A number of domes only with a multi-dome's shape answer, within the rule's bounds.
    ADD CONSTRAINT contributions_dome_count CHECK (
        dome_count IS NULL
        OR (kind = 'shape' AND answer = 'multidome' AND dome_count BETWEEN 2 AND 6));
