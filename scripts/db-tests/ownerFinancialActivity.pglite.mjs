// Owner financial activity database tests: who recorded purchases, expenses and
// debts is stamped by the database, and those records reach the Owner's feed.
//   node scripts/db-tests/ownerFinancialActivity.pglite.mjs
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



await db.exec(`
  CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, stock integer, category text);
  CREATE TABLE public.stock_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, quantity integer);
  -- live shape: moved_by is TEXT, actor_id is uuid
  CREATE TABLE public.stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid,
    to_location_id uuid, movement_type text, quantity integer, reason text, moved_by text, actor_id uuid, product_id uuid, created_at timestamptz DEFAULT now());
  CREATE TABLE public.expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, category text, description text, amount numeric, date text, staff_name text, created_at timestamp DEFAULT now());
  CREATE TABLE public.staff_checkins (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, staff_id uuid, user_id uuid, event_type text, status text, location_label text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.field_activities2 (x int);
  ALTER TABLE public.field_activities ADD COLUMN IF NOT EXISTS place_of_visit text, ADD COLUMN IF NOT EXISTS facility_name text, ADD COLUMN IF NOT EXISTS location_label text;
  GRANT ALL ON public.products, public.stock_batches, public.stock_movements, public.expenses, public.staff_checkins, public.field_activities TO authenticated;
`)
await applyMigrations(['carehub_20261210_pos_accounting.sql'], { rerun: false })
await applyMigrations(['carehub_20261216_sales_owner_corrections.sql'], { rerun: false })
await db.exec(`
  -- live shapes (read 2026-10-31); the live staff_activity (carehub_20261219) reads staff_checkins.staff_name
  ALTER TABLE public.staff_checkins ADD COLUMN IF NOT EXISTS staff_name text;
  CREATE TABLE public.purchases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, supplier_name text, product_name text,
    quantity integer, cost_price numeric, total_cost numeric, amount_paid numeric, balance numeric, supply_date text, due_date text,
    status text, notes text, created_at timestamp DEFAULT now(), selling_price numeric, expiry date, batch text, items jsonb);
  ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "purchases of own business" ON public.purchases FOR ALL
    USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  CREATE TABLE public.purchase_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, purchase_id uuid, supplier_name text,
    supplier_key text, amount numeric, method text, kind text, paid_on date, note text, balance_after numeric, recorded_by uuid,
    staff_name text, created_at timestamptz DEFAULT now());
  ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "expenses of own business" ON public.expenses FOR ALL
    USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  GRANT ALL ON public.purchases, public.purchase_payments TO authenticated;
`)
await applyMigrations(['carehub_20261217_staff_activity.sql'], { rerun: false })
await applyMigrations(['carehub_20261229_owner_financial_activity.sql'])

const S = await seedStaff() // repA1 Rep One, repA2 Rep Two, mgrA Manager A (business A); repB1 (business B)
await sup(`update staff set role = 'Cashier', auth_user_id = $2 where id = $1`, [S.repA1, USERS.repA1.sub])
await sup(`update businesses set owner_name = 'Ada Owner' where id = $1`, [S.A])

const day = (d) => new Date(Date.now() + d * 864e5).toISOString()
const feed = (who, biz = S.A) => as(who, 'select * from staff_activity($1,$2,$3,null)', [biz, day(-1), day(1)]).then((r) => r.rows)
const one = (sql, params) => sup(sql, params).then((r) => r.rows[0])

// ---- who recorded it is stamped by the database ---------------------------------------------------
const forged = '00000000-0000-0000-0000-0000000000ff'
const p1 = (await as('repA1', `insert into purchases (business_id,supplier_name,product_name,total_cost,amount_paid,balance,due_date,status,recorded_by,recorded_by_name)
  values ($1,'Emzor','Paracetamol',50000,20000,30000,'2026-11-15','partial',$2,'Somebody Else') returning id`, [S.A, forged])).rows[0].id
let row = await one('select * from purchases where id = $1', [p1])
ok('a purchase is stamped with the cashier who entered it', row.recorded_by === USERS.repA1.sub && row.recorded_by_staff_id === S.repA1 && row.recorded_by_name === 'Rep One', JSON.stringify(row))
ok('a recorded_by the screen sends is ignored', row.recorded_by !== forged && row.recorded_by_name !== 'Somebody Else')

await as('repA2', `update purchases set recorded_by = $2, recorded_by_name = 'Rewritten', notes = 'checked' where id = $1`, [p1, forged])
row = await one('select * from purchases where id = $1', [p1])
ok('the stamp survives an update that tries to change it (and the update still applies)', row.recorded_by === USERS.repA1.sub && row.recorded_by_name === 'Rep One' && row.notes === 'checked')

const e1 = (await as('repA2', `insert into expenses (business_id,category,description,amount,staff_name) values ($1,'Transport','Fuel',2500,'Typed On Form') returning *`, [S.A])).rows[0]
ok('an expense is stamped by email when the staff row has no auth link, and its typed name is kept', e1.recorded_by === USERS.repA2.sub && e1.recorded_by_staff_id === S.repA2 && e1.recorded_by_name === 'Rep Two' && e1.staff_name === 'Typed On Form', JSON.stringify(e1))

const d1 = (await as('a', `insert into debts (business_id,direction,party_name,amount,amount_paid,balance,due_date,status,description,source)
  values ($1,'we_owe','Landlord',120000,0,120000,'2026-11-01','pending','Rent','manual') returning *`, [S.A])).rows[0]
ok('the Owner (no staff row) is stamped by name', d1.recorded_by === USERS.a.sub && d1.recorded_by_staff_id === null && d1.recorded_by_name === 'Ada Owner', JSON.stringify(d1))

// The service role carries no user (claims cleared, as PostgREST does for it).
await sup(`select set_config('request.jwt.claims', '', false)`)
await sup(`insert into expenses (business_id,category,description,amount,staff_name,recorded_by_name) values ($1,'Import','Old row',10,'Backfill','kept')`, [S.A])
ok('with no signed-in user (service role) the row is left as sent', (await one(`select recorded_by_name from expenses where description = 'Old row'`)).recorded_by_name === 'kept')

await expectError('another business cannot record into this one', () => as('repB1', `insert into purchases (business_id,supplier_name,total_cost) values ($1,'X',1)`, [S.A]))

// ---- the Owner's feed -----------------------------------------------------------------------------
await sup(`insert into purchase_payments (business_id,purchase_id,supplier_name,amount,method,kind,balance_after,recorded_by,staff_name)
  values ($1,$2,'Emzor',10000,'Transfer','payment',20000,$3,'Rep One'), ($1,$2,'Emzor',20000,'Cash','at_purchase',30000,$3,'Rep One')`, [S.A, p1, USERS.repA1.sub])
await sup(`insert into debts (business_id,direction,party_name,amount,balance,status,source,source_ref) values ($1,'owes_us','Walk-in · T9',500,500,'pending','credit_sale','T9')`, [S.A])
const credit = (await as('repA1', `insert into sales (business_id,txn_no,client_name,total,amount_paid,balance,payment_method,is_credit) values ($1,'T9','Bola',3000,1000,2000,'Credit',true) returning id`, [S.A])).rows[0].id
await as('repA1', `insert into sales (business_id,txn_no,total,amount_paid,balance,payment_method) values ($1,'T10',800,800,0,'Cash')`, [S.A])

const rows = await feed('a')
const by = (kind) => rows.filter((r) => r.kind === kind)
const pr = by('purchase')[0]
ok('a purchase is in the feed with who, how much and what is unpaid', pr && pr.actor_name === 'Rep One' && pr.actor_role === 'Cashier' && Number(pr.amount) === 50000 && pr.summary.includes('Emzor') && pr.summary.includes('₦30,000 unpaid') && pr.summary.includes('due 2026-11-15') && pr.ref === p1, JSON.stringify(pr))
ok('a supplier payment is in the feed, linked to its purchase; the at-purchase row is not a new event', by('supplier_payment').length === 1 && by('supplier_payment')[0].ref === p1 && Number(by('supplier_payment')[0].amount) === 10000 && by('supplier_payment')[0].summary.includes('₦20,000 still owed') && by('supplier_payment')[0].actor_name === 'Rep One', JSON.stringify(by('supplier_payment')))
ok('an expense carries its id and the stamped person', by('expense').some((r) => r.ref === e1.id && r.actor_name === 'Rep Two' && r.staff_id === S.repA2))
ok('a hand-entered debt is listed with its direction; a credit-sale debt is not listed twice', by('debt').length === 1 && by('debt')[0].ref === d1.id && by('debt')[0].summary.startsWith('We owe · Landlord') && by('debt')[0].actor_name === 'Ada Owner', JSON.stringify(by('debt')))
ok('a credit sale is its own kind with what is still owed; a cash sale stays a sale', by('credit_sale').length === 1 && by('credit_sale')[0].ref === 'T9' && by('credit_sale')[0].summary.includes('₦2,000 still owed') && by('sale').some((r) => r.ref === 'T10'), JSON.stringify(by('credit_sale')))
ok('amounts are written without a trailing point', !rows.some((r) => /\d\.\s|\d\.$/.test(r.summary || '')))
await expectError('still Owner only: a Manager cannot read it', () => feed('mgrA'), 'Only the Owner')
await expectError('still Owner only: a cashier cannot read it', () => feed('repA1'), 'Only the Owner')
ok('other businesses never appear', (await feed('b', S.B)).every((r) => r.ref !== p1))
ok('the trigger functions are not callable by clients', !(await sup(`select has_function_privilege('authenticated','public.stamp_recorded_by()','execute') as x`)).rows[0].x)
void credit

finish()
