// Shared presentational primitives for consultation forms (skincare + pharmacy).
// Chips = multi-select; Pills = single-select; YesNo = yes/no pair; SectionCard
// = the standard form card with title/hint. All accessible (aria-pressed).

import { useState, useEffect, useRef } from 'react'
import { theme } from '../../styles/theme'
import { Card, Inp, Loading } from '../../components/ui'
import { productRepository } from '../inventory/repositories'

const { tealDeep, navy, gray600, gray400, border, bg } = theme

export function Chips({ options, selected = [], onToggle, customLabel }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = selected.includes(o)
        return (
          <button key={o} type="button" onClick={() => onToggle(o)} aria-pressed={on}
            style={{ padding: '7px 12px', borderRadius: theme.radius.full, border: '1px solid', borderColor: on ? tealDeep : border, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: on ? tealDeep : '#fff', color: on ? '#fff' : gray600 }}>
            {customLabel ? customLabel(o) : o}
          </button>
        )
      })}
    </div>
  )
}

export function Pills({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = value === o
        return (
          <button key={o} type="button" onClick={() => onChange(on ? '' : o)} aria-pressed={on}
            style={{ padding: '7px 12px', borderRadius: theme.radius.full, border: '1px solid', borderColor: on ? tealDeep : border, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: on ? tealDeep : '#fff', color: on ? '#fff' : gray600 }}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function YesNo({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {['Yes', 'No'].map(o => {
        const on = value === (o === 'Yes' ? 'yes' : 'no')
        return (
          <button key={o} type="button" onClick={() => onChange(on ? '' : (o === 'Yes' ? 'yes' : 'no'))} aria-pressed={on}
            style={{ padding: '7px 16px', borderRadius: theme.radius.full, border: '1px solid', borderColor: on ? tealDeep : border, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: on ? tealDeep : '#fff', color: on ? '#fff' : gray600 }}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function SectionCard({ title, hint, children }) {
  return (
    <Card style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: navy, marginBottom: hint ? 2 : 14 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: gray400, marginBottom: 12 }}>{hint}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </Card>
  )
}

// Searchable product selector — replaces rendering the entire catalog as chips.
// Queries products by name (debounced, server-side) so large catalogs stay
// usable. `onToggle` receives the full product object so each form can keep
// its own selection shape (skincare: {id,name}; pharmacy: {id,name,price,qty}).
export function ProductSearchPicker({ businessId, selectedIds = [], onToggle, placeholder = 'Search products...' }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const timer = useRef(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([]); setNotFound(false); setError(false); setLoading(false)
      return
    }
    setLoading(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const data = await productRepository.search(businessId, q)
        setResults(data || [])
        setNotFound((data || []).length === 0)
        setError(false)
      } catch (e) {
        console.error('Product search failed:', e)
        setResults([]); setNotFound(false); setError(true)
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer.current)
  }, [query, businessId, retryNonce])

  const visible = results.filter(p => !selectedIds.includes(p.id))

  return (
    <div>
      <Inp label='' value={query} onChange={setQuery} placeholder={placeholder} aria-label={placeholder} />
      <div aria-live='polite'>
        {loading && <div style={{ marginTop: 8 }}><Loading /></div>}
        {!loading && error && (
          <button type="button" onClick={() => setRetryNonce(n => n + 1)}
            style={{ display: 'block', width: '100%', marginTop: 8, padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${theme.danger}`, background: theme.dangerBg, color: theme.danger, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
            Couldn't load products. Tap to retry — or keep typing.
          </button>
        )}
        {!loading && !error && query.trim().length >= 2 && notFound && (
          <div style={{ fontSize: 12, color: gray400, marginTop: 8 }}>No products match "{query.trim()}".</div>
        )}
      </div>
      {!loading && visible.length > 0 && (
        <div style={{ marginTop: 8, maxHeight: 224, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: 6, background: '#fff' }}>
          {visible.map(p => (
            <button key={p.id} type="button" onClick={() => onToggle(p)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: `1px solid ${border}`, background: bg, cursor: 'pointer', textAlign: 'left' }}
              aria-label={'Add ' + p.name}>
              <span style={{ fontWeight: 700, fontSize: 12.5, color: navy }}>
                {p.name}
                {p.generic_name && p.generic_name.toLowerCase() !== p.name.toLowerCase() && (
                  <span style={{ fontWeight: 500, fontSize: 11, color: gray400 }}> · {p.generic_name}</span>
                )}
              </span>
              {p.price != null && <span style={{ fontSize: 11, color: gray400 }}>₦{Number(p.price || 0).toLocaleString()}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
