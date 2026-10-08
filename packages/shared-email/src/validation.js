// Input validation for outbound email. Pure functions, no I/O — safe to
// import anywhere, but enforced on the server inside provider.send().

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const FROM_RE = /^([^<>]+<[^<>]+>)|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/

// Only fields a browser could never be allowed to smuggle in raw HTML for.
// All interpolated values must be escaped by the template layer; this layer
// only asserts the envelope is sane.

export function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 320 && EMAIL_RE.test(value.trim())
}

export function isValidFrom(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  const v = value.trim()
  if (v.includes('<')) {
    const m = v.match(/^(.+)<([^<>]+)>$/)
    return !!m && m[1].trim().length > 0 && isValidEmail(m[2].trim())
  }
  return isValidEmail(v)
}

export function validateRecipients(to) {
  const list = Array.isArray(to) ? to : [to]
  if (!list.length) return 'to must contain at least one recipient'
  for (const r of list) {
    if (!isValidEmail(r)) return `invalid recipient: ${String(r).slice(0, 64)}`
  }
  return null
}

export function validateFrom(from) {
  return isValidFrom(from) ? null : 'invalid from address'
}

export function validateSubject(subject) {
  if (typeof subject !== 'string' || !subject.trim()) return 'subject is required'
  if (subject.length > 998) return 'subject too long'
  if (/[\r\n]/.test(subject)) return 'subject must not contain line breaks'
  return null
}

export function validateHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return 'html is required and must be non-empty'
  if (html.length > 2_000_000) return 'html payload too large'
  if (/<script/i.test(html)) return 'html must not contain script tags'
  return null
}

export function validateReplyTo(replyTo) {
  if (replyTo === undefined || replyTo === null || replyTo === '') return null
  return isValidEmail(replyTo) ? null : 'invalid reply_to address'
}

// Returns null when valid, otherwise a human-readable error string.
export function validateMessage({ from, to, subject, html, replyTo } = {}) {
  return (
    validateFrom(from) ||
    validateRecipients(to) ||
    validateSubject(subject) ||
    validateHtml(html) ||
    validateReplyTo(replyTo)
  )
}
