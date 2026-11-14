import { Modal } from '../../components/ui'
import RecordPaymentForm from '../../components/payments/RecordPaymentForm'
import PaymentHistory from '../../components/payments/PaymentHistory'
import { usePurchasePayments, useRecordPurchasePayment } from '../../hooks/queries'
import { paymentErrorMessage, isMissingObject } from '../../lib/dbErrors'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'

const { navy, gray500, gray600, gray100, danger, success } = theme
export const SUPPLIER_METHODS = ['Transfer', 'Cash', 'Cheque', 'POS', 'Other']

// Purchase status as shown to people ('partial' is set by record_purchase_payment).
export function purchaseStatus(p) {
  const bal = Number(p?.balance) || 0
  if (bal <= 0 || p?.status === 'paid') return { label: 'Paid', type: 'green' }
  if ((Number(p?.amount_paid) || 0) > 0 || p?.status === 'partial') return { label: 'Part paid', type: 'blue' }
  return { label: 'Unpaid', type: 'amber' }
}

// The hook that records a supplier payment, with the toast and logging every
// screen wants. Throws a user-facing message for the form to show.
function useSupplierPayment(brand, staffName, showToast, onPaid) {
  const mutation = useRecordPurchasePayment(brand?.id)
  return async (purchase, { amount, method, paidOn, note }) => {
    try {
      // record_purchase_payment is the only way a payment is recorded: since
      // carehub_20261229 a direct update of a purchase is refused, so the old
      // "mark paid in full" fallback for databases without it is gone.
      const r = await mutation.mutateAsync({ purchaseId: purchase.id, amount, method, paidOn, note, staffName: staffName || null })
      showToast(r.balance > 0
        ? `${fmt(amount)} paid to ${purchase.supplier_name}. ${fmt(r.balance)} still owed on this purchase.`
        : `Purchase from ${purchase.supplier_name} is now fully paid.`, { type: 'success' })
      console.info('[purchases] supplier payment recorded', { purchase: purchase.id, amount, balance: r.balance })
      onPaid?.(r)
      return r
    } catch (e) {
      console.error('[purchases] supplier payment failed:', e)
      throw new Error(paymentErrorMessage(e))
    }
  }
}

// "Record payment" for one purchase: what is owed, the form, and its history.
export function PurchasePaymentModal({ brand, purchase, staffName, showToast, onClose, onPaid }) {
  const pay = useSupplierPayment(brand, staffName, showToast, onPaid)
  const history = usePurchasePayments(brand?.id, purchase ? { purchaseId: purchase.id } : null)
  if (!purchase) return null
  const bal = Number(purchase.balance) || 0
  return (
    <Modal show onClose={onClose} title={`Pay ${purchase.supplier_name}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, color: gray600 }}>{purchase.product_name || 'Purchase'}{purchase.supply_date ? ' · supplied ' + purchase.supply_date : ''}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Figure label='Total' value={fmt(purchase.total_cost || 0)} />
          <Figure label='Paid' value={fmt(purchase.amount_paid || 0)} color={success} />
          <Figure label='Balance' value={fmt(bal)} color={bal > 0 ? danger : success} />
        </div>
        {bal > 0 ? (
          <RecordPaymentForm idPrefix={`purchase-${purchase.id}`} balance={bal} methods={SUPPLIER_METHODS} defaultMethod='Transfer'
            showDate showNote submitLabel='Record payment' onSubmit={async (p) => { await pay(purchase, p); onClose() }} />
        ) : (
          <div role='status' style={{ fontSize: 13, color: success, fontWeight: 700 }}>This purchase is fully paid.</div>
        )}
        <section aria-label='Payments on this purchase'>
          <div style={{ fontWeight: 800, fontSize: 13, color: navy, marginBottom: 8 }}>Payments on this purchase</div>
          <PaymentHistory payments={history.data} loading={history.isLoading} onRetry={() => history.refetch()}
            unavailable={history.isError && isMissingObject(history.error)} error={history.isError && !isMissingObject(history.error)} />
        </section>
      </div>
    </Modal>
  )
}

export function Figure({ label, value, color = navy }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: theme.radius.md, background: gray100 }}>
      <div style={{ fontSize: 11, color: gray500, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 900, color }}>{value}</div>
    </div>
  )
}
