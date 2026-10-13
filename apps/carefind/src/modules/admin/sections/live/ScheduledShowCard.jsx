import { useEffect, useRef, useState } from 'react'
import { Eye, Play, X } from 'lucide-react'
import { Button } from '@care-ecosystem/design-system/components/ui'
import { useLiveActions } from '../../hooks/useLiveActions'
import { useAdmin } from '../../provider/AdminProvider.jsx'
import { isHttpUrl } from './mediaUrl.js'
import '../../ui/admin.css'

// One scheduled (not yet live) show. Start now and Cancel both ask first: each
// changes what every CareFind user sees. A failure is shown on the card, where
// the admin is looking, unless the card has gone, in which case it is toasted.
export default function ScheduledShowCard({ show }) {
  const { isBusy, startScheduled, cancelScheduled } = useLiveActions()
  const { askConfirm, showToast } = useAdmin()
  const [error, setError] = useState('')

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const starting = isBusy('startScheduled', show.id)
  const cancelling = isBusy('cancelScheduled', show.id)
  const busy = starting || cancelling

  const run = (call, message) => async () => {
    if (mounted.current) setError('')
    const res = await call(show.id)
    if (res.ok) return
    const text = `${message}: ${res.error}`
    if (mounted.current) setError(text)
    else showToast(text, { type: 'error' })
  }

  const confirmStart = () => askConfirm({
    title: 'Start this show now?',
    consequence: 'This starts the show now and shows the LIVE indicator to every CareFind user.',
    confirmLabel: 'Start now',
    action: run(startScheduled, "Couldn't start the show"),
  })
  const confirmCancel = () => askConfirm({
    title: 'Cancel this scheduled show?',
    consequence: 'This cancels the scheduled show and removes its countdown from the audience view. Invited guests will need to be re-added if you reschedule it.',
    confirmLabel: 'Cancel Show',
    action: run(cancelScheduled, "Couldn't cancel the show"),
  })

  const when = new Date(show.scheduled_at)
  return (
    <section className="adm-panel adm-live-card" aria-label={`Scheduled show ${show.title}`}>
      <header className="adm-live-head">
        <div className="adm-live-heading">
          <h3>{show.title}</h3>
          <p className="adm-note">{Number.isNaN(when.getTime()) ? '—' : when.toLocaleString()}</p>
        </div>
        <a href={`/live-show/${show.id}`} className="adm-live-link">
          <Eye size={14} aria-hidden="true" /> Preview
        </a>
      </header>
      {isHttpUrl(show.trailer_url) && <video controls playsInline src={show.trailer_url} className="adm-live-media" />}
      {error && <p role="alert" className="adm-live-alert">{error}</p>}
      <div className="adm-live-actions">
        <Button variant="primary" size="sm" disabled={busy} loading={starting} loadingText="Starting…"
          leftIcon={<Play size={12} aria-hidden="true" />} onClick={confirmStart}>
          Start now
        </Button>
        <Button variant="danger" size="sm" disabled={busy} loading={cancelling} loadingText="Cancelling…"
          leftIcon={<X size={12} aria-hidden="true" />} onClick={confirmCancel}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
