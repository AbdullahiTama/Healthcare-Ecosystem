// Voice Card: renders the shareable card onto a canvas and exports it.
//
//  - exportImage()  -> PNG. Works on every device.
//  - exportVideo()  -> MP4/WebM with the voice track. Works where the browser
//                      supports MediaRecorder + canvas capture (Android/Chrome).
//
// Both bake in the CareFind logo, so the brand travels with the post.

export const CARD_THEMES = {
  'teal-depth':      { from: '#0F766E', to: '#0D9488', text: '#FFFFFF' },
  'navy-clinical':   { from: '#0F172A', to: '#1E293B', text: '#FFFFFF' },
  'midnight-teal':   { from: '#042F2E', to: '#134E4A', text: '#FFFFFF' },
  'forest-wellness': { from: '#14532D', to: '#166534', text: '#FFFFFF' },
  'slate-pulse':     { from: '#7F1D1D', to: '#9F1239', text: '#FFFFFF' },
}

const SIZE = 1080 // square — the format WhatsApp Status likes

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Wraps text to the card width and centres the block vertically.
function drawWrappedText(ctx, text, color) {
  const maxWidth = SIZE - 200
  const words = String(text || '').split(/\s+/).filter(Boolean)

  // Shrink the font until it fits comfortably
  let fontSize = 76
  let lines = []
  for (; fontSize >= 34; fontSize -= 4) {
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, Helvetica, sans-serif`
    lines = []
    let line = ''
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = w
      } else {
        line = test
      }
    }
    if (line) lines.push(line)
    if (lines.length * fontSize * 1.35 <= SIZE - 420) break
  }

  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const lh = fontSize * 1.35
  const startY = SIZE / 2 - ((lines.length - 1) * lh) / 2 - 30
  lines.forEach((ln, i) => {
    ctx.fillText(ln, SIZE / 2, startY + i * lh)
  })
}

// The CareFind logo, bottom-left — the whole point of the export.
function drawLogo(ctx, username) {
  const s = 64
  const x = 70
  const y = SIZE - 70 - s

  const g = ctx.createLinearGradient(x, y, x + s, y + s)
  g.addColorStop(0, '#0D9488')
  g.addColorStop(1, '#14B8A6')
  ctx.fillStyle = g
  roundRect(ctx, x, y, s, s, s * 0.28)
  ctx.fill()

  ctx.fillStyle = '#FFFFFF'
  ctx.font = `900 ${s * 0.58}px system-ui, -apple-system, Helvetica, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('C', x + s / 2, y + s / 2 + 2)

  ctx.textAlign = 'left'
  ctx.letterSpacing = '4px'
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = '700 30px system-ui, -apple-system, Helvetica, sans-serif'
  ctx.fillText('CAREFIND', x + s + 20, y + s / 2 - (username ? 14 : 0) + 2)
  ctx.letterSpacing = '0px'

  // The creator's handle travels with the card, like TikTok
  if (username) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.font = '800 26px system-ui, -apple-system, Helvetica, sans-serif'
    ctx.fillText(`@${String(username).replace(/^@/, '')}`, x + s + 20, y + s / 2 + 22)
  }
  ctx.textAlign = 'center'
}

// Optional: a soft sound-wave hint so a silent screenshot still reads as "has voice"
function drawWave(ctx, color, phase = 0) {
  const cx = SIZE / 2
  const baseY = SIZE - 190
  const bars = 28
  const gap = 14
  const w = 8
  const totalW = bars * w + (bars - 1) * gap
  let x = cx - totalW / 2

  ctx.fillStyle = color
  for (let i = 0; i < bars; i++) {
    const t = i / bars
    const h = 16 + Math.abs(Math.sin(t * Math.PI * 3 + phase)) * 44
    roundRect(ctx, x, baseY - h / 2, w, h, 4)
    ctx.fill()
    x += w + gap
  }
}

export function drawCard(canvas, { text, theme = 'teal-depth', hasVoice = false, phase = 0, image = null, video = null, username = '' }) {
  const t = CARD_THEMES[theme] || CARD_THEMES['teal-depth']
  const ctx = canvas.getContext('2d')

  const backdrop = video || image
  const bw = video ? video.videoWidth : (image ? image.width : 0)
  const bh = video ? video.videoHeight : (image ? image.height : 0)

  if (backdrop && bw && bh) {
    // Cover-fit the photo/drawing/video, then darken it so text and logo stay readable
    const scale = Math.max(SIZE / bw, SIZE / bh)
    const w = bw * scale
    const h = bh * scale
    ctx.drawImage(backdrop, (SIZE - w) / 2, (SIZE - h) / 2, w, h)

    const shade = ctx.createLinearGradient(0, 0, 0, SIZE)
    shade.addColorStop(0, 'rgba(0,0,0,0.35)')
    shade.addColorStop(0.55, 'rgba(0,0,0,0.30)')
    shade.addColorStop(1, 'rgba(0,0,0,0.62)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, SIZE, SIZE)
  } else {
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE)
    g.addColorStop(0, t.from)
    g.addColorStop(1, t.to)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, SIZE, SIZE)
  }

  drawWrappedText(ctx, text, '#FFFFFF')
  if (hasVoice) drawWave(ctx, 'rgba(255,255,255,0.4)', phase)
  drawLogo(ctx, username)
}

// Load a video so we can paint its frames onto the canvas
export function loadVideo(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return }
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true          // the voice is the audio — the clip is a silent backdrop
    v.loop = true
    v.playsInline = true
    v.preload = 'auto'
    v.onloadeddata = () => resolve(v)
    v.onerror = () => resolve(null)  // fall back to the gradient rather than fail
    v.src = url
  })
}

// Load a Supabase image so we can paint it onto the canvas without tainting it
export function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null) // fall back to the gradient rather than fail
    img.src = url
  })
}

function newCanvas() {
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  return c
}

// ---- PNG export (always works) ----
export async function exportImage(opts) {
  const canvas = newCanvas()
  const image = await loadImage(opts.imageUrl)
  let video = null
  if (!image && opts.videoUrl) {
    video = await loadVideo(opts.videoUrl)
    if (video) {
      // Nudge to a frame with something on it, rather than a black first frame
      try {
        video.currentTime = Math.min(0.4, (video.duration || 1) / 3)
        await new Promise((r) => { video.onseeked = r; setTimeout(r, 600) })
      } catch (e) { /* use whatever frame we have */ }
    }
  }
  drawCard(canvas, { ...opts, image, video, phase: 0 })
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

// Can this browser record a canvas + audio into a video?
export function canExportVideo() {
  try {
    if (typeof MediaRecorder === 'undefined') return false
    const c = document.createElement('canvas')
    if (typeof c.captureStream !== 'function') return false
    return !!pickMimeType()
  } catch (e) {
    return false
  }
}

function pickMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m
  }
  return null
}

// ---- Video export (card + voice) ----
// Plays the voice through an audio graph, records the animated canvas alongside it.
// Resolves { blob, ext } or throws if the browser can't do it.
export async function exportVideo({ text, theme, audioUrl, imageUrl, videoUrl, username, onProgress }) {
  const mimeType = pickMimeType()
  if (!mimeType || typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot create videos')
  }

  const canvas = newCanvas()
  const image = await loadImage(imageUrl)
  const video = image ? null : await loadVideo(videoUrl)
  if (video) { try { await video.play() } catch (e) { /* keep going; frames may still draw */ } }
  drawCard(canvas, { text, theme, hasVoice: true, phase: 0, image, video, username })

  const canvasStream = canvas.captureStream(30)

  // Pull the voice in and route it into the recording
  const res = await fetch(audioUrl)
  const buf = await res.arrayBuffer()
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const actx = new AudioCtx()
  const decoded = await actx.decodeAudioData(buf)

  const dest = actx.createMediaStreamDestination()
  const src = actx.createBufferSource()
  src.buffer = decoded
  src.connect(dest)

  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ])

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2500000,
    audioBitsPerSecond: 128000, // keep the voice podcast-clear in the exported video
  })
  const chunks = []
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }

  const duration = decoded.duration || 3
  let raf
  const startedAt = performance.now()

  const animate = () => {
    const elapsed = (performance.now() - startedAt) / 1000
    drawCard(canvas, { text, theme, hasVoice: true, phase: elapsed * 6, image, video, username })
    if (onProgress) onProgress(Math.min(1, elapsed / duration))
    if (elapsed < duration) raf = requestAnimationFrame(animate)
  }

  return new Promise((resolve, reject) => {
    recorder.onerror = (e) => {
      cancelAnimationFrame(raf)
      actx.close()
      reject(new Error('Recording failed'))
    }

    recorder.onstop = () => {
      cancelAnimationFrame(raf)
      actx.close()
      if (video) { try { video.pause() } catch (e) {} }
      const blob = new Blob(chunks, { type: mimeType })
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      resolve({ blob, ext })
    }

    recorder.start()
    src.start()
    animate()

    // Stop shortly after the voice ends
    setTimeout(() => {
      try { recorder.stop() } catch (e) { /* already stopped */ }
    }, duration * 1000 + 400)
  })
}

// Hand the file to the user — native share sheet where possible, else download.
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type })

  // The share sheet is what puts it straight into WhatsApp Status
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'CareFind' })
      return 'shared'
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled'
      // fall through to download
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return 'downloaded'
}
