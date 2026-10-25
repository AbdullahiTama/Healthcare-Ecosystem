// OpenStreetMap businesses for the platform admin's directory map (docs/superpowers/specs/2026-10-25-directory-map-add-design.md).
// Only the kinds the platform directory manages are offered: a tag maps to a platform category NAME, and a business
// whose category is not an active platform category is dropped. OpenStreetMap data is user-contributed: treat every
// value as untrusted text (see safeWebsite, and the map's text-only popups).

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const RESULT_CAP = 300
const AMENITIES = 'pharmacy|hospital|clinic|doctors|dentist|health_post|birthing_center|laboratory'
const SHOPS = 'chemist|optician|medical_supply|cosmetics'

// First matching rule wins: a specialist clinic is placed before the general kinds.
export const OSM_CATEGORY_RULES = [
  { category: 'Paediatric Centre', test: (t) => /paediatric|pediatric/.test(t['healthcare:speciality'] || '') },
  { category: 'Cardiology Centre', test: (t) => /cardiolog/.test(t['healthcare:speciality'] || '') },
  { category: 'Gynecology Centre', test: (t) => /gynaecolog|gynecolog|obstetric/.test(t['healthcare:speciality'] || '') },
  { category: 'Dermatology', test: (t) => /dermatolog/.test(t['healthcare:speciality'] || '') },
  { category: 'Fertility/IVF Centre', test: (t) => /fertility|reproductive/.test(t['healthcare:speciality'] || '') },
  { category: 'Pharmacy', test: (t) => t.amenity === 'pharmacy' || t.healthcare === 'pharmacy' || t.shop === 'chemist' },
  { category: 'Hospital', test: (t) => t.amenity === 'hospital' || t.healthcare === 'hospital' },
  { category: 'Dental Clinic', test: (t) => t.amenity === 'dentist' || t.healthcare === 'dentist' },
  { category: 'Eye Clinic/Optometry', test: (t) => t.healthcare === 'optometrist' || t.shop === 'optician' },
  { category: 'Medical Laboratory', test: (t) => t.healthcare === 'laboratory' || t.amenity === 'laboratory' },
  { category: 'Physiotherapy/Rehabilitation', test: (t) => t.healthcare === 'physiotherapist' || t.healthcare === 'rehabilitation' },
  { category: 'Maternity', test: (t) => t.amenity === 'birthing_center' || t.healthcare === 'birthing_centre' || t.healthcare === 'midwife' },
  { category: 'Primary Healthcare Centre', test: (t) => t.amenity === 'health_post' },
  { category: 'Medical Centre', test: (t) => t.healthcare === 'centre' },
  { category: 'Clinic', test: (t) => t.amenity === 'clinic' || t.amenity === 'doctors' || t.healthcare === 'clinic' || t.healthcare === 'doctor' },
  { category: 'Medical Equipment Supplier', test: (t) => t.shop === 'medical_supply' },
  { category: 'Cosmetics Business', test: (t) => t.shop === 'cosmetics' },
]

// The active platform category this business belongs to, or null when the platform does not manage its kind.
export function suggestCategory(tags, categories) {
  const t = tags || {}
  const rule = OSM_CATEGORY_RULES.find((r) => r.test(t))
  if (!rule) return null
  const wanted = rule.category.toLowerCase()
  return (categories || []).find((c) => c.is_active !== false && String(c.name || '').toLowerCase() === wanted) || null
}

export function buildBboxQuery({ south, west, north, east }) {
  const box = '(' + [south, west, north, east].join(',') + ')'
  const parts = [
    '["amenity"~"^(' + AMENITIES + ')$"]',
    '["healthcare"]',
    '["shop"~"^(' + SHOPS + ')$"]',
  ]
  return '[out:json][timeout:25];(' + parts.map((p) => 'node' + p + box + ';way' + p + box + ';').join('') + ');out center ' + RESULT_CAP + ';'
}

function addressOf(t) {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')
  return [street, t['addr:city'] || t['addr:suburb']].filter(Boolean).join(', ')
}

export function parseOsmBusinesses(data) {
  if (!data || !Array.isArray(data.elements)) return []
  const seen = new Set()
  const out = []
  data.elements.forEach((el) => {
    const t = el.tags || {}
    const name = String(t.name || '').trim()
    const lat = el.lat != null ? Number(el.lat) : el.center ? Number(el.center.lat) : NaN
    const lng = el.lon != null ? Number(el.lon) : el.center ? Number(el.center.lon) : NaN
    const ref = el.type + '/' + el.id
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || seen.has(ref)) return
    seen.add(ref)
    out.push({
      ref, name, lat, lng, tags: t,
      address: addressOf(t), state: t['addr:state'] || '', lga: t['addr:district'] || '', city: t['addr:city'] || '',
      phone: t.phone || t['contact:phone'] || '', website: t.website || t['contact:website'] || '',
      openingHours: t.opening_hours || '',
    })
  })
  return out
}

export async function fetchOsmBusinesses(bounds, { fetchImpl = fetch } = {}) {
  const busy = new Error('OpenStreetMap is busy or unreachable. Try again in a moment.')
  let res
  try {
    res = await fetchImpl(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(buildBboxQuery(bounds)),
    })
  } catch (e) {
    throw busy
  }
  if (!res || !res.ok) {
    // 400 means Overpass could not read our query: a fault on our side, worth reporting. Anything else (406 refused,
    // 429 rate limited, 5xx overloaded) is the service. The status is kept for diagnosis.
    const err = res && res.status === 400 ? new Error('OpenStreetMap could not read this search. Please report it to the CareHub team.') : busy
    err.status = res ? res.status : null
    throw err
  }
  return parseOsmBusinesses(await res.json())
}

// A website is only ever made a link when it is plainly http(s); anything else (javascript:, data:, bare hosts) stays
// text.
export function safeWebsite(url) {
  const s = String(url || '').trim()
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null
}
