-- Hidden cameras: a camera's id (an OSM element's, n123 / w456 / r789, or an added
-- camera's, c and 12 hex) and the day it was added to the list; nothing else. Kept by hand
-- on the server (python -m lacarte.api.hidden), read by `lacarte contrib export`, which
-- writes the list the build leaves out from its first stage (regions.hidden): the camera,
-- its field, its streets and the counts lose it at the next build. Never served: the API
-- reads it only to leave those cameras out of the proposals it shows.
CREATE TABLE hidden_cameras (
    camera_id text PRIMARY KEY
        CONSTRAINT hidden_cameras_camera_id
        CHECK (camera_id ~ '^([nwr][1-9][0-9]{0,18}|c[0-9a-f]{12})$'),
    added_on date NOT NULL DEFAULT current_date     -- a day, never a time
);

-- The API's role reads it (the proposals), never writes it; the default privileges would
-- give it SELECT already, said here so that nothing more is ever granted by accident.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
        REVOKE ALL ON hidden_cameras FROM preview_api;
        GRANT SELECT ON hidden_cameras TO preview_api;
    END IF;
END $$;
