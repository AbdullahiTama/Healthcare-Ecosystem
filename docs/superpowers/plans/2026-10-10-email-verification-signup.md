# Email Verification at Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CareHub business owner proves their email by a link that also takes them to set their own password, and registration can no longer be completed by calling the database directly; CareFind's existing verification gets a resend control and tests.

**Architecture:** Registration moves from an anon-callable RPC to a server handler (`POST /api/register-business`) that calls a service-role-only RPC creating an *unconfirmed* auth user plus a `pending` business in one transaction, then sends a recovery-type link (`owner_setup`) that lands on the existing `/reset-password` page in a "welcome" variant. A database trigger, not the client, blocks approving a business whose owner is unconfirmed. The old RPC is revoked in a *second* migration, applied only after the new frontend is live.

**Tech Stack:** Supabase (Postgres 17, GoTrue), Vercel serverless handlers (ESM), React 18 + Vite, Vitest, PGlite for migration tests, `@care-ecosystem/shared-email`.

**Spec:** `docs/superpowers/specs/2026-10-10-email-verification-signup-design.md`

## Global Constraints

- `main` deploys to production. Work on a branch, open a PR, merge only when told. One commit per unit; behaviour fixes separate from refactors.
- Live project is `carehub` / `szdybxmgmhndoytqanfb`. Never target `xerpyovjxhwoawzzfkne`.
- Production DDL is applied as a **tracked migration** (`apply_migration`), never `execute_sql`.
- After creating any function: re-read `pg_proc.proacl` (expect `postgres | service_role` only for the new functions) and check there is no differently-signed sibling. `REVOKE ... FROM PUBLIC` does not guarantee the ACL; follow with `REVOKE ... FROM anon, authenticated`.
- Run `get_advisors` (security) before and after the migration and compare.
- Migrations are named `carehub_YYYYMMDD_<name>.sql`, written to `supabase/migrations/` and mirrored in `apps/carefind/sql/` only if the neighbouring files are (check `ls` first).
- Public auth endpoints never reveal whether an address has an account (generic `{ ok: true }`), except registration, which already returns a readable "already exists" error today.
- Never log tokens, links or addresses; log error codes only.
- Every new screen state needs loading, error and empty handling, keyboard access and responsive layout at 375/768/1280px.
- Passwords are minimum 6 characters (existing rule), enforced by Supabase on `updateUser`.

## Review Focus

- **Link opened twice / after expiry:** second click or expired link must land on `LinkExpired`, never a blank set-password form. (Task 6)
- **Owner registers, never clicks, tries to sign in:** must see "verify your email" with a working resend, not "Incorrect email or password". (Task 6)
- **Two registrations for one address, differing only by case or whitespace:** second must be rejected and leave no orphan auth user. (Task 1)
- **Setup email fails to enqueue:** registration still succeeds; the owner can recover via resend; no stack trace to the client. (Task 4)
- **Admin approves in bulk with an unconfirmed owner in the selection:** the database must refuse that row and the UI must report which, not silently skip. (Task 7)
- **Old frontend still deployed when the old RPC is revoked:** registration would break. The revoke is a separate migration applied last. (Task 9)

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/carehub_20261029_owner_email_verification.sql` (new) | Additive: `mint_unconfirmed_auth_user`, `register_business_unconfirmed`, owner-confirmed trigger, `owner_setup` catalog row, admin lookup RPC |
| `supabase/migrations/carehub_20261030_revoke_register_business.sql` (new) | Cutover: revoke `register_business` from `anon, authenticated` |
| `apps/carefind/src/test/payments/ownerEmailVerification.db.test.js` (new) | PGlite test for both migrations (the repo's DB tests live here) |
| `packages/shared-email/src/templates/CareHub/index.js` | `ownerSetup` template + `SUBJECTS.owner_setup` |
| `packages/shared-email/src/templates/Transactional/index.js` | re-export `ownerSetup` |
| `packages/shared-email/src/templates/index.js` | `HUB_TEMPLATE_MAP.ownerSetup = 'owner_setup'` |
| `packages/shared-email/src/templates/samples.js` | sample payload for the preview tool |
| `packages/shared-email/src/authEmail.js` | `owner_setup` action |
| `apps/carehub/api/_handlers/register-business.js` (new) | the registration handler |
| `apps/carehub/api/router.js` | route `register-business` |
| `apps/carehub/src/services/supabase.js` | `registerBusiness` calls the handler |
| `apps/carehub/src/pages/auth/Register.jsx` | remove password fields; new done copy |
| `apps/carehub/src/pages/auth/ResetPassword.jsx` | `?welcome=1` variant |
| `apps/carehub/src/pages/auth/Login.jsx` | unconfirmed state + resend |
| `apps/carehub/src/pages/admin/*` | "awaiting email verification" marker |
| `apps/carefind/src/modules/account/Login.jsx` | resend control in "check your inbox" |
| `docs/architecture/Expired-Auth-Links.md`, new `docs/architecture/Owner-Email-Verification.md` | documentation |

---

### Task 0: Spikes (blocking; nothing here is merged)

Two facts the design depends on cannot be read from the code. Resolve both first and record the answers in the spec's section 9.

**Files:**
- Scratch only: `<scratchpad>/s1-recovery-confirms.mjs`

**Interfaces:**
- Produces: a written yes/no on S1 and the exact semantics of S2, appended to the spec.

- [ ] **Step 1: S1 - does a recovery link confirm an unconfirmed user?**

Needs the production service-role key in the environment (ask the user to run it, or to approve use of the key). It creates one throwaway `@example.com` user and deletes it. `generateLink` does not send mail.

```js
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const email = `s1-spike-${Date.now()}@example.com`
const redirectTo = 'https://carefindhub.com/reset-password?welcome=1'

const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: false })
if (createErr) throw createErr
const id = created.user.id
try {
  const before = (await admin.auth.admin.getUserById(id)).data.user.email_confirmed_at
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
  const res = await fetch(link.properties.action_link, { redirect: 'manual' })
  const after = (await admin.auth.admin.getUserById(id)).data.user.email_confirmed_at
  console.log(JSON.stringify({
    before, after, linkError: linkErr?.message ?? null, status: res.status,
    location: (res.headers.get('location') || '').replace(/(access_token|refresh_token|code|token_hash)=[^&#]+/g, '$1=<redacted>'),
  }, null, 2))
} finally {
  await admin.auth.admin.deleteUser(id)
}
```

Run: `node --env-file=.env s1-recovery-confirms.mjs`
Expected PASS: `before` is `null`, `after` is a timestamp, `status` is 302 or 303, `location` begins with the `redirectTo`. If `redirectTo` is not on the Supabase allow-list, `location` is the Site URL: record that and add the URL to the allow-list as a deploy step in Task 9.

- [ ] **Step 2: S2 - what does `email_outbox` require for a new event?**

Run through `execute_sql` (it rolls back by raising). It tests the foreign key and the payload shape `authEmail.js` actually sends:

```sql
do $$
declare r text := '';
begin
  begin
    insert into public.email_outbox (to_email, from_email, subject, template_key, app, event_key, payload, status, next_retry_at)
    values ('spike@example.com', 'CareHub <support@mail.carefindhub.com>', 's', 'owner_setup', 'carehub', 'owner_setup', '{}', 'pending', now());
    r := r || 'owner_setup without catalog row: ACCEPTED; ';
  exception when others then r := r || 'owner_setup without catalog row: ' || sqlstate || ' ' || sqlerrm || '; ';
  end;
  begin
    insert into public.email_outbox (to_email, from_email, subject, template_key, app, event_key, payload, status, next_retry_at)
    values ('spike@example.com', 'CareHub <support@mail.carefindhub.com>', 's', 'staff_welcome', 'carehub', 'staff_welcome',
            '{"fullName":"A","businessName":"B","role":"C","setupLink":"https://carefindhub.com/x"}', 'pending', now());
    r := r || 'staff_welcome with camelCase payload: ACCEPTED; ';
  exception when others then r := r || 'staff_welcome with camelCase payload: ' || sqlstate || ' ' || sqlerrm || '; ';
  end;
  raise exception '%', r;
end $$;
```

Expected: the first insert fails with `23503` (foreign key), confirming Task 1 must add a catalog row. Record whether the second is accepted: if it is rejected, `owner_setup`'s catalog `payload_schema` must be shaped as the schema in Task 1 and the payload mapped accordingly. Also record what the `enabled = false` flag on existing carehub catalog rows does (`select prosrc from pg_proc where prosrc ilike '%enabled%' and prosrc ilike '%email_event_catalog%'`).

- [ ] **Step 3: Record results and decide**

Append the two results to `docs/superpowers/specs/2026-10-10-email-verification-signup-design.md` section 9 and commit (`docs(spec): record S1/S2 spike results`). If S1 fails, stop and return to design review: the fallback is `auth.resend({ type: 'signup' })` plus a password-bearing signup link, which changes Tasks 3 and 6.

---

### Task 1: Additive migration and database tests

**Files:**
- Create: `supabase/migrations/carehub_20261029_owner_email_verification.sql`
- Create: `supabase/migrations/carehub_20261030_revoke_register_business.sql`
- Test: `apps/carefind/src/test/payments/ownerEmailVerification.db.test.js`

**Interfaces:**
- Consumes: `public.mint_confirmed_auth_user(text, text)` from `carehub_20261025_fix_mint_auth_user_pgcrypto.sql`; `public.email_event_catalog` rows for `staff_welcome`.
- Produces: `public.mint_unconfirmed_auth_user(p_email text) returns uuid`; `public.register_business_unconfirmed(p_business jsonb) returns uuid`; `public.admin_unverified_owner_business_ids() returns setof uuid`; trigger `businesses_require_verified_owner`; catalog row `(carehub, owner_setup)`. All function execute rights: `service_role` only, except the admin RPC (`authenticated`, guarded inside).

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
// Owner email verification: registration creates an UNCONFIRMED owner plus a pending business atomically, only the
// service role can call it, the old RPC is revoked at cutover, and a pending business cannot leave `pending` while
// its owner is unconfirmed.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const M = (name) => readFileSync(fileURLToPath(new URL(`../../../../../supabase/migrations/${name}.sql`, import.meta.url)), 'utf8')
let db

const register = (over = {}) => db.query(
  'select public.register_business_unconfirmed($1::jsonb) as id',
  [JSON.stringify({ name: 'Lifeline Pharmacy', owner: 'Ada Eze', email: 'Ada@Lifeline.test', ...over })],
)
const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema extensions; create schema auth;
    create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
    create function extensions.crypt(text, text) returns text language sql as $$ select 'hash:' || $1 $$;
    create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
      email_confirmed_at timestamptz, recovery_sent_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
      created_at timestamptz, updated_at timestamptz, confirmation_token text, email_change text,
      email_change_token_new text, recovery_token text);
    create table auth.identities (id uuid, user_id uuid, provider_id text, identity_data jsonb, provider text,
      last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table public.profiles (id uuid, display_name text, created_at timestamptz default now());
    create table public.businesses (id uuid primary key, name text, owner text, email text, phone text, whatsapp text,
      address text, state text, city text, business_type text, hours text, maps_link text, lat double precision,
      lng double precision, website text, status text, visible_on_carefind boolean, created_at timestamptz, plan text,
      referral_code_used text, parent_business_id uuid, is_platform_admin boolean default false,
      constraint businesses_status_check check (status in ('pending','active','suspended','revoked')));
    create table public.email_event_catalog (app text, event_key text, template_key text, subject_template text,
      from_email text, reply_to text, payload_schema jsonb, enabled boolean, required_for_business boolean,
      category text, rollout_mode text, primary key (app, event_key));
    insert into public.email_event_catalog values ('carehub','staff_welcome','staff_welcome','s','CareHub <s@x>','s@x','{}',false,false,'staff','live');
    -- Stub of the shared admin guard; the test flips it through a setting.
    create function public.is_platform_admin() returns boolean language sql stable as $$
      select coalesce(current_setting('test.is_admin', true), 'off') = 'on' $$;
    create function public.register_business(p_business jsonb, p_password text) returns uuid language sql as $$ select null::uuid $$;
  `)
  await db.exec(M('carehub_20261025_fix_mint_auth_user_pgcrypto'))
  await db.exec(M('carehub_20261029_owner_email_verification'))
})

describe('register_business_unconfirmed', () => {
  it('creates an unconfirmed owner and a pending business together, lowercasing the email', async () => {
    const { rows } = await register()
    const id = rows[0].id
    const user = (await db.query(`select email, email_confirmed_at from auth.users where email = 'ada@lifeline.test'`)).rows[0]
    expect(user.email_confirmed_at).toBeNull()
    const biz = (await db.query('select status, email from public.businesses where id = $1', [id])).rows[0]
    expect(biz).toEqual({ status: 'pending', email: 'ada@lifeline.test' })
    const ident = (await db.query(`select identity_data from auth.identities`)).rows[0]
    expect(ident.identity_data.email_verified).toBe(false)
  })

  it('rejects a second registration that differs only by case or whitespace, leaving nothing behind', async () => {
    const usersBefore = await count('select count(*) n from auth.users')
    const bizBefore = await count('select count(*) n from public.businesses')
    await expect(register({ email: '  ADA@lifeline.test ' })).rejects.toThrow(/already exists/i)
    expect(await count('select count(*) n from auth.users')).toBe(usersBefore)
    expect(await count('select count(*) n from public.businesses')).toBe(bizBefore)
  })

  it('rejects bad input without creating an auth user', async () => {
    const usersBefore = await count('select count(*) n from auth.users')
    await expect(register({ email: 'not-an-email' })).rejects.toThrow(/valid email/i)
    await expect(register({ email: 'x@y.test', name: '' })).rejects.toThrow(/Business name/i)
    await expect(register({ email: 'x@y.test', owner: '' })).rejects.toThrow(/Owner name/i)
    expect(await count('select count(*) n from auth.users')).toBe(usersBefore)
  })
})

describe('privileges', () => {
  it('lets only service_role execute the new functions', async () => {
    const sig = ['public.mint_unconfirmed_auth_user(text)', 'public.register_business_unconfirmed(jsonb)']
    for (const s of sig) {
      const r = (await db.query(
        `select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b,
                has_function_privilege('service_role', $1, 'execute') c`, [s])).rows[0]
      expect(r, s).toEqual({ a: false, b: false, c: true })
    }
  })

  it('has exactly one signature of each new function (no sibling overloads)', async () => {
    const { rows } = await db.query(`select proname, count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('mint_unconfirmed_auth_user','register_business_unconfirmed','admin_unverified_owner_business_ids') group by 1`)
    expect(rows).toHaveLength(3)
    for (const r of rows) expect(r.n, r.proname).toBe(1)
  })
})

describe('businesses_require_verified_owner', () => {
  it('blocks activating while the owner is unconfirmed, but allows suspending and revoking', async () => {
    const { rows } = await register({ email: 'gate@lifeline.test', name: 'Gate Clinic' })
    const id = rows[0].id
    await expect(db.query(`update public.businesses set status = 'active' where id = $1`, [id])).rejects.toThrow(/not verified/i)
    await db.query(`update public.businesses set status = 'suspended' where id = $1`, [id])
    expect((await db.query('select status from public.businesses where id = $1', [id])).rows[0].status).toBe('suspended')

    const second = await register({ email: 'gate2@lifeline.test', name: 'Gate Two Clinic' })
    await db.query(`update public.businesses set status = 'revoked' where id = $1`, [second.rows[0].id])
    expect((await db.query('select status from public.businesses where id = $1', [second.rows[0].id])).rows[0].status).toBe('revoked')
  })

  it('blocks activating when the email is changed in the same update to an address with no auth user', async () => {
    const { rows } = await register({ email: 'swap@lifeline.test', name: 'Swap Clinic' })
    await expect(db.query(
      `update public.businesses set status = 'active', email = 'nouser@lifeline.test' where id = $1`, [rows[0].id],
    )).rejects.toThrow(/not verified/i)
    expect((await db.query('select status, email from public.businesses where id = $1', [rows[0].id])).rows[0])
      .toEqual({ status: 'pending', email: 'swap@lifeline.test' })
  })

  it('allows activation once the owner is confirmed, and ignores businesses with no auth user', async () => {
    const { rows } = await register({ email: 'ok@lifeline.test', name: 'Ok Clinic' })
    await db.query(`update auth.users set email_confirmed_at = now() where email = 'ok@lifeline.test'`)
    await db.query(`update public.businesses set status = 'active' where id = $1`, [rows[0].id])
    expect((await db.query('select status from public.businesses where id = $1', [rows[0].id])).rows[0].status).toBe('active')

    await db.query(`insert into public.businesses (id, name, email, status) values (gen_random_uuid(), 'Legacy', 'legacy@x.test', 'pending')`)
    await db.query(`update public.businesses set status = 'active' where email = 'legacy@x.test'`)
    expect((await db.query(`select status from public.businesses where email = 'legacy@x.test'`)).rows[0].status).toBe('active')
  })
})

describe('admin_unverified_owner_business_ids', () => {
  const asAdmin = (on) => db.query(`select set_config('test.is_admin', $1, false)`, [on ? 'on' : 'off'])
  const ids = () => db.query('select id from public.admin_unverified_owner_business_ids() as t(id)')

  it('refuses a caller that is not a platform admin', async () => {
    await asAdmin(false)
    await expect(ids()).rejects.toThrow(/not authorised/i)
  })

  it('returns exactly the pending businesses whose owner is unconfirmed', async () => {
    // Earlier tests left two pending businesses with unconfirmed owners: Ada, and the one whose email-swap was refused.
    const left = (await db.query(`select id from public.businesses where email in ('ada@lifeline.test', 'swap@lifeline.test')`)).rows.map((r) => r.id)
    expect(left).toHaveLength(2)
    const waiting = (await register({ email: 'wait@lifeline.test', name: 'Waiting Clinic' })).rows[0].id
    const confirmed = (await register({ email: 'done@lifeline.test', name: 'Confirmed Clinic' })).rows[0].id
    await db.query(`update auth.users set email_confirmed_at = now() where email = 'done@lifeline.test'`)
    const revoked = (await register({ email: 'gone@lifeline.test', name: 'Revoked Clinic' })).rows[0].id
    await db.query(`update public.businesses set status = 'revoked' where id = $1`, [revoked])

    await asAdmin(true)
    try {
      const got = (await ids()).rows.map((r) => r.id).sort()
      expect(got).toEqual([...left, waiting].sort())
      expect(got).not.toContain(confirmed)
      expect(got).not.toContain(revoked)
    } finally {
      await asAdmin(false)
    }
  })
})

describe('catalog row', () => {
  it('adds owner_setup for carehub by copying the staff_welcome sender and is re-runnable', async () => {
    await db.exec(M('carehub_20261029_owner_email_verification'))
    const { rows } = await db.query(`select event_key, template_key, from_email, category from public.email_event_catalog
      where app = 'carehub' and event_key = 'owner_setup'`)
    expect(rows).toEqual([{ event_key: 'owner_setup', template_key: 'owner_setup', from_email: 'CareHub <s@x>', category: 'auth' }])
  })
})

describe('cutover migration', () => {
  it('revokes register_business from anon and authenticated and keeps service_role', async () => {
    await db.exec(M('carehub_20261030_revoke_register_business'))
    const r = (await db.query(
      `select has_function_privilege('anon', 'public.register_business(jsonb,text)', 'execute') a,
              has_function_privilege('authenticated', 'public.register_business(jsonb,text)', 'execute') b,
              has_function_privilege('service_role', 'public.register_business(jsonb,text)', 'execute') c`)).rows[0]
    expect(r).toEqual({ a: false, b: false, c: true })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/carefind && npx vitest run src/test/payments/ownerEmailVerification.db.test.js`
Expected: FAIL with `ENOENT ... carehub_20261029_owner_email_verification.sql`.

- [ ] **Step 3: Write the additive migration**

`supabase/migrations/carehub_20261029_owner_email_verification.sql`:

```sql
-- Owner email verification (spec 2026-10-10). ADDITIVE ONLY: nothing here removes a capability, so it is safe to apply
-- while the previous frontend is still deployed. The old register_business() is revoked by the separate cutover
-- migration carehub_20261030_revoke_register_business.sql, applied after the new frontend is live.

-- 1. An owner account that has NOT proven the address. Built on mint_confirmed_auth_user so display-name collision
-- handling and the pgcrypto call stay in one place; the account is un-confirmed in the same transaction, so no
-- confirmed intermediate state is ever visible. The password is a random value that is never disclosed: the owner
-- sets their own through the emailed recovery link.
create or replace function public.mint_unconfirmed_auth_user(p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(trim(p_email));
  v_uid uuid;
begin
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email is required.';
  end if;
  -- mint_confirmed_auth_user would silently CONFIRM an existing unconfirmed user; never let that happen here.
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with this email already exists. Please sign in instead.';
  end if;

  v_uid := public.mint_confirmed_auth_user(v_email, gen_random_uuid()::text || gen_random_uuid()::text);

  update auth.users
     set email_confirmed_at = null,
         recovery_sent_at = null,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email_verified', false),
         updated_at = now()
   where id = v_uid;
  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email_verified', false)
   where user_id = v_uid;
  return v_uid;
end $function$;

revoke all on function public.mint_unconfirmed_auth_user(text) from public, anon, authenticated;
grant execute on function public.mint_unconfirmed_auth_user(text) to service_role;

-- 2. Registration without a password. Same validation and columns as register_business().
create or replace function public.register_business_unconfirmed(p_business jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(trim(p_business->>'email'));
  v_name text := nullif(trim(p_business->>'name'), '');
  v_owner text := nullif(trim(p_business->>'owner'), '');
  v_id uuid := gen_random_uuid();
  v_visible boolean;
  v_referral text;
begin
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email is required.';
  end if;
  if v_name is null then raise exception 'Business name is required.'; end if;
  if v_owner is null then raise exception 'Owner name is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('register_business:' || v_email, 0));

  v_visible := coalesce((p_business->>'visible_on_carefind')::boolean, true);
  v_referral := nullif(p_business->>'referral_code_used', '');

  perform public.mint_unconfirmed_auth_user(v_email);

  insert into public.businesses (
    id, name, owner, email, phone, whatsapp, address, state, city,
    business_type, hours, maps_link, lat, lng, website,
    status, visible_on_carefind, created_at, plan, referral_code_used
  ) values (
    v_id, v_name, v_owner, v_email,
    nullif(p_business->>'phone', ''), nullif(p_business->>'whatsapp', ''),
    nullif(p_business->>'address', ''), nullif(p_business->>'state', ''), nullif(p_business->>'city', ''),
    coalesce(nullif(p_business->>'business_type', ''), 'skincare'),
    nullif(p_business->>'hours', ''), nullif(p_business->>'maps_link', ''),
    nullif(p_business->>'lat', '')::double precision, nullif(p_business->>'lng', '')::double precision,
    nullif(p_business->>'website', ''),
    'pending', v_visible, now(), 'basic', v_referral
  );
  return v_id;
end $function$;

revoke all on function public.register_business_unconfirmed(jsonb) from public, anon, authenticated;
grant execute on function public.register_business_unconfirmed(jsonb) to service_role;

-- 3. A business cannot leave `pending` (other than to `suspended` or `revoked`, the only non-activating statuses
-- businesses_status_check allows) while its owner has not confirmed the address. Both the old and the new email are
-- checked so a status change made together with an email change cannot slip past the gate.
-- Enforced here because approval is a direct PATCH from the admin client; a UI filter would be bypassable.
-- A business whose owner has no auth user (legacy rows) is not blocked.
create or replace function public.guard_business_owner_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.status = 'pending' and new.status is distinct from old.status and new.status not in ('suspended', 'revoked') then
    if exists (select 1 from auth.users u
                where lower(u.email) in (lower(old.email), lower(new.email)) and u.email_confirmed_at is null) then
      raise exception 'The owner has not verified their email address yet.';
    end if;
  end if;
  return new;
end $function$;

revoke all on function public.guard_business_owner_email_confirmed() from public, anon, authenticated;

drop trigger if exists businesses_require_verified_owner on public.businesses;
create trigger businesses_require_verified_owner
  before update of status on public.businesses
  for each row execute function public.guard_business_owner_email_confirmed();

-- 4. owner_setup needs a catalog row: email_outbox has a foreign key on (app, event_key). Sender, rollout and flags
-- are copied from staff_welcome, which is the same kind of message (a recovery link to set a password).
-- The payload schema keys are the keys sendAuthEmail ACTUALLY enqueues (fullName, businessName, setupLink), not the
-- snake_case keys on the staff_welcome row: spike S2 showed the outbox accepts the camelCase staff_welcome payload at
-- insert, and whether the dispatcher validates against payload_schema at send time is unproven, so the schema is
-- written to match what is really sent.
insert into public.email_event_catalog
  (app, event_key, template_key, subject_template, from_email, reply_to, payload_schema,
   enabled, required_for_business, category, rollout_mode)
select app, 'owner_setup', 'owner_setup', 'CareHub: verify your email and set your password', from_email, reply_to,
       jsonb_build_object(
         'type', 'object',
         'required', jsonb_build_array('fullName', 'businessName', 'setupLink'),
         'properties', jsonb_build_object(
           'fullName',     jsonb_build_object('type', 'string', 'maxLength', 120),
           'businessName', jsonb_build_object('type', 'string', 'maxLength', 160),
           'setupLink',    jsonb_build_object('type', 'string', 'format', 'uri', 'pattern', '^https://carefindhub\.com/', 'maxLength', 2048)),
         'additionalProperties', false),
       enabled, required_for_business, 'auth', rollout_mode
  from public.email_event_catalog
 where app = 'carehub' and event_key = 'staff_welcome'
on conflict (app, event_key) do nothing;

-- 5. Which businesses are waiting on their owner's verification, for the admin console. SECURITY DEFINER because
-- auth.users is not readable by the client; the caller must pass the shared public.is_platform_admin() guard.
create or replace function public.admin_unverified_owner_business_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised';
  end if;
  return query
    select b.id from public.businesses b
     where b.status = 'pending'
       and exists (select 1 from auth.users u where lower(u.email) = lower(b.email) and u.email_confirmed_at is null);
end $function$;

revoke all on function public.admin_unverified_owner_business_ids() from public, anon;
grant execute on function public.admin_unverified_owner_business_ids() to authenticated, service_role;
```

> The admin RPC guards with the shared `public.is_platform_admin()`, the same rule the other admin RPCs use.

`supabase/migrations/carehub_20261030_revoke_register_business.sql`:

```sql
-- Cutover. Apply ONLY after the frontend that calls /api/register-business is live: until then the previous
-- frontend registers through this RPC. After this, the only registration path is the server handler, which calls
-- register_business_unconfirmed with the service role. Kept (not dropped) so a rollback is a single GRANT.
revoke all on function public.register_business(jsonb, text) from public, anon, authenticated;
grant execute on function public.register_business(jsonb, text) to service_role;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/carefind && npx vitest run src/test/payments/ownerEmailVerification.db.test.js`
Expected: PASS (12 tests). If the `register_business` stub is missing, the cutover test fails at `revoke`: the stub is created in `beforeAll`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/carehub_20261029_owner_email_verification.sql supabase/migrations/carehub_20261030_revoke_register_business.sql apps/carefind/src/test/payments/ownerEmailVerification.db.test.js
git commit -m "feat(db): unconfirmed owner registration, verified-owner approval guard, owner_setup catalog row"
```

---

### Task 2: `owner_setup` email template

**Files:**
- Modify: `packages/shared-email/src/templates/CareHub/index.js` (SUBJECTS at line 10, add function after `staffWelcome` at line 110)
- Modify: `packages/shared-email/src/templates/Transactional/index.js` (re-export list)
- Modify: `packages/shared-email/src/templates/index.js` (`HUB_TEMPLATE_MAP`)
- Modify: `packages/shared-email/src/templates/samples.js`
- Test: `packages/shared-email/src/__tests__/carehubTemplates.test.js`

**Interfaces:**
- Produces: `ownerSetup({ fullName, businessName, setupLink }) => string (html)` and the registry key `owner_setup`.

- [ ] **Step 1: Write the failing test**

In `carehubTemplates.test.js` add `'owner_setup'` to `TEMPLATE_KEYS` and this entry to `PAYLOADS`:

```js
  owner_setup: { fullName: 'Ada Eze', businessName: 'Lifeline Pharmacy', setupLink: 'https://carefindhub.com/reset-password?welcome=1&code=abc' },
```

and a dedicated test at the end of the file:

```js
describe('owner_setup', () => {
  it('names the business, links the action, and says no password is chosen until the link is used', () => {
    const html = getTemplate('owner_setup', 'carehub')({ fullName: 'Ada Eze', businessName: 'Lifeline Pharmacy', setupLink: 'https://carefindhub.com/reset-password?welcome=1&code=abc' })
    expect(html).toContain('Lifeline Pharmacy')
    expect(html).toContain('https://carefindhub.com/reset-password?welcome=1&amp;code=abc')
    expect(htmlToText(html)).toMatch(/choose a password/i)
  })

  it('escapes the business name', () => {
    const html = getTemplate('owner_setup', 'carehub')({ fullName: 'A', businessName: '<img src=x onerror=alert(1)>', setupLink: 'https://carefindhub.com/x' })
    expect(html).not.toContain('<img src=x')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/shared-email && npx vitest run src/__tests__/carehubTemplates.test.js`
Expected: FAIL (`owner_setup` is not in the registry).

- [ ] **Step 3: Implement**

In `templates/CareHub/index.js`, add to `SUBJECTS`: `owner_setup: 'CareHub: verify your email and set your password',` and after `staffWelcome`:

```js
export function ownerSetup({ fullName, businessName, setupLink } = {}) {
  return email({
    title: 'Verify your email and choose a password',
    preheader: 'One step to finish creating your CareHub account.',
    body: [
      paragraph(html`${hi(fullName)} thanks for registering <strong>${businessName || 'your business'}</strong> on CareHub.`),
      paragraph('Confirm that this is your email address and choose a password. Your application is reviewed once you have done this.'),
      smallPrint(IGNORE),
    ],
    cta: { href: setupLink, label: 'Verify email and choose a password' },
  })
}
```

In `templates/Transactional/index.js` add `ownerSetup,` to the re-export list. In `templates/index.js` add `ownerSetup: 'owner_setup',` to `HUB_TEMPLATE_MAP`. In `samples.js` add `owner_setup: { fullName: 'Ada Eze', businessName: 'Lifeline Pharmacy', setupLink: 'https://carefindhub.com/reset-password?welcome=1&code=demo' },` next to `staff_welcome` and a catalogue row `{ key: 'owner_setup', label: 'Owner Setup', app: 'CareHub', icon: '✉️', desc: 'Verify the owner email and choose a password after registering.' },`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/shared-email && npx vitest run src/__tests__/carehubTemplates.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-email/src/templates packages/shared-email/src/__tests__/carehubTemplates.test.js
git commit -m "feat(shared-email): owner_setup template"
```

---

### Task 3: `owner_setup` action in `sendAuthEmail`

**Files:**
- Modify: `packages/shared-email/src/authEmail.js` (lines 56, 97, 116, 130-181)
- Test: `packages/shared-email/src/__tests__/authEmail.test.js`
- Test: `apps/carehub/api/__tests__/authEmailHandler.test.js`

**Interfaces:**
- Consumes: template key `owner_setup` (Task 2); catalog row (Task 1).
- Produces: `sendAuthEmail({ action: 'owner_setup', email, fullName, businessName, redirectTo, app, supabase })`. Server-initiated only; the public `/api/auth-email` handler keeps refusing it.

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared-email/src/__tests__/authEmail.test.js`:

```js
describe('sendAuthEmail owner_setup', () => {
  it('mints a recovery link and enqueues owner_setup with the registered business name', async () => {
    generateLink.mockResolvedValue(linkResponse)

    const result = await sendAuthEmail({
      action: 'owner_setup',
      email: 'Ada@Lifeline.test',
      fullName: 'Ada Eze',
      businessName: 'Lifeline Pharmacy',
      redirectTo: 'https://carefindhub.com/reset-password?welcome=1',
      app: 'carehub',
    })

    expect(result).toEqual({ ok: true, sent: true })
    expect(generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: 'ada@lifeline.test',
      options: { redirectTo: 'https://carefindhub.com/reset-password?welcome=1' },
    })
    const row = enqueue.mock.calls[0][0]
    expect(row.templateKey).toBe('owner_setup')
    expect(row.payload).toMatchObject({ fullName: 'Ada Eze', businessName: 'Lifeline Pharmacy', setupLink: 'https://stub.supabase.co/auth/v1/verify?token=abc' })
    expect(row.subject).toBe('CareHub: verify your email and set your password')
  })

  it('is rate limited per address like the other auth emails', async () => {
    generateLink.mockResolvedValue(linkResponse)
    // isRateLimited reads email_outbox through the admin client; the stub client has no `from`, so the limiter
    // fails open here. Pin only that the limit table knows the action.
    const { RATE_LIMIT_PER_HOUR } = await import('../authEmail.js')
    expect(RATE_LIMIT_PER_HOUR.owner_setup).toBe(5)
  })
})
```

Add to `apps/carehub/api/__tests__/authEmailHandler.test.js`:

```js
describe('owner_setup is not a public action', () => {
  it('is refused by /api/auth-email so only the registration handler can send it', async () => {
    const res = await call({ action: 'owner_setup', email: 'someone@example.com' })
    expect(res.statusCode).toBe(400)
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/shared-email && npx vitest run src/__tests__/authEmail.test.js` and `cd apps/carehub && npx vitest run api/__tests__/authEmailHandler.test.js`
Expected: the first FAILs (`Unsupported auth action: owner_setup`); the handler test already PASSES because the handler whitelists three actions, which pins that behaviour.

- [ ] **Step 3: Implement**

In `packages/shared-email/src/authEmail.js`:

- line 56: `export const RATE_LIMIT_PER_HOUR = { password_reset: 3, email_verification: 5, staff_welcome: 5, owner_setup: 5 }` (export the constant if it is not exported; keep the name).
- line 116: `const allowed = ['password_reset', 'email_verification', 'customer_registration', 'staff_setup', 'owner_setup']`
- line 130: `if (action === 'password_reset' || action === 'email_verification' || action === 'staff_setup' || action === 'owner_setup') {`
- line 132: `const templateKey = action === 'password_reset' ? 'password_reset' : action === 'staff_setup' ? 'staff_welcome' : action === 'owner_setup' ? 'owner_setup' : 'email_verification'`
- line 141: `const type = action === 'email_verification' ? 'signup' : 'recovery'` stays (owner_setup is `recovery`).
- display name (line 159): `const displayName = (action === 'staff_setup' || action === 'owner_setup' ? resolved || cleanName(fullName) : resolved || accountName) || toEmail.split('@')[0]`
- payload (line 163): add `: action === 'owner_setup' ? { fullName: displayName, businessName: cleanName(businessName), setupLink: actionLink }` before the final `: { fullName: displayName, verifyLink: actionLink }`.
- subject (line 176): add `: action === 'owner_setup' ? 'CareHub: verify your email and set your password'` before the `staff_setup` branch's else.
- comment above `action:` (line 97): add `'owner_setup'`; document that it is server-initiated and trusts `fullName`/`businessName` like `staff_setup`.

> The `rateLimit` for `owner_setup` keys on `templateKey` (`owner_setup`), which is why `RATE_LIMIT_PER_HOUR` gets its own entry; `isRateLimited` must look the key up by `templateKey`: confirm with `grep -n "RATE_LIMIT_PER_HOUR\[" packages/shared-email/src/authEmail.js` and adjust the key name if it indexes by action.

- [ ] **Step 4: Run to verify they pass**

Run: both commands from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-email/src/authEmail.js packages/shared-email/src/__tests__/authEmail.test.js apps/carehub/api/__tests__/authEmailHandler.test.js
git commit -m "feat(shared-email): owner_setup auth action (server-initiated recovery link)"
```

---

### Task 4: `POST /api/register-business` handler

**Files:**
- Create: `apps/carehub/api/_handlers/register-business.js`
- Modify: `apps/carehub/api/router.js` (import near line 27; map entry near line 86)
- Test: `apps/carehub/api/__tests__/registerBusiness.test.js`

**Interfaces:**
- Consumes: RPC `register_business_unconfirmed(p_business jsonb) -> uuid` (Task 1); `sendAuthEmail({ action: 'owner_setup', ... })` (Task 3).
- Produces: `POST /api/register-business` accepting `{ name, owner, email, phone?, whatsapp?, address?, state?, city?, business_type?, hours?, maps_link?, lat?, lng?, website?, visible_on_carefind?, referral_code_used? }` and answering `200 { ok: true }` or `400 { error: string }`.

- [ ] **Step 1: Write the failing test**

```js
const h = vi.hoisted(() => ({ rpc: vi.fn(), sendAuthEmail: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: (...a) => h.rpc(...a) }) }))
vi.mock('@care-ecosystem/shared-email', () => ({ sendAuthEmail: (...a) => h.sendAuthEmail(...a) }))

import handler from '../_handlers/register-business.js'

const call = async (body, method = 'POST') => {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  await handler({ method, headers: {}, body }, res)
  return res
}
const valid = { name: 'Lifeline Pharmacy', owner: 'Ada Eze', email: 'Ada@Lifeline.test', state: 'Lagos' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('CAREHUB_APP_URL', 'https://carefindhub.com')
  h.rpc.mockResolvedValue({ data: 'biz-1', error: null })
  h.sendAuthEmail.mockResolvedValue({ ok: true, sent: true })
})

describe('POST /api/register-business', () => {
  it('rejects non-POST', async () => {
    expect((await call(valid, 'GET')).statusCode).toBe(405)
  })

  it('validates before touching the database', async () => {
    expect((await call({ ...valid, email: 'nope' })).statusCode).toBe(400)
    expect((await call({ ...valid, name: '' })).statusCode).toBe(400)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('registers, lowercases the email, never forwards a password, and sends owner_setup', async () => {
    const res = await call({ ...valid, password: 'hunter2', is_platform_admin: true, status: 'approved' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const [fn, args] = h.rpc.mock.calls[0]
    expect(fn).toBe('register_business_unconfirmed')
    expect(args.p_business.email).toBe('ada@lifeline.test')
    // Only whitelisted business columns reach the database: a caller cannot set status or admin flags.
    expect(Object.keys(args.p_business).sort()).toEqual(['email', 'name', 'owner', 'state'])
    expect(JSON.stringify(args)).not.toContain('hunter2')
    expect(h.sendAuthEmail).toHaveBeenCalledWith(expect.objectContaining({
      action: 'owner_setup', email: 'ada@lifeline.test', fullName: 'Ada Eze', businessName: 'Lifeline Pharmacy',
      redirectTo: 'https://carefindhub.com/reset-password?welcome=1', app: 'carehub',
    }))
  })

  it('passes readable RPC validation errors through, but hides unexpected database errors', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'An account with this email already exists. Please sign in instead.' } })
    let res = await call(valid)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/already exists/)

    h.rpc.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'relation "auth.users" does not exist' } })
    res = await call(valid)
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toBe('Registration failed. Please try again.')
    expect(JSON.stringify(res.body)).not.toContain('auth.users')
  })

  it('still succeeds when the setup email cannot be sent', async () => {
    h.sendAuthEmail.mockRejectedValueOnce(new Error('smtp down'))
    const res = await call(valid)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/carehub && npx vitest run api/__tests__/registerBusiness.test.js`
Expected: FAIL (`Failed to resolve import "../_handlers/register-business.js"`).

- [ ] **Step 3: Implement**

`apps/carehub/api/_handlers/register-business.js`:

```js
// POST /api/register-business
// The only way to register a CareHub business. The database function that does the work is service-role only, so
// this handler is the enforcement point: the owner's account is created UNCONFIRMED and they must open the emailed
// link (which also lets them choose a password) before they can sign in or be reviewed.
//
// Only the columns in BUSINESS_FIELDS are forwarded, so a caller cannot set status, plan or admin flags. No password
// is accepted: one is never typed before ownership of the address is proven.

import { createClient } from '@supabase/supabase-js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BUSINESS_FIELDS = [
  'name', 'owner', 'email', 'phone', 'whatsapp', 'address', 'state', 'city', 'business_type', 'hours',
  'maps_link', 'lat', 'lng', 'website', 'visible_on_carefind', 'referral_code_used',
]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const body = req.body || {}
  const business = {}
  for (const key of BUSINESS_FIELDS) if (body[key] !== undefined && body[key] !== null) business[key] = body[key]

  const email = String(business.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required.' })
  if (!String(business.name || '').trim()) return res.status(400).json({ error: 'Business name is required.' })
  if (!String(business.owner || '').trim()) return res.status(400).json({ error: 'Owner name is required.' })
  business.email = email

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { error } = await supabase.rpc('register_business_unconfirmed', { p_business: business })
  if (error) {
    // `raise exception` in the function (P0001) carries a message written for the owner. Anything else is an
    // internal failure and must not leak table or function names.
    if (error.code === 'P0001') return res.status(400).json({ error: error.message })
    console.error('[register-business] rpc failed:', error.code)
    return res.status(500).json({ error: 'Registration failed. Please try again.' })
  }

  // Best effort: registration has succeeded. If the email cannot be sent, the owner recovers through
  // "Forgot password", which sends the same kind of link and also confirms the address.
  try {
    const { sendAuthEmail } = await import('@care-ecosystem/shared-email')
    const base = process.env.CAREHUB_APP_URL || process.env.APP_URL || ''
    await sendAuthEmail({
      action: 'owner_setup',
      email,
      fullName: String(business.owner).trim(),
      businessName: String(business.name).trim(),
      redirectTo: `${base}/reset-password?welcome=1`,
      app: 'carehub',
      supabase,
    })
  } catch (err) {
    console.error('[register-business] setup email failed:', err?.message)
  }

  return res.status(200).json({ ok: true })
}
```

In `apps/carehub/api/router.js` add `import registerBusinessHandler from './_handlers/register-business.js'` next to the other handler imports and `'register-business': registerBusinessHandler,` in the handler map.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/carehub && npx vitest run api/__tests__/registerBusiness.test.js api/__tests__/router.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/carehub/api/_handlers/register-business.js apps/carehub/api/router.js apps/carehub/api/__tests__/registerBusiness.test.js
git commit -m "feat(carehub): server-side business registration with unconfirmed owner"
```

---

### Task 5: Registration wizard without a password

**Files:**
- Modify: `apps/carehub/src/services/supabase.js:162-169`
- Modify: `apps/carehub/src/pages/auth/Register.jsx` (lines 41-48, 55-63, 228-260, done screen near 107-130)
- Test: `apps/carehub/src/pages/auth/__tests__/Register.test.jsx` (create if absent; mirror `LinkExpired.test.jsx` in the same directory for render helpers)

**Interfaces:**
- Consumes: `POST /api/register-business` (Task 4).
- Produces: `registerBusiness(data) -> Promise<{ ok: true }>`; throws `Error(message)` with the server's readable message.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerBusiness } from '../../../services/supabase'

describe('registerBusiness', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('posts to the server handler and never sends a password', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    await registerBusiness({ name: 'Lifeline', owner: 'Ada', email: 'ada@x.test', password: 'hunter2' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/register-business')
    expect(init.method).toBe('POST')
    expect(init.body).not.toContain('hunter2')
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Lifeline', email: 'ada@x.test' })
  })

  it('surfaces the server message when registration is refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'An account with this email already exists. Please sign in instead.' }) })
    await expect(registerBusiness({ name: 'L', owner: 'A', email: 'a@x.test' })).rejects.toThrow(/already exists/)
  })

  it('reports a network failure readably', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(registerBusiness({ name: 'L', owner: 'A', email: 'a@x.test' })).rejects.toThrow(/connection/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/carehub && npx vitest run src/pages/auth/__tests__/Register.test.jsx`
Expected: FAIL (still calls `rpc/register_business` through `sbFetch`).

- [ ] **Step 3: Implement**

Replace `registerBusiness` in `services/supabase.js`:

```js
export async function registerBusiness(data) {
  // The password field is dropped on purpose: the owner chooses it after verifying their email.
  const { password, confirmPassword, ...business } = data
  let res
  try {
    res = await fetch('/api/register-business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(business),
    })
  } catch {
    throw new Error('Connection error. Check your internet and try again.')
  }
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload.error || 'Registration failed. Please try again.')
  return { ok: true }
}
```

In `Register.jsx`:
- `STEPS` becomes `['Business Info', 'Contact & Location', 'Owner Info', 'Terms', 'Review']` and the step-4 validator becomes `if (step === 4) return data.agreedTerms`.
- Remove the `password: data.password,` line from the `registerBusiness({...})` call.
- Replace the step-4 body (lines 228-260): delete the "Create Your Password" heading, the two `CInp type='password'` fields and the match indicator; keep the terms checkbox and its text. Add one line of explanatory copy above it: `We will email you a link to confirm your address and choose your password.`
- Replace the done screen paragraph (near 107-130) with: `Thank you <strong>{data.firstName}</strong>! Check <strong>{data.ownerEmail}</strong> for an email from CareHub: open the link to verify your address and choose your password. Your business <strong>{data.businessName}</strong> is reviewed after that. If it does not arrive in a few minutes, check spam, or use "Forgot password" on the sign-in page to get a new link.`
- Delete the now-dead `fetch('/api/notify-registration', ...)` block only if `registrationOwner` is also sent by the handler; **it is not**, so leave it untouched.

- [ ] **Step 4: Run to verify it passes, then check responsiveness**

Run: `cd apps/carehub && npx vitest run src/pages/auth/__tests__/Register.test.jsx && npm run lint`
Expected: PASS, 0 lint errors. Manually load `/register` at 375, 768 and 1280px and walk all steps (the step count is now still 5).

- [ ] **Step 5: Commit**

```bash
git add apps/carehub/src/services/supabase.js apps/carehub/src/pages/auth/Register.jsx apps/carehub/src/pages/auth/__tests__/Register.test.jsx
git commit -m "feat(carehub): register without a password; verification email sets it"
```

---

### Task 6: Set-password welcome variant and unconfirmed sign-in

**Files:**
- Modify: `apps/carehub/src/pages/auth/ResetPassword.jsx` (copy and heading only; logic unchanged)
- Modify: `apps/carehub/src/pages/auth/Login.jsx:32-37`
- Test: `apps/carehub/src/pages/auth/__tests__/ResetPassword.welcome.test.jsx`, `apps/carehub/src/pages/auth/__tests__/Login.unconfirmed.test.jsx`

**Interfaces:**
- Consumes: Supabase `signInWithPassword` error `code === 'email_not_confirmed'`; `POST /api/auth-email { action: 'password_reset', email }` for resend.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

`Login.unconfirmed.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ signIn: vi.fn() }))
vi.mock('../../../lib/authClient', () => ({ authClient: { auth: { signInWithPassword: (...a) => h.signIn(...a) } } }))
vi.mock('../../../services/supabase', () => ({ resolveAccountByEmail: vi.fn() }))

import Login from '../Login.jsx'

const renderLogin = () => render(<MemoryRouter><Login /></MemoryRouter>)

beforeEach(() => {
  vi.restoreAllMocks()
  h.signIn.mockResolvedValue({ data: { session: null }, error: { code: 'email_not_confirmed', message: 'Email not confirmed' } })
})

describe('sign-in with an unverified email', () => {
  it('explains verification instead of claiming the password is wrong, and offers a resend', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    renderLogin()
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'ada@x.test' } })
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'whatever1' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await screen.findByText(/verify your email/i)
    expect(screen.queryByText(/incorrect email or password/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /send a new link/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth-email')
    expect(JSON.parse(init.body)).toMatchObject({ action: 'password_reset', email: 'ada@x.test' })
    await screen.findByText(/new link is on its way/i)
  })
})
```

`ResetPassword.welcome.test.jsx` asserts the heading and copy switch on `?welcome=1`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/authClient', () => ({
  authClient: { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    exchangeCodeForSession: async () => ({ error: null }),
    updateUser: vi.fn(), signOut: vi.fn(),
  } },
}))

import ResetPassword from '../ResetPassword.jsx'

describe('ResetPassword', () => {
  it('shows the welcome copy for a new owner', async () => {
    render(<MemoryRouter initialEntries={['/reset-password?welcome=1']}><ResetPassword /></MemoryRouter>)
    expect(await screen.findByText(/email verified/i)).toBeTruthy()
    expect(screen.getByText(/choose a password/i)).toBeTruthy()
  })

  it('keeps the reset copy otherwise', async () => {
    render(<MemoryRouter initialEntries={['/reset-password']}><ResetPassword /></MemoryRouter>)
    await screen.findByText(/new password/i)
    expect(screen.queryByText(/email verified/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/carehub && npx vitest run src/pages/auth/__tests__/Login.unconfirmed.test.jsx src/pages/auth/__tests__/ResetPassword.welcome.test.jsx`
Expected: FAIL (no unconfirmed state; no welcome copy).

- [ ] **Step 3: Implement**

`Login.jsx`: add `const [unverified, setUnverified] = useState(false)` and `const [resent, setResent] = useState(false)`. Replace lines 32-37 with:

```jsx
      const { data, error } = await authClient.auth.signInWithPassword({ email: normalizedEmail, password: pass })
      if (error?.code === 'email_not_confirmed') {
        setUnverified(true)
        setLoading(false)
        return
      }
      if (!data?.session || error) {
        setErr('Incorrect email or password. Please try again.')
        setLoading(false)
        return
      }
```

Update the comment above it (lines 28-31) to state that owners now arrive unconfirmed and must verify, and that legacy accounts were backfilled. Add the resend handler and the state block rendered when `unverified`:

```jsx
  const resendLink = async () => {
    try {
      await fetch('/api/auth-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'password_reset', email: email.toLowerCase() }),
      })
    } catch { /* the response is generic either way */ }
    setResent(true)
  }
```

```jsx
      {unverified && (
        <div role="alert" style={{ marginBottom: 16, padding: 14, borderRadius: theme.radius.lg, background: theme.tealMist, fontSize: 13, lineHeight: 1.6 }}>
          <strong>Verify your email to continue.</strong> We sent a link to {email}. Open it to confirm your address and choose a password.
          {resent
            ? <div style={{ marginTop: 8 }}>A new link is on its way. Check spam if it does not arrive.</div>
            : <button type="button" onClick={resendLink} style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', padding: 0, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer' }}>Send a new link</button>}
        </div>
      )}
```

`ResetPassword.jsx`: read `const welcome = new URLSearchParams(window.location.search).get('welcome') === '1'` once at the top of the component; when `welcome` is true, the form heading is `Email verified` with the line `Choose a password to finish creating your account.`, the submit label is `Save password`, and the success message is `Password saved. Taking you to sign in…`. Do not change the session or `updateUser` logic. The expired state keeps its existing copy and `Link to="/forgot-password"`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/carehub && npx vitest run src/pages/auth/__tests__ && npm run lint`
Expected: PASS. Manually check both pages at 375/768/1280px.

- [ ] **Step 5: Commit**

```bash
git add apps/carehub/src/pages/auth/Login.jsx apps/carehub/src/pages/auth/ResetPassword.jsx apps/carehub/src/pages/auth/__tests__
git commit -m "feat(carehub): welcome set-password page and unverified sign-in state"
```

---

### Task 7: Admin sees which pending businesses await verification

**Files:**
- Modify: `apps/carehub/src/services/supabase.js` (add after `getBusinesses`, line 152)
- Modify: `apps/carehub/src/pages/admin/AdminDashboard.jsx` (pending list near 103 and 162; bulk approve near 461)
- Test: `apps/carehub/src/services/__tests__/unverifiedOwners.test.js`

**Interfaces:**
- Consumes: RPC `admin_unverified_owner_business_ids() -> setof uuid` (Task 1).
- Produces: `getUnverifiedOwnerBusinessIds() -> Promise<string[]>`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] }))
vi.stubGlobal('fetch', vi.fn(async (url, init) => {
  h.calls.push([url, init])
  return { ok: true, status: 200, text: async () => JSON.stringify(['biz-1', 'biz-2']), json: async () => ['biz-1', 'biz-2'] }
}))

import { getUnverifiedOwnerBusinessIds } from '../supabase'

beforeEach(() => { h.calls.length = 0 })

describe('getUnverifiedOwnerBusinessIds', () => {
  it('calls the admin RPC and returns the ids', async () => {
    const ids = await getUnverifiedOwnerBusinessIds()
    expect(h.calls[0][0]).toContain('rpc/admin_unverified_owner_business_ids')
    expect(ids).toEqual(['biz-1', 'biz-2'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/carehub && npx vitest run src/services/__tests__/unverifiedOwners.test.js`
Expected: FAIL (`getUnverifiedOwnerBusinessIds` is not exported).

- [ ] **Step 3: Implement**

```js
// Pending businesses whose owner has not confirmed their email. Approval of these is refused by the database
// (businesses_require_verified_owner); this lets the console say so up front instead of failing on click.
export async function getUnverifiedOwnerBusinessIds() {
  const rows = await sbFetch('rpc/admin_unverified_owner_business_ids', { method: 'POST', body: '{}' })
  return Array.isArray(rows) ? rows.map((r) => (typeof r === 'string' ? r : Object.values(r)[0])) : []
}
```

In `AdminDashboard.jsx`: load the ids once with the businesses (`useEffect` next to the `getAgentApplications` call at line 203), store in `unverifiedIds` (a `Set`), and:
- in the pending list (line 103 and 162) render a small `Awaiting email verification` badge, and exclude those rows from "Suggested next: Approve ...";
- in `bulkApprove` (near line 461) split the selection: approve only ids not in `unverifiedIds`, and show a toast naming how many were skipped (`Skipped N: owner has not verified their email`). A database refusal for any row must be caught per row and counted as skipped, not thrown.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/carehub && npx vitest run src/services/__tests__/unverifiedOwners.test.js && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/carehub/src/services/supabase.js apps/carehub/src/pages/admin/AdminDashboard.jsx apps/carehub/src/services/__tests__/unverifiedOwners.test.js
git commit -m "feat(carehub-admin): mark pending businesses awaiting owner email verification"
```

---

### Task 8: CareFind - resend control and no-session-before-confirmation test

**Files:**
- Modify: `apps/carefind/src/modules/account/Login.jsx` (the `confirmationSent` state)
- Test: `apps/carefind/src/modules/account/__tests__/Login.confirmation.test.jsx`

**Interfaces:**
- Consumes: `POST /api/auth-email { action: 'email_verification', email, redirectTo }` (existing, rate limited and enumeration-safe).

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ signUp: vi.fn() }))
vi.mock('../../../providers/AuthContext', () => ({
  useAuth: () => ({ signUp: (...a) => h.signUp(...a), signIn: vi.fn() }),
}))
vi.mock('../../../config/supabaseClient', () => ({ supabase: { rpc: vi.fn(), auth: {} } }))

import Login from '../Login.jsx'

beforeEach(() => {
  vi.restoreAllMocks()
  h.signUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null })
})

describe('CareFind signup before confirmation', () => {
  it('shows the inbox state, not the app, when Supabase returns no session', async () => {
    render(<MemoryRouter initialEntries={['/signup']}><Login initialMode="signup" /></MemoryRouter>)
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'tola@x.test' } })
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'secret12' } })
    fireEvent.click(screen.getByRole('button', { name: /create account|sign up/i }))
    expect(await screen.findByText(/check your inbox|check your email/i)).toBeTruthy()
  })

  it('resends the verification link through the rate-limited endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    render(<MemoryRouter initialEntries={['/signup']}><Login initialMode="signup" /></MemoryRouter>)
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'tola@x.test' } })
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'secret12' } })
    fireEvent.click(screen.getByRole('button', { name: /create account|sign up/i }))
    await screen.findByText(/check your inbox|check your email/i)
    fireEvent.click(screen.getByRole('button', { name: /resend/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: 'email_verification', email: 'tola@x.test' })
  })
})
```

> If `Login` does not accept `initialMode`, read how `isSignUp` is derived at the top of `Login.jsx` (the route or a toggle) and drive the test the same way; keep the assertions.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/carefind && npx vitest run src/modules/account/__tests__/Login.confirmation.test.jsx`
Expected: the first test passes (existing behaviour, now pinned); the second FAILs (no resend button).

- [ ] **Step 3: Implement**

In `Login.jsx` where `confirmationSent` is rendered, add a resend button with its own `resent` state:

```jsx
  const resendVerification = async () => {
    try {
      await fetch('/api/auth-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'email_verification', email, redirectTo: `${window.location.origin}/verify-email` }),
      })
    } catch { /* generic response either way */ }
    setResent(true)
  }
```

Render `<button type="button" onClick={resendVerification}>Resend verification email</button>` beneath the "check your inbox" copy, replaced by `A new link is on its way.` once `resent` is true. Disable it for 60 seconds after a click to avoid hammering the endpoint.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/carefind && npx vitest run src/modules/account/__tests__/Login.confirmation.test.jsx && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/src/modules/account/Login.jsx apps/carefind/src/modules/account/__tests__/Login.confirmation.test.jsx
git commit -m "feat(carefind): resend verification email from the signup confirmation state"
```

---

### Task 9: Documentation, rollout and verification

**Files:**
- Create: `docs/architecture/Owner-Email-Verification.md`
- Modify: `docs/architecture/Expired-Auth-Links.md` (add `owner_setup` and the `/reset-password?welcome=1` landing)
- Modify: `docs/superpowers/specs/2026-10-10-email-verification-signup-design.md` (status: implemented; add the three planning findings: catalog FK, deliberate prior "mint confirmed" decision in `Login.jsx`, approval as direct PATCH)

- [ ] **Step 1: Write the documentation**

`Owner-Email-Verification.md` covers: the flow (registration, link, set password, sign-in, review); the database objects and their grants; the trigger and what it refuses; the two migrations and why they are separate; the grandfathered owners; the resend path (`password_reset`); troubleshooting ("owner never received the email", "approval refused").

- [ ] **Step 2: Rollout order (each line is a gate)**

1. Merge the PR containing Tasks 1-8 only when the user says so (`main` deploys).
2. **Before deploy:** apply `carehub_20261029_owner_email_verification` with `apply_migration`. Then verify:
   - `select proname, proacl from pg_proc where proname in ('mint_unconfirmed_auth_user','register_business_unconfirmed','guard_business_owner_email_confirmed')` shows `postgres | service_role` only; if `anon` or `authenticated` appears, apply `revoke ... from anon, authenticated` as a follow-up migration.
   - `select count(*), array_agg(oid::regprocedure) from pg_proc where proname = 'register_business_unconfirmed'` returns 1 signature.
   - `select event_key from email_event_catalog where app='carehub' and event_key='owner_setup'` returns one row.
   - security advisors before/after: no new findings.
3. Add `https://carefindhub.com/reset-password` to Supabase Auth, URL Configuration, Redirect URLs (S1 shows whether the `?welcome=1` URL is honoured or falls back to the Site URL).
4. Deploy; run the manual check below on production with a real inbox.
5. **Only then** apply `carehub_20261030_revoke_register_business`, and re-read `proacl` for `register_business`.
6. Confirm in Supabase dashboard that CareFind has "Confirm email" enabled.

- [ ] **Step 3: Manual verification (375, 768, 1280px)**

- Register a new business with a real inbox: done screen copy; email arrives; link opens "Email verified"; set password; redirected to sign-in; sign in; sees pending-review state.
- Sign in before clicking: sees "Verify your email" and resend; resend delivers a new link and the old link no longer works (each minted link invalidates the previous one).
- Open the link a second time and an expired link: lands on `LinkExpired`.
- Admin console: the new business shows "Awaiting email verification" and bulk approve skips it with a count; approve works after the owner verifies.
- Call `rpc/register_business` directly with the anon key after step 5: expect `401/403` (permission denied).

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/Owner-Email-Verification.md docs/architecture/Expired-Auth-Links.md docs/superpowers/specs/2026-10-10-email-verification-signup-design.md
git commit -m "docs: owner email verification flow, rollout order and runbook"
```

---

## Self-Review

**Spec coverage:** section 3 flow (Tasks 4, 5, 6, 3), section 4 gating (Tasks 1 trigger, 6 login, 7 admin), section 5 database (Task 1), section 6 CareFind (Task 8), section 7 security (handler whitelist and error masking in Task 4, public action refusal in Task 3, grants in Task 1), section 8 grandfathering (no task by design; documented in Task 9), section 9 spike (Task 0), section 10 tests (every task), section 11 delivery (Task 9 rollout order).

**Deviations from the spec, all deliberate:**
- The spec said "per-IP rate limit"; there is no existing IP limiter in CareHub's handlers and registration was already unauthenticated, so this plan keeps per-address limits only (parity with today). Flagged for the user.
- The spec put the admin gate in "an admin RPC"; planning found approval is a direct PATCH, so enforcement is a trigger and the RPC is display-only.
- The single migration became two so the old frontend keeps working until cutover.

**Placeholder scan:** the two "confirm with grep / read live definition" notes (Task 1 admin guard, Task 3 rate-limit key) are explicit verification steps with the command to run and the fallback code already written, not deferred work.

**Type consistency:** `register_business_unconfirmed(p_business jsonb) -> uuid`, `mint_unconfirmed_auth_user(p_email text) -> uuid`, `admin_unverified_owner_business_ids() -> setof uuid`, action `owner_setup`, template key `owner_setup`, handler `register-business`, client `registerBusiness(data)`, `getUnverifiedOwnerBusinessIds()` are used identically across tasks.
