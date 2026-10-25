import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { theme } from '../../../styles/theme'
import { checkinRepository } from '../../checkins/repositories'
import { liveActivityRepository } from '../repositories'
import { customerRepository } from '../customers/repository.js'
import { territoryRepository } from '../../territories/repositories'
import { staffRepository } from '../../staff/repositories'
import { watchTable } from '../../../lib/realtime'
import { isRep } from '../../dashboard-home/fieldTeamToday'
import { buildTeamMap, rangeStart, RANGES } from './teamMapModel.js'
import LeafletMap, { TONE_COLOR } from './LeafletMap.jsx'

const { navy, gray500, gray400, border, danger, tealDeep, bg } = theme

// Check-ins are only readable through the logged overview (each look is recorded in location_access_log), so they
// are refreshed on a timer while the page is visible, never pushed. Visits arrive live.
export const CHECKIN_REFRESH_MS = 300000
const VISIT_LIMIT = 500
const NO_CUSTOM_ROLES = {}

const clock = (t) => new Date(t).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
const TONE_TEXT = { current: 'Checked in within the hour', earlier: 'Checked in earlier today', out: 'Checked out', visit: 'Visit', quiet: 'Not visited in 30 days' }

function SourceError({ what, error, onRetry }) {
  return (
    <div role='alert' style={{ fontSize: '12.5px', color: danger, marginBottom: '6px' }}>
      Could not load {what}: {error}.{' '}
      <button type='button' onClick={onRetry} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Try again</button>
    </div>
  )
}

// Field team > Team map: where each rep last checked in today, where today's (or this week's) visits happened, and
// optionally the customers gone quiet. Events only: a pin is a check-in or a visit at a time, never "here now".
export default function TeamMapPage({ brand, customRoles = NO_CUSTOM_ROLES }) {
  const [range, setRange] = useState('today')
  const [staffId, setStaffId] = useState('')
  const [territoryId, setTerritoryId] = useState('')
  const [showQuiet, setShowQuiet] = useState(false)
  const [checkins, setCheckins] = useState({ rows: null, error: '', asOf: null })
  const [visits, setVisits] = useState({ rows: null, error: '' })
  const [quiet, setQuiet] = useState({ rows: [], loaded: false, error: '' })
  const [liveStatus, setLiveStatus] = useState('connecting')
  const [territories, setTerritories] = useState([])
  const [people, setPeople] = useState([])
  const rangeRef = useRef(range)
  rangeRef.current = range
  const visitsRequest = useRef(0)

  const loadCheckins = useCallback(async () => {
    try {
      const res = await checkinRepository.overview(brand.id)
      setCheckins({ rows: (res && res.rows) || [], error: '', asOf: Date.now() })
    } catch (e) {
      setCheckins((c) => ({ rows: c.rows || [], error: (e && e.message) || 'request failed', asOf: c.asOf }))
    }
  }, [brand.id])

  const loadVisits = useCallback(async () => {
    const request = ++visitsRequest.current
    try {
      const rows = await liveActivityRepository.getFieldActivities(brand.id, { since: new Date(rangeStart(rangeRef.current)).toISOString(), limit: VISIT_LIMIT })
      if (visitsRequest.current === request) setVisits({ rows: rows || [], error: '' })
    } catch (e) {
      if (visitsRequest.current === request) setVisits((v) => ({ rows: v.rows || [], error: (e && e.message) || 'request failed' }))
    }
  }, [brand.id])

  useEffect(() => { loadCheckins() }, [loadCheckins])
  useEffect(() => { loadVisits() }, [loadVisits, range])
  useEffect(() => () => { visitsRequest.current = -1 }, [])

  // Every 5 minutes, only while someone is looking at the page: a background tab makes no logged looks.
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') loadCheckins()
    }, CHECKIN_REFRESH_MS)
    return () => clearInterval(timer)
  }, [loadCheckins])

  // New visits arrive live. Changes made while the connection was down are not replayed, so a return to live after
  // a drop reloads the visits.
  useEffect(() => {
    let wasDown = false
    const stop = watchTable('field_activities', brand.id, (row) => {
      if (Date.parse(row.created_at) < rangeStart(rangeRef.current)) return
      setVisits((v) => (v.rows && !v.rows.some((x) => x.id === row.id) ? { ...v, rows: [row, ...v.rows] } : v))
    }, (status) => {
      setLiveStatus(status)
      if (status === 'disconnected') wasDown = true
      if (status === 'live' && wasDown) { wasDown = false; loadVisits() }
    })
    return () => stop()
  }, [brand.id, loadVisits])

  useEffect(() => {
    let alive = true
    territoryRepository.getAll(brand.id).then((t) => { if (alive) setTerritories(t || []) }).catch(() => {})
    staffRepository.getAll(brand.id).then((s) => { if (alive) setPeople(s || []) }).catch(() => {})
    return () => { alive = false }
  }, [brand.id])

  const loadQuiet = useCallback(async () => {
    try {
      const rows = await customerRepository.list(brand.id, { quietDays: 30 })
      setQuiet({ rows, loaded: true, error: '' })
    } catch (e) {
      setQuiet({ rows: [], loaded: true, error: e && e.code === 'NOT_AVAILABLE' ? '' : (e && e.message) || 'request failed' })
    }
  }, [brand.id])
  useEffect(() => { if (showQuiet && !quiet.loaded) loadQuiet() }, [showQuiet, quiet.loaded, loadQuiet])

  const businessType = brand.business_type || brand.type
  const model = useMemo(() => buildTeamMap({
    checkins: checkins.rows || [], visits: visits.rows || [], quietCustomers: quiet.rows, range, staffId, territoryId, showQuiet,
    isRep: (row) => isRep(row.role, businessType, customRoles),
  }), [checkins.rows, visits.rows, quiet.rows, range, staffId, territoryId, showQuiet, businessType, customRoles])

  const loading = checkins.rows === null && visits.rows === null
  const nothing = !loading && model.pins.length === 0 && model.reps.length === 0 && model.visitRows.length === 0
  const control = { padding: '8px 10px', borderRadius: '8px', border: '1px solid ' + border, fontSize: '13px', background: 'white', color: navy, minWidth: 0, flex: '1 1 150px' }
  const chip = (on) => ({ fontSize: '12.5px', fontWeight: 800, padding: '8px 14px', borderRadius: '10px', cursor: 'pointer', border: '1px solid ' + (on ? tealDeep : border), background: on ? tealDeep : 'white', color: on ? 'white' : gray500 })
  const head = { fontSize: '10px', fontWeight: 800, color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '16px 0 6px' }
  const row = { display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', padding: '7px 0', borderBottom: '1px solid ' + border, fontSize: '12.5px', color: navy }
  const dot = (tone) => <span aria-hidden='true' style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: TONE_COLOR[tone], marginRight: '6px', verticalAlign: 'middle' }} />

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
        <div role='group' aria-label='Which visits' style={{ display: 'flex', gap: '6px' }}>
          {RANGES.map(([id, label]) => <button key={id} type='button' aria-pressed={range === id} onClick={() => setRange(id)} style={chip(range === id)}>{label}</button>)}
        </div>
        <select aria-label='Rep' value={staffId} onChange={(e) => setStaffId(e.target.value)} style={control}>
          <option value=''>All reps</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <select aria-label='Territory' value={territoryId} onChange={(e) => setTerritoryId(e.target.value)} style={control}>
          <option value=''>All territories</option>
          {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: gray500, flex: '1 1 220px' }}>
          <input type='checkbox' checked={showQuiet} onChange={(e) => setShowQuiet(e.target.checked)} /> Show customers not visited in 30 days
        </label>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', color: gray500, marginBottom: '8px' }}>
        <span>{checkins.asOf ? 'Positions as of ' + clock(checkins.asOf) : 'Loading positions…'}</span>
        <button type='button' onClick={loadCheckins} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Refresh</button>
        <span role='status'>{liveStatus === 'live' ? 'Live: new visits appear as they are logged.' : liveStatus === 'disconnected' ? 'Not live right now: new visits show when the connection is back.' : ''}</span>
      </div>
      <div style={{ fontSize: '11.5px', color: gray500, marginBottom: '8px' }}>
        Pins are check-ins and visits at the time they happened, not where anyone is now.
      </div>

      {checkins.error && <SourceError what='check-ins' error={checkins.error} onRetry={loadCheckins} />}
      {visits.error && <SourceError what='visits' error={visits.error} onRetry={loadVisits} />}
      {quiet.error && <SourceError what='quiet customers' error={quiet.error} onRetry={loadQuiet} />}

      {loading ? (
        <div role='status' style={{ padding: '24px', fontSize: '13px', color: gray500 }}>Loading the team map…</div>
      ) : (
        <>
          <LeafletMap pins={model.pins} height={typeof window !== 'undefined' && window.innerWidth < 640 ? 320 : 440} />
          <div aria-label='Map key' style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11.5px', color: gray500, margin: '8px 0' }}>
            {['current', 'earlier', 'out', 'visit'].concat(showQuiet ? ['quiet'] : []).map((t) => <span key={t}>{dot(t)}{TONE_TEXT[t]}</span>)}
          </div>

          {nothing ? (
            <div style={{ padding: '16px', borderRadius: '10px', background: bg, fontSize: '13px', color: gray500 }}>
              Nothing to show on the map yet. Check-ins and visits appear here as they happen.
            </div>
          ) : (
            <>
              <div style={head}>Check-ins today</div>
              {model.reps.length === 0 && <div style={{ fontSize: '12.5px', color: gray500 }}>No check-ins yet today.</div>}
              {model.reps.map((r) => (
                <div key={r.staffId} style={row}>
                  <span>{dot(r.tone)}<b>{r.name}</b></span>
                  <span style={{ color: gray500 }}>{TONE_TEXT[r.tone]} · {clock(r.at)}{r.area ? ' · ' + r.area : ''}</span>
                </div>
              ))}
              {model.absent.length > 0 && <div style={{ fontSize: '12px', color: gray500, marginTop: '6px' }}>Not checked in today: {model.absent.join(', ')}</div>}

              <div style={head}>{range === 'week' ? 'Visits this week' : 'Visits today'}</div>
              {model.visitRows.length === 0 && <div style={{ fontSize: '12.5px', color: gray500 }}>No visits in this range.</div>}
              {model.visitRows.map((v) => (
                <div key={v.id} style={row}>
                  <span>{dot('visit')}<b>{v.place}</b>{v.rep ? ' · ' + v.rep : ''}</span>
                  <span style={{ color: gray500 }}>{clock(v.at)} · {v.positionLabel}{v.match ? ' · ' + v.match : ''}</span>
                </div>
              ))}

              {showQuiet && (
                <>
                  <div style={head}>Customers not visited in 30 days</div>
                  {quiet.loaded && model.quietRows.length === 0 && <div style={{ fontSize: '12.5px', color: gray500 }}>None.</div>}
                  {model.quietRows.map((q) => (
                    <div key={q.key} style={row}>
                      <span>{dot('quiet')}<b>{q.name}</b></span>
                      <span style={{ color: gray500 }}>{q.days} days{q.rep ? ' · last visit by ' + q.rep : ''}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
