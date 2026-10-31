import { Modal, Pill, GhostBtn, TealBtn, Loading, ErrorState } from '../../components/ui'
import PaymentHistory from '../../components/payments/PaymentHistory'
import { Pencil } from 'lucide-react'
import { usePurchase, usePurchasePayments, usePurchaseEditHistory } from '../../hooks/queries'
import { isMissingObject } from '../../lib/dbErrors'
import { fmt, fmtDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { purchaseLines } from './purchaseInvoice'
import { purchaseStatus, Figure } from './SupplierPayments'

const { navy, gray400, gray500, gray600, gray100, danger, success } = theme

// One purchase as a supplier invoice: who supplied what, each line's quantity
// and price, what has been paid (and how) and what is still owed. `purchase`
// is the list row; the full record (with its lines) is loaded by id. `onEdit`
// is offered only to people allowed to edit purchases (the database checks
// again); every change made is listed with who made it and why.
export default function PurchaseDetailModal({ brand, purchase: row, onClose, onPay, onEdit }) {
  const full = usePurchase(brand?.id, row?.id, row)
  const history = usePurchasePayments(brand?.id, row ? { purchaseId: row.id } : null)
  const edited = Number((full.data || row)?.edit_count) > 0
  const edits = usePurchaseEditHistory(brand?.id, row?.id, edited)
  if (!row) return null
  // Opened from a history line with only the id: wait for the record.
  if (!full.data && !row.supplier_name) {
    return (
      <Modal show onClose={onClose} title='Purchase' footer={<GhostBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Close</GhostBtn>}>
        {full.isError ? <ErrorStateInline onRetry={() => full.refetch()} /> : <Loading text='Loading the purchase…' />}
      </Modal>
    )
  }
  const p = full.data || row
  const { lines, itemised } = purchaseLines(p)
  const bal = Number(p.balance) || 0
  const st = purchaseStatus(p)

  const footer = (
    <>
      <GhostBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Close</GhostBtn>
      {onEdit && (
        <GhostBtn onClick={() => onEdit(p)} aria-label={`Edit purchase from ${p.supplier_name || 'supplier'}`} style={{ flex: 1, padding: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Pencil size={14} aria-hidden='true' /> Edit
        </GhostBtn>
      )}
      {bal > 0 && onPay && <TealBtn onClick={() => onPay(p)} style={{ flex: 1, padding: 12 }}>Record payment</TealBtn>}
    </>
  )

  return (
    <Modal show onClose={onClose} title={`Purchase from ${p.supplier_name || 'supplier'}`} wide footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, fontSize: 13 }}>
          <Fact label='Supplier' value={p.supplier_name || 'Not recorded'} />
          <Fact label='Supplied' value={p.supply_date ? fmtDate(p.supply_date) : 'Not recorded'} />
          <Fact label='Payment due' value={p.due_date ? fmtDate(p.due_date) : 'Not set'} />
          <Fact label='Status' value={<Pill label={st.label} type={st.type} />} />
          {p.notes && <Fact label='Invoice / notes' value={p.notes} />}
        </div>

        <section aria-label='Items supplied'>
          <div style={{ fontSize: 12, fontWeight: 800, color: gray500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Items supplied</div>
          {full.isError && (
            <div role='alert' style={{ fontSize: 12, color: danger, marginBottom: 6 }}>Showing the saved summary: the full invoice could not be loaded.</div>
          )}
          <ul aria-label={itemised ? 'Invoice lines' : 'Purchase summary'} style={{ listStyle: 'none', margin: 0, padding: 0, border: `1px solid ${gray100}`, borderRadius: theme.radius.md }}>
            {lines.map((l, i) => (
              <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '10px 14px', borderTop: i ? `1px solid ${gray100}` : 'none', fontSize: 13 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: navy, fontWeight: 600, overflowWrap: 'anywhere' }}>{l.name}</div>
                  <div style={{ fontSize: 12, color: gray500 }}>
                    {l.qty || '—'} × {l.cost ? fmt(l.cost) : '—'}{itemised ? '' : ' average'}
                  </div>
                  {(l.batch || l.expiry || l.sell) && (
                    <div style={{ fontSize: 11.5, color: gray500 }}>
                      {[l.batch && `Batch ${l.batch}`, l.expiry && `Expires ${fmtDate(l.expiry)}`, l.sell && `Sells at ${fmt(l.sell)}`].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <span style={{ fontWeight: 700, color: navy, whiteSpace: 'nowrap' }}>{fmt(l.total)}</span>
              </li>
            ))}
          </ul>
          {!itemised && (
            <div style={{ fontSize: 11.5, color: gray400, marginTop: 6 }}>
              This purchase was saved before each item's quantity and price were kept, so it shows the total quantity and the average unit cost.
            </div>
          )}
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Figure label='Total' value={fmt(p.total_cost || 0)} />
          <Figure label='Paid' value={fmt(p.amount_paid || 0)} color={success} />
          <Figure label='Balance' value={fmt(bal)} color={bal > 0 ? danger : success} />
        </div>

        <section aria-label='Payments to the supplier'>
          <div style={{ fontSize: 12, fontWeight: 800, color: gray500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Payments</div>
          <PaymentHistory payments={history.data} loading={history.isLoading} onRetry={() => history.refetch()}
            unavailable={history.isError && isMissingObject(history.error)} error={history.isError && !isMissingObject(history.error)}
            emptyText={Number(p.amount_paid) > 0 ? `${fmt(p.amount_paid)} paid (recorded before payment history was kept).` : 'Nothing has been paid on this purchase yet.'} />
        </section>
        {edited && (
          <section aria-label='Changes to this purchase'>
            <div style={{ fontSize: 12, fontWeight: 800, color: gray500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Changes</div>
            {edits.isLoading ? <div role='status' style={{ fontSize: 12, color: gray500 }}>Loading changes…</div>
              : edits.isError ? <div style={{ fontSize: 12, color: gray500 }}>Edited {p.edit_count} time{Number(p.edit_count) === 1 ? '' : 's'}; the details could not be loaded.</div>
                : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(edits.data || []).map((e) => <EditEntry key={e.id} entry={e} />)}
                  </ul>
                )}
          </section>
        )}
        <div style={{ fontSize: 11.5, color: gray600 }}>Recorded {fmtDate(p.created_at)}{p.edited_at ? ' · last edited ' + fmtDate(p.edited_at) : ''}</div>
      </div>
    </Modal>
  )
}

function Fact({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ color: navy, fontWeight: 600, marginTop: 2, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  )
}

// One audit_log 'purchase.edited' entry: when, who, why, and what moved.
function EditEntry({ entry }) {
  const m = entry.metadata || {}
  const before = Number(m.before?.total_cost) || 0
  const after = Number(m.after?.total_cost) || 0
  const stock = (m.stock || []).filter((s) => s.change)
  return (
    <li style={{ padding: '8px 10px', borderRadius: theme.radius.md, background: theme.gray50 || '#F7F5EF', fontSize: 12.5 }}>
      <div style={{ color: navy, fontWeight: 700 }}>
        {new Date(entry.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
        {' · '}{m.staff_name || (entry.actor_type === 'owner' ? 'Owner' : 'Staff')}
      </div>
      {m.reason && <div style={{ color: gray600 }}>“{m.reason}”</div>}
      <div style={{ color: gray500 }}>
        {before !== after ? `Total ${fmt(before)} → ${fmt(after)}` : 'Total unchanged'}
        {stock.length > 0 ? ' · stock ' + stock.map((s) => (s.change > 0 ? '+' : '−') + Math.abs(s.change) + ' ' + s.name).join(', ') : ''}
      </div>
    </li>
  )
}

function ErrorStateInline({ onRetry }) {
  return <ErrorState message="We couldn't load this purchase." onRetry={onRetry} />
}
