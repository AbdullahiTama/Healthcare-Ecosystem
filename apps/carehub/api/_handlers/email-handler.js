// CareHub email sub-route dispatcher.
// Handles /api/email/send, /api/email/outbox, /api/email/process-outbox, /api/email/preview, /api/email/test-send
//
// Static imports so @vercel/nft includes every sub-handler in the bundle,
// matching the router's rule: a variable import specifier is untraceable and
// the module is missing at runtime.
import emailOutboxHandler from './email-outbox.js'
import emailPreviewHandler from './email-preview.js'
import emailProcessOutboxHandler from './email-process-outbox.js'
import emailSendHandler from './email-send.js'
import emailTestSendHandler from './email-test-send.js'

function subRoute(req) {
  const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  if (segments[0] === 'email') segments.shift()
  return segments[0] || 'send'
}

const SUB_ROUTES = {
  'outbox':         emailOutboxHandler,
  'process-outbox': emailProcessOutboxHandler,
  'preview':        emailPreviewHandler,
  'test-send':      emailTestSendHandler,
  'send':           emailSendHandler,
}

export default async function handler(req, res) {
  const target = SUB_ROUTES[subRoute(req)] || emailSendHandler
  return target(req, res)
}
