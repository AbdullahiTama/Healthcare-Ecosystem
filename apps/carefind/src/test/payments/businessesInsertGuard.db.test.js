// @vitest-environment node
// supabase/migrations/carehub_20261031_businesses_insert_guard.sql, on real Postgres (PGlite), run as the real roles
// under real RLS. The point is behaviour: what a signed-in caller can and cannot create in public.businesses.
//
// The schema below is a minimal replica of production as read (read-only) on 2026-10-11: the columns the guard touches,
// the UNIQUE email key, the status check, the "own business row" FOR ALL policy, is_platform_admin() and the table
// grants. Two pieces are modelled rather than copied, and neither changes an outcome here:
//   * "authenticated view own business" (SELECT) is not in the repo; it is modelled as own-email SELECT. "own business
//     row" already grants the same SELECT, so the guard's parent lookup does not depend on it.
//   * resolve_referring_agent / apply_referring_agent() is stubbed. Instead of a no-op the stub stamps a fixed agent id
//     when a referral code is supplied, so the suite also proves the trigger ORDER: the guard fires first and rejects a
//     caller-supplied agent id, then the referral trigger sets one legitimately and the guard does not see it.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const MIGRATION = 'carehub_20261031_businesses_insert_guard'

const STUB_AGENT = '00000000-0000-4000-8000-0000000a6e17'

const LIVE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create schema auth;
  create function auth.email() returns text language sql stable as
    $$ select nullif(current_setting('test.email', true), '') $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.email() to anon, authenticated, service_role;

  create table public.businesses (
    id uuid primary key default gen_random_uuid(),
    name text,
    owner text,
    email text,
    status text default 'pending',
    plan text default 'basic',
    plan_expires_at timestamptz,
    parent_business_id uuid references public.businesses(id),
    is_platform_admin boolean default false,
    referring_agent_id uuid,
    referral_code_used text,
    visible_on_carefind boolean default true,
    constraint businesses_email_key unique (email),
    constraint businesses_status_check check (status in ('pending','active','suspended','revoked'))
  );
  -- Production: anon lost INSERT in carehub_20260813_purge_plaintext_password_columns.sql.
  revoke insert on public.businesses from anon;

  create or replace function public.is_platform_admin() returns boolean
    language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email())), false)
    $$;

  alter table public.businesses enable row level security;
  create policy "own business row" on public.businesses for all to authenticated
    using ((lower(email) = lower((select auth.email()))) or is_platform_admin())
    with check ((lower(email) = lower((select auth.email()))) or is_platform_admin());
  create policy "authenticated view own business" on public.businesses for select to authenticated
    using (lower(email) = lower((select auth.email())));

  -- Stub of apply_referring_agent() (see header): sets the agent id from the code, server-side.
  create function public.apply_referring_agent() returns trigger language plpgsql security definer
    set search_path = public as $$
  begin
    if new.referral_code_used is not null then new.referring_agent_id := '${STUB_AGENT}'; else new.referring_agent_id := null; end if;
    return new;
  end $$;
  create trigger resolve_referring_agent before insert on public.businesses
    for each row execute function public.apply_referring_agent();

  -- Simulates register_business(): SECURITY DEFINER, owned by the superuser, inserts a pending business.
  create function public._register_business_stub(p_email text) returns uuid language plpgsql security definer
    set search_path = public as $$
  declare v_id uuid;
  begin
    insert into public.businesses (name, owner, email, status, plan) values ('Reg', 'Reg Owner', p_email, 'pending', 'basic')
      returning id into v_id;
    return v_id;
  end $$;

  -- Seed (as the superuser): a platform admin, two owners with ACTIVE parents, one owner with a PENDING parent.
  insert into public.businesses (id, name, email, status, plan, is_platform_admin) values
    ('00000000-0000-4000-8000-0000000000ad', 'Admin HQ', 'admin@carehub.test', 'active', 'enterprise', true),
    ('00000000-0000-4000-8000-0000000000a1', 'Alpha',    'alpha@carehub.test', 'active', 'growth',     false),
    ('00000000-0000-4000-8000-0000000000b1', 'Bravo',    'bravo@carehub.test', 'active', 'basic',      false),
    ('00000000-0000-4000-8000-0000000000c1', 'Charlie',  'charlie@carehub.test', 'pending', 'growth',   false),
    ('00000000-0000-4000-8000-0000000000d1', 'Delta',    'delta@carehub.test', 'active', 'basic',      false);
`
const ALPHA = '00000000-0000-4000-8000-0000000000a1'
const BRAVO = '00000000-0000-4000-8000-0000000000b1'
const CHARLIE = '00000000-0000-4000-8000-0000000000c1'
const DELTA = '00000000-0000-4000-8000-0000000000d1'

const setup = async ({ migrate }) => {
  const d = new PGlite()
  await d.exec(LIVE)
  if (migrate) await d.exec(M(MIGRATION))
  return d
}

let db
// Runs fn as `role` with auth.email() = email, and ALWAYS resets the role, including on failure.
const as = async (role, email, fn, onDb = db) => {
  await onDb.query(`select set_config('test.email', $1, false)`, [email || ''])
  await onDb.exec(`set role ${role}`)
  try { return await fn() } finally { await onDb.exec('reset role'); await onDb.query(`select set_config('test.email', '', false)`) }
}

const COLS = ['name', 'owner', 'email', 'status', 'plan', 'plan_expires_at', 'parent_business_id', 'is_platform_admin', 'referring_agent_id', 'referral_code_used']
const insert = (row, onDb = db) => {
  const cols = COLS.filter((c) => c in row)
  return onDb.query(
    `insert into public.businesses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    cols.map((c) => row[c]),
  )
}
// 'inserted' | 'guard' (42501 from the trigger) | 'rls' | 'permission' | 'error: ...'
const outcome = async (promise) => {
  try { await promise; return 'inserted' } catch (e) {
    if (/row-level security/i.test(e.message)) return 'rls'
    if (/permission denied/i.test(e.message)) return 'permission'
    if (e.code === '42501') return 'guard'
    return `error: ${e.code} ${e.message}`
  }
}
const rowsFor = async (email) => (await db.query(`select * from public.businesses where lower(email) = lower($1)`, [email])).rows

const root = (email, extra = {}) => ({ name: 'Mine', owner: 'Me', email, ...extra })
const branchOf = (parentId, email, extra = {}) => ({ name: 'Branch', owner: 'Me', email, parent_business_id: parentId, status: 'active', ...extra })

let before
beforeAll(async () => {
  // The hole, measured on a database WITHOUT the migration, so the suite proves the migration changed something real.
  const raw = await setup({ migrate: false })
  before = {
    escalation: await as('authenticated', 'mallory@carefind.test',
      () => outcome(insert(root('mallory@carefind.test', { is_platform_admin: true, status: 'active' }), raw)), raw),
  }
  before.adminAfter = await as('authenticated', 'mallory@carefind.test',
    async () => (await raw.query('select public.is_platform_admin() as a')).rows[0].a, raw)
  await raw.close()

  db = await setup({ migrate: true })
}, 180_000)

describe('businesses BEFORE INSERT guard', () => {
  it('(before) any signed-in user could insert their own row as an active platform admin', () => {
    expect(before.escalation).toBe('inserted')
    expect(before.adminAfter).toBe(true)
  })

  it('rejects the escalation: no business row, is_platform_admin = true, status active -> 42501, nothing written', async () => {
    const r = await as('authenticated', 'mallory@carefind.test',
      () => outcome(insert(root('mallory@carefind.test', { is_platform_admin: true, status: 'active' }))))
    expect(r).toBe('guard')
    expect(await rowsFor('mallory@carefind.test')).toEqual([])
    // is_platform_admin = true alone (pending shape otherwise) is also refused
    expect(await as('authenticated', 'mallory@carefind.test',
      () => outcome(insert(root('mallory@carefind.test', { is_platform_admin: true }))))).toBe('guard')
    expect(await as('authenticated', 'mallory@carefind.test',
      async () => (await db.query('select public.is_platform_admin() as a')).rows[0].a)).toBe(false)
  })

  it('names the field class in the error and never echoes the value', async () => {
    const err = await as('authenticated', 'mallory@carefind.test',
      () => insert(root('mallory@carefind.test', { plan_expires_at: '2099-01-01T00:00:00Z' })).then(() => null, (e) => e))
    expect(err.code).toBe('42501')
    expect(err.message).toMatch(/plan_expires_at/)
    expect(err.message).not.toMatch(/2099/)
  })

  it('root business: status must be pending; the pending/basic registration shape is allowed', async () => {
    expect(await as('authenticated', 'dana@carehub.test',
      () => outcome(insert(root('dana@carehub.test', { status: 'active' }))))).toBe('guard')
    expect(await as('authenticated', 'dana@carehub.test',
      () => outcome(insert(root('dana@carehub.test', { status: 'suspended' }))))).toBe('guard')
    expect(await rowsFor('dana@carehub.test')).toEqual([])

    expect(await as('authenticated', 'dana@carehub.test',
      () => outcome(insert(root('dana@carehub.test', { status: 'pending', plan: 'basic' }))))).toBe('inserted')
    const [row] = await rowsFor('dana@carehub.test')
    expect(row).toMatchObject({ status: 'pending', plan: 'basic', is_platform_admin: false, plan_expires_at: null, referring_agent_id: null })
  })

  it('root business: omitting status/plan takes the column defaults and is allowed', async () => {
    expect(await as('authenticated', 'erin@carehub.test',
      () => outcome(insert(root('erin@carehub.test'))))).toBe('inserted')
    expect((await rowsFor('erin@carehub.test'))[0]).toMatchObject({ status: 'pending', plan: 'basic' })
  })

  it('root business: a paid plan or a plan expiry is rejected', async () => {
    for (const extra of [{ plan: 'enterprise' }, { plan: 'growth' }, { plan_expires_at: '2099-01-01T00:00:00Z' }]) {
      expect(await as('authenticated', 'fay@carehub.test',
        () => outcome(insert(root('fay@carehub.test', extra)))), JSON.stringify(extra)).toBe('guard')
    }
    expect(await rowsFor('fay@carehub.test')).toEqual([])
  })

  it('a caller-supplied referring_agent_id is rejected; a referral code alone is allowed and resolved server-side', async () => {
    expect(await as('authenticated', 'gus@carehub.test',
      () => outcome(insert(root('gus@carehub.test', { referring_agent_id: '00000000-0000-4000-8000-00000000ba0d' }))))).toBe('guard')
    // even the "right" id, supplied by the caller, is refused
    expect(await as('authenticated', 'gus@carehub.test',
      () => outcome(insert(root('gus@carehub.test', { referring_agent_id: STUB_AGENT, referral_code_used: 'AGENT1' }))))).toBe('guard')
    expect(await rowsFor('gus@carehub.test')).toEqual([])

    expect(await as('authenticated', 'gus@carehub.test',
      () => outcome(insert(root('gus@carehub.test', { referral_code_used: 'AGENT1' }))))).toBe('inserted')
    expect((await rowsFor('gus@carehub.test'))[0]).toMatchObject({ referral_code_used: 'AGENT1', referring_agent_id: STUB_AGENT })
  })

  it('the guard fires before resolve_referring_agent (BEFORE triggers run in name order)', async () => {
    const names = (await db.query(`select tgname from pg_trigger where tgrelid = 'public.businesses'::regclass and not tgisinternal order by tgname`)).rows.map((r) => r.tgname)
    expect(names).toEqual(['a_guard_business_insert', 'resolve_referring_agent'])
  })

  describe('branches', () => {
    // businesses_email_key is a case-SENSITIVE unique key, while RLS and the guard compare lower(email). Locations.jsx
    // reuses the parent's exact email, which the unique key rejects (the known, out-of-scope production finding), so the
    // allowed-branch cases use a case variant of the owner's own email: it satisfies RLS and the unique key and leaves
    // the guard's logic as the only thing under test. Rejected cases are rejected by the guard before the key is checked.
    // One allowed branch per owner: a second row with the same lower(email) makes is_platform_admin()'s scalar subquery
    // return two rows (SQLSTATE 21000) for that owner. See the "duplicate owner rows" case below.
    it('owner of an ACTIVE parent can add an active branch on the parent\'s plan', async () => {
      expect(await as('authenticated', 'alpha@carehub.test',
        () => outcome(insert(branchOf(ALPHA, 'Alpha@carehub.test', { plan: 'growth' }))))).toBe('inserted')
      const branches = (await db.query(`select status, plan from public.businesses where parent_business_id = $1`, [ALPHA])).rows
      expect(branches).toEqual([{ status: 'active', plan: 'growth' }])
    })

    it('a pending branch with plan omitted is allowed when the column default equals the parent\'s plan', async () => {
      expect(await as('authenticated', 'delta@carehub.test',
        () => outcome(insert(branchOf(DELTA, 'Delta@carehub.test', { status: 'pending' }))))).toBe('inserted')
      expect((await db.query(`select status, plan from public.businesses where parent_business_id = $1`, [DELTA])).rows)
        .toEqual([{ status: 'pending', plan: 'basic' }])
    })

    it('documents a pre-existing hazard: once an owner has two rows, is_platform_admin() errors for them (21000)', async () => {
      // Not introduced by the guard (every RLS policy that ORs is_platform_admin() fails the same way); it is why
      // branch creation needs the follow-up described in docs/architecture/Businesses-Insert-Guard.md.
      const err = await as('authenticated', 'alpha@carehub.test',
        () => db.query('select public.is_platform_admin()').then(() => null, (e) => e))
      expect(err?.code).toBe('21000')
    })

    it('rejects a branch of ANOTHER user\'s parent', async () => {
      expect(await as('authenticated', 'mallory@carefind.test',
        () => outcome(insert(branchOf(BRAVO, 'mallory@carefind.test', { plan: 'basic' }))))).toBe('guard')
      // with a different-cased email so the unique key cannot be what stops it
      expect(await as('authenticated', 'mallory@carefind.test',
        () => outcome(insert(branchOf(BRAVO, 'Mallory@carefind.test'))))).toBe('guard')
      expect((await db.query(`select count(*)::int as n from public.businesses where parent_business_id = $1`, [BRAVO])).rows[0].n).toBe(0)
    })

    it('rejects a branch of a non-active parent', async () => {
      expect(await as('authenticated', 'charlie@carehub.test',
        () => outcome(insert(branchOf(CHARLIE, 'Charlie@carehub.test', { plan: 'growth' }))))).toBe('guard')
    })

    it('rejects a branch whose plan differs from the parent\'s', async () => {
      expect(await as('authenticated', 'bravo@carehub.test',
        () => outcome(insert(branchOf(BRAVO, 'Bravo@carehub.test', { plan: 'enterprise' }))))).toBe('guard')
    })

    it('rejects a branch with a non-existent parent, a suspended status, or privileged columns', async () => {
      expect(await as('authenticated', 'bravo@carehub.test',
        () => outcome(insert(branchOf('00000000-0000-4000-8000-00000000dead', 'Bravo@carehub.test'))))).toBe('guard')
      expect(await as('authenticated', 'bravo@carehub.test',
        () => outcome(insert(branchOf(BRAVO, 'Bravo@carehub.test', { status: 'suspended' }))))).toBe('guard')
      expect(await as('authenticated', 'bravo@carehub.test',
        () => outcome(insert(branchOf(BRAVO, 'Bravo@carehub.test', { is_platform_admin: true }))))).toBe('guard')
      expect(await as('authenticated', 'bravo@carehub.test',
        () => outcome(insert(branchOf(BRAVO, 'Bravo@carehub.test', { plan_expires_at: '2099-01-01T00:00:00Z' }))))).toBe('guard')
      expect((await db.query(`select count(*)::int as n from public.businesses where parent_business_id = $1`, [BRAVO])).rows[0].n).toBe(0)
    })
  })

  it('a platform admin can insert anything', async () => {
    expect(await as('authenticated', 'admin@carehub.test',
      () => outcome(insert(root('second-admin@carehub.test', { is_platform_admin: true, status: 'active', plan: 'enterprise', plan_expires_at: '2099-01-01T00:00:00Z' }))))).toBe('inserted')
    expect((await rowsFor('second-admin@carehub.test'))[0]).toMatchObject({ is_platform_admin: true, status: 'active', plan: 'enterprise' })
  })

  it('service_role and a SECURITY DEFINER registration function are unaffected', async () => {
    expect(await as('service_role', '', () => outcome(insert(root('svc@carehub.test', { status: 'active', plan: 'growth', plan_expires_at: '2099-01-01T00:00:00Z' }))))).toBe('inserted')
    // register_business() is anon + authenticated callable; inside it current_user is the owner.
    const viaAnon = await as('anon', '', async () => (await db.query(`select public._register_business_stub('reg-anon@carehub.test') as id`)).rows[0].id)
    const viaAuth = await as('authenticated', 'reg-auth@carehub.test', async () => (await db.query(`select public._register_business_stub('reg-auth@carehub.test') as id`)).rows[0].id)
    expect(viaAnon).toBeTruthy()
    expect(viaAuth).toBeTruthy()
    expect((await rowsFor('reg-anon@carehub.test'))[0]).toMatchObject({ status: 'pending', plan: 'basic' })
  })

  it('anon still cannot insert directly', async () => {
    expect(await as('anon', '', () => outcome(insert(root('anon@carehub.test'))))).toBe('permission')
  })

  it('the guard is not a callable RPC: anon/authenticated have no EXECUTE, and exactly one signature exists', async () => {
    const sigs = (await db.query(`select p.oid::regprocedure::text as sig, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'guard_business_insert'`)).rows
    expect(sigs).toEqual([{ sig: 'guard_business_insert()', prosecdef: false }])
    for (const role of ['anon', 'authenticated', 'public']) {
      const r = role === 'public'
        ? (await db.query(`select coalesce(bool_or(a.grantee = 0), false) as x from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.proname = 'guard_business_insert' and a.privilege_type = 'EXECUTE'`)).rows[0].x
        : (await db.query(`select has_function_privilege($1, 'public.guard_business_insert()', 'execute') as x`, [role])).rows[0].x
      expect(r, role).toBe(false)
    }
  })

  it('UPDATE behaviour is untouched (no UPDATE trigger added; an owner can still update their own row)', async () => {
    const updTriggers = (await db.query(`select tgname from pg_trigger where tgrelid = 'public.businesses'::regclass and not tgisinternal and (tgtype & 16) <> 0`)).rows
    expect(updTriggers).toEqual([])
    await as('authenticated', 'bravo@carehub.test', () => db.query(`update public.businesses set name = 'Bravo Renamed' where id = $1`, [BRAVO]))
    expect((await db.query(`select name from public.businesses where id = $1`, [BRAVO])).rows[0].name).toBe('Bravo Renamed')
  })

  it('is safe to run twice', async () => {
    await db.exec(M(MIGRATION))
    const names = (await db.query(`select tgname from pg_trigger where tgrelid = 'public.businesses'::regclass and not tgisinternal order by tgname`)).rows.map((r) => r.tgname)
    expect(names).toEqual(['a_guard_business_insert', 'resolve_referring_agent'])
    expect((await db.query(`select count(*)::int as n from pg_proc where proname = 'guard_business_insert'`)).rows[0].n).toBe(1)
    expect(await as('authenticated', 'mallory@carefind.test',
      () => outcome(insert(root('mallory@carefind.test', { is_platform_admin: true, status: 'active' }))))).toBe('guard')
    expect((await db.query(`select has_function_privilege('authenticated', 'public.guard_business_insert()', 'execute') as x`)).rows[0].x).toBe(false)
  })
})

describe('why the migration does not revoke column INSERT privileges', () => {
  it('a column-level REVOKE is a no-op while authenticated holds table-level INSERT (so the trigger is the control)', async () => {
    const d = await setup({ migrate: false })
    await d.exec(`revoke insert (is_platform_admin, plan_expires_at, referring_agent_id) on public.businesses from authenticated`)
    const priv = (await d.query(`select has_column_privilege('authenticated', 'public.businesses', 'is_platform_admin', 'INSERT') as x`)).rows[0].x
    expect(priv).toBe(true)
    // and the escalation still goes through on the un-guarded table
    expect(await as('authenticated', 'mallory@carefind.test',
      () => outcome(insert(root('mallory@carefind.test', { is_platform_admin: true, status: 'active' }), d)), d)).toBe('inserted')
    await d.close()
  }, 180_000)
})
