import { useRef, useState, useEffect } from 'react'
import { theme } from './lib/theme'

// A finger/touch drawing canvas. Draw, pick colors, erase, clear.
// Calls onSave with a PNG blob when the user saves.
function DrawingBoard({ onSave, onCancel }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const drawing = useRef(false)
  const [color, setColor] = useState('#0f172a')
  const [size, setSize] = useState(4)
  const [saving, setSaving] = useState(false)

  const colors = ['#0f172a', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#ffffff']

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Size the canvas to its display size for crisp lines
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctxRef.current = ctx
  }, [])

  function pos(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const touch = e.touches ? e.touches[0] : e
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
  }

  function start(e) {
    e.preventDefault()
    drawing.current = true
    const ctx = ctxRef.current
    const { x, y } = pos(e)
    ctx.strokeStyle = color
    ctx.lineWidth = size
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = ctxRef.current
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function end() {
    drawing.current = false
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
  }

  async function save() {
    setSaving(true)
    const canvas = canvasRef.current
    canvas.toBlob((blob) => {
      onSave(blob)
      setSaving(false)
    }, 'image/png')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 460, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 900, color: theme.navy }}>✏️ Draw</p>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 20, color: theme.textLight }}>✕</button>
        </div>

        <canvas
          ref={canvasRef}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          style={{ width: '100%', height: 300, border: `2px solid ${theme.border}`, borderRadius: 12, touchAction: 'none', display: 'block', background: '#fff' }}
        />

        {/* Colors */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {colors.map(c => (
            <button key={c} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: color === c ? `3px solid ${theme.tealDeep}` : `1px solid ${theme.border}`, cursor: 'pointer' }} />
          ))}
        </div>

        {/* Brush size */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: theme.textMid, fontWeight: 700 }}>Size</span>
          {[2, 4, 8, 14].map(s => (
            <button key={s} onClick={() => setSize(s)} style={{ width: 34, height: 30, borderRadius: 8, background: size === s ? theme.tealDeep : theme.bg, color: size === s ? '#fff' : theme.textMid, border: 'none', fontWeight: 800, fontSize: 12 }}>{s}</button>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={clearCanvas} style={{ flex: 1, padding: 11, background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 13 }}>Clear</button>
          <button onClick={save} disabled={saving} style={{ flex: 2, padding: 11, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13 }}>{saving ? 'Saving…' : '✓ Use this drawing'}</button>
        </div>
      </div>
    </div>
  )
}

export default DrawingBoard
