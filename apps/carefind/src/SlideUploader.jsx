import { useState, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { theme } from './lib/theme'

// Host uploads a PDF -> we render each page to an image via PDF.js (from CDN)
// -> host posts each page as a numbered "slide" to the live show.
function SlideUploader({ showId, onPostSlide }) {
  const [slides, setSlides] = useState([])      // [{ blob, url (preview) }]
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [postingIndex, setPostingIndex] = useState(null)
  const [postedIndexes, setPostedIndexes] = useState([])
  const fileRef = useRef(null)

  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      s.onload = resolve
      s.onerror = reject
      document.body.appendChild(s)
    })
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    return window.pdfjsLib
  }

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setError(''); setSlides([]); setPostedIndexes([])
    setProcessing(true)
    setProgress('Loading PDF engine…')
    try {
      const pdfjsLib = await loadPdfJs()
      const buf = await file.arrayBuffer()
      setProgress('Reading PDF…')
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise
      const pageCount = pdf.numPages
      const out = []
      for (let i = 1; i <= pageCount; i++) {
        setProgress(`Rendering slide ${i} of ${pageCount}…`)
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 1.4 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        await page.render({ canvasContext: ctx, viewport }).promise
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8))
        out.push({ blob, url: URL.createObjectURL(blob) })
      }
      setSlides(out)
      setProgress('')
    } catch (err) {
      setError('Could not process that PDF: ' + (err?.message || 'unknown error') + '. Try a smaller/simpler PDF, or check your connection.')
    }
    setProcessing(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function postSlide(idx) {
    setPostingIndex(idx)
    const slide = slides[idx]
    const path = `slide-${showId}-${Date.now()}-${idx}.jpg`
    const { error: upErr } = await supabase.storage.from('live-media').upload(path, slide.blob, { contentType: 'image/jpeg' })
    if (upErr) {
      setError('Upload failed: ' + (upErr.message || 'check your connection'))
      setPostingIndex(null)
      return
    }
    const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
    // Post with a slide marker so audience shows "Slide N"
    await onPostSlide(urlData.publicUrl, idx + 1, slides.length)
    setPostedIndexes(prev => [...prev, idx])
    setPostingIndex(null)
  }

  return (
    <div style={{ marginBottom: 10, padding: 10, background: theme.bg, borderRadius: 12, border: `1px dashed ${theme.border}` }}>
      <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: theme.navy }}>📑 Present slides (PDF)</p>

      {error && <p style={{ margin: '0 0 6px 0', fontSize: 11, color: theme.alert }}>{error}</p>}

      {slides.length === 0 && (
        <>
          <label style={{ fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer' }}>
            {processing ? (progress || 'Processing…') : '📎 Upload a PDF to present'}
            <input ref={fileRef} type="file" accept="application/pdf" onChange={handleFile} disabled={processing} style={{ display: 'none' }} />
          </label>
          <p style={{ margin: '6px 0 0 0', fontSize: 10, color: theme.textLight }}>Each page becomes a slide you post one at a time. Large PDFs may be slow on weak networks.</p>
        </>
      )}

      {slides.length > 0 && (
        <div>
          <p style={{ margin: '0 0 8px 0', fontSize: 11, color: theme.textMid }}>{slides.length} slides ready. Post them one at a time, and record a voice note to explain each.</p>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {slides.map((s, i) => (
              <div key={i} style={{ flexShrink: 0, width: 120 }}>
                <div style={{ position: 'relative', border: `2px solid ${postedIndexes.includes(i) ? theme.tealDeep : theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <img src={s.url} alt={`Slide ${i + 1}`} style={{ width: '100%', display: 'block' }} />
                  <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 8 }}>#{i + 1}</span>
                  {postedIndexes.includes(i) && <span style={{ position: 'absolute', bottom: 4, right: 4, background: theme.tealDeep, color: '#fff', fontSize: 8, fontWeight: 800, padding: '1px 6px', borderRadius: 8 }}>✓ posted</span>}
                </div>
                <button onClick={() => postSlide(i)} disabled={postingIndex === i} style={{ width: '100%', marginTop: 4, padding: 6, background: postedIndexes.includes(i) ? theme.bg : theme.tealGradient, color: postedIndexes.includes(i) ? theme.textMid : '#fff', border: postedIndexes.includes(i) ? `1px solid ${theme.border}` : 'none', borderRadius: 8, fontWeight: 800, fontSize: 11 }}>
                  {postingIndex === i ? 'Posting…' : postedIndexes.includes(i) ? 'Post again' : 'Post slide'}
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => { setSlides([]); setPostedIndexes([]) }} style={{ marginTop: 8, padding: '6px 12px', background: 'none', color: theme.textLight, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Clear slides</button>
        </div>
      )}
    </div>
  )
}

export default SlideUploader
