import { useState, useEffect, useCallback } from 'react'
import { MapPin, LogIn, LogOut } from 'lucide-react'
import { Button, Loading, ErrorState } from '../../components/ui'
import { checkinRepository } from './repositories'
import { captureLocation, locationMessage } from './locationCapture'
import { EVENT_LABEL, FAILURE_TEXT } from './checkinView'
import LocationNotice from './LocationNotice.jsx'

// Explicit check-in for the signed-in person. Location is requested ONLY when a
// button is pressed, once, and never watched afterwards. A check-in is not a
// login and not a field visit; it records "I pressed the button here, now".
// If the position cannot be captured, the attempt is saved as FAILED with no
// position, and the screen says so: it is never shown as a successful check-in.
export default function CheckInPanel({ businessId, repo = checkinRepository }) {
  const [recent, setRecent] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [outcome, setOutcome] = useState(null) // { kind: 'ok'|'failed'|'error', text }

  const load = useCallback(async () => {
    setError('')
    try { setRecent(await repo.mine(5)) } catch (e) { setError(e.message || 'Could not load your check-ins.') }
  }, [repo])
  useEffect(() => { load() }, [load])

  async function go(eventType) {
    setBusy(eventType); setOutcome(null)
    const capture = await captureLocation()
    try {
      const row = await repo.record(businessId, eventType, capture)
      if (row && row.status === 'captured') {
        setOutcome({ kind: 'ok', text: (EVENT_LABEL[eventType] || 'Recorded') + '. Your position was shared once' + (capture.lowAccuracy ? ' (low accuracy, about ' + (capture.accuracyM == null ? 'unknown' : capture.accuracyM + ' m') + ')' : '') + '.' })
      } else {
        setOutcome({ kind: 'failed', text: 'No position was saved: ' + (FAILURE_TEXT[capture.reason] || 'the position could not be captured') + '. This attempt is recorded as failed. ' + (capture.message || locationMessage(capture.reason)) })
      }
      load()
    } catch (e) {
      setOutcome({ kind: 'error', text: 'Could not record this: ' + (e.message || 'request failed') + '.' })
    } finally { setBusy('') }
  }

  const last = recent && recent[0]
  return (
    <section aria-labelledby="checkin-h" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--panel)', marginBottom: 16 }}>
      <h3 id="checkin-h" style={{ margin: '0 0 4px', fontSize: 14 }}><MapPin size={14} aria-hidden="true" /> Check in</h3>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--muted)' }}>
        Press a button to share your position once with your managers. Nothing is tracked afterwards, and a check-in is not a customer visit: log those under Log Activity.
      </p>
      <LocationNotice context="checkin" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary" size="md" disabled={!!busy} onClick={() => go('workday_checkin')}><LogIn size={14} aria-hidden="true" /> {busy === 'workday_checkin' ? 'Finding your position...' : 'Check in'}</Button>
        <Button variant="ghost" size="md" disabled={!!busy} onClick={() => go('workday_checkout')}><LogOut size={14} aria-hidden="true" /> {busy === 'workday_checkout' ? 'Finding your position...' : 'Check out'}</Button>
      </div>
      <div aria-live="polite" style={{ marginTop: 10, fontSize: 13 }}>
        {outcome && <div style={{ color: outcome.kind === 'ok' ? 'var(--success, #15803d)' : 'var(--danger, #b91c1c)' }}>{outcome.text}</div>}
        {error ? <ErrorState message={error} onRetry={load} />
          : recent === null ? <Loading text="Loading..." />
          : last ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
              Your last record: {EVENT_LABEL[last.event_type]} at {new Date(last.created_at).toLocaleString()}
              {last.status === 'failed' ? ', failed (' + (FAILURE_TEXT[last.failure_reason] || 'no position') + ', nothing saved)' : last.accuracy_m != null ? ', accuracy about ' + last.accuracy_m + ' m' : ''}.
            </div>
          ) : <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>You have not checked in yet.</div>}
      </div>
    </section>
  )
}
