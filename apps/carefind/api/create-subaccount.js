import { createClient } from '@supabase/supabase-js'
import { verifyUser } from './_lib/verifyUser.js'

// Creates a Paystack subaccount for a verified professional so payments
// (subscriptions, tips, consultations) can be split between the platform
// and the professional automatically.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { bankCode, accountNumber, accountName } = req.body
  if (!bankCode || !accountNumber || !accountName) {
    return res.status(400).json({ error: 'bankCode, accountNumber and accountName required' })
  }

  // Verify the user is a verified professional
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, is_verified, paystack_subaccount_code')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !profile.is_verified) {
    return res.status(403).json({ error: 'Only verified professionals can create a subaccount' })
  }

  // If they already have a subaccount, return it
  if (profile.paystack_subaccount_code) {
    return res.status(200).json({ subaccount_code: profile.paystack_subaccount_code, existing: true })
  }

  try {
    const response = await fetch('https://api.paystack.co/subaccount', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_name: accountName,
        settlement_bank: bankCode,
        account_number: accountNumber,
        percentage_charge: 10, // Platform takes 10%, creator gets 90%
        primary_contact_email: user.email,
        metadata: { user_id: user.id },
      }),
    })

    const data = await response.json()
    if (!data.status) return res.status(400).json({ error: data.message || 'Paystack error' })

    // Store the subaccount code on the profile
    await supabase
      .from('profiles')
      .update({ paystack_subaccount_code: data.data.subaccount_code })
      .eq('id', user.id)

    return res.status(200).json({ subaccount_code: data.data.subaccount_code })
  } catch (err) {
    return res.status(500).json({ error: 'Could not create subaccount' })
  }
}