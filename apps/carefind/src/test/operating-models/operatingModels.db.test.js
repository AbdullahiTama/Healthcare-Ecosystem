// @vitest-environment node
// carehub_20270102_importer_operating_models on PGlite, with the live shapes of businesses, staff, roles, products,
// master_products, sales, stock_transfers, staff_notifications, audit_log and ecommerce_products, the live
// current_business_ids(), is_platform_admin(), is_business_owner_email(), caller_owns_business(), the live businesses
// and products RLS policies, a guard_staff_writes that refuses browser moves between businesses (as the live one
// does), and the live stock ledger (docs/architecture/stock-ledger-live-snapshot.sql).
//
// One company is taken through its whole life: Centralised ledger work, a switch to Decentralised (with a custody
// plan), independent-account work and privacy, a switch back, and a second switch forward that must reuse the
// representative accounts. The tests share state and run in order.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const repoFile = (rel) => readFileSync(fileURLToPath(new URL('../../../../../' + rel, import.meta.url)), 'utf8')
const MIGRATION = repoFile('supabase/migrations/carehub_20270102_importer_operating_models.sql')
const LEDGER_LIVE = repoFile('docs/architecture/stock-ledger-live-snapshot.sql')

const CO = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const PHARM = 'b0000000-0000-4000-8000-000000000002'
const M = { amox: 'c0000000-0000-4000-8000-000000000001', para: 'c0000000-0000-4000-8000-000000000002' }
const P = { amox: 'd0000000-0000-4000-8000-000000000001', para: 'd0000000-0000-4000-8000-000000000002', loose: 'd0000000-0000-4000-8000-000000000003' }
const S = { mgr: 'e0000000-0000-4000-8000-000000000001', viewer: 'e0000000-0000-4000-8000-000000000002', ada: 'e0000000-0000-4000-8000-000000000003',
  bayo: 'e0000000-0000-4000-8000-000000000004', clerk: 'e0000000-0000-4000-8000-000000000005', chi: 'e0000000-0000-4000-8000-000000000006' }
const USERS = { 'owner@co.com': 1, 'mgr@co.com': 2, 'viewer@co.com': 3, 'ada@co.com': 4, 'bayo@co.com': 5, 'clerk@co.com': 6,
  'other@x.com': 7, 'chi@co.com': 8, 'admin@carehub.ng': 9 }
const OWNER = 'owner@co.com'
let db

async function as(email, fn) {
  const sub = `10000000-0000-4000-8000-${String(USERS[email]).padStart(12, '0')}`
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub, email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally {
    await db.query('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`)
  }
}
const call = (email, sql, params = []) => as(email, (q) => q(sql, params)).then((rows) => rows[0] && Object.values(rows[0])[0])
const one = async (s, p) => (await db.query(s, p)).rows[0]
const rows = async (s, p) => (await db.query(s, p)).rows
const stock = async (id) => (await one('select stock from products where id = $1', [id]))?.stock
const accountStock = async (account, master) => (await one('select stock from products where business_id = $1 and master_product_id = $2', [account, master]))?.stock
const balance = async (rep) => Number((await one('select rep_balance($1) b', [rep])).b)
const custody = async (rep, product) => (await one('select quantity from rep_custody where representative_id = $1 and company_product_id = $2', [rep, product]))?.quantity ?? 0
const j = (v) => JSON.stringify(v)
const TODAY = new Date(Date.now() + 3600e3).toISOString().slice(0, 10) // Africa/Lagos is UTC+1

const rep = {}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;

    create table businesses (id uuid primary key default gen_random_uuid(), name text not null, owner text not null default '', branch_name text, email text,
      parent_business_id uuid references businesses(id), branch_depth_limit integer default 3, is_platform_admin boolean default false,
      business_type text, status text default 'active', plan text default 'growth', plan_expires_at timestamptz, state text, city text, lga text, area text,
      address text, phone text, visible_on_carefind boolean default true, ecommerce_enabled boolean not null default false, booking_enabled boolean default false,
      deleted_at timestamptz, created_at timestamptz default now(),
      constraint businesses_main_has_email check (parent_business_id is not null or email is not null));
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id), full_name text not null, email text not null,
      role text, status text default 'active', auth_user_id uuid);
    create unique index staff_email_lower_key on staff (lower(email));
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb, created_at timestamptz default now());
    create table master_products (id uuid primary key, business_id uuid references businesses(id), name text not null, category text default '', default_price integer default 0,
      generic_name text, barcode text, rx_status text default 'pharmacy_only', default_cost numeric default 0, reorder_level integer default 5);
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id), name text not null, generic_name text, category text,
      price numeric default 0, cost_price numeric default 0, stock integer default 0, reorder_level integer default 5, barcode text, sale_type text, list_on_carefind boolean default true,
      emoji text, master_product_id uuid references master_products(id), rx_status text, price_source text default 'master' check (price_source in ('master','branch')),
      price_unit text, sales_unit text, tracking_mode text not null default 'none');
    create table stock_batches (id uuid primary key default gen_random_uuid(), business_id uuid, product_id uuid, product_name text not null default '',
      batch_number text, quantity integer not null default 0, expiry_date date, status text not null default 'available', created_at timestamptz default now());
    create table stock_movements (id uuid primary key default gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid, to_location_id uuid, movement_type text,
      quantity integer, reason text, moved_by text, created_at timestamptz default now(), product_id uuid, source_type text, source_id text, source_line_id text,
      idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
      constraint stock_movements_type_check check (movement_type in ('opening','purchase_receipt','sale','sale_reversal','return_restock','return_writeoff','adjustment','write_off','transfer','tracking_change','correction')));
    create unique index stock_movements_idem_uniq on stock_movements (business_id, idempotency_key) where idempotency_key is not null;
    create table staff_notifications (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid, is_owner boolean, kind text not null, title text not null,
      body text, link text, read_at timestamptz, created_at timestamptz default now());
    create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid not null, actor_type text not null, branch_id uuid not null references businesses(id),
      action text not null, target_type text, target_id uuid, metadata jsonb, created_at timestamptz not null default now());
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, txn_no text not null default 'T', is_on_hold boolean, status text,
      cashier_staff_id uuid, deleted_at timestamptz);
    create table stock_transfers (id uuid primary key default gen_random_uuid(), from_branch_id uuid, to_branch_id uuid, status text not null default 'in_transit');
    create table ecommerce_products (id uuid primary key default gen_random_uuid(), business_id uuid not null, product_id uuid not null, status text not null default 'draft');

    -- live definitions
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      with recursive visible as (
        select b.id, b.parent_business_id, b.branch_depth_limit, 0 as depth from businesses b where lower(b.email) = lower(auth.email())
        union all
        select child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1 from businesses child join visible on child.parent_business_id = visible.id
         where visible.depth < visible.branch_depth_limit)
      select id from visible
      union
      select b.id from businesses b join staff s on s.business_id = b.id where lower(s.email) = lower(auth.email()) and s.status = 'active' $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email())), false) $$;
    create function is_business_owner_email(p_email text, p_business_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
      with recursive chain as (
        select b.id, b.parent_business_id, b.email, 0 as depth from public.businesses b where b.id = p_business_id
        union all select p.id, p.parent_business_id, p.email, c.depth + 1 from public.businesses p join chain c on p.id = c.parent_business_id where c.depth < 10)
      select coalesce(p_email, '') <> '' and exists (select 1 from chain where lower(email) = lower(trim(p_email))) $$;
    create function caller_owns_business(bid uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
      with recursive up(id, parent_business_id, email, depth) as (
        select b.id, b.parent_business_id, b.email, 0 from public.businesses b where b.id = bid
        union select p.id, p.parent_business_id, p.email, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id where up.depth < 10)
      select auth.email() is not null and exists (select 1 from up where lower(up.email) = lower(auth.email())) $$;
    -- The live guard refuses any browser change of a member's business (and much more); server code is trusted.
    create function guard_staff_writes() returns trigger language plpgsql as $$
      begin
        if current_user in ('authenticated', 'anon') and (tg_op <> 'UPDATE' or new.business_id is distinct from old.business_id) then
          raise exception 'A staff member''s business, email and login cannot be edited.' using errcode = '42501';
        end if;
        return coalesce(new, old);
      end $$;
    create trigger guard_staff_writes before insert or update or delete on staff for each row execute function guard_staff_writes();
    create function enforce_product_stock_floor() returns trigger language plpgsql as $$
      begin if new.stock < 0 and (tg_op = 'INSERT' or new.stock < coalesce(old.stock, 0)) then
        raise exception 'INSUFFICIENT_STOCK: product stock cannot be reduced below zero (would be %).', new.stock using errcode = 'check_violation'; end if; return new; end $$;
    create trigger enforce_product_stock_floor before insert or update of stock on products for each row execute function enforce_product_stock_floor();

    do $$ declare t text; begin foreach t in array array['businesses','staff','roles','products','master_products','stock_movements','staff_notifications','audit_log',
      'sales','stock_transfers','ecommerce_products'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "products of own business" on products for all to authenticated
      using (business_id in (select current_business_ids()) or is_platform_admin()) with check (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "own business row" on businesses for all to authenticated
      using (lower(email) = lower(auth.email()) or is_platform_admin()) with check (lower(email) = lower(auth.email()) or is_platform_admin());
    create policy "owner manages own branches" on businesses for all to authenticated
      using (parent_business_id is not null and caller_owns_business(parent_business_id)) with check (parent_business_id is not null and caller_owns_business(parent_business_id));
    create policy "public can view active visible businesses" on businesses for select using (status = 'active' and visible_on_carefind = true);
    create policy "staff of own business" on staff for all to authenticated using (business_id in (select current_business_ids()));
    create policy "own ecommerce" on ecommerce_products for all to authenticated using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));
    create policy "own sales" on sales for all to authenticated using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));

    insert into businesses (id, name, owner, email, business_type, state, city) values
      ('${CO}', 'Zenith Pharma Ltd', 'Mrs Owner', 'owner@co.com', 'manufacturer_importer', 'Lagos', 'Ikeja'),
      ('${OTHER}', 'Other Importer', 'Other', 'other@x.com', 'manufacturer_importer', 'Oyo', 'Ibadan'),
      ('${PHARM}', 'A Pharmacy', 'P', 'pharm@x.com', 'pharmacy', 'Lagos', 'Yaba');
    insert into businesses (name, owner, email, is_platform_admin, business_type) values ('CareHub', 'Admin', 'admin@carehub.ng', true, 'other');
    insert into staff (id, business_id, full_name, email, role) values
      ('${S.mgr}', '${CO}', 'Musa Manager', 'mgr@co.com', 'Sales Manager'), ('${S.viewer}', '${CO}', 'Vera Viewer', 'viewer@co.com', 'Accounts'),
      ('${S.ada}', '${CO}', 'Ada Obi', 'ada@co.com', 'Medical sales rep'), ('${S.bayo}', '${CO}', 'Bayo Ade', 'bayo@co.com', 'Medical sales rep'),
      ('${S.clerk}', '${CO}', 'Clara Clerk', 'clerk@co.com', 'Cashier');
    insert into staff (id, business_id, full_name, email, role, status) values ('${S.chi}', '${CO}', 'Chi Eze', 'chi@co.com', 'Medical sales rep', 'invited');
    insert into roles (business_id, name, permissions) values
      ('${CO}', 'Sales Manager', '{"canManageRepLedger": true}'), ('${CO}', 'Accounts', '{"canViewRepLedger": true}'),
      ('${CO}', 'Medical sales rep', '{"nav": ["activity", "pos"]}');
    insert into master_products (id, business_id, name) values ('${M.amox}', '${CO}', 'Amoxil 500'), ('${M.para}', '${CO}', 'Paracetamol');
    insert into products (id, business_id, name, price, cost_price, stock, master_product_id, list_on_carefind) values
      ('${P.amox}', '${CO}', 'Amoxil 500', 1200, 900, 100, '${M.amox}', true), ('${P.para}', '${CO}', 'Paracetamol', 300, 200, 50, '${M.para}', true),
      ('${P.loose}', '${CO}', 'Unlinked Syrup', 500, 300, 10, null, true);
  `)
  await db.exec(LEDGER_LIVE)
  await db.exec(MIGRATION)
})

describe('the operating model column', () => {
  it('existing importers start Centralised (how they run today); other businesses have no model', async () => {
    expect((await one('select operating_model from businesses where id = $1', [CO])).operating_model).toBe('centralised')
    expect((await one('select operating_model from businesses where id = $1', [PHARM])).operating_model).toBeNull()
  })

  it('the browser cannot change the model, not even the owner', async () => {
    await expect(as(OWNER, (q) => q(`update businesses set operating_model = 'decentralised' where id = $1`, [CO])))
      .rejects.toThrow(/Settings > Operating model/)
  })

  it('registration sets the chosen model once, for a pending importer only, through the service role', async () => {
    const id = (await one(`insert into businesses (name, owner, email, business_type, status) values ('New Co', 'N', 'new@co.ng', 'manufacturer_importer', 'pending') returning id`)).id
    await db.query('set role service_role')
    try {
      expect((await one(`select set_registration_operating_model('NEW@co.ng', 'decentralised') ok`)).ok).toBe(true)
      expect((await one(`select set_registration_operating_model('new@co.ng', 'centralised') ok`)).ok).toBe(false)
      expect((await one(`select set_registration_operating_model('pharm@x.com', 'centralised') ok`)).ok).toBe(false)
    } finally { await db.query('reset role') }
    expect((await one('select operating_model from businesses where id = $1', [id])).operating_model).toBe('decentralised')
    expect((await one('select count(*)::int n from operating_model_changes where company_id = $1', [id])).n).toBe(1)
    await expect(as(OWNER, (q) => q(`select set_registration_operating_model('x@y.z', 'centralised')`))).rejects.toThrow(/permission denied/)
  })
})

describe('Centralised: representatives and their ledger', () => {
  it('only the owner or a role allowed to manage the ledger adds representatives', async () => {
    await expect(call('clerk@co.com', 'select add_company_representative($1, $2)', [CO, S.ada])).rejects.toThrow(/do not have permission/)
    const a = await call(OWNER, 'select add_company_representative($1, $2)', [CO, S.ada])
    const b = await call('mgr@co.com', 'select add_company_representative($1, $2)', [CO, S.bayo])
    const c = await call(OWNER, 'select add_company_representative($1, $2)', [CO, S.chi])
    expect([a.rep_code, b.rep_code, c.rep_code]).toEqual(['REP-001', 'REP-002', 'REP-003'])
    expect(a.rep_account_id).toBeNull() // Centralised: no separate account
    Object.assign(rep, { ada: a.id, bayo: b.id, chi: c.id })
    await expect(call(OWNER, 'select add_company_representative($1, $2)', [CO, S.ada])).rejects.toThrow(/already a representative/)
    await expect(call('other@x.com', 'select add_company_representative($1, $2)', [CO, S.clerk])).rejects.toThrow(/do not have permission/)
  })

  it('a supply on credit raises what the rep owes and records custody; company stock stays (they sell through the central POS)', async () => {
    const r = await call('mgr@co.com', 'select record_rep_supply($1, $2, $3::jsonb, null, $4, null, $5)',
      [CO, rep.ada, j([{ product_id: P.amox, qty: 10, unit_value: 900 }, { product_id: P.para, qty: 5, unit_value: 200 }]), 'INV-001', 'supply-1'])
    expect(r).toMatchObject({ status: 'posted', value: 10000, balance: 10000 })
    expect(r.entry_no).toMatch(/^RL-\d{6}-[0-9A-F]{6}$/)
    expect(await custody(rep.ada, P.amox)).toBe(10)
    expect(await stock(P.amox)).toBe(100)
    const e = await one('select * from rep_ledger_entries where id = $1', [r.id])
    expect(e).toMatchObject({ entry_type: 'supply', debit: '10000.00', credit: '0.00', reference: 'INV-001', operating_model: 'centralised',
      stock_effect: 'custody', created_by_name: 'Musa Manager' })
    expect((await one(`select count(*)::int n from audit_log where action = 'rep_ledger.supply' and target_id = $1`, [r.id])).n).toBe(1)
  })

  it('replaying the same request key returns the first entry instead of supplying twice', async () => {
    const r = await call('mgr@co.com', 'select record_rep_supply($1, $2, $3::jsonb, null, null, null, $4)',
      [CO, rep.ada, j([{ product_id: P.amox, qty: 10, unit_value: 900 }]), 'supply-1'])
    expect(r).toMatchObject({ replayed: true, balance: 10000 })
    expect(await custody(rep.ada, P.amox)).toBe(10)
  })

  it('refuses bad supplies with a sentence', async () => {
    await expect(call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb)', [CO, rep.ada, j([{ product_id: P.amox, qty: 0, unit_value: 1 }])])).rejects.toThrow(/greater than zero/)
    await expect(call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb)', [CO, rep.ada, j([])])).rejects.toThrow(/at least one product/)
    await expect(call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb, $4::date)', [CO, rep.ada, j([{ product_id: P.amox, qty: 1, unit_value: 1 }]), '2999-01-01'])).rejects.toThrow(/future/)
    const theirs = (await one(`insert into products (business_id, name, stock) values ('${OTHER}', 'Theirs', 5) returning id`)).id
    await expect(call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb)', [CO, rep.ada, j([{ product_id: theirs, qty: 1, unit_value: 1 }])])).rejects.toThrow(/not one of the company/)
    await expect(call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb)', [CO, rep.ada, j([{ product_id: P.amox, qty: 1, unit_value: 1 }, { product_id: P.amox, qty: 2, unit_value: 1 }])])).rejects.toThrow(/listed twice/)
    expect(await balance(rep.ada)).toBe(10000)
  })

  it('a payment reduces the balance and records method, reference and recipient', async () => {
    await expect(call(OWNER, 'select record_rep_payment($1, $2, $3, $4, $5)', [CO, rep.ada, 4000, 'bank_transfer', ' '])).rejects.toThrow(/who received/)
    const r = await call(OWNER, 'select record_rep_payment($1, $2, $3, $4, $5, null, $6)', [CO, rep.ada, 4000, 'bank_transfer', 'Accounts desk', 'TRX-778'])
    expect(r.balance).toBe(6000)
    expect(await one('select payment_method, payment_recipient, reference, credit from rep_ledger_entries where id = $1', [r.id]))
      .toEqual({ payment_method: 'bank_transfer', payment_recipient: 'Accounts desk', reference: 'TRX-778', credit: '4000.00' })
  })

  it('a return awaiting approval changes nothing until it is accepted, at the accepted value', async () => {
    const r = await call(OWNER, 'select record_rep_return($1, $2, $3::jsonb, $4, false)', [CO, rep.ada, j([{ product_id: P.amox, qty: 2, unit_value: 900 }]), 'good'])
    expect(r).toMatchObject({ status: 'pending', balance: 6000 })
    expect(await custody(rep.ada, P.amox)).toBe(10)
    const line = await one('select id from rep_ledger_lines where entry_id = $1', [r.id])
    await expect(call('viewer@co.com', `select decide_rep_entry($1, 'approve')`, [r.id])).rejects.toThrow(/do not have permission/)
    const d = await call('mgr@co.com', `select decide_rep_entry($1, 'approve', 'Two cartons slightly dented', $2::jsonb)`, [r.id, j([{ line_id: line.id, unit_value: 800 }])])
    expect(d).toMatchObject({ status: 'posted', value: 1600, balance: 4400 })
    expect(await custody(rep.ada, P.amox)).toBe(8)
    expect(await stock(P.amox)).toBe(100) // good goods never left the company's count
    expect(await one('select decided_by_name, decision_note from rep_ledger_entries where id = $1', [r.id]))
      .toEqual({ decided_by_name: 'Musa Manager', decision_note: 'Two cartons slightly dented' })
    await expect(call('mgr@co.com', `select decide_rep_entry($1, 'reject')`, [r.id])).rejects.toThrow(/already posted/)
  })

  it('a damaged return reduces custody and writes the goods off the company stock', async () => {
    const r = await call(OWNER, 'select record_rep_return($1, $2, $3::jsonb, $4)', [CO, rep.ada, j([{ product_id: P.amox, qty: 1, unit_value: 0 }]), 'damaged'])
    expect(r.balance).toBe(4400)
    expect(await custody(rep.ada, P.amox)).toBe(7)
    expect(await stock(P.amox)).toBe(99)
    expect(await one(`select movement_type, quantity, source_type from stock_movements where source_id = $1`, [r.id]))
      .toEqual({ movement_type: 'write_off', quantity: -1, source_type: 'rep_return' })
  })

  it('a rep cannot return more than is in their custody', async () => {
    await expect(call(OWNER, 'select record_rep_return($1, $2, $3::jsonb, $4)', [CO, rep.ada, j([{ product_id: P.para, qty: 6, unit_value: 200 }]), 'good']))
      .rejects.toThrow(/holds only 5 of Paracetamol/)
  })

  it('a transfer credits the sender, debits the receiver and moves custody', async () => {
    await expect(call(OWNER, 'select record_rep_transfer($1, $2, $3, $4::jsonb, $5)', [CO, rep.ada, rep.bayo, j([{ product_id: P.amox, qty: 3, unit_value: 900 }]), ''])).rejects.toThrow(/reason/)
    const r = await call(OWNER, 'select record_rep_transfer($1, $2, $3, $4::jsonb, $5)', [CO, rep.ada, rep.bayo, j([{ product_id: P.amox, qty: 3, unit_value: 900 }]), 'Bayo covers Surulere this week'])
    expect(r).toMatchObject({ status: 'posted', value: 2700, balance: 1700, receiver_balance: 2700 })
    expect([await custody(rep.ada, P.amox), await custody(rep.bayo, P.amox)]).toEqual([4, 3])
    const pair = await rows('select entry_type, representative_id, debit, credit, counterparty_representative_id from rep_ledger_entries where transfer_group = (select transfer_group from rep_ledger_entries where id = $1) order by entry_type', [r.id])
    expect(pair).toEqual([
      { entry_type: 'transfer_in', representative_id: rep.bayo, debit: '2700.00', credit: '0.00', counterparty_representative_id: rep.ada },
      { entry_type: 'transfer_out', representative_id: rep.ada, debit: '0.00', credit: '2700.00', counterparty_representative_id: rep.bayo },
    ])
  })

  it('a pending transfer is approved or rejected as a pair', async () => {
    const r = await call(OWNER, 'select record_rep_transfer($1, $2, $3, $4::jsonb, $5, false)', [CO, rep.bayo, rep.ada, j([{ product_id: P.amox, qty: 1, unit_value: 900 }]), 'Swap'])
    expect(r.status).toBe('pending')
    await call(OWNER, `select decide_rep_entry($1, 'reject', 'Not needed')`, [r.in_id])
    expect((await rows('select status from rep_ledger_entries where transfer_group = (select transfer_group from rep_ledger_entries where id = $1)', [r.id])).map((x) => x.status)).toEqual(['rejected', 'rejected'])
    expect([await balance(rep.ada), await balance(rep.bayo)]).toEqual([1700, 2700])
  })

  it('an adjustment needs a reason and a reference', async () => {
    await expect(call(OWNER, `select record_rep_adjustment($1, $2, 'credit', 200, 'Discount agreed', '')`, [CO, rep.ada])).rejects.toThrow(/reason and a reference/)
    const r = await call(OWNER, `select record_rep_adjustment($1, $2, 'credit', 200, 'Discount agreed', 'MEMO-4')`, [CO, rep.ada])
    expect(r.balance).toBe(1500)
  })

  it('a reversal mirrors one posted entry, once; a reversal cannot be reversed', async () => {
    const pay = await call(OWNER, 'select record_rep_payment($1, $2, $3, $4, $5)', [CO, rep.ada, 1000, 'cash', 'Musa'])
    expect(pay.balance).toBe(500)
    await expect(call(OWNER, `select reverse_rep_entry($1, '')`, [pay.id])).rejects.toThrow(/reason/)
    const rev = await call(OWNER, `select reverse_rep_entry($1, 'Cheque bounced')`, [pay.id])
    expect(rev.balance).toBe(1500)
    await expect(call(OWNER, `select reverse_rep_entry($1, 'again')`, [pay.id])).rejects.toThrow(/already been reversed/)
    await expect(call(OWNER, `select reverse_rep_entry($1, 'again')`, [rev.id])).rejects.toThrow(/cannot itself be reversed/)
  })

  it('the ledger is append-only, even for server code, and closed to direct writes from the browser', async () => {
    const e = await one('select id from rep_ledger_entries limit 1')
    await expect(db.query('delete from rep_ledger_entries where id = $1', [e.id])).rejects.toThrow(/append-only/)
    await expect(db.query(`update rep_ledger_entries set debit = 1 where id = $1`, [e.id])).rejects.toThrow(/append-only/)
    await expect(as(OWNER, (q) => q(`insert into rep_ledger_entries (company_id, representative_id, entry_no, entry_type, entry_date, description, operating_model)
      values ($1, $2, 'X', 'payment', current_date, 'x', 'centralised')`, [CO, rep.ada]))).rejects.toThrow(/permission denied/)
    await expect(as(OWNER, (q) => q('update company_representatives set status = $1', ['inactive']))).rejects.toThrow(/permission denied/)
  })
})

describe('statements', () => {
  it('opening balance, chronological entries with a running balance, and a closing balance that carries forward', async () => {
    const back = await call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb, $4::date)', [CO, rep.bayo, j([{ product_id: P.para, qty: 2, unit_value: 250 }]), '2026-01-15'])
    expect(back.status).toBe('posted')
    const jan = await call(OWNER, 'select rep_statement($1, $2::date, $3::date)', [rep.bayo, '2026-01-01', '2026-01-31'])
    expect(jan).toMatchObject({ opening_balance: 0, closing_balance: 500, position: 'owes', currency: 'NGN' })
    const now = await call(OWNER, 'select rep_statement($1, $2::date, $3::date)', [rep.bayo, '2026-02-01', TODAY])
    expect(now.opening_balance).toBe(500) // January's closing carries forward
    expect(now.closing_balance).toBe(3200)
    expect(now.entries.map((e) => e.running_balance)).toEqual([3200])

    const ada = await call(OWNER, 'select rep_statement($1, $2::date, $3::date)', [rep.ada, '2026-01-01', TODAY])
    expect(ada.representative).toMatchObject({ full_name: 'Ada Obi', rep_code: 'REP-001' })
    expect(ada.company).toMatchObject({ name: 'Zenith Pharma Ltd' })
    expect(ada.totals).toMatchObject({ supplies: 10000, payments: 5000, returns: 1600, transfers_out: 2700, adjustments_credit: 200, adjustments_debit: 1000 })
    expect(ada.closing_balance).toBe(1500)
    const last = ada.entries[ada.entries.length - 1]
    expect(last.running_balance).toBe(ada.closing_balance)
    expect(ada.entries[0]).toMatchObject({ entry_type: 'supply', debit: 10000, running_balance: 10000 })
    expect(ada.entries[0].lines).toHaveLength(2)
  })

  it('the consolidated summary adds up every representative', async () => {
    const s = await call('viewer@co.com', 'select rep_ledger_summary($1, $2::date, $3::date)', [CO, '2026-01-01', TODAY])
    const byName = Object.fromEntries(s.representatives.map((r) => [r.full_name, r]))
    expect(byName['Ada Obi'].closing_balance).toBe(1500)
    expect(byName['Bayo Ade'].closing_balance).toBe(3200)
    expect(s.totals.closing_balance).toBe(4700)
  })

  it('a rep reads only their own statement; staff without the permission and other companies read none', async () => {
    expect((await call('ada@co.com', 'select rep_statement($1, $2::date, $3::date)', [rep.ada, '2026-01-01', TODAY])).closing_balance).toBe(1500)
    await expect(call('ada@co.com', 'select rep_statement($1, $2::date, $3::date)', [rep.bayo, '2026-01-01', TODAY])).rejects.toThrow(/not found/)
    await expect(call('clerk@co.com', 'select rep_statement($1, $2::date, $3::date)', [rep.ada, '2026-01-01', TODAY])).rejects.toThrow(/not found/)
    await expect(call('other@x.com', 'select rep_ledger_summary($1, $2::date, $3::date)', [CO, '2026-01-01', TODAY])).rejects.toThrow(/do not have permission/)
    expect((await as('ada@co.com', (q) => q('select distinct representative_id from rep_ledger_entries'))).map((r) => r.representative_id)).toEqual([rep.ada])
    expect(await as('clerk@co.com', (q) => q('select id from rep_ledger_entries'))).toEqual([])
  })
})

describe('switching Centralised → Decentralised', () => {
  let preview

  it('only the owner previews; the summary lists balances, custody, blockers and warnings', async () => {
    await expect(call('mgr@co.com', `select operating_model_preview($1, 'decentralised')`, [CO])).rejects.toThrow(/Only the company owner/)
    await expect(call(OWNER, `select operating_model_preview($1, 'centralised')`, [CO])).rejects.toThrow(/already runs/)
    await db.query(`insert into sales (business_id, is_on_hold, cashier_staff_id) values ($1, true, $2)`, [CO, S.ada])
    const pend = await call(OWNER, 'select record_rep_return($1, $2, $3::jsonb, $4, false)', [CO, rep.bayo, j([{ product_id: P.amox, qty: 1, unit_value: 900 }]), 'good'])
    preview = await call(OWNER, `select operating_model_preview($1, 'decentralised')`, [CO])
    expect(preview.blockers.map((b) => b.code).sort()).toEqual(['pending_entries', 'rep_without_login'])
    expect(preview.warnings.map((w) => w.code)).toEqual(['held_sales_stay'])
    const ada = preview.representatives.find((r) => r.id === rep.ada)
    expect(ada).toMatchObject({ balance: 1500, converts: true, reuses_account: false })
    expect(ada.stock.find((s) => s.company_product_id === P.amox)).toMatchObject({ custody: 4, company_stock: 99, carry: 4 })
    await expect(call(OWNER, `select switch_operating_model($1, 'decentralised', $2)`, [CO, preview.token])).rejects.toThrow(/Resolve the items/)
    await call(OWNER, `select decide_rep_entry($1, 'reject', 'Wrong rep')`, [pend.id])
    await call(OWNER, 'select set_representative_status($1, $2)', [rep.chi, 'inactive'])
  })

  it('a stale summary is refused', async () => {
    await expect(call(OWNER, `select switch_operating_model($1, 'decentralised', $2)`, [CO, preview.token])).rejects.toThrow(/changed since you reviewed/)
  })

  it('converts each active rep into an independent account, moves the planned custody, and keeps balances and history', async () => {
    const entriesBefore = (await one('select count(*)::int n from rep_ledger_entries')).n
    preview = await call(OWNER, `select operating_model_preview($1, 'decentralised')`, [CO])
    expect(preview.blockers).toEqual([])
    const res = await call(OWNER, `select switch_operating_model($1, 'decentralised', $2, $3::jsonb, 'Going independent')`,
      [CO, preview.token, j([{ representative_id: rep.ada, company_product_id: P.amox, qty: 2 }])])
    expect(res).toMatchObject({ from: 'centralised', to: 'decentralised', converted: 2 })
    expect((await one('select operating_model from businesses where id = $1', [CO])).operating_model).toBe('decentralised')

    const ada = await one('select * from company_representatives where id = $1', [rep.ada])
    const acct = await one('select * from businesses where id = $1', [ada.rep_account_id])
    expect(acct).toMatchObject({ parent_business_id: CO, account_kind: 'rep_account', visible_on_carefind: false, email: null, business_type: 'manufacturer_importer' })
    expect(await one('select business_id, role from staff where id = $1', [S.ada])).toEqual({ business_id: ada.rep_account_id, role: 'Owner' })
    expect(ada.company_role).toBe('Medical sales rep')
    expect(await one('select business_id from staff where id = $1', [S.chi])).toEqual({ business_id: CO }) // inactive: stays

    // Ada's plan: 2 of 4 Amoxil; Paracetamol (5) moves in full. Bayo's 3 Amoxil move in full.
    expect(await accountStock(ada.rep_account_id, M.amox)).toBe(2)
    expect(await accountStock(ada.rep_account_id, M.para)).toBe(5)
    expect(await stock(P.amox)).toBe(99 - 2 - 3)
    expect(await stock(P.para)).toBe(50 - 5 - 2)
    expect(await custody(rep.ada, P.amox)).toBe(0)
    expect((await one('select list_on_carefind, price, price_source from products where business_id = $1 and master_product_id = $2', [ada.rep_account_id, M.amox])))
      .toEqual({ list_on_carefind: false, price: '1200', price_source: 'branch' })

    expect([await balance(rep.ada), await balance(rep.bayo)]).toEqual([1500, 3200])
    expect((await one('select count(*)::int n from rep_ledger_entries')).n).toBe(entriesBefore)
    const change = await one('select * from operating_model_changes where id = $1', [res.change_id])
    expect(change).toMatchObject({ from_model: 'centralised', to_model: 'decentralised', note: 'Going independent', initiated_by_name: 'Mrs Owner' })
    expect(change.summary.token).toBe(preview.token)
    expect((await one(`select count(*)::int n from staff_notifications where staff_id = $1 and kind = 'operating_model_changed'`, [S.ada])).n).toBe(1)
    await expect(db.query('delete from operating_model_changes where id = $1', [res.change_id])).rejects.toThrow(/cannot be changed/)
  })
})

describe('Decentralised: independent accounts and privacy', () => {
  let adaAcct, bayoAcct
  beforeAll(async () => {
    adaAcct = (await one('select rep_account_id from company_representatives where id = $1', [rep.ada])).rep_account_id
    bayoAcct = (await one('select rep_account_id from company_representatives where id = $1', [rep.bayo])).rep_account_id
  })

  it('a rep reaches only their own account: not the company\'s records, not another rep\'s', async () => {
    const ids = await as('ada@co.com', (q) => q('select current_business_ids() id'))
    expect(ids.map((r) => r.id)).toEqual([adaAcct])
    expect(await as('ada@co.com', (q) => q('select id from products where business_id in ($1, $2)', [CO, bayoAcct]))).toEqual([])
    expect((await as('ada@co.com', (q) => q('select id, account_kind from businesses where id = $1', [adaAcct])))).toEqual([{ id: adaAcct, account_kind: 'rep_account' }])
    expect(await as('ada@co.com', (q) => q('select id from businesses where id = $1', [bayoAcct]))).toEqual([])
  })

  it('a rep sets their own selling price; the company\'s price and the agreed supply value are untouched', async () => {
    await as('ada@co.com', (q) => q(`update products set price = 1500 where business_id = $1 and master_product_id = $2`, [adaAcct, M.amox]))
    expect(await accountStock(adaAcct, M.amox)).toBe(2)
    expect((await one('select price from products where id = $1', [P.amox])).price).toBe('1200')
  })

  it('a rep views the company catalogue (names and prices only) but cannot sell through the company account', async () => {
    const cat = await call('ada@co.com', 'select rep_company_catalog($1)', ['amox'])
    expect(cat.company.name).toBe('Zenith Pharma Ltd')
    expect(cat.products).toEqual([expect.objectContaining({ id: P.amox, name: 'Amoxil 500', price: 1200 })])
    expect(cat.products[0]).not.toHaveProperty('stock')
    expect(cat.products[0]).not.toHaveProperty('cost_price')
    await expect(as('ada@co.com', (q) => q(`insert into sales (business_id, is_on_hold) values ($1, false)`, [CO]))).rejects.toThrow(/row-level security/)
    await expect(call('clerk@co.com', 'select rep_company_catalog()')).rejects.toThrow(/Only the company's representatives/)
  })

  it('a supply moves stock from the company into the rep account and raises the balance', async () => {
    const r = await call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb)', [CO, rep.ada, j([{ product_id: P.amox, qty: 10, unit_value: 900 }])])
    expect(r.balance).toBe(10500)
    expect(await stock(P.amox)).toBe(84)
    expect(await accountStock(adaAcct, M.amox)).toBe(12)
    const mv = await rows('select business_id, quantity, movement_type, source_type, idempotency_key from stock_movements where source_id = $1 order by quantity', [r.id])
    expect(mv.map((m) => [m.business_id, m.quantity, m.movement_type, m.source_type])).toEqual([[CO, -10, 'transfer', 'rep_supply'], [adaAcct, 10, 'transfer', 'rep_supply']])
    expect((await one('select rep_product_id from rep_ledger_lines where entry_id = $1', [r.id])).rep_product_id).toBeTruthy()
    await expect(call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb)', [CO, rep.ada, j([{ product_id: P.loose, qty: 1, unit_value: 300 }])])).rejects.toThrow(/not linked to the master catalogue/)
    await expect(call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb)', [CO, rep.ada, j([{ product_id: P.amox, qty: 500, unit_value: 900 }])])).rejects.toThrow(/INSUFFICIENT_STOCK/)
    expect(await balance(rep.ada)).toBe(10500)
  })

  it('an accepted good return moves stock back; a transfer moves it between the two accounts', async () => {
    const ret = await call(OWNER, 'select record_rep_return($1, $2, $3::jsonb, $4)', [CO, rep.ada, j([{ product_id: P.amox, qty: 2, unit_value: 900 }]), 'good'])
    expect(ret.balance).toBe(8700)
    expect([await stock(P.amox), await accountStock(adaAcct, M.amox)]).toEqual([86, 10])
    const tr = await call(OWNER, 'select record_rep_transfer($1, $2, $3, $4::jsonb, $5)', [CO, rep.ada, rep.bayo, j([{ product_id: P.amox, qty: 4, unit_value: 900 }]), 'Rebalance'])
    expect(tr).toMatchObject({ balance: 5100, receiver_balance: 6800 })
    expect([await accountStock(adaAcct, M.amox), await accountStock(bayoAcct, M.amox)]).toEqual([6, 7])
    await expect(call(OWNER, 'select record_rep_transfer($1, $2, $3, $4::jsonb, $5)', [CO, rep.ada, rep.bayo, j([{ product_id: P.amox, qty: 60, unit_value: 1 }]), 'Too many'])).rejects.toThrow(/INSUFFICIENT_STOCK/)
  })

  it('reversing a supply takes the stock back out of the rep account', async () => {
    const r = await call(OWNER, 'select record_rep_supply($1, $2, $3::jsonb)', [CO, rep.bayo, j([{ product_id: P.para, qty: 3, unit_value: 200 }])])
    expect(await accountStock(bayoAcct, M.para)).toBe(5)
    await call(OWNER, `select reverse_rep_entry($1, 'Wrong rep')`, [r.id])
    expect(await accountStock(bayoAcct, M.para)).toBe(2)
    expect(await balance(rep.bayo)).toBe(6800)
  })

  it('reversing either half of a transfer reverses both halves and moves the stock back, once per request key', async () => {
    const tr = await one(`select id, transfer_group from rep_ledger_entries where entry_type = 'transfer_in' and representative_id = $1 and operating_model = 'decentralised' and status = 'posted'`, [rep.bayo])
    const r = await call(OWNER, `select reverse_rep_entry($1, 'Sent to the wrong rep', 'rev-tr-1')`, [tr.id])
    expect((await call(OWNER, `select reverse_rep_entry($1, 'Sent to the wrong rep', 'rev-tr-1')`, [tr.id])).replayed).toBe(true)
    expect([await accountStock(adaAcct, M.amox), await accountStock(bayoAcct, M.amox)]).toEqual([10, 3])
    expect([await balance(rep.ada), await balance(rep.bayo)]).toEqual([8700, 3200])
    expect((await rows('select entry_type from rep_ledger_entries where reverses_entry_id in (select id from rep_ledger_entries where transfer_group = $1)', [tr.transfer_group])).length).toBe(2)
    expect(r.entry_no).toMatch(/^RL-/)
  })

  it('a rep account never becomes public on CareFind, whoever tries', async () => {
    await as(OWNER, (q) => q('update businesses set visible_on_carefind = true, ecommerce_enabled = true where id = $1', [adaAcct]))
    expect(await one('select visible_on_carefind, ecommerce_enabled from businesses where id = $1', [adaAcct])).toEqual({ visible_on_carefind: false, ecommerce_enabled: false })
    await as('ada@co.com', (q) => q('update products set list_on_carefind = true where business_id = $1', [adaAcct]))
    expect((await rows('select distinct list_on_carefind from products where business_id = $1', [adaAcct])).map((r) => r.list_on_carefind)).toEqual([false])
    await expect(as('ada@co.com', (q) => q('insert into ecommerce_products (business_id, product_id) values ($1, $2)', [adaAcct, P.amox]))).rejects.toThrow(/cannot list products on the CareFind online store/)
    // The company's own catalogue stays public.
    expect((await one('select list_on_carefind from products where id = $1', [P.amox])).list_on_carefind).toBe(true)
  })

  it('adding a representative while Decentralised gives them their own account at once', async () => {
    const r = await call(OWNER, 'select add_company_representative($1, $2)', [CO, S.clerk])
    expect(r.rep_account_id).toBeTruthy()
    expect(await one('select business_id, role from staff where id = $1', [S.clerk])).toEqual({ business_id: r.rep_account_id, role: 'Owner' })
    rep.clerk = r.id
  })
})

describe('switching Decentralised → Centralised, and forward again', () => {
  it('open held sales in a rep account block the switch', async () => {
    const adaAcct = (await one('select rep_account_id from company_representatives where id = $1', [rep.ada])).rep_account_id
    const held = (await one(`insert into sales (business_id, is_on_hold) values ($1, true) returning id`, [adaAcct])).id
    const p = await call(OWNER, `select operating_model_preview($1, 'centralised')`, [CO])
    expect(p.blockers.map((b) => b.code)).toEqual(['held_sales'])
    await db.query(`update sales set status = 'deleted' where id = $1`, [held])
  })

  it('brings every rep back as company staff, returns linked stock to the company as custody, and keeps the accounts and balances', async () => {
    const adaAcct = (await one('select rep_account_id from company_representatives where id = $1', [rep.ada])).rep_account_id
    // A product Ada bought herself, which the company does not carry, stays in her archived account.
    await db.query(`insert into products (business_id, name, stock) values ($1, 'Ada own brand', 4)`, [adaAcct])
    const bayoAcct = (await one('select rep_account_id from company_representatives where id = $1', [rep.bayo])).rep_account_id
    const before = { co: await stock(P.amox), ada: await accountStock(adaAcct, M.amox), bayo: await accountStock(bayoAcct, M.amox), balances: [await balance(rep.ada), await balance(rep.bayo)] }
    const p = await call(OWNER, `select operating_model_preview($1, 'centralised')`, [CO])
    expect(p.blockers).toEqual([])
    expect(p.warnings.map((w) => w.code)).toEqual(['unlinked_stock'])
    const res = await call(OWNER, `select switch_operating_model($1, 'centralised', $2)`, [CO, p.token])
    expect(res.converted).toBe(3)
    expect(res.exceptions.map((e) => e.product)).toEqual(['Ada own brand'])

    expect(await one('select business_id, role from staff where id = $1', [S.ada])).toEqual({ business_id: CO, role: 'Medical sales rep' })
    expect(await one('select business_id, role from staff where id = $1', [S.clerk])).toEqual({ business_id: CO, role: 'Cashier' })
    expect(await stock(P.amox)).toBe(before.co + before.ada + before.bayo) // both reps' Amoxil comes back
    expect(await custody(rep.ada, P.amox)).toBe(before.ada)
    expect(await accountStock(adaAcct, M.amox)).toBe(0)
    expect((await one(`select stock from products where business_id = $1 and name = 'Ada own brand'`, [adaAcct])).stock).toBe(4)
    expect([await balance(rep.ada), await balance(rep.bayo)]).toEqual(before.balances)
    const ada = await one('select rep_account_id, account_dormant_since from company_representatives where id = $1', [rep.ada])
    expect(ada.rep_account_id).toBe(adaAcct)
    expect(ada.account_dormant_since).not.toBeNull()
    expect((await as('ada@co.com', (q) => q('select current_business_ids() id'))).map((r) => r.id)).toEqual([CO])
  })

  it('a stock-moving entry from the Decentralised period can no longer be reversed automatically', async () => {
    const supply = await one(`select id from rep_ledger_entries where representative_id = $1 and entry_type = 'supply' and operating_model = 'decentralised' limit 1`, [rep.ada])
    await expect(call(OWNER, `select reverse_rep_entry($1, 'late')`, [supply.id])).rejects.toThrow(/changed operating model after this entry/)
  })

  it('switching forward again reuses each representative\'s account: no duplicate accounts', async () => {
    const accounts = (await one(`select count(*)::int n from businesses where account_kind = 'rep_account'`)).n
    const p = await call(OWNER, `select operating_model_preview($1, 'decentralised')`, [CO])
    expect(p.representatives.find((r) => r.id === rep.ada).reuses_account).toBe(true)
    await call(OWNER, `select switch_operating_model($1, 'decentralised', $2)`, [CO, p.token])
    expect((await one(`select count(*)::int n from businesses where account_kind = 'rep_account'`)).n).toBe(accounts)
    const ada = await one('select rep_account_id, account_dormant_since from company_representatives where id = $1', [rep.ada])
    expect(ada.account_dormant_since).toBeNull()
    expect((await one('select business_id from staff where id = $1', [S.ada])).business_id).toBe(ada.rep_account_id)
    expect((await one(`select count(*)::int n from operating_model_changes where company_id = $1`, [CO])).n).toBe(3)
  })

  it('a platform admin may switch on the company\'s behalf; another company\'s owner may not', async () => {
    await expect(call('other@x.com', `select operating_model_preview($1, 'centralised')`, [CO])).rejects.toThrow(/Only the company owner/)
    const p = await call('admin@carehub.ng', `select operating_model_preview($1, 'centralised')`, [CO])
    expect(p.from).toBe('decentralised')
  })
})
