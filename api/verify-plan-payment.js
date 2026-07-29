import { createClient } from '@supabase/supabase-js'
import { verifyBusiness } from './_lib/verifyBusiness.js'

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

  const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  })
  const paystackData = await paystackRes.json()

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

  const { data: existing } = await supabase
    .from('plan_payments')
    .select('id')
    .eq('reference', reference)
    .maybeSingle()
  if (existing) return res.status(200).json({ alreadyProcessed: true })

  const months = parseInt(metadata.months)
  // Extend from whichever is later: the current expiry (if still active, so
  // an early renewal doesn't lose the time already paid for) or right now
  // (if the plan had already lapsed).
  const base = business.plan_expires_at && new Date(business.plan_expires_at) > new Date()
    ? new Date(business.plan_expires_at)
    : new Date()
  const newExpiry = new Date(base)
  newExpiry.setMonth(newExpiry.getMonth() + months)

  await supabase.from('businesses').update({ plan_expires_at: newExpiry.toISOString() }).eq('id', business.id)
  await supabase.from('plan_payments').insert({
    business_id: business.id,
    months,
    naira_amount: amount,
    reference,
    status: 'success',
  })

  return res.status(200).json({ credited: true, newExpiry: newExpiry.toISOString() })
}
