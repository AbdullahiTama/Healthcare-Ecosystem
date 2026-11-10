// Purchases bulk edit, delete and restore (carehub_20270114_purchase_bulk_edit_delete), on top of
// carehub_20261229_purchase_editing_and_analytics (edit_purchase and friends, identical to production by md5 on
// 2026-11-10) and the live stock ledger snapshot (apply_stock_change, md5 checked the same day). Purchases are
// recorded the way the deployed client records them (insert, then receive_stock per line). See _harness.mjs.
//   node scripts/db-tests/purchaseBulkEditDelete.pglite.mjs
import fs from 'node:fs'
import { ok, finish, as, sup, db, applyMigrations, expectError, seedStaff, migrationPath, REPO } from './_harness.mjs'

// ---- live-shaped stand-ins (read 2026-10-31) ----------------------------------------------------
await db.exec(`
  CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text NOT NULL, stock integer DEFAULT 0,
    price numeric DEFAULT 0, cost_price numeric DEFAULT 0, category text, tracking_mode text NOT NULL DEFAULT 'none', barcode text,
    generic_name text, reorder_level integer, list_on_carefind boolean DEFAULT true);
  CREATE TABLE public.stock_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, product_id uuid, product_name text NOT NULL,
    batch_number text, quantity integer NOT NULL DEFAULT 0, expiry_date date, date_received date, supplier_source text, received_by text,
    location_id uuid, status text NOT NULL DEFAULT 'available', created_at timestamptz DEFAULT now());
  CREATE TABLE public.stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid,
    to_location_id uuid, movement_type text NOT NULL, quantity integer NOT NULL, reason text, moved_by text, created_at timestamptz DEFAULT clock_timestamp(),
    product_id uuid, source_type text, source_id text, source_line_id text, idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
    CONSTRAINT stock_movements_type_check CHECK (movement_type = ANY (ARRAY['opening','purchase_receipt','sale','sale_reversal','return_restock',
      'return_writeoff','adjustment','write_off','transfer','tracking_change','correction'])));
  CREATE UNIQUE INDEX stock_movements_idem_uniq ON public.stock_movements (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE TABLE public.purchases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, supplier_name text NOT NULL, product_name text,
    quantity integer DEFAULT 0, cost_price numeric DEFAULT 0, total_cost numeric DEFAULT 0, amount_paid numeric DEFAULT 0, balance numeric DEFAULT 0,
    supply_date text, due_date text, status text DEFAULT 'pending', notes text, created_at timestamp DEFAULT now(), selling_price numeric DEFAULT 0,
    expiry date, batch text, items jsonb, CONSTRAINT purchases_items_is_array CHECK (items IS NULL OR jsonb_typeof(items) = 'array'));
  CREATE TABLE public.debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, direction text NOT NULL, party_name text NOT NULL,
    amount numeric DEFAULT 0, amount_paid numeric DEFAULT 0, balance numeric DEFAULT 0, due_date text, status text DEFAULT 'pending', description text,
    created_at timestamp DEFAULT now(), source text DEFAULT 'manual', source_ref text DEFAULT '', client_id uuid);
  CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL, actor_type text NOT NULL DEFAULT 'staff',
    branch_id uuid NOT NULL, action text NOT NULL, target_type text, target_id uuid, metadata jsonb DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, permissions jsonb, created_at timestamptz DEFAULT now());
  ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
  CREATE POLICY own ON public.products TO authenticated USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin()) WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  CREATE POLICY own ON public.stock_batches TO authenticated USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  CREATE POLICY own ON public.stock_movements TO authenticated USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  CREATE POLICY "purchases of own business" ON public.purchases USING ((business_id IN (SELECT current_business_ids())) OR is_platform_admin()) WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());
  CREATE POLICY "debts of own business" ON public.debts USING ((business_id IN (SELECT current_business_ids())) OR is_platform_admin()) WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());
  CREATE POLICY "audit_log tenant visibility" ON public.audit_log FOR SELECT USING ((branch_id IN (SELECT current_business_ids())) OR is_platform_admin());
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.products, public.stock_batches, public.purchases, public.debts TO anon, authenticated;
  GRANT SELECT, INSERT ON public.stock_movements TO authenticated;
  GRANT SELECT ON public.audit_log TO authenticated;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT CASE WHEN current_user = 'anon' THEN 'anon' ELSE 'authenticated' END $$;
  GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated;
  -- receive_stock comments on the function it replaced.
  CREATE FUNCTION public.increment_product_stock(p_product_id uuid, p_business_id uuid, p_qty integer) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`)
await db.exec(fs.readFileSync(REPO + '/docs/architecture/stock-ledger-live-snapshot.sql', 'utf8'))
await db.exec(`
  CREATE TRIGGER enforce_product_stock_floor BEFORE INSERT OR UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION enforce_product_stock_floor();
  CREATE TRIGGER enforce_batch_quantity_floor BEFORE INSERT OR UPDATE OF quantity ON public.stock_batches FOR EACH ROW EXECUTE FUNCTION enforce_batch_quantity_floor();
  CREATE TRIGGER journal_opening_stock AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION journal_opening_stock();
`)
// is_business_owner exactly as carehub_20261216 defines it (live).
const corrections = fs.readFileSync(migrationPath('carehub_20261216_sales_owner_corrections.sql'), 'utf8')
await db.exec(corrections.match(/CREATE OR REPLACE FUNCTION public\.is_business_owner[\s\S]*?\n\$\$;/)[0])
await applyMigrations(['carehub_20261212_supplier_payments.sql', 'carehub_20261223_receive_stock.sql'], { rerun: false })

const S = await seedStaff()
const A = S.A, B = S.B
const product = async (name, stock, extra = {}) => (await sup(
  `insert into products (business_id, name, stock, price, cost_price, category, tracking_mode, barcode) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
  [extra.biz || A, name, stock, extra.price ?? 150, extra.cost ?? 100, extra.category || 'Medicines', extra.mode || 'none', extra.barcode || null])).rows[0].id
const stockOf = async (id) => (await sup('select stock from products where id=$1', [id])).rows[0].stock
const purchaseRow = async (id) => (await sup('select * from purchases where id=$1', [id])).rows[0]
const sell = (id, n) => sup(`select apply_stock_change($1, $2, $3, 'sale', null, 'sale', 'T', null, 'till sale', null, null)`, [A, id, -n])

// What the deployed client does: insert the purchase (items without line ids), then receive each line.
async function recordPurchase(who, { supplier, date, lines, paid = 0, biz = A, ledger = true, createdAt }) {
  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0)
  const qty = lines.reduce((s, l) => s + l.qty, 0)
  const items = lines.map((l) => ({ name: l.name, qty: l.qty, cost: l.cost, sell: null, batch: l.batch || null, expiry: l.expiry || null, cat: 'Medicines' }))
  const row = (await as(who, `insert into purchases (business_id, supplier_name, product_name, quantity, cost_price, total_cost, amount_paid, balance,
      supply_date, due_date, status, notes, items) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'',$10,'',$11) returning id`,
    [biz, supplier, lines.map((l) => l.name).join(', '), qty, total / qty, total, paid, Math.max(0, total - paid), date, paid >= total ? 'paid' : 'pending', JSON.stringify(items)])).rows[0]
  if (createdAt) await sup('update purchases set created_at = $2 where id = $1', [row.id, createdAt])
  for (const [n, l] of lines.entries()) {
    if (ledger) {
      await as(who, `select receive_stock($1,$2,$3,'purchase_receipt',$4,'purchase',$5,$6,'Purchase from x',$7,$8,$9,$10)`,
        [biz, l.pid, l.qty, 'purchase:' + row.id + ':line' + n + row.id.slice(0, 4), row.id, 'line' + n + row.id.slice(0, 4), l.batch || null, l.expiry || null, date, supplier])
    } else {
      await sup('update products set stock = stock + $2 where id = $1', [l.pid, l.qty])   // increment_product_stock, before the ledger
    }
  }
  if (total - paid > 0) {
    await as(who, `insert into debts (business_id, direction, party_name, amount, amount_paid, balance, due_date, status, description, source, source_ref)
      values ($1,'we_owe',$2,$3,$4,$5,'','pending','Purchase','purchase',$6)`, [biz, supplier, total, paid, total - paid, row.id])
  }
  return row.id
}

// ---- live pieces the new functions meet -----------------------------------------------------------
await sup(`insert into roles (business_id, name, permissions) values
  ($1, 'Regional Manager', '{"canEditPurchases": true, "canDelete": true}'),
  ($1, 'Sales Rep', '{"canEditPrice": true}'),
  ($1, 'Editor', '{"canEditPurchases": true}')`, [A])
await sup(`insert into staff (business_id, email, role, full_name) values ($1, 'editor@a.test', 'Editor', 'Ed Itor')`, [A])
const { USERS } = await import('./_harness.mjs')
USERS.editor = { sub: '00000000-0000-0000-0000-0000000000c9', email: 'editor@a.test' }
await applyMigrations(['carehub_20261229_purchase_editing_and_analytics.sql'], { rerun: false })
// Live columns and triggers added since 20261229: who recorded a purchase or a debt (stamp_recorded_by / keep_recorded_by
// / pos_actor exactly as live, read 2026-11-10); clients (restore drops a link to a deleted client).
await db.exec(`
  ALTER TABLE public.businesses ADD COLUMN owner text, ADD COLUMN owner_name text, ADD COLUMN branch_depth_limit integer DEFAULT 3;
  ALTER TABLE public.staff ADD COLUMN auth_user_id uuid;
  UPDATE public.businesses SET owner_name = 'Ada Owner' WHERE email = 'a@x.test';
  ALTER TABLE public.purchases ADD COLUMN recorded_by uuid, ADD COLUMN recorded_by_staff_id uuid, ADD COLUMN recorded_by_name text;
  ALTER TABLE public.debts ADD COLUMN recorded_by uuid, ADD COLUMN recorded_by_staff_id uuid, ADD COLUMN recorded_by_name text;
  CREATE TABLE public.clients (id uuid PRIMARY KEY, business_id uuid, full_name text);
  CREATE OR REPLACE FUNCTION public.pos_actor(p_business_id uuid) RETURNS TABLE(user_id uuid, staff_id uuid, staff_name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  DECLARE
    v_uid uuid := auth.uid();
    v_email text := lower(auth.email());
  BEGIN
    IF v_uid IS NULL OR p_business_id IS NULL OR p_business_id NOT IN (SELECT public.current_business_ids()) THEN RETURN; END IF;
    RETURN QUERY
      WITH RECURSIVE up(id, parent_business_id, depth) AS (
        SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
        UNION
        SELECT p.id, p.parent_business_id, up.depth + 1 FROM public.businesses p JOIN up ON p.id = up.parent_business_id WHERE up.depth < 10
      )
      SELECT v_uid, s.id, COALESCE(NULLIF(trim(s.full_name), ''), s.email)
        FROM up JOIN public.staff s ON s.business_id = up.id
       WHERE s.status = 'active' AND (s.auth_user_id = v_uid OR lower(s.email) = v_email)
       ORDER BY up.depth, (s.auth_user_id = v_uid) DESC NULLS LAST LIMIT 1;
    IF FOUND THEN RETURN; END IF;
    RETURN QUERY
      WITH RECURSIVE up(id, parent_business_id, depth) AS (
        SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
        UNION
        SELECT p.id, p.parent_business_id, up.depth + 1 FROM public.businesses p JOIN up ON p.id = up.parent_business_id WHERE up.depth < 10
      )
      SELECT v_uid, NULL::uuid, COALESCE(NULLIF(trim(o.owner_name), ''), NULLIF(trim(o.owner), ''), 'Owner')
        FROM up JOIN public.businesses o ON o.id = up.id WHERE lower(o.email) = v_email ORDER BY up.depth LIMIT 1;
  END $function$;
  CREATE OR REPLACE FUNCTION public.stamp_recorded_by() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  DECLARE
    v_actor record;
  BEGIN
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;
    NEW.recorded_by := auth.uid();
    NEW.recorded_by_staff_id := NULL;
    NEW.recorded_by_name := NULL;
    SELECT a.staff_id, a.staff_name INTO v_actor FROM public.pos_actor(NEW.business_id) a LIMIT 1;
    IF FOUND THEN
      NEW.recorded_by_staff_id := v_actor.staff_id;
      NEW.recorded_by_name := v_actor.staff_name;
    END IF;
    RETURN NEW;
  END $function$;
  CREATE OR REPLACE FUNCTION public.keep_recorded_by() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
  BEGIN
    NEW.recorded_by := OLD.recorded_by;
    NEW.recorded_by_staff_id := OLD.recorded_by_staff_id;
    NEW.recorded_by_name := OLD.recorded_by_name;
    RETURN NEW;
  END $function$;
  CREATE TRIGGER stamp_recorded_by_ins BEFORE INSERT ON public.purchases FOR EACH ROW EXECUTE FUNCTION stamp_recorded_by();
  CREATE TRIGGER stamp_recorded_by_upd BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION keep_recorded_by();
  CREATE TRIGGER stamp_recorded_by_ins BEFORE INSERT ON public.debts FOR EACH ROW EXECUTE FUNCTION stamp_recorded_by();
  CREATE TRIGGER stamp_recorded_by_upd BEFORE UPDATE ON public.debts FOR EACH ROW EXECUTE FUNCTION keep_recorded_by();
`)
// member_can_delete() exactly as carehub_20270112_expense_bulk_delete defines it (applied 2026-11-10).
await db.exec(fs.readFileSync(migrationPath('carehub_20270112_expense_bulk_delete.sql'), 'utf8').match(/create or replace function public\.member_can_delete[\s\S]*?\$\$;\nrevoke[^\n]*\n/)[0])
await applyMigrations(['carehub_20270114_purchase_bulk_edit_delete.sql'])

// ---- data ------------------------------------------------------------------------------------------
const amox = await product('Amoxicillin 500mg', 0, { cost: 80 })
const para = await product('Paracetamol', 0, { cost: 20 })
const ors = await product('ORS sachet', 0, { cost: 30 })
const tracked = await product('Insulin', 0, { cost: 500, mode: 'batch_expiry' })
const otherB = await product('B product', 0, { biz: B })

// Recorded by the manager: the restore must keep "Manager A" as the recorder.
const p1 = await recordPurchase('mgrA', { supplier: 'MedSupply Ltd', date: '2026-10-30', paid: 1000,
  lines: [{ pid: amox, name: 'Amoxicillin 500mg', qty: 10, cost: 80 }, { pid: para, name: 'Paracetamol', qty: 50, cost: 20 }] })
await as('repA1', `select record_purchase_payment($1, 200, 'Cash', null, 'part', 'Rep One')`, [p1])
const insulin = await recordPurchase('a', { supplier: 'Cold Chain', date: '2026-10-29',
  lines: [{ pid: tracked, name: 'Insulin', qty: 4, cost: 500, batch: 'B-1', expiry: '2027-06-30' }] })
const sold = await recordPurchase('a', { supplier: 'ORS Depot', date: '2026-10-28', lines: [{ pid: ors, name: 'ORS sachet', qty: 20, cost: 30 }] })
await sell(ors, 5)
// Recorded before the ledger, under a name that matches no product.
const mystery = (await sup(`insert into purchases (business_id, supplier_name, product_name, quantity, cost_price, total_cost, amount_paid, balance, supply_date, created_at, items)
  values ($1, 'Old Supplier', 'Mystery syrup', 6, 10, 60, 60, 0, '2026-08-01', '2026-08-01 09:00', '[{"name":"Mystery syrup","qty":6,"cost":10}]') returning id`, [A])).rows[0].id
const bPurchase = await recordPurchase('b', { supplier: 'B Supplier', date: '2026-10-30', biz: B, lines: [{ pid: otherB, name: 'B product', qty: 3, cost: 10 }] })

const snap = async (id) => (await sup(`select to_jsonb(p) - 'edited_at' j from purchases p where id = $1`, [id])).rows[0]?.j
const pays = async (id) => (await sup(`select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]') j from purchase_payments x where purchase_id = $1`, [id])).rows[0].j
const debtsOf = async (id) => (await sup(`select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]') j from debts d where source = 'purchase' and source_ref = $1`, [String(id)])).rows[0].j
const batchQty = async (pid) => (await sup(`select coalesce(sum(quantity), 0)::int q from stock_batches where product_id = $1`, [pid])).rows[0].q
const del = (who, ids) => as(who, `select delete_purchases($1, $2::uuid[]) j`, [A, ids]).then((r) => r.rows[0].j)
const restore = (who, id) => as(who, `select restore_deleted_purchases($1, $2) j`, [A, id]).then((r) => r.rows[0].j)

const before = { p1: await snap(p1), p1Pays: await pays(p1), p1Debts: await debtsOf(p1), insulin: await snap(insulin) }
ok('setup: recorder stamped, at-purchase and later payment, debt, stock as received',
  before.p1.recorded_by_name === 'Manager A' && before.p1Pays.length === 2 && before.p1Debts.length === 1
  && (await stockOf(amox)) === 10 && (await stockOf(para)) === 50 && (await stockOf(tracked)) === 4 && (await batchQty(tracked)) === 4 && (await stockOf(ors)) === 15,
  JSON.stringify({ r: before.p1.recorded_by_name, pays: before.p1Pays.length, debts: before.p1Debts.length }))

// ---- who may delete -------------------------------------------------------------------------------
await expectError('delete: a rep (no delete, no edit purchases) is refused', () => del('repA1', [p1]), 'DELETE_NOT_ALLOWED')
await expectError('delete: a role that may edit purchases but not delete is refused', () => del('editor', [p1]), 'DELETE_NOT_ALLOWED')
await expectError('delete: the owner of another business is refused', () => del('b', [p1]), 'DELETE_NOT_ALLOWED')
await expectError('delete: anon cannot call it', () => as('anon', `select delete_purchases($1, $2::uuid[])`, [A, [p1]]), 'permission denied')
await expectError('delete: nothing chosen', () => del('a', []), 'DELETE_NONE')
await expectError('guard still refuses a direct DELETE', () => as('a', `delete from purchases where id = $1`, [p1]), '42501')
ok('refusals changed nothing', (await stockOf(amox)) === 10 && !!(await snap(p1)))

// ---- delete ----------------------------------------------------------------------------------------
let deletion
{
  const r = await del('mgrA', [p1, insulin, sold, mystery, bPurchase, '00000000-0000-4000-8000-000000000999'])
  deletion = r.deletion_id
  ok('delete: the purchases whose stock can be taken back are deleted', r.deleted === 2 && r.not_found === 2 && !!deletion, JSON.stringify(r))
  const kept = Object.fromEntries(r.kept.map((k) => [k.id, k]))
  ok('delete: units sold since → kept, naming the product', kept[sold]?.reasons[0] === 'stock_used' && kept[sold]?.product === 'ORS sachet', JSON.stringify(r.kept))
  ok('delete: a pre-ledger line not linked to a product → kept', kept[mystery]?.reasons[0] === 'not_linked' && kept[mystery]?.product === 'Mystery syrup')
  ok('delete: stock taken back through the ledger (batch too)', (await stockOf(amox)) === 0 && (await stockOf(para)) === 0 && (await stockOf(tracked)) === 0 && (await batchQty(tracked)) === 0)
  const mv = (await sup(`select movement_type, quantity, source_type, idempotency_key from stock_movements where idempotency_key like 'purchase_delete:%' order by quantity`)).rows
  ok('delete: one correction per line, keyed by the deletion', mv.length === 3 && mv.every((m) => m.movement_type === 'correction' && m.source_type === 'purchase_edit' && m.idempotency_key.includes(deletion)), JSON.stringify(mv))
  ok('delete: purchase, payments and debt gone', !(await snap(p1)) && (await pays(p1)).length === 0 && (await debtsOf(p1)).length === 0)
  ok('delete: kept purchases untouched', !!(await snap(sold)) && (await stockOf(ors)) === 15 && !!(await snap(mystery)) && !!(await snap(bPurchase)))
  const copies = (await sup(`select purchase_id, supplier_name, jsonb_array_length(payments) np, jsonb_array_length(debts) nd, stock, deleted_by_name from deleted_purchases order by supplier_name`)).rows
  ok('delete: copies with payments, debt, stock taken back and who', copies.length === 2 && copies[1].purchase_id === p1 && copies[1].np === 2 && copies[1].nd === 1 && copies[1].stock.length === 2 && copies[0].stock[0].batch_id && copies[1].deleted_by_name === 'Manager A', JSON.stringify(copies))
  const audit = (await sup(`select actor_type, metadata from audit_log where action = 'purchases.deleted'`)).rows
  ok('delete: audited with totals and units taken back', audit.length === 1 && audit[0].actor_type === 'staff' && audit[0].metadata.deleted === 2 && audit[0].metadata.kept === 2
    && Number(audit[0].metadata.total_cost) === 3800 && Number(audit[0].metadata.amount_paid) === 1200 && Number(audit[0].metadata.units_taken_back) === 64, JSON.stringify(audit))
}

// ---- restore ---------------------------------------------------------------------------------------
await expectError('restore: a rep is refused', () => restore('repA1', deletion), 'DELETE_NOT_ALLOWED')
await expectError('restore: unknown deletion', () => restore('a', '00000000-0000-4000-8000-000000000998'), 'RESTORE_NOT_FOUND')
{
  const r = await restore('a', deletion)
  ok('restore: both back', r.restored === 2 && r.skipped_already_back === 0 && r.skipped_stock === 0, JSON.stringify(r))
  ok('restore: the purchase is identical (lines, totals, paid, recorder)', JSON.stringify(await snap(p1)) === JSON.stringify(before.p1), JSON.stringify([await snap(p1), before.p1]))
  ok('restore: the same payment rows, no invented payment', JSON.stringify(await pays(p1)) === JSON.stringify(before.p1Pays))
  ok('restore: the same debt row', JSON.stringify(await debtsOf(p1)) === JSON.stringify(before.p1Debts))
  ok('restore: stock back, into the same batch', (await stockOf(amox)) === 10 && (await stockOf(para)) === 50 && (await stockOf(tracked)) === 4 && (await batchQty(tracked)) === 4)
  ok('restore: audited as the owner', (await sup(`select count(*)::int n from audit_log where action = 'purchases.restored' and actor_type = 'owner'`)).rows[0].n === 1)
  const again = await restore('a', deletion)
  ok('restore twice: nothing more', again.restored === 0)
  // The ledger still adds up for a later edit: taking 4 back off Amoxicillin works and leaves 6.
  const L = (await sup('select purchase_items_normalized(p) j from purchases p where id = $1', [p1])).rows[0].j
  await as('a', `select edit_purchase($1,'MedSupply Ltd','2026-10-30'::date,null,'',$2::jsonb,null,'Short delivery','Tester')`,
    [p1, JSON.stringify(L.map((x) => (x.product_id === amox ? { ...x, qty: 6 } : x)))])
  ok('after restore: edit_purchase moves stock correctly', (await stockOf(amox)) === 6)
  const later = (await as('a', `insert into debts (business_id, direction, party_name, amount, balance) values ($1, 'we_owe', 'X', 1, 1) returning recorded_by_name`, [A])).rows[0]
  ok('after restore: the restorer\'s identity is back (later stamps are theirs)', later.recorded_by_name === 'Ada Owner', JSON.stringify(later))
}

// ---- restore that cannot put the stock back ----------------------------------------------------------
{
  const r = await del('a', [insulin])
  const batchId = (await sup(`select stock->0->>'batch_id' b from deleted_purchases where deletion_id = $1`, [r.deletion_id])).rows[0].b
  await sup(`delete from stock_batches where id = $1`, [batchId])
  const back = await restore('a', r.deletion_id)
  ok('restore: batch gone since → that purchase is skipped and named, nothing of it restored', back.restored === 0 && back.skipped_stock === 1 && back.skipped[0].product === 'Insulin' && !(await snap(insulin)), JSON.stringify(back))
  ok('restore: the copy stays restorable later', (await sup(`select restored_at from deleted_purchases where deletion_id = $1`, [r.deletion_id])).rows[0].restored_at === null)
}

// ---- bulk edit ---------------------------------------------------------------------------------------
const bulk = (who, ids, changes, reason = 'Supplier renamed') =>
  as(who, `select bulk_edit_purchases($1, $2::uuid[], $3::jsonb, $4, 'Tester') j`, [A, ids, JSON.stringify(changes), reason]).then((r) => r.rows[0].j)
// A purchase whose receipt failed (line id kept, no stock movement): a header edit through edit_purchase would receive
// its stock now, so it is skipped.
const failedReceipt = (await sup(`insert into purchases (business_id, supplier_name, product_name, quantity, cost_price, total_cost, amount_paid, balance, supply_date, items)
  values ($1, 'Late Ltd', 'Paracetamol', 5, 20, 100, 100, 0, '2026-10-27', '[{"id":"lx1","name":"Paracetamol","qty":5,"cost":20}]') returning id`, [A])).rows[0].id

await expectError('bulk edit: a rep without "Edit purchases" is refused', () => bulk('repA1', [p1], { notes: 'x' }), 'EDIT_NOT_ALLOWED')
await expectError('bulk edit: another business is refused', () => bulk('b', [p1], { notes: 'x' }), 'EDIT_NOT_ALLOWED')
await expectError('bulk edit: a reason is required', () => bulk('a', [p1], { notes: 'x' }, 'x'), 'EDIT_REASON')
await expectError('bulk edit: something must change', () => bulk('a', [p1], {}), 'EDIT_NOTHING')
await expectError('bulk edit: only header fields', () => bulk('a', [p1], { total_cost: 1 }), 'EDIT_NOTHING')
await expectError('bulk edit: anon cannot call it', () => as('anon', `select bulk_edit_purchases($1, $2::uuid[], '{"notes":"x"}', 'reason')`, [A, [p1]]), 'permission denied')
{
  const stockBefore = [await stockOf(amox), await stockOf(para), await stockOf(ors)]
  const r = await bulk('editor', [p1, sold, mystery, failedReceipt, bPurchase], { supplier_name: 'MedSupply Nigeria Ltd', due_date: '2026-12-31', notes: 'Q4 invoices' })
  ok('bulk edit: a role with "Edit purchases" updates every purchase it can, through edit_purchase', r.updated === 3 && r.unchanged === 0 && r.failed.length === 0 && r.rows.length === 3, JSON.stringify(r))
  ok('bulk edit: a purchase whose edit would move stock is skipped with the reason', r.skipped.length === 1 && r.skipped[0].id === failedReceipt && r.skipped[0].reason === 'stock_differs', JSON.stringify(r.skipped))
  ok('bulk edit: never moves stock', JSON.stringify([await stockOf(amox), await stockOf(para), await stockOf(ors)]) === JSON.stringify(stockBefore))
  const p = await snap(p1)
  ok('bulk edit: header changed, lines and money unchanged', p.supplier_name === 'MedSupply Nigeria Ltd' && p.due_date === '2026-12-31' && p.notes === 'Q4 invoices'
    && Number(p.total_cost) === 1480 && Number(p.amount_paid) === 1200 && p.edit_count === 2, JSON.stringify(p))
  const d = (await debtsOf(p1))[0]
  ok('bulk edit: the debt follows (supplier, due date)', d.party_name === 'MedSupply Nigeria Ltd' && d.due_date === '2026-12-31')
  ok('bulk edit: payment history carries the new supplier name', (await pays(p1)).every((x) => x.supplier_name === 'MedSupply Nigeria Ltd'))
  ok('bulk edit: each purchase audited with the reason', (await sup(`select count(*)::int n from audit_log where action = 'purchase.edited' and metadata->>'reason' = 'Supplier renamed'`)).rows[0].n === 3)
  ok('bulk edit: another business untouched', (await snap(bPurchase)).supplier_name === 'B Supplier')
  const same = await bulk('editor', [p1, sold], { supplier_name: 'MedSupply Nigeria Ltd' })
  ok('bulk edit: values already in place → unchanged, nothing written', same.updated === 0 && same.unchanged === 2)
  const clear = await bulk('a', [p1], { due_date: '' })
  ok('bulk edit: the due date can be removed', clear.updated === 1 && (await snap(p1)).due_date === '' && (await debtsOf(p1))[0].due_date === '')
  const bad = await bulk('a', [p1], { supply_date: '2099-01-01' })
  ok('bulk edit: a refusal from edit_purchase is reported per purchase', bad.updated === 0 && bad.failed.length === 1 && /future/.test(bad.failed[0].message), JSON.stringify(bad))
}

// ---- table access --------------------------------------------------------------------------------------
{
  const mine = (await as('repA1', `select count(*)::int n from deleted_purchases`)).rows[0].n
  const theirs = (await as('b', `select count(*)::int n from deleted_purchases`)).rows[0].n
  ok('deleted_purchases: members read their business\'s copies only', mine > 0 && theirs === 0)
  await expectError('deleted_purchases: no direct writes', () => as('a', `delete from deleted_purchases`), 'permission denied')
  await expectError('deleted_purchases: anon reads nothing', () => as('anon', `select 1 from deleted_purchases`), 'permission denied')
  await expectError('internal: member_can_delete is not callable', () => as('a', `select member_can_delete($1)`, [A]), 'permission denied')
}

finish()
