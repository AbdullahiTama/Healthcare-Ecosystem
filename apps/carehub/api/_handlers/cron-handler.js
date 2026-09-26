// CareHub cron sub-route dispatcher.
// Handles /api/cron/process-email-outbox
//
// Static import, and the filename matches the file on disk. The previous
// revision did `await import('./process-email-outbox.js')`; no such file
// exists in _handlers/, the real one is cron-process-email-outbox.js, so the
// route would have thrown ERR_MODULE_NOT_FOUND even once the router bundled.
import processEmailOutboxHandler from './cron-process-email-outbox.js'

export default async function handler(req, res) {
  return processEmailOutboxHandler(req, res)
}
