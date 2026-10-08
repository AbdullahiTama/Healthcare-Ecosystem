import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, Receipt as ReceiptIcon } from 'lucide-react'
import { useAuth } from '../providers/AuthProvider'
import { saleRepository } from '../modules/pos/repositories'
import { buildReceiptHtml, buildReceiptQrDataUrl, fmtReceiptDate } from '../modules/pos/receiptPrint'
import { fmt } from '../lib/utils'
import { Loading, Empty } from '../components/ui'

// Read-only receipt lookup reached by scanning the QR printed on a receipt.
// The QR encodes /receipt/:txn_no; this page shows the sale to the signed-in
// business (tenant-scoped by business_id) so a pharmacist can verify, reprint
// or handle a return without digging through the POS history.
export default function ReceiptPage() {
  const { id } = useParams()
  const { auth } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, error: null, sale: null })
  const businessId = auth?.brand?.id

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!businessId) {
        if (!cancelled) setState({ loading: false, error: 'auth', sale: null })
        return
      }
      setState({ loading: true, error: null, sale: null })
      try {
        const sale = await saleRepository.getById(businessId, id)
        if (cancelled) return
        if (!sale) setState({ loading: false, error: 'notfound', sale: null })
        else setState({ loading: false, error: null, sale })
      } catch (e) {
        if (cancelled) return
        console.error('Receipt lookup failed:', e)
        setState({ loading: false, error: 'error', sale: null })
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, businessId])

  // The DB row shape (txn_no, payment_method, discount, client_name, stringified
  // items, created_at) differs from the in-memory receipt the print builder
  // expects (id=txn_no, method, disc, client, array items, date). Normalize once.
  let receipt = null
  if (state.sale) {
    const s = state.sale
    let items = []
    try { items = JSON.parse(s.items || '[]') } catch (e) {}
    receipt = {
      id: s.txn_no || s.id,
      client: s.client_name || s.client || 'Walk-in',
      items,
      subtotal: s.subtotal,
      disc: s.discount ?? s.disc ?? 0,
      total: s.total,
      method: s.payment_method || s.method,
      date: s.created_at || s.date,
      amount_paid: s.amount_paid,
      balance: s.balance,
      is_credit: s.is_credit,
    }
  }

  async function onPrint() {
    const w = window.open('', '_blank', 'width=400,height=700')
    if (!w) return
    const qrDataUrl = await buildReceiptQrDataUrl(receipt, {})
    w.document.write(buildReceiptHtml({ receipt, business: auth?.brand || {}, settings: {}, qrDataUrl }))
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  const items = receipt ? receipt.items : []
  const navBtn = (
    <button onClick={() => navigate(-1)} aria-label="Go back"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#0E6F5A', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
      <ArrowLeft size={16} /> Back
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#F7F5EF', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16 }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {navBtn}
          {receipt && (
            <button onClick={onPrint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0E6F5A', color: 'white', border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              <Printer size={15} /> Print
            </button>
          )}
        </div>

        {state.loading && <Loading text="Loading receipt…" />}

        {state.error === 'auth' && (
          <Empty icon={<ReceiptIcon size={40} strokeWidth={1.5} />} message="Sign in to view this receipt" />
        )}

        {state.error === 'notfound' && (
          <Empty icon={<ReceiptIcon size={40} strokeWidth={1.5} />} message="Receipt not found" cause="This receipt may belong to another business or no longer exists." />
        )}

        {state.error === 'error' && (
          <Empty icon={<ReceiptIcon size={40} strokeWidth={1.5} />} message="Could not load this receipt" cause="Check your connection and try again." />
        )}

        {receipt && (
          <div style={{ background: 'white', borderRadius: 14, border: '1px solid #ECEAE0', padding: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 18, color: '#0B4A3E' }}>{auth?.brand?.business_name || auth?.brand?.name || 'Receipt'}</div>
              {auth?.brand?.address && <div style={{ fontSize: 12, color: '#5B6B63' }}>{auth.brand.address}</div>}
              {auth?.brand?.phone && <div style={{ fontSize: 12, color: '#5B6B63' }}>{auth.brand.phone}</div>}
            </div>
            <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 6px', fontSize: 13 }}>
              <div style={{ color: '#5B6B63' }}>Receipt</div>
              <div style={{ textAlign: 'right' }}>{esc(receipt.id)}</div>
              <div style={{ color: '#5B6B63' }}>Date</div>
              <div style={{ textAlign: 'right' }}>{fmtReceiptDate(receipt.date)}</div>
              <div style={{ color: '#5B6B63' }}>Client</div>
              <div style={{ textAlign: 'right' }}>{esc(receipt.client)}</div>
            </div>
            <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />

            {items.map((it, idx) => (
              <div key={idx} style={{ marginBottom: 6 }}>
                <div style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', fontSize: 13 }}>{(it.emoji ? it.emoji + ' ' : '') + esc(it.name)}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0 6px', marginTop: 1 }}>
                  <div style={{ color: '#5B6B63', fontSize: 12 }}>{it.qty} × {fmt(it.price)}</div>
                  <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{fmt(it.price * it.qty)}</div>
                </div>
              </div>
            ))}

            <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 6px', fontSize: 13 }}>
              <div style={{ color: '#5B6B63' }}>Subtotal</div>
              <div style={{ textAlign: 'right' }}>{fmt(receipt.subtotal)}</div>
              {Number(receipt.disc) > 0 && (
                <>
                  <div style={{ color: '#5B6B63' }}>Discount</div>
                  <div style={{ textAlign: 'right' }}>-{fmt(receipt.disc)}</div>
                </>
              )}
              <div style={{ fontWeight: 800, fontSize: 15 }}>TOTAL</div>
              <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 15 }}>{fmt(receipt.total)}</div>
            </div>

            {(receipt.is_credit || receipt.method === 'Credit') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 6px', fontSize: 13, marginTop: 4 }}>
                <div style={{ color: '#5B6B63' }}>Paid</div>
                <div style={{ textAlign: 'right' }}>{fmt(receipt.amount_paid)}</div>
                <div style={{ color: '#5B6B63' }}>Balance</div>
                <div style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(receipt.balance)}</div>
              </div>
            )}

            <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 6px', fontSize: 13 }}>
              <div style={{ color: '#5B6B63' }}>Payment</div>
              <div style={{ textAlign: 'right' }}>{esc(receipt.method)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
