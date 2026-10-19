import { useState, useEffect } from 'react'
import { Button } from '../../components/ui'
import { discoveryService } from '../business-directory/discoveryService'
import { distanceLabel } from '../business-directory/mapsLinks'

// Optional suggestions while logging a field report: directory businesses near
// the position already captured for this report. Nothing is chosen for the rep.
// A business is linked to the report only when the rep presses "Select", and can
// be removed again. Showing a suggestion, or being near one, records nothing and
// does not say a visit happened.
//
// The report is valid without any selection. If suggestions cannot load (offline,
// directory not set up yet) this renders nothing and logging is unaffected.
export const NEARBY_RADIUS_M = 300

export default function DirectoryBusinessLink({ gps, value, onChange, service = discoveryService }) {
  const [state, setState] = useState({ status: 'loading', rows: [] })

  useEffect(() => {
    if (!gps || gps.lat == null || gps.lng == null) { setState({ status: 'idle', rows: [] }); return }
    let alive = true
    setState({ status: 'loading', rows: [] })
    service.search({ lat: gps.lat, lng: gps.lng, radiusM: NEARBY_RADIUS_M, sort: 'distance', limit: 5 })
      .then((res) => { if (alive) setState({ status: 'ready', rows: res.rows || [] }) })
      .catch(() => { if (alive) setState({ status: 'unavailable', rows: [] }) })
    return () => { alive = false }
  }, [gps && gps.lat, gps && gps.lng, service])

  if (state.status === 'idle' || state.status === 'unavailable') return null

  if (value) {
    return (
      <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--teal)', borderRadius: 8, fontSize: 13 }}>
        <strong>Selected business:</strong> {value.name}
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>You chose this from the directory. It is saved with your report as the business you reported on.</div>
        <Button variant="ghost" size="sm" style={{ marginTop: 6 }} onClick={() => onChange(null)}>Remove</Button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 10 }} aria-live="polite">
      <div style={{ fontSize: 12, fontWeight: 700 }}>Possible nearby business (optional)</div>
      {state.status === 'loading' ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Checking the directory near your position...</div>
        : state.rows.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>No directory business within {NEARBY_RADIUS_M} m of your position. You can still submit this report.</div>
        : (
          <>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Nearby directory results only. Select one if it is the business you are reporting on; otherwise leave this empty.</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {state.rows.map((r) => (
                <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                  <div style={{ flex: '1 1 180px', minWidth: 0, fontSize: 13 }}>
                    <strong style={{ overflowWrap: 'anywhere' }}>{r.name}</strong>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{[r.address, r.city].filter(Boolean).join(', ')}{r.distance_m != null ? ' · ' + distanceLabel(r.distance_m) : ''}</div>
                  </div>
                  <Button variant="ghost" size="sm" aria-label={'Select ' + r.name} onClick={() => onChange({ id: r.id, name: r.name })}>Select</Button>
                </li>
              ))}
            </ul>
          </>
        )}
    </div>
  )
}
