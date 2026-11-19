import { useEffect, useMemo, useState } from 'react'
import { Gauge } from 'lucide-react'
import { saleRepository } from '../pos/repositories'
import { isCompletedSale } from '../pos/salesReport'
import { classifySalesVelocity, VELOCITY_GROUPS, VELOCITY_WINDOW_DAYS } from '../../lib/velocity'
import { theme } from '../../styles/theme'
import { DataTable, Empty, ErrorState, Loading } from '../../components/ui'

const TONES = { fast: theme.success, steady: theme.tealDeep, slow: theme.warning, none: theme.danger }

// Stock Management ▸ Sales velocity: what the owner's "sales velocity" notification counts, product by product.
// The last 30 days of completed sales against the current stock, in four groups (lib/velocity.js), so the numbers
// here are the numbers in the notification. `group` (URL ?group=) opens one group.
export default function SalesVelocity({ brand, products = [], catalog, group = '', onGroupChange }) {
  const [sales, setSales] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!brand?.id) return
    let live = true
    setSales(null)
    setError('')
    const since = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 86400000).toISOString()
    saleRepository.getSince(brand.id, since)
      .then(rows => { if (live) setSales((rows || []).filter(isCompletedSale)) })
      .catch(e => {
        console.error('[stock] sales velocity: sales could not be loaded', e?.message || e)
        if (live) setError("We couldn't load the last " + VELOCITY_WINDOW_DAYS + " days of sales.")
      })
    return () => { live = false }
  }, [brand?.id, attempt])

  const groups = useMemo(() => (sales ? classifySalesVelocity(products, sales) : null), [products, sales])
  const catalogLoading = catalog?.status === 'loading'

  if (error) return <ErrorState message={error} onRetry={() => setAttempt(a => a + 1)} />
  if (!groups || catalogLoading) return <Loading text='Working out what is selling…' />
  const total = VELOCITY_GROUPS.reduce((s, g) => s + groups[g.key].length, 0)
  if (total === 0) {
    return <Empty icon={<Gauge size={40} strokeWidth={1.5} />} title='Nothing to show yet' description='No products in stock and no sales in the last 30 days.' />
  }
  const shown = VELOCITY_GROUPS.filter(g => !group || g.key === group)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: theme.gray600 }}>
        Units sold in the last {VELOCITY_WINDOW_DAYS} days (completed sales), product by product, with what is in stock now.
      </p>
      <div role='group' aria-label='Velocity groups' style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {VELOCITY_GROUPS.map(g => {
          const on = group === g.key
          return (
            <button key={g.key} type='button' aria-pressed={on} onClick={() => onGroupChange?.(on ? '' : g.key)}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: theme.radius.lg, cursor: 'pointer', background: on ? theme.tealMist : 'white',
                border: `1px solid ${on ? theme.tealDeep : theme.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: theme.gray600 }}>{g.label}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: TONES[g.key] }}>{groups[g.key].length}</div>
              <div style={{ fontSize: 11.5, color: theme.gray500 }}>{g.rule}</div>
            </button>
          )
        })}
      </div>
      {shown.map(g => (
        <section key={g.key} aria-labelledby={'velocity-' + g.key}>
          <h2 id={'velocity-' + g.key} style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '4px 0 8px' }}>
            {g.label} <span style={{ fontWeight: 600, color: theme.gray500 }}>· {groups[g.key].length} product{groups[g.key].length === 1 ? '' : 's'}</span>
          </h2>
          <DataTable
            rows={groups[g.key]}
            empty={<Empty message={'No ' + g.label.toLowerCase() + ' products in the last ' + VELOCITY_WINDOW_DAYS + ' days.'} cause='filtered' />}
            columns={[
              { key: 'name', label: 'Product', render: r => <span style={{ fontWeight: 700, color: theme.navy }}>{r.name}</span> },
              { key: 'units', label: 'Units sold (' + VELOCITY_WINDOW_DAYS + ' days)', align: 'right', render: r => r.units.toLocaleString() },
              { key: 'stock', label: 'In stock', align: 'right', render: r => r.stock > 0 ? r.stock.toLocaleString() : <span style={{ color: theme.danger, fontWeight: 700 }}>Out of stock</span> },
            ]}
          />
        </section>
      ))}
    </div>
  )
}
