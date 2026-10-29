-- « Signaler une erreur » in the register (lot R1b): no one reviews the register's documents
-- (DECISIONS 2026-10-28), so a reader's report is how it gets corrected. A reader reports
-- (POST /api/registre/signalement, lacarte.api.registre), a reviewer accepts or refuses it in
-- /revue (« Registre »), and an accepted correction is applied by the next `lacarte-registre
-- construire` (`lacarte-registre corrections exporter` reads it, db/
-- export_registre_corrections.sql).
--
-- A report keeps what it is about and what it says, never who sent it: no address, no user
-- agent, no account (none is required, and a signed-in reader's is not kept either), no
-- time of day — the day it was received only, as everything else the site keeps. Its id is
-- random (no order to read the time from). The contact the reader may leave is the only
-- personal datum, kept only while the report waits:
-- - erased when the report is decided (accepted or refused: the CHECK below refuses a
--   decided report holding one);
-- - erased at the latest 90 days after the day received, decided or not
--   (rules/stats.yaml report_contact_days; lacarte_retention(), below, every Paris day).
-- The report itself (the document, the category, the correction, its source):
-- - accepted: kept as long as the register publishes the document — it is the correction,
--   applied again at every build; deleting it would undo the correction;
-- - refused: deleted 12 months after its decision (report_refused_months, as the journal
--   that records the decision);
-- - pending: kept until decided (its contact goes after 90 days all the same).
-- On acceptance: the field the build changes (regles.py CORRECTED), the value it puts there
-- (JSON: a number, a date, a list of SIREN…) and the reviewer's reason (the correction's
-- rationale); the decision's day and the reviewer (their pseudonym kept as text when their
-- account is deleted, as the journal does).
CREATE TABLE registre_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The document (an evenement of the register) and its affaire (its page,
    -- /registre/contrat/<affaire>): ids as the pilot writes them.
    evenement text NOT NULL
        CONSTRAINT registre_reports_evenement CHECK (evenement ~ '^[A-Za-z0-9._~-]{1,80}$'),
    affaire text NOT NULL
        CONSTRAINT registre_reports_affaire CHECK (affaire ~ '^[A-Za-z0-9._~-]{1,80}$'),
    -- What is wrong, as the reader says it.
    category text NOT NULL CONSTRAINT registre_reports_category CHECK (category IN (
        'montant', 'date', 'entreprise', 'commune', 'nom', 'lien', 'cameras', 'zone', 'autre')),
    correction text NOT NULL
        CONSTRAINT registre_reports_correction CHECK (char_length(correction) BETWEEN 1 AND 1000),
    source text CONSTRAINT registre_reports_source CHECK (
        source IS NULL OR (char_length(source) <= 500 AND source ~ '^https://[^[:space:]]+$')),
    contact text CONSTRAINT registre_reports_contact_length CHECK (
        contact IS NULL OR char_length(contact) BETWEEN 1 AND 200),
    received_on date NOT NULL DEFAULT current_date,  -- a day, never a time
    state text NOT NULL DEFAULT 'pending'
        CONSTRAINT registre_reports_state CHECK (state IN ('pending', 'accepted', 'refused')),
    decided_on date,
    decided_by_id uuid REFERENCES accounts ON DELETE SET NULL,
    decided_by text,
    field text CONSTRAINT registre_reports_field CHECK (field IN (
        'montant', 'date', 'entreprises', 'insee', 'beneficiaire', 'cameras', 'affaire')),
    value jsonb,
    reason text CONSTRAINT registre_reports_reason CHECK (
        reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
    -- Decided: its day and its reviewer; pending: neither.
    CONSTRAINT registre_reports_decision CHECK (
        (state = 'pending') = (decided_on IS NULL) AND (state = 'pending') = (decided_by IS NULL)),
    -- Accepted: the field, the value and the reason; otherwise none of them.
    CONSTRAINT registre_reports_applied CHECK (
        (state = 'accepted') = (field IS NOT NULL)
        AND (state = 'accepted') = (value IS NOT NULL)
        AND (state = 'accepted') = (reason IS NOT NULL)),
    -- A decided report keeps no contact.
    CONSTRAINT registre_reports_contact CHECK (state = 'pending' OR contact IS NULL)
);
CREATE INDEX registre_reports_state_idx ON registre_reports (state, received_on);

-- The journal (020) records the decisions: the document as target, the report's id and the
-- field in the detail, never the reader's text.
ALTER TABLE admin_log DROP CONSTRAINT admin_log_action;
ALTER TABLE admin_log ADD CONSTRAINT admin_log_action CHECK (action IN (
    'decide', 'undo', 'on_site', 'role', 'disable', 'enable', 'cut', 'reset', 'delete',
    'export_account', 'export_csv', 'suspend', 'hide', 'unhide', 'setting', 'signin_refused',
    'registre_accept', 'registre_refuse'));

-- The retention (023) gains the reports: the contacts and the refused reports. Its result
-- gains two counts, so both functions are made again (CREATE OR REPLACE cannot change OUT
-- parameters), with 023's rights: EXECUTE revoked from PUBLIC in this same transaction,
-- lacarte_retention() granted to the API's role.
DROP FUNCTION lacarte_retention();
DROP FUNCTION lacarte_retention_at(date);

CREATE FUNCTION lacarte_retention_at(today date, OUT journal integer, OUT hours integer,
                                     OUT days integer, OUT contacts integer,
                                     OUT reports integer)
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    -- The same key as lacarte.api.retention.LOCK (the API's thread tries it first).
    PERFORM pg_advisory_xact_lock(7810176774488287598);
    DELETE FROM public.admin_log WHERE day < today - interval '12 months';
    GET DIAGNOSTICS journal = ROW_COUNT;
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
    -- A reader's contact: 90 days at most after the day received (a decision erases it at
    -- once, lacarte.api.registre).
    UPDATE public.registre_reports SET contact = NULL
    WHERE contact IS NOT NULL AND received_on < today - interval '90 days';
    GET DIAGNOSTICS contacts = ROW_COUNT;
    -- A refused report: 12 months after its decision.
    DELETE FROM public.registre_reports
    WHERE state = 'refused' AND decided_on < today - interval '12 months';
    GET DIAGNOSTICS reports = ROW_COUNT;
END
$$;

CREATE FUNCTION lacarte_retention(OUT journal integer, OUT hours integer, OUT days integer,
                                  OUT contacts integer, OUT reports integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT * FROM public.lacarte_retention_at((now() AT TIME ZONE 'Europe/Paris')::date)
$$;

REVOKE ALL ON FUNCTION lacarte_retention_at(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION lacarte_retention() FROM PUBLIC;

-- The API's role: it receives a report (INSERT), lists them and decides (SELECT, UPDATE of
-- the decision's columns and of the contact, which a decision erases). It never deletes
-- one nor rewrites what the reader said: the retention does the deleting.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT EXECUTE ON FUNCTION lacarte_retention() TO preview_api;
        REVOKE ALL ON registre_reports FROM preview_api;
        GRANT SELECT, INSERT ON registre_reports TO preview_api;
        GRANT UPDATE (state, decided_on, decided_by_id, decided_by, field, value, reason,
                      contact) ON registre_reports TO preview_api;
    END IF;
END $$;
