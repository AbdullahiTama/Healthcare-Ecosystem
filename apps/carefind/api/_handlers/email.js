// CareFind email route dispatcher.
// Handles /api/email/send, /api/email/outbox, /api/webhooks/resend, /api/cron/process-email-outbox
// via the router's single-serverless-function pattern.
//
// IMPORTANT: All sub-handler imports are dynamic to prevent module-level
// side effects (createClient calls, EmailService instantiation) from crashing
// the entire API router at load time.

function routeFromUrl(req) {
  const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  if (segments[0] === 'email') return { type: 'send', subpath: segments.slice(1).join('/') }
  if (segments[0] === 'cron') return { type: 'cron', subpath: segments.slice(1).join('/') }
  if (segments[0] === 'webhooks') return { type: 'webhooks', subpath: segments.slice(1).join('/') }
  return null
}

async function resolveHandler(type) {
  switch (type) {
    case 'send': {
      const mod = await import('../email/send.js')
      return mod.default
    }
    case 'cron': {
      const mod = await import('../cron/process-email-outbox.js')
      return mod.default
    }
    case 'webhooks': {
      const mod = await import('../webhooks/resend.js')
      return mod.default
    }
    default:
      return null
  }
}

export default async function handler(req, res) {
  const routed = routeFromUrl(req)
  if (!routed) return res.status(404).json({ error: 'No email handler found' })

  const target = await resolveHandler(routed.type)
  if (!target) return res.status(404).json({ error: 'No email handler found' })

  // Parse query params for GET routes
  const searchParams = new URL(req.url, 'http://localhost').searchParams
  req.query = {}
  for (const [key, value] of searchParams) req.query[key] = value

  // Rehydrate body for POST
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = await new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
    const text = raw.toString('utf8').trim()
    if (text) req.body = JSON.parse(text)
    else req.body = {}
  }

  try {
    return await target(req, res)
  } catch (err) {
    console.error(`[email-handler] ${routed.type} crashed:`, err)
    if (!res.headersSent) return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
