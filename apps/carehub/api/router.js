// CareHub single catch-all serverless function.
//
// Vercel's Hobby plan caps a deployment at 12 serverless functions. All
// handlers live in api/_handlers/ (underscore prefix = excluded from
// Vercel's function count). vercel.json rewrites every /api/* to this
// router, which dispatches to a statically imported handler.
//
// The imports below must stay static. An earlier revision mapped each route
// to a path string and called `await import(path)`. Vercel builds this
// function with @vercel/nft, which follows literal import specifiers only;
// a variable specifier is untraceable, so no _handlers/* file was bundled and
// every route failed at runtime with
// "Cannot find module '/var/task/apps/carehub/api/_handlers/<x>.js'".
// Keep these as top-level named imports so nft includes them in the bundle.
import authEmailHandler from './_handlers/auth-email.js'
import banksHandler from './_handlers/banks.js'
import cronHandler from './_handlers/cron-handler.js'
import ecommerceReviewHandler from './_handlers/ecommerce-review.js'
import emailHandler from './_handlers/email-handler.js'
import initiateAppointmentPaymentHandler from './_handlers/initiate-appointment-payment.js'
import initiateBusinessWithdrawalHandler from './_handlers/initiate-business-withdrawal.js'
import initiatePlanPaymentHandler from './_handlers/initiate-plan-payment.js'
import notifyBusinessStatusHandler from './_handlers/notify-business-status.js'
import notifyRegistrationHandler from './_handlers/notify-registration.js'
import resolveAccountHandler from './_handlers/resolve-account.js'
import verifyAppointmentPaymentHandler from './_handlers/verify-appointment-payment.js'
import verifyPlanPaymentHandler from './_handlers/verify-plan-payment.js'
import webhooksHandler from './_handlers/webhooks-handler.js'

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
  // Keep the exact bytes: a webhook signature (Resend / Svix) covers them, and req.body is a re-parse.
  req.rawBody = raw
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

// Route table maps the first path segment after /api/ to an already-imported
// handler. Values are functions, never path strings -- see the note above.
const HANDLERS = {
  'verify-plan-payment':          verifyPlanPaymentHandler,
  'verify-appointment-payment':   verifyAppointmentPaymentHandler,
  'resolve-account':              resolveAccountHandler,
  'notify-registration':          notifyRegistrationHandler,
  'notify-business-status':       notifyBusinessStatusHandler,
  'initiate-plan-payment':        initiatePlanPaymentHandler,
  'initiate-business-withdrawal': initiateBusinessWithdrawalHandler,
  'initiate-appointment-payment': initiateAppointmentPaymentHandler,
  'ecommerce-review':             ecommerceReviewHandler,
  'auth-email':                   authEmailHandler,
  'banks':                        banksHandler,
  'email':                        emailHandler,
  'cron':                         cronHandler,
  'webhooks':                     webhooksHandler,
}

export default async function handler(req, res) {
  const route = routeFromUrl(req)
  const target = HANDLERS[route]

  if (!target) return res.status(404).json({ error: `No handler for /api/${route}` })

  parseQuery(req)
  try { await rehydrateBody(req) } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  try {
    return await target(req, res)
  } catch (err) {
    console.error(`[router] ${route} crashed:`, err)
    if (!res.headersSent) return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
