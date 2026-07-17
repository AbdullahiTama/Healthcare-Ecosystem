import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Verify webhook signature
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex')

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const event = req.body

  if (event.event === 'charge.success') {
    const { reference, metadata } = event.data

    if (!metadata?.user_id || !metadata?.coins) {
      return res.status(200).json({ received: true })
    }

    const userId = metadata.user_id
    const coins = parseInt(metadata.coins)
    const nairaAmount = event.data.amount

    // Check not already processed
    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', reference)
      .maybeSingle()

    if (existing) return res.status(200).json({ already_processed: true })

    // Get current balance
    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle()

    const currentBalance = wallet?.balance || 0
    const newBalance = currentBalance + coins

    // Credit wallet
    if (wallet) {
      await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', userId)
    } else {
      await supabase.from('wallets').insert({ user_id: userId, balance: newBalance })
    }

    // Log transaction
    await supabase.from('transactions').insert({
      user_id: userId,
      type: 'topup',
      amount: coins,
      naira_amount: nairaAmount,
      reference,
      status: 'success',
    })

    return res.status(200).json({ credited: coins, new_balance: newBalance })
  }

  return res.status(200).json({ received: true })
}
