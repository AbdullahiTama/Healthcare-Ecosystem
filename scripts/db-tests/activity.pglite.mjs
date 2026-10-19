// Field-activity access hardening and directory-link database tests.
// See _harness.mjs for scope and limits. The permissive policies below are copied
// from sql/phase2_rls_pilot.sql; the live ones may differ (see the migration header).
//   node scripts/db-tests/activity.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, USERS } from './_harness.mjs'

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
await applyMigrations(['carehub_20261120_business_directory.sql'], { rerun: false })

// Today's permissive policies (sql/phase2_rls_pilot.sql 520-560).
await db.exec(`
  ALTER TABLE field_activities ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "field_activities of own business" ON field_activities FOR ALL
    USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
    WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  ALTER TABLE activity_viewers ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "activity_viewers via parent field_activities" ON activity_viewers FOR ALL
    USING (is_platform_admin() OR activity_id IN (SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())))
    WITH CHECK (is_platform_admin() OR activity_id IN (SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())));
  ALTER TABLE activity_reactions ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "activity_reactions via parent field_activities" ON activity_reactions FOR ALL
    USING (is_platform_admin() OR activity_id IN (SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())))
    WITH CHECK (is_platform_admin() OR activity_id IN (SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())));
  ALTER TABLE activity_comments ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "activity_comments via parent field_activities" ON activity_comments FOR ALL
    USING (is_platform_admin() OR activity_id IN (SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())))
    WITH CHECK (is_platform_admin() OR activity_id IN (SELECT id FROM field_activities WHERE business_id IN (SELECT current_business_ids())));
`)

const S = await seedStaff()
const log = (who, biz, staffId, extra = '') => as(who, `insert into field_activities (business_id, staff_id, rep_name${extra ? ', ' + extra.split('=')[0] : ''}) values ($1,$2,'x'${extra ? ',' + extra.split('=')[1] : ''}) returning id`, [biz, staffId]).then((r) => r.rows[0].id)

// ---- BEFORE hardening: prove the findings are real -------------------------------------------
const pre = await log('repA1', S.A, S.repA1)
ok('BEFORE: a colleague can read another rep\'s activity (finding S3)', (await as('repA2', 'select id from field_activities where id=$1', [pre])).rows.length === 1)
const forged = await log('repA1', S.A, S.repA2)
ok('BEFORE: a rep can log as another rep (finding S5)', !!forged)
ok('BEFORE: a rep can delete a colleague\'s activity', (await as('repA2', 'delete from field_activities where id=$1 returning id', [pre])).rows.length === 1)

await applyMigrations(['carehub_20261124_field_activity_directory_link.sql', 'carehub_20261125_field_activity_access.sql'])
await sup('delete from field_activities')

// ---- attribution -----------------------------------------------------------------------------
const own = await log('repA1', S.A, S.repA1)
ok('a rep can log under their own staff id', !!own)
await expectError('a rep cannot log as another rep', () => log('repA1', S.A, S.repA2), '42501')
await expectError('a rep cannot log as the owner (null staff id)', () => log('repA1', S.A, null), '42501')
const ownerAct = await log('a', S.A, null)
ok('the owner logs with a null staff id', !!ownerAct)
await expectError('the owner cannot log as a staff member', () => log('a', S.A, S.repA1), '42501')
await expectError('a rep cannot log into another company', () => log('repA1', S.B, S.repA1), '42501')
await expectError('another company\'s rep cannot log into company A', () => log('repB1', S.A, S.repB1), '42501')
const adminAct = await log('admin', S.A, null)
ok('platform admin is exempt from attribution', !!adminAct)

// ---- visibility (S3) -------------------------------------------------------------------------
const seen = async (who) => (await as(who, 'select id from field_activities')).rows.map((r) => r.id)
ok('the author sees their own activity', (await seen('repA1')).includes(own))
ok('a colleague who is not tagged does NOT see it', !(await seen('repA2')).includes(own))
ok('a manager sees all of the company\'s activity', (await seen('mgrA')).includes(own) && (await seen('mgrA')).includes(ownerAct))
ok('the owner sees all of the company\'s activity', (await seen('a')).includes(own))
ok('another company sees none of it', (await seen('repB1')).length === 0 && (await seen('b')).length === 0)
ok('platform admin sees it', (await seen('admin')).includes(own))
await expectError('anonymous cannot read', () => as('anon', 'select id from field_activities'), '42501')

// ---- tagging viewers -------------------------------------------------------------------------
await expectError('an untagged colleague cannot tag themselves onto it', () => as('repA2', `insert into activity_viewers (activity_id, staff_id) values ($1,$2)`, [own, S.repA2]), '42501')
await as('repA1', `insert into activity_viewers (activity_id, staff_id, viewer_name) values ($1,$2,'Rep Two')`, [own, S.repA2])
ok('the author can tag a colleague, who then sees the activity', (await seen('repA2')).includes(own))
await expectError('a tagged viewer cannot tag further people', () => as('repA2', `insert into activity_viewers (activity_id, staff_id) values ($1,$2)`, [own, S.mgrA]), '42501')
ok('a tagged viewer cannot remove the tagging', (await as('repA2', 'delete from activity_viewers where activity_id=$1 returning id', [own])).rows.length === 0)
ok('a tagged viewer still cannot see an untagged activity of the same author', !(await seen('repA2')).includes(await log('repA1', S.A, S.repA1)))
const mgrTag = await as('mgrA', `insert into activity_viewers (activity_id, staff_id) values ($1,$2) returning id`, [own, S.mgrA])
ok('a manager can manage viewers', mgrTag.rows.length === 1)

// ---- reactions and comments (S4) -------------------------------------------------------------
await as('repA2', `insert into activity_reactions (activity_id, staff_id, actor_name) values ($1,$2,'Rep Two')`, [own, S.repA2])
await expectError('a rep cannot react as someone else', () => as('repA2', `insert into activity_reactions (activity_id, staff_id, actor_name) values ($1,$2,'Mgr')`, [own, S.mgrA]), '42501')
await as('repA2', `insert into activity_comments (activity_id, staff_id, actor_name, body) values ($1,$2,'Rep Two','hello')`, [own, S.repA2])
await expectError('a rep cannot comment as someone else', () => as('repA2', `insert into activity_comments (activity_id, staff_id, actor_name, body) values ($1,$2,'Mgr','fake')`, [own, S.mgrA]), '42501')
await expectError('an unrelated colleague cannot react to an activity they cannot see', () => as('mgrA', 'select 1').then(() => as('repB1', `insert into activity_reactions (activity_id, staff_id) values ($1,$2)`, [own, S.repB1])), '42501')
const react = (await sup('select id from activity_reactions limit 1')).rows[0].id
ok('another rep cannot delete someone else\'s reaction', (await as('repA1', 'delete from activity_reactions where id=$1 returning id', [react])).rows.length === 0)
const comment = (await sup('select id from activity_comments limit 1')).rows[0].id
ok('a manager can remove a comment', (await as('mgrA', 'delete from activity_comments where id=$1 returning id', [comment])).rows.length === 1)
ok('an author can remove their own reaction', (await as('repA2', 'delete from activity_reactions where id=$1 returning id', [react])).rows.length === 1)

// ---- activities are records ------------------------------------------------------------------
ok('the author cannot edit an activity after submitting (GPS stays as logged)', (await as('repA1', 'update field_activities set lat=0 where id=$1 returning id', [own])).rows.length === 0)
ok('a manager cannot edit it either', (await as('mgrA', 'update field_activities set lat=0 where id=$1 returning id', [own])).rows.length === 0)
ok('the author cannot delete it', (await as('repA1', 'delete from field_activities where id=$1 returning id', [own])).rows.length === 0)
ok('the owner cannot delete it', (await as('a', 'delete from field_activities where id=$1 returning id', [own])).rows.length === 0)
ok('platform admin can correct a record', (await as('admin', 'update field_activities set rep_name=$2 where id=$1 returning id', [own, 'fixed'])).rows.length === 1)

// ---- directory link --------------------------------------------------------------------------
const dirBiz = (await as('admin', `insert into directory_businesses (name, latitude, longitude, state) values ('Alpha Pharmacy', 6.6, 3.35, 'Lagos') returning id`)).rows[0].id
const dirOff = (await as('admin', `insert into directory_businesses (name, is_active) values ('Closed Clinic', false) returning id`)).rows[0].id
const link = (who, biz, staff, did, confirmed, name = 'Client Chosen Name') => as(who, `insert into field_activities (business_id, staff_id, rep_name, directory_business_id, directory_business_name, business_link_confirmed) values ($1,$2,'x',$3,$4,$5) returning *`, [biz, staff, did, name, confirmed]).then((r) => r.rows[0])
const linked = await link('repA1', S.A, S.repA1, dirBiz, true)
ok('a confirmed link is stored', linked.directory_business_id === dirBiz && linked.business_link_confirmed === true)
ok('the name is copied from the directory, not trusted from the client', linked.directory_business_name === 'Alpha Pharmacy', linked.directory_business_name)
await expectError('an unconfirmed link cannot be stored', () => link('repA1', S.A, S.repA1, dirBiz, false), '23514')
await expectError('an inactive directory business cannot be linked', () => link('repA1', S.A, S.repA1, dirOff, true), '22023')
await expectError('a non-existent directory business cannot be linked', () => link('repA1', S.A, S.repA1, '00000000-0000-0000-0000-00000000dead', true))
const plain = (await as('repA1', `insert into field_activities (business_id, staff_id, rep_name) values ($1,$2,'x') returning *`, [S.A, S.repA1])).rows[0]
ok('a report without a link is valid and has none (the link is optional)', plain.directory_business_id === null && plain.business_link_confirmed === false && plain.directory_business_name === null)
const stray = (await as('repA1', `insert into field_activities (business_id, staff_id, rep_name, business_link_confirmed, directory_business_name) values ($1,$2,'x',true,'Made Up') returning *`, [S.A, S.repA1])).rows[0]
ok('a confirmation flag or name with no business id is cleared', stray.business_link_confirmed === false && stray.directory_business_name === null)
await as('admin', 'update directory_businesses set name=$2 where id=$1', [dirBiz, 'Renamed Pharmacy'])
ok('the report keeps the name the rep saw when the directory record is later renamed', (await sup('select directory_business_name n from field_activities where id=$1', [linked.id])).rows[0].n === 'Alpha Pharmacy')
// Discovery is read-only: run searches (including a radius search around the business) and compare.
await applyMigrations(['carehub_20261122_directory_search.sql'], { rerun: false })
const countAll = async () => (await sup('select (select count(*) from field_activities)::int a, (select count(*) from staff_checkins)::int c, (select count(*) from location_access_log)::int l').catch(() => sup('select (select count(*) from field_activities)::int a'))).rows[0].a
const beforeCount = await countAll()
await as('repA1', `select directory_search(p_q=>'Renamed', p_lat=>6.6, p_lng=>3.35, p_radius_m=>1000)`)
await as('repA1', `select directory_search(p_lat=>6.6, p_lng=>3.35, p_sort=>'distance')`)
ok('searching and viewing directory businesses creates no field activity', (await countAll()) === beforeCount)

// ---- realtime publication ------------------------------------------------------------------
const inPub = async () => (await sup("select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1")).rows.map((r) => r.tablename)
await applyMigrations(['carehub_20261127_realtime_activity_tables.sql'], { rerun: false })
ok('no publication: the migration is a harmless no-op', (await inPub()).length === 0)
await db.exec('CREATE PUBLICATION supabase_realtime FOR TABLE public.activity_viewers')
await applyMigrations(['carehub_20261127_realtime_activity_tables.sql'])
ok('the three activity tables are published, existing members left alone', (await inPub()).join() === 'activity_comments,activity_reactions,activity_viewers,field_activities', (await inPub()).join())

finish()
