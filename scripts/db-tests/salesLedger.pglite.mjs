// POS sales on the stock ledger (carehub_20261224_sale_stock_ledger): every sale
// takes its stock through apply_stock_change, a sale is never lost to a stock
// problem, and edits / deletes give back what the ledger recorded for that sale.
// See _harness.mjs for scope and limits.
//   node scripts/db-tests/salesLedger.pglite.mjs
import fs from 'node:fs'
import { ok, finish, as, sup, db, applyMigrations, seedStaff, REPO } from './_harness.mjs'

// ---- live-shaped stand-ins (read 2026-10-30) ----------------------------------------------------
await db.exec(`
  CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text NOT NULL, stock integer DEFAULT 0,
    category text, tracking_mode text NOT NULL DEFAULT 'none');
  CREATE TABLE public.stock_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, product_id uuid, product_name text NOT NULL,
    batch_number text, quantity integer NOT NULL DEFAULT 0, expiry_date date, status text NOT NULL DEFAULT 'available', created_at timestamptz DEFAULT now());
  CREATE TABLE public.stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid,
    to_location_id uuid, movement_type text NOT NULL, quantity integer NOT NULL, reason text, moved_by text, created_at timestamptz DEFAULT now(),
    product_id uuid, source_type text, source_id text, source_line_id text, idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
    CONSTRAINT stock_movements_type_check CHECK (movement_type = ANY (ARRAY['opening','purchase_receipt','sale','sale_reversal','return_restock',
      'return_writeoff','adjustment','write_off','transfer','tracking_change','correction'])));
  CREATE UNIQUE INDEX stock_movements_idem_uniq ON public.stock_movements (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE TABLE public.sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, txn_no text NOT NULL, items jsonb DEFAULT '[]'::jsonb,
    is_on_hold boolean DEFAULT false, created_at timestamp DEFAULT now());
  ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
  CREATE POLICY own ON public.products TO authenticated USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  CREATE POLICY own ON public.stock_batches TO authenticated USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  CREATE POLICY own ON public.stock_movements TO authenticated USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  CREATE POLICY own ON public.sales TO authenticated USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  GRANT SELECT, INSERT ON public.sales TO authenticated;
  GRANT SELECT ON public.products, public.stock_batches, public.stock_movements TO authenticated;
`)
// The live ledger (no migration in this repository) and the live sale parsers.
await db.exec(fs.readFileSync(REPO + '/docs/architecture/stock-ledger-live-snapshot.sql', 'utf8'))
await db.exec(`
  CREATE TRIGGER enforce_product_stock_floor BEFORE INSERT OR UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION enforce_product_stock_floor();
  CREATE TRIGGER enforce_batch_quantity_floor BEFORE INSERT OR UPDATE OF quantity ON public.stock_batches FOR EACH ROW EXECUTE FUNCTION enforce_batch_quantity_floor();
  CREATE OR REPLACE FUNCTION public.sale_items_array(p_items jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $$
  DECLARE v jsonb := p_items;
  BEGIN
    IF v IS NULL THEN RETURN '[]'::jsonb; END IF;
    IF jsonb_typeof(v) = 'string' THEN BEGIN v := (v #>> '{}')::jsonb; EXCEPTION WHEN others THEN RETURN '[]'::jsonb; END; END IF;
    IF jsonb_typeof(v) = 'array' THEN RETURN v; END IF;
    RETURN '[]'::jsonb;
  END $$;
  CREATE OR REPLACE FUNCTION public.sale_stock_lines(p_items jsonb) RETURNS TABLE(product_id uuid, batch_id uuid, qty numeric)
  LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $$
  DECLARE e jsonb; c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  BEGIN
    FOR e IN SELECT * FROM jsonb_array_elements(public.sale_items_array(p_items)) LOOP
      IF coalesce(e ->> 'id', e ->> 'product_id', '') ~* c_uuid AND coalesce(e ->> 'qty', '') ~ '^[0-9]+$' THEN
        product_id := coalesce(e ->> 'id', e ->> 'product_id')::uuid;
        batch_id := CASE WHEN coalesce(e ->> 'batch_id', '') ~* c_uuid THEN (e ->> 'batch_id')::uuid END;
        qty := (e ->> 'qty')::numeric;
        RETURN NEXT;
      END IF;
    END LOOP;
  END $$;
  REVOKE ALL ON FUNCTION public.sale_items_array(jsonb), public.sale_stock_lines(jsonb) FROM PUBLIC, anon, authenticated;
  -- The live triggers being replaced, so the swap is exercised.
  CREATE FUNCTION public.apply_sale_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE FUNCTION public.apply_sale_batch_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER sale_stock_movement AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION apply_sale_stock_movement();
  CREATE TRIGGER sale_batch_movement AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION apply_sale_batch_movement();
`)
await applyMigrations(['carehub_20261224_sale_stock_ledger.sql', 'carehub_20261224b_pin_cutover_search_path.sql'])

const trig = (await sup(`select string_agg(tgname, ',' order by tgname) t from pg_trigger where tgrelid = 'public.sales'::regclass and not tgisinternal`)).rows[0].t
ok('the two old sale triggers are replaced by one ledger trigger', trig === 'sale_stock_ledger', trig)

const S = await seedStaff()
const product = async (name, stock, extra = {}) => (await sup(
  `insert into products (business_id, name, stock, category, tracking_mode) values ($1,$2,$3,$4,$5) returning id`,
  [extra.biz || S.A, name, stock, extra.category || 'Medicines', extra.mode || 'none'])).rows[0].id
const batchRow = async (prod, name, qty, expiry, ageDays) => (await sup(
  `insert into stock_batches (business_id, product_id, product_name, batch_number, quantity, expiry_date, created_at)
   values ($1,$2,'x',$3,$4,$5, now() - make_interval(days => $6)) returning id`, [S.A, prod, name, qty, expiry, ageDays])).rows[0].id
const stock = async (id) => (await sup('select stock from products where id=$1', [id])).rows[0].stock
const bq = async (id) => (await sup('select quantity from stock_batches where id=$1', [id])).rows[0].quantity
const rows = async (where, params) => (await sup(`select * from stock_movements where ${where} order by created_at, quantity`, params)).rows
let txnSeq = 0
// Items double-encoded, as production stores 604 of 607 sales.
const ring = async (who, items, { hold = false, biz = S.A } = {}) => {
  const txn = 'T' + (++txnSeq)
  const r = await as(who, `insert into sales (business_id, txn_no, items, is_on_hold) values ($1,$2,$3::jsonb,$4) returning id`,
    [biz, txn, JSON.stringify(JSON.stringify(items)), hold])
  return { id: r.rows[0].id, txn }
}
const delta = (txn, oldItems, newItems) => sup(`select public.sale_apply_stock_delta($1,$2,$3::jsonb,$4::jsonb)`, [S.A, txn, JSON.stringify(oldItems), JSON.stringify(newItems)])

// ---- recording a sale ----------------------------------------------------------------------------
const amox = await product('Amoxil', 10)
const s1 = await ring('repA1', [{ id: amox, qty: 2 }, { id: amox, qty: 1 }])
let m = await rows('source_id = $1', [s1.id])
ok('a cashier\'s sale takes the stock through the ledger: 10 -> 7, one row per product', (await stock(amox)) === 7 && m.length === 1
  && m[0].movement_type === 'sale' && m[0].quantity === -3 && m[0].qty_before === 10 && m[0].qty_after === 7 && m[0].source_type === 'sale', JSON.stringify(m))
ok('the row records the cashier', m[0].moved_by === 'rep1@a.test' && m[0].actor_id === '00000000-0000-0000-0000-0000000000c1')

const pan = await product('Panadol', 2)
const s2 = await ring('repA1', [{ id: pan, qty: 5 }])
m = await rows('source_id = $1', [s2.id])
ok('overselling keeps the sale, takes what is on hand and says how short', (await stock(pan)) === 0 && m.length === 1 && m[0].quantity === -2 && /short by 3/.test(m[0].reason), JSON.stringify(m))

const neg = await product('Oversold', 0)
// Production holds 636 such rows from before the floor; set one up past the floor trigger.
await db.exec(`alter table products disable trigger enforce_product_stock_floor;
  update products set stock = -5 where id = '${neg}';
  alter table products enable trigger enforce_product_stock_floor;`)
await ring('repA1', [{ id: neg, qty: 2 }])
ok('a negative stock is left as it is (the old clamp raised it to 0)', (await stock(neg)) === -5 && (await rows('product_id = $1', [neg])).length === 0)

const held = await ring('repA1', [{ id: amox, qty: 1 }], { hold: true })
const svc = await product('Consult', 999, { category: 'Services' })
await ring('repA1', [{ id: svc, qty: 1 }])
ok('a held sale and a service move nothing', (await stock(amox)) === 7 && (await stock(svc)) === 999 && (await rows('source_id = $1', [held.id])).length === 0)

const named = await batchRow(amox, 'AMX-1', 4, '2027-03-31', 0)
await ring('repA1', [{ id: amox, batch_id: named, qty: 3 }])
ok('a batch named on the line gives its units and the product moves with it, in one row', (await bq(named)) === 1 && (await stock(amox)) === 4
  && (await rows('batch_id = $1', [named])).length === 1)

const ins = await product('Insulin', 16, { mode: 'batch_expiry' })
const early = await batchRow(ins, 'EARLY', 2, '2027-01-31', 3)
const late = await batchRow(ins, 'LATE', 5, '2027-06-30', 2)
const expired = await batchRow(ins, 'EXPIRED', 9, '2025-01-31', 4)
const s6 = await ring('repA1', [{ id: ins, qty: 4 }])
ok('a tracked product with no batch named takes the earliest unexpired expiry first', (await bq(early)) === 0 && (await bq(late)) === 3 && (await bq(expired)) === 9
  && (await stock(ins)) === 12)

const drift = await product('Drifted', 10, { mode: 'batch_only' })
const driftBatch = await batchRow(drift, 'D-1', 3, null, 0)
const s7 = await ring('repA1', [{ id: drift, qty: 2 }])
ok('when the ledger refuses (batches disagree with stock) the sale is kept and stock falls back to the old direct write',
  (await stock(drift)) === 8 && (await bq(driftBatch)) === 3 && (await rows('source_id = $1', [s7.id])).length === 0)

const otherBiz = await product('Other biz', 7, { biz: S.B })
await ring('repA1', [{ id: otherBiz, qty: 3 }])
ok('another business\'s product inside the items is never touched', (await stock(otherBiz)) === 7)
let refused = false
try { await ring('repB1', [{ id: amox, qty: 1 }], { biz: S.A }) } catch { refused = true }
ok('a sale cannot be inserted into another business (sales RLS)', refused)

// ---- edits and deletes ---------------------------------------------------------------------------
await delta(s2.txn, [{ id: pan, qty: 5 }], [])
ok('deleting a sale that recorded 2 of 5 gives back 2, not 5', (await stock(pan)) === 2
  && (await rows(`movement_type = 'sale_reversal' and source_id = $1`, [s2.id]))[0]?.quantity === 2)

const keep = await product('Keep', 10)
const s9 = await ring('repA1', [{ id: keep, qty: 5 }])
await delta(s9.txn, [{ id: keep, qty: 5 }], [{ id: keep, qty: 4 }])
ok('an edit from 5 to 4 gives back exactly 1', (await stock(keep)) === 6)
await delta(s9.txn, [{ id: keep, qty: 4 }], [{ id: keep, qty: 6 }])
ok('an edit up from 4 to 6 takes 2 more', (await stock(keep)) === 4)
await delta(s9.txn, [{ id: keep, qty: 6 }], [])
ok('then deleting it gives back everything recorded (back to 10), all under the sale id', (await stock(keep)) === 10
  && (await rows('source_id = $1', [s9.id])).length === 4)

await delta(s6.txn, [{ id: ins, qty: 4 }], [])
ok('deleting a tracked sale puts each unit back into the batch it came from', (await bq(early)) === 2 && (await bq(late)) === 5 && (await stock(ins)) === 16)

const bline = await product('Batched', 10)
const bb = await batchRow(bline, 'B-1', 4, '2027-01-31', 0)
const s10 = await ring('repA1', [{ id: bline, batch_id: bb, qty: 3 }])
await delta(s10.txn, [{ id: bline, batch_id: bb, qty: 3 }], [{ id: bline, qty: 3 }])
ok('an edit that drops the batch gives the batch its 3 back and takes 3 loose (product unchanged)', (await bq(bb)) === 4 && (await stock(bline)) === 7)

// A sale rung up before the cutover: the old triggers moved its stock, so it has no ledger rows.
await db.exec(`alter table sales disable trigger sale_stock_ledger;
  insert into sales (business_id, txn_no, items, created_at)
    values ('${S.A}', 'OLD-1', ${"'" + JSON.stringify(JSON.stringify([{ id: pan, qty: 3 }])) + "'"}::jsonb, now() - interval '2 days');
  alter table sales enable trigger sale_stock_ledger;`)
await delta('OLD-1', [{ id: pan, qty: 3 }], [])
ok('a sale from before the ledger keeps the old rule: its line quantity goes back', (await stock(pan)) === 5)

// ---- who can call what ---------------------------------------------------------------------------
const can = async (role, fn) => (await sup(`select has_function_privilege($1, $2, 'EXECUTE') x`, [role, fn])).rows[0].x
ok('signed-in users cannot call the stock helpers, the trigger function or the corrections directly',
  !(await can('authenticated', 'public.sale_take_stock(uuid, uuid, uuid, integer, text, text, text, text)'))
  && !(await can('authenticated', 'public.sale_return_stock(uuid, uuid, uuid, integer, text, text)'))
  && !(await can('authenticated', 'public.apply_sale_ledger()'))
  && !(await can('authenticated', 'public.sale_apply_stock_delta(uuid, text, jsonb, jsonb)'))
  && !(await can('anon', 'public.sale_take_stock(uuid, uuid, uuid, integer, text, text, text, text)')))
const cfg = (await sup(`select proname, prosecdef, proconfig from pg_proc where proname in ('apply_sale_ledger', 'sale_ledger_cutover') order by proname`)).rows
ok('the trigger is a definer with a pinned search_path, and so is the cutover', cfg[0].prosecdef === true && String(cfg[0].proconfig).includes('search_path=public, pg_temp')
  && String(cfg[1].proconfig).includes('search_path=pg_catalog, pg_temp'), JSON.stringify(cfg))

finish()
