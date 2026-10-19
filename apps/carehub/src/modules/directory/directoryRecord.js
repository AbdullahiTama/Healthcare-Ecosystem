import { normalizeName, normalizePhone } from '../../lib/facilityDiscovery.js'

// Pure validation and normalisation for a directory business record. No I/O:
// the same checks run in the form, the importer and the repository, and the
// database re-enforces them with CHECK constraints (carehub_20261120).

export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'rejected']
export const DATA_SOURCES = ['manual', 'import', 'osm', 'google', 'regulatory', 'partner', 'other']

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const text = (v) => (v == null ? '' : String(v).trim())
const orNull = (v) => { const t = text(v); return t === '' ? null : t }
const supplied = (v) => !(v == null || String(v).trim() === '')

// Finite number, null when not supplied, NaN when supplied but not numeric.
export function parseCoordinate(v) {
  if (!supplied(v)) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

export function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// Website must parse as an http(s) URL once a scheme is assumed; javascript:,
// data: and similar are rejected.
function validWebsite(w) {
  try {
    const u = new URL(w.includes('://') ? w : 'https://' + w)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')
  } catch (e) { return false }
}

// Never emits verification fields: a record can only become verified through
// directory_set_verification, so input cannot smuggle a status in.
export function normalizeDirectoryRecord(input = {}) {
  const email = orNull(input.email)
  return {
    name: text(input.name),
    category_id: orNull(input.category_id),
    subcategory_id: orNull(input.subcategory_id),
    business_type: orNull(input.business_type),
    address: orNull(input.address),
    city: orNull(input.city),
    state: orNull(input.state),
    lga: orNull(input.lga),
    latitude: parseCoordinate(input.latitude),
    longitude: parseCoordinate(input.longitude),
    phone: orNull(input.phone),
    email: email && email.toLowerCase(),
    website: orNull(input.website),
    description: orNull(input.description),
    data_source: DATA_SOURCES.includes(input.data_source) ? input.data_source : 'manual',
    source_ref: orNull(input.source_ref),
  }
}

// Returns { ok, errors: { field: message }, record }.
export function validateDirectoryRecord(input = {}) {
  const record = normalizeDirectoryRecord(input)
  const errors = {}
  if (!record.name) errors.name = 'Business name is required.'
  else if (record.name.length > 250) errors.name = 'Business name must be 250 characters or fewer.'

  const latGiven = supplied(input.latitude)
  const lngGiven = supplied(input.longitude)
  if (latGiven !== lngGiven) {
    errors.latitude = 'Latitude and longitude must be supplied together.'
  } else if (latGiven && !isValidLatLng(record.latitude, record.longitude)) {
    errors.latitude = 'Coordinates must be numbers: latitude -90 to 90, longitude -180 to 180.'
  }
  if (record.email && !EMAIL_RE.test(record.email)) errors.email = 'Email address is not valid.'
  if (record.phone && normalizePhone(record.phone).length < 7) errors.phone = 'Phone number looks too short.'
  if (record.website && !validWebsite(record.website)) errors.website = 'Website must be a valid http(s) address.'
  if (record.subcategory_id && !record.category_id) errors.subcategory_id = 'Choose a category before a subcategory.'
  return { ok: Object.keys(errors).length === 0, errors, record }
}

// Keys used to find possible duplicates. The database computes the same
// name/phone values, so a client comparison and a server one agree.
export function duplicateKeys(record) {
  return { name: normalizeName(record.name), phone: normalizePhone(record.phone) }
}
