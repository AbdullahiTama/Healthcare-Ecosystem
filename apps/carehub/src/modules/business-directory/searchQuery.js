import { normalizeState, NIGERIA_STATES } from '../../lib/nigeriaGeo.js'
import { isValidLatLng } from '../directory/directoryRecord.js'

// Pure search-query logic for Business Discovery: radius rules, filter -> RPC
// parameter mapping, and a rule-based natural-language parser. No I/O, no AI
// dependency. The parser only INTERPRETS; the UI shows the interpretation so the
// user can correct it before (or after) searching. It never invents businesses.

export const RADIUS_OPTIONS_M = [1000, 3000, 5000, 10000, 25000]
export const MIN_RADIUS_M = 100
export const MAX_RADIUS_M = 100000
export const DEFAULT_RADIUS_M = 5000
export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100
export const SORTS = ['name', 'distance', 'verified', 'recent']

// "Custom radius" input is in km; returns metres or null when invalid.
export function parseCustomRadiusKm(value) {
  const n = Number(String(value == null ? '' : value).trim())
  if (!String(value == null ? '' : value).trim() || !Number.isFinite(n)) return null
  const m = Math.round(n * 1000)
  return m >= MIN_RADIUS_M && m <= MAX_RADIUS_M ? m : null
}

export function radiusLabel(m) {
  if (!Number.isFinite(m)) return ''
  return m < 1000 ? m + ' m' : (m / 1000) + ' km'
}

/**
 * Filters -> { params, error }. `params` use the directory_search RPC's p_*
 * names. Coordinates are validated here as well as in the database; a search
 * with a half-supplied or out-of-range point is refused, never silently
 * widened to "everywhere".
 */
export function buildSearchParams(f = {}) {
  const lat = f.lat == null || f.lat === '' ? null : Number(f.lat)
  const lng = f.lng == null || f.lng === '' ? null : Number(f.lng)
  const hasPoint = lat !== null || lng !== null
  if (hasPoint && !isValidLatLng(lat, lng)) {
    return { params: null, error: 'The chosen location has invalid coordinates.' }
  }
  const radius = f.radiusM == null ? DEFAULT_RADIUS_M : Number(f.radiusM)
  if (hasPoint && !(radius >= MIN_RADIUS_M && radius <= MAX_RADIUS_M)) {
    return { params: null, error: 'Radius must be between 100 m and 100 km.' }
  }
  const limit = Math.min(Math.max(parseInt(f.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(parseInt(f.offset, 10) || 0, 0)
  const sort = SORTS.includes(f.sort) ? f.sort : (hasPoint ? 'distance' : 'name')
  const t = (v) => { const s = v == null ? '' : String(v).trim(); return s === '' ? null : s }
  return {
    error: null,
    params: {
      p_q: t(f.q), p_category_id: t(f.categoryId), p_subcategory_id: t(f.subcategoryId),
      p_state: t(f.state), p_lga: t(f.lga), p_city: t(f.city), p_place: t(f.place),
      p_verification: t(f.verification), p_source: t(f.source),
      p_lat: hasPoint ? lat : null, p_lng: hasPoint ? lng : null,
      p_radius_m: hasPoint ? radius : null,
      p_sort: sort, p_limit: limit, p_offset: offset,
    },
  }
}

// ── Natural-language parsing ─────────────────────────────────────────────────

// Ordered most specific first, so "pharmaceutical distributors" is matched before
// the generic "pharmacy" rule. Each source is a word-boundary regex.
const CATEGORY_RULES = [
  [/\b(?:pharmaceutical\s+|drug\s+)?manufacturer\w*/, 'pharma-manufacturer'],
  [/\b(?:pharmaceutical\s+)?importer\w*/, 'pharma-importer'],
  [/\b(?:pharmaceutical\s+)?distributor\w*/, 'pharma-distributor'],
  [/\b(?:pharmaceutical\s+)?wholesaler\w*/, 'pharma-wholesaler'],
  [/\bmedical\s+equipment\s+supplier\w*/, 'medical-equipment-supplier'],
  [/\bmedical\s+equipment(?:\s+compan\w+)?/, 'medical-equipment-company'],
  [/\bspecialist\s+hospital\w*/, 'specialist-hospital'],
  [/\bprimary\s+health\w*(?:\s+(?:care\s+)?cent(?:re|er)\w*)?|\bphcs?\b/, 'primary-healthcare-centre'],
  [/\bmedical\s+cent(?:re|er)\w*/, 'medical-centre'],
  [/\bdiagnostic\w*|\bimaging\b|\bradiolog\w*/, 'diagnostic-imaging'],
  [/\bdental\w*|\bdentist\w*/, 'dental-clinic'],
  [/\beye\s+clinic\w*|\boptical\w*/, 'eye-clinic'],
  [/\blaborator\w+|\blabs?\b/, 'laboratory'],
  [/\bcosmetic\w*|\bbeauty\b/, 'cosmetics'],
  [/\bpharmacies\b|\bpharmacy\b|\bchemists?\b/, 'pharmacy'],
  [/\bhospital\w*/, 'hospital'],
  [/\bclinic\w*/, 'clinic'],
]

const STOP = new Set(['find', 'show', 'me', 'list', 'get', 'search', 'for', 'all', 'the', 'a', 'an', 'some', 'any', 'businesses', 'business', 'companies', 'company', 'places', 'near', 'nearby', 'around', 'within', 'in', 'at', 'of', 'to', 'my', 'location', 'here', 'close', 'please', 'and'])

const STATE_NAMES = NIGERIA_STATES.map((s) => s.name)
const LGA_INDEX = (() => {
  const idx = new Map()
  NIGERIA_STATES.forEach((s) => s.lgas.forEach((l) => {
    const k = l.toLowerCase()
    if (!idx.has(k)) idx.set(k, { lga: l, states: [] })
    idx.get(k).states.push(s.name)
  }))
  return idx
})()

/**
 * Interprets free text. Returns:
 *   { categorySlug, near: 'me'|null, radiusM, limit, state, lga, place, q,
 *     notes: [string], needsReview: boolean }
 * Anything it could not understand is left out, never guessed. needsReview is
 * true when nothing structured was found or the place is ambiguous.
 */
export function parseSearchText(input) {
  const raw = String(input == null ? '' : input).trim()
  const out = { categorySlug: null, near: null, radiusM: null, limit: null, state: null, lga: null, place: null, q: null, notes: [], needsReview: false }
  if (!raw) { out.needsReview = true; return out }
  let text = ' ' + raw.toLowerCase().replace(/[?!.,;]+/g, ' ').replace(/\s+/g, ' ') + ' '

  // radius: "within 5 km", "5km", "2.5 kilometres", "800 m"
  const rad = text.match(/\b(?:within|inside|in a|around)?\s*(\d+(?:\.\d+)?)\s*(km|kms|kilomet\w*|m|metres|meters)\b/)
  if (rad) {
    const n = Number(rad[1])
    const m = /^k/.test(rad[2]) ? Math.round(n * 1000) : Math.round(n)
    if (m >= MIN_RADIUS_M && m <= MAX_RADIUS_M) out.radiusM = m
    else out.notes.push('Radius must be between 100 m and 100 km, so it was ignored.')
    text = text.replace(rad[0], ' ')
  }

  // near me
  if (/\b(around|near|close to|nearby|near by|beside)\s+(me|my location|my area|here)\b|\bnearby\b|\bnear me\b|\baround me\b/.test(text)) {
    out.near = 'me'
    text = text.replace(/\b(around|near|close to|beside)\s+(me|my location|my area|here)\b|\bnearby\b|\bnear by\b/g, ' ')
  }

  // result count: a bare number before words ("20 cosmetic businesses", "top 10")
  const lim = text.match(/\b(?:top|first|show|find|list|get)?\s*(\d{1,3})\s+(?=[a-z])/)
  if (lim) {
    const n = Number(lim[1])
    if (n >= 1 && n <= MAX_LIMIT) out.limit = n
    else out.notes.push('Result count must be between 1 and ' + MAX_LIMIT + ', so it was ignored.')
    text = text.replace(lim[0], ' ')
  }

  // category: first rule that matches; the matched words are removed
  for (const [re, slug] of CATEGORY_RULES) {
    const m = text.match(re)
    if (m) { out.categorySlug = slug; text = text.replace(m[0], ' '); break }
  }

  // place: "in X" / "around X" / "near X" / "at X" -> state, LGA, or free text
  const placeMatch = text.match(/\b(?:in|around|near|at)\s+([a-z][a-z\s'-]{1,40}?)\s*$/)
  if (placeMatch) {
    const candidate = placeMatch[1].trim().replace(/\s+(state|lga|area)$/, '')
    const st = normalizeState(candidate)
    if (st) out.state = st
    else if (LGA_INDEX.has(candidate)) {
      const hit = LGA_INDEX.get(candidate)
      out.lga = hit.lga
      if (hit.states.length === 1) out.state = hit.states[0]
      else { out.notes.push(hit.lga + ' exists in several states (' + hit.states.join(', ') + '). Pick a state to narrow it.'); out.needsReview = true }
    } else {
      out.place = candidate.replace(/\b\w/g, (c) => c.toUpperCase())
      out.notes.push('"' + out.place + '" is matched against addresses, towns and LGAs as text. It is not geocoded, so radius does not apply to it.')
    }
    text = text.slice(0, placeMatch.index) + ' '
  }

  // anything left that is not filler is treated as a name fragment
  const leftover = text.split(/\s+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w))
  if (leftover.length) out.q = leftover.join(' ')

  if (out.near === 'me' && out.place) out.notes.push('"Around me" and a named place were both given. Using your location; the place text is only a filter.')
  if (!out.categorySlug && !out.q && !out.place && !out.state && !out.lga && out.near !== 'me') out.needsReview = true
  if (out.radiusM && !out.near) out.notes.push('A radius needs a location. Use your current location or pick one on the map.')
  return out
}

// Parsed text -> filter state for the form. `categories` is the directory
// category list so the slug can be resolved to an id; an unknown slug is
// dropped rather than guessed.
export function interpretationToFilters(parsed, categories = []) {
  const cat = parsed.categorySlug ? categories.find((c) => c.slug === parsed.categorySlug) : null
  return {
    q: parsed.q || '',
    categoryId: cat ? cat.id : '',
    state: parsed.state || '',
    lga: parsed.lga || '',
    place: parsed.place || '',
    radiusM: parsed.radiusM || DEFAULT_RADIUS_M,
    limit: parsed.limit || DEFAULT_LIMIT,
    wantsMyLocation: parsed.near === 'me',
  }
}
