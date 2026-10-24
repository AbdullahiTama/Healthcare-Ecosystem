import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { checkinRepository } from '../checkins/repositories'
import { liveActivityRepository } from '../live-activity/repositories'
import { orderRepository } from '../orders/repositories'
import { getRepAddedFacilities } from '../../lib/places.js'
import LocationMatchBadge from '../live-activity/LocationMatchBadge.jsx'
import { SectionCard } from '../../components/ui'
import { theme } from '../../styles/theme'
import { summariseFieldDay } from './fieldTeamToday'

const { navy, gray500, gray400, border, warning, danger, tealDeep, tealMist } = theme

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many)
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '')

function SectionError({ what, error, onRetry }) {
  return (
    <div role='alert' style={{ fontSize: '12.5px', color: danger }}>
      Could not load {what}: {error}.{' '}
      <button type='button' onClick={onRetry} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Try again</button>
    </div>
  )
}

// "Field team today" on the company dashboard (owner's choice, layout A): counts, who checked in, today's
// visits, with links to the full Field team pages. Each source loads on its own, so one that fails (for example
// team check-ins refused to a role the database does not yet treat as a manager) does not hide the others.
// A stable default: a fresh {} on every render would change the load callback and reload forever.
const NO_CUSTOM_ROLES = {}

export default function FieldTeamToday({ brand, role, staffId = null, customRoles = NO_CUSTOM_ROLES, now }) {
  const [state, setState] = useState(null) // null = loading
  const isOwner = role === 'Owner'
  // Only the latest load may show its result: an older one that answers late (a retry, or the company changing
  // while loading) is dropped, and nothing is set after the card is gone.
  const latest = useRef(0)
  useEffect(() => () => { latest.current = -1 }, [])

  const load = useCallback(async () => {
    const request = latest.current + 1
    latest.current = request
    setState(null)
    const at = now != null ? now : Date.now()
    const since = new Date(at)
    since.setHours(0, 0, 0, 0)
    const [checkins, visits, orders, places] = await Promise.allSettled([
      checkinRepository.overview(brand.id),
      liveActivityRepository.getFieldActivities(brand.id, { since: since.toISOString(), limit: 100 }),
      orderRepository.listAwaitingApproval(brand.id, { approverStaffId: staffId, isOwner }),
      getRepAddedFacilities(brand.id, 'pending_review'),
    ])
    if (latest.current !== request) return
    const value = (r, pick) => (r.status === 'fulfilled' ? pick(r.value) : [])
    const reason = (r) => (r.status === 'rejected' ? (r.reason && r.reason.message) || 'request failed' : '')
    setState({
      summary: summariseFieldDay({
        checkins: value(checkins, (v) => (v && v.rows) || []),
        visits: value(visits, (v) => v || []),
        ordersAwaiting: value(orders, (v) => v || []),
        placesPending: value(places, (v) => v || []),
        now: at,
        businessType: brand.business_type || brand.type,
        customRoles,
      }),
      checkinsError: reason(checkins),
      visitsError: reason(visits),
    })
  }, [brand.id, brand.business_type, brand.type, staffId, isOwner, now, customRoles])

  useEffect(() => { load() }, [load])

  if (state === null) {
    return <SectionCard title='Field team today'><div role='status' style={{ fontSize: '13px', color: gray500 }}>Loading field team…</div></SectionCard>
  }
  const s = state.summary
  const tile = { flex: '1 1 140px', minWidth: 0, padding: '10px 12px', borderRadius: '10px', background: tealMist, color: navy, fontSize: '12.5px' }
  const listHead = { fontSize: '10px', fontWeight: 800, color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }
  const row = { display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '6px 0', borderBottom: '1px solid ' + border, fontSize: '12.5px', color: navy, flexWrap: 'wrap' }

  return (
    <SectionCard title='Field team today'>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div style={tile}><b>{s.checkedIn} of {s.repsTotal}</b> checked in</div>
        <div style={tile}><b>{plural(s.visitsToday, 'visit', 'visits')}</b> today</div>
        <div style={tile}><b>{plural(s.ordersToApprove, 'order', 'orders')}</b> to approve</div>
        <div style={tile}><b>{plural(s.placesToConfirm, 'place', 'places')}</b> to confirm</div>
      </div>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={listHead}>Checked in</div>
          {state.checkinsError ? <SectionError what='check-ins' error={state.checkinsError} onRetry={load} /> : s.repsTotal === 0 ? (
            <div style={{ fontSize: '12.5px', color: gray500 }}>No field reps yet. Give staff the Field Rep role under Staff to see them here.</div>
          ) : (
            <>
              {s.checkedIn === 0 && <div style={{ fontSize: '12.5px', color: gray500, marginBottom: '6px' }}>No check-ins yet today.</div>}
              {s.checkinRows.map((r) => (
                <div key={r.staffId || r.name} style={row}>
                  <span style={{ fontWeight: 700 }}>{r.name}</span>
                  {r.missing ? <span style={{ color: warning }}>not checked in</span> : r.checkedOut ? (
                    <span style={{ color: gray500 }}>checked out {clock(r.at)}{r.area ? ' · ' + r.area : ''}</span>
                  ) : (
                    <span style={{ color: r.stale ? warning : gray500 }}>
                      {clock(r.at)}{r.area ? ' · ' + r.area : ''}{r.stale ? ' · old position' : ''}
                    </span>
                  )}
                </div>
              ))}
              <Link to='/dashboard/field-team/checkins' style={{ display: 'inline-block', marginTop: '8px', fontSize: '12.5px', fontWeight: 700, color: tealDeep }}>All team check-ins →</Link>
            </>
          )}
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={listHead}>Today's visits</div>
          {state.visitsError ? <SectionError what="today's visits" error={state.visitsError} onRetry={load} /> : (
            <>
              {s.visitRows.length === 0 && <div style={{ fontSize: '12.5px', color: gray500 }}>No visits yet today.</div>}
              {s.visitRows.map((v) => (
                <div key={v.id} style={row}>
                  <span><span style={{ color: gray500 }}>{clock(v.at)}</span> <b>{v.rep}</b> · {v.place}{v.hasPhoto ? ' · photo' : ''}</span>
                  <LocationMatchBadge state={v.badge} />
                </div>
              ))}
              <Link to='/dashboard/field-team/reports' style={{ display: 'inline-block', marginTop: '8px', fontSize: '12.5px', fontWeight: 700, color: tealDeep }}>See all field reports →</Link>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
