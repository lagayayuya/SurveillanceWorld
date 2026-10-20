-- /revue names a camera by its street (lot 1 « Modérer »): the name of the nearest named way
-- (highway with a name, the build's ways.parquet) within rules/participation.yaml
-- review.street_within_m, written by `lacarte db load`; NULL beyond, and until the next
-- load. An add no build has applied takes its nearest camera's, as for the commune (010).
-- The API's role reads it through its table-wide SELECT; nothing more is granted.
ALTER TABLE cameras ADD COLUMN street text;
