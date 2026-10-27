import { useEffect, useState } from 'react'
import { Printer, RotateCcw, Wallet } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Modal, GhostBtn, TealBtn, Inp, Pill, Loading } from '../../components/ui'
import { fmt } from '../../lib/utils'
import { paymentRepository } from './repositories'
import { parseItems, parseDbTime, saleReceived, saleOutstanding, saleRefunded, paymentStatus, methodLabel, shiftLabel, METHODS } from './salesReport'
import { saleToReceipt, buildReceiptHtml, buildReceiptQrDataUrl } from './receiptPrint'

const { navy, gray400, gray500, gray600, gray100, border, bg, danger, success, warning, tealDeep, tealMist } = theme

const cleanServerError = (e) => String(e?.message || e).replace(/^Supabase error \(\d{3}\):\s*/, '')
const when = (v) => parseDbTime(v)?.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) || ''
const STATUS_PILL = { Paid: 'green', 'Part-paid': 'amber', Unpaid: 'red' }
const KIND_LABEL = { sale: 'Paid at the till', collection: 'Repayment', refund: 'Refund' }

// One transaction, in full: items, money, who handled it, and every payment
// against it. Owners and managers can refund; anyone at the till can record
// a repayment. Both go through database functions that stamp who did it, and
// both are offered only once the payments ledger exists.
export default function SaleDetailModal({ sale, show, onClose, shiftsById = {}, brand, settings, canRefund, ledgerAvailable, showToast, onChanged }) {
  const [payments, setPayments] = useState(null)
  const [action, setAction] = useState(null) // null | 'collect' | 'refund'
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

  useEffect(() => { setAction(null); setAmount(''); setMethod('Cash'); setReason('') }, [sale?.id, show])

  if (!sale) return null
  const items = parseItems(sale.items)
  const outstanding = saleOutstanding(sale)
  const refundable = saleReceived(sale) - saleRefunded(sale)

  async function reprint() {
    const w = window.open('', '_blank', 'width=400,height=700')
    if (!w) { showToast('The pop-up was blocked. Allow pop-ups for this site, then try again.', { type: 'warning' }); return }
    const r = saleToReceipt(sale)
    const qrDataUrl = await buildReceiptQrDataUrl(r, settings || {})
    w.document.write(buildReceiptHtml({ receipt: r, business: brand || {}, settings: settings || {}, qrDataUrl }))
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  async function submit() {
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

  const footer = action ? (
    <>
      <GhostBtn onClick={() => setAction(null)} style={{ flex: 1, padding: 12 }}>Back</GhostBtn>
      <TealBtn onClick={submit} disabled={busy} style={{ flex: 1, padding: 12 }}>{busy ? 'Saving…' : action === 'collect' ? 'Record repayment' : 'Record refund'}</TealBtn>
    </>
  ) : (
    <>
      <GhostBtn onClick={reprint} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 12 }}><Printer size={14} /> Reprint</GhostBtn>
      {ledgerAvailable && outstanding > 0 && (
        <TealBtn onClick={() => { setAction('collect'); setAmount(String(outstanding)) }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 12 }}><Wallet size={14} /> Record repayment</TealBtn>
      )}
      {ledgerAvailable && canRefund && refundable > 0 && (
        <GhostBtn onClick={() => { setAction('refund'); setAmount('') }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 12, color: danger }}><RotateCcw size={14} /> Refund</GhostBtn>
      )}
    </>
  )

  return (
    <Modal show={show} onClose={onClose} title={`Receipt ${sale.txn_no || ''}`} wide footer={footer}>
      {action ? (
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
            <Fact label='Cashier' value={sale.staff_name || 'Not recorded'} />
            <Fact label='Shift' value={sale.shift_id ? shiftLabel(shiftsById[sale.shift_id]) : 'No shift'} />
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
