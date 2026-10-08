// Thin wrapper over the shared EmailService. Both apps route every send through
// packages/shared-email/src/EmailService.js, so this file exists only to give
// the handlers a stable import path.
//
// renderTemplate and sendTemplatedEmail used to live here. They read templates
// from the email_templates table, which holds 0 rows, and nothing outside this
// file ever called them, so they could only ever return {success:false, error:
// 'No template found'} while looking like a working send path. Removing them
// also removes the overrideSubject parameter, which was a third way for a caller
// to choose a subject instead of the catalog.
export async function enqueue({ templateKey, toEmail, payload, subject, eventKey, app = 'carefind', fromEmail, sourceId, idempotencyKey }) {
  const { EmailService } = await import('@care-ecosystem/shared-email')
  const emailService = new EmailService()
  return emailService.enqueue({ templateKey, toEmail, payload, subject, app, eventKey, fromEmail, sourceId, idempotencyKey })
}

// Deterministic event keys are the only thing that stops a refresh, webhook
// replay, or retried verification from enqueueing the same email twice. The
// shared-email worker maps eventKey onto the outbox event_key column and
// (app, event_key, source_id?) uniqueness enforces the rest.
export function bookingEventKey(id) { return `booking-confirmed:${id}` }

export async function processBatch() {
  const { EmailService } = await import('@care-ecosystem/shared-email')
  const emailService = new EmailService()
  return emailService.processBatch()
}
