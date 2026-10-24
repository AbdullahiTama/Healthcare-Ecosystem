import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { theme } from '../../../styles/theme'
import { customerRepository } from './repository.js'
import { filterCustomers, NOT_VISITED_CHOICES, LIST_LIMIT, lastSeenText } from './customerFilter.js'
import CustomerHistory from './CustomerHistory.jsx'
import { territoryRepository } from '../../territories/repositories'
import { staffRepository } from '../../staff/repositories'
import { STAGE_LABEL } from '../../orders/stages'

const { navy, gray500, gray400, border, danger, tealDeep, tealMist, bg } = theme

// Field team > Customers: every place the team has visited (a directory listing or a map facility), when and by
// whom it was last visited, and the last order raised from a visit there. "Not visited in" finds customers going
// quiet. Customers come from the team's own visits only; the directory itself stays with the platform team.
function initialNotVisited(search) {
  const n = Number(new URLSearchParams(search).get('notVisited'))
  return NOT_VISITED_CHOICES.some((c) => c[0] === n) ? n : 0
}

export function customerSummary(c) {
  const visits = (c.visits_total === 1 ? '1 visit' : c.visits_total + ' visits') + ' · ' + c.visits_30d + ' in 30 days'
  const order = c.last_order_ref || c.last_order_status
    ? 'Order ' + (c.last_order_ref || '(no reference)') + ' · ' + (STAGE_LABEL[c.last_order_status] || c.last_order_status)
    : ''
  return { visits, order }
}

export default function CustomersPage({ brand }) {
  const location = useLocation()
  const [rows, setRows] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [territories, setTerritories] = useState([])
  const [people, setPeople] = useState([])
  const [search, setSearch] = useState('')
  const [territoryId, setTerritoryId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [notVisitedDays, setNotVisitedDays] = useState(() => initialNotVisited(location.search))
  const [open, setOpen] = useState(null)
  const latest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latest.current
    setRows(null)
    setError(null)
    try {
      const r = await customerRepository.list(brand.id)
      if (latest.current === request) setRows(r)
    } catch (e) {
      if (latest.current === request) { setError(e); setRows([]) }
    }
  }, [brand.id])
  useEffect(() => { load() }, [load])
  useEffect(() => () => { latest.current = -1 }, [])

  useEffect(() => {
    let alive = true
    territoryRepository.getAll(brand.id).then((t) => { if (alive) setTerritories(t || []) }).catch(() => {})
    staffRepository.getAll(brand.id).then((s) => { if (alive) setPeople(s || []) }).catch(() => {})
    return () => { alive = false }
  }, [brand.id])

  const shown = useMemo(() => filterCustomers(rows, { search, territoryId, staffId, notVisitedDays }), [rows, search, territoryId, staffId, notVisitedDays])
  const territoryName = (id) => (territories.find((t) => t.id === id) || {}).name || ''

  const control = { padding: '9px 10px', borderRadius: '8px', border: '1px solid ' + border, fontSize: '13px', background: 'white', color: navy, minWidth: 0, flex: '1 1 150px' }
  const label = { display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', fontWeight: 700, color: gray500, flex: '1 1 150px', minWidth: 0 }

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <label style={{ ...label, flex: '2 1 220px' }}>Search
          <input aria-label='Search customers' value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Name or address' style={control} />
        </label>
        <label style={label}>Territory
          <select aria-label='Territory' value={territoryId} onChange={(e) => setTerritoryId(e.target.value)} style={control}>
            <option value=''>All territories</option>
            {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label style={label}>Rep
          <select aria-label='Rep' value={staffId} onChange={(e) => setStaffId(e.target.value)} style={control}>
            <option value=''>All reps</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <label style={label}>Not visited in
          <select aria-label='Not visited in' value={String(notVisitedDays)} onChange={(e) => setNotVisitedDays(Number(e.target.value))} style={control}>
            {NOT_VISITED_CHOICES.map((c) => <option key={c[0]} value={String(c[0])}>{c[1]}</option>)}
          </select>
        </label>
      </div>

      {rows === null ? (
        <div role='status' style={{ fontSize: '13px', color: gray500 }}>Loading customers…</div>
      ) : error ? (
        error.code === 'NOT_AVAILABLE' ? (
          <div role='status' style={{ padding: '16px', borderRadius: '10px', background: bg, fontSize: '13px', color: gray500 }}>Customers are not available yet.</div>
        ) : (
          <div role='alert' style={{ fontSize: '12.5px', color: danger }}>
            Could not load customers: {error.message || 'request failed'}.{' '}
            <button type='button' onClick={load} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Try again</button>
          </div>
        )
      ) : rows.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: gray400 }}>
          No customers yet. A customer appears when a rep chooses the place while logging a visit.
        </div>
      ) : (
        <>
          {rows.length >= LIST_LIMIT && <div role='status' style={{ fontSize: '12px', color: gray500, marginBottom: '8px' }}>Showing the 500 most recently visited customers.</div>}
          {shown.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: gray400 }}>No customers match these filters.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {shown.map((c) => {
                const s = customerSummary(c)
                const terr = territoryName(c.territory_id)
                return (
                  <li key={c.key}>
                    <button type='button' onClick={() => setOpen(c)}
                      style={{ width: '100%', textAlign: 'left', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', padding: '12px 14px', borderRadius: '10px', border: '1px solid ' + border, background: 'white', cursor: 'pointer', color: navy }}>
                      <span style={{ flex: '2 1 220px', minWidth: 0 }}>
                        <span style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 800, fontSize: '13.5px' }}>{c.name}</span>
                          <span style={{ fontSize: '10px', fontWeight: 800, color: tealDeep, background: tealMist, borderRadius: '20px', padding: '2px 8px' }}>{c.kind === 'directory' ? 'Directory' : 'Map'}</span>
                        </span>
                        <span style={{ display: 'block', fontSize: '11.5px', color: gray500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[c.address, terr].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span style={{ flex: '1 1 160px', fontSize: '12px', color: gray500 }}>
                        {lastSeenText(c.last_visit_at)}{c.last_visit_rep ? ' · ' + c.last_visit_rep : ''}
                        <span style={{ display: 'block' }}>{s.visits}</span>
                      </span>
                      <span style={{ flex: '1 1 160px', fontSize: '12px', color: s.order ? navy : gray400 }}>{s.order || 'No order yet'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {open && <CustomerHistory businessId={brand.id} customer={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
