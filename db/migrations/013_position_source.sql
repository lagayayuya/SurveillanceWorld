-- A camera under a roof (DECISIONS 2026-10-08, « Placing a camera is always free… »): the
-- batch keeps a position a participant placed (a move, an add) where it is when it lies
-- inside a building's footprint, and that building does not cut its field. The API draws
-- the field at a camera's served position as the batch did, so it needs to know where that
-- position comes from: 'contribution' (moved or added), NULL (OSM), written by
-- `lacarte db load` from cameras_applied. Empty until the next load.
ALTER TABLE cameras ADD COLUMN position_source text;
