# Pending migrations: DRAFTS, NOT APPLIED

Files here are **not** in `supabase/migrations/`, so no pipeline can pick them up. Each needs explicit approval
before it is moved there and applied to production. They were written for the Live Field Activity audit
(`docs/audits/live-field-activity-audit.md`, findings F3, F4, F6, F7 and item U2) and tested on real Postgres
with the PGlite harness (`scripts/db-tests/activity.pglite.mjs`), which shows each problem BEFORE the migration
and its absence AFTER, and re-applies each to prove it can run twice.

What those tests do **not** prove: Supabase itself (PostgREST, Realtime, Storage service behaviour, the live
schema). Re-check each against a Supabase branch, or the live project read-only, before and after applying.

## Files and what each needs

| File | Fixes | Safe to apply alone? | App change needed |
|---|---|---|---|
| `carehub_20261020_default_viewers_own_rows.sql` | F7: any member can rewrite a colleague's default viewers | **Yes** | None (the app already writes only the caller's own rows) |
| `carehub_20261020_activity_server_alerts.sql` | U2: the browser cannot alert colleagues; the database now does | **Yes** | Optional: skip the browser's own (refused) attempt when `alerts: 'server'` |
| `carehub_20261020_log_field_activity.sql` | F4/F6: save the report and its viewers in one transaction | **Yes**, but nothing uses it until the app does | App tries `rpc/log_field_activity`, falls back to the two-request path on PGRST202 |
| `carehub_20261020_activity_voice_private.sql` | F3: voice bucket public and anonymously writable | **NO. Breaks the app until it is changed** | **Required first:** play notes through signed URLs; upload to `<business id>/<activity id>.<ext>` with the session and a parameter-free MIME type |

## Suggested order

1. `default_viewers_own_rows`: independent, no app change.
2. `activity_server_alerts`: independent. After it, tagged colleagues and replied-to reps are alerted by the database.
3. `log_field_activity`: then release the app that calls it (with the fallback), so release order does not matter.
4. Release the app change for voice notes. Check on the live project that a note plays through a signed URL and a new upload lands in the company folder while the bucket is still public.
5. `activity_voice_private`: last, once step 4 is confirmed live.

## How to apply (this project's own rules)

- Apply with `apply_migration` (a tracked migration), not `execute_sql`, so it lands in `supabase_migrations`.
- Name the file with a real date when it moves to `supabase/migrations/`. Do not invent far-future names.
- Each file ends with a verification block that raises if what it set up is not there. A statement completing is
  not evidence it did anything: afterwards re-read the catalog (`pg_policies`, `pg_proc.proacl`, `storage.buckets`)
  and take a `get_advisors` security snapshot before and after.
- After any function is created, check `pg_proc.proacl`: Supabase re-grants EXECUTE to anon and authenticated at
  creation, after any earlier REVOKE.

## Still not covered by a draft

- `manager_checkin_overview` admits only manager-role names (finding F2): a product decision.
- Recording the realtime publication membership in a migration (it exists only as live state today).
