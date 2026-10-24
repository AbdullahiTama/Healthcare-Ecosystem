// Directory x Field Activity (draft carehub_20261027_directory_field_link): customers derived from field visits,
// and businesses reps suggest for the platform directory. field_activities and orders carry the live policies
// (copied from pg_policies, 2026-10-24). See _harness.mjs for scope and limits.
//   REPO_ROOT=<repo> node directoryFieldLink.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, makeLikeLive, addDirectoryManagerStub } from './_harness.mjs'

await db.exec(`
  CREATE TABLE public.facilities_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, source text);
  CREATE TABLE public.rep_added_facilities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, status text);
  ALTER TABLE public.field_activities
    ADD COLUMN territory_id uuid, ADD COLUMN facility_name text, ADD COLUMN facility_address text, ADD COLUMN facility_category text,
    ADD COLUMN facility_lat double precision, ADD COLUMN facility_lng double precision, ADD COLUMN facility_verified boolean,
    ADD COLUMN facility_pending_review boolean, ADD COLUMN place_verified boolean, ADD COLUMN facility_distance_m integer,
    ADD COLUMN gps_accuracy_m integer, ADD COLUMN photo_paths text[], ADD COLUMN directory_business_id uuid, ADD COLUMN directory_business_name text;
  CREATE TABLE public.activity_viewers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES public.field_activities(id), staff_id uuid, viewer_name text);
  CREATE TABLE public.activity_reactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES public.field_activities(id), staff_id uuid, actor_name text);
  CREATE TABLE public.activity_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES public.field_activities(id), staff_id uuid, actor_name text, body text);
  GRANT ALL ON public.field_activities, public.activity_viewers, public.activity_reactions, public.activity_comments TO authenticated;
  CREATE TABLE public.directory_businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, is_active boolean DEFAULT true, verification_status text, data_source text);
  REVOKE ALL ON public.directory_businesses FROM anon, authenticated;
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
await db.exec(`
  CREATE TABLE public.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, order_ref text, customer_name text NOT NULL,
    status text NOT NULL DEFAULT 'submitted', created_by_staff_id uuid, created_by_name text NOT NULL DEFAULT 'x', created_at timestamptz DEFAULT now());
  GRANT ALL ON public.orders TO authenticated;
  ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "orders of own business" ON orders FOR ALL
    USING ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());
`)
await applyMigrations(['carehub_20261026_orders_field_activity_link.sql'], { rerun: false })

const S = await seedStaff()
const day = 86400000
const ago = (days) => new Date(Date.now() - days * day).toISOString()
const visit = (o) => sup(
  `insert into field_activities (business_id, staff_id, rep_name, created_at, facility_name, facility_address, facility_lat, facility_lng,
     directory_business_id, directory_business_name, territory_id, photo_paths)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
  [o.biz || S.A, o.staff, o.rep || 'r', o.at || ago(1), o.facility || null, o.address || null, o.lat ?? null, o.lng ?? null,
    o.dir || null, o.dirName || null, o.terr || null, o.photos || null]).then((r) => r.rows[0].id)
const order = (activityId, ref, at, biz = S.A) => sup('insert into orders (business_id, order_ref, customer_name, status, field_activity_id, created_at) values ($1,$2,$3,$4,$5,$6) returning id',
  [biz, ref, 'c', 'approved', activityId, at]).then((r) => r.rows[0].id)

const DIR = (await sup("insert into directory_businesses (name, verification_status, data_source) values ('Mercy Clinic','verified','manual') returning id")).rows[0].id
const TERR = '00000000-0000-0000-0000-0000000000f1'

// Rep one: Allen Pharmacy three times (two spellings, same ~100 m cell), Mercy Clinic (directory) twice.
const A1 = await visit({ staff: S.repA1, rep: 'Rep One', facility: 'Allen Pharmacy', address: '1 Marina', lat: 6.45012, lng: 3.39021, at: ago(45) })
const A2 = await visit({ staff: S.repA1, rep: 'Rep One', facility: ' allen pharmacy ', address: '1 Marina Rd', lat: 6.45031, lng: 3.39039, at: ago(10), terr: TERR, photos: ['p1', 'p2'] })
const A3 = await visit({ staff: S.repA1, rep: 'Rep One', facility: 'Allen Pharmacy', lat: 6.4502, lng: 3.3903, at: ago(2) })
await visit({ staff: S.repA1, rep: 'Rep One', dir: DIR, dirName: 'Mercy Clinic (old)', at: ago(20) })
await visit({ staff: S.repA1, rep: 'Rep One', dir: DIR, dirName: 'Mercy Clinic', at: ago(5) })
await visit({ staff: S.repA1, rep: 'Rep One', at: ago(1) }) // no place: not a customer
// Rep two: a private visit to Kemi Stores, shared with rep one, and one to Allen Pharmacy.
const K = await visit({ staff: S.repA2, rep: 'Rep Two', facility: 'Kemi Stores', lat: 6.5, lng: 3.4, at: ago(3) })
await sup('insert into activity_viewers (activity_id, staff_id, viewer_name) values ($1,$2,$3)', [K, S.repA1, 'Rep One'])
await visit({ staff: S.repA2, rep: 'Rep Two', facility: 'Allen Pharmacy', lat: 6.4502, lng: 3.3902, at: ago(4) })
// Company B.
await visit({ biz: S.B, staff: S.repB1, rep: 'Rep B', facility: 'Allen Pharmacy', lat: 6.4502, lng: 3.3902, at: ago(1) })
// Orders: from the oldest and the middle Allen visits; the newest Allen visit has none.
await order(A1, 'ORD-1', ago(44))
await order(A2, 'ORD-2', ago(9))

// ================================================================================================
await applyMigrations(['carehub_20261027_directory_field_link.sql'])
// ================================================================================================

const customers = async (who, staffId = null) => (await as(who, 'select * from field_customers($1, $2)', [S.A, staffId])).rows
const byName = (rows, n) => rows.find((r) => r.name.trim().toLowerCase() === n.toLowerCase())

const mgr = await customers('mgrA')
const allen = byName(mgr, 'allen pharmacy')
ok('customers: one customer for "Allen Pharmacy" and " allen pharmacy " in the same ~100 m cell, across reps', !!allen && mgr.filter((r) => r.name.trim().toLowerCase() === 'allen pharmacy').length === 1 && allen.visits_total === 4, JSON.stringify(mgr.map((r) => [r.key, r.visits_total])))
const mercy = byName(mgr, 'Mercy Clinic')
ok('customers: two visits to the same directory listing are one customer, kind directory, name from the newest visit', !!mercy && mercy.kind === 'directory' && mercy.visits_total === 2 && mercy.directory_business_id === DIR && mercy.key === 'd:' + DIR)
ok('customers: visits_30d counts only the last 30 days; visits_total counts all', allen.visits_30d === 3 && allen.visits_total === 4)
ok('customers: a visit with no directory listing and no facility is not a customer', mgr.length === 3, JSON.stringify(mgr.map((r) => r.name)))
ok('customers: last order is the newest order across the customer\'s visits (newest visit has none)', allen.last_order_ref === 'ORD-2' && allen.last_order_status === 'approved' && allen.last_activity_id === A3)
ok('customers: name, territory and last visit come from the newest visit', allen.name === 'Allen Pharmacy' && allen.last_visit_rep === 'Rep One' && allen.last_visit_staff_id === S.repA1 && allen.kind === 'facility')
ok('customers: rep_staff_ids lists each rep who visited', allen.rep_staff_ids.length === 2 && allen.rep_staff_ids.includes(S.repA1) && allen.rep_staff_ids.includes(S.repA2))
ok('customers: ordered by last visit, newest first', mgr[0].last_visit_at >= mgr[1].last_visit_at && mgr[1].last_visit_at >= mgr[2].last_visit_at)
ok('customers: p_limit caps the rows', (await as('mgrA', 'select * from field_customers($1, null, 1)', [S.A])).rows.length === 1)

const mine = await customers('repA1', S.repA1)
ok('customers: p_staff_id = repA1 excludes a customer known only from repA2\'s report shared with repA1', !byName(mine, 'Kemi Stores') && mine.length === 2)
ok('customers: p_staff_id counts only that rep\'s visits', byName(mine, 'allen pharmacy').visits_total === 3)
const repAll = await customers('repA1')
ok('customers: repA1 without p_staff_id sees only customers from visits RLS lets them read (own + shared, not repA2\'s private Allen visit)', !!byName(repAll, 'Kemi Stores') && byName(repAll, 'allen pharmacy').visits_total === 3)
ok('customers: company B sees none of A\'s', (await as('b', 'select * from field_customers($1)', [S.A])).rows.length === 0 && (await as('repB1', 'select * from field_customers($1)', [S.A])).rows.length === 0)
ok('customers: the owner sees the whole team', (await customers('a')).length === 3)

const visits = (await as('mgrA', 'select * from field_customer_visits($1, $2)', [S.A, allen.key])).rows
ok('visits: field_customer_visits returns that key\'s visits newest first with their orders', visits.length === 4 && visits[0].id === A3 && visits.find((v) => v.id === A2).orders.length === 1 && visits.find((v) => v.id === A2).orders[0].order_ref === 'ORD-2' && visits.find((v) => v.id === A2).photo_count === 2 && visits[0].orders.length === 0)
ok('visits: nothing for another company', (await as('b', 'select * from field_customer_visits($1, $2)', [S.A, allen.key])).rows.length === 0)
ok('visits: a rep gets only the visits they can read', (await as('repA1', 'select * from field_customer_visits($1, $2)', [S.A, allen.key])).rows.length === 3)

// ---- suggestions ------------------------------------------------------------------------------------------------
const suggest = (who, over = {}) => as(who,
  `insert into directory_suggestions (business_id, name, business_type, address, latitude, longitude, note, status, suggested_by_staff_id, suggested_by_name, suggested_by_email, review_note)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
  [over.biz || S.A, over.name || 'Kemi Stores', over.type || 'retail', '2 Allen Ave', 6.6, 3.35, 'by the junction',
    over.status || 'pending', over.staff || null, over.byName || null, over.byEmail || null, over.reviewNote || null])
const s1 = (await suggest('repA1', { status: 'accepted', staff: S.repA2, byName: 'Someone', byEmail: 'boss@a.test', reviewNote: 'self-approved' })).rows[0]
ok('suggestions: stored with the caller\'s staff id, name, email and status pending whatever the client sends', s1.suggested_by_staff_id === S.repA1 && s1.suggested_by_name === 'Rep One' && s1.suggested_by_email === 'rep1@a.test' && s1.status === 'pending' && s1.review_note === null, JSON.stringify(s1))
const sOwner = (await suggest('a')).rows[0]
ok('suggestions: the owner\'s suggestion is recorded under the business name', sOwner.suggested_by_staff_id === null && sOwner.suggested_by_name === 'Company A' && sOwner.suggested_by_email === 'a@x.test')
await expectError('suggestions: an outsider (no company) is refused', () => suggest('outsider'), '42501')
await expectError('suggestions: a member cannot suggest for company B', () => suggest('repA1', { biz: S.B }), '42501')
await expectError('suggestions: an unknown type is refused', () => suggest('repA1', { type: 'casino' }), '23514')
await expectError('suggestions: a one-letter name is refused', () => suggest('repA1', { name: 'K' }), '23514')
for (let i = 0; i < 18; i++) await suggest('repA2', { name: 'Place ' + i })
await expectError('suggestions: the 21st suggestion in 24 hours is refused', () => suggest('repA2', { name: 'One too many' }), 'Too many suggestions today')
ok('suggestions: company B is not held back by company A\'s cap', (await suggest('repB1', { biz: S.B })).rows.length === 1)

const sees = async (who, id) => (await as(who, 'select id from directory_suggestions where id=$1', [id])).rows.length === 1
ok('suggestions: repA2 cannot read repA1\'s suggestion; repA1 can', !(await sees('repA2', s1.id)) && await sees('repA1', s1.id))
ok('suggestions: the company\'s field manager and the owner can read it', await sees('mgrA', s1.id) && await sees('a', s1.id))
ok('suggestions: company B cannot; the platform admin can', !(await sees('b', s1.id)) && !(await sees('repB1', s1.id)) && await sees('admin', s1.id))
ok('suggestions: a rep cannot update (no rows)', (await as('repA1', "update directory_suggestions set status='accepted' where id=$1 returning id", [s1.id])).rows.length === 0)
await expectError('suggestions: nobody signed in deletes, not even the admin', () => as('admin', 'delete from directory_suggestions where id=$1', [s1.id]), '42501')
await expectError('suggestions: nor a rep', () => as('repA1', 'delete from directory_suggestions where id=$1', [s1.id]), '42501')
const acc = (await as('admin', "update directory_suggestions set status='accepted', directory_business_id=$2 where id=$1 returning *", [s1.id, DIR])).rows[0]
ok('suggestions: the admin accepts pending -> accepted with the listing, and the reviewer is recorded', acc.status === 'accepted' && acc.directory_business_id === DIR && acc.reviewed_by === 'admin@x.test' && !!acc.reviewed_at)
await expectError('suggestions: accepted -> rejected is refused', () => as('admin', "update directory_suggestions set status='rejected' where id=$1", [s1.id]), '22023')
await expectError('suggestions: the admin cannot rewrite what was suggested', () => as('admin', "update directory_suggestions set name='Other' where id=$1", [sOwner.id]), '42501')
ok('suggestions: the admin rejects with a reason', (await as('admin', "update directory_suggestions set status='rejected', review_note='duplicate' where id=$1 returning status", [sOwner.id])).rows[0].status === 'rejected')

const acl = (await sup(`select
  has_table_privilege('anon','public.directory_suggestions','select') a_sel, has_table_privilege('anon','public.directory_suggestions','insert') a_ins,
  has_function_privilege('authenticated','public.directory_suggestions_before_insert()','execute') t_ins,
  has_function_privilege('authenticated','public.directory_suggestions_before_update()','execute') t_upd,
  (select prosecdef from pg_proc where proname='field_customers') c_def, (select prosecdef from pg_proc where proname='field_customer_visits') v_def`)).rows[0]
ok('suggestions: anon has no access; trigger functions not callable; readers are SECURITY INVOKER', !acl.a_sel && !acl.a_ins && !acl.t_ins && !acl.t_upd && acl.c_def === false && acl.v_def === false, JSON.stringify(acl))
await expectError('anon cannot call the readers', () => as('anon', 'select * from field_customers($1)', [S.A]), '42501')

finish()
