import { TrendingUp, TrendingDown, History } from 'lucide-react'
import { fmt, fmtDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { useProductInsight } from './hooks'

const { navy, gray500, warning, success } = theme

// Under a purchase line linked to a product: when it was last bought, from
// whom, at what unit cost, the average, how often, and how the cost typed now
// compares with the last one. `insights` is useProductInsights(); a product
// outside its window is asked for on its own.
export default function ProductInsight({ brandId, product, cost, insights, id }) {
  const cached = insights.lookup(product)
  const needOwn = insights.status === 'ready' && !cached && !insights.complete
  const own = useProductInsight(brandId, product, needOwn)
  if (insights.status === 'unavailable' || insights.status === 'error' || own.isError) return null
  if (insights.status === 'loading' || (needOwn && own.isLoading)) {
    return <div id={id} role='status' style={{ fontSize: 11.5, color: gray500 }}>Checking earlier purchases…</div>
  }
  const s = cached || own.data
  if (!s) return <div id={id} style={{ fontSize: 11.5, color: gray500 }}>No earlier purchase of this product recorded.</div>

  const last = Number(s.last_cost) || 0
  const now = Number(cost) || 0
  const pct = last > 0 && now > 0 ? Math.round(((now - last) / last) * 100) : null
  const times = Number(s.times_purchased) || 0
  return (
    <div id={id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap', fontSize: 11.5, color: gray500, lineHeight: 1.5 }}>
      <History size={12} aria-hidden='true' style={{ marginTop: 3, flexShrink: 0 }} />
      <span style={{ flex: '1 1 200px' }}>
        Last bought <strong style={{ color: navy }}>{fmtDate(s.last_date)}</strong>
        {s.last_supplier ? <> from <strong style={{ color: navy }}>{s.last_supplier}</strong></> : null}
        {': '}{Number(s.last_qty) || 0} at <strong style={{ color: navy }}>{fmt(last)}</strong>
        {s.previous_cost != null && Number(s.previous_cost) !== last ? <> (before that {fmt(s.previous_cost)})</> : null}
        {' · '}average {fmt(s.avg_cost)} · bought {times} time{times === 1 ? '' : 's'}, {fmt(s.total_spent)} in all
      </span>
      {pct != null && pct !== 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 800, color: pct > 0 ? warning : success, whiteSpace: 'nowrap' }}>
          {pct > 0 ? <TrendingUp size={12} aria-hidden='true' /> : <TrendingDown size={12} aria-hidden='true' />}
          {pct > 0 ? '+' : ''}{pct}% vs last price
        </span>
      )}
      {pct === 0 && <span style={{ fontWeight: 700, color: success, whiteSpace: 'nowrap' }}>Same as last price</span>}
    </div>
  )
}
