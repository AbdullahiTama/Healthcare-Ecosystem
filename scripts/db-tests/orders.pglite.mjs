// Orders: the link from an order to the field report it came from, and order authorisation (drafts of
// 2026-10-26, field team reorganisation). The "orders of own business" and "... via parent order" policies are
// copied from the live project (pg_policies, 2026-10-24). See _harness.mjs for scope and limits.
//   REPO_ROOT=<repo> node orders.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, makeLikeLive, addDirectoryManagerStub } from './_harness.mjs'

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

finish()
