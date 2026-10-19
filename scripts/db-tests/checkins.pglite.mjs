// Check-in / location-history database tests. See _harness.mjs for scope and limits.
//   node scripts/db-tests/checkins.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations, seedStaff, USERS, ADMIN } from './_harness.mjs'

// is_business_manager() lives in the facility-review migration, which also
// touches these two tables; minimal stand-ins let the real file apply.
await db.exec(`
  CREATE TABLE public.facilities_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, source text);
  CREATE TABLE public.rep_added_facilities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, status text);
`)
await applyMigrations(['carehub_20260823_facility_review_authorization.sql'], { rerun: false })
await applyMigrations(['carehub_20261123_staff_checkins.sql'])

const S = await seedStaff() // { A, B, repA1, repA2, mgrA, repB1 }
const call = (who, biz, ev, extra = {}) => as(who,
  `select * from record_checkin($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [biz, ev, extra.lat ?? null, extra.lng ?? null, extra.acc ?? null, extra.src ?? null, extra.label ?? null, extra.fail ?? null, extra.client ?? null]).then((r) => r.rows[0])
const GOOD = { lat: 6.5244, lng: 3.3792, acc: 25, src: 'browser_geolocation', label: 'Lagos Island' }
const backdate = async (id, minutes) => {
  await sup('alter table staff_checkins disable trigger staff_checkins_append_only')
  await sup(`update staff_checkins set created_at = now() - ($2 || ' minutes')::interval where id=$1`, [id, String(minutes)])
  await sup('alter table staff_checkins enable trigger staff_checkins_append_only')
}

// ---- writing: identity and membership --------------------------------------------------------
const c1 = await call('repA1', S.A, 'workday_checkin', GOOD)
ok('rep checks in: bound to their own user and staff row', c1.user_id === USERS.repA1.sub && c1.staff_id === S.repA1 && c1.business_id === S.A, JSON.stringify(c1))
ok('status captured with the position and source', c1.status === 'captured' && c1.latitude === 6.5244 && c1.location_source === 'browser_geolocation')
ok('created_at is the server clock', Math.abs(new Date(c1.created_at) - Date.now()) < 60000)

await expectError('rep cannot write into another company (forged business id)', () => call('repA1', S.B, 'workday_checkin', GOOD), '42501')
await expectError('outsider with no membership is refused', () => call('outsider', S.A, 'workday_checkin', GOOD), '42501')
await expectError('anonymous is refused', () => call('anon', S.A, 'workday_checkin', GOOD), '42501')
await expectError('company B owner cannot write into company A', () => call('b', S.A, 'workday_checkin', GOOD), '42501')
const own = await call('a', S.A, 'workday_checkin', { ...GOOD, lat: 6.51 })
ok('owner can check in (no staff row)', own.staff_id === null && own.user_id === USERS.a.sub)

await sup("update staff set status='inactive' where id=$1", [S.repA2])
await expectError('revoked membership can no longer write', () => call('repA2', S.A, 'workday_checkin', GOOD), '42501')
await sup("update staff set status='active' where id=$1", [S.repA2])

// ---- validation -----------------------------------------------------------------------------
await expectError('login is not a check-in event type', () => call('repA1', S.A, 'login', GOOD), '22023')
await expectError('latitude out of range refused', () => call('repA1', S.A, 'location_capture', { ...GOOD, lat: 95 }), '22023')
await expectError('longitude out of range refused', () => call('repA1', S.A, 'location_capture', { ...GOOD, lng: 190 }), '22023')
await expectError('half a position refused', () => call('repA1', S.A, 'location_capture', { lat: 6.5, src: 'browser_geolocation' }), '22023')
await expectError('position without a source refused', () => call('repA1', S.A, 'location_capture', { lat: 6.5, lng: 3.4 }), '22023')
await expectError('position with a failure reason refused', () => call('repA1', S.A, 'location_capture', { ...GOOD, fail: 'denied' }), '22023')
await expectError('no position and no reason refused (no silent empty check-in)', () => call('repA1', S.A, 'location_capture', {}), '22023')
await expectError('unknown failure reason refused', () => call('repA1', S.A, 'location_capture', { fail: 'felt like it' }), '22023')

// failed capture is honest
const failed = await call('repA2', S.A, 'workday_checkin', { fail: 'denied' })
ok('failed capture stored as failed, with no coordinates', failed.status === 'failed' && failed.latitude === null && failed.longitude === null && failed.failure_reason === 'denied', JSON.stringify(failed))

// client clock is advisory
const bad = await call('repA1', S.A, 'location_capture', { ...GOOD, lat: 6.6, client: '2001-01-01T00:00:00Z' })
ok('implausible client timestamp is discarded', bad.client_captured_at === null)
await backdate(bad.id, 10) // outside the 5-second double-tap window
const fine = await call('repA1', S.A, 'location_capture', { ...GOOD, lat: 6.7, client: new Date(Date.now() - 20000).toISOString() })
ok('plausible client timestamp is kept (advisory)', fine.client_captured_at !== null)

// idempotence vs. history
const d1 = await call('repA1', S.A, 'workday_checkout', GOOD)
const d2 = await call('repA1', S.A, 'workday_checkout', GOOD)
ok('immediate repeat returns the same row (double-tap safe)', d1.id === d2.id)
await backdate(d1.id, 10)
const d3 = await call('repA1', S.A, 'workday_checkout', GOOD)
ok('a genuine later check-out is a new row; history is kept', d3.id !== d1.id && (await sup('select count(*)::int c from staff_checkins where id=$1', [d1.id])).rows[0].c === 1)

// ---- append-only and no direct writes ------------------------------------------------------
await expectError('no direct INSERT for users', () => as('repA1', `insert into staff_checkins (business_id,user_id,event_type,status,failure_reason) values ($1,$2,'workday_checkin','failed','denied')`, [S.A, USERS.repA1.sub]), '42501')
await expectError('no UPDATE for users', () => as('repA1', 'update staff_checkins set latitude=0'), '42501')
await expectError('no DELETE for users', () => as('repA1', 'delete from staff_checkins'), '42501')
await expectError('UPDATE blocked even for the table owner (trigger)', () => sup("update staff_checkins set location_label='x' where id=$1", [c1.id]), '42501')
await expectError('DELETE blocked even for the table owner (trigger)', () => sup('delete from staff_checkins where id=$1', [c1.id]), '42501')
await expectError('a captured row without coordinates violates a CHECK', () => sup(`insert into staff_checkins (business_id,user_id,event_type,status,location_source) values ($1,$2,'workday_checkin','captured','manual')`, [S.A, USERS.repA1.sub]), '23514')
await expectError('a failed row carrying coordinates violates a CHECK', () => sup(`insert into staff_checkins (business_id,user_id,event_type,status,failure_reason,latitude,longitude) values ($1,$2,'workday_checkin','failed','denied',6,3)`, [S.A, USERS.repA1.sub]), '23514')

// ---- who can read what ---------------------------------------------------------------------
const mine = (await as('repA1', 'select user_id from staff_checkins')).rows
ok('a rep reads only their own rows', mine.length >= 4 && mine.every((r) => r.user_id === USERS.repA1.sub), mine.length)
ok('a rep cannot read a colleague\'s rows', (await as('repA2', 'select user_id from staff_checkins')).rows.every((r) => r.user_id === USERS.repA2.sub))
ok('company B cannot read any company A rows', (await as('repB1', 'select 1 from staff_checkins')).rows.length === 0)
ok('company B owner cannot read any company A rows', (await as('b', 'select 1 from staff_checkins')).rows.length === 0)
ok('a manager has no direct table read of others (must use the audited RPC)', (await as('mgrA', 'select 1 from staff_checkins where user_id <> $1', [USERS.mgrA.sub])).rows.length === 0)
await expectError('anonymous cannot read the table', () => as('anon', 'select 1 from staff_checkins'), '42501')

// ---- manager overview ------------------------------------------------------------------------
const logBefore = (await sup('select count(*)::int c from location_access_log')).rows[0].c
const ov = (await as('mgrA', 'select manager_checkin_overview($1) r', [S.A])).rows[0].r
const byName = Object.fromEntries(ov.rows.map((r) => [r.name, r]))
ok('overview lists the company\'s active staff only', ['Rep One', 'Rep Two', 'Manager A'].every((n) => byName[n]) && !byName['Rep B'], Object.keys(byName).join(','))
ok('current: fresh success is "current" with its position', byName['Rep One'].freshness === 'current' && byName['Rep One'].last_checkin.latitude != null)
ok('a failed capture is not a check-in: unavailable + the failed attempt is reported', byName['Rep Two'].freshness === 'unavailable' && byName['Rep Two'].last_checkin === null && byName['Rep Two'].last_failed_attempt.reason === 'denied', JSON.stringify(byName['Rep Two']))
ok('no events at all is unavailable', byName['Manager A'].freshness === 'unavailable' && byName['Manager A'].last_failed_attempt === null)

// stale is never shown as current
const latest = (await sup("select id from staff_checkins where staff_id=$1 and status='captured' order by created_at desc", [S.repA1])).rows
for (const r of latest) await backdate(r.id, 125)
const ov2 = (await as('mgrA', 'select manager_checkin_overview($1) r', [S.A])).rows[0].r
const one2 = ov2.rows.find((r) => r.name === 'Rep One')
ok('a 2-hour-old position is "stale", with its age', one2.freshness === 'stale' && one2.age_minutes >= 120, JSON.stringify([one2.freshness, one2.age_minutes]))

// a later failure is surfaced against an older success
await call('repA1', S.A, 'location_capture', { fail: 'timeout' })
const ov3 = (await as('mgrA', 'select manager_checkin_overview($1) r', [S.A])).rows[0].r
ok('a failed attempt newer than the last success is reported alongside it', ov3.rows.find((r) => r.name === 'Rep One').last_failed_attempt.reason === 'timeout')

// activity is a separate concept
await sup("insert into field_activities (business_id, staff_id, rep_name) values ($1,$2,'Rep Two')", [S.A, S.repA2])
const ov4 = (await as('mgrA', 'select manager_checkin_overview($1) r', [S.A])).rows[0].r
const two4 = ov4.rows.find((r) => r.name === 'Rep Two')
ok('last activity is reported separately and does not turn a failed check-in into a location', two4.last_activity_at !== null && two4.freshness === 'unavailable')

// revoked staff drop out
await sup("update staff set status='inactive' where id=$1", [S.repA2])
ok('revoked staff disappear from the overview', !(await as('mgrA', 'select manager_checkin_overview($1) r', [S.A])).rows[0].r.rows.some((r) => r.name === 'Rep Two'))
await sup("update staff set status='active' where id=$1", [S.repA2])

// who may call it
await expectError('a non-manager rep cannot call the overview', () => as('repA1', 'select manager_checkin_overview($1)', [S.A]), '42501')
await expectError('another company\'s owner cannot call it for company A', () => as('b', 'select manager_checkin_overview($1)', [S.A]), '42501')
await expectError('another company\'s staff cannot call it for company A', () => as('repB1', 'select manager_checkin_overview($1)', [S.A]), '42501')
await expectError('outsider cannot call it', () => as('outsider', 'select manager_checkin_overview($1)', [S.A]), '42501')
await expectError('anonymous cannot call it', () => as('anon', 'select manager_checkin_overview($1)', [S.A]), '42501')
ok('the company owner can call it', (await as('a', 'select manager_checkin_overview($1) r', [S.A])).rows[0].r.rows.length >= 3)

// access to other people's locations is recorded
const logAfter = (await sup('select count(*)::int c from location_access_log')).rows[0].c
ok('each successful overview is recorded in the access log; refusals are not', logAfter - logBefore === 6, logAfter - logBefore) // 6 successful calls above; 5 refused calls added nothing
const logRow = (await sup('select * from location_access_log order by id limit 1')).rows[0]
ok('log row names the actor, business and size', logRow.actor_id === USERS.mgrA.sub && logRow.business_id === S.A && logRow.row_count >= 3 && logRow.action === 'checkin_overview', JSON.stringify(logRow))
ok('the manager can read their own access log', (await as('mgrA', 'select 1 from location_access_log')).rows.length >= 1)
ok('a rep cannot read the access log', (await as('repA1', 'select 1 from location_access_log')).rows.length === 0)
ok('a platform admin can read the access log', (await as('admin', 'select 1 from location_access_log')).rows.length >= 1)
await expectError('the access log is append-only for users', () => as('mgrA', 'delete from location_access_log'), '42501')
await expectError('and for the owner (trigger)', () => sup('delete from location_access_log'), '42501')
await expectError('users cannot forge access-log rows', () => as('repA1', "insert into location_access_log (actor_id,business_id,action) values ($1,$2,'x')", [USERS.repA1.sub, S.A]), '42501')

finish()
