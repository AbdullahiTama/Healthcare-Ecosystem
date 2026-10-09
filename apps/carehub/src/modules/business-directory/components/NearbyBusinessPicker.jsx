import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { directoryRepository } from '../repositories'
import { findNearbyBusinesses, NEARBY_LABELS } from '../services/search'
import { formatDistance } from '../services/distance'
import { VerificationBadge } from './BusinessBadges'

const { navy, gray400, gray500, gray600, border, tealDeep, tealMist, danger } = theme

/**
 * Live Field Report helper: lists directory businesses near the captured GPS
 * fix and lets the representative CONFIRM which one (if any) the report is
 * about.
 *
 *   - Nothing here is saved until the rep submits the report.
 *   - Proximity is a suggestion, never proof of a visit: nothing is
 *     pre-selected, and the wording says "possible", not "visited".
 *   - A failure (offline, directory not set up) degrades to nothing; it must
 *     never get in the way of logging the activity.
 */
export default function NearbyBusinessPicker({ businessId, gps, selected, onSelect, repo = directoryRepository }) {
  const [state, setState] = useState({ status: 'idle', candidates: [], radiusKm: null })

  useEffect(() => {
    if (!gps || !businessId) { setState({ status: 'idle', candidates: [], radiusKm: null }); return undefined }
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading' }))
    findNearbyBusinesses(repo, businessId, { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy })
      .then((r) => { if (!cancelled) setState({ status: 'done', candidates: r.candidates, radiusKm: r.radiusKm }) })
      .catch(() => { if (!cancelled) setState({ status: 'error', candidates: [], radiusKm: null }) })
    return () => { cancelled = true }
  }, [gps?.lat, gps?.lng, gps?.accuracy, businessId, repo])

  if (!gps || state.status === 'idle' || state.status === 'error') return null
  if (state.status === 'done' && state.candidates.length === 0 && !selected) return null

  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${border}`, marginBottom: 16, background: 'white' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {selected ? NEARBY_LABELS.selected : NEARBY_LABELS.candidates}
      </div>

      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <MapPin size={14} color={tealDeep} aria-hidden='true' />
          <span style={{ fontWeight: 800, color: navy, fontSize: 13 }}>{selected.name}</span>
          <button type='button' onClick={() => onSelect(null)} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: danger, background: 'none', border: 'none', cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      ) : state.status === 'loading' ? (
        <div role='status' style={{ fontSize: 12.5, color: gray500, marginTop: 4 }}>Checking your Business Directory…</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: gray500, margin: '2px 0 6px' }}>
            {NEARBY_LABELS.detected}: directory businesses within {formatDistance(state.radiusKm)} of your position. Choose one only if your report is really about it — your position alone does not record a visit.
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {state.candidates.map((c) => (
              <li key={c.id}>
                <button type='button' onClick={() => onSelect(c)}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', margin: '3px 0', borderRadius: 8, border: `1px solid ${border}`, background: 'white', cursor: 'pointer' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13, color: navy }}>{c.name}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: gray600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.address}</span>
                  </span>
                  <VerificationBadge status={c.verification_status} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: tealDeep, background: tealMist, borderRadius: 12, padding: '2px 8px' }}>{formatDistance(c.distance_km)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div style={{ fontSize: 11.5, color: gray400, marginTop: 4 }}>{NEARBY_LABELS.captured}. None of these? Just carry on — it is optional.</div>
        </>
      )}
    </div>
  )
}
