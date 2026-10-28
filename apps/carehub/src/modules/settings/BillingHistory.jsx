import { useEffect, useState } from 'react'
import { Printer, Receipt, RefreshCw } from 'lucide-react'
import { settingsRepository } from './repositories'
import {
  attemptStatus, confirmPlanPayment, formatDate, formatDateTime, formatNaira, methodLabel, periodLabel, planLabel,
  printReceipt, usageMeters,
} from './services/billing'
import { theme } from '../../styles/theme'
import { Empty, ErrorState, GhostBtn, Loading, Modal, Pill, TealBtn } from '../../components/ui'

const { navy, gray600, gray500, gray400, gray100, border, tealDeep, success, warning, danger } = theme

// Subscription usage, payment history, receipts and unconfirmed attempts for the Owner (Settings → Billing).
// Data: business_billing_overview (Owner-only in the database). `reloadKey` changes when the parent has just renewed
// the plan; `onRenewed(newExpiry)` tells the parent when "Check payment" renews it here.
export default function BillingHistory({ businessId, reloadKey, onRenewed, showToast }) {
  const [overview, setOverview] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | error
  const [receipt, setReceipt] = useState(null)
  const [checking, setChecking] = useState(null)

  useEffect(() => { if (businessId) load() }, [businessId, reloadKey])

  async function load() {
    setState('loading')
    try {
      setOverview(await settingsRepository.getBillingOverview(businessId))
      setState('ready')
    } catch (e) {
      console.error('[BillingHistory] load failed', e)
      setState('error')
    }
  }

  async function check(attempt) {
    setChecking(attempt.reference)
    try {
      const out = await confirmPlanPayment(attempt.reference)
      if (out.credited) {
        showToast('Payment confirmed. Your plan now runs to ' + formatDate(out.newExpiry) + '.', { type: 'success' })
        onRenewed?.(out.newExpiry)
      } else {
        showToast('This payment was already applied to your plan.', { type: 'info' })
      }
      await load()
    } catch (e) {
      showToast(e.message === 'Payment not confirmed by Paystack'
        ? 'Paystack has no completed payment for this attempt. You were not charged for it.'
        : 'Could not check this payment: ' + e.message, { type: 'error' })
    }
    setChecking(null)
  }

  function print(payment) {
    if (!printReceipt(payment, overview?.business)) showToast('Allow pop-ups for this site to print the receipt.', { type: 'warning' })
  }

  if (state === 'loading') return <Loading text='Loading billing history…' />
  if (state === 'error') return <ErrorState message="We couldn't load your billing history." onRetry={load} />
  if (!overview) return null

  const payments = overview.payments || []
  const attempts = overview.attempts || []
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const sectionTitle = { fontSize: '14px', fontWeight: '800', color: navy, margin: '20px 0 10px' }
  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '12px 14px', border: `1px solid ${border}`, borderRadius: theme.radius.md }

  return (
    <section aria-label='Subscription usage and billing history'>
      <div style={sectionTitle}>Plan usage</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
        {usageMeters(overview).map(m => {
          const color = m.tone === 'full' ? danger : m.tone === 'near' ? warning : success
          return (
            <div key={m.key} style={{ padding: '12px 14px', border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: gray500 }}>
                <span>{m.label}</span>
                <span style={{ fontWeight: '700', color: navy }}>{m.used.toLocaleString()} / {m.limit === null ? 'Unlimited' : m.limit.toLocaleString()}</span>
              </div>
              {m.limit !== null && (
                <div role='progressbar' aria-label={`${m.label} used`} aria-valuemin={0} aria-valuemax={m.limit} aria-valuenow={m.used}
                  style={{ height: 6, borderRadius: 3, background: gray100, marginTop: '8px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(m.ratio * 100)}%`, height: '100%', background: color }} />
                </div>
              )}
              {m.tone === 'full' && <div style={{ fontSize: '11px', color: danger, marginTop: '6px' }}>Limit reached. Upgrade to add more.</div>}
            </div>
          )
        })}
      </div>

      <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px' }}>
        <span>Payment history</span>
        {payments.length > 0 && <span style={{ fontSize: '12px', fontWeight: '600', color: gray500 }}>{payments.length} payment{payments.length === 1 ? '' : 's'} · {formatNaira(totalPaid)} total</span>}
      </div>
      {payments.length === 0 ? (
        <Empty icon={<Receipt size={32} strokeWidth={1.5} color={gray400} />} title='No payments yet' description='Your subscription payments and receipts will appear here after your first renewal.' />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {payments.map(p => (
            <li key={p.id} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{formatNaira(p.amount)}</span>
                  <Pill label='Paid' type='green' />
                  <span style={{ fontSize: '12px', color: gray600 }}>{planLabel(p.plan)} · {periodLabel(p.months)}</span>
                </div>
                <div style={{ fontSize: '12px', color: gray500, marginTop: '4px' }}>
                  {formatDate(p.paid_at)} · {p.receipt_number} · covers {formatDate(p.period_start)} – {formatDate(p.period_end)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <GhostBtn onClick={() => setReceipt(p)} aria-label={`View receipt ${p.receipt_number}`}>View receipt</GhostBtn>
                <GhostBtn onClick={() => print(p)} aria-label={`Print receipt ${p.receipt_number}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Printer size={14} aria-hidden='true' /> Print</GhostBtn>
              </div>
            </li>
          ))}
        </ul>
      )}

      {attempts.length > 0 && (
        <>
          <div style={sectionTitle}>Unconfirmed attempts</div>
          <p style={{ fontSize: '12px', color: gray500, margin: '-4px 0 10px', lineHeight: 1.6 }}>
            Checkouts from the last 180 days that did not renew your plan. If money left your account for one of these, use “Check payment” and we will confirm it with Paystack.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {attempts.map(a => {
              const st = attemptStatus(a)
              return (
                <li key={a.reference} style={row}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: '700', fontSize: '14px', color: navy }}>{formatNaira(a.amount)}</span>
                      <Pill label={st.label} type={st.tone} />
                      {a.months ? <span style={{ fontSize: '12px', color: gray600 }}>{planLabel(a.plan)} · {periodLabel(a.months)}</span> : null}
                    </div>
                    <div style={{ fontSize: '12px', color: gray500, marginTop: '4px', wordBreak: 'break-all' }}>{formatDateTime(a.created_at)} · Ref {a.reference}</div>
                    <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{st.note}</div>
                  </div>
                  {st.canCheck && (
                    <TealBtn onClick={() => check(a)} disabled={!!checking} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <RefreshCw size={14} aria-hidden='true' /> {checking === a.reference ? 'Checking…' : 'Check payment'}
                    </TealBtn>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      <Modal show={!!receipt} onClose={() => setReceipt(null)} title={receipt ? `Receipt ${receipt.receipt_number}` : 'Receipt'}
        footer={<><GhostBtn onClick={() => setReceipt(null)} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn><TealBtn onClick={() => print(receipt)} style={{ flex: 1, padding: '12px' }}>Print receipt</TealBtn></>}>
        {receipt && (
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(110px, 40%) 1fr', rowGap: '10px', columnGap: '12px', fontSize: '13px' }}>
            {[
              ['Status', <Pill key='s' label='Paid' type='green' />],
              ['Amount', <strong key='a'>{formatNaira(receipt.amount)}</strong>],
              ['Plan', `${planLabel(receipt.plan)} · ${periodLabel(receipt.months)}`],
              ['Service period', `${formatDate(receipt.period_start)} – ${formatDate(receipt.period_end)}`],
              ['Paid on', formatDateTime(receipt.paid_at)],
              ['Method', methodLabel(receipt.payment_method)],
              ['Reference', receipt.reference],
              ...(receipt.provider_transaction_id ? [['Paystack transaction ID', receipt.provider_transaction_id]] : []),
              ['Billed to', overview.business?.name],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: gray500 }}>{k}</dt>
                <dd style={{ margin: 0, color: navy, wordBreak: 'break-all' }}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <p style={{ fontSize: '11px', color: gray400, marginTop: '14px' }}>Quote the receipt number <span style={{ color: tealDeep, fontWeight: 700 }}>{receipt?.receipt_number}</span> if you contact support about this payment.</p>
      </Modal>
    </section>
  )
}
