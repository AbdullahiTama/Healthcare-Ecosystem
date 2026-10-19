import { useState, useEffect, useCallback } from 'react'
import { Users, RefreshCw } from 'lucide-react'
import { Button, Pill, Loading, Empty, ErrorState } from '../../components/ui'
import { checkinRepository } from './repositories'
import { describeStaffRow } from './checkinView'
import { viewOnMapUrl } from '../business-directory/mapsLinks'

// Manager view of the team's latest explicit check-ins. Shown only to managers
// and owners; the database refuses anyone else. Opening it is recorded in the
// location access log, so it loads on request, not on every page view.
const TONE = { current: 'green', stale: 'amber', none: 'gray' }
const TONE_LABEL = { current: 'Current', stale: 'Stale', none: 'Unavailable' }

export default function TeamLocations({ businessId, repo = checkinRepository }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await repo.overview(businessId)) }
    catch (e) { setError(/Manager access required|42501|403/.test(String(e.message)) ? 'Only managers can see team check-ins.' : (e.message || 'Could not load.')); setData(null) }
    finally { setLoading(false) }
  }, [repo, businessId])

  useEffect(() => { if (open && !data && !error) load() }, [open, data, error, load])

  return (
    <section aria-labelledby="team-loc-h" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--panel)', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 id="team-loc-h" style={{ margin: 0, fontSize: 14, flex: 1 }}><Users size={14} aria-hidden="true" /> Team check-ins</h3>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</Button>
        {open && <Button variant="ghost" size="sm" disabled={loading} onClick={load}><RefreshCw size={13} aria-hidden="true" /> Refresh</Button>}
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>
            Shows each person's latest check-in, not where they are now. A position older than an hour is marked stale. Being near a business on the map does not mean a visit took place. Viewing this list is logged.
          </p>
          {loading ? <Loading text="Loading team check-ins..." />
            : error ? <ErrorState message={error} onRetry={load} />
            : !data || data.rows.length === 0 ? <Empty title="No active staff" description="Add staff to see their check-ins here." />
            : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.rows.map((r) => {
                  const d = describeStaffRow(r)
                  const map = r.last_checkin && viewOnMapUrl(r.last_checkin.latitude, r.last_checkin.longitude)
                  return (
                    <li key={r.staff_id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', opacity: d.tone === 'stale' ? 0.85 : 1 }}>
                      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <strong style={{ fontSize: 13 }}>{r.name || 'Staff member'}</strong> <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.role}</span>
                        <div style={{ fontSize: 12 }}>{d.headline}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.detail}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.last_activity_at ? 'Last logged activity: ' + new Date(r.last_activity_at).toLocaleString() : 'No logged activity yet.'}</div>
                      </div>
                      <Pill label={TONE_LABEL[d.tone]} type={TONE[d.tone]} />
                      {map && <a href={map} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>{d.tone === 'stale' ? 'View last known position' : 'View on map'}</a>}
                    </li>
                  )
                })}
              </ul>
            )}
        </div>
      )}
    </section>
  )
}
