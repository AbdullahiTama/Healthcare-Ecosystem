import { useState, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { theme } from './lib/theme'

const MAX_MB = 50

// Pick a video, check size, preview, upload, then hand the URL back via onUploaded.
function VideoUploader({ showId, onUploaded }) {
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  function pickFile(e) {
    setError('')
    const f = e.target.files[0]
    if (!f) return
    const sizeMb = f.size / (1024 * 1024)
    if (sizeMb > MAX_MB) {
      setError(`That video is ${sizeMb.toFixed(0)}MB — too large. Please use one under ${MAX_MB}MB (a shorter or lower-quality clip).`)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  function discard() {
    setFile(null)
    setPreviewUrl(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function upload() {
    if (!file) return
    setUploading(true)
    setError('')
    const ext = file.name.split('.').pop() || 'mp4'
    const path = `video-${showId}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('live-media').upload(path, file, { contentType: file.type || 'video/mp4' })
    if (upErr) {
      setError('Upload failed. On a weak connection, try a shorter clip.')
      setUploading(false)
      return
    }
    const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
    await onUploaded(urlData.publicUrl)
    setUploading(false)
    discard()
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {error && <p style={{ margin: '0 0 6px 0', fontSize: 11, color: theme.alert }}>{error}</p>}

      {!previewUrl && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #1d4ed8', borderRadius: 20, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          📹 Upload video
          <input ref={inputRef} type="file" accept="video/*" onChange={pickFile} style={{ display: 'none' }} />
        </label>
      )}

      {previewUrl && (
        <div>
          <video src={previewUrl} controls playsInline style={{ width: '100%', maxWidth: 260, borderRadius: 10, display: 'block', marginBottom: 6 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={upload} disabled={uploading} type="button" style={{ padding: '7px 16px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 16, fontWeight: 800, fontSize: 12 }}>
              {uploading ? 'Uploading… please wait' : '📡 Post video'}
            </button>
            <button onClick={discard} disabled={uploading} type="button" style={{ padding: '7px 12px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 16, fontWeight: 700, fontSize: 12 }}>
              Discard
            </button>
          </div>
          <p style={{ margin: '5px 0 0 0', fontSize: 10, color: theme.textLight }}>Max {MAX_MB}MB. Larger videos may fail on weak networks.</p>
        </div>
      )}
    </div>
  )
}

export default VideoUploader
