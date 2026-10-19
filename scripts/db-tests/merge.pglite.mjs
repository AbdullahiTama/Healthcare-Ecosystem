// Reviewed import-merge database tests. See _harness.mjs for scope and limits.
//   node scripts/db-tests/merge.pglite.mjs
import { ok, expectError, finish, as, sup, applyMigrations, ADMIN } from './_harness.mjs'

await applyMigrations([
  'carehub_20261120_business_directory.sql',
  'carehub_20261121_directory_imports.sql',
  'carehub_20261128_directory_import_merge.sql',
])

const mk = async (name, cols = {}) => (await as('admin',
  `insert into directory_businesses (name, address, city, state, phone, email, latitude, longitude, description)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
  [name, cols.address ?? null, cols.city ?? null, cols.state ?? null, cols.phone ?? null, cols.email ?? null, cols.lat ?? null, cols.lng ?? null, cols.description ?? null])).rows[0]
const merge = (who, id, ref, changes) => as(who, 'select directory_merge_import_row($1,$2,$3::jsonb) r', [id, ref, JSON.stringify(changes)]).then((r) => r.rows[0].r)
const row = async (id) => (await sup('select * from directory_businesses where id=$1', [id])).rows[0]
const fill = (value) => ({ value, mode: 'fill' })
const over = (value) => ({ value, mode: 'overwrite' })

const r1 = await mk('Alpha Pharmacy', { address: '12 Allen Ave', state: 'Lagos' })
const r2 = await mk('Verified Clinic', { address: 'Old Road', state: 'Lagos' })
await as('admin', "select directory_set_verification($1,'verified','CAC checked')", [r2.id])
const verifiedBy = (await row(r2.id)).verified_by

// ---- authorisation -------------------------------------------------------------------------
await expectError('a company user cannot merge', () => merge('a', r1.id, 'fp:2', { city: fill('Ikeja') }), '42501')
await expectError('a rep cannot merge', () => merge('repA1', r1.id, 'fp:2', { city: fill('Ikeja') }), '42501')
await expectError('anonymous cannot merge', () => merge('anon', r1.id, 'fp:2', { city: fill('Ikeja') }), '42501')
ok('a refused merge changed nothing and left no log', (await row(r1.id)).city === null && (await sup('select count(*)::int c from directory_import_merges')).rows[0].c === 0)

// ---- fill blanks ---------------------------------------------------------------------------
const m1 = await merge('admin', r1.id, 'fpA:2', { city: fill('Ikeja'), phone: fill('+234 803 123 4567'), email: fill('info@alpha.test'), address: fill('Different Street') })
const a1 = await row(r1.id)
ok('blank fields are filled', a1.city === 'Ikeja' && a1.email === 'info@alpha.test' && m1.applied.city === 'Ikeja', JSON.stringify(m1))
ok('the phone normaliser ran on the merged phone', a1.phone_normalized === '8031234567')
ok('an existing value is kept when only "fill" is asked', a1.address === '12 Allen Ave' && m1.skipped.some((s) => s.field === 'address' && s.reason === 'existing_value_kept'), JSON.stringify(m1.skipped))
ok('the report says exactly what was applied and skipped', Object.keys(m1.applied).sort().join() === 'city,email,phone' && m1.alreadyMerged === false)

// ---- explicit overwrite --------------------------------------------------------------------
const m2 = await merge('admin', r1.id, 'fpA:3', { address: over('99 New Street') })
ok('an unverified record can be overwritten when the reviewer asks', (await row(r1.id)).address === '99 New Street' && m2.applied.address === '99 New Street')
const m2b = await merge('admin', r1.id, 'fpA:4', { city: over('ikeja') })
ok('an identical value (ignoring case) is skipped as "same"', m2b.skipped.some((s) => s.field === 'city' && s.reason === 'same') && (await row(r1.id)).city === 'Ikeja')

// ---- verified records are protected ---------------------------------------------------------
const m3 = await merge('admin', r2.id, 'fpB:2', { address: over('Hacked Road'), city: fill('Yaba') })
const b = await row(r2.id)
ok('a verified record is never overwritten by a merge', b.address === 'Old Road' && m3.skipped.some((s) => s.field === 'address' && s.reason === 'verified_record'), JSON.stringify(m3))
ok('but its blanks can be filled', b.city === 'Yaba' && m3.applied.city === 'Yaba')
ok('a merge never changes verification', b.verification_status === 'verified' && b.verified_by === verifiedBy)

// ---- scope -----------------------------------------------------------------------------------
await expectError('the name cannot be merged', () => merge('admin', r1.id, 'fp:x1', { name: over('Renamed') }), '22023')
await expectError('verification cannot be merged', () => merge('admin', r1.id, 'fp:x2', { verification_status: over('verified') }), '22023')
await expectError('provenance cannot be merged', () => merge('admin', r1.id, 'fp:x3', { source_ref: over('x') }), '22023')
await expectError('the active flag cannot be merged', () => merge('admin', r1.id, 'fp:x4', { is_active: over(false) }), '22023')
await expectError('an empty change set is refused', () => merge('admin', r1.id, 'fp:x5', {}), '22023')
await expectError('a blank value is refused', () => merge('admin', r1.id, 'fp:x6', { description: fill('  ') }), '22023')
await expectError('an unknown mode is refused', () => merge('admin', r1.id, 'fp:x7', { description: { value: 'x', mode: 'force' } }), '22023')
await expectError('a missing reference is refused', () => merge('admin', r1.id, '', { description: fill('x') }), '22023')
await expectError('a missing target is reported', () => merge('admin', '00000000-0000-0000-0000-00000000dead', 'fp:x8', { description: fill('x') }), 'P0002')
await sup('update directory_businesses set is_active=false where id=$1', [r2.id])
await expectError('merging into a deactivated record is refused', () => merge('admin', r2.id, 'fp:x9', { description: fill('x') }), '22023')
await sup('update directory_businesses set is_active=true where id=$1', [r2.id])

// ---- coordinates ---------------------------------------------------------------------------
await expectError('coordinates must be merged as a pair', () => merge('admin', r1.id, 'fp:c1', { latitude: fill(6.5) }), '22023')
await expectError('a pair needs the same mode on both', () => merge('admin', r1.id, 'fp:c2', { latitude: fill(6.5), longitude: over(3.4) }), '22023')
const mc = await merge('admin', r1.id, 'fpA:5', { latitude: fill(6.5), longitude: fill(3.4) })
ok('blank coordinates are filled together', (await row(r1.id)).latitude === 6.5 && (await row(r1.id)).longitude === 3.4 && mc.applied.latitude === 6.5)
const mc2 = await merge('admin', r1.id, 'fpA:6', { latitude: fill(7.0), longitude: fill(4.0) })
ok('existing coordinates are kept unless overwrite is asked', (await row(r1.id)).latitude === 6.5 && mc2.skipped.some((s) => s.field === 'coordinates'))
await expectError('out-of-range coordinates are rejected by the database', () => merge('admin', r1.id, 'fpA:7', { latitude: over(95), longitude: over(3) }), '23514')
ok('...and the rejected merge left the coordinates and the log untouched', (await row(r1.id)).latitude === 6.5 && (await sup("select count(*)::int c from directory_import_merges where source_ref='fpA:7'")).rows[0].c === 0)

// ---- atomic failure ---------------------------------------------------------------------------
await expectError('one bad field fails the whole merge (bad email)', () => merge('admin', r1.id, 'fpA:8', { description: fill('Should not stick'), email: over('not-an-email') }), '23514')
ok('and nothing from that call was applied', (await row(r1.id)).description === null && (await row(r1.id)).email === 'info@alpha.test')

// ---- retry safety ---------------------------------------------------------------------------
await as('admin', "update directory_businesses set city='Lagos Island' where id=$1", [r1.id])
const retry = await merge('admin', r1.id, 'fpA:2', { city: over('Ikeja') })
ok('re-running the same import row is reported as already merged', retry.alreadyMerged === true)
ok('...and does not undo a later manual edit', (await row(r1.id)).city === 'Lagos Island')
ok('...nor add a second log row', (await sup("select count(*)::int c from directory_import_merges where directory_business_id=$1 and source_ref='fpA:2'", [r1.id])).rows[0].c === 1)
const other = await merge('admin', r1.id, 'fpA:2-other-file', { description: fill('From a second file') })
ok('the same record can be merged from a different import row', other.alreadyMerged === false && (await row(r1.id)).description === 'From a second file')

// ---- audit -----------------------------------------------------------------------------------
const aud = (await as('admin', "select action, note, before, after from directory_audit where directory_business_id=$1 and action='merge' order by id", [r1.id])).rows
ok('each applied merge is one audit row, action "merge", naming the import row', aud.length >= 3 && aud[0].note === 'merge from import fpA:2', aud.map((a) => a.note).join('|'))
ok('the audit row holds the full before and after', aud[0].before.city === null && aud[0].after.city === 'Ikeja')
ok('an ordinary edit afterwards is audited as "update", not "merge" (the note does not leak)', await as('admin', "update directory_businesses set description='manual' where id=$1", [r1.id])
  .then(async () => (await sup("select action, note from directory_audit where directory_business_id=$1 order by id desc limit 1", [r1.id])).rows[0])
  .then((a) => a.action === 'update' && a.note === null))
const logRow = (await sup("select * from directory_import_merges where directory_business_id=$1 and source_ref='fpA:2'", [r1.id])).rows[0]
ok('the merge log names who merged and what happened', logRow.merged_by === ADMIN && logRow.applied.city === 'Ikeja' && Array.isArray(logRow.skipped))

// ---- the log itself ---------------------------------------------------------------------------
await expectError('nobody can write the merge log directly', () => as('admin', "insert into directory_import_merges (directory_business_id, source_ref) values ($1,'forged')", [r1.id]), '42501')
await expectError('nor edit it', () => as('admin', "update directory_import_merges set source_ref='x'"), '42501')
ok('a company user cannot read the merge log', (await as('a', 'select 1 from directory_import_merges')).rows.length === 0)
ok('an administrator can', (await as('admin', 'select 1 from directory_import_merges')).rows.length > 0)

finish()
