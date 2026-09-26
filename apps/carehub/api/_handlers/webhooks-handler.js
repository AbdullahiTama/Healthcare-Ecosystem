// CareHub webhooks sub-route dispatcher.
// Handles /api/webhooks/resend
//
// Static import, and the filename matches the file on disk. The previous
// revision did `await import('./resend.js')`; no such file exists in
// _handlers/, the real one is webhooks-resend.js.
import resendWebhookHandler from './webhooks-resend.js'

export default async function handler(req, res) {
  return resendWebhookHandler(req, res)
}
