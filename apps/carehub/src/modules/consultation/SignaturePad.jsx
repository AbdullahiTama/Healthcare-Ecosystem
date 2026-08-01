import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { theme } from '../../styles/theme'

// Touch/mouse signature canvas. Parent controls it through the ref:
//   const pad = useRef(null)
//   pad.current?.getDataUrl()   → PNG data URL ('' if untouched)
//   pad.current?.clear()        → wipe the canvas
// White background is painted in so the PNG stays small and printable.
const SignaturePad = forwardRef(function SignaturePad({ label = 'Signature', height = 150, onInput }, ref) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)

  function clear() {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    onInput?.()
  }

  function getDataUrl() {
    const c = canvasRef.current
    if (!c) return ''
    const ctx = c.getContext('2d')
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let hasInk = false
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) { hasInk = true; break } }
    return hasInk ? c.toDataURL('image/png') : ''
  }

  useImperativeHandle(ref, () => ({ clear, getDataUrl }))

  useEffect(() => {
    const c = canvasRef.current
    const ctx = c.getContext('2d')
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = theme.navy
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
  }, [])

  function pos(e) {
    const c = canvasRef.current
    const rect = c.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return {
      x: (t.clientX - rect.left) * (c.width / rect.width),
      y: (t.clientY - rect.top) * (c.height / rect.height),
    }
  }

  function start(e) {
    e.preventDefault()
    drawing.current = true
    last.current = pos(e)
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const p = pos(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }

  function end() { drawing.current = false }

  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: '700', color: theme.gray600, marginBottom: '6px' }}>{label}</div>
      <div style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, overflow: 'hidden', position: 'relative', background: '#fff' }}>
        <canvas
          ref={canvasRef}
          width={560}
          height={Math.max(120, height * 2)}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          aria-label={label}
          style={{ width: '100%', height, display: 'block', touchAction: 'none', cursor: 'crosshair' }}
        />
      </div>
      <button
        type="button"
        onClick={clear}
        style={{ marginTop: 6, padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${theme.border}`, background: '#fff', color: theme.gray600, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
      >
        Clear
      </button>
    </div>
  )
})

export default SignaturePad
