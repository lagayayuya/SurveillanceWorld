-- Phase "Retours terrain": /revue lists one row per camera with its commune (or municipal
-- arrondissement), written by `lacarte db load` from the IGN units (admin.places). Empty
-- until the next load; an add no build has applied takes its nearest camera's.
ALTER TABLE cameras ADD COLUMN commune text;
