# Pending migrations: NOT applied, need rework before they may be

These two target tables that do not exist live (`staff_checkins`) or change who can read live data (`field_activities` and friends), and were written against the repo's old pilot policies, not the live ones. A pre-flight against production on 2026-10-19 showed differences that would make them wrong or harmful as written:

- `public.is_business_manager(uuid)` is **not executable by `authenticated`** (ACL `{postgres, service_role}`), so any RLS policy that calls it directly raises "permission denied" for signed-in users. `carehub_20261125_field_activity_access` does exactly that and would have broken every activity read. Manager checks must go through a SECURITY DEFINER wrapper with the right grants.
- Live `staff` and `field_activities` have triggers and helper functions from the c21 work that the new migrations must coexist with.
- After creating any function, Supabase re-grants EXECUTE to `anon`/`authenticated`; the ACL must be re-read and fixed (see the project notes on this trap).

They move back into `supabase/migrations/` only once reworked, tested (PGlite and a Supabase branch) and approved.
