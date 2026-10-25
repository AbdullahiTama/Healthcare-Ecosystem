// is_platform_admin() with branches (draft carehub_20261211_is_platform_admin_branch_safe). Branches share their
// owner's email; the old scalar subquery raised 21000 for any owner with a branch, breaking every policy calling it.
//   REPO_ROOT=<repo> node isPlatformAdmin.pglite.mjs
import { ok, finish, as, sup, db, applyMigrations } from './_harness.mjs'

const A = (await sup("select id from businesses where email='a@x.test'")).rows[0].id
const B = (await sup("select id from businesses where email='b@x.test'")).rows[0].id
const ADM = (await sup("select id from businesses where email='admin@x.test'")).rows[0].id
await db.exec('GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated; GRANT EXECUTE ON FUNCTION public.current_business_ids() TO authenticated;')
const adminFor = async (who) => (await as(who, 'select public.is_platform_admin() v')).rows[0].v

// An owner adds a branch (same email, as Locations.jsx does).
await sup("insert into businesses (email, name, parent_business_id) values ('a@x.test', 'Company A · Yaba', $1)", [A])

let before = ''
try { await adminFor('a') } catch (e) { before = e.code }
ok('BEFORE: an owner with a branch makes is_platform_admin() fail (21000), which breaks every policy calling it', before === '21000', before)

await applyMigrations(['carehub_20261211_is_platform_admin_branch_safe.sql'])

ok('AFTER: an owner with a branch is answered (not an admin), no error', (await adminFor('a')) === false)
ok('AFTER: an owner without branches is unchanged', (await adminFor('b')) === false)
ok('AFTER: the platform admin is still an admin', (await adminFor('admin')) === true)
await sup("insert into businesses (email, name, parent_business_id) values ('admin@x.test', 'Platform · Branch', $1)", [ADM])
ok('AFTER: a platform admin who also has a branch is still an admin', (await adminFor('admin')) === true)
await sup("insert into businesses (email, name, parent_business_id, is_platform_admin) values ('b@x.test', 'Company B · Forged', $1, true)", [B])
ok('AFTER: a branch row carrying the flag never makes its owner an admin (only main businesses count)', (await adminFor('b')) === false)
ok('AFTER: anyone with no business is not an admin', (await adminFor('outsider')) === false)
ok('AFTER: the owner\'s business list (current_business_ids) still includes the main business and its branch', (await as('a', 'select count(*)::int c from public.current_business_ids()')).rows[0].c === 2)
const acl = (await sup("select has_function_privilege('anon','public.is_platform_admin()','execute') a, has_function_privilege('authenticated','public.is_platform_admin()','execute') u, (select prosecdef from pg_proc where proname='is_platform_admin') d")).rows[0]
ok('AFTER: still SECURITY DEFINER, callable by signed-in users, not by anon', acl.d === true && acl.u === true && acl.a === false, JSON.stringify(acl))

finish()
