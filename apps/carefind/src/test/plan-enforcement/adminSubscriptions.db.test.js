// @vitest-environment node
// Administrative subscription management (carehub_20261230_admin_subscription_management), on PGlite with the live
// shapes of businesses / plan_payments / payment_intents and the migrations it builds on: plan enforcement, subscription
// billing (renew_business_plan, the automated payment writer) and branch plans following their main business.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const migration = (name) => readFileSync(fileURLToPath(new URL(`../../../../../supabase/migrations/${name}`, import.meta.url)), 'utf8')

const ids = {
  main: 'c0000000-0000-4000-8000-000000000001',
  branch: 'c0000000-0000-4000-8000-000000000002',
  other: 'c0000000-0000-4000-8000-000000000003',
  noExpiry: 'c0000000-0000-4000-8000-000000000004',
  deleted: 'c0000000-0000-4000-8000-000000000005',
}
const ADMIN = 'admin@x.com'
const OWNER = 'owner@x.com'
let db

async function as(email, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '00000000-0000-4000-8000-0000000000aa', email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const one = async (s, p) => (await db.query(s, p)).rows[0]
const manage = (email, args) => as(email, async (q) => (await q(
  'select admin_manage_subscription($1, $2, $3, $4, $5, $6, $7, $8) r',
  [args.id, args.action, args.reason ?? 'Routine admin change', args.plan ?? null, args.months ?? null, args.days ?? null, args.expiresAt ?? null, args.grantType ?? null],
))[0].r)
const biz = (id) => one('select plan, plan_expires_at from businesses where id = $1', [id])
const overviewRow = async (id) => (await as(ADMIN, (q) => q('select * from admin_subscription_overview()'))).find((r) => r.business_id === id)
const daysFromNow = (d) => (new Date(d).getTime() - Date.now()) / 86400000

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key default gen_random_uuid(), name text, owner text, owner_name text, email text,
      phone text, address text, city text, state text, business_type text, logo_url text, status text default 'active',
      plan text default 'basic', plan_expires_at timestamptz, parent_business_id uuid, deleted_at timestamptz,
      is_platform_admin boolean default false, referring_agent_id uuid, branch_depth_limit integer default 3,
      created_at timestamp default now());
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active');
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid, name text, stock integer default 0);
    create table plan_payments (id uuid primary key default gen_random_uuid(), business_id uuid, months integer, naira_amount integer,
      reference text unique, status text, created_at timestamptz default now(), is_first_payment boolean default false);
    create table payment_intents (id uuid primary key default gen_random_uuid(), reference text unique, provider text default 'paystack',
      provider_transaction_id text, application text, purpose text, business_id uuid, expected_amount bigint, currency text default 'NGN',
      status text default 'created', metadata jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now());
    create table admin_audit_log (id bigserial primary key, actor_admin_id uuid, action text, target_table text, target_id text,
      before jsonb, after jsonb, ip text, ua text, created_at timestamptz default now());
    create table commission_calls (payment_id uuid);
    create function _record_referral_commission(p uuid) returns void language sql as $$ insert into commission_calls values (p) $$;
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      select id from businesses where lower(email) = lower(auth.email()) $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email()) limit 1), false) $$;
    create function is_business_owner(bid uuid) returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from businesses where id = bid and lower(email) = lower(auth.email())) $$;
    create function renew_business_plan(p_business_id uuid, p_months integer, p_naira_amount integer, p_reference text)
    returns table(already_processed boolean, payment_id uuid, new_expiry timestamptz, is_first_payment boolean)
    language plpgsql security definer set search_path to 'public' as $f$ begin return; end $f$;
    do $$ declare t text; begin foreach t in array array['businesses','staff','products','plan_payments','payment_intents','admin_audit_log'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select on %I to authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "own business" on businesses for select to authenticated using (id in (select current_business_ids()) or is_platform_admin());
  `)
  await db.exec(migration('carehub_20261214_plan_enforcement.sql'))
  await db.exec(migration('carehub_20261218_subscription_billing.sql'))
  await db.exec(migration('carehub_20261210_branch_plan_follows_parent.sql'))
  // Past the go-live grace floor, as production will be from 2026-11-03.
  await db.exec(`create or replace function plan_enforcement_started_at() returns timestamptz language sql immutable as $$ select '2026-01-01'::timestamptz $$;`)
  await db.exec(`
    insert into businesses (id, name, owner_name, email, plan, plan_expires_at) values
      ('${ids.main}', 'Ada Pharmacy', 'Ada', '${OWNER}', 'basic', now() + interval '10 days'),
      ('${ids.other}', 'Other Clinic', 'Bo', 'other@x.com', 'growth', now() - interval '3 days'),
      ('${ids.noExpiry}', 'Forever Labs', 'Cy', 'forever@x.com', 'enterprise', null);
    insert into businesses (id, name, email, plan, plan_expires_at, parent_business_id) values
      ('${ids.branch}', 'Ada Pharmacy Lekki', null, 'basic', now() + interval '10 days', '${ids.main}');
    insert into businesses (id, name, email, plan, plan_expires_at, deleted_at) values
      ('${ids.deleted}', 'Gone', 'gone@x.com', 'basic', now() + interval '10 days', now());
    insert into businesses (name, email, is_platform_admin, plan_expires_at) values ('Platform', '${ADMIN}', true, null);
  `)
  await db.exec(migration('carehub_20261230_admin_subscription_management.sql'))
})

describe('who may manage subscriptions', () => {
  it('refuses business owners, and writes nothing', async () => {
    await expect(manage(OWNER, { id: ids.main, action: 'extend', months: 12 })).rejects.toThrow(/platform administrator/)
    await expect(as(OWNER, (q) => q('select * from admin_subscription_overview()'))).rejects.toThrow(/platform administrator/)
    await expect(as(OWNER, (q) => q('select * from admin_subscription_history($1)', [ids.main]))).rejects.toThrow(/platform administrator/)
    expect((await one('select count(*)::int n from subscription_events')).n).toBe(0)
  })

  it('is not callable by anon, and the history cannot be written or rewritten by clients', async () => {
    expect((await one(`select has_function_privilege('anon', 'admin_subscription_overview()', 'EXECUTE') ok`)).ok).toBe(false)
    expect((await one(`select has_table_privilege('authenticated', 'subscription_events', 'INSERT') ok`)).ok).toBe(false)
    await expect(as(ADMIN, (q) => q(`insert into subscription_events (business_id, action, reason) values ($1, 'extend', 'sneaky')`, [ids.main]))).rejects.toThrow()
  })
})

describe('validation', () => {
  it.each([
    [{ action: 'extend', months: 1, reason: ' ' }, /reason/],
    [{ action: 'explode' }, /Unknown subscription action/],
    [{ action: 'extend' }, /months or in days/],
    [{ action: 'extend', months: 1, days: 5 }, /months or in days/],
    [{ action: 'extend', months: 121 }, /between 1 and 120/],
    [{ action: 'grant', months: 1 }, /kind of access/],
    [{ action: 'change_plan', plan: 'platinum' }, /Unknown plan/],
    [{ action: 'change_plan', plan: 'basic' }, /already on this plan/],
    [{ action: 'set_expiry' }, /new expiry date/],
    [{ action: 'activate' }, /not suspended/],
  ])('%o is refused', async (args, message) => {
    await expect(manage(ADMIN, { id: ids.main, ...args })).rejects.toThrow(message)
  })

  it('refuses a deleted business and one with no expiry for time-based grants', async () => {
    await expect(manage(ADMIN, { id: ids.deleted, action: 'extend', months: 1 })).rejects.toThrow(/deleted/)
    await expect(manage(ADMIN, { id: ids.noExpiry, action: 'grant', months: 1, grantType: 'trial' })).rejects.toThrow(/no expiry date/)
  })
})

describe('changes', () => {
  it('upgrades a plan without touching the expiry, and branches follow', async () => {
    const before = await biz(ids.main)
    const r = await manage(ADMIN, { id: ids.main, action: 'change_plan', plan: 'premium', reason: 'Upgrade agreed by phone' })
    expect(r.plan).toBe('premium')
    const after = await biz(ids.main)
    expect(after.plan).toBe('premium')
    expect(after.plan_expires_at.getTime()).toBe(before.plan_expires_at.getTime())
    expect((await biz(ids.branch)).plan).toBe('premium')
  })

  it('a branch id acts on its main business', async () => {
    const r = await manage(ADMIN, { id: ids.branch, action: 'change_plan', plan: 'growth' })
    expect(r.business_id).toBe(ids.main)
    expect((await biz(ids.main)).plan).toBe('growth')
  })

  it('grants complimentary time after the paid time, never instead of it', async () => {
    const before = await biz(ids.main) // ~10 days left
    const r = await manage(ADMIN, { id: ids.main, action: 'grant', months: 6, grantType: 'partnership', plan: 'enterprise', reason: 'Partnership with state ministry' })
    const after = await biz(ids.main)
    expect(after.plan).toBe('enterprise')
    expect(daysFromNow(after.plan_expires_at)).toBeGreaterThan(daysFromNow(before.plan_expires_at) + 180)
    expect(r.state).toBe('active')
    const row = await overviewRow(ids.main)
    expect(row.access_type).toBe('partnership')
    expect(row.payment_count).toBe(0)
    // no payment, receipt or commission for free access
    expect((await one('select count(*)::int n from plan_payments')).n).toBe(0)
    expect((await one('select count(*)::int n from commission_calls')).n).toBe(0)
  })

  it('a trial for an expired business starts today', async () => {
    await manage(ADMIN, { id: ids.other, action: 'grant', days: 30, grantType: 'trial', reason: 'Trial after demo' })
    const after = await biz(ids.other)
    expect(Math.round(daysFromNow(after.plan_expires_at))).toBe(30)
    const row = await overviewRow(ids.other)
    expect(row.access_type).toBe('trial')
    expect(row.plan_state).toBe('active')
    expect(Math.abs(new Date(row.period_start).getTime() - Date.now())).toBeLessThan(60000)
  })

  it('sets an exact expiry date', async () => {
    const target = new Date(Date.now() + 45 * 86400000).toISOString()
    await manage(ADMIN, { id: ids.other, action: 'set_expiry', expiresAt: target, reason: 'Correct expiry after support ticket' })
    expect(Math.round(daysFromNow((await biz(ids.other)).plan_expires_at))).toBe(45)
    expect((await overviewRow(ids.other)).access_type).toBe('admin')
  })

  it('suspends into restricted mode and gives the remaining time back on activation', async () => {
    const before = await biz(ids.main)
    const left = daysFromNow(before.plan_expires_at)
    const s = await manage(ADMIN, { id: ids.main, action: 'suspend', reason: 'Disputed chargeback' })
    expect(s.suspended).toBe(true)
    expect(s.state).toBe('restricted')
    expect((await overviewRow(ids.main)).suspended).toBe(true)
    expect((await overviewRow(ids.main)).access_type).toBe('suspended')
    expect((await biz(ids.branch)).plan_expires_at.getTime()).toBe((await biz(ids.main)).plan_expires_at.getTime())

    await expect(manage(ADMIN, { id: ids.main, action: 'suspend' })).rejects.toThrow(/already suspended/)
    await expect(manage(ADMIN, { id: ids.main, action: 'extend', months: 1 })).rejects.toThrow(/Activate it first/)

    // a plan change while suspended keeps the suspension
    await manage(ADMIN, { id: ids.main, action: 'change_plan', plan: 'premium' })
    expect((await overviewRow(ids.main)).suspended).toBe(true)

    const a = await manage(ADMIN, { id: ids.main, action: 'activate', reason: 'Dispute resolved' })
    expect(a.state).toBe('active')
    expect(Math.abs(daysFromNow(a.expires_at) - left)).toBeLessThan(0.01)
    expect((await overviewRow(ids.main)).suspended).toBe(false)
  })

  it('a payment made while suspended lifts the suspension', async () => {
    await manage(ADMIN, { id: ids.other, action: 'suspend', reason: 'Unpaid invoice' })
    // the automated settlement writes the business directly, exactly as renew_business_plan does
    await db.exec(`update businesses set plan_expires_at = now() + interval '1 month' where id = '${ids.other}'`)
    expect((await overviewRow(ids.other)).suspended).toBe(false)
    await expect(manage(ADMIN, { id: ids.other, action: 'activate' })).rejects.toThrow(/not suspended/)
  })

  it('suspending a business without an expiry restores no expiry', async () => {
    await manage(ADMIN, { id: ids.noExpiry, action: 'suspend', reason: 'Contract under review' })
    expect((await biz(ids.noExpiry)).plan_expires_at).not.toBeNull()
    const r = await manage(ADMIN, { id: ids.noExpiry, action: 'activate', reason: 'Contract renewed' })
    expect(r.expires_at).toBeNull()
    expect((await biz(ids.noExpiry)).plan_expires_at).toBeNull()
  })
})

describe('audit and history', () => {
  it('records every change with actor, reason and before/after, in admin_audit_log too', async () => {
    const events = (await db.query(`select * from subscription_events where business_id = $1 order by created_at`, [ids.main])).rows
    expect(events.map((e) => e.action)).toEqual(['change_plan', 'change_plan', 'grant', 'suspend', 'change_plan', 'activate'])
    expect(events.every((e) => e.actor_email === ADMIN && e.actor_user_id)).toBe(true)
    expect(events[2]).toMatchObject({ grant_type: 'partnership', months: 6, plan_before: 'growth', plan_after: 'enterprise', reason: 'Partnership with state ministry' })
    expect(Number(events[3].remaining_seconds)).toBeGreaterThan(0)
    const audits = (await db.query(`select * from admin_audit_log where target_id = $1 order by id`, [ids.main])).rows
    expect(audits).toHaveLength(events.length)
    expect(audits[2].action).toBe('subscription.grant')
    expect(audits[2].after.reason).toBe('Partnership with state ministry')
  })

  it('the history is append-only', async () => {
    await expect(db.query('update subscription_events set reason = $1', ['rewritten'])).rejects.toThrow(/append-only/)
    await expect(db.query('delete from subscription_events')).rejects.toThrow(/append-only/)
  })

  it('merges payments and administrative changes, newest first, for the main business', async () => {
    await db.exec(`insert into plan_payments (business_id, months, naira_amount, reference, status, plan, period_start, period_end, payment_method, paid_at)
                   values ('${ids.main}', 12, 60000, 'ch_plan_1', 'success', 'basic', now(), now() + interval '12 months', 'paystack', now() + interval '1 second')`)
    const rows = await as(ADMIN, (q) => q('select * from admin_subscription_history($1)', [ids.branch]))
    expect(rows[0]).toMatchObject({ kind: 'payment', amount: 60000, payment_method: 'paystack', reference: 'ch_plan_1' })
    expect(rows[0].receipt_number).toMatch(/^CH-\d{4}-\d{6}$/)
    expect(rows.filter((r) => r.kind === 'admin')).toHaveLength(6)
    const row = await overviewRow(ids.main)
    expect(row).toMatchObject({ access_type: 'paid', payment_count: 1, last_payment_amount: 60000, last_payment_method: 'paystack', branch_count: 1 })
    expect(Number(row.total_paid)).toBe(60000)
  })

  it('lists main businesses only, never branches or deleted ones', async () => {
    const rows = await as(ADMIN, (q) => q('select business_id from admin_subscription_overview()'))
    const listed = rows.map((r) => r.business_id)
    expect(listed).toEqual(expect.arrayContaining([ids.main, ids.other, ids.noExpiry]))
    expect(listed).not.toContain(ids.branch)
    expect(listed).not.toContain(ids.deleted)
  })
})
