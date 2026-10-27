import { Loading, ErrorState } from '../ui'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'

const KIND_LABEL = {
  // purchase_payments
  at_purchase: 'Paid with the purchase',
  before_history: 'Paid before payment history was kept',
  // sale_payments (the POS ledger): 'collection' is a normal repayment
  sale: 'Paid at the sale',
  refund: 'Refund',
}

// Supplier payments carry the date paid; the POS ledger carries received_at.
const dateOf = (p) => p.paid_on || String(p.received_at || p.created_at || '').slice(0, 10)

// Ledger rows copied from sales made before the ledger existed are marked.
const kindLabel = (p) => [KIND_LABEL[p.kind], p.backfilled ? 'from earlier records' : null].filter(Boolean).join(', ')

// A list of recorded payments, newest first: purchase_payments rows (with the
// balance left after each) or sale_payments ledger rows (refunds included).
export default function PaymentHistory({ payments, loading, error, onRetry, showSupplier = false, emptyText = 'No payments recorded yet.' }) {
  if (loading) return <Loading text='Loading payments…' />
  if (error) return <ErrorState message="We couldn't load the payment history." onRetry={onRetry} />
  if (!payments || payments.length === 0) return <div style={{ fontSize: 13, color: theme.gray500, padding: '8px 0' }}>{emptyText}</div>
  return (
    <ul aria-label='Payment history' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {payments.map((p) => {
        const label = kindLabel(p)
        const refund = p.kind === 'refund'
        return (
          <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '8px 10px', borderRadius: theme.radius.md, background: theme.gray50 || '#F7F5EF', fontSize: 13 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, color: refund ? theme.danger : theme.navy }}>{refund ? '−' : ''}{fmt(p.amount)} <span style={{ fontWeight: 600, color: theme.gray500 }}>· {p.method}</span></div>
              <div style={{ fontSize: 12, color: theme.gray500 }}>
                {dateOf(p)}{showSupplier && p.supplier_name ? ' · ' + p.supplier_name : ''}{p.staff_name ? ' · by ' + p.staff_name : ''}
                {label ? ' · ' + label : ''}
              </div>
              {p.note && <div style={{ fontSize: 12, color: theme.gray600, marginTop: 2 }}>{p.note}</div>}
            </div>
            {p.balance_after != null && (
              <div style={{ textAlign: 'right', fontSize: 12, color: theme.gray500, alignSelf: 'center' }}>
                Balance after<br /><strong style={{ color: Number(p.balance_after) > 0 ? theme.danger : theme.success }}>{fmt(p.balance_after)}</strong>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
