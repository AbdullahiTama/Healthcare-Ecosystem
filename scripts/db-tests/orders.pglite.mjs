// Orders: the link from an order to the field report it came from, and order authorisation (drafts of
// 2026-10-26, field team reorganisation). The "orders of own business" and "... via parent order" policies are
// copied from the live project (pg_policies, 2026-10-24). See _harness.mjs for scope and limits.
//   REPO_ROOT=<repo> node orders.pglite.mjs
import fs from 'node:fs'
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, makeLikeLive, addDirectoryManagerStub, migrationPath } from './_harness.mjs'

await db.exec(`
  CREATE TABLE public.facilities_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, source text);
  CREATE TABLE public.rep_added_facilities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, status text);
  ALTER TABLE public.field_activities ADD COLUMN territory_id uuid;
  CREATE TABLE public.activity_viewers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES public.field_activities(id), staff_id uuid, viewer_name text);
  CREATE TABLE public.activity_reactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES public.field_activities(id), staff_id uuid, actor_name text);
  CREATE TABLE public.activity_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES public.field_activities(id), staff_id uuid, actor_name text, body text);
  GRANT ALL ON public.field_activities, public.activity_viewers, public.activity_reactions, public.activity_comments TO authenticated;
`)
await applyMigrations(['carehub_20260823_facility_review_authorization.sql'], { rerun: false })
await makeLikeLive()
await addDirectoryManagerStub()
await db.exec(`
  ALTER TABLE field_activities ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "field_activities of own business" ON field_activities FOR ALL
    USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
    WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  ALTER TABLE activity_viewers ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "activity_viewers via parent field_activities" ON activity_viewers FOR ALL
    USING (is_platform_admin() OR activity_id IN (SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())))
    WITH CHECK (is_platform_admin() OR activity_id IN (SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())));
`)
await applyMigrations(['carehub_20261131_field_activity_access.sql'], { rerun: false })

// The live orders tables and their one permissive policy each.
await db.exec(`
  CREATE TABLE public.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, order_ref text, customer_name text NOT NULL,
    customer_contact text, customer_address text, territory_id uuid, location_id uuid, status text NOT NULL DEFAULT 'submitted',
    total_value numeric DEFAULT 0, notes text, created_by_staff_id uuid, created_by_name text NOT NULL, created_by_title text,
    approver_staff_id uuid, approver_name text, approved_at timestamptz, approval_note text, dispatched_at timestamptz,
    delivered_at timestamptz, created_at timestamptz DEFAULT now());
  CREATE TABLE public.order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, product_id uuid, product_name text, quantity integer, unit_price numeric, created_at timestamptz DEFAULT now());
  CREATE TABLE public.order_watchers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, staff_id uuid, watcher_name text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.order_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, file_name text, file_url text, file_type text, file_size integer, kind text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.order_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, event_type text, note text, actor_name text, created_at timestamptz DEFAULT now());
  GRANT ALL ON public.orders, public.order_items, public.order_watchers, public.order_files, public.order_events TO authenticated;
  ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "orders of own business" ON orders FOR ALL
    USING ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());
`)
for (const t of ['order_items', 'order_watchers', 'order_files', 'order_events']) {
  await db.exec(`
    ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "${t} via parent order" ON ${t} FOR ALL
      USING (is_platform_admin() OR (order_id IN (SELECT orders.id FROM orders WHERE orders.business_id IN (SELECT current_business_ids()))));
  `)
}

const S = await seedStaff()
const report = (staffId, biz = S.A) => sup('insert into field_activities (business_id, staff_id, rep_name) values ($1,$2,$3) returning id', [biz, staffId, 'r']).then((r) => r.rows[0].id)
const R1 = await report(S.repA1)       // rep one's own report
const R2 = await report(S.repA2)       // a colleague's report, not shared with rep one
const RB = await report(S.repB1, S.B)  // another company's report
const newOrder = (who, over = {}) => as(who,
  'insert into orders (business_id, customer_name, created_by_staff_id, created_by_name, approver_staff_id, field_activity_id) values ($1,$2,$3,$4,$5,$6) returning id',
  [over.business_id || S.A, over.customer_name || 'Allen Pharmacy', over.created_by_staff_id === undefined ? S.repA1 : over.created_by_staff_id, 'Rep One', over.approver_staff_id === undefined ? S.mgrA : over.approver_staff_id, over.field_activity_id || null]).then((r) => r.rows[0].id)

// ================================================================================================
// carehub_20261026_orders_field_activity_link (DRAFT): an order remembers the visit it came from
// ================================================================================================
const hasLink = async () => (await sup("select count(*)::int c from information_schema.columns where table_schema='public' and table_name='orders' and column_name='field_activity_id'")).rows[0].c === 1
ok('BEFORE: orders has no field_activity_id', !(await hasLink()))
await applyMigrations(['carehub_20261026_orders_field_activity_link.sql'])
ok('AFTER: the column exists and is optional', (await hasLink()) && (await sup("select is_nullable from information_schema.columns where table_name='orders' and column_name='field_activity_id'")).rows[0].is_nullable === 'YES')

const O1 = await newOrder('repA1', { field_activity_id: R1 })
ok('a rep raises an order linked to their own report', (await sup('select field_activity_id f from orders where id=$1', [O1])).rows[0].f === R1)
ok('an order without a visit is still allowed', !!(await newOrder('repA1')))
await expectError('an order cannot be linked to another company\'s report', () => newOrder('repA1', { field_activity_id: RB }), '42501')
await expectError('nor to a colleague\'s report the rep cannot see', () => newOrder('repA1', { field_activity_id: R2 }), '42501')
ok('a manager may link any report of the company (they can see them)', !!(await newOrder('mgrA', { created_by_staff_id: S.mgrA, approver_staff_id: null, field_activity_id: R1 })))
await expectError('re-pointing an existing order at another company\'s report is refused', () => as('repA1', 'update orders set field_activity_id=$2 where id=$1', [O1, RB]), '42501')
await sup('delete from activity_viewers where activity_id=$1', [R1])
await sup('delete from field_activities where id=$1', [R1])
ok('if the report goes, the order stays with no link', (await sup('select field_activity_id f from orders where id=$1', [O1])).rows[0].f === null)
const fnAcl = (await sup("select has_function_privilege('anon','public.orders_check_field_activity()','execute') a, has_function_privilege('authenticated','public.orders_check_field_activity()','execute') u")).rows[0]
ok('nobody calls the link check directly', fnAcl.a === false && fnAcl.u === false, JSON.stringify(fnAcl))


// ================================================================================================
// carehub_20261026_orders_authorisation (DRAFT): approval and the pipeline enforced by the database
// ================================================================================================
await sup('delete from orders')
const make = (who, over = {}) => newOrder(who, over)
const statusOf = async (id) => (await sup('select status from orders where id=$1', [id])).rows[0].status
const setStatus = (who, id, status) => as(who, 'update orders set status=$2 where id=$1 returning id', [id, status])

// BEFORE: each hole is real on the live policy.
const B1 = await make('repA1')
ok('BEFORE: the creator can approve their own order', (await setStatus('repA1', B1, 'approved')).rows.length === 1)
const B2 = await make('repA1')
ok('BEFORE: a colleague can delete someone else\'s order', (await as('repA2', 'delete from orders where id=$1 returning id', [B2])).rows.length === 1)
ok('BEFORE: a rep can raise an order in a colleague\'s name', !!(await make('repA1', { created_by_staff_id: S.repA2 })))
ok('BEFORE: a rep can create an order that is already approved', (await as('repA1', "insert into orders (business_id, customer_name, created_by_staff_id, created_by_name, status) values ($1,'X',$2,'Rep One','approved') returning id", [S.A, S.repA1])).rows.length === 1)
await sup('delete from orders')

await applyMigrations(['carehub_20261026_orders_authorisation.sql'])

const O = await make('repA1')                         // raised by rep one, approver: the manager
await expectError('AFTER: the creator cannot approve their own order', () => setStatus('repA1', O, 'approved'), '42501')
await expectError('AFTER: nor can a colleague who is not the approver', () => setStatus('repA2', O, 'approved'), '42501')
ok('AFTER: the tagged approver approves it', (await as('mgrA', "update orders set status='approved', approved_at=now() where id=$1 returning id", [O])).rows.length === 1 && (await statusOf(O)) === 'approved')
await expectError('AFTER: the creator cannot push their own order on to the warehouse', () => setStatus('repA1', O, 'processing'), '42501')
ok('AFTER: someone else (warehouse) moves it to processing, then dispatched, then delivered', await (async () => {
  await setStatus('repA2', O, 'processing'); await setStatus('repA2', O, 'dispatched'); await setStatus('repA2', O, 'delivered')
  return (await statusOf(O)) === 'delivered'
})())
const J = await make('repA1')
await expectError('AFTER: no jumping from submitted straight to delivered, even for the owner', () => setStatus('a', J, 'delivered'), '22023')
ok('AFTER: the owner may approve an order tagged to someone else', (await setStatus('a', J, 'approved')).rows.length === 1)
const R = await make('repA1')
ok('AFTER: the approver can reject', (await setStatus('mgrA', R, 'rejected')).rows.length === 1)
await expectError('AFTER: a rejected order stays rejected', () => setStatus('a', R, 'approved'), '22023')
const M = await make('repA1')
await expectError('AFTER: the creator cannot re-tag the approver (e.g. to an accomplice)', () => as('repA1', 'update orders set approver_staff_id=$2 where id=$1', [M, S.repA2]), '42501')
ok('AFTER: the owner can re-tag the approver', (await as('a', 'update orders set approver_staff_id=$2 where id=$1 returning id', [M, S.repA2])).rows.length === 1)
await expectError('AFTER: who raised an order cannot be rewritten', () => as('a', 'update orders set created_by_staff_id=$2 where id=$1', [M, S.repA2]), '42501')
await expectError('AFTER: nor which company it belongs to', () => as('a', 'update orders set business_id=$2 where id=$1', [M, S.B]), '42501')
ok('AFTER: the creator can still fix the notes of a submitted order', (await as('repA1', "update orders set notes='call first' where id=$1 returning id", [M])).rows.length === 1)
await expectError('AFTER: a rep cannot raise an order in a colleague\'s name', () => make('repA1', { created_by_staff_id: S.repA2 }), '42501')
await expectError('AFTER: a new order starts as submitted', () => as('repA1', "insert into orders (business_id, customer_name, created_by_staff_id, created_by_name, status) values ($1,'X',$2,'Rep One','approved')", [S.A, S.repA1]), '42501')
ok('AFTER: the owner raises an order with no staff author', !!(await make('a', { created_by_staff_id: null })))
await expectError('AFTER: the owner cannot raise one in a staff member\'s name', () => make('a', { created_by_staff_id: S.repA1 }), '42501')
ok('AFTER: nobody deletes an order, not even the owner (rows are hidden from DELETE)', (await as('a', 'delete from orders where id=$1 returning id', [M])).rows.length === 0 && (await as('repA1', 'delete from orders where id=$1 returning id', [M])).rows.length === 0)
await sup("insert into order_items (order_id, product_name, quantity) values ($1,'Amoxil',2)", [M])
ok('AFTER: nor its lines', (await as('a', 'delete from order_items where order_id=$1 returning id', [M])).rows.length === 0)
ok('AFTER: server-side maintenance (no signed-in caller) is not blocked', (await sup("update orders set status='processing' where id=$1 returning id", [J])).rows.length === 1)
const gAcl = (await sup("select has_function_privilege('anon','public.orders_guard()','execute') a, has_function_privilege('authenticated','public.orders_guard()','execute') u")).rows[0]
ok('AFTER: nobody calls the guard directly', gAcl.a === false && gAcl.u === false, JSON.stringify(gAcl))
ok('AFTER: the link check from the earlier draft still runs', await (async () => {
  try { await make('repA1', { field_activity_id: RB }); return false } catch (e) { return e.code === '42501' }
})())

// ---- final review I1: what was approved stays approved ----------------------------------------------------------
const P = await make('repA1')
ok('I1: while submitted, the creator may still correct the total', (await as('repA1', 'update orders set total_value=500 where id=$1 returning id', [P])).rows.length === 1)
await expectError('I1: while submitted, a colleague may not change the total', () => as('repA2', 'update orders set total_value=1 where id=$1', [P]), '42501')
await expectError('I1: nor may the approver quietly change it', () => as('mgrA', 'update orders set total_value=1 where id=$1', [P]), '42501')
await as('mgrA', "update orders set status='approved', approved_at=now(), approval_note='ok' where id=$1", [P])
await expectError('I1: after approval the creator cannot raise the total', () => as('repA1', 'update orders set total_value=99999 where id=$1', [P]), '42501')
await expectError('I1: nor change the customer', () => as('repA1', "update orders set customer_name='Someone else' where id=$1", [P]), '42501')
await expectError('I1: nor rewrite when it was approved', () => as('repA2', 'update orders set approved_at=now() where id=$1', [P]), '42501')
ok('I1: the warehouse can still record dispatch and delivery times as it moves the order', await (async () => {
  await setStatus('repA2', P, 'processing')
  const r = await as('repA2', "update orders set status='dispatched', dispatched_at=now() where id=$1 returning id", [P])
  return r.rows.length === 1
})())
ok('I1: the owner can still correct an approved order', (await as('a', 'update orders set notes=$2 where id=$1 returning id', [P, 'owner fix'])).rows.length === 1)
const Q = await make('repA1')
ok('I1: the creator adds lines to their submitted order', (await as('repA1', "insert into order_items (order_id, product_name, quantity) values ($1,'Amoxil',2) returning id", [Q])).rows.length === 1)
await expectError('I1: a colleague cannot add lines to someone else\'s order', () => as('repA2', "insert into order_items (order_id, product_name, quantity) values ($1,'Extra',9)", [Q]), '42501')
await as('mgrA', "update orders set status='approved' where id=$1", [Q])
await expectError('I1: nobody but the owner adds lines after approval', () => as('repA1', "insert into order_items (order_id, product_name, quantity) values ($1,'Extra',9)", [Q]), '42501')
await expectError('I1: nor changes a line after approval', () => as('repA1', "update order_items set quantity=999 where order_id=$1", [Q]), '42501')

// ---- final review I2: the order's history cannot be forged -------------------------------------------------------
const E = await make('repA1')
ok('I2: the creator records the submitted event, under their real name whatever name they send', await (async () => {
  await as('repA1', "insert into order_events (order_id, event_type, actor_name) values ($1,'submitted','Regional Manager')", [E])
  return (await sup("select actor_name from order_events where order_id=$1 and event_type='submitted'", [E])).rows[0].actor_name === 'Rep One'
})())
await expectError('I2: an "approved" event cannot be written for an order that is not approved', () => as('repA1', "insert into order_events (order_id, event_type, actor_name) values ($1,'approved','Regional Manager')", [E]), '42501')
await as('mgrA', "update orders set status='approved' where id=$1", [E])
ok('I2: after the real approval the approver records it under their own name', await (async () => {
  await as('mgrA', "insert into order_events (order_id, event_type, actor_name) values ($1,'approved','anything')", [E])
  return (await sup("select actor_name from order_events where order_id=$1 and event_type='approved'", [E])).rows[0].actor_name === 'Manager A'
})())
ok('I2: nobody edits an event afterwards (rows are hidden from UPDATE)', (await as('mgrA', "update order_events set actor_name='x' where order_id=$1 returning id", [E])).rows.length === 0)
ok('I2: the owner\'s own events keep the name the owner sends', await (async () => {
  const O2 = await make('a', { created_by_staff_id: null })
  await as('a', "insert into order_events (order_id, event_type, actor_name) values ($1,'submitted','Boss')", [O2])
  return (await sup("select actor_name from order_events where order_id=$1", [O2])).rows[0].actor_name === 'Boss'
})())
ok('I3: the draft refuses to apply if a definer function that writes orders is callable by signed-in users', await (async () => {
  await sup("create function public.sneaky_order_write() returns void language sql security definer as $f$ update public.orders set status = 'delivered' $f$")
  await sup('grant execute on function public.sneaky_order_write() to authenticated')
  let refused = false
  try { await db.exec(fs.readFileSync(migrationPath('carehub_20261026_orders_authorisation.sql'), 'utf8')) } catch (e) { refused = /callable by signed-in users/.test(e.message) }
  await sup('drop function public.sneaky_order_write()')
  return refused
})())

// ================================================================================================
// carehub_20261026_orders_read_scope (DRAFT, HELD for an owner decision about warehouse staff)
// ================================================================================================
const W = await make('repA1')
await sup('insert into order_watchers (order_id, staff_id, watcher_name) values ($1,$2,$3)', [W, S.repA2, 'Rep Two'])
const OTHER = await make('repA2', { created_by_staff_id: S.repA2, approver_staff_id: S.mgrA })
const seesOrder = async (who, id) => (await as(who, 'select id from orders where id=$1', [id])).rows.length === 1
ok('BEFORE: a rep reads a colleague\'s order', await seesOrder('repA1', OTHER))
await applyMigrations(['carehub_20261026_orders_read_scope.sql'])
ok('AFTER: a rep no longer reads a colleague\'s order', !(await seesOrder('repA1', OTHER)))
ok('AFTER: the creator still reads their own', await seesOrder('repA2', OTHER))
ok('AFTER: the tagged approver reads it', await seesOrder('mgrA', OTHER))
ok('AFTER: a watcher reads the order they were copied on', await seesOrder('repA2', W))
ok('AFTER: the owner reads every order', await seesOrder('a', OTHER) && await seesOrder('a', W))
ok('AFTER: another company reads none', !(await seesOrder('repB1', OTHER)) && !(await seesOrder('b', W)))
await sup("insert into order_items (order_id, product_name, quantity) values ($1,'Panadol',3)", [OTHER])
ok('AFTER: order lines follow their order', (await as('repA1', 'select id from order_items where order_id=$1', [OTHER])).rows.length === 0 && (await as('repA2', 'select id from order_items where order_id=$1', [OTHER])).rows.length === 1)
ok('AFTER: a rep still raises and reads back a new order (insert ... returning)', !!(await make('repA1')))

finish()
