import { createClient } from '@supabase/supabase-js'
import { verifyBusiness } from './_lib/verifyBusiness.js'
import { paystackFetch } from './_lib/paystack.js'
import { computeCommission } from './_lib/commissions.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Called when the business owner is redirected back from Paystack. Asks
// Paystack directly whether the charge succeeded before extending anything —
// nothing here is trusted from the client except which reference to look
// up, same principle as CareFind's api/verify-payment.js.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

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

  const { metadata, amount } = paystackData.data
  if (!metadata?.business_id || !metadata?.months) {
    return res.status(400).json({ error: 'Transaction has no plan metadata' })
  }
  if (metadata.business_id !== business.id) {
    return res.status(403).json({ error: 'This transaction does not belong to your business' })
  }

  const months = parseInt(metadata.months)
  const { data, error } = await supabase.rpc('renew_business_plan', {
    p_business_id: business.id,
    p_months: months,
    p_naira_amount: amount,
    p_reference: reference,
  })
  if (error) return res.status(500).json({ error: error.message })

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return res.status(500).json({ error: 'Could not renew plan' })
  if (row.already_processed) {
    // Commission may have been skipped if the webhook settled first; attempt it
    // now (idempotent via UNIQUE payment_id).
    const { data: paymentRow } = await supabase
      .from('plan_payments')
      .select('id, is_first_payment')
      .eq('reference', reference)
      .maybeSingle()
    if (paymentRow?.id) {
      try {
        await computeCommission(supabase, {
          paymentId: paymentRow.id,
          businessId: business.id,
          nairaCharged: amount / 100,
          isFirstPayment: paymentRow.is_first_payment,
        })
      } catch (err) {
        console.error('Commission computation failed:', err)
      }
    }
    return res.status(200).json({ alreadyProcessed: true })
  }

  if (row.payment_id) {
    try {
      await computeCommission(supabase, {
        paymentId: row.payment_id,
        businessId: business.id,
        nairaCharged: amount / 100,
        isFirstPayment: row.is_first_payment,
      })
    } catch (err) {
      console.error('Commission computation failed:', err)
    }
  }

  return res.status(200).json({ credited: true, newExpiry: row.new_expiry })
}
