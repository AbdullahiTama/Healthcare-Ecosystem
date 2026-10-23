import { useState, useEffect } from 'react'
import { CloudOff } from 'lucide-react'
import { liveActivityOutbox } from './index'
import { theme } from '../../../styles/theme'

const { navy, gray600, border, info, infoBg, warning, warningBg } = theme

// Browsers may delete a page's stored data after about a week without a visit (Safari does this), so a report
// that has waited this long is flagged. Nothing is deleted by this app.
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

const buttonStyle = { padding: '6px 12px', borderRadius: '8px', border: '1px solid ' + border, background: 'white', color: navy, fontWeight: 600, fontSize: '12px', cursor: 'pointer', minHeight: '32px' }

// Reports written without a connection and not sent yet. Renders nothing when there are none (or the device's
// storage cannot be read), so it takes no room on a normal day.
export default function OutboxStrip({ outbox = liveActivityOutbox, now = Date.now }) {
  const [entries, setEntries] = useState([])
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(null)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const list = await outbox.list()
        if (alive) setEntries(Array.isArray(list) ? list : [])
      } catch (e) {
        if (alive) setEntries([])
      }
    }
    load()
    const stop = outbox.subscribe(load)
    return () => { alive = false; stop() }
  }, [outbox])

  async function act(fn) {
    setBusy(true)
    setProblem('')
    try { await fn() } catch (e) { setProblem('That did not work: ' + (e && e.message ? e.message : e)) }
    setBusy(false)
  }

  if (entries.length === 0) return null
  const waiting = entries.filter((e) => e.state === 'pending')
  const parked = entries.filter((e) => e.state === 'failed_permanent')
  const stale = entries.some((e) => now() - e.createdAt > STALE_AFTER_MS)

  return (
    <section role='status' aria-live='polite' style={{ border: '1px solid ' + border, borderRadius: '12px', padding: '12px 14px', marginBottom: '14px', background: infoBg, display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {waiting.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <CloudOff size={16} color={info} aria-hidden='true' />
          <strong style={{ color: navy, fontSize: '13px', flex: '1 1 180px' }}>
            {waiting.length} {waiting.length === 1 ? 'report' : 'reports'} waiting to send
          </strong>
          <button type='button' style={buttonStyle} disabled={busy} onClick={() => act(() => outbox.flush())}>{busy ? 'Sending...' : 'Send now'}</button>
        </div>
      )}
      {waiting.length > 0 && (
        <p style={{ margin: 0, fontSize: '12px', color: gray600 }}>
          Saved on this device. They send by themselves when you are back online; keep this page or the app open until they are gone.
        </p>
      )}
      {stale && (
        <p style={{ margin: 0, fontSize: '12px', color: navy, background: warningBg, border: '1px solid ' + warning, borderRadius: '8px', padding: '6px 10px' }}>
          A report has been waiting for more than 7 days. Browsers may delete data they have not seen in a while, so send it now.
        </p>
      )}
      {parked.map((e) => (
        <div key={e.id} style={{ borderTop: '1px solid ' + border, paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '13px', color: navy, fontWeight: 600 }}>A report could not be sent</span>
          <span style={{ fontSize: '12px', color: gray600, overflowWrap: 'anywhere' }}>{e.lastError || 'The server refused it.'}</span>
          {confirming === e.id ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: navy }}>This removes the report for good.</span>
              <button type='button' style={buttonStyle} disabled={busy} onClick={() => act(async () => { await outbox.discard(e.id); setConfirming(null) })}>Yes, discard it</button>
              <button type='button' style={buttonStyle} disabled={busy} onClick={() => setConfirming(null)}>Keep it</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type='button' style={buttonStyle} disabled={busy} onClick={() => act(() => outbox.retry(e.id))}>Retry</button>
              <button type='button' style={buttonStyle} disabled={busy} onClick={() => setConfirming(e.id)}>Discard</button>
            </div>
          )}
        </div>
      ))}
      {problem && <p role='alert' style={{ margin: 0, fontSize: '12px', color: navy }}>{problem}</p>}
    </section>
  )
}
