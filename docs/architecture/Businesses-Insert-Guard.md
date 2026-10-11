# Businesses INSERT guard

Migrations, in order:

1. `supabase/migrations/carehub_20261031_businesses_insert_guard.sql` is **APPLIED** live as a tracked migration
   (version `20261011040639`, 2026-10-11, with the user's explicit approval). The vulnerability is closed.
2. `supabase/migrations/carehub_20261101_businesses_insert_guard_expiry_default.sql` is the **corrective follow-up**
   and is **NOT YET APPLIED**. See "Corrective follow-up" below.

Test: `apps/carefind/src/test/payments/businessesInsertGuard.db.test.js` (PGlite, real roles and RLS). It loads both
migrations in order.

**Never re-apply migration 1 on its own after migration 2.** Its `CREATE OR REPLACE` would restore the old function
body, which refuses every branch.

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
- **Everyone else** gets SQLSTATE 42501. Messages name the field class, never the value.
  - `is_platform_admin` must be false or null. `referring_agent_id` must be null.
  - **Root business (`parent_business_id is null`): always rejected**, with "Businesses are created through
    registration, not by direct insert."
  - Branch: the parent must exist, be visible to the caller, be owned by them (`lower(email) = lower(auth.email())`)
    and be `active`. The branch must be `active` or `pending` (a null status is rejected). Its `plan` must equal the
    parent's or be null.
  - **After migration 2,** a branch's `plan_expires_at` is always overwritten with the parent's. A value the caller
    supplies and the column default are both replaced, so the caller can neither choose nor extend an expiry.
  - **With migration 1 only** (the live state today), any non-null `plan_expires_at` is refused. Live gives that
    column a default, so every insert is refused. See "Corrective follow-up".

## Corrective follow-up (migration 2)

**What happened.** Running the behavioural verification on live after migration 1 gave these results:

- the attack was blocked;
- the exempt paths (service_role, platform admin) worked;
- the UPDATE guard was intact, the advisors were unchanged, and nothing was left behind;
- **but every ordinary non-privileged insert, including the legitimate branch shape, was refused** with "Only a
  platform administrator can set a plan_expires_at on a new business".

The cause is the live column default `businesses.plan_expires_at DEFAULT (now() + '30 days'::interval)`. Postgres
fills in column defaults *before* row triggers run, so `new.plan_expires_at is not null` was true for every row. The
PGlite replica had no such default, which is why its tests passed.

This failed closed, so there was no security gap. Nothing regressed either: branch creation was already failing in
production on `businesses_email_key`. But the intended branch shape is blocked.

**The fix.** Migration 2 replaces the function body (`CREATE OR REPLACE`) and keeps the trigger as it is:

- it drops the early `plan_expires_at` rejection (root inserts are rejected anyway);
- for a branch, it overwrites `plan_expires_at` with the parent's, read in the same RLS-scoped parent lookup;
- every other rule is unchanged.

**The lesson.** A test replica must mirror the live **column defaults** of every column a trigger reads, because
defaults are filled in before triggers fire. The test now pins those defaults in its "replica defaults match live"
case. Pre-apply check (d) below diffs the live defaults against it. Run that check before applying anything that
touches this guard.

### Applying migration 2

1. Run pre-apply checks (a) to (e) below. The trigger hard gate (e) now expects the three post-migration-1 triggers:
   `a_guard_business_insert`, `guard_business_privileged_columns`, `resolve_referring_agent`.
2. Run the advisors and save the baseline.
3. Apply it as a tracked migration with `apply_migration`, named `businesses_insert_guard_expiry_default`, using the
   repo file's content exactly. It does not touch the trigger, so it takes no ACCESS EXCLUSIVE lock on businesses;
   its `lock_timeout` is precautionary.
4. Run the step 4 catalogue checks below: one signature, no anon/authenticated/PUBLIC EXECUTE in `proacl`, and the
   same three triggers. Also confirm the new body is live:
   ```sql
   select prosrc ilike '%new.plan_expires_at := v_parent_expiry%' as overwrites,
          prosrc ilike '%new.plan_expires_at is not null%'       as old_rejection
     from pg_proc where proname = 'guard_business_insert';
   -- expect: overwrites = true, old_rejection = false
   ```
5. Run the advisors again (expect them unchanged), then the behavioural verification, where case 5 must now be
   ACCEPTED.

### Policy change

After this migration, **an ordinary signed-in user can no longer insert a root business directly**, in any shape,
including the old pending/basic registration shape. No client code does this: registration goes only through the
SECURITY DEFINER RPCs (`register_business*`), which are exempt, and the only client-side insert is branch creation
(`Locations.jsx`), which always has a parent. Rejecting root inserts also closes the case-variant second-root-row path
described under "Known gaps".

### Design decisions

1. **SECURITY INVOKER.** The trust test is `current_user`, the same as in the UPDATE guard. A DEFINER guard would see
   the function owner as `current_user` and so exempt every caller. That was proven when a DEFINER variant failed 11
   of 22 cases in round 0. `session_user` is no better: under PostgREST it is `authenticator` both for a direct INSERT
   and inside `register_business()`.
   - Postgres does not check EXECUTE on a trigger function when the trigger fires. Revoking EXECUTE therefore stops
     direct RPC calls and leaves the trigger working.
   - The parent lookup runs under the caller's RLS. An owner can see their own parent. Another user's parent is
     invisible, so it counts as "not yours" and the insert is rejected.
2. **Trigger ordering.** BEFORE triggers fire in name order, so `a_guard_business_insert` runs before
   `resolve_referring_agent`. The guard therefore sees only what the caller supplied, and it rejects any
   caller-supplied `referring_agent_id`. The referral trigger then sets the id from `referral_code_used`.
3. **Upserts** (`INSERT ... ON CONFLICT DO UPDATE`) have two guarded paths. The test proves each separately, with the
   real UPDATE guard loaded.
   - **Path 1:** this trigger checks the *proposed* row before any conflict handling, so a proposed row that carries
     an escalation is rejected here, with this guard's message.
   - **Path 2:** a proposed row that passes this guard (a valid branch of the caller's own row, with the same id)
     reaches the `DO UPDATE`. There, `guard_business_privileged_columns` rejects any change to `is_platform_admin`,
     `plan` or `status`, with its own message.
   - A control case shows the path-2 upserts succeed when the UPDATE guard is absent, so the path-2 tests depend on
     that guard.
4. **No column-level `REVOKE INSERT`.** While `authenticated` holds table-level INSERT, revoking INSERT on individual
   columns does nothing (proven in the test). Making it effective would mean replacing the table grant with an
   allow-list of column grants, and every column added later would then be silently un-insertable. The trigger is the
   control.

## Apply steps (human-run)

The steps below were written for migration 1, which is applied. They apply to migration 2 with the changes listed in
"Applying migration 2" above.

### 1. Pre-apply checks (stop on any unexpected result)

```sql
-- a) No owner already has two rows under one lower(email). Duplicates make is_platform_admin() raise 21000.
--    NULL emails are excluded; they match no caller.
select lower(email), count(*) from public.businesses where email is not null group by 1 having count(*) > 1;
-- expect: zero rows

-- b1) HEURISTIC scan: functions whose source matches "insert into ... businesses". It misses odd spacing or line
--     breaks between INSERT and INTO, quoted or schema-less spellings it cannot see, and dynamic SQL (EXECUTE format(...)).
--     A SECURITY DEFINER function is exempt from the guard only if its OWNER is one of postgres, service_role,
--     supabase_admin or supabase_auth_admin. Any other owner, or any INVOKER function called by signed-in users, will
--     now be held to the guard and must be reviewed before applying.
select p.oid::regprocedure, p.prosecdef, pg_get_userbyid(p.proowner) as owner
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog', 'information_schema')
   and p.prosrc ilike '%insert into%businesses%';
-- expect: register_business* (prosecdef = true, owner postgres); review every other row

-- b2) Human review: EVERY SECURITY DEFINER function in public that mentions businesses at all. This covers what b1
--     misses. For each one that can insert a business row, check the owner as in b1.
select p.oid::regprocedure, pg_get_userbyid(p.proowner) as owner
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%businesses%'
 order by 1;

-- c) Record the platform-admin count now. The residue check after verification compares against this number.
select count(*) as platform_admins_before from public.businesses where is_platform_admin;

-- d) Column defaults of the guarded columns must equal the test replica's ("replica defaults match live" in
--    businessesInsertGuard.db.test.js). If ANY differs, STOP: update the replica and that test first, then re-run
--    the suite, because a default the replica lacks hides behaviour (see "Corrective follow-up").
select column_name, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'businesses'
   and column_name in ('status', 'plan', 'plan_expires_at', 'is_platform_admin', 'parent_business_id', 'referring_agent_id')
 order by column_name;
-- expect exactly:
--   is_platform_admin   false
--   parent_business_id  NULL
--   plan                'basic'::text
--   plan_expires_at     (now() + '30 days'::interval)
--   referring_agent_id  NULL
--   status              'pending'::text

-- e) HARD GATE: the triggers on businesses must be exactly the two expected ones (before migration 1; before
--    migration 2 they are the three listed in step 4). The post-apply write test performs
--    a real INSERT (rolled back), and that INSERT would fire any unknown trigger or webhook, including an AFTER INSERT
--    one with side effects outside the transaction (an http request, for example).
select tgname from pg_trigger where tgrelid = 'public.businesses'::regclass and not tgisinternal order by tgname;
-- expect exactly: guard_business_privileged_columns, resolve_referring_agent
-- If ANYTHING else is listed: STOP. Do not apply, and do not run the write test.
```

### 2. Baseline advisors

Run the security and performance advisors and save the output.

### 3. Apply

Apply as a **tracked** migration with `apply_migration`, named `businesses_insert_guard`, using the repo file's
content exactly. **Never use `execute_sql`**: an untracked change is how earlier fixes were silently lost.

**Locking.** The file begins with `set local lock_timeout = '5s';`.

- `DROP TRIGGER IF EXISTS` takes an **ACCESS EXCLUSIVE** lock on `public.businesses`, even when the trigger does not
  exist yet. While the apply waits for or holds that lock, **reads queue as well as writes**, for up to 5 seconds.
  Every login and page that touches businesses stalls during that window.
- `CREATE TRIGGER` then takes SHARE ROW EXCLUSIVE, which blocks writes.
- Apply at a quiet time.

**Transaction assumption.** This runbook assumes `apply_migration` runs the body as one transaction. `set local` only
takes effect inside a transaction, and "on a lock timeout, nothing was applied; just retry" relies on the whole body
rolling back together.

If that assumption does not hold, choose one of these:

- Run the body yourself inside an explicit `begin; ... commit;`, so the timeout applies and a failure rolls back
  cleanly. The tracked migration must still be recorded.
- Accept that `set local` is a no-op (Postgres emits a WARNING). The apply then waits for locks without a timeout.
  Before retrying after a failure, check what state it left behind.

### 4. Post-apply catalogue checks

```sql
select p.oid::regprocedure, p.prosecdef, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'guard_business_insert';
-- expect: one row; prosecdef = false; no anon= / authenticated= / =X (PUBLIC) entries
select has_function_privilege('anon', 'public.guard_business_insert()', 'execute') as anon,
       has_function_privilege('authenticated', 'public.guard_business_insert()', 'execute') as authenticated;
-- expect: false, false. Supabase default privileges can re-grant EXECUTE; if either is true, re-run the final
-- REVOKE line of the migration and check again.
select tgname from pg_trigger where tgrelid = 'public.businesses'::regclass and not tgisinternal order by tgname;
-- HARD GATE, expect exactly: a_guard_business_insert, guard_business_privileged_columns, resolve_referring_agent
```

### 5. Advisors again

Expect the saved baseline, unchanged. The new function is SECURITY INVOKER with a pinned search_path.

### 6. Behavioural verification

See the next section.

## Behavioural post-apply verification (human-run)

Run this only after both trigger hard gates have passed. It runs as one `DO` block that ends in `raise exception`, so
every write rolls back. It covers five cases:

- the attack, which must fail;
- an ordinary user's root insert, which must fail;
- `service_role` inserting a pending root, which must succeed;
- a platform admin inserting an active root, which must succeed;
- a legitimate branch of the caller's own active parent, supplying a far-future expiry. This must be ACCEPTED, and
  stored with the parent's expiry, **only after migration 2**. With migration 1 alone it is REFUSED on
  `plan_expires_at`. Like the other cases it uses a throwaway parent row seeded as the owner and rolled back. The
  branch uses a case variant of the owner's email because `businesses_email_key` is case-sensitive (see Known gaps).

The platform-admin case uses a throwaway admin row that the block creates itself, as the owner (exempt), and that is
rolled back with everything else. Every address is a throwaway that owns no real row.

```sql
do $$
declare
  v_attack text := 'INSERTED (VULNERABLE)';
  v_root   text := 'INSERTED (POLICY NOT ENFORCED)';
  v_svc    text := 'INSERTED';
  v_admin  text := 'INSERTED';
  v_branch text := 'INSERTED';
  v_parent uuid;
  v_expiry timestamptz;
begin
  -- Ordinary signed-in user with no business row.
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-00000000f00d","email":"insert-guard-selftest@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';

  -- 1. The attack: must fail with 42501.
  begin
    insert into public.businesses (name, owner, email, status, is_platform_admin)
    values ('SELFTEST attack', 'SELFTEST', 'insert-guard-selftest@example.invalid', 'active', true);
  exception when others then v_attack := sqlstate || ' ' || sqlerrm;
  end;

  -- 2. The old registration shape by direct insert: must now fail with 42501.
  begin
    insert into public.businesses (name, owner, email, status, plan)
    values ('SELFTEST root', 'SELFTEST', 'insert-guard-selftest@example.invalid', 'pending', 'basic');
  exception when others then v_root := sqlstate || ' ' || sqlerrm;
  end;

  -- 3. service_role: must succeed.
  execute 'reset role';
  execute 'set local role service_role';
  begin
    insert into public.businesses (name, owner, email, status, plan)
    values ('SELFTEST svc', 'SELFTEST', 'insert-guard-selftest-svc@example.invalid', 'pending', 'basic');
  exception when others then v_svc := 'FAILED ' || sqlstate || ' ' || sqlerrm;
  end;

  -- 4. Platform admin: seed a throwaway admin row as the owner, then act as that admin.
  execute 'reset role';
  insert into public.businesses (name, owner, email, status, plan, is_platform_admin)
  values ('SELFTEST admin', 'SELFTEST', 'insert-guard-selftest-admin@example.invalid', 'active', 'enterprise', true);
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-00000000fade","email":"insert-guard-selftest-admin@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.businesses (name, owner, email, status, plan)
    values ('SELFTEST by admin', 'SELFTEST', 'insert-guard-selftest-byadmin@example.invalid', 'active', 'growth');
  exception when others then v_admin := 'FAILED ' || sqlstate || ' ' || sqlerrm;
  end;

  -- 5. Legit branch of own active parent; the supplied expiry must be overwritten with the parent's.
  execute 'reset role';
  insert into public.businesses (name, owner, email, status, plan, plan_expires_at)
  values ('SELFTEST parent', 'SELFTEST', 'insert-guard-selftest-owner@example.invalid', 'active', 'basic', '2030-01-01T00:00:00Z')
  returning id into v_parent;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-0000000b0a7d","email":"insert-guard-selftest-owner@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.businesses (name, owner, email, parent_business_id, status, plan, plan_expires_at)
    values ('SELFTEST branch', 'SELFTEST', 'Insert-Guard-Selftest-Owner@example.invalid', v_parent, 'active', 'basic', '2099-01-01T00:00:00Z')
    returning plan_expires_at into v_expiry;
    v_branch := 'INSERTED expiry=' || v_expiry::text;
  exception when others then v_branch := 'REFUSED ' || sqlstate || ' ' || sqlerrm;
  end;

  raise exception 'RESULT attack=[%] root=[%] service_role=[%] admin=[%] branch=[%]', v_attack, v_root, v_svc, v_admin, v_branch;
end $$;
-- Expect AFTER migration 2:
--   attack=[42501 Only a platform administrator can create a business with platform-admin access.]
--   root=[42501 Businesses are created through registration, not by direct insert.]
--   service_role=[INSERTED]
--   admin=[INSERTED]
--   branch=[INSERTED expiry=2030-01-01 00:00:00+00]   (the PARENT's expiry, not 2099 and not now()+30d)
-- With migration 1 only (the live state on 2026-10-11): attack, service_role and admin are as above, but
--   root=[42501 Only a platform administrator can set a plan_expires_at on a new business.]  (still refused)
--   branch=[REFUSED 42501 Only a platform administrator can set a plan_expires_at on a new business.]
```

Residue check, run afterwards as the owner:

```sql
select count(*) from public.businesses where email ilike 'insert-guard-selftest%';      -- expect 0
select count(*) from public.businesses where is_platform_admin;  -- expect = platform_admins_before (pre-check c)
```

## Rollback

```sql
-- Whole guard (re-opens the vulnerability; emergency only):
drop trigger if exists a_guard_business_insert on public.businesses;
-- optional: drop function if exists public.guard_business_insert();
```

To undo migration 2 alone, re-run the function definition from migration 1. That restores the fail-closed body, which
refuses every branch. Do not drop the trigger for that.

## What this does NOT cover

- **UPDATE** stays with `guard_business_privileged_columns` (C18), which this migration leaves unchanged. The test
  loads the real UPDATE guard and asserts three things: an owner can still rename their business, a status PATCH is
  rejected by the UPDATE guard, and upserts cannot escalate.

## Known gaps (separate follow-ups)

- **`ecommerce_enabled` and `branch_depth_limit` are unguarded on both INSERT and UPDATE.** An owner can turn on
  e-commerce for their own business and skip admin vetting. This predates the change and is shared with the UPDATE
  guard, whose protected list does not include these columns. Fix both guards together.
- **anon holds table-level UPDATE and DELETE grants on `businesses`.** Today they are blocked only because no RLS
  policy applies to anon. Revoke them so the protection does not rest on RLS alone.
- **Branch expiry, resolved by migration 2:** a branch now always inherits its parent's `plan_expires_at`, copied at
  insert time. Still open for the branch redesign: if the parent's expiry is later extended or renewed, the branch's
  copy does not follow. Should renewals cascade to branches, or should a branch derive its expiry from the parent?
- **Branch creation currently fails in production on `businesses_email_key`.** `Locations.jsx` `saveBranch()` →
  `locationsRepository.addBranch()` reuses the parent's exact `email`, and the key is UNIQUE, so live has zero branch
  rows.
  - The key is case-sensitive, while RLS and `is_platform_admin()` compare `lower(email)`.
  - A branch inserted under a case variant of the owner's email passes both the key and the policy. The owner then
    has two rows, and `is_platform_admin()` raises 21000 for them. That breaks every policy that ORs it, and this
    guard, for that owner only. It is self-harm, not escalation; the test proves it in a self-contained case.
  - Root inserts are now rejected, so a branch insert is the only remaining route to it.
  - The branch model needs its own design before branches are re-enabled, for example branches that do not carry the
    owner's login email, or an `is_platform_admin()` that tolerates several rows.
