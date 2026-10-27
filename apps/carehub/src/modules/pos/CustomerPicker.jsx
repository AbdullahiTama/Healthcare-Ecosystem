import { useState } from 'react'
import { Search, UserCheck, UserPlus, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { findClientMatches } from './customerPick'

const { navy, gray400, gray500, gray600, border, bg, danger, tealDeep, tealMist } = theme

// Choosing the customer a credit sale is owed by. A credit sale must point at
// a customer record, so every debt can be traced to the right person. The
// cashier searches the business's customers by name or phone and picks one,
// or adds a new customer here without leaving the sale (the cart is kept).
export default function CustomerPicker({ clients, loading, error, onRetry, selected, onSelect, onCreate }) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')

  if (selected) {
    return (
      <div role='status' style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealDeep}` }}>
        <UserCheck size={16} color={tealDeep} aria-hidden='true' style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: navy, overflowWrap: 'anywhere' }}>{selected.full_name}</div>
          <div style={{ fontSize: 11, color: gray600 }}>{selected.phone || 'No phone on record'}</div>
        </div>
        <button type='button' onClick={() => onSelect(null)} aria-label={`Change customer (${selected.full_name})`}
          style={{ background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, color: tealDeep, cursor: 'pointer', minHeight: 32 }}>
          Change
        </button>
      </div>
    )
  }

  const matches = findClientMatches(clients, query)

  async function create(e) {
    e.preventDefault()
    const fullName = name.trim().replace(/\s+/g, ' ')
    if (fullName.length < 2) { setAddError('Enter the customer\'s full name.'); return }
    setSaving(true); setAddError('')
    try {
      const client = await onCreate({ full_name: fullName, phone: phone.trim() || null })
      setAdding(false); setQuery(''); setName(''); setPhone('')
      onSelect(client)
    } catch (err) {
      setAddError(err?.message || 'We couldn\'t add the customer. Try again.')
    } finally { setSaving(false) }
  }

  const label = { display: 'block', fontSize: 11.5, fontWeight: 800, color: navy, marginBottom: 6 }
  const input = { width: '100%', padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', background: bg, color: navy }

  if (adding) {
    return (
      <form onSubmit={create} aria-label='Add a new customer' style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: navy }}>New customer</div>
        <label htmlFor='credit-new-name' style={{ ...label, marginBottom: 0 }}>Full name</label>
        <input id='credit-new-name' value={name} onChange={(e) => setName(e.target.value)} autoComplete='off' style={input} aria-invalid={!!addError} aria-describedby={addError ? 'credit-new-error' : undefined} />
        <label htmlFor='credit-new-phone' style={{ ...label, marginBottom: 0 }}>Phone (recommended)</label>
        <input id='credit-new-phone' type='tel' value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete='off' style={input} />
        {addError && <div id='credit-new-error' role='alert' style={{ fontSize: 11.5, color: danger, fontWeight: 700 }}>{addError}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <button type='button' onClick={() => { setAdding(false); setAddError('') }} style={{ flex: 1, padding: '8px 0', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 36 }}>Cancel</button>
          <button type='submit' disabled={saving} style={{ flex: 1, padding: '8px 0', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: 800, fontSize: 12, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, minHeight: 36 }}>{saving ? 'Saving…' : 'Add and select'}</button>
        </div>
      </form>
    )
  }

  return (
    <div>
      <label htmlFor='credit-customer-search' style={label}>Customer <span style={{ color: danger }}>*</span></label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: bg, border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 10px' }}>
        <Search size={14} color={gray400} aria-hidden='true' />
        <input id='credit-customer-search' type='text' inputMode='search' enterKeyHint='search' value={query} onChange={(e) => setQuery(e.target.value)} autoComplete='off'
          placeholder='Search name or phone' aria-describedby='credit-customer-help'
          style={{ flex: 1, border: 'none', outline: 'none', padding: '9px 0', fontSize: 12.5, background: 'transparent', color: navy, minWidth: 0 }} />
        {query && (
          <button type='button' onClick={() => setQuery('')} aria-label='Clear customer search' style={{ background: 'none', border: 'none', color: gray500, cursor: 'pointer', display: 'flex', minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
        )}
      </div>
      <div id='credit-customer-help' style={{ fontSize: 11, color: gray500, marginTop: 4 }}>A credit sale needs the customer's record so the debt is theirs.</div>

      {loading ? (
        <div role='status' style={{ fontSize: 12, color: gray500, marginTop: 8 }}>Loading customers…</div>
      ) : error ? (
        <div role='alert' style={{ fontSize: 12, color: danger, marginTop: 8 }}>
          We couldn't load your customers. <button type='button' onClick={onRetry} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 800, cursor: 'pointer', padding: 0, fontSize: 12 }}>Try again</button>
        </div>
      ) : query.trim() ? (
        <ul aria-label='Matching customers' style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
          {matches.map((c) => (
            <li key={c.id}>
              <button type='button' onClick={() => { setQuery(''); onSelect(c) }}
                style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', cursor: 'pointer', minHeight: 40 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: navy }}>{c.full_name}</span>
                <span style={{ display: 'block', fontSize: 11, color: gray500 }}>{c.phone || 'No phone on record'}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li style={{ fontSize: 12, color: gray500, padding: '4px 2px' }}>No customer matches “{query.trim()}”.</li>}
          <li>
            <button type='button' onClick={() => { setAdding(true); setName(/\d/.test(query) ? '' : query.trim()); setPhone(/\d/.test(query) ? query.trim() : '') }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 10px', borderRadius: theme.radius.md, border: `1px dashed ${tealDeep}`, background: 'white', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 36 }}>
              <UserPlus size={14} aria-hidden='true' /> Add a new customer
            </button>
          </li>
        </ul>
      ) : (clients || []).length === 0 ? (
        <button type='button' onClick={() => setAdding(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, width: '100%', padding: '8px 10px', borderRadius: theme.radius.md, border: `1px dashed ${tealDeep}`, background: 'white', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 36 }}>
          <UserPlus size={14} aria-hidden='true' /> No customers yet. Add the first one
        </button>
      ) : null}
    </div>
  )
}
