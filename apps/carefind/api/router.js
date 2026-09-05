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

import { isCrawlerUserAgent } from '../src/lib/openGraph.js'
import ogHandler from './_handlers/og.js'
import adminAuthHandler from './_handlers/admin-auth.js'
import adminSetupHandler from './_handlers/admin-setup.js'
import banksHandler from './_handlers/banks.js'
import bookingHandler from './_handlers/booking.js'
import chargeConsultationHandler from './_handlers/charge-consultation.js'
import chargeSubscriptionHandler from './_handlers/charge-subscription.js'
import createSubaccountHandler from './_handlers/create-subaccount.js'
import initiatePaymentHandler from './_handlers/initiate-payment.js'
import initiateWithdrawalHandler from './_handlers/initiate-withdrawal.js'
import paystackWebhookHandler from './_handlers/paystack-webhook.js'
import verifyBookingPaymentHandler from './_handlers/verify-booking-payment.js'
import verifyConsultationPaymentHandler from './_handlers/verify-consultation-payment.js'
import verifyPaymentHandler from './_handlers/verify-payment.js'
import verifySubscriptionPaymentHandler from './_handlers/verify-subscription-payment.js'
import withdrawalPinHandler from './_handlers/withdrawal-pin.js'
import resolveAccountHandler from './_handlers/resolve-account.js'
import lookupAppointmentHandler from './_handlers/lookup-appointment.js'
import cancelAppointmentHandler from './_handlers/cancel-appointment.js'
import walletTransactionsHandler from './_handlers/wallet-transactions.js'
import initiateShopPaymentHandler from './_handlers/initiate-shop-payment.js'
import verifyShopPaymentHandler from './_handlers/verify-shop-payment.js'
import bookingInterestHandler from './_handlers/booking-interest.js'

const ROUTES = {
  'admin-auth': adminAuthHandler,
  'admin-setup': adminSetupHandler,
  'banks': banksHandler,
  'booking': bookingHandler,
  'booking-interest': bookingInterestHandler,
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
  'withdrawal-pin': withdrawalPinHandler,
  'resolve-account': resolveAccountHandler,
  'lookup-appointment': lookupAppointmentHandler,
  'cancel-appointment': cancelAppointmentHandler,
  'wallet-transactions': walletTransactionsHandler,
  'initiate-shop-payment': initiateShopPaymentHandler,
  'verify-shop-payment': verifyShopPaymentHandler,
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
    // Issue #1: vercel.json rewrites link-preview crawlers from an app route
    // (e.g. /post/<id>, or a legacy /feed?post=<id> link still in the wild)
    // to this function. Vercel preserves the original path in req.url, so
    // such a request has no matching API route — it lands here. Serve
    // per-item Open Graph tags instead of a 404.
    //
    // Two guards, both required:
    //  - the path must NOT be an /api/* path. A genuine typo'd API call must
    //    still get its 404 JSON, not a cacheable 200 HTML page, whatever
    //    User-Agent it happens to carry.
    //  - the User-Agent is re-checked rather than trusted from the rewrite
    //    alone: this is the only thing standing between a normal visitor and
    //    a page that is not the app.
    const isApiPath = /^\/api(\/|$)/.test((req.url || '').split('?')[0])
    if (!isApiPath
      && (req.method === 'GET' || req.method === 'HEAD')
      && isCrawlerUserAgent(req.headers['user-agent'])) {
      return ogHandler(req, res)
    }
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