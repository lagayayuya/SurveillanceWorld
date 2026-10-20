-- /revue « Statistiques » (lot 4 and its « go » of 17/10):
-- three counters of the site, and the gesture's duration no longer kept.
--
-- The counters: a time, a name, a number; nothing else — no address, no identifier, no
-- cookie, no User-Agent, nothing read on the device. `map`: the map loaded once visible;
-- `welcome`: the welcome panel shown (both POST /api/hit, the page's); `signin`: a session
-- opened (a password, the return from OpenStreetMap, /revue's entry), counted by the API
-- when it opens one, never on a failure. Up to rules/stats.yaml hourly_cap an hour and a
-- counter; a declared robot's User-Agent adds nothing (read, never kept).
--
-- Three grains, each kept as long as rules/stats.yaml says (lacarte_retention(), migration
-- 023, folds and deletes; the API runs it every Paris day):
-- - site_counters_hour: the start of an hour (stored in UTC; Paris hours start on UTC
--   hours, its offsets being whole hours), kept the current Paris day and the 7 before
--   (hour_retention_days), then added to its Paris day;
-- - site_counters: a Paris day, kept the 13 whole months before the current one
--   (retention_months), then added to its month;
-- - site_counters_month: monthly totals, kept without limit (nothing personal: only the
--   trend serves).
-- Not deployed before this version (the dump of 16/10 is at 020): written anew, not
-- amended.
CREATE TABLE site_counters_hour (
    -- On the hour, whatever the session's TimeZone: date_trunc's third argument names the
    -- zone the truncation is made in (PostgreSQL 12+, « Date/Time Functions », §9.9.2).
    at timestamptz NOT NULL
        CONSTRAINT site_counters_hour_at CHECK (date_trunc('hour', at, 'UTC') = at),
    counter text NOT NULL
        CONSTRAINT site_counters_hour_counter CHECK (counter IN ('map', 'welcome', 'signin')),
    n integer NOT NULL CONSTRAINT site_counters_hour_n CHECK (n >= 0),
    PRIMARY KEY (at, counter)
);
CREATE TABLE site_counters (
    day date NOT NULL,                              -- a Paris day, never a time
    counter text NOT NULL
        CONSTRAINT site_counters_counter CHECK (counter IN ('map', 'welcome', 'signin')),
    n integer NOT NULL CONSTRAINT site_counters_n CHECK (n >= 0),
    PRIMARY KEY (day, counter)
);
CREATE TABLE site_counters_month (
    month date NOT NULL CONSTRAINT site_counters_month_month CHECK (extract(day FROM month) = 1),
    counter text NOT NULL
        CONSTRAINT site_counters_month_counter CHECK (counter IN ('map', 'welcome', 'signin')),
    n bigint NOT NULL CONSTRAINT site_counters_month_n CHECK (n >= 0),
    PRIMARY KEY (month, counter)
);

-- The time a contribution's gesture took is no longer collected (plan-revue Q5): nothing
-- reads it any more, and the phone stops sending it (an older phone's queue still may: the
-- API accepts it and keeps nothing). Dropped, not emptied: a dump made before this
-- migration restores (db/restore.sh loads its rows at its own version, then migrates).
ALTER TABLE contributions DROP COLUMN duration_ms;

-- The API's role adds to an hour's counter and reads the three tables; folding and
-- deleting are lacarte_retention()'s (023), which runs as the tables' owner. Nothing else.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        REVOKE ALL ON site_counters_hour FROM preview_api;
        GRANT SELECT, INSERT ON site_counters_hour TO preview_api;
        GRANT UPDATE (n) ON site_counters_hour TO preview_api;
        REVOKE ALL ON site_counters FROM preview_api;
        GRANT SELECT ON site_counters TO preview_api;
        REVOKE ALL ON site_counters_month FROM preview_api;
        GRANT SELECT ON site_counters_month TO preview_api;
    END IF;
END $$;
