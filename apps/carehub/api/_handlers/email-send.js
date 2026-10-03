import { emailService } from '../../src/lib/emailService.js'
import { supabase } from '../_lib/supabase.js'
import { requirePlatformAdmin } from '../_lib/requirePlatformAdmin.js'
import { isValidEmail } from '@care-ecosystem/shared-email'

// Every template the handler will accept, with its required payload fields.
// Anything outside this catalog is rejected: callers can pick an event, never
// arbitrary markup.
const TEMPLATES = {
  registration_owner: ['businessName', 'ownerName'],
  admin_new_registration: ['businessName', 'ownerName', 'businessType', 'state', 'email'],
  business_approved: ['businessName', 'ownerName', 'ownerEmail'],
  business_rejected: ['businessName', 'ownerName'],
  business_suspended: ['businessName', 'ownerName'],
  appointment_confirmed: ['fullName', 'businessName', 'date', 'time'],
  staff_welcome: ['fullName', 'businessName'],
  credit_reminder: ['clientName', 'businessName', 'amount'],
  agent_approved: ['agentName', 'agentEmail'],
  agent_rejected: ['agentName'],
}

function validatePayload(templateKey, payload) {
  const required = TEMPLATES[templateKey]
  if (!required) return `Invalid templateKey. Allowed: ${Object.keys(TEMPLATES).join(', ')}`
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload must be an object'
  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      return `payload.${field} is required for ${templateKey}`
    }
  }
  return null
}

// Credentials must never travel through an email payload. Reject any key that
// names one, anywhere in the object graph — templates may then never be
// tricked into rendering a password, hash, or session artifact.
const CREDENTIAL_KEY = /password|passwd|pwd|token|secret|otp|api[_-]?key|access[_-]?token|refresh[_-]?token|session/i
function containsCredentialField(value) {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsCredentialField)
  for (const [k, v] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(k)) return true
    if (v && typeof v === 'object' && containsCredentialField(v)) return true
  }
  return false
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Mails any address from the trusted sender with a caller-chosen subject and payload values. The only browser caller
  // is the admin referral panel, so this requires a platform admin (it used to accept any signed-in user).
  const { status: authStatus, error: authError } = await requirePlatformAdmin(req, supabase)
  if (authStatus) return res.status(authStatus).json({ error: authError })

  const { templateKey, toEmail, payload, subject } = req.body || {}
  if (!templateKey || !toEmail) {
    return res.status(400).json({ error: 'templateKey and toEmail are required' })
  }
  if (!isValidEmail(toEmail)) return res.status(400).json({ error: 'toEmail must be a valid email address' })
  const payloadError = validatePayload(templateKey, payload)
  if (payloadError) return res.status(400).json({ error: payloadError })
  if (containsCredentialField(payload)) {
    return res.status(400).json({ error: 'payload must not contain credentials (passwords, tokens, secrets)' })
  }
  // Derive idempotencyKey from templateKey and toEmail to prevent duplicate enqueues
  const idempotencyKey = `${templateKey}:${toEmail}`
  try {
     const row = await emailService.enqueue({ templateKey, toEmail, payload, subject })
     emailService.processBatch().catch(e => console.error('[email/send] immediate process failed', e))
     return res.status(202).json({ ok: true, outboxId: row.id })
   } catch (e) {
    console.error('[email/send] enqueue failed', e)
    return res.status(500).json({ error: e.message })
  }
}
