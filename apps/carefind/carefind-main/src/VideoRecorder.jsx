import { useState, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { theme } from './lib/theme'

// Tap to record video from the camera, tap stop, preview, then post.
// Uses MediaRecorder with camera + mic. Prefers mp4 for iOS playback.
function VideoRecorder({ showId, onRecorded }) {
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const [facing, setFacing] = useState('user') // 'user' = front, 'environment' = back
  const [live, setLive] = useState(false)
  const [error, setError] = useState('')
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const blobRef = useRef(null)
  const timerRef = useRef(null)

  async function openCamera(useFacing) {
    setError('')
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: useFacing, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }
      setLive(true)
    } catch (err) {
      setError('Camera access denied or unavailable.')
      setLive(false)
    }
  }

  async function switchCamera() {
    const next = facing === 'user' ? 'environment' : 'user'
    setFacing(next)
    if (live) await openCamera(next)
  }

  function startRecording() {
    if (!streamRef.current) return
    try {
      let mime = ''
      if (MediaRecorder.isTypeSupported('video/mp4')) mime = 'video/mp4'
      else if (MediaRecorder.isTypeSupported('video/webm')) mime = 'video/webm'
      const opts = mime ? { mimeType: mime, videoBitsPerSecond: 800000 } : { videoBitsPerSecond: 800000 }
      const mr = new MediaRecorder(streamRef.current, opts)
      mediaRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'video/mp4' })
        blobRef.current = blob
        setPreviewUrl(URL.createObjectURL(blob))
        // Stop the camera after recording
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
        setLive(false)
      }
      mr.start()
      setRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
    } catch (err) {
      setError('Could not start recording.')
    }
  }

  function stopRecording() {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop()
    setRecording(false)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  function discard() {
    setPreviewUrl(null)
    blobRef.current = null
    setSeconds(0)
  }

  function closeAll() {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    setLive(false)
    discard()
  }

  async function sendVideo() {
    if (!blobRef.current) return
    setUploading(true)
    const ext = (blobRef.current.type.includes('mp4')) ? 'mp4' : 'webm'
    const path = `rec-${showId}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('live-media').upload(path, blobRef.current, { contentType: blobRef.current.type })
    if (upErr) {
      setError('Upload failed. On a weak connection, record a shorter clip.')
      setUploading(false)
      return
    }
    const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
    await onRecorded(urlData.publicUrl)
    setUploading(false)
    discard()
  }

  function fmt(s) {
    const m = Math.floor(s / 60), sec = s % 60
    return `${m}:${sec < 10 ? '0' : ''}${sec}`
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {error && <p style={{ margin: '0 0 6px 0', fontSize: 11, color: theme.alert }}>{error}</p>}

      {/* Not started: show the record-video entry button */}
      {!live && !previewUrl && (
        <button onClick={() => openCamera(facing)} type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#fdf2f8', color: '#be185d', border: '1px solid #be185d', borderRadius: 20, fontWeight: 700, fontSize: 13 }}>
          🎥 Record video
        </button>
      )}

      {/* Camera is open (previewing or recording) */}
      {live && (
        <div>
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000', marginBottom: 8 }}>
            <video ref={videoRef} muted playsInline style={{ width: '100%', maxWidth: 300, display: 'block', transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
            {recording && (
              <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(220,38,38,0.9)', color: '#fff', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} /> REC {fmt(seconds)}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!recording && (
              <>
                <button onClick={startRecording} type="button" style={{ padding: '8px 16px', background: theme.alert, color: '#fff', border: 'none', borderRadius: 16, fontWeight: 800, fontSize: 13 }}>● Start recording</button>
                <button onClick={switchCamera} type="button" style={{ padding: '8px 12px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 16, fontWeight: 700, fontSize: 12 }}>🔄 Flip camera</button>
                <button onClick={closeAll} type="button" style={{ padding: '8px 12px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 16, fontWeight: 700, fontSize: 12 }}>Cancel</button>
              </>
            )}
            {recording && (
              <button onClick={stopRecording} type="button" style={{ padding: '8px 18px', background: theme.navy, color: '#fff', border: 'none', borderRadius: 16, fontWeight: 800, fontSize: 13 }}>■ Stop</button>
            )}
          </div>
        </div>
      )}

      {/* Preview recorded clip before posting */}
      {previewUrl && (
        <div>
          <video src={previewUrl} controls playsInline style={{ width: '100%', maxWidth: 300, borderRadius: 12, display: 'block', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={sendVideo} disabled={uploading} type="button" style={{ padding: '8px 16px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 16, fontWeight: 800, fontSize: 12 }}>
              {uploading ? 'Uploading… please wait' : '📡 Post video'}
            </button>
            <button onClick={() => { discard(); openCamera(facing) }} disabled={uploading} type="button" style={{ padding: '8px 12px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 16, fontWeight: 700, fontSize: 12 }}>Re-record</button>
            <button onClick={discard} disabled={uploading} type="button" style={{ padding: '8px 12px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 16, fontWeight: 700, fontSize: 12 }}>Discard</button>
          </div>
          <p style={{ margin: '5px 0 0 0', fontSize: 10, color: theme.textLight }}>Keep clips short on weak networks — video uploads are large.</p>
        </div>
      )}
    </div>
  )
}

export default VideoRecorder
