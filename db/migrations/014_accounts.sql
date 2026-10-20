-- Accounts (lot « comptes », its contract): a person signs in with a
-- pseudonym and a password; the session cookie, not Caddy's basic-auth user, says who
-- writes. Nothing here holds a time of day, an IP or an address: an account keeps its
-- pseudonym, the argon2id hash of its password (NULL: a placeholder, which cannot sign
-- in), its role, the month it was created, and three flags (disabled, shown in the
-- leaderboard, test); a session keeps the SHA-256 of its token and the day it expires.
--
-- Existing contributions name their author (and the review's decider) as text, the
-- basic-auth user of the preview. Every such name becomes a placeholder account (no
-- password, contributor, test when it is in test_authors, created this month): the rows
-- point at it (author_id, decided_by_id), the text columns go, and the name is stored once.
-- `lacarte accounts create <name>` on a placeholder claims it (sets its password, role and
-- flags). A deleted account leaves its contributions without author (ON DELETE SET NULL).
-- The migration stops (RAISE) when a name does not fit the new pseudonym rule, when two
-- names differ only by case (the pseudonym is unique without case: merging them would merge
-- two people), or when a row would lose its author.

CREATE TABLE accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- v4: random, no time inside
    pseudonym text NOT NULL CONSTRAINT accounts_pseudonym
        CHECK (pseudonym ~ '^[A-Za-z0-9._-]{2,32}$'),
    password_hash text,                             -- argon2id PHC string; NULL: placeholder
    role text NOT NULL DEFAULT 'contributor'
        CONSTRAINT accounts_role CHECK (role IN ('contributor', 'reviewer')),
    created_month date NOT NULL
        CONSTRAINT accounts_created_month CHECK (extract(day FROM created_month) = 1),
    disabled boolean NOT NULL DEFAULT false,
    leaderboard boolean NOT NULL DEFAULT false,     -- the person's choice, off by default
    test boolean NOT NULL DEFAULT false             -- TEST_AUTHORS, set by db/test_authors.sh
);
CREATE UNIQUE INDEX accounts_pseudonym_key ON accounts (lower(pseudonym));

CREATE TABLE sessions (
    token_sha256 bytea PRIMARY KEY CHECK (length(token_sha256) = 32),
    account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
    expires_on date NOT NULL                        -- a day, never a time
);
CREATE INDEX sessions_account ON sessions (account_id);

ALTER TABLE contributions
    ADD COLUMN author_id uuid REFERENCES accounts ON DELETE SET NULL,
    ADD COLUMN decided_by_id uuid REFERENCES accounts ON DELETE SET NULL;

-- The names, checked before anything is written.
DO $$
DECLARE bad text;
BEGIN
    SELECT string_agg(DISTINCT n COLLATE "C", ', ' ORDER BY n COLLATE "C") INTO bad
    FROM (SELECT author AS n FROM contributions UNION SELECT decided_by FROM contributions) x
    WHERE n IS NOT NULL AND n !~ '^[A-Za-z0-9._-]{2,32}$';
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'names that are not pseudonyms (2 to 32 of A-Z a-z 0-9 . _ -): %', bad;
    END IF;
    SELECT string_agg(names, '; ') INTO bad FROM (
        SELECT string_agg(DISTINCT n COLLATE "C", ', ' ORDER BY n COLLATE "C") AS names
        FROM (SELECT author AS n FROM contributions UNION SELECT decided_by FROM contributions) x
        WHERE n IS NOT NULL GROUP BY lower(n) HAVING count(DISTINCT n) > 1) d;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'names that differ only by case (one pseudonym each): %', bad;
    END IF;
END $$;

INSERT INTO accounts (pseudonym, created_month, test)
SELECT n, date_trunc('month', current_date)::date,
       EXISTS (SELECT FROM test_authors t WHERE t.author = n)
FROM (SELECT author AS n FROM contributions UNION SELECT decided_by FROM contributions) x
WHERE n IS NOT NULL
ORDER BY n;

-- The guard (migrations 005, 008, 011) on the new columns. A withdrawal names the
-- contribution's own author; a deleted account's rows lose their names (ON DELETE SET
-- NULL), which is neither a change of a withdrawn row nor a new decision; filling the new
-- columns from the names (below) is not a decision either.
CREATE OR REPLACE FUNCTION contributions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner boolean := pg_has_role(current_user,
                                 (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER');
    -- Only names went away (an account deleted): nothing was decided.
    forgotten boolean := NEW.status IS NOT DISTINCT FROM OLD.status
        AND NEW.decided_on IS NOT DISTINCT FROM OLD.decided_on
        AND (NEW.decided_by_id IS NULL OR NEW.decided_by_id IS NOT DISTINCT FROM OLD.decided_by_id)
        AND (NEW.author_id IS NULL OR NEW.author_id IS NOT DISTINCT FROM OLD.author_id);
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('applied', 'superseded', 'conflict') AND NOT owner THEN
        RAISE EXCEPTION 'status % is written by the deploy only', NEW.status
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'withdrawn' AND NOT owner AND NOT forgotten
       AND (NEW.status, NEW.decided_by_id, NEW.decided_on)
           IS DISTINCT FROM (OLD.status, OLD.decided_by_id, OLD.decided_on) THEN
        RAISE EXCEPTION 'a withdrawn contribution does not change'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'withdrawn' AND OLD.status IS DISTINCT FROM 'withdrawn' THEN
        IF OLD.status <> 'pending' THEN
            RAISE EXCEPTION 'only a pending contribution is withdrawn'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.decided_by_id IS NULL OR NEW.decided_by_id IS DISTINCT FROM OLD.author_id
           OR NEW.decided_on IS NULL THEN
            RAISE EXCEPTION 'a contribution is withdrawn by its author only'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    -- A decision is numbered when its status or day changes, or when another reviewer
    -- takes it again; not when the deploy (owner) sets validated back on an applied or
    -- superseded row (011), nor when a name is filled in or forgotten.
    IF NEW.status IN ('validated', 'rejected') AND NEW.decided_on IS NOT NULL
       AND NOT (owner AND NEW.status = 'validated'
                AND OLD.status IN ('applied', 'superseded')
                AND NEW.decided_on IS NOT DISTINCT FROM OLD.decided_on
                AND NEW.decided_by_id IS NOT DISTINCT FROM OLD.decided_by_id)
       AND (NEW.status IS DISTINCT FROM OLD.status
            OR NEW.decided_on IS DISTINCT FROM OLD.decided_on
            OR (NEW.decided_by_id IS DISTINCT FROM OLD.decided_by_id
                AND NEW.decided_by_id IS NOT NULL AND OLD.decided_by_id IS NOT NULL)) THEN
        NEW.decision_seq := (SELECT coalesce(max(decision_seq), 0) + 1 FROM contributions
                             WHERE camera_id = NEW.camera_id);
    END IF;
    RETURN NEW;
END $$;

UPDATE contributions c SET author_id = a.id FROM accounts a WHERE a.pseudonym = c.author;
UPDATE contributions c SET decided_by_id = a.id FROM accounts a WHERE a.pseudonym = c.decided_by;

DO $$
DECLARE lost bigint;
BEGIN
    SELECT count(*) INTO lost FROM contributions
    WHERE (author IS NOT NULL AND author_id IS NULL)
       OR (decided_by IS NOT NULL AND decided_by_id IS NULL);
    IF lost > 0 THEN
        RAISE EXCEPTION '% contribution(s) would lose their author or decider', lost;
    END IF;
END $$;

-- 004's contributions_decision and 001's index go with the columns.
ALTER TABLE contributions
    DROP COLUMN author,
    DROP COLUMN decided_by,
    -- A decision keeps its day; its decider may have been deleted since.
    ADD CONSTRAINT contributions_decided_by CHECK (decided_by_id IS NULL OR decided_on IS NOT NULL);
CREATE INDEX contributions_author ON contributions (author_id);

-- Every new contribution has an author (the API's session); a deleted account's rows keep
-- theirs NULL. As 006 does for the tags: a CHECK would be checked again on every update.
CREATE FUNCTION contributions_author_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.author_id IS NULL THEN
        RAISE EXCEPTION 'a contribution has an author' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER contributions_author_required BEFORE INSERT ON contributions
    FOR EACH ROW EXECUTE FUNCTION contributions_author_required();

-- accounts.test replaces it (db/test_authors.sh sets the flag from TEST_AUTHORS).
DROP TABLE test_authors;

-- The API's role: what it needs and nothing more. It reads the accounts (the login checks
-- the hash), changes a password and the leaderboard flag, deletes an account (the person's
-- own: the API checks whose), and keeps sessions; it never creates an account nor changes
-- a role, a pseudonym or a flag the CLI sets. On contributions, the decider's column
-- replaces the name's in its column grant (004).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        REVOKE ALL ON accounts, sessions FROM preview_api;
        GRANT SELECT, DELETE ON accounts TO preview_api;
        GRANT UPDATE (password_hash, leaderboard) ON accounts TO preview_api;
        GRANT SELECT, INSERT, DELETE ON sessions TO preview_api;
        GRANT UPDATE (decided_by_id) ON contributions TO preview_api;
    END IF;
END $$;
