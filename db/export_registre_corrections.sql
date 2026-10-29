-- The register's accepted corrections (`lacarte-registre corrections exporter`, migration 026):
-- every report a reviewer accepted in /revue « Registre », with the field the build changes,
-- the value it puts there, the reader's source, the reviewer's reason and the day of the
-- decision, in the order they were accepted. Nothing about the reader (the contact is erased
-- at the decision anyway) nor the reviewer leaves the database. Read only; nothing before
-- migration 026 (an export can run before the deploy that migrates).
BEGIN TRANSACTION READ ONLY;
SELECT to_regclass('registre_reports') IS NOT NULL AS reports \gset
\if :reports
SELECT json_build_object(
    'id', id,
    'evenement', evenement,
    'field', field,
    'value', value,
    'source', source,
    'reason', reason,
    'le', decided_on
)
FROM registre_reports
WHERE state = 'accepted'
ORDER BY decided_on, id;
\endif
COMMIT;
