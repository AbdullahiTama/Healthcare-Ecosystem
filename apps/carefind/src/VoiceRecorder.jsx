import { useState, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { theme } from './lib/theme'

// Tap to record, tap to stop, preview, then it hands the uploaded URL back via onRecorded.
function VoiceRecorder({ showId, onRecorded, disabled, hq = false }) {
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const blobRef = useRef(null)
  const timerRef = useRef(null)

  async function startRecording() {
    setError('')
    try {
      // hq = podcast-grade: clean up the room, level the voice, capture at 48kHz.
      // Standard = light-weight, for live shows on weak networks.
      const constraints = hq
        ? {
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 48000,
            },
          }
        : { audio: true }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      // Pick a mime type the browser supports
      // iOS Safari plays mp4/m4a reliably but struggles with webm — so PREFER mp4.
      let mime = ''
      if (MediaRecorder.isTypeSupported('audio/mp4')) mime = 'audio/mp4'
      else if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm'
      // Lower bitrate = smaller file = faster upload on weak networks
      const bitrate = hq ? 128000 : 32000
      const opts = mime ? { mimeType: mime, audioBitsPerSecond: bitrate } : { audioBitsPerSecond: bitrate }
      const mr = new MediaRecorder(stream, opts)
      mediaRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        blobRef.current = blob
        setPreviewUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach(t => t.stop())
      }
      mr.start()
      setRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
    } catch (err) {
      setError('Microphone access denied or unavailable.')
    }
  }

  function stopRecording() {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop()
    }
    setRecording(false)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  function discard() {
    setPreviewUrl(null)
    blobRef.current = null
    setSeconds(0)
  }

  async function sendVoice() {
    if (!blobRef.current) return
    setUploading(true)
    const ext = (blobRef.current.type.includes('mp4')) ? 'm4a' : 'webm'
    const path = `voice-${showId}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('live-media').upload(path, blobRef.current, { contentType: blobRef.current.type })
    if (upErr) {
      setError('Upload failed. Check your connection and try again.')
      setUploading(false)
      return
    }
    const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
    onRecorded(urlData.publicUrl)
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

      {!previewUrl && !recording && (
        <button onClick={startRecording} disabled={disabled} type="button" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#fef2f2', color: theme.alert, border: `1px solid ${theme.alert}`, borderRadius: 20, fontWeight: 700, fontSize: 13 }}>
          🎙 Record voice note
        </button>
      )}

      {recording && (
        <button onClick={stopRecording} type="button" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: theme.alert, color: '#fff', border: 'none', borderRadius: 20, fontWeight: 800, fontSize: 13 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: '#fff', display: 'inline-block' }} />
          Stop · {fmt(seconds)}
        </button>
      )}

      {previewUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <audio controls src={previewUrl} style={{ height: 36, maxWidth: 180 }} />
          <button onClick={sendVoice} disabled={uploading} type="button" style={{ padding: '7px 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 16, fontWeight: 800, fontSize: 12 }}>
            {uploading ? 'Uploading… please wait' : '📡 Post voice'}
          </button>
          <button onClick={discard} type="button" style={{ padding: '7px 12px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 16, fontWeight: 700, fontSize: 12 }}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

export default VoiceRecorder
