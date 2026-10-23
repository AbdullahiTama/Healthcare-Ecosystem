// How long the company keeps positions captured on field reports, in months. null = the company has not
// decided, and the notice says only that the company decides: nothing is promised that is not enforced.
// This is a product and legal decision (docs/privacy/field-activity-location.md); set it only together with
// the scheduled purge it describes (docs/architecture/pending-migrations/carehub_20261025_purge_old_report_coordinates.sql).
export const LOCATION_RETENTION_MONTHS = null
