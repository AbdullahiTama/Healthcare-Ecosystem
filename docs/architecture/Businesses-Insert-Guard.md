# Businesses INSERT guard

Migration: `supabase/migrations/carehub_20261031_businesses_insert_guard.sql`
Test: `apps/carefind/src/test/payments/businessesInsertGuard.db.test.js` (PGlite, real roles and RLS)
Status: **not applied**. Apply only by following the steps below.

## The vulnerability

Verified read-only on the live project (`szdybxmgmhndoytqanfb`) on 2026-10-11. It was **not** exploit-tested on live.
The test suite reproduces it on a replica (the "(before)" case).

- The policy `own business row` on `public.businesses` is `FOR ALL TO authenticated` with
  `USING / WITH CHECK ((lower(email) = lower((select auth.email()))) OR is_platform_admin())`.
- `authenticated` holds table-level INSERT. That means it can set any column on INSERT, including
  `is_platform_admin`, `status`, `plan`, `plan_expires_at`, `parent_business_id` and `referring_agent_id`.
- The C18 guard `guard_business_privileged_columns` is `BEFORE UPDATE` only. The only INSERT trigger is
  `resolve_referring_agent` (`apply_referring_agent()`), and it only derives the referral columns.
- `public.is_platform_admin()` reads `businesses.is_platform_admin` for the row whose email matches the caller's.

So any signed-in user who has no business row could insert
`{ email: <own email>, is_platform_admin: true, status: 'active' }`. CareFind customers count, because they share the
auth project. That one row makes them a CareHub platform admin, with read and write access on every tenant through
every RLS policy that ORs `is_platform_admin()`.

Live facts at the time: `businesses_email_key` is UNIQUE on `email`, and `businesses_status_check` allows
`pending, active, suspended, revoked`. The table held 28 rows, including 2 platform admins and 0 branch rows.

## The control

A `BEFORE INSERT` trigger `a_guard_business_insert` calls `public.guard_business_insert()`.

- **Exempt:** `current_user` in `postgres, service_role, supabase_admin, supabase_auth_admin`, or
  `is_platform_admin()`. This covers server endpoints, migrations, platform admins and SECURITY DEFINER RPCs such as
  `register_business()`, where `current_user` is the function owner.
- **Everyone else**, with errors raised as SQLSTATE 42501 that name the field class but never the value:
  - `is_platform_admin` must be false or null, `plan_expires_at` must be null, and `referring_agent_id` must be null.
  - Root business (`parent_business_id is null`): `status = 'pending'`, and `plan` must be `'basic'` or null.
  - Branch: the parent must exist, be visible to the caller and owned by them (`lower(email) = lower(auth.email())`),
    and be `active`. The branch must be `active` or `pending`, with `plan` equal to the parent's or null.

### Design decisions

1. **SECURITY INVOKER.** The trust test is `current_user`, the same as the UPDATE guard. Inside a SECURITY DEFINER
   function, `current_user` is the owner, so a definer guard would exempt every caller and do nothing. The test suite
   proved this: a DEFINER variant fails 11 of the 22 cases. `session_user` does not work either: under PostgREST it is
   `authenticator` both for a direct INSERT and inside `register_business()`.

   Postgres does not check EXECUTE on a trigger function when the trigger fires. So revoking EXECUTE stops the
   function being called as an RPC, and the trigger still runs.

   The parent lookup runs under the caller's RLS. An owner can see their own parent. Another user's parent is
   invisible, so the lookup finds nothing and the insert is rejected.
2. **Trigger ordering.** Postgres fires BEFORE triggers in name order, so `a_guard_business_insert` runs before
   `resolve_referring_agent`. That way the guard sees only what the caller supplied and rejects any caller-supplied
   `referring_agent_id`. The referral trigger then sets the id from `referral_code_used`.
3. **No column-level `REVOKE INSERT`.** While `authenticated` holds table-level INSERT, revoking INSERT on individual
   columns does nothing; the test proves it. Making the revoke effective would mean replacing the table grant with an
   allow-list of column grants. Every column added later would then be silently un-insertable. The trigger is the
   control.

## Apply steps (human-run)

1. Run the advisors (security and performance) and save the baseline.
2. Apply as a **tracked** migration with `apply_migration`, named `businesses_insert_guard`, using the file content.
   **Never use `execute_sql`**, because an untracked change is how earlier fixes were silently lost.
3. Re-read the ACL and confirm there is exactly one signature, and that neither anon nor authenticated can execute it
   (Supabase default privileges can re-grant EXECUTE at creation time):
   ```sql
   select p.oid::regprocedure, p.prosecdef, p.proacl
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guard_business_insert';
   -- expect one row, prosecdef = false, and no anon= / authenticated= / =X (PUBLIC) entries
   select has_function_privilege('anon', 'public.guard_business_insert()', 'execute') as anon,
          has_function_privilege('authenticated', 'public.guard_business_insert()', 'execute') as authenticated;
   -- expect false, false. If either is true, re-run the final REVOKE line of the migration.
   select tgname from pg_trigger where tgrelid = 'public.businesses'::regclass and not tgisinternal order by tgname;
   -- expect a_guard_business_insert before resolve_referring_agent
   ```
4. Run the advisors again. Expect the baseline unchanged: the function is SECURITY INVOKER with a pinned search_path.
5. Run the behavioural verification below.

## Behavioural post-apply verification (human-run)

Everything happens inside one `DO` block that ends in `raise exception`, so every write rolls back. The email is a
throwaway address that owns no business row.

```sql
do $$
declare
  v_attack text := 'INSERTED (VULNERABLE)';
  v_legit  text := 'INSERTED';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-00000000f00d","email":"insert-guard-selftest@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';

  -- 1. The attack: must fail with 42501.
  begin
    insert into public.businesses (name, owner, email, status, is_platform_admin)
    values ('SELFTEST attack', 'SELFTEST', 'insert-guard-selftest@example.invalid', 'active', true);
  exception when others then
    v_attack := sqlstate || ' ' || sqlerrm;
  end;

  -- 2. The registration shape: must succeed.
  begin
    insert into public.businesses (name, owner, email, status, plan)
    values ('SELFTEST legit', 'SELFTEST', 'insert-guard-selftest@example.invalid', 'pending', 'basic');
  exception when others then
    v_legit := 'FAILED ' || sqlstate || ' ' || sqlerrm;
  end;

  raise exception 'RESULT attack=[%] legit=[%]', v_attack, v_legit;
end $$;
-- Expect: RESULT attack=[42501 Only a platform administrator can create a business with platform-admin access.]
--                legit=[INSERTED]
```

Residue check, run afterwards as the owner/superuser:

```sql
select count(*) from public.businesses where email ilike 'insert-guard-selftest%';      -- expect 0
select count(*) from public.businesses where is_platform_admin;                        -- expect 2 (unchanged)
```

## Rollback

```sql
drop trigger if exists a_guard_business_insert on public.businesses;
-- optional: drop function if exists public.guard_business_insert();
```

## What this does NOT cover

- **UPDATE**: covered separately by `guard_business_privileged_columns` (C18). This migration leaves it unchanged; the
  test asserts that no UPDATE trigger is added and that an owner's own-row UPDATE still works.
- **anon UPDATE/DELETE**: `anon` still holds table-level UPDATE and DELETE grants on `businesses`. No policy applies to
  anon, so RLS blocks those statements today. Recommended follow-up: revoke the grants so the protection does not rest
  on RLS alone.
- **Branch creation is already broken in production (out of scope, flagged).** `Locations.jsx` `saveBranch()` →
  `locationsRepository.addBranch()` reuses the parent's exact `email`, and `businesses_email_key` is UNIQUE. Every
  branch insert therefore fails today, which is why live has zero branch rows. Two related hazards apply to whatever
  fix comes next:
  - The unique key is case-sensitive, while RLS and `is_platform_admin()` compare `lower(email)`. A case-variant email
    passes both the policy and the key. The guard allows that for the pending/basic root shape and for a legitimate
    branch.
  - Once an owner has two rows with the same `lower(email)`, `is_platform_admin()`'s scalar subquery fails with
    SQLSTATE 21000 for that owner. Every RLS policy that ORs it, and this guard, then error for them. That breaks
    their own access only; it is not an escalation. The test documents it.

  The branch model needs its own design, for example branches that do not carry the owner's login email, or an
  `is_platform_admin()` that tolerates several rows. Do that before branches are re-enabled.
