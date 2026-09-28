const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isUUID(v) {
  return typeof v === 'string' && UUID_RE.test(v)
}

export function isDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  return !isNaN(Date.parse(v))
}

export function isTime(v) {
  if (typeof v !== 'string' || !TIME_RE.test(v)) return false
  const [hh, mm] = v.split(':').map(Number)
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
}

export function isEmail(v) {
  return typeof v === 'string' && EMAIL_RE.test(v)
}

export function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0
}

export function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0
}

export function isString(v, { min = 0, max = 1000 } = {}) {
  return typeof v === 'string' && v.length >= min && v.length <= max
}

export function isEnum(v, allowed) {
  return allowed.includes(v)
}

export function isAmountKobo(v) {
  return Number.isInteger(v) && v > 0 && v <= 100_000_000_000
}

export function isPagination(v) {
  const { limit, offset } = v || {}
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) return false
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000)) return false
  return true
}

export function sanitizeString(v, { max = 1000 } = {}) {
  if (typeof v !== 'string') return ''
  return v.replace(/[<>]/g, '').trim().slice(0, max)
}

export function rejectUnknownFields(allowed, body) {
  const extra = Object.keys(body || {}).filter(k => !allowed.includes(k))
  return extra.length > 0 ? extra : null
}
