// Staff privilege and tenant-isolation database tests. See _harness.mjs for scope and limits.
// The permissive policies are copied from sql/phase2_rls_pilot.sql; the live ones may differ.
//   node scripts/db-tests/staff.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, USERS } from './_harness.mjs'

await db.exec(`
  CREATE TABLE public.facilities_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, source text);
  CREATE TABLE public.rep_added_facilities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, status text);
  CREATE TABLE public.territories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text);
  CREATE TABLE public.rep_territories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid, territory_id uuid);
  GRANT ALL ON public.staff, public.territories, public.rep_territories, public.field_activities TO authenticated;

  ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "staff of own business" ON staff FOR ALL
    USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
    WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  ALTER TABLE territories ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "territories of own business" ON territories FOR ALL
    USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
    WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  ALTER TABLE rep_territories ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "rep_territories via parent territories" ON rep_territories FOR ALL
    USING (is_platform_admin() OR territory_id IN (SELECT id FROM territories WHERE business_id IN (SELECT current_business_ids())))
    WITH CHECK (is_platform_admin() OR territory_id IN (SELECT id FROM territories WHERE business_id IN (SELECT current_business_ids())));
`)
await applyMigrations(['carehub_20260823_facility_review_authorization.sql'], { rerun: false })
await applyMigrations(['carehub_20261123_staff_checkins.sql'], { rerun: false })

const S = await seedStaff()
const terrA = (await sup("insert into territories (business_id, name) values ($1,'A North') returning id", [S.A])).rows[0].id
const terrB = (await sup("insert into territories (business_id, name) values ($1,'B North') returning id", [S.B])).rows[0].id

// ---- tenant isolation (should already hold) ---------------------------------------------------
const names = async (who) => (await as(who, 'select full_name from staff')).rows.map((r) => r.full_name).sort()
ok('company A staff list contains only company A people', (await names('repA1')).join() === 'Manager A,Rep One,Rep Two', (await names('repA1')).join())
ok('company B cannot list company A staff', (await names('repB1')).join() === 'Rep B' && (await names('b')).join() === 'Rep B')
ok('company A owner cannot list company B staff', (await names('a')).every((n) => n !== 'Rep B'))
await expectError('a rep cannot add themselves to another company\'s staff', () => as('repA1', `insert into staff (business_id,email,role,full_name) values ($1,$2,'Sales Rep','x')`, [S.B, USERS.repA1.email]), '42501')
await expectError('a rep cannot be assigned to another company\'s territory', () => as('repA1', 'insert into rep_territories (staff_id, territory_id) values ($1,$2)', [S.repA1, terrB]), '42501')
ok('company B cannot see company A rep assignments', (await as('repB1', 'select 1 from rep_territories')).rows.length === 0)
await expectError('anonymous cannot read staff', () => as('anon', 'select 1 from staff'), '42501')

// ---- BEFORE: privilege escalation ------------------------------------------------------------
const promote = await as('repA1', `update staff set role='Regional Manager' where id=$1 returning role`, [S.repA1])
ok('BEFORE: a plain rep can promote themselves to a manager role (finding S8)', promote.rows.length === 1 && promote.rows[0].role === 'Regional Manager')
const seesTeam = await as('repA1', 'select manager_checkin_overview($1) r', [S.A]).then((r) => r.rows[0].r.rows.length >= 3, () => false)
ok('BEFORE: ...which gives them the whole team\'s check-in locations', seesTeam)
await sup("update staff set role='Sales Rep' where id=$1", [S.repA1])
const inserted = await as('repA2', `insert into staff (business_id,email,role,full_name) values ($1,'new@a.test','Regional Manager','Planted') returning id`, [S.A])
ok('BEFORE: a plain rep can create a manager account', inserted.rows.length === 1)
await sup("delete from staff where email='new@a.test'")

await applyMigrations(['carehub_20261126_staff_privilege_guard.sql'])

// ---- AFTER ----------------------------------------------------------------------------------
await expectError('a rep cannot change their own role', () => as('repA1', `update staff set role='Regional Manager' where id=$1`, [S.repA1]), '42501')
await expectError('a rep cannot change a colleague\'s role', () => as('repA1', `update staff set role='Regional Manager' where id=$1`, [S.repA2]), '42501')
await expectError('a rep cannot reactivate or change status', () => as('repA1', `update staff set status='inactive' where id=$1`, [S.repA2]), '42501')
await expectError('a rep cannot change an email (identity)', () => as('repA1', `update staff set email='mgr@a.test' where id=$1`, [S.repA1]), '42501')
await expectError('a rep cannot move a staff row to another company', () => as('repA1', `update staff set business_id=$2 where id=$1`, [S.repA1, S.B]), '42501')
await expectError('a rep cannot create staff, even non-manager ones', () => as('repA2', `insert into staff (business_id,email,role,full_name) values ($1,'new@a.test','Sales Rep','x')`, [S.A]), '42501')
ok('a rep cannot delete staff (the row is hidden from DELETE and survives)', (await as('repA1', 'delete from staff where id=$1 returning id', [S.repA2])).rows.length === 0 && (await sup('select 1 from staff where id=$1', [S.repA2])).rows.length === 1)
ok('a rep can still edit harmless fields on their own row', (await as('repA1', `update staff set full_name='Rep One (Lagos)' where id=$1 returning id`, [S.repA1])).rows.length === 1)
ok('a manager can still manage staff of their own company', (await as('mgrA', `update staff set role='Pharmacist' where id=$1 returning id`, [S.repA2])).rows.length === 1)
ok('the owner can still add staff', (await as('a', `insert into staff (business_id,email,role,full_name) values ($1,'ok@a.test','Sales Rep','New Hire') returning id`, [S.A])).rows.length === 1)
await expectError('a manager cannot move staff into another company', () => as('mgrA', `update staff set business_id=$2 where id=$1`, [S.repA2, S.B]), '42501')
await expectError('a company B owner cannot edit company A staff roles', () => as('b', `update staff set role='X' where id=$1`, [S.repA1]).then((r) => { if (!r.rows.length) throw Object.assign(new Error('0 rows'), { code: '42501' }) }), '42501')
ok('platform admin can still administer any staff row', (await as('admin', `update staff set role='Sales Rep' where id=$1 returning id`, [S.repA2])).rows.length === 1)
await sup("update staff set role='Sales Rep' where id=$1", [S.repA1])
const stillNoTeam = await as('repA1', 'select manager_checkin_overview($1) r', [S.A]).then(() => false, (e) => e.code === '42501')
ok('after the fix a rep cannot read the team overview', stillNoTeam)
await db.exec("select set_config('request.jwt.claims','',false)") // no end user, like the service role
ok('server-side provisioning (no end-user context) is not blocked', await sup(`update staff set role='Pharmacist' where id=$1`, [S.repA2]).then(() => true, () => false))

finish()
