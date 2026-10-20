-- What is kept and for how long, applied every Paris day by the API itself (the « go » of
-- 17/10): until now db/retention.sql, run by each
-- deploy as the owner, was the only cleaner, so a quiet month kept everything a month
-- longer. The durations are rules/stats.yaml's (tests/test_retention.py checks this file
-- says the same):
-- - the journal (admin_log, 020): 12 months (journal_retention_months; the CNIL's
--   recommendation n° 2021-122 on logging, 6 months to a year), older lines deleted;
-- - the hourly counters (021): the current Paris day and the 7 before
--   (hour_retention_days), older hours added to their Paris day, then deleted;
-- - the daily counters (021): the 13 whole months before the current one
--   (retention_months), older days added to their month's total, then deleted.
--
-- lacarte_retention_at(today): the work, for a given Paris day (the tests' clock); only the
-- owner runs it. lacarte_retention(): today in Paris, run with the owner's rights (SECURITY
-- DEFINER) so that the API's role, which may neither delete a journal line nor fold a
-- counter, can still have it done — exactly this and nothing else. Each runs in its
-- caller's transaction, under a transaction-level advisory lock (two runs, the deploy's
-- and the API's, wait for each other): run twice, the second finds nothing. Returns what
-- it did, as counts.
--
-- search_path: pg_catalog then pg_temp, the tables named with their schema (« Writing
-- SECURITY DEFINER Functions Safely », CREATE FUNCTION, PostgreSQL docs: exclude any
-- schema others may write to, pg_temp last). EXECUTE is granted to PUBLIC by default on a
-- new function (same page): revoked here, in the migration's one transaction
-- (db/migrate.sh runs each file with psql -1), so there is no moment it is open to all.
CREATE FUNCTION lacarte_retention_at(today date, OUT journal integer, OUT hours integer,
                                     OUT days integer)
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    -- The same key as lacarte.api.retention.LOCK (the API's thread tries it first).
    PERFORM pg_advisory_xact_lock(7810176774488287598);
    DELETE FROM public.admin_log WHERE day < today - interval '12 months';
    GET DIAGNOSTICS journal = ROW_COUNT;
    -- A data-modifying WITH runs to completion whatever the main query reads (« WITH
    -- Queries », §7.8.4): every hour deleted is added to its day, in one statement.
    WITH gone AS (
        DELETE FROM public.site_counters_hour
        WHERE (at AT TIME ZONE 'Europe/Paris')::date < today - interval '7 days'
        RETURNING at, counter, n
    ), folded AS (
        INSERT INTO public.site_counters AS d (day, counter, n)
        SELECT (at AT TIME ZONE 'Europe/Paris')::date, counter, sum(n)::integer
        FROM gone GROUP BY 1, 2
        ON CONFLICT (day, counter) DO UPDATE SET n = d.n + EXCLUDED.n
    )
    SELECT count(*) INTO hours FROM gone;
    -- A VOLATILE function (the default) takes a fresh snapshot for each query (« Function
    -- Volatility Categories »): this one sees the days just folded. Never that old in
    -- practice; hours restored from an old dump would go on into their month here.
    WITH gone AS (
        DELETE FROM public.site_counters
        WHERE day < date_trunc('month', today::timestamp) - interval '13 months'
        RETURNING day, counter, n
    ), folded AS (
        INSERT INTO public.site_counters_month AS m (month, counter, n)
        SELECT date_trunc('month', day::timestamp)::date, counter, sum(n)
        FROM gone GROUP BY 1, 2
        ON CONFLICT (month, counter) DO UPDATE SET n = m.n + EXCLUDED.n
    )
    SELECT count(*) INTO days FROM gone;
END
$$;

-- Today in Paris: timestamptz AT TIME ZONE zone is the wall-clock time there (« Date/Time
-- Functions », AT TIME ZONE), whatever the session's TimeZone.
CREATE FUNCTION lacarte_retention(OUT journal integer, OUT hours integer, OUT days integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT * FROM public.lacarte_retention_at((now() AT TIME ZONE 'Europe/Paris')::date)
$$;

REVOKE ALL ON FUNCTION lacarte_retention_at(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION lacarte_retention() FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT EXECUTE ON FUNCTION lacarte_retention() TO preview_api;
    END IF;
END $$;
