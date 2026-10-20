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

// ---- paging across equal timestamps: the cursor is (created_at, id) -------------------------------------------
// The feed pages with: created_at < T OR (created_at = T AND id < I), ordered by created_at desc, id desc.
// Five reports share one timestamp and are read two at a time by a manager (who sees all of them).
const TIE = "2026-10-20T12:00:00Z"
const tieIds = []
for (let i = 1; i <= 5; i++) {
  const id = "2222222" + i + "-2222-4222-8222-222222222222"
  tieIds.push(id)
  await sup("insert into field_activities (id, business_id, staff_id, rep_name, created_at) values ($1,$2,$3,'tie',$4)", [id, S.A, S.repA1, TIE])
}
const tiePage = async (cursorId) => (await as("mgrA", cursorId
  ? "select id from field_activities where rep_name='tie' and (created_at < $1 or (created_at = $1 and id < $2)) order by created_at desc, id desc limit 2"
  : "select id from field_activities where rep_name='tie' order by created_at desc, id desc limit 2",
  cursorId ? [TIE, cursorId] : [])).rows.map((r) => r.id)
const walked = []
let tieCursor = null
for (let guard = 0; guard < 10; guard++) {
  const rows = await tiePage(tieCursor)
  if (rows.length === 0) break
  walked.push(...rows)
  tieCursor = rows[rows.length - 1]
}
ok("paging through five reports that share one timestamp returns each exactly once, in order", walked.length === 5 && new Set(walked).size === 5 && walked.join() === [...tieIds].sort().reverse().join(), walked.join())
ok("a created_at-only cursor would have skipped the rest of the tie, which is why the cursor carries the id", (await as("mgrA", "select id from field_activities where rep_name='tie' and created_at < $1", [TIE])).rows.length === 0)

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

// =====================================================================================================
// MIGRATIONS FOR THE LIVE FIELD ACTIVITY FINDINGS. All four (default_viewers_own_rows, activity_server_alerts,
// log_field_activity, activity_voice_private) were applied to production on 2026-10-20 and live in supabase/migrations.
// Each is shown BEFORE (the exposure is real on this replica) and AFTER (it is closed), then re-applied
// to prove it can be run twice. The stand-in tables below mirror the live columns checked on 2026-10-20.
// =====================================================================================================
await db.exec(`
  ALTER TABLE public.field_activities
    ADD COLUMN IF NOT EXISTS rep_title text, ADD COLUMN IF NOT EXISTS values_json text, ADD COLUMN IF NOT EXISTS voice_url text,
    ADD COLUMN IF NOT EXISTS location_label text, ADD COLUMN IF NOT EXISTS place_of_visit text, ADD COLUMN IF NOT EXISTS place_coords jsonb,
    ADD COLUMN IF NOT EXISTS place_verified boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS facility_name text,
    ADD COLUMN IF NOT EXISTS facility_address text, ADD COLUMN IF NOT EXISTS facility_category text,
    ADD COLUMN IF NOT EXISTS facility_lat double precision, ADD COLUMN IF NOT EXISTS facility_lng double precision,
    ADD COLUMN IF NOT EXISTS facility_distance_m integer, ADD COLUMN IF NOT EXISTS facility_source text,
    ADD COLUMN IF NOT EXISTS facility_verified boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS facility_pending_review boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS directory_business_id uuid, ADD COLUMN IF NOT EXISTS directory_business_name text;
  ALTER TABLE public.staff_notifications ADD COLUMN IF NOT EXISTS body text, ADD COLUMN IF NOT EXISTS link text, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  CREATE TABLE public.activity_default_viewers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, staff_id uuid, viewer_staff_id uuid, viewer_name text NOT NULL, created_at timestamptz DEFAULT now());
  GRANT ALL ON public.activity_default_viewers TO authenticated;
  ALTER TABLE public.activity_default_viewers ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "activity_default_viewers of own business" ON public.activity_default_viewers FOR ALL
    USING ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
    WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());
`)

// ---- F7: default viewers --------------------------------------------------------------------------------
const addDefault = (who, biz, owner, viewer) => as(who, "insert into activity_default_viewers (business_id, staff_id, viewer_staff_id, viewer_name) values ($1,$2,$3,'V') returning id", [biz, owner, viewer])
const dvMine = (await addDefault("repA1", S.A, S.repA1, S.mgrA)).rows[0].id
ok("BEFORE: a colleague can delete another person's default viewers (finding F7)", (await as("repA2", "delete from activity_default_viewers where id=$1 returning id", [dvMine])).rows.length === 1)
ok("BEFORE: a colleague can write a default-viewer list for someone else", !!(await addDefault("repA2", S.A, S.repA1, S.repA2)).rows[0].id)
await sup("delete from activity_default_viewers")
await applyMigrations(["carehub_20261020_default_viewers_own_rows.sql"])
const dvOwn = (await addDefault("repA1", S.A, S.repA1, S.mgrA)).rows[0].id
ok("a person can still write their own default viewers", !!dvOwn)
await expectError("a colleague cannot write a default-viewer list for someone else", () => addDefault("repA2", S.A, S.repA1, S.repA2), "42501")
ok("a colleague cannot delete another person's default viewers (row is hidden from DELETE)", (await as("repA2", "delete from activity_default_viewers where id=$1 returning id", [dvOwn])).rows.length === 0)
ok("a colleague cannot rewrite another person's default viewers", (await as("repA2", "update activity_default_viewers set viewer_staff_id=$2 where id=$1 returning id", [dvOwn, S.repA2])).rows.length === 0)
ok("a manager cannot edit someone else's list either", (await as("mgrA", "delete from activity_default_viewers where id=$1 returning id", [dvOwn])).rows.length === 0)
await expectError("the owner cannot write a list for a staff member", () => addDefault("a", S.A, S.repA1, S.mgrA), "42501")
await expectError("nobody writes a list with no owner staff id", () => addDefault("repA1", S.A, null, S.mgrA), "42501")
await expectError("nor into another company", () => addDefault("repA1", S.B, S.repA1, S.mgrA), "42501")
ok("reading is unchanged: a colleague can still read it", (await as("repA2", "select id from activity_default_viewers where id=$1", [dvOwn])).rows.length === 1)
ok("the person can change and remove their own list", (await as("repA1", "update activity_default_viewers set viewer_name='Z' where id=$1 returning id", [dvOwn])).rows.length === 1 && (await as("repA1", "delete from activity_default_viewers where id=$1 returning id", [dvOwn])).rows.length === 1)
ok("a platform admin can correct any list", !!(await addDefault("admin", S.A, S.repA1, S.mgrA)).rows[0].id)

// ---- F3: the voice bucket ---------------------------------------------------------------------------------
await db.exec(`
  CREATE SCHEMA storage;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner_id text DEFAULT (auth.uid())::text);
  GRANT ALL ON storage.objects TO anon, authenticated; -- as in Supabase: the policies decide, not the grants
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql AS $f$
    DECLARE _parts text[]; BEGIN SELECT string_to_array(name, '/') INTO _parts; RETURN _parts[1:array_length(_parts, 1) - 1]; END $f$;
  GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated;
  INSERT INTO storage.buckets VALUES ('activity-voice', true, NULL, NULL), ('ecommerce-images', true, NULL, NULL);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "activity-voice insert" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'activity-voice');
  CREATE POLICY "activity-voice read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'activity-voice');
  CREATE POLICY "other bucket read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'ecommerce-images');
`)
const VOICE_ACT = "44444444-4444-4444-8444-444444444441"
const VOICE_ACT2 = "44444444-4444-4444-8444-444444444442"
await sup("insert into field_activities (id, business_id, staff_id, rep_name, voice_url) values ($1,$2,$3,'v','https://x.supabase.co/storage/v1/object/public/activity-voice/voice-flat.webm')", [VOICE_ACT, S.A, S.repA1])
await sup("insert into field_activities (id, business_id, staff_id, rep_name, voice_url) values ($1,$2,$3,'v2',$4)", [VOICE_ACT2, S.A, S.repA1, "https://x.supabase.co/storage/v1/object/public/activity-voice/" + S.A + "/n1.webm"])
await sup("insert into storage.objects (bucket_id, name) values ('activity-voice','voice-flat.webm'), ('activity-voice','voice-orphan.webm'), ('activity-voice',$1), ('ecommerce-images','pic.png')", [S.A + "/n1.webm"])
const objs = async (who) => (await as(who, "select name from storage.objects where bucket_id='activity-voice' order by name")).rows.map((r) => r.name)
ok("BEFORE: anyone on the internet can read every voice note (finding F3)", (await objs("anon")).length === 3)
ok("BEFORE: anyone on the internet can upload any file", (await as("anon", "insert into storage.objects (bucket_id, name) values ('activity-voice','junk.exe') returning id")).rows.length === 1)
await sup("delete from storage.objects where name='junk.exe'")

await applyMigrations(["carehub_20261020_activity_voice_private.sql"])
const bucket = (await sup("select public, file_size_limit, allowed_mime_types from storage.buckets where id='activity-voice'")).rows[0]
ok("the bucket is private, capped at 10 MB, and audio only", bucket.public === false && Number(bucket.file_size_limit) === 10485760 && bucket.allowed_mime_types.every((m) => m.startsWith("audio/")), JSON.stringify(bucket))
ok("another bucket's policy was left alone", (await as("repA1", "select name from storage.objects where bucket_id='ecommerce-images'")).rows.length === 1)
ok("anonymous can read no voice note", (await objs("anon")).length === 0)
await expectError("anonymous cannot upload", () => as("anon", "insert into storage.objects (bucket_id, name) values ('activity-voice',$1)", [S.A + "/x.webm"]), "42501")
ok("a member can upload into their own company's folder", (await as("repA1", "insert into storage.objects (bucket_id, name) values ('activity-voice',$1) returning id", [S.A + "/new.webm"])).rows.length === 1)
ok("...and can read back what they just recorded, before any report points to it", (await objs("repA1")).includes(S.A + "/new.webm"))
ok("...but a colleague and a manager cannot, until a report points to it", !(await objs("repA2")).includes(S.A + "/new.webm") && !(await objs("mgrA")).includes(S.A + "/new.webm"))
await expectError("...but not into another company's folder", () => as("repA1", "insert into storage.objects (bucket_id, name) values ('activity-voice',$1)", [S.B + "/x.webm"]), "42501")
await expectError("...nor to the bucket's root (flat names were the guessable ones)", () => as("repA1", "insert into storage.objects (bucket_id, name) values ('activity-voice','voice-1.webm')"), "42501")
await expectError("...nor into a folder that is not a company id", () => as("repA1", "insert into storage.objects (bucket_id, name) values ('activity-voice','evil/x.webm')"), "42501")
ok("the author can read their report's voice note, old flat name and new folder name alike", (await objs("repA1")).includes("voice-flat.webm") && (await objs("repA1")).includes(S.A + "/n1.webm"))
ok("a colleague who cannot see the report cannot read its voice note", !(await objs("repA2")).includes("voice-flat.webm"))
await as("repA1", "insert into activity_viewers (activity_id, staff_id, viewer_name) values ($1,$2,'Rep Two')", [VOICE_ACT, S.repA2])
ok("once tagged on the report, the colleague can", (await objs("repA2")).includes("voice-flat.webm") && !(await objs("repA2")).includes(S.A + "/n1.webm"))
ok("a manager can read it, like the report itself", (await objs("mgrA")).includes("voice-flat.webm") && (await objs("mgrA")).includes(S.A + "/n1.webm"))
ok("another company cannot", (await objs("repB1")).length === 0 && (await objs("b")).length === 0)
ok("a file no report points to is readable by no member", !(await objs("mgrA")).includes("voice-orphan.webm") && !(await objs("repA1")).includes("voice-orphan.webm"))
ok("notes are records: no one deletes one", (await as("repA1", "delete from storage.objects where name='voice-flat.webm' returning id")).rows.length === 0)
ok("...and no one renames or replaces one", (await as("repA1", "update storage.objects set name='voice-moved.webm' where name='voice-flat.webm' returning id")).rows.length === 0)
await applyMigrations(["carehub_20261020_activity_voice_private.sql"], { rerun: false })
ok("the voice migration can be run twice and leaves exactly two policies on the bucket", (await sup("select count(*)::int c from pg_policies where schemaname='storage' and tablename='objects' and (coalesce(qual,'')||coalesce(with_check,'')) like '%activity-voice%'")).rows[0].c === 2)

// ---- F4/F6: log_field_activity, then U2: server-side alerts ---------------------------------------------------
await applyMigrations(["carehub_20261020_log_field_activity.sql"])
const LA = "55555555-5555-4555-8555-555555555551"
const payload = (over = {}) => JSON.stringify({ id: LA, business_id: S.A, staff_id: S.repA1, rep_name: "Rep One", values_json: "{}", lat: 6.5, lng: 3.4, location_label: "Ikeja", place_verified: false, ...over })
const viewersJson = JSON.stringify([{ staff_id: S.repA2, viewer_name: "Rep Two" }])
const logFn = (who, p, v = "[]") => as(who, "select log_field_activity($1::jsonb, $2::jsonb) r", [p, v]).then((r) => r.rows[0].r)
ok("PARITY: anonymous cannot call log_field_activity", await (async () => { try { await as("anon", "select log_field_activity('{}'::jsonb)"); return false } catch (e) { return e.code === "42501" } })())
const g1 = await logFn("repA1", payload(), viewersJson)
ok("saves the report and its viewer in one call", g1.created === true && g1.viewers_added === 1 && g1.id === LA, JSON.stringify(g1))
ok("...so the tagged colleague can already see it", (await seen("repA2")).includes(LA))
ok("without the alert triggers it says the app must still tell people itself", g1.alerts === "client")
const row = (await sup("select * from field_activities where id=$1", [LA])).rows[0]
ok("columns that have defaults keep them (created_at set, booleans false, not null)", row.created_at !== null && row.place_verified === false && row.facility_verified === false && row.facility_pending_review === false)
const g2 = await logFn("repA1", payload({ rep_name: "Edited retry" }), viewersJson)
ok("the same call again creates nothing, adds nobody, and cannot edit the report", g2.created === false && g2.viewers_added === 0 && (await sup("select rep_name from field_activities where id=$1", [LA])).rows[0].rep_name === "Rep One")
ok("...and there is one row and one viewer", (await sup("select count(*)::int c from field_activities where id=$1", [LA])).rows[0].c === 1 && (await sup("select count(*)::int c from activity_viewers where activity_id=$1", [LA])).rows[0].c === 1)
const NEW_ID = "55555555-5555-4555-8555-555555555552"
await expectError("a bad viewer rolls back the whole call: no half-saved report is left behind", () => logFn("repA1", payload({ id: NEW_ID }), JSON.stringify([{ staff_id: "not-a-uuid" }])), "22P02")
ok("...the activity row does not exist", (await sup("select count(*)::int c from field_activities where id=$1", [NEW_ID])).rows[0].c === 0)
await expectError("a rep cannot log as someone else through it", () => logFn("repA1", payload({ id: NEW_ID, staff_id: S.repA2 })), "42501")
await expectError("nor into another company", () => logFn("repA1", payload({ id: NEW_ID, business_id: S.B })), "42501")
await expectError("a colleague cannot tag themselves onto the report by repeating its id", () => logFn("repA2", payload({ staff_id: S.repA2 }), JSON.stringify([{ staff_id: S.mgrA, viewer_name: "M" }])), "42501")
await expectError("a payload that is not an object is refused", () => as("repA1", "select log_field_activity('[]'::jsonb)"), "22023")
await expectError("an id and business are required", () => as("repA1", "select log_field_activity('{\"rep_name\":\"x\"}'::jsonb)"), "22023")
ok("the owner can log through it with no staff id", (await logFn("a", payload({ id: "55555555-5555-4555-8555-555555555553", staff_id: null }))).created === true)

await applyMigrations(["carehub_20261020_activity_server_alerts.sql"])
// Start from an empty inbox: the policy section above left rows behind that are not about alerts.
await sup("delete from staff_notifications")
const notes = async (staffId) => (await sup("select kind, title, body, link, is_owner from staff_notifications where staff_id=$1 order by created_at", [staffId])).rows
const AL = "55555555-5555-4555-8555-555555555554"
const g3 = await logFn("repA1", payload({ id: AL, rep_name: "Rep One", location_label: "Allen Ave" }), JSON.stringify([{ staff_id: S.repA2, viewer_name: "Rep Two" }, { staff_id: S.repA1, viewer_name: "Me" }]))
ok("with the triggers in place the function reports server-side alerts", g3.alerts === "server")
const n2 = await notes(S.repA2)
ok("the tagged colleague is alerted by the database, once, with the report's details", n2.length === 1 && n2[0].kind === "activity" && n2[0].title === "Rep One logged field activity" && n2[0].body === "Allen Ave" && n2[0].link === "activity" && n2[0].is_owner === false, JSON.stringify(n2))
ok("...and can read their own alert", (await as("repA2", "select id from staff_notifications")).rows.length === 1)
ok("the author tagging themselves is not alerted about their own report", (await notes(S.repA1)).length === 0)
await logFn("repA1", payload({ id: AL }), JSON.stringify([{ staff_id: S.repA2, viewer_name: "Rep Two" }]))
ok("a retry adds no viewer row and so sends no second alert", (await notes(S.repA2)).length === 1)
await sup("update staff set status='inactive' where id=$1", [S.mgrA])
await as("repA1", "insert into activity_viewers (activity_id, staff_id, viewer_name) values ($1,$2,'Mgr')", [AL, S.mgrA])
ok("an inactive member is not alerted", (await notes(S.mgrA)).length === 0)
await sup("update staff set status='active' where id=$1", [S.mgrA])
await as("repA1", "insert into activity_viewers (activity_id, staff_id, viewer_name) values ($1,$2,'B rep')", [AL, S.repB1])
ok("someone from another company is not alerted", (await notes(S.repB1)).length === 0)

await as("repA2", "insert into activity_comments (activity_id, staff_id, actor_name, body) values ($1,$2,'Rep Two','nice work')", [AL, S.repA2])
const n1 = await notes(S.repA1)
ok("a reply alerts the report's author, with the reply text", n1.length === 1 && n1[0].kind === "activity_comment" && n1[0].title === "Rep Two replied to your activity" && n1[0].body === "nice work", JSON.stringify(n1))
await as("repA1", "insert into activity_comments (activity_id, staff_id, actor_name, body) values ($1,$2,'Rep One','thanks')", [AL, S.repA1])
ok("replying to your own report alerts nobody", (await notes(S.repA1)).length === 1)
await as("a", "insert into activity_comments (activity_id, staff_id, actor_name, body) values ($1,NULL,'Owner','well done')", [AL])
ok("the owner replying (no staff id) alerts the rep", (await notes(S.repA1)).length === 2)
const ownerReport = "55555555-5555-4555-8555-555555555553"
const inboxBefore = (await sup("select count(*)::int c from staff_notifications")).rows[0].c
await as("mgrA", "insert into activity_comments (activity_id, staff_id, actor_name, body) values ($1,$2,'Mgr','seen')", [ownerReport, S.mgrA])
ok("a reply on a report written by the owner (no staff author) alerts nobody and does not break the reply", (await sup("select count(*)::int c from staff_notifications")).rows[0].c === inboxBefore && (await sup("select count(*)::int c from activity_comments where activity_id=$1", [ownerReport])).rows[0].c === 1)
await expectError("an uninvolved colleague still cannot reply to a report they cannot see, with or without the alert triggers", () => as("repA2", "insert into activity_comments (activity_id, staff_id, actor_name, body) values ($1,$2,'Rep Two','hi')", [ownerReport, S.repA2]), "42501")
const aclOf = async (fn) => (await sup("select has_function_privilege('anon', $1::regprocedure, 'execute') a, has_function_privilege('authenticated', $1::regprocedure, 'execute') u", [fn])).rows[0]
for (const fn of ["public.alert_activity_viewer()", "public.alert_activity_comment()"]) {
  const r = await aclOf(fn)
  ok("ACL " + fn + ": nobody can call a trigger function directly", r.a === false && r.u === false, JSON.stringify(r))
}
const lfAcl = await aclOf("public.log_field_activity(jsonb, jsonb)")
ok("ACL log_field_activity: signed-in yes, anonymous no", lfAcl.a === false && lfAcl.u === true, JSON.stringify(lfAcl))

finish()
