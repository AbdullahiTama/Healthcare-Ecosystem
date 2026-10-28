// @vitest-environment node
// Subscription billing history and receipts (carehub_20261218_subscription_billing), on PGlite with the live shapes of
// businesses / plan_payments / payment_intents and the live renew_business_plan it replaces.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const migration = (name) => readFileSync(fileURLToPath(new URL(`../../../../../supabase/migrations/${name}`, import.meta.url)), 'utf8')

const ids = {
  owner: 'b0000000-0000-4000-8000-000000000001',
  branch: 'b0000000-0000-4000-8000-000000000002',
  other: 'b0000000-0000-4000-8000-000000000003',
}
let db

async function as(email, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '00000000-0000-4000-8000-000000000001', email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const one = async (s, p) => (await db.query(s, p)).rows[0]
const overview = (email, id) => as(email, async (q) => (await q('select business_billing_overview($1) o', [id]))[0].o)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key default gen_random_uuid(), name text, email text, phone text, address text, city text,
      state text, logo_url text, status text default 'active', plan text default 'basic', plan_expires_at timestamptz,
      parent_business_id uuid, deleted_at timestamptz, is_platform_admin boolean default false, referring_agent_id uuid,
      branch_depth_limit integer default 3);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active');
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid, name text, stock integer default 0);
    create table plan_payments (id uuid primary key default gen_random_uuid(), business_id uuid, months integer, naira_amount integer,
      reference text unique, status text, created_at timestamptz default now(), is_first_payment boolean default false);
    create unique index plan_payments_one_first_per_business on plan_payments (business_id) where is_first_payment;
    create table payment_intents (id uuid primary key default gen_random_uuid(), reference text unique, provider text default 'paystack',
      provider_transaction_id text, application text, purpose text, business_id uuid, expected_amount bigint, currency text default 'NGN',
      status text default 'created', metadata jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now());
    create table commission_calls (payment_id uuid);
    create function _record_referral_commission(p uuid) returns void language sql as $$ insert into commission_calls values (p) $$;
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      with recursive v(id, d) as (select id, 0 from businesses where lower(email) = lower(auth.email())
        union all select c.id, v.d + 1 from businesses c join v on c.parent_business_id = v.id where v.d < 5)
      select distinct id from v
      union select business_id from staff where lower(email) = lower(auth.email()) and status = 'active' $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email()) limit 1), false) $$;
    -- live definition (carehub_20261216_sales_owner_corrections)
    create function is_business_owner(bid uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
      with recursive ancestry as (
        select b.id, b.parent_business_id, b.email, 0 as depth from public.businesses b where b.id = bid
        union all
        select p.id, p.parent_business_id, p.email, a.depth + 1 from public.businesses p join ancestry a on p.id = a.parent_business_id where a.depth < 10)
      select auth.uid() is not null and bid in (select public.current_business_ids())
         and (exists (select 1 from ancestry a where lower(a.email) = lower(auth.email()))
              or exists (select 1 from public.staff s where s.business_id = bid and s.status = 'active' and s.role = 'Owner'
                          and lower(s.email) = lower(auth.email()))) $$;
    -- live definition before this migration
    create function renew_business_plan(p_business_id uuid, p_months integer, p_naira_amount integer, p_reference text)
    returns table(already_processed boolean, payment_id uuid, new_expiry timestamptz, is_first_payment boolean)
    language plpgsql security definer set search_path to 'public' as $f$
    declare v_count bigint; v_base timestamptz; v_new_expiry timestamptz; v_payment_id uuid;
    begin
      select plan_expires_at into v_base from public.businesses where id = p_business_id for update;
      select count(*) into v_count from public.plan_payments where business_id = p_business_id;
      insert into public.plan_payments (business_id, months, naira_amount, reference, status, is_first_payment)
      values (p_business_id, p_months, p_naira_amount, p_reference, 'success', v_count = 0)
      on conflict (reference) do nothing returning id into v_payment_id;
      if v_payment_id is null then return query select true, null::uuid, null::timestamptz, false; return; end if;
      if v_base is null or v_base < now() then v_base := now(); end if;
      v_new_expiry := v_base + make_interval(months => p_months);
      update public.businesses set plan_expires_at = v_new_expiry where id = p_business_id;
      perform public._record_referral_commission(v_payment_id);
      return query select false, v_payment_id, v_new_expiry, v_count = 0;
    end $f$;
    do $$ declare t text; begin foreach t in array array['businesses','staff','products','plan_payments','payment_intents'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select on %I to authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "own business" on businesses for select to authenticated using (id in (select current_business_ids()));
    create policy "own payments" on plan_payments for select to authenticated using (business_id in (select current_business_ids()));
  `)
  await db.exec(`
    insert into businesses (id, name, email, phone, address, city, state, plan, plan_expires_at) values
      ('${ids.owner}', 'Ada Pharmacy', 'owner@x.com', '0801', '1 Main St', 'Ikeja', 'Lagos', 'basic', now() + interval '5 days'),
      ('${ids.other}', 'Other', 'other@x.com', null, null, null, null, 'basic', now() + interval '60 days');
    insert into businesses (id, name, email, plan, plan_expires_at, parent_business_id) values
      ('${ids.branch}', 'Ada Pharmacy Lekki', 'owner@x.com', 'basic', now() + interval '5 days', '${ids.owner}');
    insert into businesses (name, email, is_platform_admin) values ('Platform', 'admin@x.com', true);
    insert into staff (business_id, full_name, email, role) values
      ('${ids.owner}', 'Mgr', 'manager@x.com', 'Manager'), ('${ids.owner}', 'Cash', 'cashier@x.com', 'Cashier');
    insert into products (business_id, name) select '${ids.owner}', 'p' || g from generate_series(1, 3) g;
    -- a payment made before this migration, through Paystack
    insert into payment_intents (reference, provider_transaction_id, purpose, business_id, expected_amount, status, metadata, created_at)
      values ('ch_plan_old', '111', 'plan_renewal', '${ids.owner}', 500000, 'settled', '{"plan":"basic","months":1}', now() - interval '20 days');
    select renew_business_plan('${ids.owner}', 1, 5000, 'ch_plan_old');
    -- attempts that never settled
    insert into payment_intents (reference, purpose, business_id, expected_amount, status, metadata, created_at) values
      ('ch_plan_abandoned', 'plan_renewal', '${ids.owner}', 5000000, 'expired', '{"plan":"basic","months":12}', now() - interval '3 days'),
      ('ch_plan_pending', 'plan_renewal', '${ids.owner}', 500000, 'pending', '{"plan":"basic","months":1}', now() - interval '1 hour'),
      ('ch_plan_ancient', 'plan_renewal', '${ids.owner}', 500000, 'failed', '{"plan":"basic","months":1}', now() - interval '400 days'),
      ('ch_plan_theirs', 'plan_renewal', '${ids.other}', 500000, 'failed', '{"plan":"basic","months":1}', now());
  `)
  await db.exec(migration('carehub_20261214_plan_enforcement.sql'))
  await db.exec(migration('carehub_20261218_subscription_billing.sql'))
})

describe('existing payments are backfilled', () => {
  it('get a receipt number, payment details and a period', async () => {
    const r = await one(`select * from plan_payments where reference = 'ch_plan_old'`)
    expect(r.receipt_number).toMatch(/^CH-\d{4}-000001$/)
    expect(r).toMatchObject({ plan: 'basic', payment_method: 'paystack', provider_transaction_id: '111', currency: 'NGN' })
    expect(r.period_end - r.period_start).toBeGreaterThan(27 * 86400000)
  })
})

describe('renew_business_plan records the receipt', () => {
  it('a Paystack renewal: plan, period from the current expiry, method and transaction id', async () => {
    const before = (await one(`select plan_expires_at e from businesses where id = $1`, [ids.owner])).e
    await db.exec(`insert into payment_intents (reference, provider_transaction_id, purpose, business_id, expected_amount, status, metadata)
                   values ('ch_plan_new', '222', 'plan_renewal', '${ids.owner}', 5000000, 'verified', '{"plan":"basic","months":12}')`)
    const res = await one(`select * from renew_business_plan($1, 12, 50000, 'ch_plan_new')`, [ids.owner])
    expect(res.already_processed).toBe(false)
    const r = await one(`select * from plan_payments where reference = 'ch_plan_new'`)
    expect(r.receipt_number).toMatch(/-000002$/)
    expect(r).toMatchObject({ plan: 'basic', payment_method: 'paystack', provider_transaction_id: '222', months: 12, naira_amount: 50000, is_first_payment: false })
    expect(r.period_start.getTime()).toBe(before.getTime())
    expect(r.period_end.getTime()).toBe(res.new_expiry.getTime())
    expect((await one(`select count(*)::int n from commission_calls where payment_id = $1`, [r.id])).n).toBe(1)
  })

  it('a wallet renewal is recorded as wallet; a renewal with no intent as manual', async () => {
    await db.exec(`insert into payment_intents (reference, purpose, business_id, expected_amount, status, metadata, provider)
                   values ('ch_plan_wallet', 'plan_renewal_wallet', '${ids.owner}', 500000, 'verified', '{"months":1}', 'wallet')`)
    await db.query(`select renew_business_plan($1, 1, 5000, 'ch_plan_wallet')`, [ids.owner])
    await db.query(`select renew_business_plan($1, 1, 5000, 'admin_manual_1')`, [ids.owner])
    expect((await one(`select payment_method m from plan_payments where reference = 'ch_plan_wallet'`)).m).toBe('wallet')
    expect((await one(`select payment_method m from plan_payments where reference = 'admin_manual_1'`)).m).toBe('manual')
  })

  it('a replayed reference is still a no-op and burns no receipt or expiry', async () => {
    const before = await one(`select plan_expires_at e, (select count(*)::int from plan_payments) n from businesses where id = $1`, [ids.owner])
    const res = await one(`select * from renew_business_plan($1, 12, 50000, 'ch_plan_new')`, [ids.owner])
    expect(res.already_processed).toBe(true)
    const after = await one(`select plan_expires_at e, (select count(*)::int from plan_payments) n from businesses where id = $1`, [ids.owner])
    expect(after).toEqual(before)
  })

  it('the receipt number cannot be chosen by the writer', async () => {
    await db.exec(`insert into plan_payments (business_id, months, naira_amount, reference, status, receipt_number) values ('${ids.other}', 1, 5000, 'x1', 'success', 'FAKE-1')`)
    expect((await one(`select receipt_number r from plan_payments where reference = 'x1'`)).r).toMatch(/^CH-\d{4}-\d{6}$/)
  })
})

describe('business_billing_overview', () => {
  it('gives the Owner plan, usage, receipts newest first and recent attempts that produced no payment', async () => {
    const o = await overview('owner@x.com', ids.owner)
    expect(o.business).toMatchObject({ id: ids.owner, name: 'Ada Pharmacy', city: 'Ikeja' })
    expect(o.limits).toEqual({ staff: 5, locations: 2, products: 5000 })
    expect(o.usage).toEqual({ staff: 2, locations: 2, products: 3 })
    expect(o.payments.map((p) => p.reference)).toEqual(['admin_manual_1', 'ch_plan_wallet', 'ch_plan_new', 'ch_plan_old'])
    expect(o.payments.every((p) => /^CH-/.test(p.receipt_number))).toBe(true)
    expect(o.attempts.map((a) => a.reference).sort()).toEqual(['ch_plan_abandoned', 'ch_plan_pending'])
    expect(o.attempts.find((a) => a.reference === 'ch_plan_abandoned')).toMatchObject({ amount: 50000, months: 12, status: 'expired' })
  })

  it('from a branch, shows the organisation\'s billing (paid by the top-level business)', async () => {
    const o = await overview('owner@x.com', ids.branch)
    expect(o.business.id).toBe(ids.owner)
    expect(o.payments).toHaveLength(4)
  })

  it('is the Owner\'s only: staff (even managers) and other businesses get nothing; a platform admin may look', async () => {
    expect(await overview('manager@x.com', ids.owner)).toBeNull()
    expect(await overview('cashier@x.com', ids.owner)).toBeNull()
    expect(await overview('other@x.com', ids.owner)).toBeNull()
    expect(await overview(null, ids.owner)).toBeNull()
    expect((await overview('admin@x.com', ids.owner)).business.id).toBe(ids.owner)
  })

  it('is not callable by anon', async () => {
    await db.query('set role anon')
    try { await expect(db.query('select business_billing_overview($1)', [ids.owner])).rejects.toThrow(/permission denied/) } finally { await db.query('reset role') }
  })
})
