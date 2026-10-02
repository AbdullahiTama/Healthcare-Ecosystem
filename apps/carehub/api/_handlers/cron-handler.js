// CareHub cron sub-route dispatcher.
// Handles /api/cron/process-email-outbox and /api/cron/reconcile-payments
//
// Static imports, and the filenames match the files on disk. The previous
// revision did `await import('./process-email-outbox.js')`; no such file
// exists in _handlers/, the real one is cron-process-email-outbox.js, so the
// route would have thrown ERR_MODULE_NOT_FOUND even once the router bundled.
import processEmailOutboxHandler from './cron-process-email-outbox.js'
import reconcilePaymentsHandler from './cron-reconcile-payments.js'

export default async function handler(req, res) {
  const path = (req.url || '').split('?')[0].replace(/\/+$/, '')
  if (path.endsWith('/cron/reconcile-payments')) return reconcilePaymentsHandler(req, res)
  return processEmailOutboxHandler(req, res)
}
