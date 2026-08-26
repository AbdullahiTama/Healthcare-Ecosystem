import { useState, useRef, useEffect, useCallback } from 'react'
import { Trash2 } from 'lucide-react'
import { theme } from '../../styles/theme'
import { renderArticleHtml, stripMalformedHighlights } from './articleFormat'

// The highlight palette, as literal hex. See the toolbar for why these are
// not theme tokens.
const HIGHLIGHT_COLORS = [
  { hex: '#fde68a', label: 'yellow' },
  { hex: '#a7f3d0', label: 'green' },
  { hex: '#bfdbfe', label: 'blue' },
  { hex: '#fbcfe8', label: 'pink' },
  { hex: '#fecaca', label: 'red' },
  { hex: '#ddd6fe', label: 'purple' },
]

// ─────────────────────────────────────────────
//  Drawing Canvas Block
// ─────────────────────────────────────────────
function DrawingBlock({ block, onChange, onDelete, readOnly }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [tool, setTool] = useState('pen')
  const [penColor, setPenColor] = useState('#0f172a')
  const [penSize, setPenSize] = useState(3)
  const [isDrawing, setIsDrawing] = useState(false)
  const [history, setHistory] = useState([block.strokes || []])
  const [historyIdx, setHistoryIdx] = useState(0)
  const [labels, setLabels] = useState(block.labels || [])
  const [draggingLabel, setDraggingLabel] = useState(null)
  const [editingLabel, setEditingLabel] = useState(null)
  const [addingText, setAddingText] = useState(false)
  const [newLabelText, setNewLabelText] = useState('')
  const lastPoint = useRef(null)
  const currentStroke = useRef([])
  const dragOffset = useRef({ x: 0, y: 0 })

  const uid = () => Math.random().toString(36).slice(2)

  const redraw = useCallback((strokes) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    strokes.forEach(stroke => {
      if (!stroke.points || stroke.points.length < 2) return
      ctx.beginPath()
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over'
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      }
      ctx.stroke()
    })
    ctx.globalCompositeOperation = 'source-over'
  }, [])

  useEffect(() => { redraw(block.strokes || []) }, [block.strokes, redraw])
  useEffect(() => { setLabels(block.labels || []) }, [block.labels])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = 220 * dpr
      canvas.style.width = rect.width + 'px'
      canvas.style.height = '220px'
      const cctx = canvas.getContext('2d')
      if (cctx) cctx.scale(dpr, dpr)
      redraw(block.strokes || [])
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  function getPoint(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  function startDraw(e) {
    if (readOnly || tool === 'text') return
    e.preventDefault(); e.stopPropagation()
    setIsDrawing(true)
    const pt = getPoint(e)
    lastPoint.current = pt
    currentStroke.current = [pt]
    const ctx = canvasRef.current && canvasRef.current.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, (tool === 'eraser' ? penSize * 3 : penSize) / 2, 0, Math.PI * 2)
    ctx.fillStyle = penColor
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }

  function draw(e) {
    if (!isDrawing || readOnly) return
    e.preventDefault(); e.stopPropagation()
    const pt = getPoint(e)
    const ctx = canvasRef.current && canvasRef.current.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.strokeStyle = penColor
    ctx.lineWidth = tool === 'eraser' ? penSize * 4 : penSize
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
    lastPoint.current = pt
    currentStroke.current.push(pt)
  }

  function endDraw(e) {
    if (!isDrawing || readOnly) return
    e.preventDefault(); e.stopPropagation()
    setIsDrawing(false)
    if (currentStroke.current.length < 2) return
    const newStroke = { points: currentStroke.current, color: penColor, size: tool === 'eraser' ? penSize * 4 : penSize, eraser: tool === 'eraser' }
    const newStrokes = [...(block.strokes || []), newStroke]
    const newHistory = [...history.slice(0, historyIdx + 1), newStrokes]
    setHistory(newHistory); setHistoryIdx(newHistory.length - 1)
    onChange({ ...block, strokes: newStrokes, labels })
    currentStroke.current = []
  }

  function undo() {
    if (historyIdx <= 0) return
    const newIdx = historyIdx - 1; setHistoryIdx(newIdx)
    const strokes = history[newIdx]; redraw(strokes)
    onChange({ ...block, strokes, labels })
  }

  function redo() {
    if (historyIdx >= history.length - 1) return
    const newIdx = historyIdx + 1; setHistoryIdx(newIdx)
    const strokes = history[newIdx]; redraw(strokes)
    onChange({ ...block, strokes, labels })
  }

  function clearCanvas() {
    const newStrokes = []
    const newHistory = [...history.slice(0, historyIdx + 1), newStrokes]
    setHistory(newHistory); setHistoryIdx(newHistory.length - 1)
    onChange({ ...block, strokes: newStrokes, labels })
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  function addLabel() {
    if (!newLabelText.trim()) return
    const newLabel = { id: uid(), text: newLabelText.trim(), x: 40, y: 40, color: penColor, size: 13 }
    const newLabels = [...labels, newLabel]
    setLabels(newLabels)
    onChange({ ...block, strokes: block.strokes || [], labels: newLabels })
    setNewLabelText(''); setAddingText(false)
  }

  function updateLabel(id, updates) {
    const newLabels = labels.map(l => l.id === id ? { ...l, ...updates } : l)
    setLabels(newLabels)
    onChange({ ...block, strokes: block.strokes || [], labels: newLabels })
  }

  function deleteLabel(id) {
    const newLabels = labels.filter(l => l.id !== id)
    setLabels(newLabels)
    onChange({ ...block, strokes: block.strokes || [], labels: newLabels })
  }

  // Label drag handlers
  function startLabelDrag(e, label) {
    if (readOnly) return
    e.stopPropagation(); e.preventDefault()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const rect = containerRef.current.getBoundingClientRect()
    dragOffset.current = { x: clientX - rect.left - label.x, y: clientY - rect.top - label.y }
    setDraggingLabel(label.id)
  }

  function dragLabel(e) {
    if (!draggingLabel) return
    e.stopPropagation(); e.preventDefault()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width - 80, clientX - rect.left - dragOffset.current.x))
    const y = Math.max(0, Math.min(220 - 30, clientY - rect.top - dragOffset.current.y))
    updateLabel(draggingLabel, { x, y })
  }

  function endLabelDrag(e) {
    e.stopPropagation()
    setDraggingLabel(null)
  }

  const COLORS = ['#0B4A3E', '#0E6F5A', '#dc2626', '#2563eb', '#7c3aed', '#d97706', '#ffffff']
  const SIZES = [2, 4, 7, 12]

  return (
    <div style={{ border: `2px solid ${theme.tealBright}`, borderRadius: 16, overflow: 'hidden', marginBottom: 8, background: '#fff' }}>
      {!readOnly && (
        <div style={{ background: '#f8fafc', borderBottom: `1px solid ${theme.border}`, padding: '8px 10px' }}>
          {/* Tool row */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <button onClick={() => setTool('pen')} style={{ padding: '4px 9px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, background: tool === 'pen' ? theme.tealDeep : theme.bg, color: tool === 'pen' ? '#fff' : theme.textMid }}>✏️ Pen</button>
            <button onClick={() => setTool('eraser')} style={{ padding: '4px 9px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, background: tool === 'eraser' ? theme.dangerBg : theme.bg, color: tool === 'eraser' ? theme.alert : theme.textMid }}>⬜ Erase</button>
            <button onClick={() => { setTool('text'); setAddingText(true) }} style={{ padding: '4px 9px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, background: tool === 'text' ? theme.amberBg : theme.bg, color: tool === 'text' ? theme.amberText : theme.textMid }}>🏷️ Label</button>
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {SIZES.map(s => <button key={s} onClick={() => setPenSize(s)} style={{ width: s + 12, height: s + 12, borderRadius: '50%', background: penSize === s ? theme.tealDeep : '#e2e8f0', border: 'none' }} />)}
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              {COLORS.map(c => <button key={c} onClick={() => { setPenColor(c); if (tool === 'text') {} }} style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: penColor === c ? '2px solid #0f172a' : '1px solid #ccc' }} />)}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
              <button onClick={undo} disabled={historyIdx <= 0} style={{ padding: '3px 7px', borderRadius: 7, border: `1px solid ${theme.border}`, background: theme.bg, fontSize: 12, opacity: historyIdx <= 0 ? 0.4 : 1 }}>↩</button>
              <button onClick={redo} disabled={historyIdx >= history.length - 1} style={{ padding: '3px 7px', borderRadius: 7, border: `1px solid ${theme.border}`, background: theme.bg, fontSize: 12, opacity: historyIdx >= history.length - 1 ? 0.4 : 1 }}>↪</button>
              <button onClick={clearCanvas} style={{ padding: '3px 7px', borderRadius: 7, border: `1px solid ${theme.border}`, background: theme.bg, fontSize: 11, color: theme.textLight }}>Clear</button>
              <button onClick={onDelete} style={{ padding: '3px 7px', borderRadius: 7, border: 'none', background: theme.dangerBg, fontSize: 12, color: theme.alert }}>🗑️</button>
            </div>
          </div>
          {/* Add label input */}
          {addingText && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                autoFocus
                value={newLabelText}
                onChange={e => setNewLabelText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } if (e.key === 'Escape') { setAddingText(false); setTool('pen') } }}
                placeholder="Type label text, press Enter..."
                style={{ flex: 1, padding: '5px 8px', fontSize: 12, border: `1px solid ${theme.tealDeep}`, borderRadius: 8 }}
              />
              <button onClick={addLabel} style={{ padding: '5px 10px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>Add</button>
              <button onClick={() => { setAddingText(false); setTool('pen') }} style={{ padding: '5px 8px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12 }}>✕</button>
            </div>
          )}
        </div>
      )}

      {/* Canvas + Labels container */}
      <div
        ref={containerRef}
        style={{ position: 'relative', background: '#fafafa', backgroundImage: 'linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)', backgroundSize: '100% 22px', cursor: tool === 'eraser' ? 'cell' : tool === 'text' ? 'default' : 'crosshair', userSelect: 'none' }}
        onMouseMove={draggingLabel ? dragLabel : draw}
        onMouseUp={draggingLabel ? endLabelDrag : endDraw}
        onMouseLeave={draggingLabel ? endLabelDrag : endDraw}
        onTouchMove={draggingLabel ? dragLabel : draw}
        onTouchEnd={draggingLabel ? endLabelDrag : endDraw}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', touchAction: 'none' }}
          onMouseDown={startDraw}
          onTouchStart={startDraw}
        />

        {/* Draggable text labels */}
        {labels.map(label => (
          <div
            key={label.id}
            style={{
              position: 'absolute',
              left: label.x, top: label.y,
              cursor: readOnly ? 'default' : 'move',
              userSelect: 'none', zIndex: 10,
            }}
            onMouseDown={e => startLabelDrag(e, label)}
            onTouchStart={e => startLabelDrag(e, label)}
          >
            {editingLabel === label.id && !readOnly ? (
              <input
                autoFocus
                value={label.text}
                onChange={e => updateLabel(label.id, { text: e.target.value })}
                onBlur={() => setEditingLabel(null)}
                onKeyDown={e => { if (e.key === 'Enter') setEditingLabel(null) }}
                style={{ fontSize: label.size || 13, fontWeight: 700, color: label.color, background: 'rgba(255,255,255,0.95)', border: `1px solid ${theme.tealDeep}`, borderRadius: 6, padding: '2px 6px', width: 120 }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ background: 'rgba(255,255,255,0.92)', border: `1.5px solid ${label.color || '#0f172a'}`, borderRadius: 6, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
                  <span style={{ fontSize: label.size || 13, fontWeight: 800, color: label.color || '#0f172a', whiteSpace: 'nowrap' }}>{label.text}</span>
                  {!readOnly && (
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button onMouseDown={e => { e.stopPropagation(); setEditingLabel(label.id) }} style={{ background: 'none', border: 'none', fontSize: 9, cursor: 'pointer', color: '#94a3b8', padding: '0 1px' }}>✏️</button>
                      <button onMouseDown={e => { e.stopPropagation(); deleteLabel(label.id) }} style={{ background: 'none', border: 'none', fontSize: 9, cursor: 'pointer', color: theme.alert, padding: '0 1px' }}>✕</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {(!block.strokes || block.strokes.length === 0) && labels.length === 0 && !readOnly && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <p style={{ color: '#cbd5e1', fontSize: 13, fontWeight: 600 }}>✏️ Draw · 🏷️ Add labels · drag labels anywhere</p>
          </div>
        )}
      </div>

      {/* Caption */}
      <div style={{ padding: '6px 10px 8px', borderTop: `1px solid ${theme.border}`, background: '#f8fafc' }}>
        <input
          type="text"
          value={block.caption || ''}
          onChange={e => onChange({ ...block, caption: e.target.value })}
          readOnly={readOnly}
          placeholder="Add a caption for this drawing..."
          style={{ width: '100%', padding: '5px 8px', fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 8, background: readOnly ? 'transparent' : '#fff', color: theme.textMid, fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────
//  Text Block
// ─────────────────────────────────────────────
function TextBlock({ block, onChange, onDelete, readOnly, textareaRef }) {
  // Issue #4: this control used to be `opacity: 0`, revealed only by
  // mouseenter, while sitting directly over the top-right corner of the
  // textarea — and it was fully clickable the whole time. A phone has no
  // hover, so a tap near the corner of a paragraph silently deleted the
  // entire block, with no confirmation and no undo. That is content
  // disappearing between writing and publishing.
  //
  // It is now a visible, labelled control placed outside the typing area, and
  // deleting a section that has text in it takes two taps — the first arms it,
  // the second removes it. (Two-step rather than a dialog: the project bans
  // native confirm(), and a section delete does not warrant a modal.)
  const hasText = !!(block.content || '').trim()
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <div style={{ position: 'relative', marginBottom: 4 }}>
      {!readOnly && (
        <button
          type="button"
          aria-label={armed ? 'Confirm delete this section' : 'Delete this section'}
          title={armed ? 'Tap again to delete' : 'Delete this section'}
          onClick={() => {
            if (hasText && !armed) { setArmed(true); return }
            onDelete()
          }}
          style={{
            position: 'absolute', top: -10, right: 4, zIndex: 2,
            height: 26, minWidth: 26, padding: armed ? '0 9px' : 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            background: armed ? theme.dangerBg : '#fff',
            border: `1px solid ${armed ? theme.alert : theme.border}`,
            borderRadius: 13, fontSize: 10.5, fontWeight: 800, fontFamily: 'inherit',
            color: armed ? theme.alert : theme.gray400, cursor: 'pointer',
          }}
        >
          <Trash2 size={13} aria-hidden="true" />
          {armed && 'Tap again'}
        </button>
      )}
      <textarea
        ref={textareaRef}
        value={block.content}
        onChange={e => onChange({ ...block, content: e.target.value })}
        readOnly={readOnly}
        placeholder="Write here..."
        rows={4}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 15, lineHeight: 1.7,
          border: readOnly ? 'none' : `1px solid ${theme.border}`,
          borderRadius: 12, fontFamily: 'Georgia, serif', resize: 'vertical',
          background: readOnly ? 'transparent' : '#fff', outline: 'none',
          boxSizing: 'border-box', color: theme.textDark,
        }}
      />
      {/* Issue #8 — live WYSIWYG preview. Formatting used to be invisible while
          writing: the author saw literal ** and ==#hex| markers and only
          discovered how the article looked after publishing. This pane runs the
          exact renderer the published article uses (renderArticleHtml), so what
          it shows IS what will publish — actual bold, actual italic, actual
          colour — updating on every keystroke. It reads the same block content,
          so there is no second source of truth and no format change. */}
      {!readOnly && hasText && (
        <div
          data-testid="article-preview"
          style={{
            marginTop: 6, border: `1px dashed ${theme.border}`, borderRadius: 12,
            padding: '10px 12px', background: '#fff',
          }}
        >
          <p style={{
            margin: '0 0 6px 0', fontSize: 10.5, fontWeight: 800,
            color: theme.textLight, letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            Preview — exactly as it will publish
          </p>
          <div
            className="article-preview-body"
            dangerouslySetInnerHTML={{ __html: renderArticleHtml(block.content) }}
            style={{ fontFamily: 'Georgia, serif', fontSize: 15, lineHeight: 1.75, color: theme.textDark }}
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
//  Main Article Editor
// ─────────────────────────────────────────────
export default function ArticleEditor({ value, onChange, readOnly = false }) {
  const uid = () => Math.random().toString(36).slice(2)

  // Guard a raw block so renderArticleHtml never receives a non-string, and
  // repair the malformed `==color|` markers the old colour button wrote into
  // already-published articles (issue #3). Repairing here — the one place
  // every block passes through, in both edit and read modes — means a
  // corrupted article renders clean immediately AND is written back clean the
  // first time its author edits or reposts it, which is what "can no longer
  // be successfully edited and reposted" was describing.
  const normalizeBlock = (b) => {
    if (!b || typeof b !== 'object') {
      return { id: uid(), type: 'text', content: stripMalformedHighlights(b) }
    }
    return {
      ...b,
      id: b.id || uid(),
      type: b.type === 'drawing' ? 'drawing' : 'text',
      content: stripMalformedHighlights(b.content),
    }
  }

  // Parse blocks from a string value, an already-parsed array, or plain text.
  const parseBlocks = (val) => {
    if (!val) return [{ id: uid(), type: 'text', content: '' }]
    let parsed = val
    if (typeof val === 'string') {
      try {
        parsed = JSON.parse(val)
      } catch {}
    }
    if (Array.isArray(parsed)) return parsed.map(normalizeBlock)
    // Legacy plain text (or a stringified object) — wrap in a single text block
    return [normalizeBlock({ type: 'text', content: typeof val === 'string' ? val : String(val) })]
  }

  const [blocks, setBlocks] = useState(() => parseBlocks(value))
  const [highlightColor, setHighlightColor] = useState('#fde68a')
  const [activeBlockId, setActiveBlockId] = useState(blocks[0]?.id)
  const lastTextareaRef = useRef(null)

  // Sync blocks → parent onChange as JSON string
  useEffect(() => {
    if (!readOnly && onChange) onChange(JSON.stringify(blocks))
  }, [blocks])

  // Update a single block
  function updateBlock(id, updated) {
    setBlocks(prev => prev.map(b => b.id === id ? updated : b))
  }

  // Delete a block (keep at least one text block)
  function deleteBlock(id) {
    setBlocks(prev => {
      const next = prev.filter(b => b.id !== id)
      return next.length ? next : [{ id: uid(), type: 'text', content: '' }]
    })
  }

  // Insert drawing block after active block
  function insertDrawing() {
    const newBlock = { id: uid(), type: 'drawing', strokes: [] }
    const textBlock = { id: uid(), type: 'text', content: '' }
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === activeBlockId)
      const insertAt = idx >= 0 ? idx + 1 : prev.length
      const next = [...prev]
      next.splice(insertAt, 0, newBlock, textBlock)
      return next
    })
    setActiveBlockId(textBlock.id)
  }

  // Apply a formatting mark to the selection in the active text block.
  //
  // `before` and `after` are separate because not every mark is symmetric:
  // bold and italic are (`**`…`**`), but a highlight carries its colour in
  // the OPENER only (`==#fde68a|`…`==`). The colour buttons used to call this
  // with a single marker, which wrapped the selection as
  // `==color|text==color|` — literal characters in the body instead of
  // colour, and an article that no longer round-tripped through the editor
  // (issue #3). See articleFormat.js for the markup contract.
  function wrapActive(before, after = before) {
    setBlocks(prev => prev.map(b => {
      if (b.id !== activeBlockId || b.type !== 'text') return b
      const ta = lastTextareaRef.current
      if (!ta) return b
      const s = ta.selectionStart; const e = ta.selectionEnd
      const sel = b.content.slice(s, e)
      const wrapped = `${before}${sel}${after}`
      const next = b.content.slice(0, s) + wrapped + b.content.slice(e)
      // Empty selection: park the caret between the markers so the next
      // keystroke lands inside them. Non-empty: select the wrapped run so a
      // second mark can be applied on top without re-selecting by hand.
      setTimeout(() => {
        if (sel) {
          ta.selectionStart = s + before.length
          ta.selectionEnd = s + before.length + sel.length
        } else {
          ta.selectionStart = ta.selectionEnd = s + before.length
        }
        ta.focus()
      }, 0)
      return { ...b, content: next }
    }))
  }

  // Render for read mode
  if (readOnly) {
    return (
      <div style={{ fontFamily: 'Georgia, serif' }}>
        {blocks.map(b => b.type === 'drawing'
          ? <DrawingBlock key={b.id} block={b} onChange={() => {}} onDelete={() => {}} readOnly />
          : <div key={b.id} className="article-body" dangerouslySetInnerHTML={{ __html: renderArticleHtml(b.content) }} style={{ fontSize: 15, lineHeight: 1.75, color: theme.textDark, marginBottom: 12 }} />
        )}
      </div>
    )
  }

  const activeBlock = blocks.find(b => b.id === activeBlockId)

  return (
    <div>
      {/* Preview typography mirrors the published article's classes
          (.article-body strong/mark) so the pane is a faithful stand-in. */}
      <style>{`
        .article-preview-body p { margin: 0 0 12px 0; }
        .article-preview-body p:last-child { margin-bottom: 0; }
        .article-preview-body strong { font-weight: 800; color: ${theme.navy}; }
        .article-preview-body mark { padding: 1px 4px; border-radius: 4px; }
      `}</style>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => wrapActive('**')} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg, fontWeight: 900, fontSize: 13 }}>B</button>
        <button type="button" onClick={() => wrapActive('*')} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg, fontStyle: 'italic', fontSize: 13 }}>I</button>
        {/* Highlight colours are literal hex, not theme tokens: they are
            persisted into the article markup (==#RRGGBB|…==) and must stay
            stable for already-published articles even if the palette moves.
            The old list included theme.dangerBorder, which does not exist on
            the theme — it evaluated to undefined and rendered a colourless
            swatch. */}
        <div role="group" aria-label="Highlight colour" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {HIGHLIGHT_COLORS.map(({ hex, label }) => (
            <button
              type="button"
              key={hex}
              aria-label={`Highlight in ${label}`}
              aria-pressed={highlightColor === hex}
              onClick={() => { setHighlightColor(hex); wrapActive(`==${hex}|`, '==') }}
              style={{ width: 18, height: 18, borderRadius: '50%', background: hex, border: highlightColor === hex ? '2px solid #333' : '1px solid #ccc', cursor: 'pointer', padding: 0 }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={insertDrawing}
          style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: `1px solid ${theme.tealDeep}`, background: theme.tealMist, color: theme.tealDeep, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}
        >
          ✏️ + Drawing
        </button>
      </div>

      {/* Block list */}
      <div>
        {blocks.map((block, idx) => (
          <div key={block.id} onClick={() => setActiveBlockId(block.id)}
            style={{ outline: activeBlockId === block.id && block.type === 'text' ? `2px solid ${theme.tealBright}` : 'none', borderRadius: 12, transition: 'outline 0.1s' }}>
            {block.type === 'text' ? (
              <TextBlock
                block={block}
                onChange={updated => updateBlock(block.id, updated)}
                onDelete={() => deleteBlock(block.id)}
                readOnly={false}
                textareaRef={activeBlockId === block.id ? lastTextareaRef : null}
              />
            ) : (
              <DrawingBlock
                block={block}
                onChange={updated => updateBlock(block.id, updated)}
                onDelete={() => deleteBlock(block.id)}
                readOnly={false}
              />
            )}
            {/* Insert divider between blocks */}
            {idx < blocks.length - 1 && (
              <div style={{ display: 'flex', alignItems: 'center', margin: '2px 0', opacity: 0.3 }}>
                <div style={{ flex: 1, height: 1, background: theme.border }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: theme.textLight, marginTop: 6 }}>
        Tap <strong>✏️ + Drawing</strong> to insert a sketch anywhere in your article
      </p>
    </div>
  )
}
