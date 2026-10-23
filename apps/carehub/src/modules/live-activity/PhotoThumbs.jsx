import { useState, useEffect } from 'react'
import { Modal } from '../../components/ui'
import { theme } from '../../styles/theme'

const { border, gray500, tealDeep, tealMist } = theme

// One photo of a report. The stored value is a storage path in a private bucket, so the picture is only
// shown once `resolve(path)` returns a short-lived signed link (null or a throw means the person may not open
// it, or the link could not be made). Each state is visible: a placeholder while loading, the photo, or
// "Photo unavailable" with Try again.
function Thumb({ path, index, label, resolve, onOpen }) {
  const [state, setState] = useState({ status: 'loading', url: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading', url: null })
    Promise.resolve()
      .then(() => resolve(path))
      .then((url) => { if (alive) setState(url ? { status: 'ready', url } : { status: 'failed', url: null }) })
      .catch(() => { if (alive) setState({ status: 'failed', url: null }) })
    return () => { alive = false }
  }, [path, attempt])

  const box = { width: '84px', height: '84px', borderRadius: '10px', border: '1px solid ' + border, overflow: 'hidden', background: tealMist, flexShrink: 0 }
  const alt = 'Photo ' + (index + 1) + ' of ' + label

  if (state.status === 'ready') {
    return (
      <button type='button' aria-label={'Enlarge photo ' + (index + 1) + ' of ' + label} onClick={() => onOpen({ url: state.url, alt })}
        style={{ ...box, padding: 0, cursor: 'zoom-in' }}>
        <img src={state.url} alt={alt} loading='lazy'
          onError={() => setState({ status: 'failed', url: null })}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </button>
    )
  }
  if (state.status === 'failed') {
    return (
      <div role='alert' style={{ ...box, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '11px', color: gray500, textAlign: 'center', padding: '4px', boxSizing: 'border-box' }}>
        <span>Photo unavailable</span>
        <button type='button' onClick={() => setAttempt((n) => n + 1)}
          style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: '11px', cursor: 'pointer', padding: 0 }}>
          Try again
        </button>
      </div>
    )
  }
  return <div aria-busy='true' role='status' aria-label={'Loading photo ' + (index + 1)} style={{ ...box, opacity: 0.6 }} />
}

// The proof photos on a report card: renders nothing when there are none.
//   paths    the report's photo_paths
//   resolve  (path) -> Promise<signed url | null>   (liveActivityRepository.signedPhotoUrl)
//   label    what to call the report in alt text, usually the place name
export default function PhotoThumbs({ paths, resolve, label }) {
  const [open, setOpen] = useState(null)
  if (!Array.isArray(paths) || paths.length === 0) return null
  const name = label || 'this report'
  return (
    <>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {paths.map((p, i) => <Thumb key={p} path={p} index={i} label={name} resolve={resolve} onOpen={setOpen} />)}
      </div>
      <Modal show={!!open} onClose={() => setOpen(null)} title='Photo' wide>
        {open && <img src={open.url} alt={open.alt} style={{ width: '100%', height: 'auto', maxHeight: '70vh', objectFit: 'contain', borderRadius: '8px' }} />}
      </Modal>
    </>
  )
}
