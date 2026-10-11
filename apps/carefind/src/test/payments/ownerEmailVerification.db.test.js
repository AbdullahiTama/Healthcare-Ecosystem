// @vitest-environment node
// Owner email verification: registration creates an UNCONFIRMED owner plus a pending business atomically, only the
// service role can call it, the old RPC is revoked at cutover, and no business can ENTER `active` (from any status)
// while its owner is unconfirmed.
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
    await expect(register({ email: 'ada@lifeline.test' })).rejects.toThrow(/use "Forgot password" if you have not set a password yet/)
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

  // The invariant is about the DESTINATION: no business may ENTER `active` while its owner is unconfirmed, whatever
  // status it comes from. Parking an unverified registration in suspended/revoked must not be a path to activation.
  const statusOf = async (id) => (await db.query('select status from public.businesses where id = $1', [id])).rows[0].status
  const setStatus = (id, status) => db.query('update public.businesses set status = $2 where id = $1', [id, status])

  it('blocks suspended -> active and revoked -> active while the owner is unconfirmed, and allows both once confirmed', async () => {
    const sus = (await register({ email: 'sus@lifeline.test', name: 'Suspended Clinic' })).rows[0].id
    const rev = (await register({ email: 'rev@lifeline.test', name: 'Revoked Clinic Two' })).rows[0].id
    await setStatus(sus, 'suspended')
    await setStatus(rev, 'revoked')

    await expect(setStatus(sus, 'active')).rejects.toThrow(/not verified/i)
    await expect(setStatus(rev, 'active')).rejects.toThrow(/not verified/i)
    expect(await statusOf(sus)).toBe('suspended')
    expect(await statusOf(rev)).toBe('revoked')

    await db.query(`update auth.users set email_confirmed_at = now() where email in ('sus@lifeline.test', 'rev@lifeline.test')`)
    await setStatus(sus, 'active')
    await setStatus(rev, 'active')
    expect(await statusOf(sus)).toBe('active')
    expect(await statusOf(rev)).toBe('active')
  })

  it('still allows pending -> suspended and pending -> revoked, and blocks pending -> active, while unconfirmed', async () => {
    const a = (await register({ email: 'dispose1@lifeline.test', name: 'Dispose One' })).rows[0].id
    const b = (await register({ email: 'dispose2@lifeline.test', name: 'Dispose Two' })).rows[0].id
    const c = (await register({ email: 'dispose3@lifeline.test', name: 'Dispose Three' })).rows[0].id
    await setStatus(a, 'suspended')
    await setStatus(b, 'revoked')
    await expect(setStatus(c, 'active')).rejects.toThrow(/not verified/i)
    expect([await statusOf(a), await statusOf(b), await statusOf(c)]).toEqual(['suspended', 'revoked', 'pending'])
    // Dispose of it so the admin listing test below sees only the pending rows it expects.
    await setStatus(c, 'revoked')
  })

  it('does not block a no-op active -> active update even if the owner is (now) unconfirmed', async () => {
    const id = (await register({ email: 'noop@lifeline.test', name: 'Noop Clinic' })).rows[0].id
    await db.query(`update auth.users set email_confirmed_at = now() where email = 'noop@lifeline.test'`)
    await setStatus(id, 'active')
    await db.query(`update auth.users set email_confirmed_at = null where email = 'noop@lifeline.test'`)
    await setStatus(id, 'active')
    expect(await statusOf(id)).toBe('active')
  })

  it('lets a legacy business with no auth user activate from suspended', async () => {
    await db.query(`insert into public.businesses (id, name, email, status) values (gen_random_uuid(), 'Legacy Two', 'legacy2@x.test', 'suspended')`)
    await db.query(`update public.businesses set status = 'active' where email = 'legacy2@x.test'`)
    expect((await db.query(`select status from public.businesses where email = 'legacy2@x.test'`)).rows[0].status).toBe('active')
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
