import { useEffect, useId, useRef, useState } from 'react'
import { Eye, Send, Square, X } from 'lucide-react'
import { Button, Textarea } from '@care-ecosystem/design-system/components/ui'
import { useLiveControl } from '../../hooks/useLiveControl'
import { useLiveActions, slideContent } from '../../hooks/useLiveActions'
import { useAdmin } from '../../provider/AdminProvider.jsx'
import VoiceRecorder from '../../../../components/VoiceRecorder.jsx'
import SlideUploader from '../../../../components/SlideUploader.jsx'
import VideoRecorder from '../../../../components/VideoRecorder.jsx'
import VideoUploader from '../../../../components/VideoUploader.jsx'
import '../../ui/admin.css'

// The control room for one live show, used while the show is on air. It reads
// its own show's data (useLiveControl keys by show id), so two cards never
// share state. Rules it keeps:
// - a failed load is never shown as zeros or "no comments": with no data it
//   says so and offers Retry; with earlier data it keeps that data, warns, and
//   the "Updated" stamp stays at the last good load so staleness is visible;
// - what the operator typed is kept on failure, and text typed while a post is
//   running is not wiped by that post's success;
// - every acting control is disabled while its own action runs (the hook also
//   refuses a repeat of a running action);
// - a failure that arrives after the card has gone is toasted, not dropped.

export const END_CONSEQUENCE = 'This immediately ends the live broadcast for everyone watching. The show cannot be resumed once ended.'

// Item content comes from the database: media is only ever loaded from an
// http(s) URL.
const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url)

const pad = (n) => String(n).padStart(2, '0')
const clockTime = (ms) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const startedText = (startedAt) => {
  const d = startedAt ? new Date(startedAt) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString() : '—'
}
const author = (c) => c.profiles?.full_name || c.profiles?.display_name || 'User'

const STATS = [
  { key: 'likes', label: 'Likes' },
  { key: 'views', label: 'Views' },
  { key: 'shares', label: 'Shares' },
  { key: 'gifts', label: 'Gifts (coins)' },
]

function Alert({ children }) {
  return <p role="alert" className="adm-live-alert">{children}</p>
}

function Unsupported() {
  return <span className="adm-note">Unsupported media address</span>
}

function PostedItem({ item }) {
  const { kind, content } = item
  if (kind === 'text') return <p className="adm-live-text">{content}</p>
  if (kind === 'image') {
    return isHttpUrl(content) ? <img src={content} alt="Posted image" className="adm-live-media" loading="lazy" /> : <Unsupported />
  }
  if (kind === 'voice') return isHttpUrl(content) ? <audio controls src={content} className="adm-live-audio" /> : <Unsupported />
  if (kind === 'video') return isHttpUrl(content) ? <video controls playsInline src={content} className="adm-live-media" /> : <Unsupported />
  if (kind === 'slide') {
    const [src, page] = String(content || '').split('|||')
    return (
      <div>
        <span className="adm-live-slide-label">Slide {page}</span>
        {isHttpUrl(src) ? <img src={src} alt={`Slide ${page}`} className="adm-live-media" loading="lazy" /> : <div><Unsupported /></div>}
      </div>
    )
  }
  return <Unsupported />
}

export default function LiveShowCard({ show }) {
  const control = useLiveControl(show.id)
  const { isBusy, postItem, postMedia, hideComment, endShow } = useLiveActions()
  const { askConfirm, showToast } = useAdmin()
  const ids = useId()

  // Whether the card is still shown, so a late failure is toasted instead.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  // True (and toasted when it failed) when the card has gone.
  const goneAfter = (message, res) => {
    if (mounted.current) return false
    if (!res.ok) showToast(`${message}: ${res.error}`, { type: 'error' })
    return true
  }

  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0) // remounts the file input to clear it
  const [composerError, setComposerError] = useState('')
  // Media posts that failed, oldest first: { id, label, error }. The shared
  // components mark an item as posted whatever the result, so each failure
  // stays here, naming its item, until that item posts or it is dismissed;
  // a new media post never clears it.
  const [mediaFailures, setMediaFailures] = useState([])
  const failureSeq = useRef(0)
  const [hideError, setHideError] = useState('')
  const [endError, setEndError] = useState('')

  const posting = isBusy('postItem', show.id)
  const ending = isBusy('endShow', show.id)
  const canPost = !posting && (!!text.trim() || !!file)

  const removeFile = () => { setFile(null); setFileKey(k => k + 1) }
  const pickFile = (e) => { setFile(e.target.files?.[0] || null); setComposerError('') }

  const submit = async (e) => {
    e.preventDefault()
    if (!canPost) return
    const sentText = text
    setComposerError('')
    const res = await postItem({ showId: show.id, text: sentText, imageFile: file })
    if (goneAfter("Couldn't post to the live show", res)) return
    if (res.ok) {
      // Only clear what was sent: anything typed since stays.
      setText(t => (t === sentText ? '' : t))
      removeFile()
      return
    }
    if (res.partial) {
      // The image is already live; posting it again would duplicate it.
      removeFile()
      setComposerError(`The image is live, but the text couldn't be posted: ${res.error}`)
    } else {
      setComposerError(res.error)
    }
  }

  // Returned to the shared component, which awaits it (SlideUploader posts one
  // slide after another).
  const sendMedia = async (kind, content, label) => {
    const res = await postMedia({ showId: show.id, kind, content })
    if (goneAfter(`Couldn't post ${label}`, res)) return res
    if (res.ok) {
      setMediaFailures(list => list.filter(f => f.label !== label))
    } else {
      failureSeq.current += 1
      const id = failureSeq.current
      setMediaFailures(list => [...list, { id, label, error: res.error }])
    }
    return res
  }
  const dismissFailure = (id) => setMediaFailures(list => list.filter(f => f.id !== id))

  const hide = async (comment) => {
    setHideError('')
    const res = await hideComment(comment.id)
    if (!goneAfter("Couldn't hide the comment", res) && !res.ok) {
      setHideError(`Couldn't hide the comment: ${res.error}`)
    }
  }

  const confirmEnd = () => askConfirm({
    title: 'End this live show?',
    consequence: END_CONSEQUENCE,
    confirmLabel: 'End Show',
    action: async () => {
      if (mounted.current) setEndError('')
      const res = await endShow(show.id)
      if (!goneAfter("Couldn't end the show", res) && !res.ok) {
        setEndError(`Couldn't end the show: ${res.error}`)
      }
    },
  })

  const { data, isLoading, isError, refetch, dataUpdatedAt } = control || {}
  // Settled without data is a failure, never an empty control room.
  const loadFailed = !data && !isLoading
  const retry = () => refetch?.()

  let statsArea
  if (data) {
    statsArea = (
      <>
        {isError && (
          <div role="alert" className="adm-live-warn">
            <span>Couldn't refresh the control room</span>
            <Button variant="ghost" size="sm" onClick={retry}>Retry</Button>
          </div>
        )}
        <ul className="adm-live-stats" aria-label="Live show stats">
          {STATS.map(s => (
            <li key={s.key}>
              <span className="adm-live-stat-label">{s.label}</span>
              <span className="adm-num adm-live-stat-value">{data.stats?.[s.key] ?? '—'}</span>
            </li>
          ))}
        </ul>
        {dataUpdatedAt > 0 && <p className="adm-note">Updated {clockTime(dataUpdatedAt)}</p>}
      </>
    )
  } else if (loadFailed) {
    statsArea = (
      <div role="alert" className="adm-live-warn">
        <span>Couldn't load the control room</span>
        <Button variant="ghost" size="sm" onClick={retry}>Retry</Button>
      </div>
    )
  } else {
    statsArea = (
      <>
        <ul className="adm-live-stats" aria-hidden="true">
          {STATS.map(s => (
            <li key={s.key}>
              <span className="adm-live-stat-label">{s.label}</span>
              <span className="adm-skel adm-live-skel" />
            </li>
          ))}
        </ul>
        <p role="status" className="adm-note">Loading the control room…</p>
      </>
    )
  }

  const commentsId = `${ids}-comments`
  const fileId = `${ids}-image`

  return (
    <section className="adm-panel adm-live-card" aria-label={`Live show ${show.title}`}>
      <header className="adm-live-head">
        <span className="adm-live-dot" aria-hidden="true" />
        <div className="adm-live-heading">
          <h3>{show.title}</h3>
          <p className="adm-note">Started {startedText(show.started_at)}</p>
        </div>
        <a href={`/live-show/${show.id}`} className="adm-live-link">
          <Eye size={14} aria-hidden="true" /> Audience
        </a>
        <Button variant="danger" size="sm" disabled={ending} loading={ending} loadingText="Ending…"
          leftIcon={<Square size={12} aria-hidden="true" />} onClick={confirmEnd}>
          End show
        </Button>
      </header>
      {endError && <Alert>{endError}</Alert>}

      {statsArea}

      <form onSubmit={submit} className="adm-live-composer">
        <Textarea id={`${ids}-draft`} label="Broadcast to the audience" value={text} onChange={setText} rows={2}
          placeholder="Type something to broadcast live..." />
        <div className="adm-live-file">
          <label htmlFor={fileId} className="adm-live-file-label">Add image</label>
          <input key={fileKey} id={fileId} type="file" accept="image/*" onChange={pickFile} disabled={posting} />
          {file && (
            <div className="adm-live-file-chosen">
              <span className="adm-note">{file.name}</span>
              <Button variant="ghost" size="sm" disabled={posting} leftIcon={<X size={14} aria-hidden="true" />} onClick={removeFile}>
                Remove image
              </Button>
            </div>
          )}
        </div>
        {composerError && <Alert>{composerError}</Alert>}
        <Button type="submit" variant="primary" size="sm" disabled={!canPost} loading={posting} loadingText="Posting…"
          leftIcon={<Send size={14} aria-hidden="true" />}>
          Post live
        </Button>
      </form>

      <div className="adm-live-tools">
        <VoiceRecorder showId={show.id} onRecorded={(url) => sendMedia('voice', url, 'Voice note')} />
        <SlideUploader showId={show.id}
          onPostSlide={(url, num, total) => sendMedia('slide', slideContent(url, num, total), `Slide ${num} of ${total}`)} />
        <VideoRecorder showId={show.id} onRecorded={(url) => sendMedia('video', url, 'Video')} />
        <VideoUploader showId={show.id} onUploaded={(url) => sendMedia('video', url, 'Video')} />
        {mediaFailures.length > 0 && (
          <div role="alert" aria-label="Media that did not post" className="adm-live-alert">
            <ul className="adm-live-failures">
              {mediaFailures.map(f => (
                <li key={f.id}>
                  <span>Couldn't post {f.label}: {f.error}</span>
                  <Button variant="ghost" size="sm" aria-label={`Dismiss: ${f.label}`} onClick={() => dismissFailure(f.id)}>
                    Dismiss
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {data && (
        <>
          <div>
            <h4 className="adm-live-subhead">Posted ({data.items.length})</h4>
            {data.items.length === 0
              ? <p className="adm-note">Nothing posted yet</p>
              : (
                <ul className="adm-live-list" aria-label="Posted items">
                  {data.items.map(it => <li key={it.id} className="adm-live-item"><PostedItem item={it} /></li>)}
                </ul>
              )}
          </div>

          <div>
            <h4 id={commentsId} className="adm-live-subhead">Audience comments</h4>
            {hideError && <Alert>{hideError}</Alert>}
            {data.comments.length === 0
              ? <p className="adm-note">No comments yet</p>
              : (
                <ul className="adm-live-list" aria-labelledby={commentsId}>
                  {data.comments.map(c => {
                    const name = author(c)
                    return (
                      <li key={c.id} className="adm-live-comment" style={{ opacity: c.hidden ? 0.4 : 1 }}>
                        <span className="adm-live-comment-text">
                          <strong>{name}:</strong> {c.content}
                        </span>
                        {!c.hidden && (
                          <Button variant="ghost" size="sm" disabled={isBusy('hideComment', c.id)}
                            aria-label={`Hide comment by ${name}`} onClick={() => hide(c)}>
                            Hide
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
          </div>
        </>
      )}
    </section>
  )
}
