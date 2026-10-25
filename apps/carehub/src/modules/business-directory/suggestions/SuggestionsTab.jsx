import { useState, useEffect, useCallback, useRef } from 'react'
import { theme } from '../../../styles/theme'
import { SUGGESTION_TYPES } from './repository.js'

const { navy, gray500, gray600, border, danger, tealDeep, warning, bg } = theme

const typeLabel = (t) => (SUGGESTION_TYPES.find((x) => x[0] === t) || [t, t || 'Other'])[1]

// What the business form opens with when the admin adds a suggested business. The suggestion's type is a hint in
// the description: the directory's own category is chosen in the form.
export function prefillFrom(s) {
  const by = [s.suggested_by_name, s.businesses && s.businesses.name].filter(Boolean)
  const description = ['Suggested by ' + (by.length ? by.join(' of ') : 'a field rep') + '.', 'Type: ' + typeLabel(s.business_type) + '.', s.note || '']
    .filter(Boolean).join(' ')
  return { fromSuggestion: s.id, name: s.name, address: s.address || '', latitude: s.latitude, longitude: s.longitude, description }
}

// Platform admin > Directory > Suggestions: businesses field reps suggested, oldest first, each with what is already
// listed nearby so a duplicate is caught before it is added.
//   unmarked   { suggestionId: createdListingId } for listings created whose suggestion could not be marked
//   reloadKey  changes after the admin adds one, so the list is read again
export default function SuggestionsTab({ repo, suggestionRepo, scopeId, onAdd, unmarked = {}, reloadKey = 0 }) {
  const [rows, setRows] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [nearby, setNearby] = useState({})
  const [rejecting, setRejecting] = useState(null) // { id, reason }
  const [problems, setProblems] = useState({})
  const latest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latest.current
    setRows(null)
    setError('')
    try {
      const r = await suggestionRepo.listPending()
      if (latest.current !== request) return
      setRows(r)
      r.forEach((s) => {
        repo.searchWithinBox(scopeId, { lat: s.latitude, lng: s.longitude, radiusKm: 0.2 }, {}, { limit: 10 })
          .then((found) => { if (latest.current === request) setNearby((m) => ({ ...m, [s.id]: found || [] })) })
          .catch(() => {})
      })
    } catch (e) {
      if (latest.current === request) { setError((e && e.message) || 'request failed'); setRows([]) }
    }
  }, [repo, suggestionRepo, scopeId])
  useEffect(() => { load() }, [load, reloadKey])
  useEffect(() => () => { latest.current = -1 }, [])

  async function review(id, fn) {
    setProblems((p) => ({ ...p, [id]: '' }))
    try {
      await fn()
      setRows((list) => list.filter((s) => s.id !== id))
      setRejecting(null)
    } catch (e) {
      setProblems((p) => ({ ...p, [id]: (e && e.message) || 'request failed' }))
    }
  }

  const btn = { fontSize: '12px', fontWeight: 800, padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', minHeight: '36px' }
  const primary = { ...btn, border: 'none', background: tealDeep, color: 'white' }
  const plain = { ...btn, border: '1px solid ' + border, background: 'white', color: navy }

  if (rows === null) return <div role='status' style={{ fontSize: '13px', color: gray500 }}>Loading suggestions…</div>
  if (error) {
    return (
      <div role='alert' style={{ fontSize: '12.5px', color: danger }}>
        Could not load suggestions: {error}.{' '}
        <button type='button' onClick={load} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Try again</button>
      </div>
    )
  }
  if (rows.length === 0) return <div style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: gray500 }}>No suggestions waiting.</div>

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {rows.map((s) => {
        const near = nearby[s.id]
        const createdId = unmarked[s.id]
        return (
          <li key={s.id} style={{ padding: '14px', borderRadius: '10px', border: '1px solid ' + border, background: 'white' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, color: navy }}>{s.name}</span>
              <span style={{ fontSize: '11px', color: gray600 }}>{typeLabel(s.business_type)}</span>
            </div>
            {s.address && <div style={{ fontSize: '12.5px', color: gray600, marginTop: '2px' }}>{s.address}</div>}
            {s.note && <div style={{ fontSize: '12.5px', color: gray600, marginTop: '2px' }}>{s.note}</div>}
            <div style={{ fontSize: '11.5px', color: gray500, marginTop: '4px' }}>
              {[s.suggested_by_name, s.businesses && s.businesses.name].filter(Boolean).join(' · ')}
              {s.created_at ? ' · ' + new Date(s.created_at).toLocaleDateString('en-NG') : ''}
            </div>
            <div style={{ fontSize: '12px', marginTop: '6px', color: near && near.length ? warning : gray500 }}>
              {near === undefined ? 'Checking for listings nearby…' : near.length
                ? 'Already listed nearby: ' + near.map((d) => d.name).join(', ')
                : 'No listing within about 200 m'}
            </div>
            {createdId && (
              <div role='status' style={{ fontSize: '12px', color: warning, marginTop: '6px', padding: '8px', borderRadius: '8px', background: bg }}>
                The listing was added but this suggestion is still open.
              </div>
            )}
            {problems[s.id] && <div role='alert' style={{ fontSize: '12px', color: danger, marginTop: '6px' }}>{problems[s.id]}</div>}
            {rejecting && rejecting.id === s.id ? (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px', alignItems: 'center' }}>
                <input aria-label='Reason (optional)' placeholder='Reason (optional)' value={rejecting.reason} maxLength={500}
                  onChange={(e) => setRejecting({ id: s.id, reason: e.target.value })}
                  style={{ flex: '1 1 200px', minWidth: 0, padding: '8px 10px', borderRadius: '8px', border: '1px solid ' + border, fontSize: '12.5px' }} />
                <button type='button' style={{ ...btn, border: 'none', background: danger, color: 'white' }} onClick={() => review(s.id, () => suggestionRepo.reject(s.id, rejecting.reason))}>Confirm reject</button>
                <button type='button' style={plain} onClick={() => setRejecting(null)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                {createdId
                  ? <button type='button' style={primary} onClick={() => review(s.id, () => suggestionRepo.markAccepted(s.id, createdId))}>Mark as added</button>
                  : <button type='button' style={primary} onClick={() => onAdd(prefillFrom(s))}>Add to directory</button>}
                <button type='button' style={plain} onClick={() => setRejecting({ id: s.id, reason: '' })}>Reject</button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
