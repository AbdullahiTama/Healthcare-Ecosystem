import { useEffect, useState } from 'react'
import { Pencil, Printer, RotateCcw, Trash2, Wallet, Plus, Minus, History } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Modal, GhostBtn, TealBtn, Inp, Pill, Loading } from '../../components/ui'
import { fmt } from '../../lib/utils'
import { paymentRepository, saleRepository } from './repositories'
import { draftLines, addLine, editTotals, validateEdit, toPayload, describeCorrection } from './saleEdit'
import { parseItems, parseDbTime, saleReceived, saleOutstanding, saleRefunded, paymentStatus, methodLabel, shiftLabel, METHODS } from './salesReport'
import { saleToReceipt, buildReceiptHtml, buildReceiptQrDataUrl } from './receiptPrint'

const { navy, gray400, gray500, gray600, gray100, border, bg, danger, success, warning, tealDeep, tealMist } = theme

const cleanServerError = (e) => String(e?.message || e).replace(/^Supabase error \(\d{3}\):\s*/, '')
const when = (v) => parseDbTime(v)?.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) || ''
const STATUS_PILL = { Paid: 'green', 'Part-paid': 'amber', Unpaid: 'red' }
const KIND_LABEL = { sale: 'Paid at the till', collection: 'Repayment', refund: 'Refund' }

// One transaction, in full: customer, items, prices, money, who handled it,
// and every payment against it.
//
// Who can do what (the database enforces all of it; this only decides what is
// offered):
//   everyone      Reprint
//   readOnly      nothing else — the till's Recent list shows Reprint only
//   !readOnly     record a repayment on an unpaid balance
//   canCorrect    Edit, Refund and Delete — the Owner, from Financial Reports
// Edit/Refund/Delete each need a reason and leave an audit entry; money moves
// only through database functions that stamp who did it, and the corrections
// are offered once the payments ledger exists.
export default function SaleDetailModal({ sale, show, onClose, shiftsById = {}, brand, settings, readOnly = false, canCorrect = false, ledgerAvailable, products = [], clients = [], showToast, onChanged }) {
  const [payments, setPayments] = useState(null)
  const [history, setHistory] = useState(null)
  const [action, setAction] = useState(null) // null | 'collect' | 'refund' | 'edit' | 'delete'
  const [lines, setLines] = useState([])
  const [discount, setDiscount] = useState('')
  const [customer, setCustomer] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const clientRecord = sale?.client_id ? clients.find((c) => c.id === sale.client_id) : null
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('Cash')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show || !sale || !ledgerAvailable) { setPayments(null); return }
    let live = true
    setPayments(null)
    paymentRepository.getForSale(brand.id, sale.id)
      .then((rows) => { if (live) setPayments(rows || []) })
      .catch((e) => { console.warn('[sales report] payments for sale failed:', e); if (live) setPayments('error') })
    return () => { live = false }
  }, [show, sale?.id, ledgerAvailable, brand?.id])

  // The audit trail is the Owner's to read.
  useEffect(() => {
    if (!show || !sale || !canCorrect) { setHistory(null); return }
    let live = true
    setHistory(null)
    saleRepository.history(brand.id, sale.id)
      .then((rows) => { if (live) setHistory(rows || []) })
      .catch((e) => { console.warn('[sale history] failed:', e); if (live) setHistory('error') })
    return () => { live = false }
  }, [show, sale?.id, sale?.edited_at, sale?.refunded_amount, canCorrect, brand?.id])

  useEffect(() => { setAction(null); setAmount(''); setMethod('Cash'); setReason('') }, [sale?.id, show])

  if (!sale) return null
  const items = parseItems(sale.items)
  const outstanding = saleOutstanding(sale)
  // The ledger is the record of money moved, so once it has loaded the refund
  // limit is what it still holds (after an edit down this can exceed the total).
  const ledgerNet = Array.isArray(payments) && payments.length
    ? payments.reduce((n, p) => n + (p.kind === 'refund' ? -Number(p.amount) : Number(p.amount)), 0)
    : null
  const refundable = ledgerNet ?? (saleReceived(sale) - saleRefunded(sale))
  const overpaid = ledgerNet !== null ? Math.max(Math.round((ledgerNet - Number(sale.total || 0)) * 100) / 100, 0) : 0
  const draftTotals = action === 'edit' ? editTotals(lines, discount, sale) : null
  const matches = productQuery.trim()
    ? products.filter((p) => String(p.name || '').toLowerCase().includes(productQuery.trim().toLowerCase())).slice(0, 6)
    : []

  function startEdit() {
    setLines(draftLines(sale)); setDiscount(Number(sale.discount) > 0 ? String(sale.discount) : '')
    setCustomer(sale.client_name || 'Walk-in'); setProductQuery(''); setReason(''); setAction('edit')
  }
  const setLine = (i, patch) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))

  async function reprint() {
    const w = window.open('', '_blank', 'width=400,height=700')
    if (!w) { showToast('The pop-up was blocked. Allow pop-ups for this site, then try again.', { type: 'warning' }); return }
    const r = saleToReceipt(sale)
    const qrDataUrl = await buildReceiptQrDataUrl(r, settings || {})
    w.document.write(buildReceiptHtml({ receipt: r, business: brand || {}, settings: settings || {}, qrDataUrl }))
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  async function submitEdit() {
    const problem = validateEdit(lines, discount, sale, reason)
    if (problem) { showToast(problem, { type: 'warning' }); return }
    const renamed = customer.trim() !== (sale.client_name || 'Walk-in')
    setBusy(true)
    try {
      await saleRepository.correct(sale.id, {
        items: toPayload(lines), discount: Number(discount) || 0,
        clientId: renamed ? null : sale.client_id, clientName: customer.trim() || 'Walk-in', reason: reason.trim(),
      })
      showToast('Sale updated. Totals, payments, stock and the audit trail are in step.', { type: 'success' })
      setAction(null)
      onChanged?.()
    } catch (e) {
      showToast(cleanServerError(e), { type: 'error' })
    } finally { setBusy(false) }
  }

  async function submitDelete() {
    if (reason.trim().length < 3) { showToast('Give a reason for deleting this sale.', { type: 'warning' }); return }
    setBusy(true)
    try {
      await saleRepository.remove(sale.id, reason.trim())
      showToast('Sale deleted. Payments were reversed and stock returned.', { type: 'success' })
      setAction(null)
      onChanged?.()
    } catch (e) {
      showToast(cleanServerError(e), { type: 'error' })
    } finally { setBusy(false) }
  }

  async function submit() {
    if (action === 'edit') return submitEdit()
    if (action === 'delete') return submitDelete()
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) { showToast('Enter an amount greater than zero.', { type: 'warning' }); return }
    if (action === 'refund' && reason.trim().length < 3) { showToast('Give a reason for the refund.', { type: 'warning' }); return }
    setBusy(true)
    try {
      if (action === 'collect') {
        const r = await paymentRepository.recordCollection(sale.id, n, method)
        showToast(`Repayment of ${fmt(r.applied)} recorded.` + (Number(r.balance) > 0 ? ` ${fmt(r.balance)} still owed.` : ' Fully paid.'), { type: 'success' })
      } else {
        await paymentRepository.refund(sale.id, n, method, reason.trim())
        showToast(`Refund of ${fmt(n)} recorded.`, { type: 'success' })
      }
      setAction(null)
      onChanged?.()
    } catch (e) {
      showToast(cleanServerError(e), { type: 'error' })
    } finally { setBusy(false) }
  }

  const row = (label, value, color = navy, strong = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
      <span style={{ color: gray600 }}>{label}</span><span style={{ color, fontWeight: strong ? 900 : 700 }}>{value}</span>
    </div>
  )

  const confirmLabel = { collect: 'Record repayment', refund: 'Record refund', edit: 'Save changes', delete: 'Delete sale' }[action]
  const footer = action ? (
    <>
      <GhostBtn onClick={() => setAction(null)} style={{ flex: 1, padding: 12 }}>Back</GhostBtn>
      <TealBtn onClick={submit} disabled={busy} style={{ flex: 1, padding: 12, ...(action === 'delete' ? { background: danger } : {}) }}>{busy ? 'Saving…' : confirmLabel}</TealBtn>
    </>
  ) : (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%', justifyContent: 'flex-end' }}>
      <GhostBtn onClick={reprint} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 12 }}><Printer size={14} /> Reprint</GhostBtn>
      {!readOnly && ledgerAvailable && outstanding > 0 && (
        <TealBtn onClick={() => { setAction('collect'); setAmount(String(outstanding)) }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 12 }}><Wallet size={14} /> Record repayment</TealBtn>
      )}
      {canCorrect && ledgerAvailable && (
        <>
          <GhostBtn onClick={startEdit} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 12 }}><Pencil size={14} /> Edit</GhostBtn>
          {refundable > 0 && <GhostBtn onClick={() => { setAction('refund'); setAmount(''); setReason('') }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 12, color: danger }}><RotateCcw size={14} /> Refund</GhostBtn>}
          <GhostBtn onClick={() => { setAction('delete'); setReason('') }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 12, color: danger }}><Trash2 size={14} /> Delete</GhostBtn>
        </>
      )}
    </div>
  )

  return (
    <Modal show={show} onClose={onClose} title={`Receipt ${sale.txn_no || ''}`} wide footer={footer}>
      {action === 'edit' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: theme.radius.md, background: bg, fontSize: 13, color: gray600, lineHeight: 1.6 }}>
            Changing a sale updates the sales totals, financial reports, stock and the customer&apos;s balance together. Money already received is not rewritten: a lower total leaves an amount to refund, a higher one leaves a balance owed.
          </div>
          <Inp label='Customer' value={customer} onChange={setCustomer} placeholder='Walk-in' />
          <div style={{ border: `1px solid ${gray100}`, borderRadius: theme.radius.md, overflow: 'hidden' }}>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px', borderTop: i ? `1px solid ${gray100}` : 'none' }}>
                <span style={{ flex: '1 1 140px', minWidth: 0, fontSize: 13, fontWeight: 600, color: navy }}>{l.name}</span>
                <label style={{ fontSize: 11, color: gray500 }}>Qty
                  <input type='number' min='1' step='1' value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={`Quantity for ${l.name}`}
                    style={{ width: 64, marginLeft: 6, padding: '6px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13 }} />
                </label>
                <label style={{ fontSize: 11, color: gray500 }}>Price
                  <input type='number' min='0' step='any' value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} aria-label={`Price for ${l.name}`}
                    style={{ width: 92, marginLeft: 6, padding: '6px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13 }} />
                </label>
                <button onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} aria-label={`Remove ${l.name}`}
                  style={{ background: 'none', border: 'none', color: danger, cursor: 'pointer', padding: 4, display: 'flex' }}><Minus size={16} /></button>
              </div>
            ))}
            {lines.length === 0 && <div style={{ padding: 12, fontSize: 13, color: danger }}>No products left. A sale needs at least one; to remove it entirely, delete it instead.</div>}
          </div>
          <div>
            <Inp label='Add a product' value={productQuery} onChange={setProductQuery} placeholder='Search your products' />
            {matches.map((p) => (
              <button key={p.id} onClick={() => { setLines((ls) => addLine(ls, p)); setProductQuery('') }}
                style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', marginTop: 4, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, cursor: 'pointer', fontSize: 13, color: navy }}>
                <span>{p.name}</span><span style={{ display: 'flex', alignItems: 'center', gap: 4, color: tealDeep, fontWeight: 700 }}><Plus size={13} />{fmt(p.price)}</span>
              </button>
            ))}
          </div>
          <Inp label='Discount (₦)' type='number' min='0' value={discount} onChange={setDiscount} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {row('Subtotal', fmt(draftTotals.subtotal))}
            {row('New total', fmt(draftTotals.total), navy, true)}
            {row('Already received', fmt(draftTotals.paid), success)}
            {draftTotals.balance > 0 && row('Balance owed after edit', fmt(draftTotals.balance), danger, true)}
            {draftTotals.overpaid > 0 && row('Received above the new total (refund due)', fmt(draftTotals.overpaid), warning, true)}
            {draftTotals.discountError && <div role='alert' style={{ fontSize: 12.5, color: danger }}>{draftTotals.discountError}</div>}
          </div>
          <Inp label='Reason for the edit' value={reason} onChange={setReason} placeholder='e.g. Wrong quantity entered at the till' required />
        </div>
      ) : action === 'delete' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div role='alert' style={{ padding: 12, borderRadius: theme.radius.md, background: theme.dangerBg, fontSize: 13, color: danger, lineHeight: 1.6 }}>
            Delete {sale.txn_no} ({fmt(sale.total)})? It stops counting as a sale in every total and report. Money received is reversed on the payments record, products return to stock and any balance owed by the customer is removed. This is recorded in the audit trail and cannot be undone.
          </div>
          <Inp label='Reason for deleting' value={reason} onChange={setReason} placeholder='e.g. Duplicate entry' required />
        </div>
      ) : action ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: theme.radius.md, background: bg, fontSize: 13, color: gray600, lineHeight: 1.6 }}>
            {action === 'collect'
              ? <>Outstanding on this sale: <strong style={{ color: navy }}>{fmt(outstanding)}</strong>. Anything above that is not recorded.</>
              : <>Paid on this sale, less earlier refunds: <strong style={{ color: navy }}>{fmt(refundable)}</strong>. The refund returns money only; put returned goods back through Inventory.</>}
          </div>
          <Inp label={action === 'collect' ? 'Amount received (₦)' : 'Amount refunded (₦)'} type='number' min='0' value={amount} onChange={setAmount} required />
          <div role='radiogroup' aria-label='Method' style={{ display: 'flex', gap: 8 }}>
            {METHODS.map((m) => (
              <button key={m} role='radio' aria-checked={method === m} onClick={() => setMethod(m)}
                style={{ flex: 1, padding: '10px 0', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  border: `1px solid ${method === m ? tealDeep : border}`, background: method === m ? tealMist : 'white', color: method === m ? tealDeep : gray600 }}>{m}</button>
            ))}
          </div>
          {action === 'refund' && <Inp label='Reason' value={reason} onChange={setReason} placeholder='e.g. Damaged pack returned' required />}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, fontSize: 13 }}>
            <Fact label='Date' value={when(sale.created_at)} />
            <Fact label='Customer' value={sale.client_name || 'Walk-in'} />
            {clientRecord?.phone && <Fact label='Phone' value={clientRecord.phone} />}
            {clientRecord?.email && <Fact label='Email' value={clientRecord.email} />}
            {clientRecord?.address && <Fact label='Address' value={clientRecord.address} />}
            <Fact label='Cashier' value={sale.staff_name || 'Not recorded'} />
            <Fact label='Shift' value={!sale.shift_id ? 'No shift' : shiftsById[sale.shift_id] ? shiftLabel(shiftsById[sale.shift_id]) : 'Recorded in a shift'} />
            <Fact label='Method' value={methodLabel(sale)} />
            <Fact label='Status' value={<span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Pill label={paymentStatus(sale)} type={STATUS_PILL[paymentStatus(sale)]} />{saleRefunded(sale) > 0 && <Pill label='Refund' type='gray' />}</span>} />
          </div>

          <div style={{ border: `1px solid ${gray100}`, borderRadius: theme.radius.md, overflow: 'hidden' }}>
            {items.length === 0 ? <div style={{ padding: 14, fontSize: 13, color: gray400 }}>No line items were recorded on this sale.</div> : items.map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderTop: i ? `1px solid ${gray100}` : 'none', fontSize: 13 }}>
                <span style={{ color: navy, minWidth: 0 }}>{it.name || 'Item'} <span style={{ color: gray400 }}>×{Number(it.qty) || 1} @ {fmt(it.price)}</span></span>
                <span style={{ fontWeight: 700, color: navy, whiteSpace: 'nowrap' }}>{fmt((Number(it.price) || 0) * (Number(it.qty) || 1))}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Number(sale.discount) > 0 && row('Discount', '−' + fmt(sale.discount), success)}
            {row('Total', fmt(sale.total), navy, true)}
            {row('Paid', fmt(saleReceived(sale)), success)}
            {row('Outstanding', fmt(outstanding), outstanding > 0 ? danger : gray500, outstanding > 0)}
            {saleRefunded(sale) > 0 && row('Refunded', fmt(saleRefunded(sale)), warning)}
            {canCorrect && overpaid > 0 && row('Received above the total (refund due)', fmt(overpaid), warning, true)}
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: gray500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Payments</div>
            {!ledgerAvailable ? (
              <div style={{ fontSize: 12.5, color: gray500 }}>Payment history becomes available once the accounting update is applied.</div>
            ) : payments === null ? <Loading text='Loading payments…' /> : payments === 'error' ? (
              <div role='alert' style={{ fontSize: 12.5, color: danger }}>Could not load the payments for this sale.</div>
            ) : payments.length === 0 ? (
              <div style={{ fontSize: 12.5, color: gray500 }}>No money has been received on this sale.</div>
            ) : payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: `1px solid ${gray100}`, fontSize: 12.5 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: navy, fontWeight: 700 }}>{KIND_LABEL[p.kind] || p.kind} · {p.method === 'Unspecified' ? 'method not recorded' : p.method}</div>
                  <div style={{ color: gray500 }}>{when(p.received_at)} · {p.staff_name || 'Not recorded'}{p.backfilled ? ' · recorded before payment history' : ''}</div>
                  {p.kind === 'refund' && p.note && <div style={{ color: gray600, fontStyle: 'italic' }}>{p.note}</div>}
                </div>
                <span style={{ fontWeight: 800, color: p.kind === 'refund' ? danger : success, whiteSpace: 'nowrap' }}>{p.kind === 'refund' ? '−' : ''}{fmt(p.amount)}</span>
              </div>
            ))}
          </div>

          {canCorrect && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: gray500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><History size={13} aria-hidden='true' /> Change history</div>
              {history === null ? <Loading text='Loading history…' /> : history === 'error' ? (
                <div role='alert' style={{ fontSize: 12.5, color: danger }}>Could not load the change history.</div>
              ) : history.length === 0 ? (
                <div style={{ fontSize: 12.5, color: gray500 }}>This sale has not been changed.</div>
              ) : history.map((h) => {
                const d = describeCorrection(h)
                return (
                  <div key={h.id} style={{ padding: '8px 0', borderTop: `1px solid ${gray100}`, fontSize: 12.5 }}>
                    <div style={{ color: navy, fontWeight: 700 }}>{d.label}{d.detail ? ` · ${d.detail}` : ''}</div>
                    <div style={{ color: gray500 }}>{when(h.created_at)}{d.reason ? ` · ${d.reason}` : ''}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
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
