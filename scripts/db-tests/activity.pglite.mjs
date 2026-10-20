// Field-activity access hardening database tests (live-like permissions).
// See _harness.mjs for scope and limits. The permissive policies are copied from the live project
// (verified from pg_policies on 2026-10-19). The pilot file is no longer the source of truth.
//   node scripts/db-tests/activity.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, USERS, makeLikeLive, addDirectoryManagerStub } from './_harness.mjs'

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
await makeLikeLive()              // is_business_manager() not executable by signed-in users, as in production
await addDirectoryManagerStub()   // can_manage_directory() exists and IS executable, as in production

// The live permissive policies (roles {public}, FOR ALL).
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
// A directory manager who is NOT a "manager" role (e.g. a Marketing Lead with canManageDirectory).
await sup("insert into staff (business_id,email,role,full_name,status) values ($1,'dir@a.test','Marketing Lead','Dir Lead','active')", [S.A])
await sup("insert into directory_managers_stub (business_id, email) values ($1,'dir@a.test')", [S.A])
USERS.dirA = { sub: '00000000-0000-0000-0000-0000000000c9', email: 'dir@a.test' }

const log = (who, biz, staffId) => as(who, `insert into field_activities (business_id, staff_id, rep_name) values ($1,$2,'x') returning id`, [biz, staffId]).then((r) => r.rows[0].id)

// ---- production parity: the trap this rework exists to avoid ------------------------------------
await expectError('PARITY: signed-in users cannot call is_business_manager() directly', () => as('repA1', 'select is_business_manager($1)', [S.A]), '42501')
await db.exec(`CREATE POLICY naive_probe ON field_activities AS RESTRICTIVE FOR SELECT TO authenticated USING (is_business_manager(business_id))`)
await expectError('PARITY: a policy that calls it directly breaks every read (why the old migration was unsafe)', () => as('repA1', 'select id from field_activities'), '42501')
await db.exec(`DROP POLICY naive_probe ON field_activities`)

// ---- BEFORE: the findings are real -----------------------------------------------------------
const pre = await log('repA1', S.A, S.repA1)
ok('BEFORE: a colleague can read another rep\'s activity (finding S3)', (await as('repA2', 'select id from field_activities where id=$1', [pre])).rows.length === 1)
const forged = await log('repA1', S.A, S.repA2)
ok('BEFORE: a rep can log as another rep (finding S5)', !!forged)
ok('BEFORE: a rep can delete a colleague\'s activity', (await as('repA2', 'delete from field_activities where id=$1 returning id', [pre])).rows.length === 1)

await applyMigrations(['carehub_20261131_field_activity_access.sql'])
await sup('delete from field_activities')

// ---- ACLs (the Supabase default-privilege trap) -------------------------------------------------
const acl = async (fn) => (await sup(`select has_function_privilege('anon', $1::regprocedure, 'execute') a, has_function_privilege('authenticated', $1::regprocedure, 'execute') u`, [fn])).rows[0]
for (const fn of ['caller_staff_id(uuid)', 'caller_sees_all_activity(uuid)', 'is_activity_viewer(uuid)', 'activity_business(uuid)', 'activity_author(uuid)']) {
  const r = await acl('public.' + fn)
  ok('ACL ' + fn + ': not anon, yes authenticated', r.a === false && r.u === true, JSON.stringify(r))
}

// ---- attribution -------------------------------------------------------------------------------
const own = await log('repA1', S.A, S.repA1)
ok('a rep can log under their own staff id', !!own)
await expectError('a rep cannot log as another rep', () => log('repA1', S.A, S.repA2), '42501')
await expectError('a rep cannot log as the owner (null staff id)', () => log('repA1', S.A, null), '42501')
const ownerAct = await log('a', S.A, null)
ok('the owner logs with a null staff id', !!ownerAct)
await expectError('the owner cannot log as a staff member', () => log('a', S.A, S.repA1), '42501')
await expectError('a rep cannot log into another company', () => log('repA1', S.B, S.repA1), '42501')
await expectError('another company\'s rep cannot log into company A', () => log('repB1', S.A, S.repB1), '42501')
ok('platform admin is exempt from attribution', !!(await log('admin', S.A, null)))

// ---- visibility (S3) ---------------------------------------------------------------------------
const seen = async (who) => (await as(who, 'select id from field_activities')).rows.map((r) => r.id)
ok('the author sees their own activity', (await seen('repA1')).includes(own))
ok('a colleague who is not tagged does NOT see it', !(await seen('repA2')).includes(own))
ok('a manager sees all of the company\'s activity', (await seen('mgrA')).includes(own) && (await seen('mgrA')).includes(ownerAct))
ok('the owner sees all of the company\'s activity', (await seen('a')).includes(own))
ok('a directory manager (not a "manager" role) still sees all, so coverage reports keep working', (await seen('dirA')).includes(own) && (await seen('dirA')).includes(ownerAct))
ok('another company sees none of it', (await seen('repB1')).length === 0 && (await seen('b')).length === 0)
ok('platform admin sees it', (await seen('admin')).includes(own))
await expectError('anonymous cannot read', () => as('anon', 'select id from field_activities'), '42501')

// ---- the live coverage functions run as the caller and must stay correct ---------------------------
await db.exec(`CREATE FUNCTION public.coverage_probe(bid uuid) RETURNS bigint LANGUAGE sql STABLE SET search_path TO 'public' AS $$ SELECT count(*) FROM field_activities WHERE business_id = bid $$;
  GRANT EXECUTE ON FUNCTION public.coverage_probe(uuid) TO authenticated;`)
const cover = async (who) => Number((await as(who, 'select coverage_probe($1) c', [S.A])).rows[0].c)
ok('an INVOKER coverage query counts everything for a directory manager and for the owner', (await cover('dirA')) === 3 && (await cover('a')) === 3, (await cover('dirA')) + '/' + (await cover('a')))
ok('...and only the caller\'s own for an ordinary colleague (so it cannot be used to count others\' activity)', (await cover('repA2')) === 0 && (await cover('repA1')) === 1)

// ---- tagging viewers ---------------------------------------------------------------------------
await expectError('an untagged colleague cannot tag themselves onto it', () => as('repA2', `insert into activity_viewers (activity_id, staff_id) values ($1,$2)`, [own, S.repA2]), '42501')
await as('repA1', `insert into activity_viewers (activity_id, staff_id, viewer_name) values ($1,$2,'Rep Two')`, [own, S.repA2])
ok('the author can tag a colleague, who then sees the activity', (await seen('repA2')).includes(own))
await expectError('a tagged viewer cannot tag further people', () => as('repA2', `insert into activity_viewers (activity_id, staff_id) values ($1,$2)`, [own, S.mgrA]), '42501')
ok('a tagged viewer cannot remove the tagging', (await as('repA2', 'delete from activity_viewers where activity_id=$1 returning id', [own])).rows.length === 0)
ok('a tagged viewer still cannot see an untagged activity of the same author', !(await seen('repA2')).includes(await log('repA1', S.A, S.repA1)))
ok('a manager can manage viewers', (await as('mgrA', `insert into activity_viewers (activity_id, staff_id) values ($1,$2) returning id`, [own, S.mgrA])).rows.length === 1)

// ---- reactions and comments (S4) ---------------------------------------------------------------
await as('repA2', `insert into activity_reactions (activity_id, staff_id, actor_name) values ($1,$2,'Rep Two')`, [own, S.repA2])
await expectError('a rep cannot react as someone else', () => as('repA2', `insert into activity_reactions (activity_id, staff_id, actor_name) values ($1,$2,'Mgr')`, [own, S.mgrA]), '42501')
await as('repA2', `insert into activity_comments (activity_id, staff_id, actor_name, body) values ($1,$2,'Rep Two','hello')`, [own, S.repA2])
await expectError('a rep cannot comment as someone else', () => as('repA2', `insert into activity_comments (activity_id, staff_id, actor_name, body) values ($1,$2,'Mgr','fake')`, [own, S.mgrA]), '42501')
await expectError('someone who cannot see an activity cannot react to it', () => as('repB1', `insert into activity_reactions (activity_id, staff_id) values ($1,$2)`, [own, S.repB1]), '42501')
const react = (await sup('select id from activity_reactions limit 1')).rows[0].id
ok('another rep cannot delete someone else\'s reaction', (await as('repA1', 'delete from activity_reactions where id=$1 returning id', [react])).rows.length === 0)
const comment = (await sup('select id from activity_comments limit 1')).rows[0].id
ok('a manager can remove a comment', (await as('mgrA', 'delete from activity_comments where id=$1 returning id', [comment])).rows.length === 1)
ok('an author can remove their own reaction', (await as('repA2', 'delete from activity_reactions where id=$1 returning id', [react])).rows.length === 1)

// ---- activities are records ----------------------------------------------------------------------
ok('the author cannot edit an activity after submitting (GPS stays as logged)', (await as('repA1', 'update field_activities set lat=0 where id=$1 returning id', [own])).rows.length === 0)
ok('a manager cannot edit it either', (await as('mgrA', 'update field_activities set lat=0 where id=$1 returning id', [own])).rows.length === 0)
ok('the author cannot delete it (it has tags, and the row is hidden from DELETE)', (await as('repA1', 'delete from field_activities where id=$1 returning id', [own])).rows.length === 0)
ok('the owner cannot delete it', (await as('a', 'delete from field_activities where id=$1 returning id', [own])).rows.length === 0)
ok('platform admin can correct a record', (await as('admin', 'update field_activities set rep_name=$2 where id=$1 returning id', [own, 'fixed'])).rows.length === 1)

// ---- retry-safe save: a client-chosen id + ON CONFLICT DO NOTHING -------------------------------------
// The page saves a report under an id it made, with PostgREST's resolution=ignore-duplicates (which is
// INSERT ... ON CONFLICT DO NOTHING). This proves, on real Postgres under the live-like policies, that a
// repeat is harmless and cannot be used to take over someone else's report. It does not prove PostgREST
// builds exactly that statement from the header; that needs the live API.
const RID = "11111111-1111-4111-8111-111111111111"
const saveWithId = (who, biz, staffId, id, name) =>
  as(who, "insert into field_activities (id, business_id, staff_id, rep_name) values ($1,$2,$3,$4) on conflict do nothing returning id", [id, biz, staffId, name])
const countOf = async (id) => Number((await sup("select count(*) c from field_activities where id=$1", [id])).rows[0].c)

const firstSave = await saveWithId("repA1", S.A, S.repA1, RID, "First attempt")
ok("a client-chosen id is accepted", firstSave.rows.length === 1 && firstSave.rows[0].id === RID)
const repeatSave = await saveWithId("repA1", S.A, S.repA1, RID, "Edited retry")
ok("sending the same report again inserts nothing and raises nothing", repeatSave.rows.length === 0)
ok("...so there is still exactly one row", (await countOf(RID)) === 1)
ok("...and the first values stand: an edited retry is ignored, which is why the page resends the original", (await sup("select rep_name from field_activities where id=$1", [RID])).rows[0].rep_name === "First attempt")
await expectError("a repeat cannot be used to attribute the report to someone else", () => saveWithId("repA1", S.A, S.repA2, RID, "Forged"), "42501")

const takeover = await saveWithId("repA2", S.A, S.repA2, RID, "Hijack")
const afterTakeover = (await sup("select staff_id, rep_name from field_activities where id=$1", [RID])).rows[0]
ok("a colleague reusing the id changes nothing: not the author, not the content", takeover.rows.length === 0 && afterTakeover.staff_id === S.repA1 && afterTakeover.rep_name === "First attempt", JSON.stringify(afterTakeover))
await expectError("...and cannot tag themselves onto the report as a viewer", () => as("repA2", "insert into activity_viewers (activity_id, staff_id, viewer_name) values ($1,$2,'x')", [RID, S.repA2]), "42501")
ok("...and cannot read it", !(await seen("repA2")).includes(RID))
ok("another company reusing the id changes nothing either", (await saveWithId("repB1", S.B, S.repB1, RID, "Other company")).rows.length === 0 && (await countOf(RID)) === 1)

// The viewers table has no unique (activity_id, staff_id), so the page reads what is there and adds only
// the missing ones. Prove both halves: the database would accept a duplicate, and the author can read back.
await as("repA1", "insert into activity_viewers (activity_id, staff_id, viewer_name) values ($1,$2,'Mgr')", [RID, S.mgrA])
const viewersNow = (await as("repA1", "select staff_id from activity_viewers where activity_id=$1", [RID])).rows
ok("the author can read back the viewers already written, so a retry adds only the missing ones", viewersNow.length === 1 && viewersNow[0].staff_id === S.mgrA)
await as("repA1", "insert into activity_viewers (activity_id, staff_id, viewer_name) values ($1,$2,'Mgr')", [RID, S.mgrA])
ok("the table itself would accept the same viewer twice, which is why the client must read first", Number((await sup("select count(*) c from activity_viewers where activity_id=$1", [RID])).rows[0].c) === 2)

// ---- notifications addressed to other people (audit item U2) ---------------------------------------------
// The page tells tagged colleagues about a report by inserting staff_notifications rows from the browser.
// This replays the LIVE policy on that table (copied from pg_policies, 2026-10-20: one PERMISSIVE ALL policy for
// role public, same expression for USING and WITH CHECK) to see who a signed-in user can write a row for.
await db.exec(`
  CREATE TABLE public.staff_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, staff_id uuid, is_owner boolean, kind text, title text);
  GRANT ALL ON public.staff_notifications TO authenticated;
  -- The policy reads these two tables as the signed-in user, who can read them in production.
  GRANT SELECT ON public.businesses, public.staff TO authenticated;
  ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "staff_notifications for own business and owner" ON public.staff_notifications FOR ALL
    USING (is_platform_admin() OR (business_id IN (SELECT current_business_ids()) AND (
      (is_owner = true AND EXISTS (SELECT 1 FROM businesses WHERE businesses.id = staff_notifications.business_id AND lower(businesses.email) = lower((SELECT auth.email()))))
      OR staff_id IN (SELECT staff.id FROM staff WHERE lower(staff.email) = lower((SELECT auth.email())) AND staff.status = 'active'))))
    WITH CHECK (is_platform_admin() OR (business_id IN (SELECT current_business_ids()) AND (
      (is_owner = true AND EXISTS (SELECT 1 FROM businesses WHERE businesses.id = staff_notifications.business_id AND lower(businesses.email) = lower((SELECT auth.email()))))
      OR staff_id IN (SELECT staff.id FROM staff WHERE lower(staff.email) = lower((SELECT auth.email())) AND staff.status = 'active'))));
`)
const notifyRow = (who, biz, staffId, isOwner) =>
  as(who, "insert into staff_notifications (business_id, staff_id, is_owner, kind, title) values ($1,$2,$3,'activity','x') returning id", [biz, staffId, isOwner])
ok("a person can write a notification for themselves", (await notifyRow("repA1", S.A, S.repA1, false)).rows.length === 1)
await expectError("FINDING: a rep cannot write a notification for a colleague, so a browser-side 'tell my viewers' is refused", () => notifyRow("repA1", S.A, S.repA2, false), "42501")
await expectError("FINDING: a rep cannot write one for the owner either", () => notifyRow("repA1", S.A, null, true), "42501")
ok("the owner can write one for the owner", (await notifyRow("a", S.A, null, true)).rows.length === 1)
await expectError("FINDING: the owner cannot write one for a staff member", () => notifyRow("a", S.A, S.repA1, false), "42501")
await expectError("a manager cannot write one for a rep", () => notifyRow("mgrA", S.A, S.repA1, false), "42501")
ok("platform admin can write one for anyone", (await notifyRow("admin", S.A, S.repA2, false)).rows.length === 1)
ok("a person reads only their own notifications", (await as("repA2", "select id from staff_notifications")).rows.length === 1)

// ---- Realtime consequence -----------------------------------------------------------------------
ok('an untagged colleague does not see a new activity (Realtime evaluates the same policy)', !(await seen('repA2')).includes(ownerAct))

finish()
