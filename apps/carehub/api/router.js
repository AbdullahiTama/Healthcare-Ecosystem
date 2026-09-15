// CareHub single catch-all serverless function.
//
// Vercel's Hobby plan caps a deployment at 12 serverless functions. All
// handlers live in api/_handlers/ (underscore prefix = excluded from
// Vercel's function count). vercel.json rewrites every /api/* to this
// router, which dispatches via dynamic imports.
export const config = { api: { bodyParser: false } }

function routeFromUrl(req) {
  const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  return segments[0] || ''
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function rehydrateBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    req.body = {}
    return
  }
  const raw = await readRawBody(req)
  const text = raw.toString('utf8').trim()
  if (!text) {
    req.body = {}
    return
  }
  try {
    req.body = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON body')
  }
}

function parseQuery(req) {
  const searchParams = new URL(req.url, 'http://localhost').searchParams
  const query = {}
  for (const [key, value] of searchParams) query[key] = value
  req.query = query
}

const HANDLERS = {
  'verify-plan-payment':          './_handlers/verify-plan-payment.js',
  'verify-appointment-payment':   './_handlers/verify-appointment-payment.js',
  'resolve-account':              './_handlers/resolve-account.js',
  'notify-registration':          './_handlers/notify-registration.js',
  'notify-business-status':       './_handlers/notify-business-status.js',
  'initiate-plan-payment':        './_handlers/initiate-plan-payment.js',
  'initiate-business-withdrawal': './_handlers/initiate-business-withdrawal.js',
  'initiate-appointment-payment': './_handlers/initiate-appointment-payment.js',
  'ecommerce-review':             './_handlers/ecommerce-review.js',
  'banks':                        './_handlers/banks.js',
  'email':                        './_handlers/email-handler.js',
  'cron':                         './_handlers/cron-handler.js',
  'webhooks':                     './_handlers/webhooks-handler.js',
}

export default async function handler(req, res) {
  const route = routeFromUrl(req)
  const path = HANDLERS[route]

  if (!path) return res.status(404).json({ error: `No handler for /api/${route}` })

  parseQuery(req)
  try { await rehydrateBody(req) } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  try {
    const mod = await import(path)
    return await mod.default(req, res)
  } catch (err) {
    console.error(`[router] ${route} crashed:`, err)
    if (!res.headersSent) return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
