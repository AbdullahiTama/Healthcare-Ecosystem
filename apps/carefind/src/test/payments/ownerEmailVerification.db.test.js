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
      referral_code_used text, parent_business_id uuid, is_platform_admin boolean default false);
    create table public.email_event_catalog (app text, event_key text, template_key text, subject_template text,
      from_email text, reply_to text, payload_schema jsonb, enabled boolean, required_for_business boolean,
      category text, rollout_mode text, primary key (app, event_key));
    insert into public.email_event_catalog values ('carehub','staff_welcome','staff_welcome','s','CareHub <s@x>','s@x','{}',false,false,'staff','live');
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
    for (const r of rows) expect(r.n, r.proname).toBe(1)
  })
})

describe('businesses_require_verified_owner', () => {
  it('blocks leaving pending while the owner is unconfirmed, but allows rejection', async () => {
    const { rows } = await register({ email: 'gate@lifeline.test', name: 'Gate Clinic' })
    const id = rows[0].id
    await expect(db.query(`update public.businesses set status = 'approved' where id = $1`, [id])).rejects.toThrow(/not verified/i)
    await db.query(`update public.businesses set status = 'rejected' where id = $1`, [id])
    expect((await db.query('select status from public.businesses where id = $1', [id])).rows[0].status).toBe('rejected')
  })

  it('allows approval once the owner is confirmed, and ignores businesses with no auth user', async () => {
    const { rows } = await register({ email: 'ok@lifeline.test', name: 'Ok Clinic' })
    await db.query(`update auth.users set email_confirmed_at = now() where email = 'ok@lifeline.test'`)
    await db.query(`update public.businesses set status = 'approved' where id = $1`, [rows[0].id])
    expect((await db.query('select status from public.businesses where id = $1', [rows[0].id])).rows[0].status).toBe('approved')

    await db.query(`insert into public.businesses (id, name, email, status) values (gen_random_uuid(), 'Legacy', 'legacy@x.test', 'pending')`)
    await db.query(`update public.businesses set status = 'approved' where email = 'legacy@x.test'`)
    expect((await db.query(`select status from public.businesses where email = 'legacy@x.test'`)).rows[0].status).toBe('approved')
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
