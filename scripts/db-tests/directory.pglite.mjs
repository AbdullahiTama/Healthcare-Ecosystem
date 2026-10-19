// Directory database tests. See _harness.mjs for what this does and does not prove.
//   node scripts/db-tests/directory.pglite.mjs
import { ok, expectError, finish, as, sup, applyMigrations, ADMIN } from './_harness.mjs'

await applyMigrations([
  'carehub_20260905_facility_discovery_cursor_pagination.sql',
  'carehub_20261119_discover_facilities_cursor_lockdown.sql',
  'carehub_20261120_business_directory.sql',
  'carehub_20261121_directory_imports.sql',
  'carehub_20261122_directory_search.sql',
])

// ---- authorisation ---------------------------------------------------------------------------
ok('is_directory_admin: platform admin', (await as('admin', 'select is_directory_admin() v')).rows[0].v === true)
ok('is_directory_admin: company owner is NOT admin', (await as('a', 'select is_directory_admin() v')).rows[0].v === false)
await expectError('anon cannot call is_directory_admin()', () => as('anon', 'select is_directory_admin()'), '42501')

const cats = (await as('admin', 'select id, slug from directory_categories')).rows
ok('18 categories seeded', cats.length === 18, cats.length)
const pharmacy = cats.find((c) => c.slug === 'pharmacy').id

// admin creates records; verification attempts are neutralised
const ins = async (name, extra = {}) => (await as('admin',
  `insert into directory_businesses (name, category_id, city, state, latitude, longitude, phone, verification_status, verified_by, verified_at, data_source, source_ref)
   values ($1,$2,$3,'Lagos',$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
  [name, pharmacy, extra.city ?? 'Ikeja', extra.lat ?? null, extra.lng ?? null, extra.phone ?? null, extra.v ?? 'unverified', extra.vb ?? null, extra.va ?? null, extra.src ?? 'manual', extra.ref ?? null])).rows[0]

const sneaky = await ins('Sneaky Verified', { v: 'verified', vb: ADMIN, va: new Date().toISOString() })
ok('INSERT cannot create a pre-verified record', sneaky.verification_status === 'unverified' && sneaky.verified_by === null, JSON.stringify(sneaky))
ok('name_normalized computed by trigger', sneaky.name_normalized === 'sneaky verified')
const alpha = await ins('Alpha Pharmacy', { lat: 6.6018, lng: 3.3515, phone: '+234 803 123 4567' })
ok('phone normalised to last 10 digits', alpha.phone_normalized === '8031234567', alpha.phone_normalized)
const beta = await ins('Beta Pharmacy', { lat: 6.65, lng: 3.40, city: 'Ikeja' })
const far = await ins('Far Pharmacy', { lat: 7.38, lng: 3.9, city: 'Ibadan' })
const nocoord = await ins('No Coord Pharmacy')

// company users: read active only; no writes; no verification
const aRows = (await as('a', 'select id from directory_businesses')).rows
ok('company user can read active directory rows', aRows.length >= 5, aRows.length)
await expectError('company user cannot INSERT a directory business', () => as('a', "insert into directory_businesses (name) values ('X')"), '42501')
const upd = await as('a', "update directory_businesses set name='Hacked' where id=$1 returning id", [alpha.id])
ok('company user UPDATE affects 0 rows (RLS)', upd.rows.length === 0)
await expectError('company user cannot call directory_set_verification', () => as('a', "select directory_set_verification($1,'verified','x')", [alpha.id]), '42501')
ok('company user sees zero audit rows (RLS)', (await as('a', 'select * from directory_audit')).rows.length === 0)
ok('admin sees audit rows', (await as('admin', 'select * from directory_audit')).rows.length > 0)
await expectError('company user cannot write the audit log', () => as('a', "insert into directory_audit (action) values ('forged')"), '42501')
await expectError('anon cannot read directory_businesses', () => as('anon', 'select * from directory_businesses'), '42501')
await expectError('company user cannot create categories', () => as('a', "insert into directory_categories (slug,name) values ('x','X')"), '42501')
ok('company user cannot see contact-person table rows', (await as('a', 'select * from directory_business_private')).rows.length === 0)

// verification flow
const v = (await as('admin', "select * from directory_set_verification($1,'verified','CAC certificate checked')", [alpha.id])).rows[0]
ok('RPC verifies and stamps the actor and time', v.verification_status === 'verified' && v.verified_by === ADMIN && v.verified_at, JSON.stringify(v))
await as('admin', "update directory_businesses set verification_status='rejected', verified_by=null where id=$1", [alpha.id])
ok('a direct UPDATE cannot change verification', (await sup('select verification_status s from directory_businesses where id=$1', [alpha.id])).rows[0].s === 'verified')
await expectError('invalid status refused by the RPC', () => as('admin', "select directory_set_verification($1,'approved')", [alpha.id]), '22023')
const audit = (await as('admin', 'select action from directory_audit where directory_business_id=$1 order by id', [alpha.id])).rows.map((r) => r.action)
ok('audit trail records create and verification', audit.includes('create') && audit.includes('verification'), audit.join(','))

// deactivate: hidden from companies, kept for admin, no delete
await as('admin', 'update directory_businesses set is_active=false where id=$1', [nocoord.id])
ok('deactivated record hidden from companies', (await as('a', 'select id from directory_businesses where id=$1', [nocoord.id])).rows.length === 0)
ok('deactivated record still visible to admin', (await as('admin', 'select id from directory_businesses where id=$1', [nocoord.id])).rows.length === 1)
await expectError('DELETE is not permitted at all, even for an admin (no grant, no policy)', () => as('admin', 'delete from directory_businesses where id=$1', [nocoord.id]), '42501')

// constraints
await expectError('latitude out of range rejected', () => as('admin', "insert into directory_businesses (name,latitude,longitude) values ('Bad',95,3)"), '23514')
await expectError('half a coordinate pair rejected', () => as('admin', "insert into directory_businesses (name,latitude) values ('Bad',6)"), '23514')
await expectError('bad email rejected', () => as('admin', "insert into directory_businesses (name,email) values ('Bad','nope')"), '23514')
await ins('Import One', { src: 'import', ref: 'fp:2' })
await expectError('same (data_source, source_ref) cannot be imported twice', () => ins('Import One Again', { src: 'import', ref: 'fp:2' }), '23505')
const sub = (await as('admin', "insert into directory_categories (slug,name,parent_id) values ('retail','Retail',$1) returning id", [pharmacy])).rows[0].id
await expectError('subcategories cannot nest', () => as('admin', "insert into directory_categories (slug,name,parent_id) values ('deep','Deep',$1)", [sub]))

// imports history
await as('admin', "insert into directory_imports (file_name,file_fingerprint) values ('f.csv','abc')")
await expectError('company user cannot insert an import record', () => as('a', "insert into directory_imports (file_fingerprint) values ('x')"), '42501')
await expectError('import history is append-only (UPDATE not granted)', () => as('admin', "update directory_imports set file_name='z'"), '42501')

// ---- directory_search ------------------------------------------------------------------------
const S = (p) => as('a', `select directory_search(p_lat=>$1, p_lng=>$2, p_radius_m=>$3, p_sort=>$4, p_limit=>$5, p_offset=>$6, p_q=>$7, p_verification=>$8, p_state=>$9) r`,
  [p.lat ?? null, p.lng ?? null, p.radius ?? 5000, p.sort ?? 'name', p.limit ?? 25, p.offset ?? 0, p.q ?? null, p.verification ?? null, p.state ?? null]).then((r) => r.rows[0].r)
const near = await S({ lat: 6.6, lng: 3.35, radius: 10000, sort: 'distance' })
const names = near.rows.map((r) => r.name)
ok('radius search finds nearby, excludes far', names.includes('Alpha Pharmacy') && !names.includes('Far Pharmacy'), names.join(','))
ok('radius search excludes rows with no coordinates', !names.includes('No Coord Pharmacy'))
ok('distance sort is ascending and reports straight-line basis', near.rows[0].name === 'Alpha Pharmacy' && near.distanceBasis === 'straight_line' && near.rows[0].distance_m < near.rows[1].distance_m, JSON.stringify(near.rows.map((r) => [r.name, r.distance_m])))
const d = near.rows.find((r) => r.name === 'Alpha Pharmacy').distance_m
ok('haversine distance is right (Alpha is ~215 m from the point)', d > 150 && d < 300, d)
const mid = { lat: 7.0, lng: 3.6 } // ~56 km from Far (Ibadan), ~53 km from Alpha
const wide = await S({ ...mid, radius: 100000, sort: 'distance' })
ok('100 km radius from a midpoint includes both ~55 km away', ['Far Pharmacy', 'Alpha Pharmacy'].every((n) => wide.rows.map((r) => r.name).includes(n)))
const tight = await S({ ...mid, radius: 30000, sort: 'distance' })
ok('30 km radius from the same point excludes both', tight.total === 0, tight.total)
const edge = (await S({ ...mid, radius: 100000, sort: 'distance' })).rows.find((r) => r.name === 'Far Pharmacy').distance_m
const just = await S({ ...mid, radius: edge + 50 }), under = await S({ ...mid, radius: edge - 50 })
ok('boundary is exact: radius just above includes, just below excludes', just.rows.some((r) => r.name === 'Far Pharmacy') && !under.rows.some((r) => r.name === 'Far Pharmacy'), edge)
const p1 = await S({ limit: 2, offset: 0 }), p2 = await S({ limit: 2, offset: 2 })
ok('pagination: total, hasMore, no overlap', p1.total >= 5 && p1.hasMore === true && p1.rows.length === 2 && !p2.rows.some((r) => p1.rows.map((x) => x.id).includes(r.id)), JSON.stringify([p1.total, p1.hasMore]))
const past = await S({ offset: 1000 })
ok('offset past the end returns no rows but the real total', past.rows.length === 0 && past.total === p1.total && past.hasMore === false, JSON.stringify(past))
ok('limit is clamped to 100', (await S({ limit: 5000 })).limit === 100)
const ver = await S({ sort: 'verified' })
ok('verified-first sort', ver.rows[0].verification_status === 'verified', ver.rows[0].verification_status)
ok('verification filter', (await S({ verification: 'verified' })).rows.every((r) => r.verification_status === 'verified'))
ok('name filter escapes wildcards (% matches nothing)', (await S({ q: '%' })).total === 0)
ok('inactive records never appear, even for an admin', !(await as('admin', 'select directory_search() r')).rows[0].r.rows.some((r) => r.name === 'No Coord Pharmacy'))
await expectError('half a point is refused', () => as('a', 'select directory_search(p_lat=>6.5)'), '22023')
await expectError('out-of-range point is refused', () => as('a', 'select directory_search(p_lat=>95, p_lng=>3)'), '22023')
await expectError('bad verification filter is refused', () => as('a', "select directory_search(p_verification=>'x')"), '22023')
await expectError('anon cannot search', () => as('anon', 'select directory_search()'), '42501')
ok('search rows never include contact person', !JSON.stringify(near).includes('contact_person'))
const before = (await sup('select count(*)::int c from directory_audit')).rows[0].c
await S({ lat: 6.6, lng: 3.35 })
ok('searching writes nothing', (await sup('select count(*)::int c from directory_audit')).rows[0].c === before)

// ---- legacy RPC lockdown ---------------------------------------------------------------------
await sup("insert into businesses (name,state,city,phone) values ('Pub','Lagos','Ikeja','0900')")
await expectError('anon can no longer call discover_facilities_cursor', () => as('anon', "select discover_facilities_cursor('Lagos')"), '42501')
const legacy = (await as('a', "select discover_facilities_cursor('Lagos', null, null, 'all', null, 100000, 'abc') r")).rows[0].r
ok('legacy RPC: signed-in user still works; bad cursor -> offset 0; limit clamped to 100', legacy.rows.length >= 1 && legacy.rows.length <= 100, JSON.stringify(legacy).slice(0, 120))
ok('legacy RPC: % wildcard no longer matches everything', (await as('a', "select discover_facilities_cursor('%') r")).rows[0].r.total === 0)

finish()
