import { Loading, ErrorState } from '../ui'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'

const KIND_LABEL = {
  at_sale: 'Paid at the sale',
  at_purchase: 'Paid with the purchase',
  before_history: 'Paid before payment history was kept',
}

// A list of recorded payments (sale_payments or purchase_payments rows),
// newest first, each with the balance left after it.
export default function PaymentHistory({ payments, loading, error, onRetry, showSupplier = false, emptyText = 'No payments recorded yet.' }) {
  if (loading) return <Loading text='Loading payments…' />
  if (error) return <ErrorState message="We couldn't load the payment history." onRetry={onRetry} />
  if (!payments || payments.length === 0) return <div style={{ fontSize: 13, color: theme.gray500, padding: '8px 0' }}>{emptyText}</div>
  return (
    <ul aria-label='Payment history' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {payments.map((p) => {
        const when = p.paid_on || (p.created_at || '').slice(0, 10)
        return (
          <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '8px 10px', borderRadius: theme.radius.md, background: theme.gray50 || '#F7F5EF', fontSize: 13 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, color: theme.navy }}>{fmt(p.amount)} <span style={{ fontWeight: 600, color: theme.gray500 }}>· {p.method}</span></div>
              <div style={{ fontSize: 12, color: theme.gray500 }}>
                {when}{showSupplier && p.supplier_name ? ' · ' + p.supplier_name : ''}{p.staff_name ? ' · by ' + p.staff_name : ''}
                {KIND_LABEL[p.kind] ? ' · ' + KIND_LABEL[p.kind] : ''}
              </div>
              {p.note && <div style={{ fontSize: 12, color: theme.gray600, marginTop: 2 }}>{p.note}</div>}
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: theme.gray500, alignSelf: 'center' }}>
              Balance after<br /><strong style={{ color: Number(p.balance_after) > 0 ? theme.danger : theme.success }}>{fmt(p.balance_after)}</strong>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
