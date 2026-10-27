import { useQuery } from '@tanstack/react-query'
import { Modal, Pill, Loading, GhostBtn, TealBtn } from '../../components/ui'
import SaleDetailModal from '../pos/SaleDetailModal'
import PurchaseDetailModal from '../purchases/PurchaseDetail'
import { saleRepository } from '../pos/repositories'
import { purchaseRepository } from '../purchases/repositories'
import { fmt, fmtDate } from '../../lib/utils'
import { theme } from '../../styles/theme'

const { navy, gray400, gray500, gray600, danger, success, bg } = theme

// The record a debt came from: the credit sale (by transaction number) or the
// purchase (by id). Manual debts have none.
export async function loadDebtSource(debt, businessId, { sales = saleRepository, purchases = purchaseRepository } = {}) {
  if (debt.source === 'credit_sale' && debt.source_ref) return { kind: 'sale', record: await sales.getById(businessId, debt.source_ref) }
  if (debt.source === 'purchase' && debt.source_ref) return { kind: 'purchase', record: await purchases.getById(debt.source_ref, businessId) }
  return { kind: 'manual', record: null }
}

// One debt opened from the Debts page. A credit-sale debt shows the original
// sale in full (items bought, payments made, what is outstanding, reprint,
// repayment); a purchase debt shows the supplier invoice; anything else, or a
// debt whose record cannot be found, shows the debt itself.
export default function DebtDetail({ debt, brand, settings, canRefund, showToast, onClose, onChanged, onMarkPaid, onPay }) {
  const source = useQuery({
    queryKey: ['debts', 'source', brand?.id, debt?.id],
    queryFn: () => loadDebtSource(debt, brand.id),
    enabled: !!debt && !!brand?.id,
    staleTime: 30_000,
  })
  if (!debt) return null

  if (source.isLoading) {
    return (
      <Modal show onClose={onClose} title={debt.party_name || 'Debt'}>
        <Loading text={debt.source === 'credit_sale' ? 'Loading the original sale…' : debt.source === 'purchase' ? 'Loading the purchase…' : 'Loading…'} />
      </Modal>
    )
  }

  const found = source.data?.record
  if (source.data?.kind === 'sale' && found) {
    return (
      <SaleDetailModal show sale={found} onClose={onClose} brand={brand} settings={settings} canRefund={canRefund}
        ledgerAvailable showToast={showToast} onChanged={() => { onClose(); onChanged?.() }} />
    )
  }
  if (source.data?.kind === 'purchase' && found) {
    return <PurchaseDetailModal brand={brand} purchase={found} onClose={onClose} onPay={onPay} />
  }

  const notFound = source.isError || ((debt.source === 'credit_sale' || debt.source === 'purchase') && !found)
  return <DebtSummary debt={debt} notFound={notFound} onClose={onClose} onMarkPaid={onMarkPaid} />
}

function DebtSummary({ debt, notFound, onClose, onMarkPaid }) {
  const bal = Number(debt.balance) || 0
  const footer = (
    <>
      <GhostBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Close</GhostBtn>
      {debt.status !== 'paid' && onMarkPaid && <TealBtn onClick={() => { onClose(); onMarkPaid(debt) }} style={{ flex: 1, padding: 12 }}>Mark paid</TealBtn>}
    </>
  )
  return (
    <Modal show onClose={onClose} title={debt.party_name || 'Debt'} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {notFound && (
          <div role='status' style={{ padding: 12, borderRadius: theme.radius.md, background: bg, fontSize: 12.5, color: gray600 }}>
            The original {debt.source === 'purchase' ? 'purchase' : 'sale'} ({debt.source_ref}) could not be found, so this shows the debt as recorded.
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Pill label={debt.direction === 'owes_us' ? 'Owed to us' : 'We owe'} type={debt.direction === 'owes_us' ? 'green' : 'red'} />
          <Pill label={debt.status || 'pending'} type={debt.status === 'paid' ? 'green' : 'amber'} />
        </div>
        {debt.description && <div style={{ fontSize: 13, color: navy, overflowWrap: 'anywhere' }}>{debt.description}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <Row label='Amount' value={fmt(debt.amount || 0)} />
          <Row label='Paid' value={fmt(debt.amount_paid || 0)} color={success} />
          <Row label='Outstanding' value={fmt(bal)} color={bal > 0 ? danger : gray500} strong />
          <Row label='Due' value={debt.due_date ? fmtDate(debt.due_date) : 'Not set'} />
          <Row label='Recorded' value={fmtDate(debt.created_at)} />
        </div>
        <div style={{ fontSize: 11.5, color: gray400 }}>Payments on a debt recorded by hand are not itemised; marking it paid closes it.</div>
      </div>
    </Modal>
  )
}

function Row({ label, value, color = navy, strong = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: gray600 }}>{label}</span>
      <span style={{ color, fontWeight: strong ? 900 : 700 }}>{value}</span>
    </div>
  )
}
