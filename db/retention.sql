-- Run by the deploy as the tables' owner, after settle (deploy/deploy.sh); the API runs the
-- same every Paris day (lacarte.api.retention). The work is lacarte_retention()'s
-- (migrations 023 and 026): the journal kept 12 months, the counters' hours 7 days, their
-- days 13 whole months, a register report's contact 90 days at most, a refused report 12
-- months after its decision (rules/stats.yaml). It says what it did, nothing when there was
-- nothing.
SET client_min_messages = warning;
SELECT concat_ws(E'\n',
    CASE WHEN journal > 0 THEN 'journal lines older than 12 months deleted: ' || journal END,
    CASE WHEN hours > 0 THEN 'counter hours older than 7 days folded into Paris days: ' || hours END,
    CASE WHEN days > 0
        THEN 'counter days older than 13 months folded into monthly totals: ' || days END,
    CASE WHEN contacts > 0
        THEN 'report contacts older than 90 days erased: ' || contacts END,
    CASE WHEN reports > 0
        THEN 'reports refused more than 12 months ago deleted: ' || reports END)
FROM lacarte_retention()
WHERE journal + hours + days + contacts + reports > 0;
