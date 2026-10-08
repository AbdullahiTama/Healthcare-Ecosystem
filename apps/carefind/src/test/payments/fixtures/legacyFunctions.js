// Production's CareCoin functions as they exist BEFORE the Phase 05 migrations, reduced to stubs with the
// same signatures and the same grants (read live 2026-10-03). The migrations CREATE OR REPLACE them, which
// keeps the existing ACL - so a test that wants to prove "grants are unchanged" must start from these.
const LEGACY = [
  ['credit_wallet_topup(p_user_id uuid, p_coins integer, p_naira_amount integer, p_reference text)', 'table(already_processed boolean, new_balance integer)', 'select false, 0', 'service_role'],
  ['settle_subscription_payment(p_subscriber uuid, p_creator uuid, p_price integer, p_naira_amount integer, p_reference text)', 'table(already_processed boolean)', 'select false', 'service_role'],
  ['settle_consultation_payment(p_patient uuid, p_professional uuid, p_fee numeric, p_reference text)', 'table(already_processed boolean, already_booked boolean)', 'select false, false', 'service_role'],
  ['pay_booking_with_credits(p_user_id uuid, p_appointment_id uuid)', 'text', "select 'old'::text", 'service_role'],
  ['pay_creator_subscription(p_creator uuid, p_price integer)', 'text', "select 'old'::text", 'authenticated, service_role'],
  ['pay_professional_consultation(p_professional uuid)', 'text', "select 'old'::text", 'authenticated, service_role'],
  ['send_gift(p_recipient uuid, p_coins integer, p_gift_type text, p_gift_emoji text, p_post_id uuid default null, p_live_session_id uuid default null)', 'text', "select 'old'::text", 'authenticated, service_role'],
  ['request_withdrawal(p_user_id uuid, p_amount integer, p_bank_name text, p_account_number text, p_account_name text, p_reference text default null, p_daily_cap_coins integer default null)', 'text', "select 'old'::text", 'service_role'],
  ['reject_withdrawal_request(p_request_id uuid)', 'text', "select 'old'::text", 'service_role'],
  ['refund_appointment_payment(p_appointment_id uuid)', 'text', "select 'old'::text", 'service_role'],
]

export const LEGACY_FUNCTION_NAMES = LEGACY.map(([sig]) => sig.slice(0, sig.indexOf('(')))

export async function createLegacyStubs(db) {
  for (const [sig, returns, body, grant] of LEGACY) {
    const name = sig.slice(0, sig.indexOf('('))
    await db.exec(`create function public.${sig} returns ${returns} language sql as $$ ${body} $$;`)
    const types = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')).split(',').map((a) => a.trim().split(/\s+/)[1]).join(', ')
    await db.exec(`revoke all on function public.${name}(${types}) from public, anon, authenticated, service_role; grant execute on function public.${name}(${types}) to ${grant};`)
  }
}
