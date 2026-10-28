import { authClient } from '../../../lib/authClient'
import { esc } from '../../../lib/escape.js'
import { PLAN_LABELS } from '../../../lib/planLimits'

// ── Subscription billing ──────────────────────────────────────────────────────
// The client half of business_billing_overview (supabase/migrations/carehub_20261218_subscription_billing.sql):
// wording for payments and attempts, usage meters, the printable receipt, and asking the server to confirm a
// payment with Paystack. Pure apart from confirmPlanPayment and printReceipt.

const DATE = { day: 'numeric', month: 'short', year: 'numeric' }
const DATE_TIME = { ...DATE, hour: 'numeric', minute: '2-digit' }

export const formatNaira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG')
export const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-NG', DATE) : '—')
export const formatDateTime = (d) => (d ? new Date(d).toLocaleString('en-NG', DATE_TIME) : '—')
export const planLabel = (plan) => PLAN_LABELS[plan] || (plan ? plan[0].toUpperCase() + plan.slice(1) : 'Plan')
export const periodLabel = (months) => (months === 12 ? '12 months' : months === 1 ? '1 month' : `${months} months`)

export function methodLabel(method) {
  if (method === 'wallet') return 'CareHub wallet'
  if (method === 'paystack') return 'Paystack (card / bank)'
  if (method === 'manual') return 'Recorded by CareHub'
  return method || '—'
}

// payment_intents.status → what the Owner is told, the pill colour, and whether "Check payment" can help.
// settle_payment_intent asks Paystack whatever the intent's status, except settled / needs_refund / refunded, so a
// payment marked failed or expired here can still be confirmed if the customer was in fact charged.
export function attemptStatus(attempt) {
  const paystack = attempt?.purpose === 'plan_renewal'
  switch (attempt?.status) {
    case 'needs_refund':
      return { label: 'Under review', tone: 'amber', note: 'We received this payment but could not apply it. Our team will refund or apply it. No action is needed.', canCheck: false }
    case 'refunded':
      return { label: 'Refunded', tone: 'gray', note: 'This payment was refunded.', canCheck: false }
    case 'failed':
      return { label: 'Not completed', tone: 'red', note: 'Paystack did not confirm this payment. If you were charged, check it below.', canCheck: paystack }
    case 'expired':
      return { label: 'Abandoned', tone: 'gray', note: 'Checkout was started but not finished.', canCheck: paystack }
    default:
      return { label: 'Awaiting confirmation', tone: 'amber', note: 'If you completed payment, confirm it with Paystack.', canCheck: paystack }
  }
}

// One meter per plan limit. `limit` null = unlimited (the database's convention).
export function usageMeters(overview) {
  const usage = overview?.usage || {}
  const limits = overview?.limits || {}
  return [['staff', 'Staff'], ['locations', 'Locations'], ['products', 'Products']].map(([key, label]) => {
    const used = Number(usage[key] || 0)
    const limit = limits[key] === null || limits[key] === undefined ? null : Number(limits[key])
    const ratio = limit ? Math.min(used / limit, 1) : 0
    return { key, label, used, limit, ratio, tone: limit === null ? 'ok' : used >= limit ? 'full' : ratio >= 0.8 ? 'near' : 'ok' }
  })
}

// POST /api/verify-plan-payment: the server asks Paystack and, if it was paid, renews the plan (idempotent — the
// webhook may already have done it). Used on return from checkout and by "Check payment".
// → { credited: true, newExpiry } | { alreadyProcessed: true }; throws with the server's reason otherwise.
export async function confirmPlanPayment(reference, { fetchImpl = (...a) => fetch(...a), getSession = () => authClient.auth.getSession() } = {}) {
  const { data } = await getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Please sign in again.')
  const res = await fetchImpl('/api/verify-plan-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reference }),
  })
  let body = {}
  try { body = await res.json() } catch (e) {}
  if (!res.ok) throw new Error(body.error || 'Could not confirm this payment.')
  return body
}

// A4 receipt for one subscription payment. Every value is escaped: the business name and address are owner-typed.
export function buildReceiptHtml(payment, business) {
  const row = (k, v) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`
  const addr = [business?.address, [business?.city, business?.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(payment.receipt_number)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:720px;margin:0 auto;padding:32px}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0E6F5A;padding-bottom:16px}
    .brand{font-size:22px;font-weight:800;color:#0E6F5A}.muted{color:#64748b;font-size:12px;line-height:1.6}
    h1{font-size:18px;margin:24px 0 4px}.paid{display:inline-block;padding:4px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:700;font-size:12px}
    table{width:100%;border-collapse:collapse;margin-top:16px}td{padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;vertical-align:top}
    td.k{color:#64748b;width:40%}.total td{font-size:18px;font-weight:800;border-bottom:none;padding-top:16px}
    .foot{margin-top:32px;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6}
    @media print{body{padding:16mm}}
  </style></head><body>
    <div class="top">
      <div><div class="brand">CareHub</div><div class="muted">Subscription receipt</div></div>
      <div style="text-align:right"><div style="font-weight:800">${esc(payment.receipt_number)}</div><div class="muted">${esc(formatDateTime(payment.paid_at))}</div></div>
    </div>
    <h1>Billed to</h1>
    <div style="font-weight:700">${esc(business?.name)}</div>
    <div class="muted">${esc(addr)}${addr && business?.email ? '<br>' : ''}${esc(business?.email)}${business?.phone ? ' · ' + esc(business.phone) : ''}</div>
    <h1>Payment <span class="paid">PAID</span></h1>
    <table>
      ${row('Description', `CareHub ${planLabel(payment.plan)} plan — ${periodLabel(payment.months)}`)}
      ${row('Service period', `${formatDate(payment.period_start)} to ${formatDate(payment.period_end)}`)}
      ${row('Payment method', methodLabel(payment.payment_method))}
      ${row('Payment reference', payment.reference)}
      ${payment.provider_transaction_id ? row('Paystack transaction ID', payment.provider_transaction_id) : ''}
      <tr class="total"><td class="k">Amount paid</td><td>${esc(formatNaira(payment.amount))} ${esc(payment.currency && payment.currency !== 'NGN' ? payment.currency : '')}</td></tr>
    </table>
    <div class="foot">Thank you for using CareHub. Keep this receipt for your records.<br>Questions about this payment? Contact support@carehub.ng and quote ${esc(payment.receipt_number)}.</div>
  </body></html>`
}

// Same window.open + print pattern as the POS and consultation printers. Returns false when a pop-up blocker stopped it.
export function printReceipt(payment, business) {
  const w = window.open('', '_blank', 'width=780,height=900')
  if (!w) return false
  w.document.write(buildReceiptHtml(payment, business))
  w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 400)
  return true
}
