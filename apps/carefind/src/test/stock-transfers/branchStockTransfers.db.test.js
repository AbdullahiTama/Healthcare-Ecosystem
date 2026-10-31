// @vitest-environment node
// carehub_20261222_branch_stock_transfers, then carehub_20261228_branch_transfers_ledger (stock through
// apply_stock_change), on PGlite, with the live shapes of businesses, staff, products, master_products,
// branch_products, stock_batches, stock_movements, staff_notifications and stock_transfers, the live
// current_business_ids(), is_business_manager(), the live stock ledger (docs/architecture/stock-ledger-live-snapshot.sql)
// and business_root() from carehub_20261215.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const repoFile = (rel) => readFileSync(fileURLToPath(new URL('../../../../../' + rel, import.meta.url)), 'utf8')
const MIGRATION = repoFile('supabase/migrations/carehub_20261222_branch_stock_transfers.sql')
const LEDGER = repoFile('supabase/migrations/carehub_20261228_branch_transfers_ledger.sql')
const LEDGER_LIVE = repoFile('docs/architecture/stock-ledger-live-snapshot.sql')

const MAIN = 'a0000000-0000-4000-8000-000000000001'
const IKEJA = 'a0000000-0000-4000-8000-000000000002'
const YABA = 'a0000000-0000-4000-8000-000000000003'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const M = { amox: 'c0000000-0000-4000-8000-000000000001', para: 'c0000000-0000-4000-8000-000000000002', vitc: 'c0000000-0000-4000-8000-000000000003',
  theirs: 'c0000000-0000-4000-8000-000000000009' }
let db

async function as(email, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '10000000-0000-4000-8000-000000000001', email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally {
    await db.query('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`)
  }
}
const one = async (s, p) => (await db.query(s, p)).rows[0]
const stock = async (branch, master) => (await one('select stock from products where business_id = $1 and master_product_id = $2', [branch, master]))?.stock
const lines = (arr) => JSON.stringify(arr)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, name text, branch_name text, email text, parent_business_id uuid, branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active');
    create table master_products (id uuid primary key, business_id uuid references businesses(id), name text not null, category text default '', default_price integer default 0,
      generic_name text, barcode text, rx_status text default 'pharmacy_only', default_cost numeric default 0, reorder_level integer default 5, archived_at timestamptz);
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id), name text not null, generic_name text, category text,
      price numeric default 0, cost_price numeric default 0, stock integer default 0, reorder_level integer default 5, barcode text, sale_type text, list_on_carefind boolean default true,
      emoji text, master_product_id uuid references master_products(id), rx_status text, price_source text default 'master',
      tracking_mode text not null default 'none');
    create table stock_batches (id uuid primary key default gen_random_uuid(), business_id uuid, product_id uuid, product_name text not null default '',
      batch_number text, quantity integer not null default 0, expiry_date date, status text not null default 'available', created_at timestamptz default now());
    create table branch_products (id uuid primary key default gen_random_uuid(), branch_id uuid not null, master_product_id uuid not null, active boolean default true not null,
      override_price integer, unique (branch_id, master_product_id));
    create table stock_movements (id uuid primary key default gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid, to_location_id uuid, movement_type text,
      quantity integer, reason text, moved_by text, created_at timestamptz default now(), product_id uuid, source_type text, source_id text, source_line_id text,
      idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
      constraint stock_movements_type_check check (movement_type in ('opening','purchase_receipt','sale','sale_reversal','return_restock','return_writeoff','adjustment','write_off','transfer','tracking_change','correction')));
    create table staff_notifications (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid, is_owner boolean, kind text not null, title text not null,
      body text, link text, read_at timestamptz, created_at timestamptz default now());
    -- live (carehub_20260810), unused
    create table stock_transfers (id uuid primary key default gen_random_uuid(), from_branch_id uuid not null references businesses(id), to_branch_id uuid not null references businesses(id),
      product_id uuid not null, product_name text not null default '', quantity integer not null check (quantity > 0), status text not null default 'pending',
      requested_by uuid not null, approved_by uuid, notes text default '', created_at timestamptz not null default now(), resolved_at timestamptz);
    -- live definitions
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
    create function is_business_manager(bid uuid) returns boolean language sql stable security definer set search_path = public as $$
      with recursive ancestry as (
        select b.id, b.parent_business_id, b.email, 0 as depth from businesses b where b.id = bid
        union all select p.id, p.parent_business_id, p.email, a.depth + 1 from businesses p join ancestry a on p.id = a.parent_business_id where a.depth < 10)
      select (bid in (select current_business_ids()) and (exists (select 1 from ancestry a where lower(a.email) = lower(auth.email()))
        or exists (select 1 from staff s where s.business_id = bid and lower(s.email) = lower(auth.email()) and s.status = 'active' and s.role ~* 'manager')))
        or public.is_platform_admin() $$;
    create function business_root(p_business_id uuid) returns uuid language sql stable security definer set search_path = public, pg_temp as $$
      with recursive up(id, parent_business_id, depth) as (
        select b.id, b.parent_business_id, 0 from public.businesses b where b.id = p_business_id
        union all select p.id, p.parent_business_id, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id where up.depth < 10)
      select id from up where parent_business_id is null limit 1 $$;
    create function enforce_product_stock_floor() returns trigger language plpgsql as $$
      begin if new.stock < 0 and (tg_op = 'INSERT' or new.stock < coalesce(old.stock, 0)) then
        raise exception 'INSUFFICIENT_STOCK: product stock cannot be reduced below zero (would be %).', new.stock using errcode = 'check_violation'; end if; return new; end $$;
    create trigger enforce_product_stock_floor before insert or update of stock on products for each row execute function enforce_product_stock_floor();
    do $$ declare t text; begin foreach t in array array['businesses','staff','products','master_products','branch_products','stock_movements','staff_notifications','stock_transfers'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "own" on products for all to authenticated using (business_id in (select current_business_ids()));
    create policy "own" on businesses for all to authenticated using (id in (select current_business_ids()));
    create policy "stock_transfers tenant visibility" on stock_transfers using (from_branch_id in (select current_business_ids()) or to_branch_id in (select current_business_ids()) or is_platform_admin());

    insert into businesses (id, name, branch_name, email, parent_business_id) values
      ('${MAIN}', 'Allen Pharmacy', null, 'owner@allen.com', null), ('${IKEJA}', 'Allen · Ikeja', 'Ikeja', 'ikeja@allen.com', '${MAIN}'),
      ('${YABA}', 'Allen · Yaba', 'Yaba', 'yaba@allen.com', '${MAIN}'), ('${OTHER}', 'Other', null, 'other@x.com', null);
    insert into staff (business_id, full_name, email, role) values
      ('${IKEJA}', 'Bola Manager', 'bola@allen.com', 'Branch Manager'), ('${IKEJA}', 'Tunde Cashier', 'tunde@allen.com', 'Cashier'),
      ('${YABA}', 'Ada Cashier', 'ada@allen.com', 'Cashier');
    insert into master_products (id, business_id, name, default_price, default_cost, rx_status) values
      ('${M.amox}', '${MAIN}', 'Amoxil 500', 1200, 900, 'prescription_only'), ('${M.para}', '${MAIN}', 'Paracetamol', 300, 200, 'otc'),
      ('${M.vitc}', '${MAIN}', 'Vitamin C', 500, 300, 'otc'), ('${M.theirs}', '${OTHER}', 'Theirs', 100, 50, 'otc');
    insert into products (business_id, name, price, cost_price, stock, master_product_id) values
      ('${IKEJA}', 'Amoxil 500', 1200, 900, 40, '${M.amox}'), ('${IKEJA}', 'Paracetamol', 300, 200, 10, '${M.para}'),
      ('${YABA}', 'Amoxil 500', 1250, 900, 2, '${M.amox}'), ('${IKEJA}', 'Vitamin C', 500, 300, 6, '${M.vitc}');
  `)
  await db.exec(LEDGER_LIVE)
  await db.exec(MIGRATION)
  await db.exec(LEDGER)
})

const moves = (transferId) => db.query(`select m.*, p.business_id as product_business from stock_movements m join products p on p.id = m.product_id
  where m.source_id = $1 order by m.created_at, m.source_type, m.quantity`, [transferId]).then((r) => r.rows)

describe('send', () => {
  it('a branch manager sends stock: it leaves the branch at once, is in transit, recorded on both lines and the ledger', async () => {
    const r = await as('bola@allen.com', (q) => q(`select send_stock_transfer($1, $2, $3::jsonb, 'Weekly top-up') r`,
      [IKEJA, YABA, lines([{ master_product_id: M.amox, qty: 15 }, { master_product_id: M.vitc, qty: 4 }])]))
    expect(r[0].r).toMatchObject({ lines: 2 })
    expect(r[0].r.transfer_no).toMatch(/^TRF-\d{6}-[0-9A-F]{5}$/)
    expect(await stock(IKEJA, M.amox)).toBe(25)
    expect(await stock(IKEJA, M.vitc)).toBe(2)
    const t = await one(`select * from stock_transfers where transfer_no = $1`, [r[0].r.transfer_no])
    expect(t).toMatchObject({ status: 'in_transit', from_branch_id: IKEJA, to_branch_id: YABA, business_id: MAIN, sent_by_name: 'Bola Manager', notes: 'Weekly top-up' })
    const mv = await one(`select quantity, qty_before, qty_after, source_type, movement_type, source_line_id, idempotency_key, moved_by from stock_movements
      where source_id = $1 and product_id = (select id from products where business_id = $2 and master_product_id = $3)`, [t.id, IKEJA, M.amox])
    const line = await one(`select id from stock_transfer_lines where transfer_id = $1 and master_product_id = $2`, [t.id, M.amox])
    // A decrease is negative in the ledger, as for a sale (before carehub_20261228 this was +15).
    expect(mv).toEqual({ quantity: -15, qty_before: 40, qty_after: 25, source_type: 'branch_transfer_out', movement_type: 'transfer',
      source_line_id: line.id, idempotency_key: `transfer:${t.id}:${line.id}:out`, moved_by: 'bola@allen.com' })
    const note = await one(`select title, body from staff_notifications where business_id = $1 and kind = 'stock_transfer_sent'`, [YABA])
    expect(note.body).toContain('2 items sent from Ikeja')
  })

  it('refuses a cashier, more than is in stock, an item the branch does not carry, another business and the same location', async () => {
    const send = (email, from, to, l) => as(email, (q) => q('select send_stock_transfer($1, $2, $3::jsonb)', [from, to, lines(l)]))
    await expect(send('tunde@allen.com', IKEJA, YABA, [{ master_product_id: M.para, qty: 1 }])).rejects.toThrow(/owner or a manager/)
    await expect(send('bola@allen.com', IKEJA, YABA, [{ master_product_id: M.para, qty: 11 }])).rejects.toThrow(/Only 10 of Paracetamol in stock at Ikeja/)
    await expect(send('owner@allen.com', YABA, IKEJA, [{ master_product_id: M.para, qty: 1 }])).rejects.toThrow(/not carried at Yaba/)
    await expect(send('owner@allen.com', IKEJA, OTHER, [{ master_product_id: M.para, qty: 1 }])).rejects.toThrow(/same business/)
    await expect(send('owner@allen.com', IKEJA, IKEJA, [{ master_product_id: M.para, qty: 1 }])).rejects.toThrow(/two different locations/)
    await expect(send('owner@allen.com', IKEJA, YABA, [{ master_product_id: M.para, qty: 0 }])).rejects.toThrow(/greater than zero/)
    await expect(send('owner@allen.com', IKEJA, YABA, [{ master_product_id: M.para, qty: 1 }, { master_product_id: M.para, qty: 2 }])).rejects.toThrow(/listed twice/)
    // nothing moved
    expect(await stock(IKEJA, M.para)).toBe(10)
    expect((await one(`select count(*)::int n from stock_transfers`)).n).toBe(1)
  })

  it('nobody can write the transfer tables directly', async () => {
    await expect(as('owner@allen.com', (q) => q(`update stock_transfers set status = 'received'`))).rejects.toThrow()
    await expect(as('owner@allen.com', (q) => q(`insert into stock_transfer_lines (transfer_id, product_name, qty_sent) select id, 'x', 1 from stock_transfers limit 1`))).rejects.toThrow()
  })
})

describe('receive', () => {
  it('any staff member of the receiving branch receives; a shortfall is recorded and the sender told', async () => {
    const t = await one(`select id from stock_transfers where status = 'in_transit'`)
    const l = await one(`select id from stock_transfer_lines where transfer_id = $1 and master_product_id = $2`, [t.id, M.amox])
    // the sender's own cashier cannot receive at Yaba
    await expect(as('tunde@allen.com', (q) => q('select receive_stock_transfer($1)', [t.id]))).rejects.toThrow(/Transfer not found/)
    const r = await as('ada@allen.com', (q) => q(`select receive_stock_transfer($1, $2::jsonb, 'One box damaged') r`, [t.id, lines([{ line_id: l.id, qty_received: 13 }])]))
    expect(r[0].r).toMatchObject({ shortfall: 2 })
    expect(await stock(YABA, M.amox)).toBe(15) // 2 + 13
    // Vitamin C was not carried at Yaba: created from the master item, at the master price, with what arrived
    expect(await one(`select stock, price::int, price_source from products where business_id = $1 and master_product_id = $2`, [YABA, M.vitc]))
      .toEqual({ stock: 4, price: 500, price_source: 'master' })
    expect((await one(`select active from branch_products where branch_id = $1 and master_product_id = $2`, [YABA, M.vitc])).active).toBe(true)
    expect(await one(`select status, received_by_name, receive_note from stock_transfers where id = $1`, [t.id]))
      .toEqual({ status: 'received', received_by_name: 'Ada Cashier', receive_note: 'One box damaged' })
    expect((await one(`select qty_received from stock_transfer_lines where id = $1`, [l.id])).qty_received).toBe(13)
    expect((await one(`select body from staff_notifications where business_id = $1 and kind = 'stock_transfer_short'`, [IKEJA])).body).toContain('2 units did not arrive')
    expect((await one(`select qty_before, qty_after from stock_movements where source_type = 'branch_transfer_in' and business_id = $1 and quantity = 13`, [YABA])))
      .toEqual({ qty_before: 2, qty_after: 15 })
  })

  it('cannot be received twice, or cancelled once received', async () => {
    const t = await one(`select id from stock_transfers where status = 'received'`)
    await expect(as('ada@allen.com', (q) => q('select receive_stock_transfer($1)', [t.id]))).rejects.toThrow(/already received/)
    await expect(as('owner@allen.com', (q) => q('select cancel_stock_transfer($1)', [t.id]))).rejects.toThrow(/Only a transfer still in transit/)
  })

  it('refuses a received quantity above what was sent', async () => {
    const r = await as('owner@allen.com', (q) => q('select send_stock_transfer($1, $2, $3::jsonb) r', [IKEJA, YABA, lines([{ master_product_id: M.para, qty: 3 }])]))
    const l = await one(`select id from stock_transfer_lines where transfer_id = $1`, [r[0].r.id])
    await expect(as('ada@allen.com', (q) => q('select receive_stock_transfer($1, $2::jsonb)', [r[0].r.id, lines([{ line_id: l.id, qty_received: 4 }])]))).rejects.toThrow(/between 0 and 3/)
  })
})

describe('cancel', () => {
  it('the sender\'s manager cancels a transfer in transit and the stock returns', async () => {
    const t = await one(`select id from stock_transfers where status = 'in_transit'`)
    expect(await stock(IKEJA, M.para)).toBe(7)
    await expect(as('ada@allen.com', (q) => q('select cancel_stock_transfer($1)', [t.id]))).rejects.toThrow(/owner or a manager of the sending location/)
    await as('bola@allen.com', (q) => q(`select cancel_stock_transfer($1, 'Wrong branch')`, [t.id]))
    expect(await stock(IKEJA, M.para)).toBe(10)
    expect(await one(`select status, cancel_reason from stock_transfers where id = $1`, [t.id])).toEqual({ status: 'cancelled', cancel_reason: 'Wrong branch' })
    expect((await one(`select count(*)::int n from stock_movements where source_type = 'branch_transfer_cancel'`)).n).toBe(1)
  })
})

describe('stock ledger (carehub_20261228)', () => {
  it('each product\'s movements chain: one row\'s after is the next row\'s before, and they sum to the stock', async () => {
    const rows = (await db.query(`select product_id, quantity, qty_before, qty_after from stock_movements order by created_at, id`)).rows
    const byProduct = {}
    for (const r of rows) (byProduct[r.product_id] ||= []).push(r)
    for (const [productId, list] of Object.entries(byProduct)) {
      for (let i = 1; i < list.length; i++) expect(list[i].qty_before).toBe(list[i - 1].qty_after)
      const last = list[list.length - 1]
      expect((await one('select stock from products where id = $1', [productId])).stock).toBe(last.qty_after)
      for (const r of list) expect(r.qty_after - r.qty_before).toBe(r.quantity)
    }
  })

  it('a received transfer moved exactly what was sent out of one branch and what arrived into the other', async () => {
    const t = await one(`select id from stock_transfers where status = 'received'`)
    const m = await moves(t.id)
    const out = m.filter((r) => r.source_type === 'branch_transfer_out'), inn = m.filter((r) => r.source_type === 'branch_transfer_in')
    expect(out.every((r) => r.product_business === IKEJA && r.quantity < 0)).toBe(true)
    expect(inn.every((r) => r.product_business === YABA && r.quantity > 0)).toBe(true)
    expect(out.reduce((a, r) => a - r.quantity, 0)).toBe(19)   // 15 + 4 sent
    expect(inn.reduce((a, r) => a + r.quantity, 0)).toBe(17)   // 13 + 4 arrived, 2 short
  })

  it('a batch-tracked product is refused instead of moving without its batches', async () => {
    await db.query(`update products set tracking_mode = 'batch_only' where business_id = $1 and master_product_id = $2`, [IKEJA, M.para])
    await expect(as('bola@allen.com', (q) => q('select send_stock_transfer($1, $2, $3::jsonb)', [IKEJA, YABA, lines([{ master_product_id: M.para, qty: 1 }])])))
      .rejects.toThrow(/Paracetamol is tracked by batch, so it cannot be sent between locations yet/)
    expect(await stock(IKEJA, M.para)).toBe(10)
    await db.query(`update products set tracking_mode = 'none' where business_id = $1 and master_product_id = $2`, [IKEJA, M.para])

    const r = await as('bola@allen.com', (q) => q('select send_stock_transfer($1, $2, $3::jsonb) r', [IKEJA, YABA, lines([{ master_product_id: M.amox, qty: 1 }])]))
    await db.query(`update products set tracking_mode = 'batch_only' where business_id = $1 and master_product_id = $2`, [YABA, M.amox])
    await expect(as('ada@allen.com', (q) => q('select receive_stock_transfer($1)', [r[0].r.id]))).rejects.toThrow(/tracked by batch here/)
    expect(await stock(YABA, M.amox)).toBe(15)
    expect((await one('select status from stock_transfers where id = $1', [r[0].r.id])).status).toBe('in_transit')
    await db.query(`update products set tracking_mode = 'none' where business_id = $1 and master_product_id = $2`, [YABA, M.amox])
    await as('bola@allen.com', (q) => q('select cancel_stock_transfer($1)', [r[0].r.id]))
    expect(await stock(IKEJA, M.amox)).toBe(25)
  })

  it('every transfer movement was written by apply_stock_change (each has its key)', async () => {
    const n = await one(`select count(*)::int total, count(*) filter (where idempotency_key like 'transfer:%')::int keyed from stock_movements where source_type like 'branch_transfer%'`)
    expect(n.total).toBeGreaterThan(0)
    expect(n.keyed).toBe(n.total)
  })
})

describe('visibility', () => {
  it('both branches and the owner see a transfer; another business does not', async () => {
    const n = (email) => as(email, (q) => q('select count(*)::int n from stock_transfers')).then((r) => r[0].n)
    expect(await n('ada@allen.com')).toBe(3)
    expect(await n('tunde@allen.com')).toBe(3)
    expect(await n('owner@allen.com')).toBe(3)
    expect(await n('other@x.com')).toBe(0)
    const ln = await as('ada@allen.com', (q) => q('select count(*)::int n from stock_transfer_lines'))
    expect(ln[0].n).toBe(4)
  })

  it('re-running the migrations is safe', async () => {
    await db.exec(MIGRATION)
    await db.exec(LEDGER)
    expect((await one(`select count(*)::int n from stock_transfers`)).n).toBe(3)
    // re-running carehub_20261222 restores its own bodies, so carehub_20261228 must always be re-run after it
    expect((await one(`select prosrc ~ 'apply_stock_change' x from pg_proc where proname = 'send_stock_transfer'`)).x).toBe(true)
  })
})
