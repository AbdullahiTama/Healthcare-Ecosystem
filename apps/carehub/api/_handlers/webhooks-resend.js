import { supabase } from '../_lib/supabase.js'
import { verifySvixSignature, applyResendEvent } from '@care-ecosystem/shared-email'

// Resend signs the EXACT bytes it sends (Svix: svix-id / svix-timestamp / svix-signature), so the body must not be
// parsed and re-serialised before it is verified. The router keeps the bytes as req.rawBody (see rehydrateBody); if they
// are ever missing, verification fails closed with a 401 rather than falling back to a re-serialised body.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Fail closed: without the secret nothing can be verified. A 5xx makes Resend redeliver once it is set.
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhooks/resend] RESEND_WEBHOOK_SECRET is not set - rejecting')
    return res.status(500).json({ error: 'Webhook secret not configured' })
  }

  const verdict = verifySvixSignature({ rawBody: req.rawBody, headers: req.headers, secret })
  if (!verdict.ok) {
    console.error('[webhooks/resend] rejected:', verdict.reason)
    return res.status(401).json({ error: 'Invalid signature' })
  }

  let event
  try {
    event = JSON.parse(Buffer.from(req.rawBody).toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  try {
    await applyResendEvent(supabase, { svixId: req.headers['svix-id'], event })
    return res.status(200).json({ ok: true })
  } catch (err) {
    // 5xx: Resend redelivers, and applyResendEvent is idempotent on the event id.
    console.error('[webhooks/resend] could not record event:', err?.message || err)
    return res.status(500).json({ error: 'Could not record event' })
  }
}
