# Pending migrations

The four migrations drafted for the Live Field Activity audit
(`docs/audits/live-field-activity-audit.md`) were applied to production on 2026-10-20 and now live in
`supabase/migrations/`. This folder is the place for unapproved drafts: files here are not in
`supabase/migrations/`, so no pipeline can pick them up, and each needs explicit approval before it moves.

## Pending (Live Field Activity hardening, `docs/superpowers/plans/2026-10-23-live-field-activity-hardening.md`)

Apply in this order, each as its own tracked migration, each only with the owner's approval.

| Draft | Records / fixes | Needs the app first? |
|---|---|---|
| `carehub_20261023_realtime_publication.sql` | Which tables push live changes (live-only state until now). Idempotent, removes nothing. | No |
| `carehub_20261023_activity_gps_accuracy.sql` | Adds `field_activities.gps_accuracy_m` and replaces `log_field_activity` (same signature) to store it. Safe before or after the app. | No |
| `carehub_20261024_activity_photos.sql` | Private `activity-photos` bucket (5 MB, images), `field_activities.photo_paths` (max 3), `log_field_activity` replaced again. Refuses to run before the gps_accuracy draft. Safe before or after the app. | No |

## Already applied

| Applied as | Version | Fixes |
|---|---|---|
| `carehub_20261020_default_viewers_own_rows` | 20261020154020 | F7: any member could rewrite a colleague's default viewers |
| `carehub_20261020_activity_server_alerts` | 20261020154138 | U2: the browser cannot alert colleagues; the database now does |
| `carehub_20261020_log_field_activity` | 20261020154254 | F4/F6: save the report and its viewers in one transaction |
| `carehub_20261020_activity_voice_private` | 20261020155843 | F3: voice bucket was public and anonymously writable |

Section 17 of the audit records how each was verified.

**Deploy the app that goes with them.** The voice bucket was made private before the app that signs voice links was
deployed (at the product owner's instruction). Until branch `feat/live-activity-client-phases` is merged and deployed,
the older app cannot play existing voice notes (they are served from public URLs that no longer work) and its new
voice uploads are refused. The new app (`2cb9a9e`) plays notes through signed links and uploads into
`<business id>/<activity id>-<suffix>.<ext>`. Emergency rollback is in the header of the voice migration.

## How to apply (this project's own rules)

- Apply with `apply_migration` (a tracked migration), not `execute_sql`, so it lands in `supabase_migrations`.
- Each file ends with a verification block that raises if what it set up is not there. A statement completing is
  not evidence it did anything: afterwards re-read the catalog (`pg_policies`, `pg_proc.proacl`, `storage.buckets`)
  and take a `get_advisors` security snapshot before and after.
- After any function is created, check `pg_proc.proacl` and that there is exactly one overload: Supabase re-grants
  EXECUTE to anon and authenticated at creation, and `CREATE OR REPLACE` does not drop a differently-signed sibling.
- To verify behaviour without leaving data behind, run an end-to-end check inside a `DO` block that impersonates real
  users with `SET LOCAL ROLE` and `request.jwt.claims`, and ends with `RAISE EXCEPTION` so it rolls back. Re-query
  afterwards to confirm zero residue. (Storage refuses direct DELETEs, so do not include one in such a check.)

## Still not covered by a migration

- `manager_checkin_overview` admits only manager-role names (finding F2): a product decision.
- Recording the realtime publication membership in a migration (it exists only as live state today).
