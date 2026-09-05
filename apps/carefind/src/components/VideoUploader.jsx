import { useState, useRef } from 'react'
import { supabase } from '../config/supabaseClient'
import { Send, Video } from 'lucide-react'
import { theme } from '../styles/theme'
import { validateVideoFile, probeVideoDuration, MAX_VIDEO_MB } from '../modules/social-feed/mediaLimits.js'

const MAX_MB = MAX_VIDEO_MB

// Pick a video, check size, preview, upload, then hand the URL back via onUploaded.
function VideoUploader({ showId, onUploaded }) {
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  async function pickFile(e) {
    setError('')
    const f = e.target.files[0]
    if (!f) return
    const duration = await probeVideoDuration(f)
    const err = validateVideoFile({ size: f.size, duration })
    if (err) {
      setError(err)
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
    // Re-validate before upload in case probe was pending at pick time
    const duration = await probeVideoDuration(file)
    const err = validateVideoFile({ size: file.size, duration })
    if (err) {
      setError(err)
      return
    }
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
          <Video size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 7 }} />Upload video
          <input ref={inputRef} type="file" accept="video/*" onChange={pickFile} style={{ display: 'none' }} />
        </label>
      )}

      {previewUrl && (
        <div>
          <video src={previewUrl} controls playsInline style={{ width: '100%', maxWidth: 260, borderRadius: 10, display: 'block', marginBottom: 6 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={upload} disabled={uploading} type="button" style={{ padding: '7px 16px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 16, fontWeight: 800, fontSize: 12 }}>
              {uploading ? 'Uploading… please wait' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Send size={14} aria-hidden="true" /> Post video</span>}
            </button>
            <button onClick={discard} disabled={uploading} type="button" style={{ padding: '7px 12px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 16, fontWeight: 700, fontSize: 12 }}>
              Discard
            </button>
          </div>
          <p style={{ margin: '5px 0 0 0', fontSize: 10, color: theme.textLight }}>Max {MAX_MB}MB, 2 minutes. Larger videos may fail on weak networks.</p>
        </div>
      )}
    </div>
  )
}

export default VideoUploader
