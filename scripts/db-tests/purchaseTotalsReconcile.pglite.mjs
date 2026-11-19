// Purchases totals reconcile with the Purchase Summary; uploaded lines without a quantity are recorded and counted
// (carehub_20270131_purchase_totals_reconcile), on top of the live purchase functions (carehub_20261229, whose
// bodies match production). Shapes as purchaseEditing.pglite.mjs.
//   node scripts/db-tests/purchaseTotalsReconcile.pglite.mjs
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


await sup(`insert into roles (business_id, name, permissions) values ($1, 'Regional Manager', '{"canEditPurchases": true}')`, [A])
await applyMigrations(['carehub_20261229_purchase_editing_and_analytics.sql'], { rerun: false })
// get_purchase_totals as live (carefind_20261019_red_team_fixes, md5-checked 2026-11-19), with its grants.
{
  const red = fs.readFileSync(migrationPath('carefind_20261019_red_team_fixes.sql'), 'utf8')
  await db.exec(red.match(/create or replace function public\.get_purchase_totals[\s\S]*?\n\$\$;/)[0])
  await db.exec(`revoke all on function public.get_purchase_totals(uuid) from public, anon; grant execute on function public.get_purchase_totals(uuid) to authenticated, service_role;`)
}

const amox = await product('Amoxicillin 500mg', 0, { cost: 80 })
const para = await product('Paracetamol', 0, { cost: 20 })
const gauze = await product('Gauze', 0, { cost: 10 })

// Recorded the way the app records them now: line ids, then a receipt per line with a quantity.
async function record(who, { supplier, date, lines, paid = 0, biz = A }) {
  const total = lines.reduce((s, l) => s + (l.no_qty ? l.amount : l.qty * l.cost), 0)
  const units = lines.reduce((s, l) => s + (l.no_qty ? 0 : l.qty), 0)
  const items = lines.map((l, n) => l.no_qty
    ? { id: 'L' + n + '-' + supplier.slice(0, 3) + date, product_id: l.pid || null, name: l.name, qty: null, cost: null, amount: l.amount, no_qty: true, sell: null, batch: null, expiry: null, cat: 'Medicines' }
    : { id: 'L' + n + '-' + supplier.slice(0, 3) + date, product_id: l.pid, name: l.name, qty: l.qty, cost: l.cost, sell: null, batch: null, expiry: null, cat: 'Medicines' })
  const row = (await as(who, `insert into purchases (business_id, supplier_name, product_name, quantity, cost_price, total_cost, amount_paid, balance,
      supply_date, due_date, status, notes, items) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'',$10,'',$11) returning id`,
    [biz, supplier, lines.map((l) => l.name).join(', '), units, units ? total / units : 0, total, paid, Math.max(0, total - paid), date, paid >= total ? 'paid' : 'pending', JSON.stringify(items)])).rows[0]
  for (const [n, l] of lines.entries()) {
    if (l.no_qty) continue
    await as(who, `select receive_stock($1,$2,$3,'purchase_receipt',$4,'purchase',$5,$6,'Purchase from x',null,null,$7,$8)`,
      [biz, l.pid, l.qty, 'purchase:' + row.id + ':' + items[n].id, row.id, items[n].id, date, supplier])
  }
  if (total - paid > 0) {
    await as(who, `insert into debts (business_id, direction, party_name, amount, amount_paid, balance, due_date, status, description, source, source_ref)
      values ($1,'we_owe',$2,$3,$4,$5,'','pending','Purchase','purchase',$6)`, [biz, supplier, total, paid, total - paid, row.id])
  }
  return { id: row.id, items }
}

// October: an ordinary purchase. November: one uploaded with a line that has no quantity, and one with
// a long-decimal unit cost (the live kobo drift). A purchase whose items hold no object line. Business A: 4 purchases.
const oct = await record('a', { supplier: 'MedSupply', date: '2026-10-05', paid: 500, lines: [{ pid: amox, name: 'Amoxicillin 500mg', qty: 10, cost: 80 }] })
const nov = await record('a', { supplier: 'Emzor', date: '2026-11-03', lines: [
  { pid: para, name: 'Paracetamol', qty: 100, cost: 20 },
  { pid: gauze, name: 'Gauze', no_qty: true, amount: 4500 },
] })
const drift = await record('a', { supplier: 'Emzor', date: '2026-11-10', paid: 0, lines: [{ pid: amox, name: 'Amoxicillin 500mg', qty: 6, cost: 4666.66667 }] })
await sup(`update purchases set total_cost = 28000.00002, balance = 28000.00002 where id = $1`, [drift.id])   // as stored live
const odd = (await sup(`insert into purchases (business_id, supplier_name, product_name, quantity, cost_price, total_cost, amount_paid, balance, supply_date, items)
  values ($1, 'Odd Supplier', 'Bandage', 2, 50, 100, 0, 100, '2026-11-12', '["not an object"]'::jsonb) returning id`, [A])).rows[0].id
await record('b', { supplier: 'B Supplier', date: '2026-11-03', biz: B, lines: [{ pid: await product('B product', 0, { biz: B }), name: 'B product', qty: 3, cost: 10 }] })

const summary = async (from = null, to = null, supplier = null, search = null, productKey = null) =>
  (await as('a', `select * from get_purchase_summary($1,$2,$3,$4,$5,$6,null)`, [A, from, to, search, supplier, productKey])).rows[0]
const listed = async (from = null, to = null, supplier = null, search = null) =>
  (await as('a', `select * from get_purchases_page($1,$2,null,null,0,500,$3,$4,$5)`, [A, search, from, to, supplier])).rows
const sum = (rows, k) => Math.round(rows.reduce((s, r) => s + Number(r[k] || 0), 0) * 100) / 100
const money = (n) => Math.round(Number(n) * 100) / 100

// ---- before: the defect ----------------------------------------------------------------------------------
{
  const s = await summary()
  const list = await listed()
  ok('BEFORE: the summary leaves out the amount of a line without a quantity (and drops a purchase with no object line)',
    money(s.total_spent) < sum(list, 'total_cost') - 4000 && Number(s.purchase_count) === list.length - 1, JSON.stringify({ s, listTotal: sum(list, 'total_cost'), n: list.length }))
  const t = (await as('a', `select * from get_purchase_totals($1)`, [A])).rows[0]
  ok('BEFORE: the Purchases figures are all-time whatever the list shows (no period, supplier or total)', Number(t.purchase_count) === 4 && t.total_amount === undefined)
}

await applyMigrations(['carehub_20270131_purchase_totals_reconcile.sql'])

// ---- after: one set of figures -----------------------------------------------------------------------
const totals = async (from = null, to = null, supplier = null, search = null) =>
  (await as('a', `select * from get_purchase_totals($1,$2,$3,$4,$5)`, [A, from, to, supplier, search])).rows[0]
for (const [label, from, to, supplier] of [['all time', null, null, null], ['November', '2026-11-01', '2026-11-30', null], ['October', '2026-10-01', '2026-10-31', null], ['one supplier', null, null, 'emzor'], ['empty month', '2026-01-01', '2026-01-31', null]]) {
  const list = await listed(from, to, supplier)
  const t = await totals(from, to, supplier)
  const s = await summary(from, to, supplier)
  ok(`${label}: the Purchases figures describe exactly the purchases listed`,
    Number(t.purchase_count) === list.length && money(t.total_amount) === sum(list, 'total_cost') && money(t.total_paid) === sum(list, 'amount_paid') && money(t.total_owed) === sum(list, 'balance'),
    JSON.stringify({ t, n: list.length }))
  ok(`${label}: the Purchase Summary has the same count, total, paid and outstanding`,
    Number(s.purchase_count) === Number(t.purchase_count) && money(s.total_spent) === money(t.total_amount) && money(s.amount_paid) === money(t.total_paid) && money(s.balance) === money(t.total_owed),
    JSON.stringify({ s, t }))
  ok(`${label}: paid + owed = total`, money(Number(t.total_paid) + Number(t.total_owed)) === money(t.total_amount))
  const sup2 = (await as('a', `select * from get_purchase_supplier_stats($1,$2,$3,null,null,null)`, [A, from, to])).rows
  if (!supplier) ok(`${label}: spending per supplier adds up to the total`, money(sum(sup2, 'total_spent')) === money(t.total_amount), JSON.stringify(sup2))
}
{
  const t1 = (await as('a', `select * from get_purchase_totals($1)`, [A])).rows[0]
  ok('the one-argument call (an app not yet updated) still works, all time', Number(t1.purchase_count) === 4)
  const s = await summary()
  ok('the long-decimal purchase is counted at its own total (no kobo drift)', money(s.total_spent) === money(800 + 2000 + 4500 + 28000.00002 + 100), s.total_spent)
  ok('a purchase whose items hold no object line is still in the summary', Number(s.purchase_count) === 4)
}

// ---- the amount-only line ----------------------------------------------------------------------------
{
  const rows = (await as('a', `select * from purchase_line_rows($1, null, null) where purchase_id = $2 order by line_no`, [A, nov.id])).rows
  ok('a line without a quantity: no quantity or unit cost, its amount counts', rows[1].qty === null && rows[1].unit_cost === null && Number(rows[1].line_total) === 4500, JSON.stringify(rows[1]))
  const g = (await as('a', `select * from get_purchase_product_stats($1,null,null,null,null,null,null,'spend',0,50) where product_key = 'gauze'`, [A])).rows[0]
  ok('product stats: the amount counts as spend, but invents no unit cost', Number(g.total_spent) === 4500 && g.avg_cost === null && g.min_cost === null && g.last_cost === null, JSON.stringify(g))
  const byProduct = await summary(null, null, null, null, 'Gauze')
  ok('narrowed to the product, the summary shows its amount', money(byProduct.total_spent) === 4500)
  ok('no stock was added for it', (await stockOf(gauze)) === 0)
}

// ---- editing a purchase with an amount-only line ------------------------------------------------------
const edit = (who, id, lines, { paid = null, supplier = 'Emzor', date = '2026-11-03', reason = 'Invoice correction' } = {}) =>
  as(who, `select edit_purchase($1,$2,$3::date,null,'',$4::jsonb,$5,$6,'Tester') j`, [id, supplier, date, JSON.stringify(lines), paid, reason]).then((r) => r.rows[0].j)
const [P0, G0] = nov.items
const paraLine = { id: P0.id, name: 'Paracetamol', qty: 100, cost: 20, product_id: para }
{
  const r = await edit('a', nov.id, [paraLine, { id: G0.id, name: 'Gauze', no_qty: true, qty: null, cost: null, amount: 5000 }])
  const p = await purchaseRow(nov.id)
  ok('edit: the amount of a line without a quantity can be corrected; totals and the debt follow', r.unchanged === false && Number(p.total_cost) === 7000 && Number(p.balance) === 7000 && p.quantity === 100 && Number(p.cost_price) === 20, JSON.stringify(p))
  ok('edit: still no stock for it', (await stockOf(gauze)) === 0 && (await stockOf(para)) === 100)
  const d = (await sup(`select amount, balance from debts where source_ref = $1`, [nov.id])).rows[0]
  ok('edit: the supplier debt follows', Number(d.amount) === 7000 && Number(d.balance) === 7000)
  const same = await edit('a', nov.id, [paraLine, { id: G0.id, name: 'Gauze', no_qty: true, qty: null, cost: null, amount: 5000 }])
  ok('edit: sending it again unchanged writes nothing', same.unchanged === true)
}
await expectError('edit: a line without a quantity cannot be emptied to nothing', () =>
  edit('a', nov.id, [paraLine, { id: G0.id, name: 'Gauze', no_qty: true, amount: 0 }]), 'enter the amount')
await expectError('edit: a NEW line needs a quantity', () =>
  edit('a', nov.id, [paraLine, { id: G0.id, name: 'Gauze', no_qty: true, amount: 5000 }, { id: 'new-1', name: 'Plaster', no_qty: true, amount: 300 }]), 'quantity must be a whole number')
await expectError('edit: a line that added stock cannot lose its quantity', () =>
  edit('a', nov.id, [{ ...paraLine, qty: null, cost: null, no_qty: true, amount: 2000 }, { id: G0.id, name: 'Gauze', no_qty: true, amount: 5000 }]), 'quantity must be a whole number')
{
  const r = await edit('mgrA', nov.id, [paraLine, { id: G0.id, name: 'Gauze', qty: 50, cost: 90, product_id: gauze }])
  const p = await purchaseRow(nov.id)
  ok('edit: completing the quantity receives the stock as a purchase receipt', (await stockOf(gauze)) === 50, await stockOf(gauze))
  const mv = (await sup(`select movement_type, quantity from stock_movements where product_id = $1`, [gauze])).rows
  ok('edit: one receipt movement for the completed line', mv.length === 1 && mv[0].movement_type === 'purchase_receipt' && mv[0].quantity === 50, JSON.stringify(mv))
  ok('edit: the line is a normal line now, totals from quantity x cost', Number(p.total_cost) === 6500 && p.quantity === 150 && !p.items.some((x) => x.no_qty), JSON.stringify(p.items))
  ok('edit: products touched come back for the screen', r.products.some((x) => x.id === gauze && x.stock === 50))
}

// ---- access ------------------------------------------------------------------------------------------
await expectError('totals: anon cannot call it', () => as('anon', `select * from get_purchase_totals($1)`, [A]), 'permission denied')
await expectError("totals: another business's figures are refused", () => as('b', `select * from get_purchase_totals($1)`, [A]), 'Not authorized')
await expectError('edit: a rep without "Edit purchases" is still refused', () => edit('repA1', nov.id, [paraLine]), '42501')
{
  const g = (await sup(`select has_function_privilege('anon','get_purchase_totals(uuid,date,date,text,text)','execute') a,
    has_function_privilege('authenticated','get_purchase_totals(uuid,date,date,text,text)','execute') b,
    has_function_privilege('anon','edit_purchase(uuid,text,date,date,text,jsonb,numeric,text,text,integer,numeric)','execute') c`)).rows[0]
  ok('grants unchanged', g.a === false && g.b === true && g.c === false, JSON.stringify(g))
}

finish()
