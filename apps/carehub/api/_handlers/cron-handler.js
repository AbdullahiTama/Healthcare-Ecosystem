// CareHub cron sub-route dispatcher.
// Handles /api/cron/process-email-outbox

export default async function handler(req, res) {
  const mod = await import('./process-email-outbox.js')
  return mod.default(req, res)
}
