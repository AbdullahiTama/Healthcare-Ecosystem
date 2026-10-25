// Export-audit database tests. See _harness.mjs for scope and limits.
//   node scripts/db-tests/exportAudit.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, USERS } from './_harness.mjs'

// `roles` is a stand-in with the live columns; audit_log is applied from its real original migration,
// then given the permissive default grants Supabase hands out, as seen live on 2026-10-25.
await db.exec(`CREATE TABLE public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, permissions jsonb);`)
await applyMigrations(['carehub_20260810_audit_log.sql'], { rerun: false })
await db.exec(`GRANT ALL ON public.audit_log TO anon, authenticated;`)
await applyMigrations(['carehub_20261209_record_export_audit.sql'])

const S = await seedStaff() // { A, B, repA1, repA2, mgrA, repB1 }
await db.query(`insert into staff (business_id,email,role,full_name,status) values ($1,'auditor@a.test','Auditor','Au Ditor','active'),($1,'nox@a.test','NoExport','No Export','active'),($1,'boss@a.test','Owner','Boss','active'),($1,'gone@a.test','Auditor','Gone','inactive')`, [S.A])
await db.query(`insert into roles (business_id,name,permissions) values ($1,'Auditor','{"canExportReports": true}'),($1,'NoExport','{"canExportReports": false}'),($1,'Regional Manager','{"canViewReports": true}')`, [S.A])
Object.assign(USERS, {
  auditor: { sub: '00000000-0000-0000-0000-0000000000f1', email: 'auditor@a.test' },
  nox: { sub: '00000000-0000-0000-0000-0000000000f2', email: 'nox@a.test' },
  boss: { sub: '00000000-0000-0000-0000-0000000000f3', email: 'boss@a.test' },
  gone: { sub: '00000000-0000-0000-0000-0000000000f4', email: 'gone@a.test' },
})
const call = (who, biz, type = 'inventory.xlsx', n = 12, filters = { category: 'Medicines' }) =>
  as(who, 'select record_export_audit($1,$2,$3,$4::jsonb) as id', [biz, type, n, JSON.stringify(filters)]).then((r) => r.rows[0].id)
const count = async () => (await sup('select count(*)::int c from audit_log')).rows[0].c

// ---- allowed ---------------------------------------------------------------------------------
const id1 = await call('a', S.A)
const row = (await sup('select * from audit_log where id=$1', [id1])).rows[0]
ok('owner export is recorded against their own identity', row.actor_id === USERS.a.sub && row.actor_type === 'owner' && row.branch_id === S.A && row.action === 'export.created' && row.target_type === 'inventory', JSON.stringify(row))
ok('metadata carries type, row count, filters, email (from the JWT) and cost-data flag',
  row.metadata.export_type === 'inventory.xlsx' && row.metadata.row_count === 12 && row.metadata.filters.category === 'Medicines' && row.metadata.actor_email === 'a@x.test' && row.metadata.includes_cost_data === true, JSON.stringify(row.metadata))
ok('created_at is the server clock', Math.abs(new Date(row.created_at) - Date.now()) < 60000)

const idAud = await call('auditor', S.A)
ok('staff on a custom role with canExportReports=true can record, as staff',
  (await sup('select actor_type, metadata from audit_log where id=$1', [idAud])).rows[0].actor_type === 'staff')
await call('boss', S.A)
ok('staff whose role is Owner can record (getPerms: Owner always)', (await count()) === 3)

// ---- refused, and nothing written ------------------------------------------------------------
const before = await count()
await expectError('staff on a custom role with canExportReports=false is refused', () => call('nox', S.A), '42501')
await expectError('built-in role name with no export permission is refused', () => call('repA1', S.A), '42501')
await expectError('custom role that lacks the flag entirely is refused', () => call('mgrA', S.A), '42501')
await expectError('inactive staff member is refused', () => call('gone', S.A), '42501')
await expectError('rep cannot record into another company (forged business id)', () => call('repA1', S.B), '42501')
await expectError('company B owner cannot record for company A', () => call('b', S.A), '42501')
await expectError('outsider is refused', () => call('outsider', S.A), '42501')
await expectError('anonymous is refused', () => call('anon', S.A), '42501')
ok('refusals wrote nothing', (await count()) === before)

// ---- an owner working inside a branch ---------------------------------------------------------
const branch = (await db.query(`insert into businesses (name,email,parent_business_id) values ('A Branch','branch@a.test',$1) returning id`, [S.A])).rows[0].id
const idBranch = await call('a', branch)
ok('owner of the parent business can record for a branch, as owner',
  (await sup('select actor_type, branch_id from audit_log where id=$1', [idBranch])).rows[0].actor_type === 'owner')
await expectError('another company owner still cannot record for that branch', () => call('b', branch), '42501')
await expectError('a parent-business STAFF member (not owner) is not promoted to owner on a branch', () => call('nox', branch), '42501')

// ---- validation -------------------------------------------------------------------------------
await expectError('unknown export type refused', () => call('a', S.A, 'patients.csv'), '22023')
await expectError('negative row count refused', () => call('a', S.A, 'inventory.xlsx', -1), '22023')
await expectError('null row count refused', () => call('a', S.A, 'inventory.xlsx', null), '22023')
await expectError('filters must be an object', () => call('a', S.A, 'inventory.xlsx', 1, [1, 2]), '22023')
await expectError('oversized filters refused', () => call('a', S.A, 'inventory.xlsx', 1, { q: 'x'.repeat(3000) }), '22023')
ok('zero rows is a valid export record', !!(await call('a', S.A, 'inventory.xlsx', 0, {})))

// ---- the table itself: append-only, no client writes ------------------------------------------
await expectError('signed-in users cannot INSERT directly', () => as('a', `insert into audit_log (actor_id,branch_id,action) values ($1,$2,'x')`, [USERS.a.sub, S.A]), '42501')
await expectError('signed-in users cannot UPDATE', () => as('a', `update audit_log set action='edited'`), '42501')
await expectError('signed-in users cannot DELETE', () => as('a', `delete from audit_log`), '42501')
await expectError('signed-in users cannot TRUNCATE', () => as('a', `truncate audit_log`), '42501')
await expectError('anonymous cannot read', () => as('anon', `select * from audit_log`), '42501')
await expectError('even the table owner cannot UPDATE (append-only trigger)', () => sup(`update audit_log set action='edited'`), 'append-only')
await expectError('even the table owner cannot DELETE (append-only trigger)', () => sup(`delete from audit_log`), 'append-only')
await expectError('even the table owner cannot TRUNCATE (append-only trigger)', () => sup(`truncate audit_log`), 'append-only')

// ---- who can read it ---------------------------------------------------------------------------
ok('company A owner can read its own audit rows', (await as('a', 'select id from audit_log')).rows.length >= 4)
ok('company B cannot see company A rows', (await as('b', 'select id from audit_log')).rows.length === 0)
ok('record_export_audit is not executable by anonymous', (await sup(`select has_function_privilege('anon','record_export_audit(uuid,text,integer,jsonb)','execute') as x`)).rows[0].x === false)

finish()
