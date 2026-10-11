// @vitest-environment node
// supabase/migrations/carehub_20261031_businesses_insert_guard.sql followed by its corrective follow-up
// carehub_20261101_businesses_insert_guard_expiry_default.sql, on real Postgres (PGlite), run as the real roles
// under real RLS.
//
// !! THE REPLICA MUST CARRY THE LIVE COLUMN DEFAULTS of every column the guard reads. Column defaults are applied
// !! BEFORE row triggers, so a default the replica lacks hides behaviour: the first migration passed here and then
// !! refused every live branch insert, because live plan_expires_at defaults to now() + 30 days and the replica had no
// !! default. The "replica defaults" test pins them. Re-read information_schema.columns on live (the runbook's
// !! pre-apply defaults diff) and update both the schema and that test if they change. The point is behaviour: what a signed-in caller can and cannot create in public.businesses.
//
// The schema below is a minimal replica of production as read (read-only) on 2026-10-11: the columns the guards touch,
// the UNIQUE email key, the status check, the "own business row" FOR ALL policy, is_platform_admin(), the table grants,
// and the REAL C18 UPDATE guard (carehub_20260805_guard_business_privileged_columns.sql, which already carries the
// ::text-cast fix; there is no separate follow-up file in the repo). Two pieces are modelled rather than copied, and
// neither changes an outcome here:
//   * "authenticated view own business" (SELECT) is not in the repo; it is modelled as own-email SELECT. "own business
//     row" already grants the same SELECT, so the guard's parent lookup does not depend on it.
//   * resolve_referring_agent / apply_referring_agent() is stubbed. Instead of a no-op the stub stamps a fixed agent id
//     when a referral code is supplied, so the suite also proves the trigger ORDER: the guard fires first and rejects a
//     caller-supplied agent id, then the referral trigger sets one legitimately and the guard does not see it.
//
// Branch note: businesses_email_key is case-SENSITIVE while RLS and the guard compare lower(email). Locations.jsx
// reuses the parent's exact email, which the key rejects (the known, out-of-scope production finding), so allowed-branch
// cases use a case variant of the owner's own email. Each allowed branch uses its OWN seeded owner, because a second row
// with the same lower(email) makes is_platform_admin() raise 21000 for that owner (see the self-contained case below).
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const MIGRATION = 'carehub_20261031_businesses_insert_guard'
const FOLLOW_UP = 'carehub_20261101_businesses_insert_guard_expiry_default'
const UPDATE_GUARD = 'carehub_20260805_guard_business_privileged_columns'

const STUB_AGENT = '00000000-0000-4000-8000-0000000a6e17'
const id = (suffix) => `00000000-0000-4000-8000-0000000000${suffix}`
const ALPHA = id('a1'), BRAVO = id('b1'), CHARLIE = id('c1'), DELTA = id('d1'), ECHO = id('e1'), FOXTROT = id('f1')
const HOTEL = id('71'), INDIA = id('72'), JULIET = id('73')
const PARENT_EXPIRY = '2027-03-01T00:00:00.000Z' // every seeded parent's expiry, except India's (null)

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
    plan_expires_at timestamptz default (now() + '30 days'::interval),  -- LIVE default
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

  -- Seed (as the superuser): a platform admin, owners with ACTIVE parents, one owner with a PENDING parent.
  insert into public.businesses (id, name, email, status, plan, is_platform_admin, plan_expires_at) values
    ('${id('ad')}', 'Admin HQ', 'admin@carehub.test',   'active',  'enterprise', true,  '${PARENT_EXPIRY}'),
    ('${ALPHA}',    'Alpha',    'alpha@carehub.test',   'active',  'growth',     false, '${PARENT_EXPIRY}'),
    ('${BRAVO}',    'Bravo',    'bravo@carehub.test',   'active',  'basic',      false, '${PARENT_EXPIRY}'),
    ('${CHARLIE}',  'Charlie',  'charlie@carehub.test', 'pending', 'growth',     false, '${PARENT_EXPIRY}'),
    ('${DELTA}',    'Delta',    'delta@carehub.test',   'active',  'basic',      false, '${PARENT_EXPIRY}'),
    ('${ECHO}',     'Echo',     'echo@carehub.test',    'active',  'basic',      false, '${PARENT_EXPIRY}'),
    ('${FOXTROT}',  'Foxtrot',  'foxtrot@carehub.test', 'active',  'basic',      false, '${PARENT_EXPIRY}'),
    ('${HOTEL}',    'Hotel',    'hotel@carehub.test',   'active',  'growth',     false, '${PARENT_EXPIRY}'),
    ('${INDIA}',    'India',    'india@carehub.test',   'active',  'basic',      false, null),
    ('${JULIET}',   'Juliet',   'juliet@carehub.test',  'active',  'basic',      false, '${PARENT_EXPIRY}');
`

// migrate: true loads BOTH migrations in production order; 'first-only' reproduces the live state between them.
const setup = async ({ migrate, updateGuard = true }) => {
  const d = new PGlite()
  await d.exec(LIVE)
  if (updateGuard) await d.exec(M(UPDATE_GUARD))
  if (migrate) await d.exec(M(MIGRATION))
  if (migrate === true) await d.exec(M(FOLLOW_UP))
  return d
}

let db
// Runs fn as `role` with auth.email() = email, and ALWAYS resets the role, including on failure.
const as = async (role, email, fn, onDb = db) => {
  await onDb.query(`select set_config('test.email', $1, false)`, [email || ''])
  await onDb.exec(`set role ${role}`)
  try { return await fn() } finally { await onDb.exec('reset role'); await onDb.query(`select set_config('test.email', '', false)`) }
}

const COLS = ['id', 'name', 'owner', 'email', 'status', 'plan', 'plan_expires_at', 'parent_business_id', 'is_platform_admin', 'referring_agent_id', 'referral_code_used']
const insert = (row, onDb = db, suffix = '') => {
  const cols = COLS.filter((c) => c in row)
  return onDb.query(
    `insert into public.businesses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ${suffix}`,
    cols.map((c) => row[c]),
  )
}
// 'inserted' | 'guard' (42501 from a trigger) | 'rls' | 'permission' | 'error: ...'
const outcome = async (promise) => {
  try { await promise; return 'inserted' } catch (e) {
    if (/row-level security/i.test(e.message)) return 'rls'
    if (/permission denied/i.test(e.message)) return 'permission'
    if (e.code === '42501') return 'guard'
    return `error: ${e.code} ${e.message}`
  }
}
const failure = (promise) => promise.then(() => null, (e) => e)
const rowsFor = async (email) => (await db.query(`select * from public.businesses where lower(email) = lower($1)`, [email])).rows
const rowById = async (bid) => (await db.query(`select * from public.businesses where id = $1`, [bid])).rows[0]
const branchesOf = async (pid) => (await db.query(`select status, plan, is_platform_admin, referral_code_used, referring_agent_id from public.businesses where parent_business_id = $1`, [pid])).rows
const triggers = async (onDb = db) => (await onDb.query(`select tgname from pg_trigger where tgrelid = 'public.businesses'::regclass and not tgisinternal order by tgname`)).rows.map((r) => r.tgname)

const root = (email, extra = {}) => ({ name: 'Mine', owner: 'Me', email, ...extra })
const branchOf = (parentId, email, extra = {}) => ({ name: 'Branch', owner: 'Me', email, parent_business_id: parentId, status: 'active', ...extra })
const ROOT_MSG = /created through registration, not by direct insert/

let before
beforeAll(async () => {
  // The hole, measured on a database WITHOUT the migration (but WITH the UPDATE guard), so the suite proves the
  // migration changed something real.
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
    expect(await as('authenticated', 'mallory@carefind.test',
      () => outcome(insert(root('mallory@carefind.test', { is_platform_admin: true }))))).toBe('guard')
    expect(await as('authenticated', 'mallory@carefind.test',
      async () => (await db.query('select public.is_platform_admin() as a')).rows[0].a)).toBe(false)
  })

  it('names the field class in the error and never echoes the value', async () => {
    const err = await as('authenticated', 'bravo@carehub.test',
      () => failure(insert(branchOf(BRAVO, 'Bravo@carehub.test', { referring_agent_id: '00000000-0000-4000-8000-00000000ba0d' }))))
    expect(err.code).toBe('42501')
    expect(err.message).toMatch(/referring_agent_id/)
    expect(err.message).not.toMatch(/ba0d/)
  })

  it('replica defaults match live for the guarded columns (see header)', async () => {
    const rows = (await db.query(`select column_name, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'businesses'
        and column_name in ('status', 'plan', 'plan_expires_at', 'is_platform_admin', 'parent_business_id', 'referring_agent_id')
      order by column_name`)).rows
    expect(rows).toEqual([
      { column_name: 'is_platform_admin', column_default: 'false' },
      { column_name: 'parent_business_id', column_default: null },
      { column_name: 'plan', column_default: "'basic'::text" },
      { column_name: 'plan_expires_at', column_default: "(now() + '30 days'::interval)" },
      { column_name: 'referring_agent_id', column_default: null },
      { column_name: 'status', column_default: "'pending'::text" },
    ])
  })

  it('rejects EVERY direct root insert by an ordinary signed-in user, including the old registration shape', async () => {
    const shapes = [
      { status: 'pending', plan: 'basic' },
      {},                                   // column defaults (pending / basic)
      { status: 'active' },
      { status: 'suspended' },
      { status: null },                     // explicit null status
      { is_platform_admin: null },          // explicit null flag
      { plan: 'enterprise' },
      { referral_code_used: 'AGENT1' },
    ]
    for (const extra of shapes) {
      const err = await as('authenticated', 'dana@carehub.test', () => failure(insert(root('dana@carehub.test', extra))))
      expect(err?.code, JSON.stringify(extra)).toBe('42501')
      expect(err.message, JSON.stringify(extra)).toMatch(ROOT_MSG)
    }
    // the same, for an existing owner adding a second root row under a case variant of their own email
    const err = await as('authenticated', 'bravo@carehub.test', () => failure(insert(root('Bravo@carehub.test'))))
    expect(err?.code).toBe('42501')
    expect(await rowsFor('dana@carehub.test')).toEqual([])
    expect((await rowsFor('bravo@carehub.test')).length).toBe(1)
  })

  it('rejects a caller-supplied referring_agent_id, even the "right" one', async () => {
    expect(await as('authenticated', 'bravo@carehub.test',
      () => outcome(insert(branchOf(BRAVO, 'Bravo@carehub.test', { plan: 'basic', referring_agent_id: '00000000-0000-4000-8000-00000000ba0d' }))))).toBe('guard')
    expect(await as('authenticated', 'bravo@carehub.test',
      () => outcome(insert(branchOf(BRAVO, 'Bravo@carehub.test', { plan: 'basic', referring_agent_id: STUB_AGENT, referral_code_used: 'AGENT1' }))))).toBe('guard')
    expect(await branchesOf(BRAVO)).toEqual([])
  })

  it('the guard fires before resolve_referring_agent (BEFORE triggers run in name order)', async () => {
    expect(await triggers()).toEqual(['a_guard_business_insert', 'guard_business_privileged_columns', 'resolve_referring_agent'])
  })

  describe('branches', () => {
    it('owner of an ACTIVE parent can add an active branch on the parent\'s plan', async () => {
      expect(await as('authenticated', 'alpha@carehub.test',
        () => outcome(insert(branchOf(ALPHA, 'Alpha@carehub.test', { plan: 'growth' }))))).toBe('inserted')
      expect(await branchesOf(ALPHA)).toEqual([{ status: 'active', plan: 'growth', is_platform_admin: false, referral_code_used: null, referring_agent_id: null }])
    })

    it('a pending branch with plan omitted is allowed when the column default equals the parent\'s plan', async () => {
      expect(await as('authenticated', 'delta@carehub.test',
        () => outcome(insert(branchOf(DELTA, 'Delta@carehub.test', { status: 'pending' }))))).toBe('inserted')
      expect((await branchesOf(DELTA))[0]).toMatchObject({ status: 'pending', plan: 'basic' })
    })

    it('a branch with only a referral code is allowed, and the agent id is resolved server-side after the guard', async () => {
      expect(await as('authenticated', 'echo@carehub.test',
        () => outcome(insert(branchOf(ECHO, 'Echo@carehub.test', { referral_code_used: 'AGENT1' }))))).toBe('inserted')
      expect((await branchesOf(ECHO))[0]).toMatchObject({ referral_code_used: 'AGENT1', referring_agent_id: STUB_AGENT })
    })

    it('an explicit is_platform_admin = null branch is allowed and harmless (stored null, is_platform_admin() is false)', async () => {
      expect(await as('authenticated', 'foxtrot@carehub.test',
        () => outcome(insert(branchOf(FOXTROT, 'Foxtrot@carehub.test', { is_platform_admin: null }))))).toBe('inserted')
      expect((await branchesOf(FOXTROT))[0].is_platform_admin).toBe(null)
      // The null row grants nothing. (Foxtrot now has two rows, so call it as a third party: the admin flag of a
      // null row is coalesced to false by the definition, proven on a fresh single-row owner below.)
      const d = await setup({ migrate: true })
      await d.exec(`insert into public.businesses (name, email, status, plan, is_platform_admin) values ('Null', 'null@carehub.test', 'active', 'basic', null)`)
      expect(await as('authenticated', 'null@carehub.test', async () => (await d.query('select public.is_platform_admin() as a')).rows[0].a, d)).toBe(false)
      await d.close()
    }, 180_000)

    it('rejects an explicit status = null branch', async () => {
      expect(await as('authenticated', 'bravo@carehub.test',
        () => outcome(insert(branchOf(BRAVO, 'Bravo@carehub.test', { status: null }))))).toBe('guard')
    })

    it('rejects a branch of ANOTHER user\'s parent', async () => {
      expect(await as('authenticated', 'mallory@carefind.test',
        () => outcome(insert(branchOf(BRAVO, 'mallory@carefind.test', { plan: 'basic' }))))).toBe('guard')
      expect(await as('authenticated', 'mallory@carefind.test',
        () => outcome(insert(branchOf(BRAVO, 'Mallory@carefind.test'))))).toBe('guard')
      expect(await branchesOf(BRAVO)).toEqual([])
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
      for (const [pid, extra] of [
        ['00000000-0000-4000-8000-00000000dead', {}],
        [BRAVO, { status: 'suspended' }],
        [BRAVO, { is_platform_admin: true }],
      ]) {
        expect(await as('authenticated', 'bravo@carehub.test',
          () => outcome(insert(branchOf(pid, 'Bravo@carehub.test', extra)))), JSON.stringify(extra)).toBe('guard')
      }
      expect(await branchesOf(BRAVO)).toEqual([])
    })
  })

  describe('branch plan_expires_at is always the parent\'s (corrective follow-up)', () => {
    const expiryOf = async (pid) => (await db.query(`select plan_expires_at from public.businesses where parent_business_id = $1`, [pid])).rows.map((r) => r.plan_expires_at && r.plan_expires_at.toISOString())

    it('a legitimate branch with NO expiry supplied succeeds and stores the PARENT\'s expiry, not the now()+30d default', async () => {
      expect(await as('authenticated', 'hotel@carehub.test',
        () => outcome(insert(branchOf(HOTEL, 'Hotel@carehub.test', { plan: 'growth' }))))).toBe('inserted')
      expect(await expiryOf(HOTEL)).toEqual([PARENT_EXPIRY])
    })

    it('a branch supplying a far-future plan_expires_at succeeds but is stored with the parent\'s expiry (overwritten)', async () => {
      expect(await as('authenticated', 'juliet@carehub.test',
        () => outcome(insert(branchOf(JULIET, 'Juliet@carehub.test', { plan_expires_at: '2099-01-01T00:00:00Z' }))))).toBe('inserted')
      expect(await expiryOf(JULIET)).toEqual([PARENT_EXPIRY])
    })

    it('a parent with NO expiry gives its branch none, even when the branch supplies one (cannot extend)', async () => {
      expect(await as('authenticated', 'india@carehub.test',
        () => outcome(insert(branchOf(INDIA, 'India@carehub.test', { plan_expires_at: '2099-01-01T00:00:00Z' }))))).toBe('inserted')
      expect(await expiryOf(INDIA)).toEqual([null])
    })

    it('reproduces the live state between the two migrations: the first alone refuses every branch on plan_expires_at', async () => {
      const d = await setup({ migrate: 'first-only' })
      const err = await as('authenticated', 'hotel@carehub.test',
        () => failure(insert(branchOf(HOTEL, 'Hotel@carehub.test', { plan: 'growth' }), d)), d)
      expect(err?.code).toBe('42501')
      expect(err.message).toMatch(/plan_expires_at/)
      await d.exec(M(FOLLOW_UP))
      expect(await as('authenticated', 'hotel@carehub.test',
        () => outcome(insert(branchOf(HOTEL, 'Hotel@carehub.test', { plan: 'growth' }), d)), d)).toBe('inserted')
      await d.close()
    }, 180_000)
  })

  // An upsert has two guarded paths. Each describe below states which one it proves.
  describe('upsert, path 1: the INSERT guard rejects an escalating PROPOSED row before any conflict handling', () => {
    it('a proposed root row carrying is_platform_admin = true is rejected by the INSERT guard; row unchanged', async () => {
      const beforeRow = await rowById(BRAVO)
      const err = await as('authenticated', 'bravo@carehub.test', () => failure(insert(
        { id: BRAVO, name: 'Bravo', email: 'bravo@carehub.test', status: 'active', is_platform_admin: true }, db,
        'on conflict (id) do update set status = excluded.status, is_platform_admin = excluded.is_platform_admin')))
      expect(err?.code).toBe('42501')
      expect(err.message).toMatch(/Only a platform administrator can create a business with platform-admin access/)
      expect(await rowById(BRAVO)).toEqual(beforeRow)
    })

    it('a proposed root row carrying plan = enterprise is rejected by the INSERT guard (root rule); row unchanged', async () => {
      const beforeRow = await rowById(BRAVO)
      const err = await as('authenticated', 'bravo@carehub.test', () => failure(insert(
        { id: BRAVO, name: 'Bravo', email: 'bravo@carehub.test', plan: 'enterprise' }, db,
        'on conflict (id) do update set plan = excluded.plan')))
      expect(err?.code).toBe('42501')
      expect(err.message).toMatch(ROOT_MSG)
      expect(await rowById(BRAVO)).toEqual(beforeRow)
    })
  })

  describe('upsert, path 2: the proposed row PASSES the INSERT guard (a valid branch of the owner\'s own row, same id), so the DO UPDATE runs and the real C18 UPDATE guard rejects it', () => {
    // The proposed row is a valid branch of Bravo, so a_guard_business_insert lets it through. It conflicts on id
    // with Bravo's own row, and the DO UPDATE then tries to change a privileged column. A proposed branch must carry
    // is_platform_admin false/null and the parent's plan, so excluded.* cannot escalate those two; the DO UPDATE
    // sets them literally. For status, the proposed branch carries 'pending' (Bravo is 'active'), so
    // excluded.status is a real change. The UPDATE guard rejects any change to status, whatever the direction.
    const proposed = (extra = {}) => branchOf(BRAVO, 'Bravo@carehub.test', { id: BRAVO, plan: 'basic', ...extra })
    const UPD = (col) => new RegExp(`Only a platform administrator can change these fields on a business: ${col}$`)

    it('is_platform_admin self-grant on the DO UPDATE path -> UPDATE guard 42501; row unchanged', async () => {
      const beforeRow = await rowById(BRAVO)
      const err = await as('authenticated', 'bravo@carehub.test', () => failure(insert(proposed(), db,
        'on conflict (id) do update set is_platform_admin = true')))
      expect(err?.code).toBe('42501')
      expect(err.message).toMatch(UPD('is_platform_admin'))
      expect(await rowById(BRAVO)).toEqual(beforeRow)
    })

    it('plan escalation on the DO UPDATE path -> UPDATE guard 42501; row unchanged', async () => {
      const beforeRow = await rowById(BRAVO)
      const err = await as('authenticated', 'bravo@carehub.test', () => failure(insert(proposed(), db,
        `on conflict (id) do update set plan = 'enterprise'`)))
      expect(err?.code).toBe('42501')
      expect(err.message).toMatch(UPD('plan'))
      expect(await rowById(BRAVO)).toEqual(beforeRow)
    })

    it('status change via excluded.status on the DO UPDATE path -> UPDATE guard 42501; row unchanged', async () => {
      const beforeRow = await rowById(BRAVO)
      const err = await as('authenticated', 'bravo@carehub.test', () => failure(insert(proposed({ status: 'pending' }), db,
        'on conflict (id) do update set status = excluded.status')))
      expect(err?.code).toBe('42501')
      expect(err.message).toMatch(UPD('status'))
      expect(await rowById(BRAVO)).toEqual(beforeRow)
    })

    it('control: WITHOUT the UPDATE guard the same upserts succeed, so the three cases above depend on it', async () => {
      const d = await setup({ migrate: true, updateGuard: false })
      await as('authenticated', 'bravo@carehub.test', async () => {
        await insert(proposed(), d, 'on conflict (id) do update set is_platform_admin = true')
        await insert(proposed(), d, `on conflict (id) do update set plan = 'enterprise'`)
        await insert(proposed({ status: 'pending' }), d, 'on conflict (id) do update set status = excluded.status')
      }, d)
      expect((await d.query(`select is_platform_admin, plan, status from public.businesses where id = $1`, [BRAVO])).rows[0])
        .toEqual({ is_platform_admin: true, plan: 'enterprise', status: 'pending' })
      await d.close()
    }, 180_000)
  })

  it('a case-variant duplicate (via a BRANCH insert) makes is_platform_admin() raise 21000 for that owner only: self-harm, not escalation', async () => {
    // Self-contained: its own database and its own owner, no dependence on earlier tests.
    const d = await setup({ migrate: true })
    const G = id('90')
    await d.exec(`insert into public.businesses (id, name, email, status, plan) values ('${G}', 'Golf', 'golf@carehub.test', 'active', 'basic')`)
    expect(await as('authenticated', 'golf@carehub.test', () => outcome(insert(branchOf(G, 'GOLF@carehub.test'), d)), d)).toBe('inserted')

    const err = await as('authenticated', 'golf@carehub.test', () => failure(d.query('select public.is_platform_admin()')), d)
    expect(err?.code).toBe('21000')
    // the owner locks themself out of further writes (the guard calls is_platform_admin() too)...
    const again = await as('authenticated', 'golf@carehub.test', () => failure(insert(branchOf(G, 'Golf@carehub.test'), d)), d)
    expect(again?.code).toBe('21000')
    // ...but gains nothing and nobody else is affected
    expect(await as('authenticated', 'admin@carehub.test', async () => (await d.query('select public.is_platform_admin() as a')).rows[0].a, d)).toBe(true)
    expect(await as('authenticated', 'bravo@carehub.test', async () => (await d.query('select public.is_platform_admin() as a')).rows[0].a, d)).toBe(false)
    expect((await d.query(`select count(*)::int as n from public.businesses where lower(email) = 'golf@carehub.test' and is_platform_admin`)).rows[0].n).toBe(0)
    await d.close()
  }, 180_000)

  it('a platform admin can insert anything', async () => {
    expect(await as('authenticated', 'admin@carehub.test',
      () => outcome(insert(root('second-admin@carehub.test', { is_platform_admin: true, status: 'active', plan: 'enterprise', plan_expires_at: '2099-01-01T00:00:00Z' }))))).toBe('inserted')
    expect((await rowsFor('second-admin@carehub.test'))[0]).toMatchObject({ is_platform_admin: true, status: 'active', plan: 'enterprise' })
  })

  it('service_role and a SECURITY DEFINER registration function still insert a pending root business', async () => {
    expect(await as('service_role', '', () => outcome(insert(root('svc@carehub.test', { status: 'pending', plan: 'basic' }))))).toBe('inserted')
    expect(await as('service_role', '', () => outcome(insert(root('svc2@carehub.test', { status: 'active', plan: 'growth', plan_expires_at: '2099-01-01T00:00:00Z' }))))).toBe('inserted')
    // register_business() is anon + authenticated callable; inside it current_user is the owner.
    const viaAnon = await as('anon', '', async () => (await db.query(`select public._register_business_stub('reg-anon@carehub.test') as id`)).rows[0].id)
    const viaAuth = await as('authenticated', 'reg-auth@carehub.test', async () => (await db.query(`select public._register_business_stub('reg-auth@carehub.test') as id`)).rows[0].id)
    expect(viaAnon).toBeTruthy()
    expect(viaAuth).toBeTruthy()
    expect((await rowsFor('reg-anon@carehub.test'))[0]).toMatchObject({ status: 'pending', plan: 'basic', parent_business_id: null })
    expect((await rowsFor('reg-auth@carehub.test'))[0]).toMatchObject({ status: 'pending', plan: 'basic', parent_business_id: null })
  })

  it('anon still cannot insert directly', async () => {
    expect(await as('anon', '', () => outcome(insert(root('anon@carehub.test'))))).toBe('permission')
  })

  it('the guard is not a callable RPC: anon/authenticated/PUBLIC have no EXECUTE, and exactly one signature exists', async () => {
    const sigs = (await db.query(`select p.oid::regprocedure::text as sig, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'guard_business_insert'`)).rows
    expect(sigs).toEqual([{ sig: 'guard_business_insert()', prosecdef: false }])
    for (const role of ['anon', 'authenticated']) {
      expect((await db.query(`select has_function_privilege($1, 'public.guard_business_insert()', 'execute') as x`, [role])).rows[0].x, role).toBe(false)
    }
    const pub = (await db.query(`select coalesce(bool_or(a.grantee = 0), false) as x from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.proname = 'guard_business_insert' and a.privilege_type = 'EXECUTE'`)).rows[0].x
    expect(pub).toBe(false)
  })

  it('UPDATE behaviour is untouched: an owner can rename; a status PATCH is rejected by the UPDATE guard, not this one', async () => {
    const updTriggers = (await db.query(`select tgname from pg_trigger where tgrelid = 'public.businesses'::regclass and not tgisinternal and (tgtype & 16) <> 0`)).rows.map((r) => r.tgname)
    expect(updTriggers).toEqual(['guard_business_privileged_columns'])
    await as('authenticated', 'bravo@carehub.test', () => db.query(`update public.businesses set name = 'Bravo Renamed' where id = $1`, [BRAVO]))
    expect((await rowById(BRAVO)).name).toBe('Bravo Renamed')
    const err = await as('authenticated', 'bravo@carehub.test', () => failure(db.query(`update public.businesses set status = 'suspended' where id = $1`, [BRAVO])))
    expect(err?.code).toBe('42501')
    expect(err.message).toMatch(/Only a platform administrator can change these fields on a business: status/)
    expect((await rowById(BRAVO)).status).toBe('active')
  })

  it('is safe to run twice (both migrations, in order; the follow-up alone is also idempotent)', async () => {
    await db.exec(M(MIGRATION))
    await db.exec(M(FOLLOW_UP))
    await db.exec(M(FOLLOW_UP))
    const src = (await db.query(`select prosrc from pg_proc where proname = 'guard_business_insert'`)).rows[0].prosrc
    expect(src).toMatch(/new\.plan_expires_at := v_parent_expiry/)
    expect(src).not.toMatch(/new\.plan_expires_at is not null/)
    expect(await triggers()).toEqual(['a_guard_business_insert', 'guard_business_privileged_columns', 'resolve_referring_agent'])
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
    expect(await as('authenticated', 'mallory@carefind.test',
      () => outcome(insert(root('mallory@carefind.test', { is_platform_admin: true, status: 'active' }), d)), d)).toBe('inserted')
    await d.close()
  }, 180_000)
})
