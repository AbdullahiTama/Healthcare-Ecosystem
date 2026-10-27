// Staff activity feed database tests: Owner-only, attribution per source, bounds.
//   node scripts/db-tests/staffActivity.pglite.mjs
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
await applyMigrations(['carehub_20261217_staff_activity.sql'])

const S = await seedStaff() // repA1 'Sales Rep' Rep One, repA2 'Sales Rep' Rep Two, mgrA 'Regional Manager'
await sup(`update staff set role = 'Cashier', auth_user_id = $2 where id = $1`, [S.repA1, USERS.repA1.sub])
await sup(`update staff set role = 'Pharmacist' where id = $1`, [S.repA2])

const day = (d) => new Date(Date.now() + d * 864e5).toISOString()
const feed = (who, biz, from = day(-1), to = day(1), limit) => as(who, 'select * from staff_activity($1,$2,$3,$4)', [biz, from, to, limit ?? null]).then((r) => r.rows)

// ---- access -------------------------------------------------------------------------------------
await sup(`insert into sales (business_id,txn_no,total,amount_paid,payment_method,staff_name) values ($1,'SVC-1',100,100,'Cash','Backend')`, [S.A])
ok('the Owner can read the feed', Array.isArray(await feed('a', S.A)))
await expectError('a Manager cannot', () => feed('mgrA', S.A), 'Only the Owner')
await expectError('a cashier cannot', () => feed('repA1', S.A), 'Only the Owner')
await expectError('another business\'s Owner cannot', () => feed('b', S.A), 'Only the Owner')
await expectError('anon cannot', () => as('anon', 'select * from staff_activity($1,now()-interval \'1 day\',now(),10)', [S.A]))
await expectError('a period over 366 days is refused', () => feed('a', S.A, day(-400), day(1)), 'up to 366 days')
await expectError('an empty or reversed period is refused', () => feed('a', S.A, day(1), day(-1)), 'up to 366 days')

// ---- attribution --------------------------------------------------------------------------------
const insSale = (who, cols) => as(who, `insert into sales (business_id,txn_no,client_name,total,amount_paid,balance,payment_method,is_on_hold,is_credit) values ($1,$2,$3,$4,$5,$6,$7,$8,false) returning id`,
  [S.A, cols.txn, cols.client ?? 'Walk-in', cols.total, cols.paid ?? cols.total, 0, 'Cash', !!cols.hold]).then((r) => r.rows[0].id)
const s1 = await insSale('repA1', { txn: 'T1', total: 1500, client: 'Ada' })
const s2 = await insSale('repA2', { txn: 'T2', total: 400 })
const h1 = await insSale('repA1', { txn: 'H1', total: 900, hold: true })
await as('a', `select public.refund_sale($1,100,'Cash','customer unhappy')`, [s1])
await as('a', `select public.edit_sale($1,$2::jsonb,0,null,'Ada','typo')`, [s2, JSON.stringify([{ id: '00000000-0000-0000-0000-00000000f001', name: 'X', price: 300, qty: 1 }])])
await sup(`insert into expenses (business_id,category,description,amount,staff_name) values ($1,'Transport','Fuel',2500,'Rep Two')`, [S.A])
await sup(`insert into stock_movements (business_id,movement_type,quantity,reason,actor_id) values ($1,'adjustment',-3,'damaged',$2)`, [S.A, USERS.repA1.sub])
await sup(`insert into stock_movements (business_id,movement_type,quantity,reason,moved_by) values ($1,'transfer',5,'to shelf','Typed Name')`, [S.A])
await sup(`insert into stock_movements (business_id,movement_type,quantity,reason,actor_id) values ($1,'sale',-1,'auto',$2)`, [S.A, USERS.repA1.sub])
await sup(`insert into stock_movements (business_id,movement_type,quantity,reason) values ($1,'adjustment',9,'unknown actor')`, [S.A])
await sup(`insert into staff_checkins (business_id,staff_id,user_id,event_type,status,location_label) values ($1,$2,$3,'check_in','verified','Shop')`, [S.A, S.repA2, USERS.repA2.sub])
await sup(`insert into field_activities (business_id,staff_id,rep_name,facility_name) values ($1,$2,'Rep Two','City Pharmacy')`, [S.A, S.repA2])
await sup(`insert into pos_shifts (business_id,opened_by,staff_id,staff_name,opening_float) values ($1,$2,$3,'Rep One',5000)`, [S.A, USERS.repA1.sub, S.repA1])
// a sale the Owner then deletes must not remain a "sale"
const s3 = await insSale('repA1', { txn: 'T3', total: 50 })
await as('a', `select public.delete_sale($1,'mistake entered')`, [s3])

await sup(`insert into sales (business_id,txn_no,total,amount_paid,payment_method,staff_name) values ($1,'OTHER',9,9,'Cash','Elsewhere')`, [S.B])
const rows = await feed('a', S.A)
const by = (kind, pred = () => true) => rows.filter((r) => r.kind === kind && pred(r))
ok('sales are attributed to the cashier with their role', by('sale', (r) => r.ref === 'T1')[0]?.actor_name === 'Rep One' && by('sale', (r) => r.ref === 'T1')[0]?.actor_role === 'Cashier', JSON.stringify(by('sale')))
ok('a second cashier is told apart', by('sale', (r) => r.ref === 'T2')[0]?.actor_name === 'Rep Two' && by('sale', (r) => r.ref === 'T2')[0]?.actor_role === 'Pharmacist')
ok('held sales are their own kind', by('held').length === 1 && by('held')[0].ref === 'H1')
ok('a deleted sale is not listed as a sale (its deletion is)', by('sale', (r) => r.ref === 'T3').length === 0 && by('sale_deleted', (r) => r.ref === 'T3').length === 1)
ok('the refund shows who recorded it and how much', by('refund').length >= 1 && Number(by('refund').find((r) => r.ref === 'T1').amount) === 100)
ok('the Owner\'s edit is listed with the reason', by('sale_edited', (r) => r.ref === 'T2')[0]?.summary.includes('typo'))
ok('an Owner action with no staff row is "Owner or unlinked", not mis-attributed', by('sale_edited', (r) => r.ref === 'T2')[0]?.staff_id === null && /Owner/.test(by('sale_edited')[0].actor_name))
ok('expenses are matched to staff by recorded name', by('expense')[0]?.staff_id === S.repA2 && by('expense')[0]?.actor_role === 'Pharmacist' && Number(by('expense')[0].amount) === 2500)
ok('stock: an actor id is resolved to the staff member', by('stock', (r) => r.summary.includes('damaged'))[0]?.actor_name === 'Rep One')
ok('stock: a typed name in the text column is kept', by('stock', (r) => r.summary.includes('to shelf'))[0]?.actor_name === 'Typed Name')
ok('stock: automatic sale movements and anonymous ones are left out', by('stock').length === 2, String(by('stock').length))
ok('check-ins, field visits and shifts are attributed', by('checkin')[0]?.actor_name === 'Rep Two' && by('field_visit')[0]?.summary === 'City Pharmacy' && by('shift_open')[0]?.actor_name === 'Rep One')
ok('rows come back newest first', rows.every((r, i) => i === 0 || new Date(rows[i - 1].occurred_at) >= new Date(r.occurred_at)))
ok('the period bounds are honoured', (await feed('a', S.A, day(-10), day(-9))).length === 0)
ok('the row cap is honoured', (await feed('a', S.A, day(-1), day(1), 3)).length === 3)
ok('other businesses\' activity never appears', !rows.some((r) => r.ref === 'OTHER'))
ok('the feed changes nothing', (await sup('select count(*)::int c from audit_log')).rows[0].c === 3 /* edit, delete, refund */, 'audit rows')

finish()
