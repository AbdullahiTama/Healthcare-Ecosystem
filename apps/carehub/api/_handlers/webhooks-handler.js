// CareHub webhooks sub-route dispatcher.
// Handles /api/webhooks/resend

export default async function handler(req, res) {
  const mod = await import('./resend.js')
  return mod.default(req, res)
}
