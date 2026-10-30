// Shop orders on the stock ledger (carehub_20261225_shop_order_stock_ledger): an order reserves
// its stock through apply_stock_change or is refused, and every way an order's stock goes back
// (cancel, expiry, cleanup, approved return) gives back what was recorded, once.
// Orders are first placed with the live pre-ledger functions, so the upgrade path is real.
// See _harness.mjs for scope and limits.
//   node scripts/db-tests/shopOrderStock.pglite.mjs
import fs from 'node:fs'
import { ok, finish, as, sup, db, applyMigrations, expectError, seedStaff, USERS, REPO } from './_harness.mjs'

// ---- live-shaped stand-ins (read 2026-10-30) ----------------------------------------------------
await db.exec(`
  CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text NOT NULL, stock integer DEFAULT 0,
    price numeric DEFAULT 0, sale_type text, category text, tracking_mode text NOT NULL DEFAULT 'none');
  CREATE TABLE public.stock_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, product_id uuid, product_name text NOT NULL,
    batch_number text, quantity integer NOT NULL DEFAULT 0, expiry_date date, status text NOT NULL DEFAULT 'available', created_at timestamptz DEFAULT now());
  CREATE TABLE public.stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid,
    to_location_id uuid, movement_type text NOT NULL, quantity integer NOT NULL, reason text, moved_by text, created_at timestamptz DEFAULT now(),
    product_id uuid, source_type text, source_id text, source_line_id text, idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
    CONSTRAINT stock_movements_type_check CHECK (movement_type = ANY (ARRAY['opening','purchase_receipt','sale','sale_reversal','return_restock',
      'return_writeoff','adjustment','write_off','transfer','tracking_change','correction'])));
  CREATE UNIQUE INDEX stock_movements_idem_uniq ON public.stock_movements (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE TABLE public.ecommerce_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, product_id uuid, status text DEFAULT 'Active',
    is_restricted boolean DEFAULT false, ecommerce_price_kobo integer);
  CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_ref text UNIQUE, customer_id uuid, vendor_business_id uuid,
    status text, payment_status text, subtotal_kobo integer, commission_kobo integer, fulfilment_kobo integer, delivery_kobo integer, total_kobo integer,
    delivery_address text, delivery_city text, delivery_state text, delivery_phone text, delivery_email text, delivery_instructions text,
    delivery_preference text, distance_km numeric, is_approved_city boolean, customer_name text, payment_reference text UNIQUE, pickup_station_id uuid,
    segment text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
  CREATE TABLE public.shop_order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, ecommerce_product_id uuid, product_id uuid,
    product_name text, quantity integer, unit_price_kobo integer, line_total_kobo integer, created_at timestamptz DEFAULT now());
  CREATE TABLE public.shop_order_status_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, from_status text, to_status text, changed_by uuid, note text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.shop_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, payment_reference text, amount_kobo integer, status text, gateway text);
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid, type text, message text, link text);
  CREATE TABLE public.shop_pickup_stations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_active boolean DEFAULT true);
  CREATE TABLE public.shop_order_returns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, status text DEFAULT 'requested');
  CREATE SEQUENCE shop_ref_seq;
  CREATE FUNCTION public.generate_shop_order_ref() RETURNS text LANGUAGE sql AS $$ SELECT 'CF-' || lpad(nextval('shop_ref_seq')::text, 6, '0') $$;
  CREATE FUNCTION public.is_ecommerce_vendor_approved(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.calculate_shop_commission(text, integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.calculate_shop_fulfilment_fee(text, integer, integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.calculate_shop_delivery_fee(numeric, text) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
`)
// The live ledger, then the live pre-ledger shop functions (both snapshots, not migrations).
await db.exec(fs.readFileSync(REPO + '/docs/architecture/stock-ledger-live-snapshot.sql', 'utf8'))
await db.exec(`
  CREATE TRIGGER enforce_product_stock_floor BEFORE INSERT OR UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION enforce_product_stock_floor();
  CREATE TRIGGER enforce_batch_quantity_floor BEFORE INSERT OR UPDATE OF quantity ON public.stock_batches FOR EACH ROW EXECUTE FUNCTION enforce_batch_quantity_floor();
`)
await db.exec(fs.readFileSync(REPO + '/docs/architecture/shop-stock-pre-ledger-snapshot.sql', 'utf8'))
await db.exec(`REVOKE ALL ON FUNCTION public.shop_restore_inventory_on_cancel(uuid), public.cleanup_pending_shop_orders() FROM PUBLIC;`)
const md5 = async (name) => (await sup(`select md5(prosrc) m from pg_proc where proname = $1 and pronargs = (select max(pronargs) from pg_proc where proname = $1)`, [name])).rows[0].m
ok('the pre-ledger snapshot is the live code byte for byte', (await md5('create_shop_order')) === '37f7bda6c5da08c81e106258466c71f0'
  && (await md5('shop_restore_inventory_on_cancel')) === '3b4a6e21dd5c3baa50f2a3e5d7f307b0' && (await md5('cleanup_pending_shop_orders')) === 'c994fe39e8d3d8c850d17c555a0f2a9b')

const S = await seedStaff()
const customer = USERS.outsider.sub
const product = async (name, stock, extra = {}) => (await sup(
  `insert into products (business_id, name, stock, price, tracking_mode) values ($1,$2,$3,100,$4) returning id`, [extra.biz || S.A, name, stock, extra.mode || 'none'])).rows[0].id
const listing = async (prod, biz = S.A) => (await sup(`insert into ecommerce_products (business_id, product_id, ecommerce_price_kobo) values ($1,$2,10000) returning id`, [biz, prod])).rows[0].id
const batchRow = async (prod, name, qty, expiry, ageDays) => (await sup(
  `insert into stock_batches (business_id, product_id, product_name, batch_number, quantity, expiry_date, created_at)
   values ($1,$2,'x',$3,$4,$5, now() - make_interval(days => $6)) returning id`, [S.A, prod, name, qty, expiry, ageDays])).rows[0].id
const stock = async (id) => (await sup('select stock from products where id=$1', [id])).rows[0].stock
const bq = async (id) => (await sup('select quantity from stock_batches where id=$1', [id])).rows[0].quantity
const moves = async (order) => (await sup(`select * from stock_movements where source_type = 'shop_order' and source_id = $1 order by created_at, quantity`, [order])).rows
// Places an order as the signed-in customer, the way CareFind calls create_shop_order.
const order = async (lines, vendor = S.A) => {
  const subtotal = lines.reduce((s, l) => s + l.qty * 10000, 0)
  const r = await as('outsider', `select public.create_shop_order($1,$2,$3::jsonb,$4,0,0,0,$4,'1 Road','Ikeja','Lagos','0803','c@z.test',null,'pickup',0,true,'Ada',null) id`,
    [customer, vendor, JSON.stringify(lines.map((l) => ({ ecommerce_product_id: l.listing, quantity: l.qty }))), subtotal])
  return r.rows[0].id
}
const items = async (o) => (await sup('select id, product_id, quantity from shop_order_items where order_id=$1 order by created_at', [o])).rows
const restore = (o) => sup('select public.shop_restore_inventory_on_cancel($1)', [o])

// ---- before: orders placed with the live code ----------------------------------------------------
const amox = await product('Amoxil', 10)
const amoxL = await listing(amox)
const oldOrder = await order([{ listing: amoxL, qty: 3 }])
ok('BEFORE: an order took stock directly, with no ledger row', (await stock(amox)) === 7 && (await moves(oldOrder)).length === 0)

await applyMigrations(['carehub_20261225_shop_order_stock_ledger.sql'])

// ---- reserving ------------------------------------------------------------------------------------
const o1 = await order([{ listing: amoxL, qty: 2 }])
let m = await moves(o1)
const [line1] = await items(o1)
ok('an order reserves through the ledger: 7 -> 5, one sale row naming the order and its line', (await stock(amox)) === 5 && m.length === 1
  && m[0].movement_type === 'sale' && m[0].quantity === -2 && m[0].qty_before === 7 && m[0].qty_after === 5
  && m[0].source_line_id === line1.id && m[0].idempotency_key === `shop_order:${o1}:${line1.id}` && /^Shop order CF-/.test(m[0].reason), JSON.stringify(m))
ok('the row records the customer as actor, labelled without their email', m[0].actor_id === customer && m[0].moved_by === 'Online shop order')

const ordersBefore = (await sup('select count(*)::int c from shop_orders')).rows[0].c
await expectError('not enough stock refuses the order with the message CareFind maps to INSUFFICIENT_STOCK',
  () => order([{ listing: amoxL, qty: 9 }]), 'Insufficient stock for Amoxil: have 5, need 9')
ok('and nothing of the refused order is left behind', (await stock(amox)) === 5 && (await sup('select count(*)::int c from shop_orders')).rows[0].c === ordersBefore)

const foreign = await product('Company B stock', 8, { biz: S.B })
const foreignL = await listing(foreign, S.A)
await expectError('a listing pointing at another business\'s product cannot sell that business\'s stock', () => order([{ listing: foreignL, qty: 1 }]), 'does not belong to vendor')
ok('the other business\'s stock is untouched', (await stock(foreign)) === 8)

const ins = await product('Insulin', 16, { mode: 'batch_expiry' })
const insL = await listing(ins)
const early = await batchRow(ins, 'EARLY', 2, '2027-01-31', 3)
const late = await batchRow(ins, 'LATE', 5, '2027-06-30', 2)
const expired = await batchRow(ins, 'EXPIRED', 9, '2025-01-31', 4)
const oT = await order([{ listing: insL, qty: 4 }])
ok('a batch-tracked product reserves the earliest unexpired expiry first', (await bq(early)) === 0 && (await bq(late)) === 3 && (await bq(expired)) === 9
  && (await stock(ins)) === 12 && (await moves(oT)).length === 2)
await expectError('expired units are not sold online: 12 in stock but only 3 unexpired', () => order([{ listing: insL, qty: 4 }]), 'have 3, need 4')

// ---- putting back ---------------------------------------------------------------------------------
await restore(o1)
m = (await moves(o1)).filter((x) => x.movement_type === 'sale_reversal')
ok('cancelling gives back what was reserved, through the ledger', (await stock(amox)) === 7 && m.length === 1 && m[0].quantity === 2 && /cancelled$/.test(m[0].reason))
await restore(o1)
ok('a second restore of the same order changes nothing', (await stock(amox)) === 7 && (await moves(o1)).length === 2)

await restore(oT)
ok('a tracked order goes back into the batches it came from', (await bq(early)) === 2 && (await bq(late)) === 5 && (await stock(ins)) === 12 + 4)

await restore(oldOrder)
ok('an order placed before the ledger gives back its line quantity (old rule), journalled', (await stock(amox)) === 10 && (await moves(oldOrder)).length === 1)
await restore(oldOrder)
ok('and only once', (await stock(amox)) === 10)

const oR = await order([{ listing: amoxL, qty: 1 }])
await sup(`insert into shop_order_returns (order_id, status) values ($1, 'approved')`, [oR])
await restore(oR)
await sup(`insert into shop_order_returns (order_id, status) values ($1, 'approved')`, [oR])
await restore(oR)
m = (await moves(oR)).filter((x) => x.quantity > 0)
ok('an approved return restocks as return_restock, and a second approved return does not restock again', (await stock(amox)) === 10
  && m.length === 1 && m[0].movement_type === 'return_restock', JSON.stringify(m))

const gone = await product('Merged away', 5)
const goneL = await listing(gone)
const oG = await order([{ listing: goneL, qty: 1 }, { listing: amoxL, qty: 2 }])
await sup('delete from products where id = $1', [gone])
let raised = null
try { await restore(oG) } catch (e) { raised = e.message }
ok('a line whose product is gone never blocks the cancellation; the other lines still go back', raised === null && (await stock(amox)) === 10, raised)

const oC = await order([{ listing: amoxL, qty: 4 }])
await sup(`update shop_orders set created_at = now() - interval '45 minutes' where id = $1`, [oC])
await sup(`select set_config('request.jwt.claims', '', false)`)   // a server job: nobody signed in
const cleaned = (await sup('select public.cleanup_pending_shop_orders() n')).rows[0].n
const cRow = (await moves(oC)).find((x) => x.quantity > 0)
ok('the 30 minute cleanup restores through the same path', cleaned >= 1 && (await stock(amox)) === 10 && cRow?.moved_by === 'Online shop (automatic)'
  && (await sup('select status from shop_orders where id=$1', [oC])).rows[0].status === 'cancelled', JSON.stringify(cRow))

// ---- who can call what ----------------------------------------------------------------------------
const can = async (role, fn) => (await sup(`select has_function_privilege($1, $2, 'EXECUTE') x`, [role, fn])).rows[0].x
ok('signed-in users and visitors cannot reserve or restore stock directly',
  !(await can('authenticated', 'public.shop_take_stock(uuid, uuid, integer, uuid, uuid, text, text)'))
  && !(await can('anon', 'public.shop_take_stock(uuid, uuid, integer, uuid, uuid, text, text)'))
  && !(await can('authenticated', 'public.shop_restore_inventory_on_cancel(uuid)'))
  && !(await can('authenticated', 'public.cleanup_pending_shop_orders()')))
await expectError('a customer still cannot place an order in someone else\'s name', () => as('outsider',
  `select public.create_shop_order($1,$2,'[{"ecommerce_product_id":"${amoxL}","quantity":1}]'::jsonb,10000,0,0,0,10000,'a','b','c','d','e',null,'pickup',0,true,'x',null)`,
  ['00000000-0000-0000-0000-00000000ffff', S.A]), 'Not authorized')
const cfg = (await sup(`select proname, prosecdef, proconfig from pg_proc where proname in ('create_shop_order', 'shop_restore_inventory_on_cancel', 'shop_take_stock') and pronargs <> 19 order by proname`)).rows
ok('order and restore stay SECURITY DEFINER, the helper is INVOKER, all with a pinned search_path',
  cfg[0].prosecdef && cfg[1].prosecdef && !cfg[2].prosecdef && cfg.every((r) => String(r.proconfig).includes('search_path=public, pg_temp')), JSON.stringify(cfg))

finish()
