// Branches follow their main business's plan (draft carehub_20261210_branch_plan_follows_parent).
//   REPO_ROOT=<repo> node branchPlan.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations } from './_harness.mjs'

await db.exec(`
  ALTER TABLE public.businesses ADD COLUMN status text DEFAULT 'active', ADD COLUMN plan text, ADD COLUMN plan_expires_at timestamptz;
  -- A stand-in for the live guard: plan and expiry are platform-admin-only for signed-in callers, trusted for the
  -- table owner (and so for SECURITY DEFINER functions owned by it).
  CREATE FUNCTION public.guard_plan_columns() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user IN ('postgres', 'service_role') OR public.is_platform_admin() THEN RETURN NEW; END IF;
    IF NEW.plan IS DISTINCT FROM OLD.plan OR NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at THEN
      RAISE EXCEPTION 'Only a platform administrator can change these fields on a business: plan' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER guard_business_privileged_columns BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.guard_plan_columns();
  GRANT SELECT, UPDATE ON public.businesses TO authenticated;
`)
const A = (await sup("select id from businesses where email='a@x.test'")).rows[0].id
const B = (await sup("select id from businesses where email='b@x.test'")).rows[0].id
await sup("update businesses set plan='pro', plan_expires_at='2026-11-01' where id in ($1,$2)", [A, B])
const branch = async (parent, name) => (await sup("insert into businesses (email, name, parent_business_id, plan, plan_expires_at) values (null, $2, $1, 'pro', '2026-11-01') returning id", [parent, name])).rows[0].id
const Y = await branch(A, 'Yaba')
const K = await branch(Y, 'Yaba kiosk')
// One branch already out of step before the migration (the bug as it stands).
await sup("update businesses set plan_expires_at='2026-10-01' where id=$1", [Y])
const planOf = async (id) => (await sup('select plan, plan_expires_at::date::text exp from businesses where id=$1', [id])).rows[0]

await applyMigrations(['carehub_20261210_branch_plan_follows_parent.sql'])

ok('backfill: an out-of-step branch is brought in line with its main business', (await planOf(Y)).exp === '2026-11-01')

await as('admin', "update businesses set plan_expires_at='2027-11-01' where id=$1", [A])
ok('a renewal of the main business reaches its branch', (await planOf(Y)).exp === '2027-11-01')
ok('and the branch of that branch', (await planOf(K)).exp === '2027-11-01')
ok('another business is untouched', (await planOf(B)).exp === '2026-11-01')

await as('admin', "update businesses set plan='enterprise' where id=$1", [A])
ok('a plan change on the main business reaches every branch', (await planOf(Y)).plan === 'enterprise' && (await planOf(K)).plan === 'enterprise')

await as('admin', "update businesses set plan='basic' where id=$1", [Y])
ok('a platform admin changing a branch by hand does not cascade upwards or sideways', (await planOf(A)).plan === 'enterprise' && (await planOf(K)).plan === 'enterprise' && (await planOf(Y)).plan === 'basic')

await expectError('the owner still cannot change their own plan (the guard holds; the cascade grants nothing)', () => as('a', "update businesses set plan='enterprise_plus' where id=$1", [A]), '42501')
await expectError('nor a branch\'s plan', () => as('a', "update businesses set plan='enterprise_plus' where id=$1", [Y]), '42501')

await sup("update businesses set name='Renamed' where id=$1", [A])
ok('an update that does not touch the plan changes nothing on the branches', (await planOf(Y)).plan === 'basic')

const acl = (await sup("select has_function_privilege('authenticated','public.businesses_branch_plan_follows_parent()','execute') u, has_function_privilege('anon','public.businesses_branch_plan_follows_parent()','execute') a")).rows[0]
ok('nobody calls the cascade directly', !acl.u && !acl.a, JSON.stringify(acl))

finish()
