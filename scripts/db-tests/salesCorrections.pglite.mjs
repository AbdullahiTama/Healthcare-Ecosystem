// Sales corrections database tests: held sales stay held, completing a resumed
// hold converts it atomically, direct client writes are blocked, and edit /
// delete / refund are Owner-only, ledger-consistent and audited.
// See _harness.mjs for scope and limits.
//   node scripts/db-tests/salesCorrections.pglite.mjs
import fs from 'node:fs'
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, USERS, REPO } from './_harness.mjs'

// ---- live-shaped stand-ins (columns as seen live on 2026-10-25) ---------------------------------
await db.exec(`
  ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS owner_name text, ADD COLUMN IF NOT EXISTS owner text;
  ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS auth_user_id uuid;
  ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS branch_depth_limit integer NOT NULL DEFAULT 1;
  -- Live current_business_ids() (read 2026-10-25): includes branches below what
  -- the caller owns or works at. The harness stand-in does not, and branch
  -- membership matters here.
  CREATE OR REPLACE FUNCTION public.current_business_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    WITH RECURSIVE visible AS (
      SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b
       WHERE lower(b.email) = lower(auth.email())
      UNION
      SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b
       INNER JOIN staff s ON s.business_id = b.id WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'
      UNION ALL
      SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1 FROM businesses child
       INNER JOIN visible ON child.parent_business_id = visible.id WHERE visible.depth < visible.branch_depth_limit)
    SELECT DISTINCT id FROM visible $$;
  CREATE TABLE public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, permissions jsonb);
  CREATE TABLE public.sales (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
    txn_no text, client_name text DEFAULT 'Walk-in', client_id uuid, items jsonb DEFAULT '[]'::jsonb,
    subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, total numeric DEFAULT 0,
    payment_method text DEFAULT 'Cash', payment_split jsonb, amount_paid numeric DEFAULT 0, balance numeric DEFAULT 0,
    is_credit boolean DEFAULT false, is_on_hold boolean DEFAULT false, staff_name text,
    created_at timestamp without time zone DEFAULT now(), notes text, status text, dispense_ref text);
  ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "sales of own business" ON public.sales FOR ALL
    USING ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
    WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());
  GRANT ALL ON public.sales TO anon, authenticated;
  CREATE TABLE public.debts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, direction text, party_name text,
    amount numeric, amount_paid numeric, balance numeric, due_date text, status text, description text,
    created_at timestamp DEFAULT now(), source text, source_ref text, client_id uuid);
  ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "debts of own business" ON public.debts FOR ALL
    USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  GRANT ALL ON public.debts TO anon, authenticated;
  -- Live definition of is_business_manager (carehub_20260823 + the 20261132 grant).
  CREATE OR REPLACE FUNCTION public.is_business_manager(bid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    WITH RECURSIVE ancestry AS (
      SELECT b.id, b.parent_business_id, b.email, 0 AS depth FROM businesses b WHERE b.id = bid
      UNION ALL
      SELECT p.id, p.parent_business_id, p.email, a.depth + 1 FROM businesses p
        INNER JOIN ancestry a ON p.id = a.parent_business_id WHERE a.depth < 10)
    SELECT (bid IN (SELECT current_business_ids()) AND (
        EXISTS (SELECT 1 FROM ancestry a WHERE lower(a.email) = lower(auth.email()))
        OR EXISTS (SELECT 1 FROM staff s WHERE s.business_id = bid AND lower(s.email) = lower(auth.email())
                   AND s.status = 'active' AND s.role ~* 'manager')))
      OR public.is_platform_admin() $$;
`)
await applyMigrations(['carehub_20260810_audit_log.sql'], { rerun: false })
await db.exec(`GRANT ALL ON public.audit_log TO anon, authenticated;`)
await applyMigrations(['carehub_20261209_record_export_audit.sql'], { rerun: false })


await db.exec(`
  -- Stock tables shaped like live (read 2026-10-30), including the ledger's
  -- movement-type CHECK: without it the old 'sale_correction' rows passed
  -- here while production would have refused them.
  CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, stock integer, category text,
    tracking_mode text NOT NULL DEFAULT 'none');
  CREATE TABLE public.stock_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, product_id uuid, product_name text,
    batch_number text, quantity integer NOT NULL DEFAULT 0, expiry_date date, status text NOT NULL DEFAULT 'available', created_at timestamptz DEFAULT now());
  CREATE TABLE public.stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid,
    to_location_id uuid, movement_type text NOT NULL, quantity integer NOT NULL, reason text, moved_by text, created_at timestamptz DEFAULT now(),
    product_id uuid, source_type text, source_id text, source_line_id text, idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
    CONSTRAINT stock_movements_type_check CHECK (movement_type = ANY (ARRAY['opening','purchase_receipt','sale','sale_reversal','return_restock',
      'return_writeoff','adjustment','write_off','transfer','tracking_change','correction'])));
  CREATE UNIQUE INDEX stock_movements_idem_uniq ON public.stock_movements (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  GRANT ALL ON public.products, public.stock_batches, public.stock_movements TO authenticated;
`)
// The live stock ledger (apply_stock_change and its guards), from the snapshot
// of production; it has no migration in this repository.
await db.exec(fs.readFileSync(REPO + '/docs/architecture/stock-ledger-live-snapshot.sql', 'utf8'))
await applyMigrations(['carehub_20261210_pos_accounting.sql'], { rerun: false })
// The live sale triggers: stock moves on INSERT only.
await db.exec(`
  CREATE FUNCTION public.apply_sale_stock_movement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    IF coalesce(NEW.is_on_hold, false) THEN RETURN NEW; END IF;
    UPDATE products p SET stock = greatest(0, coalesce(p.stock,0) - l.q) FROM
      (SELECT product_id, sum(qty)::int q FROM public.sale_stock_lines(NEW.items) GROUP BY 1) l
     WHERE p.id = l.product_id AND p.business_id = NEW.business_id AND coalesce(p.category,'') <> 'Services';
    RETURN NEW;
  END $$;
`)
await applyMigrations(['carehub_20261216_sales_owner_corrections.sql'])
await db.exec(`CREATE TRIGGER sale_stock_movement AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION public.apply_sale_stock_movement();`)
// Sales onto the stock ledger: replaces the sale trigger and the correction function above.
await applyMigrations(['carehub_20261224_sale_stock_ledger.sql', 'carehub_20261224b_pin_cutover_search_path.sql'])

const S = await seedStaff()
await sup(`update businesses set owner_name = 'Ada Owner' where id = $1`, [S.A])
await sup(`update staff set role = 'Owner' where id = $1`, [S.repA2]) // an Owner-role staff member

const prodA = (await sup(`insert into products (business_id,name,stock,category) values ($1,'Paracetamol',100,'Drugs') returning id`, [S.A])).rows[0].id
const prodB = (await sup(`insert into products (business_id,name,stock,category) values ($1,'Amoxil',50,'Drugs') returning id`, [S.A])).rows[0].id
const prodSvc = (await sup(`insert into products (business_id,name,stock,category) values ($1,'Consult',999,'Services') returning id`, [S.A])).rows[0].id
const batch = (await sup(`insert into stock_batches (business_id,product_id,product_name,quantity) values ($1,$2,'Amoxil',40) returning id`, [S.A, prodB])).rows[0].id
const stock = async (id) => (await sup('select stock from products where id=$1', [id])).rows[0].stock
const batchQty = async () => (await sup('select quantity from stock_batches where id=$1', [batch])).rows[0].quantity
const line = (id, name, price, qty, extra = {}) => ({ id, name, price, qty, ...extra })
const enc = (items) => JSON.stringify(JSON.stringify(items))

const mk = (who, cols) => as(who,
  `insert into sales (business_id, txn_no, client_name, client_id, items, subtotal, discount, total, payment_method, amount_paid, balance, is_credit, is_on_hold, notes, resumed_from, payment_split)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
  [S.A, cols.txn, cols.client ?? 'Walk-in', cols.clientId ?? null, cols.items ?? enc([]), cols.sub ?? cols.total, cols.disc ?? 0, cols.total, cols.method ?? 'Cash',
    cols.paid ?? cols.total, cols.balance ?? 0, cols.credit ?? false, cols.hold ?? false, cols.notes ?? null, cols.resumedFrom ?? null, cols.split ?? null]).then((r) => r.rows[0].id)
const sale = (id) => sup('select * from sales where id=$1', [id]).then((r) => r.rows[0])
const net = (id) => sup(`select coalesce(sum(case when kind='refund' then -amount else amount end),0)::float8 n from sale_payments where sale_id=$1`, [id]).then((r) => r.rows[0].n)
const audits = (id) => sup(`select action, actor_type, metadata from audit_log where target_id=$1 order by created_at, id`, [id]).then((r) => r.rows)

// ---- ownership ---------------------------------------------------------------------------------
const isOwner = (who) => as(who, 'select public.is_business_owner($1) o', [S.A]).then((r) => r.rows[0].o).catch(() => 'denied')
// is_business_owner is internal: signed-in clients cannot call it directly.
ok('is_business_owner is not callable by clients', (await isOwner('a')) === 'denied')
const ownerProbe = async (who) => {
  const id = await mk('repA1', { txn: 'PROBE-' + who, total: 100, items: enc([line(prodA, 'Paracetamol', 100, 1)]) })
  try { await as(who, `select public.edit_sale($1,$2::jsonb,0,null,'x','probe reason')`, [id, JSON.stringify([line(prodA, 'Paracetamol', 100, 1)])]); return true }
  catch (e) { return /Only the Owner/.test(e.message) ? false : 'err ' + e.message }
}
ok('Owner (business login) may correct sales', (await ownerProbe('a')) === true)
ok('Owner-role staff may correct sales', (await ownerProbe('repA2')) === true)
ok('a Manager may NOT correct sales', (await ownerProbe('mgrA')) === false)
ok('a cashier may NOT correct sales', (await ownerProbe('repA1')) === false)
ok('another business\'s owner cannot see the sale at all', await as('b', `select public.edit_sale((select id from sales limit 1),'[]'::jsonb,0,null,'x','probe reason')`).then(() => false).catch((e) => /Sale not found/.test(e.message)))

const baseA = await stock(prodA), baseB = await stock(prodB)
// ---- held sales ----------------------------------------------------------------------------------
const held = await mk('repA1', { txn: 'HLD-1', total: 500, paid: 0, balance: 500, method: 'On Hold', hold: true, items: enc([line(prodA, 'Paracetamol', 250, 2)]) })
ok('a held sale does not move stock', (await stock(prodA)) === baseA)
await expectError('a cashier cannot release a held sale (delete → completed leak)', () => as('repA1', `update sales set is_on_hold=false, status='deleted' where id=$1`, [held]), '42501')
await expectError('a cashier cannot mark a held sale resumed', () => as('repA1', `update sales set status='resumed' where id=$1`, [held]), '42501')
await expectError('the Owner cannot release a held sale directly either', () => as('a', `update sales set is_on_hold=false where id=$1`, [held]), '42501')
await expectError('nobody can DELETE a held sale directly', () => as('a', `delete from sales where id=$1`, [held]), '42501')
await as('repA1', `update sales set items=$2, total=750, subtotal=750, balance=750, notes='added Amoxil' where id=$1`, [held, enc([line(prodA, 'Paracetamol', 250, 2), line(prodB, 'Amoxil', 250, 1)])])
let h = await sale(held)
ok('a held sale\'s items and totals can be edited in place', h.is_on_hold === true && h.status === null && Number(h.total) === 750 && h.notes === 'added Amoxil')
ok('a held sale never reaches the ledger', (await sup('select count(*)::int c from sale_payments where sale_id=$1', [held])).rows[0].c === 0)

// completing the resumed hold
const done = await mk('repA1', { txn: 'S-1', total: 750, paid: 1000, resumedFrom: held, items: enc([line(prodA, 'Paracetamol', 250, 2), line(prodB, 'Amoxil', 250, 1)]) })
h = await sale(held)
ok('completing converts the held row atomically', h.status === 'converted' && h.is_on_hold === true)
ok('completion takes stock once', (await stock(prodA)) === baseA - 2 && (await stock(prodB)) === baseB - 1)
ok('completion records the money once', (await net(done)) === 750)
await expectError('the same held sale cannot be completed twice', () => mk('repA2', { txn: 'S-1b', total: 750, resumedFrom: held }), 'already completed')
const other = (await sup(`insert into businesses (name,email) values ('Other','o@z.test') returning id`)).rows[0].id
const heldOther = (await sup(`insert into sales (business_id,txn_no,is_on_hold,total) values ($1,'HLD-X',true,10) returning id`, [other])).rows[0].id
await expectError('a held sale of another business cannot be completed from here', () => mk('repA1', { txn: 'S-1c', total: 10, resumedFrom: heldOther }), 'already completed')

// ---- direct writes to completed sales ---------------------------------------------------------
await expectError('a cashier cannot PATCH a completed sale total', () => as('repA1', `update sales set total=1 where id=$1`, [done]), '42501')
await expectError('a cashier cannot mark a completed sale deleted', () => as('repA1', `update sales set status='deleted' where id=$1`, [done]), '42501')
await expectError('a cashier cannot rewrite refunded_amount', () => as('repA1', `update sales set refunded_amount=750 where id=$1`, [done]), '42501')
await expectError('even the Owner cannot DELETE a completed sale row directly', () => as('a', `delete from sales where id=$1`, [done]), '42501')

// ---- edit ------------------------------------------------------------------------------------------
await expectError('edit needs a reason', () => as('a', `select public.edit_sale($1,$2::jsonb,0,null,'Walk-in','')`, [done, JSON.stringify([line(prodA, 'Paracetamol', 250, 1)])]), 'needs a reason')
await expectError('edit rejects an empty cart', () => as('a', `select public.edit_sale($1,'[]'::jsonb,0,null,'Walk-in','empty')`, [done]), 'at least one product')
await expectError('edit rejects a fractional quantity', () => as('a', `select public.edit_sale($1,$2::jsonb,0,null,'Walk-in','bad qty')`, [done, JSON.stringify([line(prodA, 'Paracetamol', 250, 1.5)])]), 'whole-number')
await expectError('edit rejects a discount above the subtotal', () => as('a', `select public.edit_sale($1,$2::jsonb,9999,null,'Walk-in','bad disc')`, [done, JSON.stringify([line(prodA, 'Paracetamol', 250, 1)])]), 'Discount')
// 750 sale paid 1000 cash (250 change). Remove Amoxil and one paracetamol -> 250.
let r = (await as('a', `select public.edit_sale($1,$2::jsonb,0,null,'Ada Customer','customer asked to drop items') r`, [done, JSON.stringify([line(prodA, 'Paracetamol', 250, 1)])])).rows[0].r
let e = await sale(done)
ok('edit: totals are recomputed on the server', Number(e.subtotal) === 250 && Number(e.total) === 250 && Number(e.balance) === 0 && e.edited_at !== null, JSON.stringify(e))
ok('edit: items keep the app\'s encoded shape (a JSON string)', typeof e.items === 'string' && JSON.parse(e.items).length === 1)
ok('edit: customer name updated', e.client_name === 'Ada Customer')
ok('edit: stock returns for removed units', (await stock(prodA)) === baseA - 1 && (await stock(prodB)) === baseB)
ok('edit: overpayment is reported, money on the ledger is untouched', Number(r.overpaid) === 500 && (await net(done)) === 750, JSON.stringify(r))
let a = await audits(done)
ok('edit: audit row with before/after and reason', a.length === 1 && a[0].action === 'sale.edited' && a[0].actor_type === 'owner' && a[0].metadata.reason.includes('drop items')
  && a[0].metadata.before.total === 750 && a[0].metadata.after.total === 250, JSON.stringify(a))
// raise a paid sale -> becomes a credit sale with a debt
const credit = await mk('repA1', { txn: 'S-2', total: 1000, paid: 1000, items: enc([line(prodA, 'Paracetamol', 500, 2)]) })
r = (await as('a', `select public.edit_sale($1,$2::jsonb,0,null,'Walk-in','price correction') r`, [credit, JSON.stringify([line(prodA, 'Paracetamol', 500, 3)])])).rows[0].r
e = await sale(credit)
ok('edit: raising the total leaves a balance and flags credit', Number(e.total) === 1500 && Number(e.balance) === 500 && e.is_credit === true && Number(e.amount_paid) === 1000)
let d = (await sup(`select * from debts where source_ref='S-2'`)).rows
ok('edit: a debt is raised for the new balance', d.length === 1 && Number(d[0].balance) === 500 && d[0].status === 'pending' && d[0].direction === 'owes_us', JSON.stringify(d))
await as('a', `select public.edit_sale($1,$2::jsonb,0,null,'Walk-in','price corrected back') r`, [credit, JSON.stringify([line(prodA, 'Paracetamol', 500, 2)])])
d = (await sup(`select * from debts where source_ref='S-2'`)).rows
ok('edit: lowering it back settles the debt', d.length === 1 && Number(d[0].balance) === 0 && d[0].status === 'paid', JSON.stringify(d))
// edit down below what was paid -> refund still possible (ledger-based cap)
await as('a', `select public.edit_sale($1,$2::jsonb,0,null,'Walk-in','sold fewer') r`, [credit, JSON.stringify([line(prodA, 'Paracetamol', 500, 1)])])
e = await sale(credit)
ok('edit down: the sale is fully paid; ledger still holds the 1000 received', Number(e.total) === 500 && Number(e.balance) === 0 && (await net(credit)) === 1000)
await as('a', `select public.refund_sale($1,500,'Cash','refund the overpayment')`, [credit])
ok('refund of the overpayment is allowed after an edit down', (await net(credit)) === 500)
await expectError('refund cannot exceed what the ledger holds', () => as('a', `select public.refund_sale($1,600,'Cash','too much')`, [credit]), 'exceeds')

// ---- batches -----------------------------------------------------------------------------------------
const bsale = await mk('repA1', { txn: 'S-3', total: 300, items: enc([line(prodB, 'Amoxil', 100, 3, { batch_id: batch })]) })
ok('sale: the batch named on the line gives the units, in one ledger row with the product', (await batchQty()) === 37
  && (await sup(`select count(*)::int n from stock_movements where batch_id=$1 and product_id=$2 and movement_type='sale' and quantity=-3`, [batch, prodB])).rows[0].n === 1)
await as('a', `select public.edit_sale($1,$2::jsonb,0,null,'Walk-in','one returned') r`, [bsale, JSON.stringify([line(prodB, 'Amoxil', 100, 2, { batch_id: batch })])])
ok('edit: batch quantity is restored by the difference and journaled as a sale reversal', (await batchQty()) === 38
  && (await sup(`select quantity from stock_movements where batch_id=$1 and movement_type='sale_reversal'`, [batch])).rows[0].quantity === 1)

// ---- refund -------------------------------------------------------------------------------------------
const rf = await mk('repA1', { txn: 'S-4', total: 400, items: enc([line(prodA, 'Paracetamol', 400, 1)]) })
await expectError('a Manager can no longer refund', () => as('mgrA', `select public.refund_sale($1,100,'Cash','customer unhappy')`, [rf]), 'Only the Owner')
await expectError('a cashier cannot refund', () => as('repA1', `select public.refund_sale($1,100,'Cash','customer unhappy')`, [rf]), 'Only the Owner')
await as('a', `select public.refund_sale($1,150,'Transfer','customer unhappy')`, [rf])
ok('refund: ledger, sale and audit agree', (await net(rf)) === 250 && Number((await sale(rf)).refunded_amount) === 150
  && (await audits(rf)).some((x) => x.action === 'sale.refunded' && x.metadata.amount === 150))

// ---- delete -------------------------------------------------------------------------------------------
const sp = await mk('repA1', { txn: 'S-5', total: 1000, paid: 700, balance: 300, credit: true, method: 'Split', split: JSON.stringify(JSON.stringify({ Cash: '200', Transfer: '500' })),
  items: enc([line(prodA, 'Paracetamol', 500, 2), line(prodSvc, 'Consult', 0, 1)]) })
await sup(`insert into debts (business_id,direction,party_name,amount,amount_paid,balance,status,source,source_ref) values ($1,'owes_us','Bola',1000,700,300,'pending','credit_sale','S-5')`, [S.A])
const before = await stock(prodA)
const svcBefore = await stock(prodSvc)
const ledgerBefore = await net(sp)
await expectError('a cashier cannot delete a sale', () => as('repA1', `select public.delete_sale($1,'mistake')`, [sp]), 'Only the Owner')
await expectError('delete needs a reason', () => as('a', `select public.delete_sale($1,'')`, [sp]), 'needs a reason')
const del = (await as('a', `select public.delete_sale($1,'entered by mistake') r`, [sp])).rows[0].r
const ds = await sale(sp)
ok('delete: the sale is no longer a sale and carries no debt', ds.status === 'deleted' && Number(ds.balance) === 0 && ds.is_credit === false && ds.deleted_at !== null)
ok('delete: money received is reversed on the ledger (append-only)', (await net(sp)) === 0 && Number(del.reversed) === ledgerBefore, JSON.stringify([del, ledgerBefore]))
ok('delete: stock returns, services untouched', (await stock(prodA)) === before + 2 && (await stock(prodSvc)) === svcBefore)
ok('delete: the customer debt is removed', (await sup(`select count(*)::int c from debts where source_ref='S-5'`)).rows[0].c === 0)
a = await audits(sp)
ok('delete: audit keeps the full before-snapshot and the removed debt', a.length === 1 && a[0].action === 'sale.deleted' && a[0].metadata.before.total === 1000 && a[0].metadata.debt_removed !== null, JSON.stringify(a))
await expectError('a deleted sale cannot be refunded', () => as('a', `select public.refund_sale($1,10,'Cash','nope')`, [sp]), 'completed sale')
await expectError('a deleted sale cannot be edited', () => as('a', `select public.edit_sale($1,$2::jsonb,0,null,'x','nope')`, [sp, JSON.stringify([line(prodA, 'P', 1, 1)])]), 'completed sale')
await expectError('a deleted sale cannot be deleted twice', () => as('a', `select public.delete_sale($1,'again')`, [sp]), 'completed sale')
ok('payments ledger rows are still append-only', await sup(`update sale_payments set amount=1 where sale_id=$1`, [sp]).then(() => false).catch(() => true))

// ---- grants ---------------------------------------------------------------------------------------------
await expectError('anon cannot call edit_sale', () => as('anon', `select public.edit_sale($1,'[]'::jsonb,0,null,'x','nope')`, [done]))
ok('anon has no execute on delete_sale', (await sup(`select has_function_privilege('anon','public.delete_sale(uuid,text)','execute') p`)).rows[0].p === false)
ok('authenticated may execute refund_sale', (await sup(`select has_function_privilege('authenticated','public.refund_sale(uuid,numeric,text,text)','execute') p`)).rows[0].p === true)

finish()
