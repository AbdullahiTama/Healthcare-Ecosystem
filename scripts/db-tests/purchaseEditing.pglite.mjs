// Purchase editing, the direct-write guard and purchase analytics
// (carehub_20261229_purchase_editing_and_analytics). Purchases are first recorded the way the deployed
// client records them (insert, then receive_stock per line, items without line ids), plus one recorded
// before the ledger and one recorded before line items were kept, so the backfill and every edit run
// against the shapes that exist live. See _harness.mjs for scope and limits.
//   node scripts/db-tests/purchaseEditing.pglite.mjs
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

// ---- data as it exists before the migration -------------------------------------------------------
const amox = await product('Amoxicillin 500mg', 0, { cost: 80, barcode: '6001' })
const para = await product('Paracetamol', 0, { cost: 20 })
const ors = await product('ORS sachet', 0, { cost: 30 })
const old = await product('Vitamin C', 0, { cost: 40 })
const tracked = await product('Insulin', 0, { cost: 500, mode: 'batch_expiry' })
const otherB = await product('B product', 0, { biz: B })

const p1 = await recordPurchase('a', { supplier: 'MedSupply Ltd', date: '2026-10-30', paid: 1000,
  lines: [{ pid: amox, name: 'Amoxicillin 500mg', qty: 10, cost: 80 }, { pid: para, name: 'Paracetamol', qty: 50, cost: 20 }] })
const pre = await recordPurchase('a', { supplier: 'medsupply ltd ', date: '2026-09-15', ledger: false, createdAt: '2026-09-15 10:00',
  lines: [{ pid: old, name: 'vitamin c', qty: 10, cost: 40 }] })
// Recorded before line items were kept: a summary row.
const summary = (await sup(`insert into purchases (business_id, supplier_name, product_name, quantity, cost_price, total_cost, amount_paid, balance, supply_date, created_at)
  values ($1, 'Old Supplier', 'Gauze, Plaster', 20, 25, 500, 0, 500, '2026-08-01', '2026-08-01 09:00') returning id`, [A])).rows[0].id
const insulin = await recordPurchase('a', { supplier: 'Cold Chain', date: '2026-10-30',
  lines: [{ pid: tracked, name: 'Insulin', qty: 4, cost: 500, batch: 'B-1', expiry: '2027-06-30' }] })
const bPurchase = await recordPurchase('b', { supplier: 'B Supplier', date: '2026-10-30', biz: B, lines: [{ pid: otherB, name: 'B product', qty: 3, cost: 10 }] })

ok('before: stock as received', (await stockOf(amox)) === 10 && (await stockOf(para)) === 50 && (await stockOf(old)) === 10 && (await stockOf(tracked)) === 4)
await expectError('BEFORE: any member could PATCH a purchase directly (the hole the guard closes)', async () => {
  await as('repA1', `update purchases set total_cost = 1 where id = $1`, [p1]); throw new Error('allowed')
}, 'allowed')
await sup('update purchases set total_cost = 1800 where id = $1', [p1])

// A role the Owner granted "Edit purchases" to; the rep's role has no such row.
await sup(`insert into roles (business_id, name, permissions) values ($1, 'Regional Manager', '{"canEditPurchases": true}'), ($1, 'Sales Rep', '{"canEditPrice": true}')`, [A])

await applyMigrations(['carehub_20261229_purchase_editing_and_analytics.sql'])

// ---- backfill ---------------------------------------------------------------------------------------
const items = async (id) => (await purchaseRow(id)).items
{
  const it = await items(p1)
  ok('backfill: ledger-era lines take their receipt line id and product', it[0].id === 'line0' + p1.slice(0, 4) && it[0].product_id === amox && it[1].product_id === para && it[0].ledger_base === 0, JSON.stringify(it))
  const ip = await items(pre)
  ok('backfill: a pre-ledger line is matched to its product by name and keeps what it added outside the ledger', ip[0].id === 'legacy-1' && ip[0].product_id === old && ip[0].ledger_base === 10, JSON.stringify(ip))
  ok('backfill: a summary purchase keeps its summary (items stay empty)', (await items(summary)) === null)
  const ii = await items(insulin)
  ok('backfill: the batch the receipt created is remembered', !!ii[0].batch_id)
}

// ---- the guard ---------------------------------------------------------------------------------------
await expectError('guard: the Owner cannot PATCH a purchase directly', () => as('a', `update purchases set total_cost = 1 where id = $1`, [p1]), '42501')
await expectError('guard: no member can DELETE a purchase directly', () => as('repA1', `delete from purchases where id = $1`, [p1]), '42501')
{
  const r = await as('repA1', `select record_purchase_payment($1, 100, 'Cash', null, null, 'Rep One') j`, [p1])
  ok('guard: recording a supplier payment still works for any member', Number(r.rows[0].j.amount_paid) === 1100)
}

// ---- who may edit ------------------------------------------------------------------------------------
const line = (id, name, qty, cost, extra = {}) => ({ id, name, qty, cost, ...extra })
const edit = (who, id, { supplier = 'MedSupply Ltd', date = '2026-10-30', due = null, notes = '', lines, paid = null, reason = 'Invoice correction' }) =>
  as(who, `select edit_purchase($1,$2,$3::date,$4::date,$5,$6::jsonb,$7,$8,'Tester') j`, [id, supplier, date, due, notes, JSON.stringify(lines), paid, reason]).then((r) => r.rows[0].j)
const L0 = 'line0' + p1.slice(0, 4), L1 = 'line1' + p1.slice(0, 4)
const p1Lines = (amoxQty = 10, paraQty = 50, extra = {}) => [line(L0, 'Amoxicillin 500mg', amoxQty, 80, { product_id: amox, ...extra.a }), line(L1, 'Paracetamol', paraQty, 20, { product_id: para, ...extra.p })]

await expectError('auth: a rep without "Edit purchases" is refused', () => edit('repA1', p1, { lines: p1Lines(12) }), '42501')
await expectError('auth: another business cannot see the purchase', () => edit('b', p1, { lines: p1Lines(12) }), 'Purchase not found')
await expectError('auth: anon cannot call it', () => as('anon', `select edit_purchase($1,'x',current_date,null,'','[]'::jsonb,null,'reason')`, [p1]))
await expectError('a reason is required', () => edit('a', p1, { lines: p1Lines(12), reason: 'x' }), 'Say why')
ok('auth: refused edits changed nothing', (await stockOf(amox)) === 10)

// ---- quantity up and down on a ledger-era line ------------------------------------------------------
{
  const r = await edit('mgrA', p1, { lines: p1Lines(12) })
  ok('a role granted "Edit purchases" can edit', r.unchanged === false)
  ok('quantity up: stock +2 through the ledger', (await stockOf(amox)) === 12)
  const mv = (await sup(`select * from stock_movements where source_type = 'purchase_edit' and source_id = $1`, [p1])).rows
  ok('quantity up: one correction row, keyed per edit and line, with before and after', mv.length === 1 && mv[0].quantity === 2 && mv[0].qty_before === 10 && mv[0].qty_after === 12 && mv[0].movement_type === 'correction' && mv[0].idempotency_key.startsWith('purchase_edit:' + p1 + ':1:'), JSON.stringify(mv))
  const p = await purchaseRow(p1)
  ok('totals recomputed on the server', Number(p.total_cost) === 1960 && p.quantity === 62 && Number(p.balance) === 860 && p.status === 'partial' && p.edit_count === 1 && !!p.edited_at, JSON.stringify(p))
  const d = (await sup(`select * from debts where source_ref = $1`, [p1])).rows[0]
  ok('the supplier debt follows', Number(d.amount) === 1960 && Number(d.amount_paid) === 1100 && Number(d.balance) === 860 && d.status === 'pending')
  ok('the changed products come back for the screen', r.products.some((x) => x.id === amox && x.stock === 12))
  const audit = (await sup(`select * from audit_log where target_id = $1`, [p1])).rows
  ok('audited with the real actor, reason, before and after', audit.length === 1 && audit[0].action === 'purchase.edited' && audit[0].actor_id === '00000000-0000-0000-0000-0000000000c3' && audit[0].actor_type === 'staff'
    && audit[0].metadata.reason === 'Invoice correction' && Number(audit[0].metadata.before.total_cost) === 1800 && Number(audit[0].metadata.after.total_cost) === 1960)
}
await sell(amox, 9)                                                  // 12 → 3 on the shelf
{
  const f = (await as('a', `select get_purchase_for_edit($1) j`, [p1])).rows[0].j
  const l0 = f.items.find((x) => x.id === L0)
  ok('for edit: what the line added and the lowest quantity it can go to', l0.received === 12 && l0.product_stock === 3 && l0.min_qty === 9 && f.can_edit === true, JSON.stringify(l0))
  const fr = (await as('repA1', `select get_purchase_for_edit($1) j`, [p1])).rows[0].j
  ok('for edit: a member without the permission is told they cannot edit', fr.can_edit === false)
}
await expectError('quantity down past what is left is refused with a sentence', () => edit('a', p1, { lines: p1Lines(5) }), 'The lowest quantity you can set is 9')
ok('a refused edit leaves stock, totals and edit count alone', (await stockOf(amox)) === 3 && (await purchaseRow(p1)).edit_count === 1)
{
  await edit('a', p1, { lines: p1Lines(9) })
  ok('quantity down within what is left: 3 → 0', (await stockOf(amox)) === 0)
}

// ---- concurrent changes are refused, not overwritten ------------------------------------------------
{
  const editCount = (await purchaseRow(p1)).edit_count
  const paidNow = Number((await purchaseRow(p1)).amount_paid)
  await expectError('an edit opened before another edit is refused', () =>
    as('a', `select edit_purchase($1,'MedSupply Ltd','2026-10-30'::date,null,'',$2::jsonb,null,'Invoice correction','Tester',$3,null)`, [p1, JSON.stringify(p1Lines(9)), editCount - 1]), 'changed while you were editing')
  await expectError('an amount paid typed before a payment landed is refused', () =>
    as('a', `select edit_purchase($1,'MedSupply Ltd','2026-10-30'::date,null,'',$2::jsonb,500,'Invoice correction','Tester',$3,$4)`, [p1, JSON.stringify(p1Lines(9)), editCount, paidNow - 100]), 'changed while you were editing')
  const r = (await as('a', `select edit_purchase($1,'MedSupply Ltd','2026-10-30'::date,null,'',$2::jsonb,null,'Invoice correction','Tester',$3,$4) j`, [p1, JSON.stringify(p1Lines(9)), editCount, paidNow])).rows[0].j
  ok('with the versions the screen loaded, the edit goes through', r.unchanged === true)
}

// ---- nothing changed, and a retried edit -------------------------------------------------------------
{
  const r = await edit('a', p1, { lines: p1Lines(9) })
  ok('the same edit again is "unchanged" and writes nothing', r.unchanged === true && (await purchaseRow(p1)).edit_count === 2 && (await sup(`select count(*)::int c from audit_log where target_id=$1`, [p1])).rows[0].c === 2)
}

// ---- product change, removal, a new line with a new product ------------------------------------------
{
  await edit('a', p1, { lines: [line(L0, 'Amoxicillin 500mg', 9, 80, { product_id: amox }), line(L1, 'ORS sachet', 50, 20, { product_id: ors })] })
  ok('product change: Paracetamol gives back 50, ORS receives 50', (await stockOf(para)) === 0 && (await stockOf(ors)) === 50)
  const removeAmox = () => edit('a', p1, { lines: [line(L1, 'ORS sachet', 50, 20, { product_id: ors }), line('new1', 'Zinc tablets', 30, 15, { batch: 'Z9', expiry: '2027-01-31', barcode: '777' })] })
  await expectError('removing a line whose units were all sold is refused', removeAmox, 'only 0 of the 9 units')
  ok('the refused removal created nothing', (await sup(`select count(*)::int c from products where name='Zinc tablets'`)).rows[0].c === 0)
  await sup(`select apply_stock_change($1, $2, 9, 'adjustment', null, 'inventory_restock', null, null, 'restock', null, null)`, [A, amox])
  await removeAmox()
  const zinc = (await sup(`select * from products where business_id=$1 and name='Zinc tablets'`, [A])).rows[0]
  ok('removed line: its 9 units of Amoxicillin go back (9 → 0)', (await stockOf(amox)) === 0)
  ok('new line: the product is created with its barcode and receives 30 into its own batch', zinc && zinc.stock === 30 && zinc.barcode === '777' && Number(zinc.cost_price) === 15
    && (await sup(`select count(*)::int c from stock_batches where product_id=$1 and batch_number='Z9' and quantity=30`, [zinc.id])).rows[0].c === 1)
  const it = await items(p1)
  ok('the new line remembers its product and batch', it[1].product_id === zinc.id && !!it[1].batch_id)
  const p = await purchaseRow(p1)
  ok('summary columns follow the lines', p.product_name === 'ORS sachet, Zinc tablets' && Number(p.total_cost) === 1450 && p.quantity === 80 && p.batch === 'Z9' && p.expiry != null, JSON.stringify(p))
}
// Movements per product still chain and add up to the stock.
{
  const sums = (await sup(`select p.id, p.stock, coalesce(sum(m.quantity),0)::int s from products p left join stock_movements m on m.product_id=p.id where p.business_id=$1 group by p.id, p.stock`, [A])).rows
  ok('every product\'s stock equals the sum of its ledger rows (pre-ledger stock aside)', sums.filter((r) => r.id !== old).every((r) => r.stock === r.s), JSON.stringify(sums))
}

// ---- pre-ledger line: ledger_base carries what it added before the ledger ---------------------------
{
  await edit('a', pre, { supplier: 'MedSupply Ltd', date: '2026-09-15', lines: [line('legacy-1', 'Vitamin C', 12, 40, { product_id: old })] })
  ok('pre-ledger line 10 → 12 adds 2', (await stockOf(old)) === 12)
  await edit('a', pre, { supplier: 'MedSupply Ltd', date: '2026-09-15', lines: [line('legacy-1', 'Vitamin C', 8, 40, { product_id: old })] })
  ok('then 12 → 8 takes back 4 (the base is not lost after the first edit)', (await stockOf(old)) === 8)
}

// ---- a summary purchase: locked product and quantity ----------------------------------------------
await expectError('summary line: quantity cannot change (no product to move)', () =>
  edit('a', summary, { supplier: 'Old Supplier', date: '2026-08-01', lines: [line('legacy-1', 'Gauze, Plaster', 25, 25)] }), 'not linked to a product')
{
  await edit('a', summary, { supplier: 'Old Supplier', date: '2026-08-01', lines: [line('legacy-1', 'Gauze, Plaster', 20, 30)] })
  const p = await purchaseRow(summary)
  ok('summary line: the unit cost can be corrected and the total follows', Number(p.total_cost) === 600 && Number(p.balance) === 600)
  ok('summary line: still not linked, still locked, still a summary', p.items[0].product_id === null && p.items[0].ledger_base === 20 && p.items[0].summary === true)
  const d = (await sup(`select * from debts where source_ref = $1`, [summary])).rows[0]
  ok('a purchase with a balance and no debt gets one', d && d.direction === 'we_owe' && Number(d.balance) === 600)
}

// ---- payments ----------------------------------------------------------------------------------------
await expectError('paid more than the new total is refused', () =>
  edit('a', p1, { lines: [line(L1, 'ORS sachet', 50, 20, { product_id: ors })], paid: 1101 }), 'more than the new total')
{
  await edit('a', p1, { supplier: 'MedSupply Limited', lines: [line(L1, 'ORS sachet', 50, 20, { product_id: ors }), line('new1', 'Zinc tablets', 30, 15, { batch: 'Z9', expiry: '2027-01-31', barcode: '777' })], paid: 900 })
  const pays = (await sup(`select * from purchase_payments where purchase_id=$1 order by created_at`, [p1])).rows
  const sum = pays.reduce((s, x) => s + Number(x.amount), 0)
  ok('a lower amount paid is a correction row, and history still adds up', pays.at(-1).kind === 'correction' && Number(pays.at(-1).amount) === -200 && sum === 900, JSON.stringify(pays.map((x) => [x.kind, x.amount])))
  ok('renaming the supplier moves its payments with it', pays.every((x) => x.supplier_name === 'MedSupply Limited'))
  const d = (await sup(`select * from debts where source_ref = $1`, [p1])).rows[0]
  ok('the debt is renamed and re-balanced', d.party_name === 'MedSupply Limited' && Number(d.balance) === 550)
}

// ---- barcodes, cost, batches ------------------------------------------------------------------------
await expectError('a barcode that belongs to another product is refused', () =>
  edit('a', p1, { supplier: 'MedSupply Limited', lines: [line(L1, 'ORS sachet', 50, 20, { product_id: ors, barcode: '6001' })], paid: 900 }), 'belongs to Amoxicillin')
{
  await edit('a', p1, { supplier: 'MedSupply Limited', lines: [line(L1, 'ORS sachet', 50, 25, { product_id: ors, barcode: '8888' }), line('new1', 'Zinc tablets', 30, 18, { batch: 'Z9', expiry: '2027-01-31', barcode: '777' })], paid: 900 })
  const o = (await sup(`select barcode, cost_price from products where id=$1`, [ors])).rows[0]
  const z = (await sup(`select cost_price from products where name='Zinc tablets'`)).rows[0]
  ok('a product without a barcode gets the one entered on the line', o.barcode === '8888')
  ok('the product cost is corrected when it still came from this line (Zinc 15 → 18)', Number(z.cost_price) === 18)
  ok('a product whose cost came from elsewhere keeps it (ORS stays 30)', Number(o.cost_price) === 30)
}
{
  const ii = (await purchaseRow(insulin)).items[0]
  await edit('a', insulin, { supplier: 'Cold Chain', lines: [line(ii.id, 'Insulin', 6, 500, { product_id: tracked, batch: 'B-1A', expiry: '2027-07-31' })] })
  const b = (await sup(`select * from stock_batches where id=$1`, [ii.batch_id])).rows[0]
  ok('tracked product: the line\'s own batch is renumbered and receives the extra units', b.batch_number === 'B-1A' && b.quantity === 6 && (await stockOf(tracked)) === 6)
  await expectError('tracked product: a batch number is required', () =>
    edit('a', insulin, { supplier: 'Cold Chain', lines: [line(ii.id, 'Insulin', 6, 500, { product_id: tracked, batch: '', expiry: '2027-07-31' })] }), 'tracked by batch')
}

// ---- analytics ---------------------------------------------------------------------------------------
{
  const hist = (await as('a', `select * from get_purchase_history($1)`, [A])).rows
  ok('history: every line of every purchase, newest supply date first', hist.length === 5 && hist[0].purchase_date >= hist.at(-1).purchase_date, hist.length)
  const oct = (await as('a', `select * from get_purchase_history($1, '2026-10-01', '2026-10-31')`, [A])).rows
  ok('history: a date range uses the supply date', oct.length === 3 && oct.every((r) => String(r.purchase_date instanceof Date ? r.purchase_date.toISOString() : r.purchase_date).startsWith('2026-10')))
  const byBarcode = (await as('a', `select * from get_purchase_history($1, null, null, '777')`, [A])).rows
  ok('history: search finds a line by barcode', byBarcode.length === 1 && byBarcode[0].item_name === 'Zinc tablets')
  const sum = (await as('a', `select * from get_purchase_summary($1)`, [A])).rows[0]
  const purchasesTotal = (await sup(`select sum(total_cost) s, sum(amount_paid) p, sum(balance) b from purchases where business_id=$1`, [A])).rows[0]
  ok('summary: spend, paid and outstanding agree with the purchases', Number(sum.total_spent) === Number(purchasesTotal.s) && Number(sum.amount_paid) === Number(purchasesTotal.p) && Number(sum.balance) === Number(purchasesTotal.b) && Number(sum.purchase_count) === 4, JSON.stringify(sum))
  const sup1 = (await as('a', `select * from get_purchase_supplier_stats($1)`, [A])).rows
  const keys = sup1.map((s) => s.supplier_key)
  ok('suppliers: one row per supplier, keyed ignoring case and spaces', new Set(keys).size === keys.length && keys.includes('medsupply limited') && keys.includes('medsupply ltd') && keys.length === 4, JSON.stringify(keys))
  const supMs = (await as('a', `select * from get_purchase_summary($1, null, null, null, 'MEDSUPPLY LIMITED')`, [A])).rows[0]
  ok('summary for one supplier', Number(supMs.purchase_count) === 1 && Number(supMs.total_spent) === Number((await purchaseRow(p1)).total_cost) && Number(supMs.total_spent) === 1790, JSON.stringify(supMs))
  const prodAll = (await as('a', `select * from get_purchase_product_stats($1)`, [A])).rows
  ok('products: summary lines are left out of price statistics', !prodAll.some((p) => p.product_key === 'gauze, plaster'))
  ok('products: the total count comes back for paging', Number(prodAll[0].total_count) === prodAll.length)
}
{
  // A second purchase of ORS at a different price: last and previous price.
  await recordPurchase('a', { supplier: 'Pharma Hub', date: '2026-10-31', lines: [{ pid: ors, name: 'ORS sachet', qty: 10, cost: 28 }] })
  // The screen asks by product id AND name: lines saved by the deployed client carry only the name.
  const s = (await as('a', `select * from get_purchase_product_stats($1, null, null, null, null, 'ORS sachet', $2)`, [A, ors])).rows[0]
  ok('product: times bought, last and previous unit cost, last supplier', Number(s.times_purchased) === 2 && Number(s.last_cost) === 28 && Number(s.previous_cost) === 25
    && s.last_supplier === 'Pharma Hub' && Number(s.units) === 60 && Number(s.min_cost) === 25 && Number(s.max_cost) === 28, JSON.stringify(s))
  const byName = (await as('a', `select * from get_purchase_product_stats($1, null, null, null, null, 'ors  SACHET')`, [A])).rows
  ok('product: lines saved without a product id are matched by name', byName.length === 1 && Number(byName[0].times_purchased) === 2)
}
{
  const bSees = (await as('b', `select * from get_purchase_history($1)`, [A])).rows
  ok('isolation: another business sees none of these lines', bSees.length === 0)
  const bOwn = (await as('b', `select * from get_purchase_summary($1)`, [B])).rows[0]
  ok('isolation: and its own summary only', Number(bOwn.purchase_count) === 1 && Number(bOwn.total_spent) === 30)
  await expectError('anon cannot read purchase analytics', () => as('anon', `select * from get_purchase_history($1)`, [A]))
}

// ---- the purchase list -------------------------------------------------------------------------------
{
  const page = (await as('a', `select * from get_purchases_page($1, null, null, null, 0, 50, '2026-10-01', '2026-10-31', null)`, [A])).rows
  ok('list: date range by supply date, newest first, with edit columns', page.length === 3 && page.some((r) => r.edit_count > 0) && page[0].supply_date >= page.at(-1).supply_date)
  const bySupplier = (await as('a', `select * from get_purchases_page($1, null, null, null, 0, 50, null, null, ' cold chain')`, [A])).rows
  ok('list: supplier filter ignores case and spaces', bySupplier.length === 1)
  const legacy = (await as('a', `select * from get_purchases_page($1, null, null, null, 0, 50)`, [A])).rows
  ok('list: an older client\'s six-argument call still works', legacy.length === 5)
  await expectError('list: another business is refused', () => as('b', `select * from get_purchases_page($1)`, [A]), '42501')
}

// ---- grants ------------------------------------------------------------------------------------------
{
  const acl = (await sup(`select proname, coalesce(proacl::text,'') a from pg_proc where proname in ('can_edit_purchases','purchase_items_normalized','purchases_guard_direct_write','purchase_line_received')`)).rows
  ok('internal helpers are not callable by clients', acl.every((r) => !r.a.includes('authenticated=') && !r.a.includes('anon=') && r.a !== ''), JSON.stringify(acl))
  await expectError('a signed-in user cannot call can_edit_purchases directly', () => as('a', `select can_edit_purchases($1)`, [A]))
}

finish()
