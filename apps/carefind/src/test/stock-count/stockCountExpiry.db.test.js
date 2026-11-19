// @vitest-environment node
// carehub_20270129_stock_count_expiry on PGlite, applied over carehub_20261227_lock_stock_count_history (whose
// function body matched the live one on 2026-11-19), with the live stock ledger
// (docs/architecture/stock-ledger-live-snapshot.sql), the live shapes of stock_validation_sessions / _items, products
// and stock_movements, and the live current_business_ids() / is_platform_admin() (read 2026-11-19).
// A stock count can now correct a product's expiry date, in the same transaction as its quantity adjustment, and the
// count history records the date before and after.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const repoFile = (rel) => readFileSync(fileURLToPath(new URL('../../../../../' + rel, import.meta.url)), 'utf8')
const LEDGER_LIVE = repoFile('docs/architecture/stock-ledger-live-snapshot.sql')
const BEFORE = repoFile('supabase/migrations/carehub_20261227_lock_stock_count_history.sql')
const MIGRATION = repoFile('supabase/migrations/carehub_20270129_stock_count_expiry.sql')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const OWNER = 'owner@pharm.ng', CASHIER = 'cashier@pharm.ng', STRANGER = 'owner@other.ng'
const UID = { [OWNER]: '10000000-0000-4000-8000-000000000001', [CASHIER]: '10000000-0000-4000-8000-000000000002', [STRANGER]: '10000000-0000-4000-8000-000000000003' }
const P = { amox: 'c0000000-0000-4000-8000-000000000001', para: 'c0000000-0000-4000-8000-000000000002', svc: 'c0000000-0000-4000-8000-000000000003',
  tracked: 'c0000000-0000-4000-8000-000000000004', noexp: 'c0000000-0000-4000-8000-000000000005', theirs: 'c0000000-0000-4000-8000-000000000009' }

let db
// Runs `sql` as `email` and then `checks` as superuser, inside one transaction that is rolled back.
async function scenario(email, sql, checks = []) {
  await db.exec('begin')
  try {
    await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: UID[email], email, role: 'authenticated' })])
    await db.exec('set local role authenticated')
    const out = (await db.query(sql)).rows
    await db.exec('reset role')
    const seen = []
    for (const c of checks) seen.push((await db.query(c)).rows)
    return { out, seen }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const save = (items, biz = BIZ, key = null) =>
  `select save_stock_validation_session('${biz}', null, 'screen', ${items.length}, ${items.length}, '${JSON.stringify(items)}'::jsonb, ${key ? `'${key}'` : 'null'}) id`
const line = (product, extra = {}) => ({ product_id: product, product_name: 'Line', previous_stock: 10, adjustment_qty: 0, adjustment_direction: '+', unit_price: 100, ...extra })
const product = (id) => `select stock, expiry_date::text from products where id = '${id}'`
const lines = `select product_id, previous_stock, new_stock, previous_expiry_date::text prev_exp, new_expiry_date::text new_exp from stock_validation_items order by product_id`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, name text, email text, parent_business_id uuid, branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active');
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      with recursive visible as (
        select b.id, b.parent_business_id, b.branch_depth_limit, 0 as depth from businesses b where lower(b.email) = lower(auth.email())
        union
        select b.id, b.parent_business_id, b.branch_depth_limit, 0 from businesses b join staff s on s.business_id = b.id where lower(s.email) = lower(auth.email()) and s.status = 'active'
        union all
        select c.id, c.parent_business_id, c.branch_depth_limit, visible.depth + 1 from businesses c join visible on c.parent_business_id = visible.id where visible.depth < visible.branch_depth_limit)
      select distinct id from visible $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email()) limit 1), false) $$;
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id), name text not null, category text,
      price numeric default 0, stock integer default 0, tracking_mode text not null default 'none', expiry_date date);
    create table stock_batches (id uuid primary key default gen_random_uuid(), business_id uuid, product_id uuid, product_name text not null default '',
      batch_number text, quantity integer not null default 0, expiry_date date, status text not null default 'available', created_at timestamptz default now());
    create table stock_movements (id uuid primary key default gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid, to_location_id uuid, movement_type text,
      quantity integer, reason text, moved_by text, created_at timestamptz default now(), product_id uuid, source_type text, source_id text, source_line_id text,
      idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
      constraint stock_movements_type_check check (movement_type in ('opening','purchase_receipt','sale','sale_reversal','return_restock','return_writeoff','adjustment','write_off','transfer','tracking_change','correction')));
    -- Live shapes (2026-11-19), before this migration.
    create table stock_validation_sessions (id uuid primary key default gen_random_uuid(), business_id uuid not null, user_id uuid, user_name text not null,
      products_checked integer not null default 0, products_adjusted integer not null default 0, status text not null default 'completed',
      created_at timestamptz not null default now(), request_key text);
    create unique index stock_validation_sessions_request_key_uniq on stock_validation_sessions (business_id, request_key) where request_key is not null;
    create table stock_validation_items (id uuid primary key default gen_random_uuid(), session_id uuid not null references stock_validation_sessions(id),
      product_id uuid not null references products(id) on delete cascade, product_name text not null, shelf_label text, previous_stock integer not null default 0,
      adjustment_qty integer not null default 0, adjustment_direction text not null, new_stock integer not null default 0, reason text,
      unit_price numeric not null default 0, created_at timestamptz not null default now());
    do $$ declare t text; begin foreach t in array array['businesses','staff','products','stock_batches','stock_movements','stock_validation_sessions','stock_validation_items'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "products of own business" on products for all to authenticated using ((business_id in (select current_business_ids())) or is_platform_admin());

    insert into businesses (id, name, email) values ('${BIZ}', 'Pharm', '${OWNER}'), ('${OTHER}', 'Other', '${STRANGER}');
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Bisi Cashier', '${CASHIER}', 'Cashier');
    insert into products (id, business_id, name, category, price, stock, tracking_mode, expiry_date) values
      ('${P.amox}', '${BIZ}', 'Amoxil 500', 'Medicines', 1200, 10, 'none', '2027-01-31'),
      ('${P.para}', '${BIZ}', 'Paracetamol', 'Medicines', 300, 10, 'none', '2026-12-31'),
      ('${P.svc}', '${BIZ}', 'BP check', 'Services', 500, 0, 'none', null),
      ('${P.tracked}', '${BIZ}', 'Insulin', 'Medicines', 5000, 10, 'batch_expiry', '2027-03-01'),
      ('${P.noexp}', '${BIZ}', 'Vitamin C', 'Medicines', 500, 10, 'none', null),
      ('${P.theirs}', '${OTHER}', 'Theirs', 'Medicines', 100, 10, 'none', '2027-01-01');
  `)
  await db.exec(LEDGER_LIVE)
  await db.exec(BEFORE)
  await db.exec(MIGRATION)
})

describe('stock count corrects expiry dates (carehub_20270129)', () => {
  it('sets the new expiry and records the date before and after on the line', async () => {
    const r = await scenario(OWNER, save([line(P.amox, { new_expiry_date: '2028-06-30' })]), [product(P.amox), lines])
    expect(r.error).toBeUndefined()
    expect(r.seen[0]).toEqual([{ stock: 10, expiry_date: '2028-06-30' }])
    expect(r.seen[1]).toEqual([{ product_id: P.amox, previous_stock: 10, new_stock: 10, prev_exp: '2027-01-31', new_exp: '2028-06-30' }])
  })

  it('saves a quantity adjustment and an expiry correction together, through the ledger', async () => {
    const r = await scenario(CASHIER, save([line(P.amox, { adjustment_qty: 3, adjustment_direction: '-', new_expiry_date: '2027-05-31' })]), [
      product(P.amox),
      `select movement_type, quantity, qty_before, qty_after, source_type from stock_movements where product_id = '${P.amox}'`,
      `select user_name from stock_validation_sessions`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.seen[0]).toEqual([{ stock: 7, expiry_date: '2027-05-31' }])
    expect(r.seen[1]).toEqual([{ movement_type: 'adjustment', quantity: -3, qty_before: 10, qty_after: 7, source_type: 'stock_count' }])
    expect(r.seen[2]).toEqual([{ user_name: 'Bisi Cashier' }])
  })

  it('sets an expiry on a product that had none', async () => {
    const r = await scenario(OWNER, save([line(P.noexp, { new_expiry_date: '2027-09-30' })]), [product(P.noexp), lines])
    expect(r.seen[0]).toEqual([{ stock: 10, expiry_date: '2027-09-30' }])
    expect(r.seen[1][0]).toMatchObject({ prev_exp: null, new_exp: '2027-09-30' })
  })

  it('leaves the expiry as it is when the line has none (older screens), and records the current date', async () => {
    const r = await scenario(OWNER, save([line(P.para, { adjustment_qty: 2 })]), [product(P.para), lines])
    expect(r.seen[0]).toEqual([{ stock: 12, expiry_date: '2026-12-31' }])
    expect(r.seen[1][0]).toMatchObject({ prev_exp: '2026-12-31', new_exp: '2026-12-31' })
    const n = await scenario(OWNER, save([line(P.para, { new_expiry_date: null })]), [product(P.para)])
    expect(n.seen[0]).toEqual([{ stock: 10, expiry_date: '2026-12-31' }])
  })

  it('refuses a date that is not a real date, and saves nothing of the count', async () => {
    for (const bad of ['2027-02-30', '31/12/2027', '2027-13-01', '1999-12-31', '2101-01-01', 'soon']) {
      const r = await scenario(OWNER, save([line(P.para, { adjustment_qty: 1 }), line(P.amox, { product_name: 'Amoxil 500', new_expiry_date: bad })]))
      expect(r.error, bad).toBe('COUNT_INVALID: The expiry date for Amoxil 500 is not a valid date.')
    }
    expect((await db.query(product(P.para))).rows).toEqual([{ stock: 10, expiry_date: '2026-12-31' }])
    expect((await db.query(product(P.amox))).rows).toEqual([{ stock: 10, expiry_date: '2027-01-31' }])
  })

  it('refuses an expiry change on a batch-tracked product (dates belong to its batches)', async () => {
    const r = await scenario(OWNER, save([line(P.tracked, { new_expiry_date: '2028-01-01' })]))
    expect(r.error).toBe('BATCH_REQUIRED: Insulin is tracked by batch, so its expiry dates are set on its batches, not from a stock count.')
    // Sending its current date unchanged is not a change, so it is not refused.
    const same = await scenario(OWNER, save([line(P.tracked, { new_expiry_date: '2027-03-01' })]), [product(P.tracked)])
    expect(same.error).toBeUndefined()
  })

  it('ignores an expiry sent for a service', async () => {
    const r = await scenario(OWNER, save([line(P.svc, { new_expiry_date: '2027-01-01' })]), [product(P.svc), lines])
    expect(r.error).toBeUndefined()
    expect(r.seen[0]).toEqual([{ stock: 0, expiry_date: null }])
    expect(r.seen[1][0]).toMatchObject({ prev_exp: null, new_exp: null })
  })

  it('cannot reach another business: their products are not found, nothing changes', async () => {
    const r = await scenario(OWNER, save([line(P.theirs, { product_name: 'Theirs', new_expiry_date: '2030-01-01' })]))
    expect(r.error).toBe('PRODUCT_NOT_FOUND: Theirs is no longer in this inventory. Remove it from the count and save again.')
    const s = await scenario(STRANGER, save([line(P.amox, { new_expiry_date: '2030-01-01' })]))
    expect(s.error).toBe('COUNT_FORBIDDEN: You can only save stock counts for your own business.')
    expect((await db.query(product(P.theirs))).rows).toEqual([{ stock: 10, expiry_date: '2027-01-01' }])
  })

  it('a retried count (same request key) does not apply twice', async () => {
    await db.exec('begin')
    try {
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: UID[OWNER], email: OWNER, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      const items = [line(P.amox, { adjustment_qty: 1, new_expiry_date: '2029-01-31' })]
      const a = (await db.query(save(items, BIZ, 'k1'))).rows[0].id
      const b = (await db.query(save(items, BIZ, 'k1'))).rows[0].id
      await db.exec('reset role')
      expect(b).toBe(a)
      expect((await db.query(product(P.amox))).rows).toEqual([{ stock: 11, expiry_date: '2029-01-31' }])
      expect((await db.query('select count(*)::int n from stock_validation_items')).rows[0].n).toBe(1)
    } finally { await db.exec('rollback') }
  })

  it('history stays read-only for members; anon cannot run the count', async () => {
    const w = await scenario(OWNER, `update stock_validation_items set new_expiry_date = '2030-01-01' returning id`)
    expect(w.error).toMatch(/permission denied/)
    const priv = (await db.query(`select has_function_privilege('anon', 'save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb, text)', 'execute') a,
      has_function_privilege('authenticated', 'save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb, text)', 'execute') b`)).rows[0]
    expect(priv).toEqual({ a: false, b: true })
  })
})
