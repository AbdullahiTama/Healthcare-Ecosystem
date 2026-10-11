// Where the provider sends the customer back after paying. The initiators used to forward whatever `callback_url` the
// browser sent, so a payment could return to any site carrying its reference (audit F-27). The URL must now be absolute,
// carry no credentials, and be on an origin the platform owns: the request's own origin (as the edge reports it) or one
// listed in PAYMENT_CALLBACK_ORIGINS (comma-separated origins). http is accepted only for localhost.

const MAX_LENGTH = 2048
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseOrigins(list) {
  return String(list || '').split(',').map((s) => s.trim()).filter(Boolean).flatMap((s) => {
    try {
      const u = new URL(s)
      return [u.origin]
    } catch { return [] }
  })
}

const first = (v) => String(Array.isArray(v) ? v[0] : v || '').split(',')[0].trim()

/** The request's own origin from the edge headers, or null. */
export function requestOrigin(req) {
  const h = req?.headers || {}
  const host = first(h['x-forwarded-host']) || first(h.host)
  if (!host) return null
  const proto = first(h['x-forwarded-proto']) || (LOCAL.has(host.split(':')[0]) ? 'http' : 'https')
  try { return new URL(`${proto}://${host}`).origin } catch { return null }
}

/**
 * @param {{ requested: unknown, req?: object, allowedOrigins?: string[] }} p
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
export function resolveCallbackUrl({ requested, req, allowedOrigins = parseOrigins(process.env.PAYMENT_CALLBACK_ORIGINS) }) {
  if (typeof requested !== 'string' || !requested || requested.length > MAX_LENGTH) return { ok: false, reason: 'missing' }
  let u
  try { u = new URL(requested) } catch { return { ok: false, reason: 'not_absolute' } }
  if (u.username || u.password) return { ok: false, reason: 'credentials' }
  const local = LOCAL.has(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { ok: false, reason: 'protocol' }
  const allowed = new Set([...allowedOrigins, requestOrigin(req)].filter(Boolean))
  if (!allowed.has(u.origin)) return { ok: false, reason: 'origin' }
  return { ok: true, url: u.toString() }
}
