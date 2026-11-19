import { CalendarX } from 'lucide-react'
import { expiryGroups, EXPIRY_SOON_DAYS } from '../../lib/expiry'
import { theme } from '../../styles/theme'
import { DataTable, Empty, Loading } from '../../components/ui'

const SECTIONS = [
  { key: 'expiring', label: 'Expiring within ' + EXPIRY_SOON_DAYS + ' days' },
  { key: 'expired', label: 'Expired' },
]

const longDate = (d) => {
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}
const when = (days) => days === 0 ? 'Today' : days > 0 ? 'In ' + days + ' day' + (days === 1 ? '' : 's') : -days + ' day' + (days === -1 ? '' : 's') + ' ago'

// Stock Management ▸ Expiry: the products behind the owner's expiry notifications, with the quantity in stock and the
// expiry date, by the same rule the notifications count (lib/expiry.js). `section` (URL ?expiry=) opens one list.
export default function ExpiryBreakdown({ products = [], catalog, section = '', onSectionChange }) {
  if (catalog?.status === 'loading') return <Loading text='Loading products…' />
  const groups = expiryGroups(products)
  const shown = SECTIONS.filter(s => !section || s.key === section)
  if (groups.expiring.length + groups.expired.length === 0) {
    return <Empty icon={<CalendarX size={40} strokeWidth={1.5} />} title='No expiry concerns' description={'No product expires within ' + EXPIRY_SOON_DAYS + ' days, and none has expired.'} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div role='group' aria-label='Expiry lists' style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[{ key: '', label: 'Both' }, ...SECTIONS].map(s => {
          const on = section === s.key
          const n = s.key ? groups[s.key].length : groups.expiring.length + groups.expired.length
          return (
            <button key={s.key || 'all'} type='button' aria-pressed={on} onClick={() => onSectionChange?.(s.key)}
              style={{ padding: '8px 14px', borderRadius: theme.radius.full, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                border: `1px solid ${on ? theme.tealDeep : theme.border}`, background: on ? theme.tealDeep : 'white', color: on ? 'white' : theme.gray600 }}>
              {s.label} ({n})
            </button>
          )
        })}
      </div>
      {shown.map(s => {
        const rows = groups[s.key]
        const units = rows.reduce((a, r) => a + Math.max(r.stock, 0), 0)
        return (
          <section key={s.key} aria-labelledby={'expiry-' + s.key}>
            <h2 id={'expiry-' + s.key} style={{ fontSize: 15, fontWeight: 800, color: s.key === 'expired' ? theme.danger : theme.navy, margin: '4px 0 8px' }}>
              {s.label} <span style={{ fontWeight: 600, color: theme.gray500 }}>· {rows.length} product{rows.length === 1 ? '' : 's'}, {units.toLocaleString()} unit{units === 1 ? '' : 's'} in stock</span>
            </h2>
            <DataTable
              rows={rows}
              empty={<Empty message={s.key === 'expired' ? 'No product has expired.' : 'No product expires within ' + EXPIRY_SOON_DAYS + ' days.'} cause='filtered' />}
              columns={[
                { key: 'name', label: 'Product', render: r => <span style={{ fontWeight: 700, color: theme.navy }}>{r.name}</span> },
                { key: 'stock', label: 'Quantity in stock', align: 'right', render: r => r.stock.toLocaleString() },
                { key: 'expiry_date', label: 'Expiry date', render: r => longDate(r.expiry_date) },
                { key: 'days', label: s.key === 'expired' ? 'Expired' : 'Expires', render: r => <span style={{ fontWeight: 700, color: r.days < 0 ? theme.danger : r.days <= 30 ? theme.warning : theme.gray600 }}>{when(r.days)}</span> },
              ]}
            />
          </section>
        )
      })}
    </div>
  )
}
