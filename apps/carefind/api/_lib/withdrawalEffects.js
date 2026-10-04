// What happens AFTER the database settled a CareFind withdrawal: the user's trust tier and the email. Nothing here
// moves money and nothing here may fail a settlement - every effect is best-effort. It is called only with the
// result of a settle_withdrawal() call that CHANGED the request ('completed' / 'refunded'), so redeliveries and
// racing paths cannot count a withdrawal twice.
import { createClient } from '@supabase/supabase-js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from './emailService.js'

async function recordTrust(supabase, userId, amount, status) {
  try {
    const { error } = await supabase.rpc('update_withdrawal_trust_after_withdrawal', { p_user_id: userId, p_amount: amount, p_status: status })
    if (error) console.error('[withdrawal-effects] trust update failed:', error.message)
  } catch (err) {
    console.error('[withdrawal-effects] trust update error:', err)
  }
}

async function emailOf(supabase, userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    return data?.user?.email || null
  } catch {
    return null
  }
}

async function send(message) {
  try {
    await enqueueOutbox(message)
    flushOutbox().catch((err) => console.error('[withdrawal-effects] flush error:', err))
  } catch (err) {
    console.error('[withdrawal-effects] email error:', err)
  }
}

/**
 * @param {object} supabase   service-role client
 * @param {'success'|'failed'|'reversed'} outcome  what the provider reported
 * @param {object} result     settle_withdrawal() result (id, user_id, amount, from_status, result, reference)
 */
export async function applyWithdrawalResult(supabase, outcome, result) {
  if (!result?.user_id) return
  const { user_id: userId, amount, id, reference, from_status: from } = result

  if (result.result === 'completed') {
    // Trust counts a withdrawal when the transfer SETTLES, not when it was merely accepted.
    await recordTrust(supabase, userId, amount, 'completed')
    const email = await emailOf(supabase, userId)
    if (email) {
      await send({
        templateKey: 'withdrawal_completed', toEmail: email,
        payload: { fullName: email, amount, reference },
        subject: 'CareFind: withdrawal settled', sourceId: id, idempotencyKey: `withdrawal-completed:${reference}`,
      })
    }
    return
  }

  if (result.result === 'refunded') {
    // A transfer that never happened is not withdrawal behaviour; one that completed and was later reversed was
    // already counted as completed, so no failure is recorded for it either.
    if (from === 'reserved' || from === 'processing') await recordTrust(supabase, userId, amount, 'failed')
    const email = await emailOf(supabase, userId)
    if (email) {
      await send({
        templateKey: 'withdrawal_failed', toEmail: email,
        payload: { fullName: email, amount, reference },
        subject: 'CareFind: withdrawal failed', sourceId: id, idempotencyKey: `withdrawal-failed:${reference}`,
      })
    }
  }
}

export function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}
