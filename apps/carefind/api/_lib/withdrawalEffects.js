// What happens AFTER the database settled a CareFind withdrawal: the user's trust tier and the email. Nothing here
// moves money and nothing here may fail a settlement - every effect is best-effort. It is called only with the
// result of a settle_withdrawal() call that CHANGED the request ('completed' / 'refunded'), so redeliveries and
// racing paths cannot count a withdrawal twice.
//
// Emails: the customer's real name, the naira amount actually paid out, the coins, the bank and ONLY the last four
// digits of the account. Every email carries a key derived from the withdrawal reference, so a replayed webhook, a
// sweep and the request path can all call this and the customer still gets one. An enqueue that fails is logged as
// `email.enqueue_failed` and is picked up later by the notification backfill (api/_lib/moneyNotifications.js).
import { createClient } from '@supabase/supabase-js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from './emailService.js'

const NGN = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })
const last4 = (n) => { const d = String(n ?? '').replace(/\D/g, ''); return d ? `••••${d.slice(-4)}` : '' }

async function recordTrust(supabase, userId, amount, status) {
  try {
    const { error } = await supabase.rpc('update_withdrawal_trust_after_withdrawal', { p_user_id: userId, p_amount: amount, p_status: status })
    if (error) console.error('[withdrawal-effects] trust update failed:', error.message)
  } catch (err) {
    console.error('[withdrawal-effects] trust update error:', err)
  }
}

async function recipientOf(supabase, userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    const user = data?.user
    return user?.email ? { email: user.email, fullName: user.user_metadata?.full_name || 'there' } : null
  } catch {
    return null
  }
}

async function bankOf(supabase, requestId) {
  try {
    const { data } = await supabase.from('withdrawal_requests').select('bank_name, account_number').eq('id', requestId).maybeSingle()
    return { bankName: data?.bank_name || '', accountNumber: last4(data?.account_number) }
  } catch {
    return { bankName: '', accountNumber: '' }
  }
}

async function send(message) {
  try {
    await enqueueOutbox(message)
  } catch (err) {
    console.error('[withdrawal-effects] email.enqueue_failed', JSON.stringify({ template: message.templateKey, id: message.sourceId, message: String(err.message).replace(/\S+@\S+/g, '[email]').slice(0, 120) }))
    return
  }
  flushOutbox().catch((err) => console.error('[withdrawal-effects] flush error:', err))
}

/** The fields every withdrawal email shares, built from a settle_withdrawal()/sweep row. */
function messageFields(row, bank) {
  const payoutKobo = Number(row.payout_kobo)
  return {
    amount: Number.isFinite(payoutKobo) && payoutKobo > 0 ? NGN.format(payoutKobo / 100) : '',
    coins: row.amount != null ? String(row.amount) : '',
    reference: row.reference || row.paystack_reference || '',
    bankName: bank.bankName,
    accountNumber: bank.accountNumber,
  }
}

/** The "withdrawal sent" e-mail only (no trust update). `row`: id, user_id, amount, payout_kobo, reference. */
export async function emailWithdrawalCompleted(supabase, row) {
  const [who, bank] = await Promise.all([recipientOf(supabase, row.user_id), bankOf(supabase, row.id)])
  if (!who) return
  await send({
    templateKey: 'withdrawal_completed', toEmail: who.email,
    payload: { fullName: who.fullName, ...messageFields(row, bank) },
    subject: 'CareFind: withdrawal settled', sourceId: row.id, idempotencyKey: `withdrawal-completed:${row.reference}`,
  })
}

/** The "withdrawal could not be completed, coins returned" e-mail only (no trust update). */
export async function emailWithdrawalFailed(supabase, row) {
  const who = await recipientOf(supabase, row.user_id)
  if (!who) return
  await send({
    templateKey: 'withdrawal_failed', toEmail: who.email,
    payload: { fullName: who.fullName, ...messageFields(row, { bankName: '', accountNumber: '' }) },
    subject: 'CareFind: withdrawal failed', sourceId: row.id, idempotencyKey: `withdrawal-failed:${row.reference}`,
  })
}

/**
 * @param {object} supabase   service-role client
 * @param {'success'|'failed'|'reversed'} outcome  what the provider reported
 * @param {object} result     settle_withdrawal() result (id, user_id, amount, payout_kobo, from_status, result, reference)
 */
export async function applyWithdrawalResult(supabase, outcome, result) {
  if (!result?.user_id) return
  const { user_id: userId, amount, id, reference, from_status: from } = result

  if (result.result === 'completed') {
    // Trust counts a withdrawal when the transfer SETTLES, not when it was merely accepted.
    await recordTrust(supabase, userId, amount, 'completed')
    await emailWithdrawalCompleted(supabase, { ...result, reference })
    return
  }

  if (result.result === 'refunded') {
    // A transfer that never happened is not withdrawal behaviour; one that completed and was later reversed was
    // already counted as completed, so no failure is recorded for it either.
    if (from === 'reserved' || from === 'processing') await recordTrust(supabase, userId, amount, 'failed')
    await emailWithdrawalFailed(supabase, { ...result, reference })
  }
}

/**
 * A transfer that Paystack still reports as in flight well after it was sent (the sweep calls this): one reassuring email
 * per withdrawal, never repeated (the key is the reference). Nothing for the customer to do.
 * @param {object} row  a withdrawal_requests row (id, user_id, amount, payout_kobo, paystack_reference)
 */
export async function applyWithdrawalInFlight(supabase, row) {
  if (!row?.user_id || !row?.paystack_reference) return
  const [who, bank] = await Promise.all([recipientOf(supabase, row.user_id), bankOf(supabase, row.id)])
  if (!who) return
  await send({
    templateKey: 'withdrawal_processing', toEmail: who.email,
    payload: { fullName: who.fullName, ...messageFields(row, bank) },
    subject: 'CareFind: your withdrawal is still processing', sourceId: row.id, idempotencyKey: `withdrawal-processing:${row.paystack_reference}`,
  })
}

export function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}
