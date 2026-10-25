// Branches without a sign-in email (draft carehub_20261212_branches_without_email; owner's option A, 2026-10-25).
//   REPO_ROOT=<repo> node branchEmail.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff } from './_harness.mjs'

// Live shape of businesses.email and the two live ownership checks this draft changes (pg_get_functiondef, 2026-10-25).
await db.exec(`
  ALTER TABLE public.staff ADD COLUMN auth_user_id uuid;
  -- The live current_business_ids(): the businesses the caller owns or works at, and their branches down the tree.
  ALTER TABLE public.businesses ADD COLUMN branch_depth_limit integer DEFAULT 5;
  CREATE OR REPLACE FUNCTION public.current_business_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH RECURSIVE visible AS (
      SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b WHERE lower(b.email) = lower(auth.email())
      UNION
      SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b INNER JOIN staff s ON s.business_id = b.id
       WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'
      UNION ALL
      SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1
        FROM businesses child INNER JOIN visible ON child.parent_business_id = visible.id
       WHERE visible.depth < visible.branch_depth_limit
    )
    SELECT DISTINCT id FROM visible $$;
  ALTER TABLE public.businesses ALTER COLUMN email SET NOT NULL;
  ALTER TABLE public.businesses ADD CONSTRAINT businesses_email_key UNIQUE (email);
  GRANT SELECT, INSERT, UPDATE ON public.businesses TO authenticated;
  GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
  CREATE OR REPLACE FUNCTION public.orders_caller_is_owner(bid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = bid AND lower(b.email) = lower(auth.email())) $$;
  CREATE OR REPLACE FUNCTION public.can_access_adr_report_row(p_business_id uuid, p_created_by_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT is_platform_admin()
      OR p_business_id IN (SELECT id FROM businesses WHERE lower(email) = lower(auth.email()))
      OR p_business_id IN (SELECT s.business_id FROM staff s WHERE s.status = 'active' AND lower(s.email) = lower(auth.email()) AND s.role IN ('Manager', 'Owner'))
      OR (p_created_by_user_id IS NOT NULL AND p_created_by_user_id IN (SELECT s.id FROM staff s WHERE s.status = 'active' AND lower(s.email) = lower(auth.email()))) $$;
  GRANT EXECUTE ON FUNCTION public.orders_caller_is_owner(uuid), public.can_access_adr_report_row(uuid, uuid) TO authenticated;
`)
const S = await seedStaff()
const addBranch = (who, email, parent = S.A) => as(who, "insert into businesses (name, email, parent_business_id) values ('Company A · Yaba', $1, $2) returning id", [email, parent])

let before = ''
try { await addBranch('a', 'a@x.test') } catch (e) { before = e.code }
ok('BEFORE: a branch with the owner\'s email is refused (unique email), which is why nobody could add a branch', before === '23505', before)
before = ''
try { await addBranch('a', null) } catch (e) { before = e.code }
ok('BEFORE: and a branch without an email is refused too (NOT NULL)', before === '23502', before)

await applyMigrations(['carehub_20261212_branches_without_email.sql'])

const Y = (await addBranch('a', null)).rows[0].id
ok('AFTER: the owner adds a branch with no email', !!Y)
await expectError('AFTER: a branch cannot be given the owner\'s email', () => addBranch('a', 'a@x.test'), '42501')
await expectError('AFTER: nor someone else\'s (it would make them an owner of the branch)', () => addBranch('a', 'mgr@a.test'), '42501')
await expectError('AFTER: nor can a branch be given an email later', () => as('a', "update businesses set email='mgr@a.test' where id=$1", [Y]), '42501')
await expectError('AFTER: a main business still needs an email', () => sup("insert into businesses (name, email) values ('No Email Ltd', null)"), '23514')
ok('AFTER: a platform admin can still correct a branch\'s email if ever needed', (await as('admin', "update businesses set email='branch-fix@x.test' where id=$1 returning id", [Y])).rows.length === 1)
await sup('update businesses set email=null where id=$1', [Y])

const owns = async (who, fn, bid) => (await as(who, `select public.${fn}($1${fn === 'can_access_adr_report_row' ? ', null' : ''}) v`, [bid])).rows[0].v
ok('AFTER: the owner of the main business owns its branch (orders approval)', await owns('a', 'orders_caller_is_owner', Y))
ok('AFTER: and reads the branch\'s ADR reports', await owns('a', 'can_access_adr_report_row', Y))
ok('AFTER: and still owns the main business itself', await owns('a', 'orders_caller_is_owner', S.A) && await owns('a', 'can_access_adr_report_row', S.A))
ok('AFTER: another company\'s owner does not', !(await owns('b', 'orders_caller_is_owner', Y)) && !(await owns('b', 'can_access_adr_report_row', Y)))
ok('AFTER: a rep of the company is not an owner of the branch', !(await owns('repA1', 'orders_caller_is_owner', Y)))
ok('AFTER: someone with no business is not', !(await owns('outsider', 'orders_caller_is_owner', Y)))
const K = (await as('admin', "insert into businesses (name, email, parent_business_id) values ('Company A · Yaba kiosk', null, $1) returning id", [Y])).rows[0].id
ok('AFTER: a branch of a branch belongs to the same owner', await owns('a', 'orders_caller_is_owner', K))
ok('AFTER: the owner\'s business list still includes the main business and its branches', (await as('a', 'select count(*)::int c from public.current_business_ids()')).rows[0].c === 3)
ok('AFTER: is_platform_admin() is unaffected for an owner with branches', (await as('a', 'select public.is_platform_admin() v')).rows[0].v === false)
const acl = (await sup("select has_function_privilege('anon','public.caller_owns_business(uuid)','execute') a, has_function_privilege('authenticated','public.caller_owns_business(uuid)','execute') u")).rows[0]
ok('AFTER: caller_owns_business is for signed-in users only', !acl.a && acl.u, JSON.stringify(acl))

finish()
