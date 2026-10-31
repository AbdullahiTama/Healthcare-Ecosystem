import { useMemo, useState } from 'react'
import { Search, Truck, X } from 'lucide-react'
import { Card, Modal, Empty, ErrorState, Loading, Pill } from '../../components/ui'
import RecordPaymentForm from '../../components/payments/RecordPaymentForm'
import PaymentHistory from '../../components/payments/PaymentHistory'
import { useSupplierBalances, useSupplierPurchases, usePurchasePayments, useRecordPurchasePayment } from '../../hooks/queries'
import { paymentErrorMessage, isMissingObject } from '../../lib/dbErrors'
import PurchaseDetailModal from './PurchaseDetail'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'

const { navy, gray400, gray500, gray600, gray100, border, danger, success, tealDeep } = theme
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

// Suppliers view: every supplier with total bought, paid and outstanding.
export function SupplierBalances({ brand, staffName, showToast, onPaid }) {
  const balances = useSupplierBalances(brand?.id)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (balances.data || []).filter((s) => !q || String(s.supplier_name || '').toLowerCase().includes(q))
  }, [balances.data, query])
  const owed = rows.reduce((sum, s) => sum + (Number(s.balance) || 0), 0)

  if (balances.isLoading) return <Loading text='Loading suppliers…' />
  if (balances.isError && isMissingObject(balances.error)) {
    return <Empty icon={<Truck size={40} />} cause='none' message='Supplier totals and payment history become available once the latest database update is applied. Purchases are listed under the Purchases tab.' />
  }
  if (balances.isError) return <ErrorState message="We couldn't load your suppliers." onRetry={() => balances.refetch()} />
  if ((balances.data || []).length === 0) return <Empty icon={<Truck size={40} />} message='No suppliers yet. Record a purchase to start.' />

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 12px' }}>
          <Search size={15} color={gray400} aria-hidden='true' />
          <input type='search' value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Search suppliers' aria-label='Search suppliers'
            style={{ flex: 1, border: 'none', outline: 'none', padding: '10px 0', fontSize: 13, background: 'transparent', color: navy, minWidth: 0 }} />
          {query && <button type='button' onClick={() => setQuery('')} aria-label='Clear search' style={{ background: 'none', border: 'none', cursor: 'pointer', color: gray500, display: 'flex', minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}><X size={15} /></button>}
        </div>
        <div role='status' aria-live='polite' style={{ fontSize: 13, color: gray600 }}>
          <strong>{rows.length}</strong> supplier{rows.length === 1 ? '' : 's'} · <strong style={{ color: owed > 0 ? danger : success }}>{fmt(owed)}</strong> owed
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty icon={<Search size={40} />} cause='filtered' title='No suppliers match' action='Clear search' onAction={() => setQuery('')} />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}` }}>
                  {['Supplier', 'Purchases', 'Total bought', 'Paid', 'Owed', ''].map((h) => (
                    <th key={h} scope='col' style={{ padding: '12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.supplier_key} style={{ borderBottom: `1px solid ${gray100}` }}>
                    <td style={{ padding: 12, fontWeight: 700, fontSize: 13, color: navy }}>{s.supplier_name}</td>
                    <td style={{ padding: 12, fontSize: 13, color: gray600 }}>{Number(s.purchase_count)}{Number(s.open_count) > 0 ? ` (${Number(s.open_count)} open)` : ''}</td>
                    <td style={{ padding: 12, fontSize: 13, color: navy }}>{fmt(s.total_cost)}</td>
                    <td style={{ padding: 12, fontSize: 13, color: success }}>{fmt(s.amount_paid)}</td>
                    <td style={{ padding: 12, fontSize: 13, fontWeight: 900, color: Number(s.balance) > 0 ? danger : success }}>{fmt(s.balance)}</td>
                    <td style={{ padding: 12 }}>
                      <button type='button' onClick={() => setSelected(s)} aria-label={`Open ${s.supplier_name}`}
                        style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>
                        Payments
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {selected && (
        <SupplierDetailModal brand={brand} staffName={staffName} showToast={showToast} onPaid={onPaid} onClose={() => setSelected(null)}
          supplier={(balances.data || []).find((r) => r.supplier_key === selected.supplier_key) || selected} />
      )}
    </div>
  )
}

// One supplier: open purchases (each payable) and every payment made to them.
function SupplierDetailModal({ brand, supplier, staffName, showToast, onPaid, onClose }) {
  const purchases = useSupplierPurchases(brand?.id, supplier.supplier_key)
  const history = usePurchasePayments(brand?.id, { supplierKey: supplier.supplier_key })
  const [paying, setPaying] = useState(null)
  const [viewing, setViewing] = useState(null)
  const open = (purchases.data || []).filter((p) => (Number(p.balance) || 0) > 0)
  // One dialog at a time (each traps focus): paying or viewing a purchase
  // swaps in that dialog, and closing it comes back here with fresh figures.
  if (paying) {
    return <PurchasePaymentModal brand={brand} purchase={paying} staffName={staffName} showToast={showToast} onPaid={onPaid} onClose={() => setPaying(null)} />
  }
  if (viewing) {
    return <PurchaseDetailModal brand={brand} purchase={viewing} onClose={() => setViewing(null)} onPay={(p) => { setViewing(null); setPaying(p) }} />
  }
  return (
    <Modal show onClose={onClose} title={supplier.supplier_name}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Figure label='Total bought' value={fmt(supplier.total_cost)} />
          <Figure label='Paid' value={fmt(supplier.amount_paid)} color={success} />
          <Figure label='Owed' value={fmt(supplier.balance)} color={Number(supplier.balance) > 0 ? danger : success} />
        </div>
        <section aria-label='Unpaid purchases'>
          <div style={{ fontWeight: 800, fontSize: 13, color: navy, marginBottom: 8 }}>Unpaid purchases</div>
          {purchases.isLoading ? <Loading text='Loading purchases…' /> : purchases.isError ? (
            <ErrorState message="We couldn't load this supplier's purchases." onRetry={() => purchases.refetch()} />
          ) : open.length === 0 ? (
            <div style={{ fontSize: 13, color: success, fontWeight: 700 }}>Nothing owed to this supplier.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {open.map((p) => {
                const st = purchaseStatus(p)
                return (
                  <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
                    <button type='button' onClick={() => setViewing(p)} aria-label={`View purchase: ${p.product_name || 'Purchase'}`}
                      style={{ minWidth: 0, flex: '1 1 180px', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: navy }}>{p.product_name || 'Purchase'} <Pill label={st.label} type={st.type} /></div>
                      <div style={{ fontSize: 12, color: gray500 }}>{(p.supply_date || (p.created_at || '').slice(0, 10))} · total {fmt(p.total_cost)} · paid {fmt(p.amount_paid)}</div>
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <strong style={{ color: danger, fontSize: 14 }}>{fmt(p.balance)}</strong>
                      <button type='button' onClick={() => setPaying(p)}
                        style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 32 }}>
                        Record payment
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section aria-label='Payment history'>
          <div style={{ fontWeight: 800, fontSize: 13, color: navy, marginBottom: 8 }}>Payment history</div>
          <PaymentHistory payments={history.data} loading={history.isLoading} onRetry={() => history.refetch()} emptyText='No payments made to this supplier yet.'
            unavailable={history.isError && isMissingObject(history.error)} error={history.isError && !isMissingObject(history.error)} />
        </section>
      </div>
    </Modal>
  )
}
