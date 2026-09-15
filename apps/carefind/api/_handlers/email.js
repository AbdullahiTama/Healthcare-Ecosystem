// CareFind email route dispatcher.
// Handles /api/email/send, /api/email/outbox, /api/webhooks/resend, /api/cron/process-email-outbox
// via the router's single-serverless-function pattern.

import emailSendHandler from '../email/send.js'
import emailOutboxHandler from '../email/outbox.js'
import emailWebhookHandler from '../webhooks/resend.js'
import emailCronHandler from '../cron/process-email-outbox.js'

function routeFromUrl(req) {
  const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  if (segments[0] === 'email') return { handler: emailSendHandler, subpath: segments.slice(1).join('/') }
  if (segments[0] === 'cron') return { handler: emailCronHandler, subpath: segments.slice(1).join('/') }
  if (segments[0] === 'webhooks') return { handler: emailWebhookHandler, subpath: segments.slice(1).join('/') }
  return null
}

export default async function handler(req, res) {
  const routed = routeFromUrl(req)
  if (!routed) return res.status(404).json({ error: 'No email handler found' })
  const { handler: target, subpath } = routed

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
    console.error(`[email-handler] ${subpath} crashed:`, err)
    if (!res.headersSent) return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
