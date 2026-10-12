import { useEffect, useRef, useState } from 'react'
import { Trash2, BookOpen, X } from 'lucide-react'
import { Button, Input, Textarea, Empty } from '@care-ecosystem/design-system/components/ui'
import { timeAgo } from '../ui'
import { useStoriesList } from '../hooks/useContentLists'
import { useContentActions } from '../hooks/useContentActions'
import { useAdmin } from '../provider/AdminProvider.jsx'

const COLOR_PRESETS = [
  { value: 'var(--color-primary)', label: 'Teal' },
  { value: 'var(--color-navy)', label: 'Dark Teal' },
  { value: 'var(--color-purple)', label: 'Purple' },
  { value: 'var(--color-danger)', label: 'Rose' },
  { value: 'var(--color-warning)', label: 'Orange' },
  { value: 'var(--color-info)', label: 'Blue' },
]
const DEFAULT_COLOR = COLOR_PRESETS[0].value
const DELETE_CONSEQUENCE = 'This permanently removes the story from the feed. This cannot be undone.'
const EXCERPT_LENGTH = 60

// Story fields come from the database: an image is only ever shown from an
// http(s) URL, and a background colour only from the presets.
const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url)
const knownColor = (c) => (COLOR_PRESETS.some(p => p.value === c) ? c : DEFAULT_COLOR)

const labelStyle = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--adm-ink-mid)', marginBottom: 6 }
const fieldsStyle = { display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }
const errorStyle = { margin: 0, padding: '10px 12px', borderRadius: 8, background: 'var(--adm-urgent-wash)', color: 'var(--adm-urgent)', fontSize: 13 }

function StoryRow({ story, disabled, error, onDelete }) {
  const expired = story.expires_at && new Date(story.expires_at) < new Date()
  const name = story.title || '(no title)'
  const body = typeof story.body === 'string' ? story.body.slice(0, EXCERPT_LENGTH) : ''
  return (
    <li style={{ padding: '12px 16px', opacity: expired ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {isHttpUrl(story.image_url)
          ? <img src={story.image_url} alt="" loading="lazy" style={{ width: 50, height: 50, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
          : (
            <span aria-hidden="true" style={{ width: 50, height: 50, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: knownColor(story.bg_color), color: 'white', fontWeight: 800 }}>
              {story.title?.[0]?.toUpperCase() || '★'}
            </span>
          )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere' }}>{name}</div>
          {body && <div className="adm-note" style={{ overflowWrap: 'anywhere' }}>{body}</div>}
          <div className="adm-note">{expired ? 'Expired' : 'Live'} · {timeAgo(story.created_at)}</div>
        </div>
        <Button variant="danger" size="sm" disabled={disabled} aria-label={`Delete story ${name}`}
          leftIcon={<Trash2 size={14} aria-hidden="true" />} onClick={onDelete}>
          Delete
        </Button>
      </div>
      {error && <p role="alert" style={{ ...errorStyle, marginTop: 8 }}>{error}</p>}
    </li>
  )
}

export default function StoriesSection() {
  const query = useStoriesList()
  const { busy, createStory, deleteStory } = useContentActions()
  const { askConfirm, showToast } = useAdmin()
  // Whether this screen is still shown. A create or delete can end after the
  // admin has left the tab; its form and rows are gone then, so a failure is
  // toasted rather than dropped (a success was already toasted by the hook).
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const toastIfGone = (verb, res) => {
    if (mounted.current) return false
    if (!res.ok) showToast(`Couldn't ${verb} the story: ${res.error}`, { type: 'error' })
    return true
  }

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [bgColor, setBgColor] = useState(DEFAULT_COLOR)
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0) // remounts the file input to clear it
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [deleteErrors, setDeleteErrors] = useState({})

  useEffect(() => {
    if (!file) { setPreview(null); return undefined }
    let cancelled = false
    const reader = new FileReader()
    reader.onloadend = () => { if (!cancelled) setPreview(reader.result) }
    reader.readAsDataURL(file)
    return () => { cancelled = true }
  }, [file])

  const valid = !!(title.trim() || body.trim() || file)

  const pickFile = (e) => {
    setFile(e.target.files?.[0] || null)
    setError('')
  }
  const removeFile = () => { setFile(null); setFileKey(k => k + 1) }

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !valid) return
    setError('')
    const res = await createStory({ title: title.trim(), body: body.trim(), bgColor, imageFile: file })
    if (toastIfGone('create', res)) return
    if (res.ok) {
      setTitle(''); setBody(''); setBgColor(DEFAULT_COLOR); removeFile()
    } else {
      setError(res.error || "Couldn't publish the story")
    }
  }

  const confirmDelete = (story) => askConfirm({
    title: 'Delete this story?',
    consequence: DELETE_CONSEQUENCE,
    confirmLabel: 'Delete',
    action: async () => {
      const res = await deleteStory(story.id)
      if (toastIfGone('delete', res)) return
      setDeleteErrors(prev => {
        const next = { ...prev }
        if (res.ok) delete next[story.id]
        else next[story.id] = `Couldn't delete the story: ${res.error}`
        return next
      })
    },
  })

  let list
  if (query.isError) {
    list = (
      <div style={{ padding: 16 }}>
        <p className="adm-note">Couldn't load stories</p>
        <Button variant="ghost" size="sm" onClick={() => query.refetch()}>Retry</Button>
      </div>
    )
  } else if (query.isLoading || !query.data) {
    list = <p role="status" className="adm-note" style={{ padding: 16 }}>Loading stories…</p>
  } else if (query.data.length === 0) {
    list = <Empty icon={<BookOpen size={40} strokeWidth={1.5} />} message="No stories yet" cause="none" />
  } else {
    list = (
      <ul className="adm-queue">
        {query.data.map(s => (
          <StoryRow key={s.id} story={s} disabled={busy} error={deleteErrors[s.id]} onDelete={() => confirmDelete(s)} />
        ))}
      </ul>
    )
  }

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>Stories</h1>
          <p className="adm-note">Manage stories that appear at the top of the feed</p>
        </div>
      </header>

      <section className="adm-panel" aria-labelledby="story-create-h">
        <div className="adm-phead">
          <div>
            <h2 id="story-create-h">Post a Story</h2>
            <p className="adm-note">Stories auto-expire after 24 hours</p>
          </div>
        </div>
        <form onSubmit={submit} style={fieldsStyle}>
          <Input label="Story Title" value={title} onChange={setTitle} disabled={busy} placeholder="e.g. New Feature!" />
          <Textarea label="Story Message" value={body} onChange={setBody} disabled={busy} rows={3} placeholder="Write your story message..." />

          <div role="group" aria-labelledby="story-bg-label">
            <span id="story-bg-label" style={labelStyle}>Background Color</span>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {COLOR_PRESETS.map(c => (
                <button key={c.value} type="button" aria-label={c.label} title={c.label} aria-pressed={bgColor === c.value}
                  disabled={busy} onClick={() => setBgColor(c.value)}
                  style={{
                    width: 40, height: 40, borderRadius: '50%', background: c.value, cursor: busy ? 'not-allowed' : 'pointer',
                    border: bgColor === c.value ? '3px solid var(--adm-ink)' : '2px solid var(--adm-line)',
                    opacity: busy ? 0.6 : 1,
                  }} />
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="story-image" style={labelStyle}>Image (optional)</label>
            <input key={fileKey} id="story-image" type="file" accept="image/*" onChange={pickFile} disabled={busy} />
            {file && <div className="adm-note" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{file.name}</div>}
            {preview && (
              <div style={{ marginTop: 8 }}>
                <img src={preview} alt="Selected image preview" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block', borderRadius: 8, border: '1px solid var(--adm-line)' }} />
              </div>
            )}
            {file && (
              <Button variant="ghost" size="sm" disabled={busy} leftIcon={<X size={14} aria-hidden="true" />}
                onClick={removeFile} style={{ marginTop: 8 }}>
                Remove image
              </Button>
            )}
          </div>

          {error && <p role="alert" style={errorStyle}>{error}</p>}
          <Button type="submit" variant="primary" fullWidth loading={busy} loadingText="Publishing…" disabled={busy || !valid}>
            Publish story
          </Button>
        </form>
      </section>

      <section className="adm-panel" aria-labelledby="story-list-h">
        <div className="adm-phead"><h2 id="story-list-h">Active Stories</h2></div>
        {list}
      </section>
    </div>
  )
}
