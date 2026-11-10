// @vitest-environment node
// carehub_20270109_inventory_bulk_delete on PGlite, with the live products foreign keys (and their ON DELETE rules),
// the live current_business_ids(), is_business_owner(), is_platform_admin() and journal_opening_stock(), and the live
// stock_movements / audit_log columns (read 2026-11-10). Bulk deletes keep products tied to customer or order records,
// write stock off in the ledger, keep a copy for restore, and are limited to the owner / delete-permission roles.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20270109_inventory_bulk_delete.sql', import.meta.url)), 'utf8')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const OWNER = 'owner@pharm.ng', MANAGER = 'manager@pharm.ng', CASHIER = 'cashier@pharm.ng', STRANGER = 'owner@other.ng'
const UID = { [OWNER]: '10000000-0000-4000-8000-000000000001', [MANAGER]: '10000000-0000-4000-8000-000000000002', [CASHIER]: '10000000-0000-4000-8000-000000000003', [STRANGER]: '10000000-0000-4000-8000-000000000004' }
const P = (n) => 'c0000000-0000-4000-8000-00000000000' + n
// P1 plain stocked, P2 plain service, P3 plain zero stock, P4 reviewed, P5 shop listing, P6 batches, P7 shop order,
// P8 stock count, P9 other business.

let db
async function as(email, sql) {
  await db.exec('begin')
  try {
    if (email) await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: UID[email], email, role: 'authenticated' })])
    await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
    const rows = (await db.query(sql)).rows
    await db.exec('reset role')
    return { rows, after: async (q) => (await db.query(q)).rows }
  } catch (e) {
    await db.exec('rollback'); return { error: e.message }
  }
}
// Runs `sql` as `email`, then `checks` (as superuser) inside the same transaction, then rolls everything back.
async function scenario(email, sql, checks = []) {
  await db.exec('begin')
  try {
    await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: UID[email], email, role: 'authenticated' })])
    await db.exec('set local role authenticated')
    const out = []
    for (const s of [].concat(sql)) out.push((await db.query(s)).rows)
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
const del = (ids, all = false, confirm = null) =>
  `select delete_products('${BIZ}', ${ids ? `array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]` : 'null'}, ${all}, ${confirm ? `'${confirm}'` : 'null'}) r`

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, name text, email text, parent_business_id uuid, branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active', auth_user_id uuid);
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb default '{}');
    insert into businesses (id, name, email) values ('${BIZ}', 'Pharm', '${OWNER}'), ('${OTHER}', 'Other', '${STRANGER}');
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Musa', '${MANAGER}', 'Manager'), ('${BIZ}', 'Bisi', '${CASHIER}', 'Cashier');
    insert into roles (business_id, name, permissions) values ('${BIZ}', 'Manager', '{"canDelete": true}'), ('${BIZ}', 'Cashier', '{"canDelete": false}');

    CREATE OR REPLACE FUNCTION public.current_business_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      WITH RECURSIVE visible AS (
        SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b WHERE lower(b.email) = lower(auth.email())
        UNION ALL
        SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1
        FROM businesses child INNER JOIN visible ON child.parent_business_id = visible.id WHERE visible.depth < visible.branch_depth_limit
      )
      SELECT id FROM visible
      UNION
      SELECT b.id FROM businesses b INNER JOIN staff s ON s.business_id = b.id WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'
    $function$;
    CREATE OR REPLACE FUNCTION public.is_business_owner(bid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
      WITH RECURSIVE ancestry AS (
        SELECT b.id, b.parent_business_id, b.email, 0 AS depth FROM public.businesses b WHERE b.id = bid
        UNION ALL
        SELECT p.id, p.parent_business_id, p.email, a.depth + 1 FROM public.businesses p JOIN ancestry a ON p.id = a.parent_business_id WHERE a.depth < 10
      )
      SELECT auth.uid() IS NOT NULL
         AND bid IN (SELECT public.current_business_ids())
         AND (
           EXISTS (SELECT 1 FROM ancestry a WHERE lower(a.email) = lower(auth.email()))
           OR EXISTS (SELECT 1 FROM public.staff s WHERE s.business_id = bid AND s.status = 'active' AND s.role = 'Owner' AND lower(s.email) = lower(auth.email()))
         )
    $function$;
    REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon, authenticated;
    CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
    $function$;

    create table products (id uuid primary key default gen_random_uuid(), business_id uuid, name text, generic_name text, category text, price numeric,
      stock integer default 0, cost_price numeric, reorder_level integer, tracking_mode text default 'none', created_at timestamptz default now());
    alter table products enable row level security;
    create policy "products of own business" on products for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    grant all on products to anon, authenticated, service_role;

    create table stock_movements (id uuid primary key default gen_random_uuid(), business_id uuid, batch_id uuid, movement_type text, quantity integer, reason text,
      moved_by text, created_at timestamptz default now(), product_id uuid, source_type text, source_id text, source_line_id text, idempotency_key text,
      actor_id uuid, qty_before integer, qty_after integer,
      check (movement_type = any (array['opening','purchase_receipt','sale','sale_reversal','return_restock','return_writeoff','adjustment','write_off','transfer','tracking_change','correction'])));
    CREATE OR REPLACE FUNCTION public.journal_opening_stock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
    BEGIN
      IF coalesce(NEW.stock, 0) > 0 AND coalesce(NEW.category, '') <> 'Services' THEN
        INSERT INTO public.stock_movements (business_id, product_id, movement_type, quantity, qty_before, qty_after, source_type, source_id, reason, actor_id, moved_by)
        VALUES (NEW.business_id, NEW.id, 'opening', NEW.stock, 0, NEW.stock, 'product_created', NEW.id::text, 'Opening stock on product creation', auth.uid(), auth.email());
      END IF;
      RETURN NEW;
    END;
    $function$;
    create trigger journal_opening_stock after insert on products for each row execute function journal_opening_stock();

    create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, actor_type text default 'staff', branch_id uuid, action text,
      target_type text, target_id uuid, metadata jsonb default '{}', created_at timestamptz default now());

    -- Live foreign keys to products and their ON DELETE rules (2026-11-10).
    create table product_reviews (id uuid primary key default gen_random_uuid(), product_id uuid references products(id) on delete cascade);
    create table stock_batches (id uuid primary key default gen_random_uuid(), product_id uuid references products(id));
    create table order_items (id uuid primary key default gen_random_uuid(), product_id uuid references products(id));
    create table out_of_stock (id uuid primary key default gen_random_uuid(), product_id uuid references products(id) on delete set null);
    create table ecommerce_products (id uuid primary key default gen_random_uuid(), product_id uuid references products(id) on delete cascade);
    create table shop_order_items (id uuid primary key default gen_random_uuid(), product_id uuid references products(id) on delete restrict);
    create table stock_validation_items (id uuid primary key default gen_random_uuid(), product_id uuid references products(id) on delete cascade);
    create table stock_transfer_lines (id uuid primary key default gen_random_uuid(), from_product_id uuid references products(id) on delete set null, to_product_id uuid references products(id) on delete set null);

    insert into products (id, business_id, name, generic_name, category, price, stock) values
      ('${P(1)}', '${BIZ}', 'Paracetamol', 'paracetamol', 'Medicines', 500, 12),
      ('${P(2)}', '${BIZ}', 'Consultation', '', 'Services', 2000, 999),
      ('${P(3)}', '${BIZ}', 'Vitamin C', '', 'Supplements', 300, 0),
      ('${P(4)}', '${BIZ}', 'Reviewed cream', '', 'Skincare', 4000, 3),
      ('${P(5)}', '${BIZ}', 'Listed soap', '', 'Skincare', 900, 5),
      ('${P(6)}', '${BIZ}', 'Batched syrup', '', 'Medicines', 1200, 0),
      ('${P(7)}', '${BIZ}', 'Ordered pills', '', 'Medicines', 800, 2),
      ('${P(8)}', '${BIZ}', 'Counted gauze', '', 'Supplies', 100, 7),
      ('${P(9)}', '${OTHER}', 'Other biz item', '', 'Medicines', 100, 1);
    insert into product_reviews (product_id) values ('${P(4)}');
    insert into ecommerce_products (product_id) values ('${P(5)}');
    insert into stock_batches (product_id) values ('${P(6)}');
    insert into shop_order_items (product_id) values ('${P(7)}');
    insert into stock_validation_items (product_id) values ('${P(8)}');
    insert into out_of_stock (product_id) values ('${P(1)}');
    insert into stock_transfer_lines (from_product_id) values ('${P(1)}');
    delete from stock_movements;
  `)
  await db.exec(MIGRATION)
})

describe('delete_products: selected', () => {
  it('deletes plain products, keeps linked ones with every reason, writes stock off and keeps a copy', async () => {
    const r = await scenario(MANAGER, del([P(1), P(2), P(3), P(4), P(5), P(6), P(7), P(8)]), [
      `select id from products where business_id = '${BIZ}' order by id`,
      `select product_id, movement_type, quantity, qty_before, qty_after, source_type from stock_movements order by product_id`,
      `select product_id, product_name, product->>'price' price, deleted_by_name, deleted_all from deleted_products order by product_id`,
      `select action, actor_type, metadata from audit_log`,
      `select product_id from out_of_stock`, `select from_product_id from stock_transfer_lines`,
    ])
    expect(r.error).toBeUndefined()
    const res = r.out[0][0].r
    expect(res.deleted).toBe(3)
    expect(res.not_found).toBe(0)
    expect(res.kept.map((k) => [k.name, k.reasons])).toEqual([
      ['Batched syrup', ['batches']], ['Counted gauze', ['stock_counts']], ['Listed soap', ['shop_listing']],
      ['Ordered pills', ['shop_orders']], ['Reviewed cream', ['reviews']],
    ])
    expect(r.seen[0].map((x) => x.id)).toEqual([P(4), P(5), P(6), P(7), P(8)])
    // Only the stocked, non-service product leaves the ledger, as a write-off.
    expect(r.seen[1]).toEqual([{ product_id: P(1), movement_type: 'write_off', quantity: -12, qty_before: 12, qty_after: 0, source_type: 'product_deleted' }])
    expect(r.seen[2]).toEqual([
      { product_id: P(1), product_name: 'Paracetamol', price: '500', deleted_by_name: 'Musa', deleted_all: false },
      { product_id: P(2), product_name: 'Consultation', price: '2000', deleted_by_name: 'Musa', deleted_all: false },
      { product_id: P(3), product_name: 'Vitamin C', price: '300', deleted_by_name: 'Musa', deleted_all: false },
    ])
    expect(r.seen[3]).toEqual([{ action: 'inventory.products_deleted', actor_type: 'staff', metadata: { deleted: 3, kept: 5, all: false, requested: 8 } }])
    expect(r.seen[4]).toEqual([{ product_id: null }])
    expect(r.seen[5]).toEqual([{ from_product_id: null }])
  })

  it('another business\'s product and unknown ids are counted as not found, never touched', async () => {
    const r = await scenario(OWNER, del([P(9), 'd0000000-0000-4000-8000-000000000001', P(3)]), [`select count(*)::int n from products where id = '${P(9)}'`])
    expect(r.out[0][0].r).toMatchObject({ deleted: 1, not_found: 2 })
    expect(r.seen[0][0].n).toBe(1)
  })

  it('who may delete: owner and delete-permission roles; not other staff, other businesses or anon', async () => {
    expect((await scenario(CASHIER, del([P(1)]))).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(STRANGER, del([P(1)]))).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await as(null, del([P(1)]))).error).toMatch(/permission denied/)
    expect((await scenario(OWNER, del([]))).error).toMatch(/DELETE_NONE/)
  })
})

describe('delete_products: all (clear the catalogue to re-upload)', () => {
  it('is the owner\'s alone and needs the typed confirmation', async () => {
    expect((await scenario(MANAGER, del(null, true, 'DELETE ALL PRODUCTS'))).error).toMatch(/DELETE_ALL_OWNER_ONLY/)
    expect((await scenario(OWNER, del(null, true, 'delete all'))).error).toMatch(/DELETE_ALL_CONFIRM/)
  })

  it('removes every product not tied to other records, in this business only', async () => {
    const r = await scenario(OWNER, del(null, true, 'DELETE ALL PRODUCTS'), [
      `select count(*)::int n from products where business_id = '${BIZ}'`,
      `select count(*)::int n from products where business_id = '${OTHER}'`,
      `select bool_and(deleted_all) a, count(*)::int n from deleted_products`,
      `select metadata from audit_log`,
    ])
    expect(r.out[0][0].r).toMatchObject({ deleted: 3 })
    expect(r.out[0][0].r.kept).toHaveLength(5)
    expect(r.seen[0][0].n).toBe(5)
    expect(r.seen[1][0].n).toBe(1)
    expect(r.seen[2][0]).toEqual({ a: true, n: 3 })
    expect(r.seen[3][0].metadata).toMatchObject({ all: true, deleted: 3, requested: 8 })
  })
})

describe('restore_deleted_products', () => {
  it('puts a deletion back with the same ids, prices and stock, and records the stock again', async () => {
    const r = await scenario(OWNER, [
      del([P(1), P(3)]),
      `select restore_deleted_products('${BIZ}', (select deletion_id from deleted_products limit 1)) r`,
    ], [
      `select id, price::float8 price, stock from products where id in ('${P(1)}', '${P(3)}') order by id`,
      `select movement_type, quantity from stock_movements where product_id = '${P(1)}' order by created_at, movement_type desc`,
      `select count(*) filter (where restored_at is not null)::int n from deleted_products`,
      `select action, metadata from audit_log order by created_at, action`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[1][0].r).toEqual({ restored: 2, skipped_already_back: 0, skipped_name_taken: 0 })
    expect(r.seen[0]).toEqual([{ id: P(1), price: 500, stock: 12 }, { id: P(3), price: 300, stock: 0 }])
    expect(r.seen[1].map((m) => m.movement_type).sort()).toEqual(['opening', 'write_off'])
    expect(r.seen[2][0].n).toBe(2)
    expect(r.seen[3].map((a) => a.action)).toEqual(['inventory.products_deleted', 'inventory.products_restored'])
  })

  it('never makes duplicates: a name re-uploaded since, or a product already back, is skipped and counted', async () => {
    const r = await scenario(OWNER, [
      del([P(1), P(3)]),
      `insert into products (business_id, name, generic_name, category, price, stock) values ('${BIZ}', ' PARACETAMOL ', 'Paracetamol', 'Medicines', 550, 4)`,
      `select restore_deleted_products('${BIZ}', (select deletion_id from deleted_products limit 1)) r`,
      `select restore_deleted_products('${BIZ}', (select deletion_id from deleted_products limit 1)) r`,
    ], [`select count(*)::int n from products where lower(btrim(name)) = 'paracetamol'`])
    expect(r.out[2][0].r).toEqual({ restored: 1, skipped_already_back: 0, skipped_name_taken: 1 })
    expect(r.out[3][0].r).toEqual({ restored: 0, skipped_already_back: 0, skipped_name_taken: 1 })
    expect(r.seen[0][0].n).toBe(1)
  })

  it('same people as deleting; another business\'s deletion is not found', async () => {
    const setup = await scenario(OWNER, [del([P(3)]), `select deletion_id from deleted_products`])
    expect(setup.error).toBeUndefined()
    expect((await scenario(CASHIER, `select restore_deleted_products('${BIZ}', gen_random_uuid())`)).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(OWNER, `select restore_deleted_products('${BIZ}', gen_random_uuid())`)).error).toMatch(/RESTORE_NOT_FOUND/)
  })
})

describe('deleted_products access', () => {
  it('members read their own business\'s copies; nobody writes them directly; anon reads nothing', async () => {
    await db.exec(`insert into deleted_products (deletion_id, business_id, product_id, product_name, product) values
      (gen_random_uuid(), '${BIZ}', '${P(1)}', 'x', '{}'), (gen_random_uuid(), '${OTHER}', '${P(9)}', 'y', '{}')`)
    expect((await scenario(CASHIER, `select product_name from deleted_products`)).out[0]).toEqual([{ product_name: 'x' }])
    expect((await scenario(OWNER, `delete from deleted_products`)).error).toMatch(/permission denied/)
    expect((await scenario(OWNER, `insert into deleted_products (deletion_id, business_id, product_id, product) values (gen_random_uuid(), '${BIZ}', '${P(1)}', '{}')`)).error).toMatch(/permission denied/)
    expect((await as(null, `select count(*) from deleted_products`)).error).toMatch(/permission denied/)
  })
})
