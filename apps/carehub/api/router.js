// CareHub single catch-all serverless function.
//
// Vercel's Hobby plan caps a deployment at 12 serverless functions. CareHub
// had 15 API routes, so the deploy was failing. This router folds all of them
// into one function; vercel.json rewrites every /api/* path here and we
// dispatch on the original path Vercel preserves in req.url.
//
// All handler imports are dynamic to prevent module-level side effects
// (createClient calls, broken package resolution) from crashing the router.
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

// Dynamic import map — handlers are loaded on first use, not at module load.
// This prevents broken import chains from crashing every route.
const HANDLER_MAP = {
  'verify-plan-payment':          () => import('./verify-plan-payment.js'),
  'verify-appointment-payment':   () => import('./verify-appointment-payment.js'),
  'resolve-account':              () => import('./resolve-account.js'),
  'notify-registration':          () => import('./notify-registration.js'),
  'notify-business-status':       () => import('./notify-business-status.js'),
  'initiate-plan-payment':        () => import('./initiate-plan-payment.js'),
  'initiate-business-withdrawal': () => import('./initiate-business-withdrawal.js'),
  'initiate-appointment-payment': () => import('./initiate-appointment-payment.js'),
  'ecommerce-review':             () => import('./ecommerce-review.js'),
  'banks':                        () => import('./banks.js'),
}

// Sub-route dispatchers for nested paths
const SUBROUTE_MAP = {
  'email':    () => import('./email/handler.js'),
  'cron':     () => import('./cron/handler.js'),
  'webhooks': () => import('./webhooks/handler.js'),
}

export default async function handler(req, res) {
  const route = routeFromUrl(req)

  // Try direct route match first
  const loader = HANDLER_MAP[route]
  if (loader) {
    parseQuery(req)
    try { await rehydrateBody(req) } catch (err) {
      return res.status(400).json({ error: err.message })
    }
    try {
      const mod = await loader()
      return await mod.default(req, res)
    } catch (err) {
      console.error(`[router] ${route} crashed:`, err)
      if (!res.headersSent) return res.status(500).json({ error: err.message || 'Internal server error' })
    }
  }

  // Try sub-route match (email/send, email/outbox, cron/..., webhooks/...)
  const subLoader = SUBROUTE_MAP[route]
  if (subLoader) {
    parseQuery(req)
    try { await rehydrateBody(req) } catch (err) {
      return res.status(400).json({ error: err.message })
    }
    try {
      const mod = await subLoader()
      return await mod.default(req, res)
    } catch (err) {
      console.error(`[router] ${route} crashed:`, err)
      if (!res.headersSent) return res.status(500).json({ error: err.message || 'Internal server error' })
    }
  }

  return res.status(404).json({ error: `No handler for /api/${route}` })
}
