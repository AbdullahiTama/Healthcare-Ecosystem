import { useId, useState } from 'react'
import { theme } from '../../styles/theme'

const { navy, gray600, border, bg, danger, tealDeep } = theme

// Adding a customer at the till without leaving the sale (the cart is kept). Used by the credit-sale customer picker
// and by "Add customer" beside the sale's customer box. `onCreate(fields)` saves the client and resolves to the saved
// record (or throws an Error with a message for the cashier); `onCreated(client)` then selects it for the sale.
// The saved client is the same `clients` row the Clients page lists, so it appears there and in every client picker.
// `idPrefix` fixes the field ids (e.g. 'credit-new' gives #credit-new-name), otherwise they are generated.
export default function NewCustomerForm({ onCreate, onCreated, onCancel, initialName = '', initialPhone = '', title = 'New customer', compact = true, idPrefix }) {
  const generated = useId()
  const uid = idPrefix || generated
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    e.stopPropagation()
    if (saving) return
    const fullName = name.trim().replace(/\s+/g, ' ')
    if (fullName.length < 2) { setError('Enter the customer\'s full name.'); return }
    const mail = email.trim()
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { setError('Enter a valid email address, or leave it blank.'); return }
    setSaving(true); setError('')
    try {
      const client = await onCreate({ full_name: fullName, phone: phone.trim() || null, ...(mail ? { email: mail } : {}) })
      onCreated(client)
    } catch (err) {
      setError(err?.message || 'We couldn\'t add the customer. Try again.')
    } finally { setSaving(false) }
  }

  const label = { display: 'block', fontSize: 11.5, fontWeight: 800, color: navy }
  const input = { width: '100%', padding: compact ? '9px 12px' : '11px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: compact ? 12.5 : 13.5, outline: 'none', boxSizing: 'border-box', background: bg, color: navy }
  const errId = uid + '-error'

  return (
    <form onSubmit={submit} aria-label='Add a new customer' noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: compact ? 10 : 0, borderRadius: theme.radius.md, border: compact ? `1px solid ${border}` : 'none', background: 'white' }}>
      {title && <div style={{ fontSize: 12, fontWeight: 800, color: navy }}>{title}</div>}
      <label htmlFor={uid + '-name'} style={label}>Full name <span style={{ color: danger }}>*</span></label>
      <input id={uid + '-name'} value={name} onChange={(e) => setName(e.target.value)} autoComplete='off' style={input} autoFocus={!compact}
        aria-invalid={!!error} aria-describedby={error ? errId : undefined} />
      <label htmlFor={uid + '-phone'} style={label}>Phone (recommended)</label>
      <input id={uid + '-phone'} type='tel' value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete='off' style={input} />
      {!compact && (<>
        <label htmlFor={uid + '-email'} style={label}>Email (optional)</label>
        <input id={uid + '-email'} type='email' value={email} onChange={(e) => setEmail(e.target.value)} autoComplete='off' style={input} />
      </>)}
      {error && <div id={errId} role='alert' style={{ fontSize: 11.5, color: danger, fontWeight: 700 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: compact ? 0 : 6 }}>
        <button type='button' onClick={onCancel} disabled={saving} style={{ flex: 1, padding: '8px 0', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 40 }}>Cancel</button>
        <button type='submit' disabled={saving} aria-busy={saving || undefined} style={{ flex: 1, padding: '8px 0', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: 800, fontSize: 12, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, minHeight: 40 }}>{saving ? 'Saving…' : 'Add and select'}</button>
      </div>
    </form>
  )
}
