import { useState, useEffect, useCallback, useRef } from 'react'
import { theme } from '../../../styles/theme'
import { customerRepository } from './repository.js'
import { lastSeenText } from './customerFilter.js'
import { customerSummary } from './CustomersPage.jsx'

const { navy, gray500, gray400, border, danger, tealDeep, tealMist, bg } = theme

// What "Log a visit here" hands to the log form. A remembered place is only the target: the form still takes a
// fresh GPS fix and judges the location match as for a place picked by hand. A place a rep added was never
// confirmed by a manager, so it goes back as pending review and its own position cannot verify it.
export function visitTarget(c) {
  if (c.kind === 'directory') return { business: { id: c.directory_business_id, name: c.name } }
  return {
    facility: {
      name: c.name, address: c.address || null, category: c.category || null, lat: c.lat, lng: c.lng,
      source: c.source || 'detected', pendingReview: c.source === 'rep_added',
    },
  }
}

// My customers on the rep's Field page: the places this rep visited, newest first, with a quick way back.
export default function MyCustomers({ brand, staffId, onLogVisit, onRaiseOrder, children }) {
  const [rows, setRows] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const latest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latest.current
    setRows(null)
    setError(null)
    try {
      const r = await customerRepository.list(brand.id, { staffId })
      if (latest.current === request) setRows(r)
    } catch (e) {
      if (latest.current === request) { setError(e); setRows([]) }
    }
  }, [brand.id, staffId])
  useEffect(() => { load() }, [load])
  useEffect(() => () => { latest.current = -1 }, [])

  const action = { fontSize: '12px', fontWeight: 800, padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', minHeight: '36px' }

  return (
    <div>
      {rows === null ? (
        <div role='status' style={{ fontSize: '13px', color: gray500 }}>Loading your customers…</div>
      ) : error ? (
        error.code === 'NOT_AVAILABLE' ? (
          <div role='status' style={{ padding: '16px', borderRadius: '10px', background: bg, fontSize: '13px', color: gray500 }}>Customers are not available yet.</div>
        ) : (
          <div role='alert' style={{ fontSize: '12.5px', color: danger }}>
            Could not load your customers: {error.message || 'request failed'}.{' '}
            <button type='button' onClick={load} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Try again</button>
          </div>
        )
      ) : rows.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: gray400 }}>
          You have no customers yet. Choose the place when you log a visit and it will appear here.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rows.map((c) => {
            const s = customerSummary(c)
            return (
              <li key={c.key} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid ' + border, background: 'white' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: '13.5px', color: navy }}>{c.name}</span>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: tealDeep, background: tealMist, borderRadius: '20px', padding: '2px 8px' }}>{c.kind === 'directory' ? 'Directory' : 'Map'}</span>
                </div>
                {c.address && <div style={{ fontSize: '11.5px', color: gray500, marginTop: '2px' }}>{c.address}</div>}
                <div style={{ fontSize: '12px', color: gray500, marginTop: '4px' }}>
                  Last visit {lastSeenText(c.last_visit_at)} · {s.visits}{s.order ? ' · ' + s.order : ''}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                  <button type='button' onClick={() => onLogVisit(visitTarget(c))} style={{ ...action, border: 'none', background: tealDeep, color: 'white' }}>Log a visit here</button>
                  <button type='button' onClick={() => onRaiseOrder({ customer_name: c.name, customer_address: c.address || '' })} style={{ ...action, border: '1px solid ' + border, background: 'white', color: navy }}>Raise order</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {children}
    </div>
  )
}
