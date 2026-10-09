// ── Normalisation helpers for the Business Directory ──────────────────────────
// Pure functions, no I/O. Everything the duplicate engine, the importer and the
// search use to decide "are these the same thing" lives here, so the stored
// `*_normalized` columns and the in-browser comparisons can never drift apart.

const LEGAL_SUFFIXES = new Set([
  'ltd', 'limited', 'plc', 'llc', 'inc', 'incorporated', 'co', 'company', 'corp', 'corporation',
  'nig', 'nigeria', 'enterprise', 'enterprises', 'ventures', 'venture', 'the', 'and',
])

const ADDRESS_ABBREVIATIONS = {
  st: 'street', str: 'street', rd: 'road', ave: 'avenue', av: 'avenue', blvd: 'boulevard',
  cres: 'crescent', cl: 'close', dr: 'drive', ln: 'lane', opp: 'opposite',
  bstop: 'busstop', jnc: 'junction', jct: 'junction', blk: 'block',
  est: 'estate', ph: 'phase', plz: 'plaza', cmplx: 'complex', hosp: 'hospital',
  nr: 'near', bw: 'between', no: '', flr: 'floor', lga: '',
}

function stripDiacritics(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function basic(s) {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * "Alpha Pharmacy Ltd." and "ALPHA PHARMACY LIMITED" -> "alpha pharmacy".
 * Falls back to the basic form if stripping would leave nothing (a business
 * literally called "Nigeria Enterprises").
 */
export function normalizeName(name) {
  const b = basic(name)
  if (!b) return ''
  const kept = b.split(' ').filter((t) => t && !LEGAL_SUFFIXES.has(t))
  return (kept.length ? kept : b.split(' ')).join(' ')
}

export function normalizeAddress(address) {
  const b = basic(address)
  if (!b) return ''
  return b
    .split(' ')
    .map((t) => (Object.prototype.hasOwnProperty.call(ADDRESS_ABBREVIATIONS, t) ? ADDRESS_ABBREVIATIONS[t] : t))
    .filter(Boolean)
    .join(' ')
}

/**
 * Canonical phone form. Nigerian numbers collapse to the 11-digit national form
 * (0803…) whether typed as +234 803…, 234803…, or 803…; anything else is kept as
 * bare digits. Returns '' when there is no usable number.
 */
export function normalizePhone(phone) {
  let d = String(phone ?? '').replace(/\D+/g, '')
  if (!d) return ''
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('234') && d.length === 13) return '0' + d.slice(3)
  if (d.length === 10 && !d.startsWith('0')) return '0' + d
  return d
}

export function isValidPhone(phone) {
  const raw = String(phone ?? '').trim()
  if (!raw) return true
  if (!/^[+()\d\s\-./]+$/.test(raw)) return false
  const n = normalizePhone(raw)
  return n.length >= 7 && n.length <= 15
}

export function isValidEmail(email) {
  const e = String(email ?? '').trim()
  if (!e) return true
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
}

/** "https://www.Alpha.com/contact" -> "alpha.com". '' when not a plausible host. */
export function websiteHost(website) {
  const w = String(website ?? '').trim()
  if (!w) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(w) ? w : 'https://' + w
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    return host.includes('.') ? host : ''
  } catch (e) {
    return ''
  }
}

export function isValidWebsite(website) {
  const w = String(website ?? '').trim()
  return !w || websiteHost(w) !== ''
}

/** Only http(s) URLs are ever rendered as links (defeats javascript: URLs). */
export function safeWebsiteUrl(website) {
  const w = String(website ?? '').trim()
  if (!websiteHost(w)) return null
  return /^https?:\/\//i.test(w) ? w : 'https://' + w
}

export function toNumberOrNull(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

export function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// Rough bounding box of Nigeria — used only to WARN ("check this pin"), never to reject.
export function isWithinNigeria(lat, lng) {
  return lat >= 4.0 && lat <= 14.0 && lng >= 2.5 && lng <= 15.0
}

/** Lowercased, accent-free lookup key for category / state / LGA matching. */
export function lookupKey(s) {
  return basic(s).replace(/\s+/g, ' ')
}

/** Derive the stored normalised columns from user-facing fields. */
export function deriveNormalized(rec) {
  return {
    name_normalized: normalizeName(rec.name),
    address_normalized: normalizeAddress(rec.address) || null,
    phone_normalized: normalizePhone(rec.phone) || null,
    website_host: websiteHost(rec.website) || null,
  }
}
