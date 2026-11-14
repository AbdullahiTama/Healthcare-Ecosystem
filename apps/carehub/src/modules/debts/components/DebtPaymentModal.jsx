import { Modal, Pill } from '../../../components/ui'
import RecordPaymentForm from '../../../components/payments/RecordPaymentForm'
import PaymentHistory from '../../../components/payments/PaymentHistory'
import { useDebtPayments, useRecordDebtPayment } from '../../../hooks/queries'
import { isMissingObject, paymentErrorMessage } from '../../../lib/dbErrors'
import { Figure } from '../../purchases/SupplierPayments'
import { PAYMENT_METHODS } from '../debtImport'
import { PAYMENT_STATUSES, debtPaymentStatus } from '../debtFilters'
import { settleDebt } from '../settleDebt'
import { fmt, fmtDate } from '../../../lib/utils'
import { theme } from '../../../styles/theme'

const { navy, gray500, gray600, danger, success } = theme

// "Record payment" on a debt recorded by hand or imported: what it is, a full or part payment, and every payment made
// on it (debt_payments, carehub_20270117). Credit-sale and purchase debts are paid through their sale or purchase.
//
// Before the migration is applied the history is unavailable and only the full balance can be recorded (the debt is
// marked paid, as before); a part payment is refused with the reason instead of being written without a trace.
export default function DebtPaymentModal({ brand, debt, staffName, showToast, onClose, onPaid }) {
  const history = useDebtPayments(brand?.id, debt?.id)
  const record = useRecordDebtPayment(brand?.id)
  if (!debt) return null
  const balance = Math.max(Math.round((Number(debt.amount || 0) - Number(debt.amount_paid || 0)) * 100) / 100, 0)
  const owesUs = debt.direction === 'owes_us'
  const historyMissing = history.isError && isMissingObject(history.error)
  const status = debtPaymentStatus(debt)

  async function submit({ amount, method, paidOn, note }) {
    try {
      const r = await record.mutateAsync({ debtId: debt.id, amount, method, paidOn, note, staffName: staffName || null })
      console.info('[debts] payment recorded', { debt: debt.id, amount, balance: r?.balance })
      showToast?.(Number(r?.balance) > 0
        ? `${fmt(amount)} recorded for ${debt.party_name}. ${fmt(r.balance)} still owed.`
        : `${debt.party_name}: paid in full.`, { type: 'success' })
      onPaid?.(r)
      onClose()
    } catch (e) {
      if (isMissingObject(e)) {
        if (Math.abs(amount - balance) < 0.005) {
          await settleDebt(debt, brand.id, { staffName })
          showToast?.('Marked as paid!', { type: 'success' })
          onPaid?.(); onClose()
          return
        }
        throw new Error('Part payments on this debt become available once the latest database update is applied. Record the full balance for now.')
      }
      console.error('[debts] payment failed:', e)
      throw new Error(paymentErrorMessage(e))
    }
  }

  return (
    <Modal show onClose={onClose} title={`${owesUs ? 'Payment from' : 'Pay'} ${debt.party_name || 'party'}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill label={owesUs ? 'Receivable' : 'Payable'} type={owesUs ? 'green' : 'red'} />
          <Pill label={PAYMENT_STATUSES.find(([k]) => k === status)[1]} type={status === 'paid' ? 'green' : status === 'partial' ? 'blue' : 'amber'} />
          <span style={{ fontSize: 12, color: gray500 }}>Recorded {fmtDate(debt.created_at)}{debt.due_date ? ' · due ' + fmtDate(debt.due_date) : ''}</span>
        </div>
        {debt.description && <div style={{ fontSize: 13, color: navy, overflowWrap: 'anywhere' }}>{debt.description}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Figure label='Amount' value={fmt(debt.amount || 0)} />
          <Figure label='Paid' value={fmt(debt.amount_paid || 0)} color={success} />
          <Figure label='Balance' value={fmt(balance)} color={balance > 0 ? danger : success} />
        </div>
        {balance > 0 ? (
          <RecordPaymentForm idPrefix={`debt-${debt.id}`} balance={balance} methods={PAYMENT_METHODS} defaultMethod={owesUs ? 'Cash' : 'Transfer'}
            showDate showNote submitLabel='Record payment' onSubmit={submit} />
        ) : (
          <div role='status' style={{ fontSize: 13, color: success, fontWeight: 700 }}>This debt is fully paid.</div>
        )}
        <section aria-label='Payments on this debt'>
          <div style={{ fontWeight: 800, fontSize: 13, color: navy, marginBottom: 8 }}>Payment history</div>
          <PaymentHistory payments={history.data} loading={history.isLoading} onRetry={() => history.refetch()}
            unavailable={historyMissing} error={history.isError && !historyMissing} emptyText='No payments recorded on this debt yet.' />
        </section>
        {!historyMissing && (
          <div style={{ fontSize: 11.5, color: gray600 }}>Each payment is kept in this history with who recorded it; the balance is what remains after them all.</div>
        )}
      </div>
    </Modal>
  )
}
