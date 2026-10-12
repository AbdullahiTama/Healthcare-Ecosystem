import { useEffect, useId, useRef, useState } from 'react'
import { Calendar, Radio, X } from 'lucide-react'
import { Button, Input } from '@care-ecosystem/design-system/components/ui'
import { useLiveActions } from '../../hooks/useLiveActions'
import { useGuestSearch } from '../../hooks/useGuestSearch'
import { useAdmin } from '../../provider/AdminProvider.jsx'
import '../../ui/admin.css'

// Start a show now, or schedule one for later. Rules it keeps:
// - going live asks first (it shows the LIVE indicator to every user);
// - success clears the form; a failure keeps the title, guests, date and
//   trailer so the admin can retry without retyping;
// - a failed guest search says so and offers Retry, never "No users";
// - the scheduled time is the datetime-local string, passed through exactly as
//   the legacy Go Live tab did.

const RESULT_LIMIT = 20

const guestName = (u) => u.full_name || u.display_name || 'User'
const initial = (u) => (u.full_name?.[0] || u.display_name?.[0] || '?').toUpperCase()

export default function StartShowPanel({ liveCount = 0 }) {
  const { isBusy, startShow, scheduleShow } = useLiveActions()
  const { askConfirm, showToast } = useAdmin()
  const ids = useId()

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const [title, setTitle] = useState('')
  const [search, setSearch] = useState('')
  const [guests, setGuests] = useState([]) // { id, name }, in the order picked
  const [scheduledAt, setScheduledAt] = useState('')
  const [trailerFile, setTrailerFile] = useState(null)
  const [fileKey, setFileKey] = useState(0) // remounts the file input to clear it
  // One error per action, each shown beside its own button; a new attempt of
  // either clears both.
  const [goLiveError, setGoLiveError] = useState('')
  const [scheduleError, setScheduleError] = useState('')

  const results = useGuestSearch(search)
  const { data, isLoading, isError, isFetching, refetch } = results || {}
  const list = Array.isArray(data) ? data.slice(0, RESULT_LIMIT) : []

  const starting = isBusy('startShow', null)
  const scheduling = isBusy('scheduleShow', null)
  const busy = starting || scheduling
  const hasTitle = !!title.trim()

  const selectedIds = guests.map(g => g.id)
  const toggleGuest = (u) => setGuests(list0 => (
    list0.some(g => g.id === u.id) ? list0.filter(g => g.id !== u.id) : [...list0, { id: u.id, name: guestName(u) }]
  ))
  const removeGuest = (id) => setGuests(list0 => list0.filter(g => g.id !== id))

  const clearFile = () => { setTrailerFile(null); setFileKey(k => k + 1) }
  const clearForm = () => {
    setTitle(''); setSearch(''); setGuests([]); setScheduledAt(''); clearFile(); setGoLiveError(''); setScheduleError('')
  }

  // Runs one action. Success clears the form; failure keeps it all. A result
  // that arrives after the panel has gone is toasted, not dropped.
  const finish = (message, res, setError) => {
    if (!mounted.current) {
      if (!res.ok) showToast(`${message}: ${res.error}`, { type: 'error' })
      return
    }
    if (res.ok) clearForm()
    else setError(`${message}: ${res.error}`)
  }

  const confirmGoLive = () => {
    if (!hasTitle || busy) return
    askConfirm({
      title: 'Go live now?',
      consequence: `This starts a live show that every CareFind user will see. It stays live until you end it.${liveCount > 0 ? ` ${liveCount} other show${liveCount === 1 ? ' is' : 's are'} already live.` : ''}`,
      confirmLabel: 'Go live',
      action: async () => {
        if (mounted.current) { setGoLiveError(''); setScheduleError('') }
        finish("Couldn't start the show", await startShow({ title, guestIds: selectedIds }), setGoLiveError)
      },
    })
  }

  const submitSchedule = async (e) => {
    e.preventDefault()
    if (!hasTitle || !scheduledAt || busy) return
    setGoLiveError(''); setScheduleError('')
    finish("Couldn't schedule the show", await scheduleShow({ title, scheduledAt, trailerFile, guestIds: selectedIds }), setScheduleError)
  }

  const retry = () => refetch?.()

  let resultsArea
  if (isError && !data) {
    resultsArea = (
      <div role="alert" className="adm-live-warn">
        <span>Couldn't search users</span>
        <Button variant="ghost" size="sm" onClick={retry} loading={isFetching} loadingText="Retrying…">Retry</Button>
      </div>
    )
  } else if (isLoading && !data) {
    resultsArea = <p role="status" className="adm-note">Searching users…</p>
  } else if (list.length === 0) {
    resultsArea = <p className="adm-note">No users found</p>
  } else {
    resultsArea = (
      <>
        {isError && (
          <div role="alert" className="adm-live-warn">
            <span>Couldn't refresh the search</span>
            <Button variant="ghost" size="sm" onClick={retry} loading={isFetching} loadingText="Retrying…">Retry</Button>
          </div>
        )}
        <ul className="adm-live-list adm-live-guest-results" aria-label="Search results">
          {list.map(u => {
            const name = guestName(u)
            const boxId = `${ids}-g-${u.id}`
            return (
              <li key={u.id} className="adm-live-guest">
                <span className="adm-live-avatar" aria-hidden="true">{initial(u)}</span>
                <label htmlFor={boxId} className="adm-live-guest-name">{name}</label>
                <input id={boxId} type="checkbox" className="adm-live-guest-check" checked={selectedIds.includes(u.id)} disabled={busy}
                  onChange={() => toggleGuest(u)} aria-label={name} />
              </li>
            )
          })}
        </ul>
      </>
    )
  }

  const fileId = `${ids}-trailer`

  return (
    <section className="adm-panel adm-live-card" aria-label="Start a live show">
      <div className="adm-live-heading">
        <h3>Start a live show</h3>
        <p className="adm-note">Go live now, or schedule a show with a countdown for your audience.</p>
      </div>

      <Input id={`${ids}-title`} label="Show title" value={title} onChange={setTitle} placeholder="e.g. Malaria Awareness Live" disabled={busy} />

      <div className="adm-live-guests">
        <h4 className="adm-live-subhead">Invite guests to co-host</h4>
        <Input id={`${ids}-search`} aria-label="Search users by name…" value={search} onChange={setSearch}
          placeholder="Search users by name…" disabled={busy} />
        {resultsArea}
        <div>
          <h4 className="adm-live-subhead">Selected guests ({guests.length})</h4>
          {guests.length > 0 && (
            <ul className="adm-live-list" aria-label="Selected guests">
              {guests.map(g => (
                <li key={g.id} className="adm-live-guest">
                  <span className="adm-live-guest-name">{g.name}</span>
                  <Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${g.name}`}
                    leftIcon={<X size={14} aria-hidden="true" />} onClick={() => removeGuest(g.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div role="group" aria-label="Go live now" className="adm-live-composer">
        {goLiveError && <p role="alert" className="adm-live-alert">{goLiveError}</p>}
        <Button variant="primary" fullWidth disabled={busy || !hasTitle} loading={starting} loadingText="Starting…"
          leftIcon={<Radio size={16} aria-hidden="true" />} onClick={confirmGoLive}>
          Go live now
        </Button>
      </div>

      <form onSubmit={submitSchedule} aria-label="Schedule a show" className="adm-live-composer adm-live-schedule">
        <h4 className="adm-live-subhead">Or schedule for later</h4>
        <p className="adm-note">Set a time and an optional trailer. A countdown shows in the stories row.</p>
        <Input id={`${ids}-when`} type="datetime-local" label="Date and time" value={scheduledAt} onChange={setScheduledAt} disabled={busy} />
        <div className="adm-live-file">
          <label htmlFor={fileId} className="adm-live-file-label">Add trailer video (optional)</label>
          <input key={fileKey} id={fileId} type="file" accept="video/*" disabled={busy}
            onChange={(e) => setTrailerFile(e.target.files?.[0] || null)} />
          {trailerFile && (
            <div className="adm-live-file-chosen">
              <span className="adm-note">{trailerFile.name}</span>
              <Button variant="ghost" size="sm" disabled={busy} leftIcon={<X size={14} aria-hidden="true" />} onClick={clearFile}>
                Remove trailer
              </Button>
            </div>
          )}
        </div>
        {scheduleError && <p role="alert" className="adm-live-alert">{scheduleError}</p>}
        <Button type="submit" variant="secondary" fullWidth disabled={busy || !hasTitle || !scheduledAt}
          loading={scheduling} loadingText="Scheduling…" leftIcon={<Calendar size={14} aria-hidden="true" />}>
          Schedule show
        </Button>
      </form>
    </section>
  )
}
