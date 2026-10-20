-- « Modifier » (the punk interface, DECISIONS 2026-10-08): one send gathers every piece of
-- a camera's information its author changed — its position and its answers (shape,
-- direction, height, tilt, who films) — each stored as the contribution of its kind, as
-- « Déplacer » and « Compléter » store them (the export and the build's `apply` stage
-- read them unchanged: a validated one wins over the OSM version it saw, a later change of
-- the node makes it a conflict), and sharing `batch`, the send's uuid (v4, chosen by the
-- phone, in the body of each: the same send sent again is a no-op). The review takes one
-- decision per batch and its author withdraws it whole (the API, in one transaction). Never
-- exported: the build needs no batch. Nothing for the API role's grants: it inserts every
-- column (002) and never updates this one.
ALTER TABLE contributions ADD COLUMN batch uuid;

ALTER TABLE contributions
    ADD CONSTRAINT contributions_batch CHECK (
        batch IS NULL OR kind IN ('move', 'shape', 'direction', 'height', 'tilt', 'operator'));

CREATE INDEX contributions_batch_idx ON contributions (batch) WHERE batch IS NOT NULL;
