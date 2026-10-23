import { useState, useEffect, useRef } from 'react'
import { Camera, X } from 'lucide-react'
import { prepareProofPhoto } from './photoPrep'
import { MAX_PHOTOS } from './photoUrl'
import { theme } from '../../styles/theme'

const { navy, gray600, border, danger, tealDeep, tealMist } = theme

const REASON_TEXT = {
  not_image: 'That file is not a photo this device can read. Choose a picture from your camera or gallery.',
  too_large: 'That photo is too large (15 MB at most). Choose a smaller one.',
  decode_failed: 'This device could not prepare that photo. Try another one.',
}

let keySeq = 0

function Thumb({ blob, index, onRemove, disabled }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return (
    <div style={{ position: 'relative', width: '72px', height: '72px', borderRadius: '10px', overflow: 'hidden', border: '1px solid ' + border, background: tealMist }}>
      {url && <img src={url} alt={'Photo ' + (index + 1) + ' of this report'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      <button type='button' aria-label={'Remove photo ' + (index + 1)} disabled={disabled} onClick={onRemove}
        style={{ position: 'absolute', top: '2px', right: '2px', width: '28px', height: '28px', borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.65)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
        <X size={14} aria-hidden='true' />
      </button>
    </div>
  )
}

// Up to `max` proof photos for a report. The parent owns the list ([{ key, blob }]); each photo is prepared
// (resized and re-encoded, which drops its embedded GPS) before it is added. Nothing is uploaded here: the
// photos travel with the report when it is saved or queued.
export default function PhotoAttach({ photos, onChange, prepare = prepareProofPhoto, max = MAX_PHOTOS, disabled = false }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const fileInput = useRef(null)
  const full = photos.length >= max

  async function onChoose(e) {
    const chosen = Array.from((e.target && e.target.files) || [])
    if (e.target) { try { e.target.value = '' } catch (err) { /* some browsers refuse to reset a file field */ } }
    if (chosen.length === 0) return
    const room = Math.max(0, max - photos.length)
    const notes = []
    if (chosen.length > room) notes.push('Only ' + max + ' photos fit; the rest were skipped.')
    const added = []
    setBusy(true)
    setMessage('')
    for (const file of chosen.slice(0, room)) {
      let result
      try { result = await prepare(file) } catch (err) { result = { ok: false, reason: 'decode_failed' } }
      if (result && result.ok) added.push({ key: 'photo-' + (++keySeq), blob: result.blob })
      else notes.push(REASON_TEXT[result && result.reason] || REASON_TEXT.decode_failed)
    }
    setBusy(false)
    if (added.length > 0) onChange([...photos, ...added])
    setMessage(notes.join(' '))
  }

  return (
    <div role='group' aria-label='Proof photos' style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {photos.map((p, i) => (
          <Thumb key={p.key} blob={p.blob} index={i} disabled={disabled || busy}
            onRemove={() => { setMessage(''); onChange(photos.filter((x) => x.key !== p.key)) }} />
        ))}
        <button type='button' disabled={disabled || busy || full} aria-busy={busy}
          onClick={() => fileInput.current && fileInput.current.click()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '44px', padding: '0 14px', borderRadius: '10px', border: '1px dashed ' + tealDeep, background: 'white', color: tealDeep, fontWeight: 700, fontSize: '13px', cursor: (disabled || busy || full) ? 'not-allowed' : 'pointer', opacity: (disabled || full) ? 0.6 : 1 }}>
          <Camera size={16} aria-hidden='true' />
          {busy ? 'Preparing photo…' : 'Add photo'}
        </button>
        <input ref={fileInput} type='file' accept='image/*' multiple hidden onChange={onChoose} />
      </div>
      <span style={{ fontSize: '12px', color: gray600 }}>
        {full ? 'Up to ' + max + ' photos per report: remove one to add another.' : 'Up to ' + max + ' photos. They are resized, and any location stored inside them is removed.'}
      </span>
      {busy && <span role='status' style={{ fontSize: '12px', color: navy }}>Preparing photo…</span>}
      {message && <span role='alert' style={{ fontSize: '12px', color: danger }}>{message}</span>}
    </div>
  )
}
