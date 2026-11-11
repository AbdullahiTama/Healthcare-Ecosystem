// Purchases export audit (carehub_20270115_purchase_export_audit). See _harness.mjs for scope and limits.
//   node scripts/db-tests/purchaseExportAudit.pglite.mjs
// The previous definition (carehub_20261209) is applied first, then this migration over it, as in production.
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, USERS } from './_harness.mjs'

await db.exec(`CREATE TABLE public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, permissions jsonb);`)
await applyMigrations(['carehub_20260810_audit_log.sql'], { rerun: false })
await db.exec(`GRANT ALL ON public.audit_log TO anon, authenticated;`)
await applyMigrations(['carehub_20261209_record_export_audit.sql'], { rerun: false })

const S = await seedStaff()
await db.query(`insert into staff (business_id,email,role,full_name,status) values ($1,'auditor@a.test','Auditor','Au Ditor','active'),($1,'nox@a.test','NoExport','No Export','active')`, [S.A])
await db.query(`insert into roles (business_id,name,permissions) values ($1,'Auditor','{"canExportReports": true}'),($1,'NoExport','{"canExportReports": false}')`, [S.A])
Object.assign(USERS, {
  auditor: { sub: '00000000-0000-0000-0000-0000000000f1', email: 'auditor@a.test' },
  nox: { sub: '00000000-0000-0000-0000-0000000000f2', email: 'nox@a.test' },
})
const call = (who, biz, type, n = 3) => as(who, 'select record_export_audit($1,$2,$3,$4::jsonb) as id', [biz, type, n, '{"search_applied":false}']).then((r) => r.rows[0].id)

// The reported problem: before this migration a purchases export is refused as an unknown type.
await expectError('before: purchases.csv is an unknown export type', () => call('a', S.A, 'purchases.csv'), '22023')

await applyMigrations(['carehub_20270115_purchase_export_audit.sql'])

for (const type of ['purchases.xlsx', 'purchases.csv']) {
  const id = await call('a', S.A, type)
  const row = (await sup('select * from audit_log where id=$1', [id])).rows[0]
  ok(`${type}: the Owner's export is recorded, as cost data`, row.actor_type === 'owner' && row.target_type === 'purchases' && row.metadata.export_type === type && row.metadata.includes_cost_data === true && row.metadata.row_count === 3, JSON.stringify(row.metadata))
}
const idAud = await call('auditor', S.A, 'purchases.csv')
ok('a role with "Export reports" can export purchases, as staff', (await sup('select actor_type from audit_log where id=$1', [idAud])).rows[0].actor_type === 'staff')

const before = (await sup('select count(*)::int c from audit_log')).rows[0].c
await expectError('a role without "Export reports" is refused', () => call('nox', S.A, 'purchases.csv'), '42501')
await expectError('a built-in role with no export permission is refused', () => call('repA1', S.A, 'purchases.xlsx'), '42501')
await expectError('another company cannot record for this one', () => call('b', S.A, 'purchases.csv'), '42501')
await expectError('anonymous is refused', () => call('anon', S.A, 'purchases.csv'), '42501')
ok('refusals wrote nothing', (await sup('select count(*)::int c from audit_log')).rows[0].c === before)

// Unchanged behaviour.
await expectError('an unknown type is still refused', () => call('a', S.A, 'purchases.pdf'), '22023')
const inv = await call('a', S.A, 'inventory.xlsx')
ok('inventory.xlsx still recorded as cost data', (await sup('select metadata from audit_log where id=$1', [inv])).rows[0].metadata.includes_cost_data === true)
ok('anon still cannot execute it', (await sup(`select has_function_privilege('anon','record_export_audit(uuid,text,integer,jsonb)','execute') as x`)).rows[0].x === false)

finish()
