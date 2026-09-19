// CareHub email sub-route dispatcher.
// Handles /api/email/send, /api/email/outbox, /api/email/process-outbox, /api/email/preview, /api/email/test-send

function subRoute(req) {
  const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  if (segments[0] === 'email') segments.shift()
  return segments[0] || 'send'
}

export default async function handler(req, res) {
  const sub = subRoute(req)
  let mod
  if (sub === 'outbox') mod = await import('./email-outbox.js')
  else if (sub === 'process-outbox') mod = await import('./email-process-outbox.js')
  else if (sub === 'preview') mod = await import('./email-preview.js')
  else if (sub === 'test-send') mod = await import('./email-test-send.js')
  else mod = await import('./email-send.js')

  return mod.default(req, res)
}
