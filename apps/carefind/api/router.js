// CareFind single catch-all serverless function.
//
// Vercel's Hobby plan caps a deployment at 12 serverless functions; CareFind
// has 14 API routes, so the deploy was failing with "No more than 12 Serverless
// Functions can be added to a Deployment." This router folds all of them into
// one function; vercel.json rewrites every /api/* path here and we dispatch on
// the original path Vercel preserves in req.url. No client URL changes.
//
// Why a router instead of 14 files: function count. Nothing about the handlers
// changes — each is imported unchanged and receives the same (req, res) it
// always did, with the same request semantics:
//   - JSON routes get an already-parsed req.body (rehydrated here).
//   - paystack-webhook gets the UNTOUCHED raw body stream: it signs the exact
//     bytes Paystack sent (bodyParser: false, same as its old config export),
//     so it must never be pre-consumed or re-serialized.
//   - GET routes (banks, admin-setup) get req.query parsed from the URL.
export const config = { api: { bodyParser: false } }

import adminAuthHandler from './admin-auth.js'
import adminSetupHandler from './admin-setup.js'
import banksHandler from './banks.js'
import bookingHandler from './booking.js'
import chargeConsultationHandler from './charge-consultation.js'
import chargeSubscriptionHandler from './charge-subscription.js'
import createSubaccountHandler from './create-subaccount.js'
import initiatePaymentHandler from './initiate-payment.js'
import initiateWithdrawalHandler from './initiate-withdrawal.js'
import paystackWebhookHandler from './paystack-webhook.js'
import verifyBookingPaymentHandler from './verify-booking-payment.js'
import verifyConsultationPaymentHandler from './verify-consultation-payment.js'
import verifyPaymentHandler from './verify-payment.js'
import verifySubscriptionPaymentHandler from './verify-subscription-payment.js'

const ROUTES = {
  'admin-auth': adminAuthHandler,
  'admin-setup': adminSetupHandler,
  'banks': banksHandler,
  'booking': bookingHandler,
  'charge-consultation': chargeConsultationHandler,
  'charge-subscription': chargeSubscriptionHandler,
  'create-subaccount': createSubaccountHandler,
  'initiate-payment': initiatePaymentHandler,
  'initiate-withdrawal': initiateWithdrawalHandler,
  'paystack-webhook': paystackWebhookHandler,
  'verify-booking-payment': verifyBookingPaymentHandler,
  'verify-consultation-payment': verifyConsultationPaymentHandler,
  'verify-payment': verifyPaymentHandler,
  'verify-subscription-payment': verifySubscriptionPaymentHandler,
}

// This route must receive the untouched request stream so it can hash the raw
// bytes Paystack signed. Never set or consume req.body before dispatching to it.
const RAW_BODY_ROUTE = 'paystack-webhook'

// Vercel rewrites /api/<route> to /api/router while preserving the original
// request path, so req.url still looks like /api/initiate-payment.
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

export default async function handler(req, res) {
  const route = routeFromUrl(req)
  const target = ROUTES[route]

  if (!target) {
    return res.status(404).json({ error: `No handler for /api/${route}` })
  }

  parseQuery(req)

  if (route === RAW_BODY_ROUTE) {
    return target(req, res)
  }

  try {
    await rehydrateBody(req)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  return target(req, res)
}