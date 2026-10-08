import { useState } from 'react'
import { Truck } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Inp, TealBtn, GhostBtn } from '../../components/ui'
import { parseDeliveryQuote, quotedTotalKobo, naira } from './deliveryQuote'

const { navy, gray500, gray600, border, bg, danger, warning, tealDeep } = theme

// The vendor's delivery quote, inside the order drawer (it replaced a browser prompt()). The vendor sees where the order goes, types
// the fee, sees the total the customer will pay, and confirms. onSubmit(kobo) sends it to quote_shop_order_delivery and resolves on
// success or throws with the server's reason, which is shown here.
export default function QuoteDeliveryForm({ order, onSubmit }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('')

  if (order.delivery_preference === 'pickup') {
    // Orders made before pickup stopped waiting for a quote (Shop-Flow-Review SD-7); there is nothing to deliver
    return (
      <div role="note" style={{ padding: 10, borderRadius: 8, background: warning + '12', border: `1px solid ${warning}40`, fontSize: 12, color: navy }}>
        This is a pickup order, so there is no delivery to quote. Contact CareFind support to open it for payment.
      </div>
    )
  }

  const parsed = parseDeliveryQuote(amount)
  const showError = touched && parsed.error
  const address = [order.delivery_address, order.delivery_city, order.delivery_state].filter(Boolean).join(', ')

  async function submit(e) {
    e.preventDefault()
    setTouched(true)
    if (parsed.error || saving) return
    setSaving(true); setServerError('')
    try {
      await onSubmit(parsed.kobo)
      setOpen(false); setAmount(''); setTouched(false)
    } catch (err) {
      // sbFetch prefixes the server's reason with 'Supabase error (status): '; the vendor only needs the reason
      setServerError(String(err?.message || '').replace(/^Supabase error \(\d+\):\s*/, '') || 'Could not save the quote. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <TealBtn type="button" onClick={() => setOpen(true)} style={{ padding: '6px 10px', fontSize: 11 }}>
        Quote Delivery
      </TealBtn>
    )
  }

  return (
    <form onSubmit={submit} aria-label="Delivery quote" noValidate
      style={{ width: '100%', border: `1px solid ${border}`, borderRadius: 10, padding: 12, background: bg, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: navy, fontSize: 13 }}>
        <Truck size={16} aria-hidden="true" /> Quote delivery
      </div>
      <div style={{ fontSize: 12, color: gray600 }}>
        <div><b>Deliver to:</b> {address || '—'}</div>
        {order.distance_km !== null && order.distance_km !== undefined && <div><b>Distance:</b> {order.distance_km} km</div>}
        <div style={{ marginTop: 4, color: gray500 }}>The fee is added to the order total. The customer is notified and asked to pay.</div>
      </div>

      <Inp
        id={`quote-${order.id}`}
        label="Delivery fee (₦)"
        value={amount}
        onChange={(v) => { setAmount(v); setServerError('') }}
        onBlur={() => setTouched(true)}
        inputMode="decimal"
        autoComplete="off"
        placeholder="e.g. 2500"
        required
        disabled={saving}
        error={showError || undefined}
      />

      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', fontSize: 12, color: gray600 }}>
        <dt>Items</dt><dd style={{ margin: 0, textAlign: 'right' }}>{naira(order.subtotal_kobo)}</dd>
        <dt>Fulfilment fee</dt><dd style={{ margin: 0, textAlign: 'right' }}>{naira(order.fulfilment_kobo)}</dd>
        {Number(order.discount_kobo) > 0 && <><dt>Discount</dt><dd style={{ margin: 0, textAlign: 'right' }}>−{naira(order.discount_kobo)}</dd></>}
        <dt>Delivery</dt><dd style={{ margin: 0, textAlign: 'right' }}>{parsed.kobo ? naira(parsed.kobo) : '—'}</dd>
        <dt style={{ fontWeight: 800, color: tealDeep, borderTop: `1px solid ${border}`, paddingTop: 4 }}>Customer pays</dt>
        <dd aria-live="polite" style={{ margin: 0, textAlign: 'right', fontWeight: 800, color: tealDeep, borderTop: `1px solid ${border}`, paddingTop: 4 }}>
          {parsed.kobo ? naira(quotedTotalKobo(order, parsed.kobo)) : '—'}
        </dd>
      </dl>

      {serverError && <div role="alert" style={{ fontSize: 12, color: danger }}>{serverError}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <GhostBtn type="button" onClick={() => { setOpen(false); setAmount(''); setTouched(false); setServerError('') }} disabled={saving}>Cancel</GhostBtn>
        <TealBtn type="submit" disabled={saving}>{saving ? 'Sending quote…' : 'Send quote to customer'}</TealBtn>
      </div>
    </form>
  )
}
