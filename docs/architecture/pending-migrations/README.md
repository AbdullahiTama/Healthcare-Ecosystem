# Pending migrations: DRAFTS, NOT APPLIED

Files here are **not** in `supabase/migrations/`, so no pipeline can pick them up. Each needs explicit approval
before it is moved there and applied to production.

Three of the four drafts written for the Live Field Activity audit
(`docs/audits/live-field-activity-audit.md`) were **applied to production on 2026-10-20** and now live in
`supabase/migrations/`:

| Applied as | Version | Fixes |
|---|---|---|
| `carehub_20261020_default_viewers_own_rows` | 20261020154020 | F7: any member could rewrite a colleague's default viewers |
| `carehub_20261020_activity_server_alerts` | 20261020154138 | U2: the browser cannot alert colleagues; the database now does |
| `carehub_20261020_log_field_activity` | 20261020154254 | F4/F6: save the report and its viewers in one transaction |

Section 17 of the audit records how each was verified.

## Still pending: `carehub_20261020_activity_voice_private.sql`

Fixes F3: the voice bucket is public and anonymously writable (anyone online can read every voice note and upload any file).

**Do not apply it until the app that signs voice links is live.** The deployed app still plays notes from their stored
public URLs and uploads to the bucket root. Once the bucket is private, every existing voice note (6 at last count)
stops playing and every new upload is refused, for as long as that older app is deployed. The new app is written to
work before and after (`2cb9a9e`: signed links, upload to `<business id>/<activity id>-<suffix>.<ext>` with a
parameter-free MIME type), but it is only on branch `feat/live-activity-client-phases`.

Order:
1. Merge and deploy the branch.
2. Check on the live project, while the bucket is still public, that a voice note plays through a signed link and a
   new recording lands in the company folder.
3. Apply `activity_voice_private`, then read back `storage.buckets` and `pg_policies` and re-check playback and upload.

## How to apply (this project's own rules)

- Apply with `apply_migration` (a tracked migration), not `execute_sql`, so it lands in `supabase_migrations`.
- Each file ends with a verification block that raises if what it set up is not there. A statement completing is
  not evidence it did anything: afterwards re-read the catalog (`pg_policies`, `pg_proc.proacl`, `storage.buckets`)
  and take a `get_advisors` security snapshot before and after.
- After any function is created, check `pg_proc.proacl` and that there is exactly one overload: Supabase re-grants
  EXECUTE to anon and authenticated at creation, and `CREATE OR REPLACE` does not drop a differently-signed sibling.
- To verify behaviour without leaving data behind, run an end-to-end check inside a `DO` block that impersonates real
  users with `SET LOCAL ROLE` and `request.jwt.claims`, and ends with `RAISE EXCEPTION` so it rolls back. Re-query
  afterwards to confirm zero residue.

## Still not covered by a draft

- `manager_checkin_overview` admits only manager-role names (finding F2): a product decision.
- Recording the realtime publication membership in a migration (it exists only as live state today).
