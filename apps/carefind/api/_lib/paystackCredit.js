// Shared by verify-payment.js (called when the user returns from Paystack)
// and paystack-webhook.js (Paystack's own async notification) — both are
// designed to race the same reference (the webhook is the backup path for
// when the redirect is missed), so this can't be a JS-level check-then-act:
// two concurrent calls could both pass a "does this reference exist yet"
// check before either had written anything. credit_wallet_topup() is a
// SECURITY DEFINER RPC (service_role-only — see wallet_payment_hardening.sql)
// that claims the reference against a partial unique index and credits the
// wallet as one atomic unit, so only one of the two racing calls can ever
// actually credit anything.
export async function creditTopup(supabase, { userId, coins, nairaAmount, reference }) {
  const { data, error } = await supabase.rpc('credit_wallet_topup', {
    p_user_id: userId,
    p_coins: coins,
    p_naira_amount: nairaAmount,
    p_reference: reference,
  })

  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  return { alreadyProcessed: row.already_processed, newBalance: row.new_balance }
}
