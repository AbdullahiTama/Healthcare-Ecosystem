// POS accounting database tests: cashier stamping, shifts, payments ledger,
// collections, refunds, backfill, export types, and the sales write hardening.
// See _harness.mjs for scope and limits.
//   node scripts/db-tests/posAccounting.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, USERS } from './_harness.mjs'

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

const S = await seedStaff() // { A, B, repA1, repA2, mgrA, repB1 }
await sup(`update businesses set owner_name = 'Ada Owner' where id = $1`, [S.A])
await sup(`update staff set auth_user_id = $1 where id = $2`, [USERS.repA1.sub, S.repA1])

// ---- history that exists before the migration (backfill input) ---------------------------------
const pre = (txn, cols) => sup(
  `insert into sales (business_id, txn_no, total, amount_paid, balance, payment_method, payment_split, is_on_hold, status, is_credit, staff_name, created_at)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() - interval '3 days') returning id`,
  [S.A, txn, cols.total, cols.paid, cols.balance ?? 0, cols.method ?? 'Cash', cols.split ?? null, cols.hold ?? false, cols.status ?? null, cols.credit ?? false, cols.staff ?? null]
).then((r) => r.rows[0].id)
const oldCashChange = await pre('OLD-1', { total: 3000, paid: 5000 })
const oldCredit = await pre('OLD-2', { total: 100000, paid: 70000, balance: 30000, method: 'Credit', credit: true, status: 'completed' })
const oldSplit = await pre('OLD-3', { total: 2000, paid: 2000, method: 'Split', split: JSON.stringify(JSON.stringify({ Cash: '500', Transfer: '1500', POS: '' })) })
const oldHeld = await pre('OLD-4', { total: 900, paid: 0, method: 'On Hold', hold: true })
const oldDeleted = await pre('OLD-5', { total: 800, paid: 800, status: 'deleted' })
const oldResumed = await pre('OLD-6', { total: 700, paid: 0, status: 'resumed' })
const oldUnpaid = await pre('OLD-7', { total: 400, paid: 0, balance: 400, method: 'Credit', credit: true, staff: 'Old Name' })

await applyMigrations(['carehub_20261210_pos_accounting.sql'])

const pays = (saleId) => sup('select kind, method, amount::float8 amount, staff_name, shift_id, backfilled, received_by from sale_payments where sale_id=$1 order by method', [saleId]).then((r) => r.rows)
const sale = (id) => sup('select * from sales where id=$1', [id]).then((r) => r.rows[0])

// ---- backfill ------------------------------------------------------------------------------------
let p = await pays(oldCashChange)
ok('backfill: cash sale counts the total, not the cash tendered (change excluded)', p.length === 1 && p[0].method === 'Cash' && p[0].amount === 3000 && p[0].backfilled, JSON.stringify(p))
p = await pays(oldCredit)
ok('backfill: old credit deposit has no recorded method, so it is Unspecified', p.length === 1 && p[0].method === 'Unspecified' && p[0].amount === 70000, JSON.stringify(p))
p = await pays(oldSplit)
ok('backfill: split stored as a JSON string is read per method', p.length === 2 && p.find((x) => x.method === 'Transfer').amount === 1500 && p.find((x) => x.method === 'Cash').amount === 500, JSON.stringify(p))
ok('backfill: held, deleted and resumed rows are not sales', (await pays(oldHeld)).length === 0 && (await pays(oldDeleted)).length === 0 && (await pays(oldResumed)).length === 0)
ok('backfill: an unpaid credit sale has no payment row', (await pays(oldUnpaid)).length === 0)
ok('backfill: received_at is the sale date', (await sup(`select bool_and(received_at < now() - interval '2 days') x from sale_payments where backfilled`)).rows[0].x === true)
ok('backfill is idempotent across the re-run', (await sup('select count(*)::int c from sale_payments')).rows[0].c === 4)

// ---- cashier stamping ----------------------------------------------------------------------------
const insertSale = (who, biz, cols) => as(who,
  `insert into sales (business_id, txn_no, total, amount_paid, balance, payment_method, payment_split, is_on_hold, is_credit, staff_name, cashier_user_id, cashier_staff_id, refunded_amount)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
  [biz, cols.txn, cols.total, cols.paid, cols.balance ?? 0, cols.method ?? 'Cash', cols.split ?? null, cols.hold ?? false, cols.credit ?? false,
    cols.forgeName ?? null, cols.forgeUser ?? null, cols.forgeStaff ?? null, cols.forgeRefund ?? 0]).then((r) => r.rows[0].id)

const s1 = await insertSale('repA1', S.A, { txn: 'T1', total: 3000, paid: 5000, forgeName: 'Ada Owner', forgeUser: USERS.a.sub, forgeStaff: S.mgrA, forgeRefund: 500 })
let row = await sale(s1)
ok('stamp: forged cashier fields are replaced by the caller (staff by auth_user_id)',
  row.cashier_user_id === USERS.repA1.sub && row.cashier_staff_id === S.repA1 && row.staff_name === 'Rep One', JSON.stringify(row))
ok('stamp: a client cannot pre-set refunded_amount', Number(row.refunded_amount) === 0)
p = await pays(s1)
ok('ledger: a new cash sale records the total received, not the cash tendered', p.length === 1 && p[0].amount === 3000 && p[0].kind === 'sale' && p[0].staff_name === 'Rep One' && !p[0].backfilled, JSON.stringify(p))

const s2 = await insertSale('repA2', S.A, { txn: 'T2', total: 1000, paid: 1000 })
ok('stamp: staff found by email when auth_user_id is not linked', (await sale(s2)).staff_name === 'Rep Two')
const sOwner = await insertSale('a', S.A, { txn: 'T3', total: 500, paid: 500, method: 'Transfer' })
row = await sale(sOwner)
ok('stamp: the owner is named from owner_name, with no staff id', row.staff_name === 'Ada Owner' && row.cashier_staff_id === null && row.cashier_user_id === USERS.a.sub, JSON.stringify(row))
ok('ledger: transfer sale is a Transfer row', (await pays(sOwner))[0].method === 'Transfer')

const branch = (await sup(`insert into businesses (name,email,parent_business_id) values ('A Branch','branch@a.test',$1) returning id`, [S.A])).rows[0].id
const sBranch = await insertSale('repA2', branch, { txn: 'T4', total: 200, paid: 200 })
ok('stamp: a parent-business staff member selling in a branch is still named', (await sale(sBranch)).staff_name === 'Rep Two')

await sup(`select set_config('request.jwt.claims', '', false)`)
const sService = (await sup(`insert into sales (business_id, txn_no, total, amount_paid, staff_name) values ($1,'SVC',100,100,'Backend Job') returning id`, [S.A])).rows[0].id
ok('stamp: a service-role insert (no signed-in user) keeps what it sent', (await sale(sService)).staff_name === 'Backend Job')

// ---- split, credit, held -------------------------------------------------------------------------
const sSplit = await insertSale('repA1', S.A, { txn: 'T5', total: 2000, paid: 2500, method: 'Split', split: JSON.stringify(JSON.stringify({ Cash: '1000', Transfer: '1500', POS: '' })) })
p = await pays(sSplit)
ok('ledger: overpaid split takes non-cash first and Cash absorbs the change',
  p.length === 2 && p.find((x) => x.method === 'Transfer').amount === 1500 && p.find((x) => x.method === 'Cash').amount === 500, JSON.stringify(p))
const sCredit = await insertSale('repA1', S.A, { txn: 'T6', total: 100000, paid: 70000, balance: 30000, method: 'Credit', credit: true, split: JSON.stringify(JSON.stringify({ Transfer: 70000 })) })
p = await pays(sCredit)
ok('ledger: the request example: 100,000 sale, 70,000 deposit by transfer', p.length === 1 && p[0].method === 'Transfer' && p[0].amount === 70000, JSON.stringify(p))
const sHeld = await insertSale('repA1', S.A, { txn: 'H1', total: 900, paid: 0, method: 'On Hold', hold: true })
ok('ledger: a held sale records no payment', (await pays(sHeld)).length === 0)
const sCreditNone = await insertSale('repA1', S.A, { txn: 'T7', total: 400, paid: 0, balance: 400, method: 'Credit', credit: true })
ok('ledger: a credit sale with nothing paid records no payment', (await pays(sCreditNone)).length === 0)

await expectError('stamp: company B cannot insert a sale into company A (policy unchanged)', () => insertSale('repB1', S.A, { txn: 'X', total: 1, paid: 1 }))

// ---- shifts --------------------------------------------------------------------------------------
const shift1 = (await as('repA1', 'select open_pos_shift($1, $2) id', [S.A, 5000])).rows[0].id
ok('shift: a staff member can open a shift', !!shift1)
await expectError('shift: a second open shift for the same person is refused', () => as('repA1', 'select open_pos_shift($1, 0)', [S.A]), '23505')
await expectError('shift: negative float refused', () => as('repA2', 'select open_pos_shift($1, -1)', [S.A]), '22023')
await expectError('shift: an outsider cannot open a shift', () => as('outsider', 'select open_pos_shift($1, 0)', [S.A]), '42501')
await expectError('shift: company B cannot open a shift in company A', () => as('repB1', 'select open_pos_shift($1, 0)', [S.A]), '42501')
await expectError('shift: no direct INSERT into pos_shifts', () => as('repA1', `insert into pos_shifts (business_id, opened_by, staff_name) values ($1,$2,'x')`, [S.A, USERS.repA1.sub]), '42501')

const sInShift = await insertSale('repA1', S.A, { txn: 'T8', total: 4000, paid: 4000 })
ok('shift: a sale made during the shift carries it', (await sale(sInShift)).shift_id === shift1)
ok('shift: and so does its payment row', (await pays(sInShift))[0].shift_id === shift1)
const sOtherShift = await insertSale('repA2', S.A, { txn: 'T9', total: 100, paid: 100 })
ok('shift: another cashier with no open shift is not put in it', (await sale(sOtherShift)).shift_id === null)

// ---- collections ---------------------------------------------------------------------------------
await sup(`insert into debts (business_id, direction, party_name, amount, amount_paid, balance, status, source, source_ref) values ($1,'owes_us','Bola',100000,70000,30000,'pending','credit_sale','T6')`, [S.A])
const collect = (who, id, amt, method = 'Cash') => as(who, 'select record_sale_payment($1,$2,$3) r', [id, amt, method]).then((r) => r.rows[0].r)
let r = await collect('repA1', sCredit, 20000)
row = await sale(sCredit)
ok('collect: applies the amount and updates the sale', r.applied === 20000 && Number(row.amount_paid) === 90000 && Number(row.balance) === 10000 && row.is_credit === true, JSON.stringify(row))
let debt = (await sup(`select * from debts where source_ref='T6'`)).rows[0]
ok('collect: the matching debt moves with the sale', Number(debt.amount_paid) === 90000 && Number(debt.balance) === 10000 && debt.status === 'pending', JSON.stringify(debt))
p = (await pays(sCredit)).filter((x) => x.kind === 'collection')
ok('collect: a collection row names who took the money and their shift', p.length === 1 && p[0].staff_name === 'Rep One' && p[0].shift_id === shift1 && p[0].received_by === USERS.repA1.sub, JSON.stringify(p))
r = await collect('repA2', sCredit, 50000, 'POS')
row = await sale(sCredit)
debt = (await sup(`select * from debts where source_ref='T6'`)).rows[0]
ok('collect: an overpayment is clamped to what is outstanding', r.applied === 10000 && Number(row.balance) === 0 && row.is_credit === false, JSON.stringify(r))
ok('collect: settling the sale marks its debt paid', debt.status === 'paid' && Number(debt.balance) === 0)
await expectError('collect: nothing outstanding is refused', () => collect('repA1', sCredit, 1), '22023')
await expectError('collect: company B cannot collect on company A sale', () => collect('repB1', sCreditNone, 100), '42501')
await expectError('collect: anonymous refused', () => collect('anon', sCreditNone, 100), '42501')
await expectError('collect: method must be real', () => collect('repA1', sCreditNone, 100, 'Credit'), '22023')
await expectError('collect: zero refused', () => collect('repA1', sCreditNone, 0), '22023')
await expectError('collect: a held sale cannot take payments', () => collect('repA1', sHeld, 100), '22023')
await sup(`insert into debts (business_id, direction, party_name, amount, amount_paid, balance, status, source, source_ref) values ($1,'owes_us','Walk-in · OLD-7',400,0,400,NULL,'credit_sale','OLD-7')`, [S.A])
await collect('repA1', oldUnpaid, 400)
ok('collect: a NULL-status debt is still settled (IS DISTINCT FROM, not <>)', (await sup(`select status from debts where source_ref='OLD-7'`)).rows[0].status === 'paid')

// ---- refunds -------------------------------------------------------------------------------------
const refund = (who, id, amt, method = 'Cash', reason = 'Damaged pack returned') => as(who, 'select refund_sale($1,$2,$3,$4) r', [id, amt, method, reason]).then((r) => r.rows[0].r)
await expectError('refund: a cashier cannot refund', () => refund('repA1', sInShift, 100), '42501')
const shiftM = (await as('mgrA', 'select open_pos_shift($1, 1000) id', [S.A])).rows[0].id
const sMgr = await insertSale('mgrA', S.A, { txn: 'T10', total: 2500, paid: 2500 })
r = await refund('mgrA', sMgr, 700)
ok('refund: a manager role can refund', r.refunded === 700 && Number((await sale(sMgr)).refunded_amount) === 700, JSON.stringify(r))
p = (await pays(sMgr)).filter((x) => x.kind === 'refund')
ok('refund: recorded on the ledger with the reason, actor and shift', p.length === 1 && p[0].amount === 700 && p[0].staff_name === 'Manager A' && p[0].shift_id === shiftM, JSON.stringify(p))
ok('refund: the owner can refund too', (await refund('a', sOwner, 100, 'Transfer')).refunded === 100)
await expectError('refund: cannot exceed what was paid net of earlier refunds', () => refund('mgrA', sMgr, 1801), '22023')
ok('refund: up to the remaining amount is accepted', (await refund('mgrA', sMgr, 1800)).refunded_total === 2500)
await expectError('refund: a reason is required', () => refund('a', s1, 10, 'Cash', '  '), '22023')
await expectError('refund: an unpaid credit sale has nothing to refund', () => refund('a', sCreditNone, 1), '22023')
await expectError('refund: company B owner cannot refund company A sale', () => refund('b', s1, 10), '42501')
ok('refund: outstanding balance is not touched by a refund', Number((await sale(sMgr)).balance) === 0)

// ---- closing shifts ------------------------------------------------------------------------------
await expectError('close: another cashier cannot close my shift', () => as('repA2', 'select close_pos_shift($1, 0)', [shift1]), '42501')
r = (await as('repA1', 'select close_pos_shift($1, $2, $3) r', [shift1, 29400, 'counted twice'])).rows[0].r
// float 5000 + cash in shift: T8 4000 + collections 20000 and 400 (cash) = 29400
ok('close: expected cash = float + cash received in the shift', Number(r.expected_cash) === 29400 && Number(r.difference) === 0, JSON.stringify(r))
const closed = (await sup('select * from pos_shifts where id=$1', [shift1])).rows[0]
ok('close: closed_at, counted, expected and closer are stored', !!closed.closed_at && Number(closed.counted_cash) === 29400 && closed.closed_by === USERS.repA1.sub && closed.close_note === 'counted twice')
await expectError('close: a closed shift cannot be closed again', () => as('repA1', 'select close_pos_shift($1, 0)', [shift1]), '22023')
r = (await as('mgrA', 'select close_pos_shift($1, $2) r', [shiftM, 1500])).rows[0].r
// float 1000 + cash sale 2500 - cash refunds 700 + 1800 = 1000
ok('close: cash refunds in the shift reduce expected cash', Number(r.expected_cash) === 1000 && Number(r.difference) === 500, JSON.stringify(r))
const forgotten = (await as('repA2', 'select open_pos_shift($1, 0) id', [S.A])).rows[0].id
ok('close: a manager can close a shift someone forgot', !!(await as('mgrA', 'select close_pos_shift($1, 0) r', [forgotten])).rows[0].r)
ok('shift: after closing, the same person can open a new one', !!(await as('repA1', 'select open_pos_shift($1, 0) id', [S.A])).rows[0].id)

// ---- the ledger and shifts are read-only to clients ---------------------------------------------
await expectError('ledger: no client INSERT', () => as('a', `insert into sale_payments (business_id, sale_id, kind, method, amount) values ($1,$2,'sale','Cash',1)`, [S.A, s1]), '42501')
await expectError('ledger: no client UPDATE', () => as('a', `update sale_payments set amount = 1`), '42501')
await expectError('ledger: no client DELETE', () => as('a', `delete from sale_payments`), '42501')
await expectError('ledger: even the table owner cannot UPDATE (append-only)', () => sup(`update sale_payments set amount = 1`), 'append-only')
await expectError('shifts: no client UPDATE', () => as('repA1', `update pos_shifts set counted_cash = 0`), '42501')
ok('ledger: company A members read their rows', (await as('repA2', 'select id from sale_payments')).rows.length > 5)
ok('ledger: company B sees none of company A rows', (await as('repB1', 'select id from sale_payments')).rows.length === 0)
ok('shifts: company B sees none of company A shifts', (await as('b', 'select id from pos_shifts')).rows.length === 0)
await expectError('ledger: anonymous cannot read', () => as('anon', 'select id from sale_payments'), '42501')

// ---- function ACLs -------------------------------------------------------------------------------
const canExec = async (role, sig) => (await sup(`select has_function_privilege($1, $2, 'execute') x`, [role, sig])).rows[0].x
for (const sig of ['open_pos_shift(uuid,numeric)', 'close_pos_shift(uuid,numeric,text)', 'record_sale_payment(uuid,numeric,text)', 'refund_sale(uuid,numeric,text,text)']) {
  ok(`acl: anon cannot execute ${sig}`, (await canExec('anon', sig)) === false)
  ok(`acl: authenticated can execute ${sig}`, (await canExec('authenticated', sig)) === true)
}
for (const sig of ['pos_actor(uuid)', 'pos_split_payments(jsonb,text,numeric)']) {
  ok(`acl: authenticated cannot call internal ${sig}`, (await canExec('authenticated', sig)) === false)
}

// ---- export audit types --------------------------------------------------------------------------
const exp = (who, type) => as(who, `select record_export_audit($1,$2,3,'{}'::jsonb) id`, [S.A, type]).then((r) => r.rows[0].id)
const idSales = await exp('a', 'sales_report.xlsx')
let meta = (await sup('select target_type, metadata from audit_log where id=$1', [idSales])).rows[0]
ok('export: sales_report.xlsx is accepted and carries no cost data', meta.target_type === 'sales_report' && meta.metadata.includes_cost_data === false, JSON.stringify(meta))
await expectError('export: there is no PDF export type (print is not an export)', () => exp('a', 'sales_report.pdf'), '22023')
meta = (await sup('select metadata from audit_log where id=$1', [await exp('a', 'inventory.xlsx')])).rows[0]
ok('export: inventory still flags cost data', meta.metadata.includes_cost_data === true)
await expectError('export: a cashier without canExportReports is still refused', () => exp('repA1', 'sales_report.xlsx'), '42501')
ok('export: only one record_export_audit exists (no sibling overload)', (await sup(`select count(*)::int c from pg_proc where proname='record_export_audit'`)).rows[0].c === 1)

// ---- hardening -----------------------------------------------------------------------------------
await applyMigrations(['carehub_20261211_sales_write_hardening.sql'])
await as('repA1', `update sales set status = 'resumed', is_on_hold = false where id = $1`, [sHeld])
ok('harden: hold/resume/delete status updates still work', (await sale(sHeld)).status === 'resumed')
await as('repA1', `update sales set notes = 'n' where id = $1`, [sHeld])
await expectError('harden: a cashier cannot rewrite amount_paid', () => as('repA1', `update sales set amount_paid = 0 where id = $1`, [s1]), '42501')
await expectError('harden: nor the total', () => as('a', `update sales set total = 1 where id = $1`, [s1]), '42501')
await expectError('harden: nor the cashier', () => as('repA1', `update sales set staff_name = 'x' where id = $1`, [s1]), '42501')
await expectError('harden: nor refunded_amount', () => as('a', `update sales set refunded_amount = 0 where id = $1`, [sMgr]), '42501')
await expectError('harden: no DELETE', () => as('a', `delete from sales where id = $1`, [s1]), '42501')
await expectError('harden: anonymous has no access', () => as('anon', 'select id from sales'), '42501')
ok('harden: inserting a sale still works', !!(await insertSale('repA2', S.A, { txn: 'T11', total: 50, paid: 50 })))
ok('harden: reading sales still works', (await as('repA2', 'select id from sales')).rows.length > 5)
const sAfter = await insertSale('repA1', S.A, { txn: 'T12', total: 300, paid: 100, balance: 200, method: 'Credit', credit: true, split: JSON.stringify(JSON.stringify({ Cash: 100 })) })
ok('harden: collections still work through the function', (await collect('repA1', sAfter, 200)).balance === 0)
ok('harden: refunds still work through the function', (await refund('a', sAfter, 50)).refunded === 50)

finish()
