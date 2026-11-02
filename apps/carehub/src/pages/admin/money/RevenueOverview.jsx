import { useState, useEffect, useCallback, useMemo } from 'react'
import { TrendingUp, RefreshCw, Download, AlertTriangle, Table as TableIcon, BarChart3 } from 'lucide-react'
import { Card, GhostBtn, Loading, ErrorState, Empty, useToast, Toast } from '../../../components/ui'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import { createMoneyRepository } from '../../../modules/money/repositories'
import { computeRevenue, PAYMENT_EXPORT_COLUMNS } from '../../../modules/money/services/revenue'
import { readableError } from '../../../modules/money/services/subscriptionAdmin'
import { toCsv, downloadCsv, exportStamp } from '../../../lib/carefindhubExports'
import { useAuditedExport } from '../shared/AuditedExport'

// Money › Revenue: what CareHub plans have actually earned. Collected figures come from settled plan_payments;
// plan mix, renewals and overdue counts from admin_subscription_overview(); prices from lib/planLimits.js.
// Definitions live in modules/money/services/revenue.js and are repeated beside each figure.

const naira = (n) => `₦${Math.round(Number(n) || 0).toLocaleString('en-NG')}`
const compact = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `₦${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`
  if (v >= 1e4) return `₦${Math.round(v / 1e3)}K`
  return naira(v)
}
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const METHOD_LABELS = { paystack: 'Paystack', wallet: 'Wallet', manual: 'Recorded by staff', unknown: 'Not recorded' }
const cardStyle = { padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }
const sectionTitle = { margin: 0, fontWeight: 800, fontSize: 13, color: 'var(--fg)' }

function StatTile({ label, value, note, tone }) {
  return (
    <Card style={{ ...cardStyle, padding: 14, ...(tone === 'warning' ? { background: 'var(--amber-bg)', border: '1px solid var(--amber)' } : {}) }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>{note}</div>}
    </Card>
  )
}

// Money collected per Lagos calendar month: one series, so no legend (the title names it). Each column is a
// focusable hit target with its value in a tooltip and in the table view; only the peak carries a direct label.
function MonthlyChart({ months, isMobile }) {
  const [active, setActive] = useState(null)
  const [asTable, setAsTable] = useState(false)
  const max = Math.max(...months.map(m => m.total), 0)
  const peak = max > 0 ? months.findIndex(m => m.total === max) : -1
  const HEIGHT = 150

  return (
    <Card style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h3 style={sectionTitle}>Collected per month</h3>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Last 12 months, by payment date (Lagos time)</div>
        </div>
        <GhostBtn onClick={() => setAsTable(v => !v)} aria-pressed={asTable}>
          {asTable ? <BarChart3 size={12} style={{ marginRight: 6 }} aria-hidden="true" /> : <TableIcon size={12} style={{ marginRight: 6 }} aria-hidden="true" />}
          {asTable ? 'Show chart' : 'Show table'}
        </GhostBtn>
      </div>
      {asTable ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <caption className="sr-only">Money collected per month</caption>
            <thead><tr>{['Month', 'Payments', 'Collected'].map((h, i) => <th key={h} scope="col" style={{ textAlign: i ? 'right' : 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
            <tbody>{months.map(m => (
              <tr key={m.key} style={{ borderBottom: '1px solid var(--hairline)' }}>
                <td style={{ padding: '6px 8px', color: 'var(--fg)' }}>{m.label}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{m.count}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--fg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{naira(m.total)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: HEIGHT, fontSize: 10, color: 'var(--muted)', textAlign: 'right', minWidth: 36, fontVariantNumeric: 'tabular-nums' }}>
            <span>{compact(max)}</span><span>₦0</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div role="list" aria-label="Collected per month" style={{ position: 'relative', height: HEIGHT, display: 'flex', alignItems: 'flex-end', gap: 2, borderTop: '1px solid var(--hairline)', borderBottom: '1px solid var(--border)' }}>
              {months.map((m, i) => {
                const h = max > 0 ? Math.round((m.total / max) * (HEIGHT - 20)) : 0
                return (
                  <div key={m.key} role="listitem" tabIndex={0} aria-label={`${m.label}: ${naira(m.total)} from ${m.count} payment${m.count === 1 ? '' : 's'}`}
                    onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                    style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', position: 'relative', cursor: 'default', outlineOffset: 2 }}>
                    {i === peak && <span aria-hidden="true" style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg)', marginBottom: 2, whiteSpace: 'nowrap' }}>{compact(m.total)}</span>}
                    {h > 0 && <span aria-hidden="true" style={{ width: '100%', maxWidth: 24, height: Math.max(h, 2), background: 'var(--teal)', borderRadius: '4px 4px 0 0', opacity: active === null || active === i ? 1 : 0.55, transition: 'opacity 120ms' }} />}
                    {active === i && (
                      <span role="tooltip" style={{ position: 'absolute', bottom: '100%', left: '50%', transform: `translateX(${i < 2 ? '-20%' : i > months.length - 3 ? '-80%' : '-50%'})`, marginBottom: 4, background: 'var(--fg)', color: 'var(--bg)', fontSize: 11, padding: '6px 8px', borderRadius: 6, whiteSpace: 'nowrap', zIndex: 2, pointerEvents: 'none' }}>
                        <b>{m.label}</b> · {naira(m.total)} · {m.count} payment{m.count === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div aria-hidden="true" style={{ display: 'flex', gap: 2, marginTop: 4 }}>
              {months.map((m, i) => (
                <span key={m.key} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', visibility: isMobile && i % 2 === 1 && i !== months.length - 1 ? 'hidden' : 'visible' }}>{isMobile ? m.label.split(' ')[0] : m.label}</span>
              ))}
            </div>
          </div>
        </div>
      )}
      {max === 0 && !asTable && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>No plan payments in the last 12 months.</div>}
    </Card>
  )
}

export default function RevenueOverview({ repository: injected }) {
  const repository = useMemo(() => injected || createMoneyRepository(), [injected])
  const [payments, setPayments] = useState(null)
  const [subs, setSubs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { isMobile } = useBreakpoint()
  const { msg, type, show: showToast } = useToast()
  const { requestExport, exportDialog } = useAuditedExport({ onExported: (s) => showToast(`Exported ${s.rowCount} payment${s.rowCount === 1 ? '' : 's'}.`, { type: 'info' }) })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [p, s] = await Promise.all([repository.getSettledPlanPayments(), repository.getSubscriptionOverview()])
      setPayments(Array.isArray(p) ? p : []); setSubs(Array.isArray(s) ? s : [])
    } catch (e) {
      console.error('[admin-revenue] load failed', e)
      setError(readableError(e))
    }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  const r = useMemo(() => (payments && subs ? computeRevenue({ payments, subscriptions: subs }) : null), [payments, subs])

  if (loading && !r) return <Loading text="Loading revenue…" />
  if (error && !r) return <ErrorState message={error} onRetry={load} />

  const exportPayments = () => {
    const names = new Map(subs.map(s => [s.business_id, s.name]))
    const rows = payments.map(p => ({ ...p, business_name: names.get(p.business_id) || '' }))
    requestExport({ exportType: 'admin.plan_payments.csv', label: 'plan payments', rowCount: rows.length, run: () => downloadCsv(`plan_payments_${exportStamp()}.csv`, toCsv(PAYMENT_EXPORT_COLUMNS, rows)) })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ ...cardStyle, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 13, color: 'var(--fg)' }}>
          <TrendingUp size={14} style={{ color: 'var(--teal)' }} aria-hidden="true" /> Revenue
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>· plan payments received, and every business's plan</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={load} disabled={loading}><RefreshCw size={12} style={{ marginRight: 6 }} aria-hidden="true" />Refresh</GhostBtn>
          <GhostBtn onClick={exportPayments} disabled={!payments.length}><Download size={12} style={{ marginRight: 6 }} aria-hidden="true" />Export payments</GhostBtn>
        </div>
      </Card>
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <StatTile label="Collected this month" value={naira(r.monthTotal)} note={`${r.monthCount} payment${r.monthCount === 1 ? '' : 's'}`} />
        <StatTile label="Collected, last 30 days" value={naira(r.last30Total)} note={`${r.last30Count} payment${r.last30Count === 1 ? '' : 's'}`} />
        <StatTile label="Collected, all time" value={naira(r.totalCollected)} note={`${r.paymentCount} payment${r.paymentCount === 1 ? '' : 's'}`} />
        <StatTile label="Earning now, per month" value={naira(r.earningNow)} note="Each current payment ÷ months bought. Free access adds nothing." />
        <StatTile label="Paying businesses" value={`${r.payingCount} of ${r.businesses}`} note={r.payingCount ? `${naira(r.arpu)} a month each on average` : 'No paid period covers today'} />
        <StatTile label="Overdue" value={r.overdueCount} tone={r.overdueCount ? 'warning' : undefined} note={`${r.lapsed.count} paid before (${naira(r.lapsed.value)} at their last payment) · ${r.neverPaidCount} never paid`} />
      </div>

      <MonthlyChart months={r.months} isMobile={isMobile} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
        <Card style={cardStyle}>
          <h3 style={{ ...sectionTitle, marginBottom: 4 }}>Plan mix</h3>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>Main businesses by plan. List prices are what checkout charges per year.</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{['Plan', 'Businesses', 'Paying', 'Free', 'Overdue', 'List / year'].map((h, i) => <th key={h} scope="col" style={{ textAlign: i ? 'right' : 'left', padding: '6px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>{r.planMix.map(p => (
                <tr key={p.key} style={{ borderBottom: '1px solid var(--hairline)' }}>
                  <th scope="row" style={{ textAlign: 'left', padding: '6px', fontWeight: 700, color: 'var(--fg)' }}>{p.label}</th>
                  {[p.businesses, p.paying, p.free, p.overdue].map((v, i) => <td key={i} style={{ padding: '6px', textAlign: 'right', color: v ? 'var(--fg)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{v}</td>)}
                  <td style={{ padding: '6px', textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{p.yearlyPrice == null ? 'Negotiated' : naira(p.yearlyPrice)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {r.freeCount > 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{r.freeCount} business{r.freeCount === 1 ? ' is' : 'es are'} on free or complimentary access.</div>}
        </Card>

        <Card style={cardStyle}>
          <h3 style={{ ...sectionTitle, marginBottom: 4 }}>Renewals due in 30 days</h3>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>Paying businesses whose plan expires soon, valued at their last payment.</div>
          {r.renewalsDue.count === 0 ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>None in the next 30 days.</div> : (
            <>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--fg)', marginBottom: 8 }}>{naira(r.renewalsDue.value)} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>from {r.renewalsDue.count}</span></div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {r.renewalsDue.businesses.slice(0, 8).map(s => (
                  <li key={s.business_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                    <span style={{ color: 'var(--fg)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDay(s.expires_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 style={{ ...sectionTitle, margin: '16px 0 8px' }}>By payment method</h3>
          {r.byMethod.length === 0 ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>No payments yet.</div> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {r.byMethod.map(m => (
                <li key={m.method} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--fg)' }}>{METHOD_LABELS[m.method] || m.method} <span style={{ color: 'var(--muted)' }}>· {m.count}</span></span>
                  <span style={{ color: 'var(--fg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{naira(m.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card style={cardStyle}>
        <h3 style={{ ...sectionTitle, marginBottom: 10 }}>Recent payments</h3>
        {r.recent.length === 0 ? <Empty message="No plan payments yet. Payments appear here as soon as Paystack or the wallet settles a renewal." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{['Date', 'Business', 'Amount', 'Plan', 'Months', 'Method', 'Receipt'].map((h, i) => <th key={h} scope="col" style={{ textAlign: i === 2 || i === 4 ? 'right' : 'left', padding: '6px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>{r.recent.map(p => (
                <tr key={p.id || p.reference} style={{ borderBottom: '1px solid var(--hairline)' }}>
                  <td style={{ padding: '6px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDay(p.paid_at)}</td>
                  <td style={{ padding: '6px', color: 'var(--fg)', fontWeight: 600 }}>{p.business_name || 'Business'}</td>
                  <td style={{ padding: '6px', textAlign: 'right', color: 'var(--fg)', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{naira(p.naira_amount)}</td>
                  <td style={{ padding: '6px', color: 'var(--muted)', textTransform: 'capitalize' }}>{p.plan || '—'}</td>
                  <td style={{ padding: '6px', textAlign: 'right', color: 'var(--muted)' }}>{p.months}</td>
                  <td style={{ padding: '6px', color: 'var(--muted)' }}>{METHOD_LABELS[p.payment_method] || p.payment_method || '—'}</td>
                  <td style={{ padding: '6px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{p.receipt_number || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      {r.lapsed.count > 0 && (
        <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 12, background: 'var(--amber-bg)', border: '1px solid var(--amber)', fontSize: 12, color: 'var(--fg)' }}>
          <AlertTriangle size={14} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span><b>{r.lapsed.count}</b> business{r.lapsed.count === 1 ? ' that has' : 'es that have'} paid before {r.lapsed.count === 1 ? 'is' : 'are'} now overdue. Reminder emails go out automatically; manage them under Subscriptions.</span>
        </div>
      )}
      {exportDialog}
      <Toast msg={msg} type={type} />
    </div>
  )
}
