-- A camera's history on its public sheet (lot U, 2026-10-18): the contributions the review
-- accepted, each with its kind of change and its month, said « par un contributeur ». The
-- pseudonym is shown instead only when its author chose it: « Afficher mon pseudonyme sur
-- les caméras que j'ai relevées » in the account's screen, off by default, reversible at
-- any time. The API reads the flag when it answers (GET /api/history?camera=<id>), so a
-- change takes effect at once, for every camera the person surveyed. A deleted account
-- leaves its contributions without author (014: ON DELETE SET NULL): anonymous.
ALTER TABLE accounts ADD COLUMN history_pseudonym boolean NOT NULL DEFAULT false;

-- The API's role sets it for the signed-in person (PUT /api/me/history-pseudonym), as it
-- sets `leaderboard` (014); nothing else on accounts changes.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        GRANT UPDATE (history_pseudonym) ON accounts TO preview_api;
    END IF;
END $$;
