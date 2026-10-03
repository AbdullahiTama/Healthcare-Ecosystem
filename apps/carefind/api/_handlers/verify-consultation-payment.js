import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { paystackFetch } from '../_lib/paystack.js'
import { settleConsultationPayment } from '../_lib/consultationSettle.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'

// Called when the user is redirected back from Paystack after booking a
// consultation by card. Verifies the payment with Paystack, then settles the
// booking atomically (see settle_consultation_payment). The webhook is the
// backup path when the redirect is missed ΓÇö the RPC makes both race-safe.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { reference } = req.body
  if (!reference) return res.status(400).json({ error: 'Missing reference' })

  let paystackData
  try {
    paystackData = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not verify payment' })
  }

  if (!paystackData.status || paystackData.data?.status !== 'success') {
    return res.status(400).json({ error: 'Payment not confirmed by Paystack' })
  }

  const { metadata } = paystackData.data
  if (!metadata?.user_id || !metadata?.professional_id || metadata?.purpose !== 'consultation') {
    return res.status(400).json({ error: 'Invalid transaction metadata' })
  }

  if (metadata.user_id !== user.id) {
    return res.status(403).json({ error: 'This transaction does not belong to you' })
  }

  try {
    const result = await settleConsultationPayment(supabase, {
      patientId: metadata.user_id,
      professionalId: metadata.professional_id,
      nairaAmount: Math.round(paystackData.data.amount / 100),
      reference,
    })

    // Email must not gate or fail the verified settlement. The shared
    // outbox provider handles retries asynchronously.
    try {
      if (user.email) {
        await enqueueOutbox({
          templateKey: 'consultation_confirmed',
          toEmail: user.email,
          payload: {
            fullName: user.user_metadata?.full_name || user.email,
            service: 'Consultation',
          },
          subject: 'Your CareFind consultation is confirmed',
          idempotencyKey: `consultation-confirmed:${reference}`,
        })
        flushOutbox().catch((err) => console.error('[verify-consultation-payment] outbox flush error:', err))
      }
    } catch (err) {
      console.error('[verify-consultation-payment] email enqueue error:', err)
    }

    return res.status(200).json({ success: true, ...result })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not settle payment' })
  }
}
