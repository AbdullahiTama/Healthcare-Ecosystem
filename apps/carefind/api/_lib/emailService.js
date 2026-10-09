import { createClient } from '@supabase/supabase-js'

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

// The service-role client is INJECTED, as CareHub's wrapper and the auth email
// path already do. Left to itself the shared package resolves '@supabase/supabase-js'
// by walking up from packages/shared-email/, which finds nothing on Vercel because
// the workspace package is deployed without its own node_modules; the lookup then
// throws "Cannot find package" on first use. Every caller here treats an email
// failure as best-effort, so that throw was swallowed and the email silently
// never queued. Lazy, so a missing env var surfaces on first use, not at import.
let _db = null
function db() {
  if (!_db) _db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  return _db
}

async function service() {
  const { EmailService } = await import('@care-ecosystem/shared-email')
  return new EmailService({ supabase: db() })
}

export async function enqueue({ templateKey, toEmail, payload, subject, eventKey, app = 'carefind', fromEmail, sourceId, idempotencyKey }) {
  const emailService = await service()
  return emailService.enqueue({ templateKey, toEmail, payload, subject, app, eventKey, fromEmail, sourceId, idempotencyKey })
}

// Deterministic event keys are the only thing that stops a refresh, webhook
// replay, or retried verification from enqueueing the same email twice. The
// shared-email worker maps eventKey onto the outbox event_key column and
// (app, event_key, source_id?) uniqueness enforces the rest.
export function bookingEventKey(id) { return `booking-confirmed:${id}` }

export async function processBatch() {
  const emailService = await service()
  return emailService.processBatch()
}
