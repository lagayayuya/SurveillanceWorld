-- The synchronisation with OpenStreetMap (owner's decision of 16/10):
-- a person who chose « Publier aussi sur OpenStreetMap en
-- mon nom » sees each of her contributions, accepted by the review and applied by a build,
-- published under her OSM account by the API's background job (lacarte.api.sync), one
-- changeset per person per pass. Additive: nothing is dropped, every existing row stays valid.
--
-- osm_write: a row = the person chose to publish on that server (016).
-- - consent_day: the day she chose it (the callback that kept her token). Only what she
--   observed on or after that day leaves; nothing retroactive. A day, never a time. Rows of
--   before this migration (the manual « À publier » of 016): the migration's day.
-- - token: NULL once OSM refused it (revoked by the person in her OSM settings, or the
--   right to write taken back; a key that no longer opens it keeps it): the row stays so that « Compte » can say it (last_error
--   revoked) until she authorises again or chooses « Rester sur Surveillance World », which
--   deletes the row.
-- - failures, last_error: OSM's refusals in a row and the class of the last one (revoked,
--   blocked by OSM, rate limited, down): a class, never OSM's text. When the next try comes
--   is kept in the API's memory (lacarte.api.sync), not here: a time of day is not stored.
-- - sent_day, sent_n: the changesets opened for her on sent_day (rules/publish.yaml
--   sync.max_changesets_per_day), so that a restart does not reset the day's cap. A day.
ALTER TABLE osm_write
    ADD COLUMN consent_day date NOT NULL DEFAULT current_date,
    ADD COLUMN failures smallint NOT NULL DEFAULT 0
        CONSTRAINT osm_write_failures CHECK (failures >= 0),
    ADD COLUMN last_error text CONSTRAINT osm_write_last_error
        CHECK (last_error IN ('revoked', 'blocked', 'rate_limited', 'osm_down')),
    ADD COLUMN sent_day date,
    ADD COLUMN sent_n smallint NOT NULL DEFAULT 0 CONSTRAINT osm_write_sent_n CHECK (sent_n >= 0),
    ALTER COLUMN token DROP NOT NULL,
    ADD CONSTRAINT osm_write_revoked
        CHECK ((token IS NULL) = (coalesce(last_error, '') = 'revoked'));

-- contributions.sync_chosen: whether, when the API received it, its author had chosen to
-- publish on the server writing is offered on (her token there). Only these leave: what she
-- sent before choosing never does, even on her consent day (a day alone cannot tell the
-- morning from the evening, and no time is kept). Rows of before this migration: false.
ALTER TABLE contributions ADD COLUMN sync_chosen boolean NOT NULL DEFAULT false;

-- What became of a contribution on a server (016), and now: `uncertain`, a `sending` the
-- job could not match to what its changeset holds (never sent again; /revue shows it); and
-- the conflict `osm_duplicate`, an OSM camera within duplicate_m of an add about to be
-- created (nothing created).
ALTER TABLE osm_publications
    DROP CONSTRAINT osm_publications_state,
    ADD CONSTRAINT osm_publications_state
        CHECK (state IN ('sending', 'published', 'conflict', 'uncertain')),
    DROP CONSTRAINT osm_publications_reason,
    ADD CONSTRAINT osm_publications_reason
        CHECK (reason IN ('osm_version', 'osm_tags', 'osm_value', 'osm_deleted', 'osm_duplicate',
                          'osm_way'));

-- Two switches of /revue's « Réglages » (administrator, password again, journalled):
-- osm_sync, the job on (true) or suspended (no call to OSM at all); osm_write_live, writing
-- to OSM's live server instead of its test server (it replaces OSM_WRITE_LIVE_APPROVED;
-- the API refuses it while the live client is not configured). The API's role already
-- updates value and changed_on (020).
ALTER TABLE site_settings
    DROP CONSTRAINT site_settings_key,
    ADD CONSTRAINT site_settings_key CHECK (key IN ('contributions_open', 'signups_open',
                                                    'osm_sync', 'osm_write_live'));
INSERT INTO site_settings (key, value) VALUES ('osm_sync', true), ('osm_write_live', false)
    ON CONFLICT (key) DO NOTHING;
