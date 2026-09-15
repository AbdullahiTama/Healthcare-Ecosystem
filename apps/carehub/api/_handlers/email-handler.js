// CareHub email sub-route dispatcher.
// Handles /api/email/send, /api/email/outbox, /api/email/process-outbox

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
  if (sub === 'outbox') mod = await import('./outbox.js')
  else if (sub === 'process-outbox') mod = await import('./process-outbox.js')
  else mod = await import('./send.js')

  return mod.default(req, res)
}
