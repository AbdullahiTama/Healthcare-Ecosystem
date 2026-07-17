import { useRef } from 'react'
import { theme } from './lib/theme'

// Marker format stored in text:
//   {h:yellow}highlighted text{/h}  -> highlighter background
//   {c:red}colored text{/c}         -> colored letters
// Reliable on mobile: user selects text in the textarea, taps a color, we wrap it.

const HIGHLIGHTS = { yellow: '#fef08a', green: '#bbf7d0', pink: '#fbcfe8', blue: '#bfdbfe' }
const TEXTCOLORS = { red: '#dc2626', blue: '#2563eb', green: '#16a34a' }

// A textarea with a formatting toolbar.
export function RichTextInput({ value, onChange, placeholder, rows = 4 }) {
  const ref = useRef(null)

  function wrap(open, close) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start === end) return // nothing selected
    const selected = value.slice(start, end)
    const next = value.slice(0, start) + open + selected + close + value.slice(end)
    onChange(next)
  }

  const btn = { padding: '5px 8px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer' }

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('{b}', '{/b}')} style={{ ...btn, background: theme.bg, color: theme.navy, border: `1px solid ${theme.border}`, fontWeight: 900 }}>B</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('{i}', '{/i}')} style={{ ...btn, background: theme.bg, color: theme.navy, border: `1px solid ${theme.border}`, fontStyle: 'italic' }}>I</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('{s}', '{/s}')} style={{ ...btn, background: theme.bg, color: theme.navy, border: `1px solid ${theme.border}`, textDecoration: 'line-through' }}>S</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('{u}', '{/u}')} style={{ ...btn, background: theme.bg, color: theme.navy, border: `1px solid ${theme.border}`, textDecoration: 'underline' }}>U</button>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: theme.textLight, alignSelf: 'center' }}>Highlight:</span>
        {Object.entries(HIGHLIGHTS).map(([name, col]) => (
          <button key={name} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap(`{h:${name}}`, '{/h}')} style={{ ...btn, background: col, color: '#333' }}>A</button>
        ))}
        <span style={{ fontSize: 10, fontWeight: 800, color: theme.textLight, alignSelf: 'center', marginLeft: 6 }}>Color:</span>
        {Object.entries(TEXTCOLORS).map(([name, col]) => (
          <button key={name} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap(`{c:${name}}`, '{/c}')} style={{ ...btn, background: theme.bg, color: col, border: `1px solid ${theme.border}` }}>A</button>
        ))}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        style={{ width: '100%', padding: '12px 14px', fontSize: 15, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'none' }}
      />
      <p style={{ margin: '4px 0 0 0', fontSize: 10, color: theme.textLight }}>Tip: select text, then tap a color to highlight it.</p>
    </div>
  )
}

// Renders marker text as styled React nodes.
export function renderRichText(text) {
  if (!text) return null
  const parts = []
  let remaining = text
  // Match any of our markers: {h:color}..{/h} {c:color}..{/c} {b}..{/b} {i}..{/i} {s}..{/s} {u}..{/u}
  const regex = /\{(h|c):(\w+)\}([\s\S]*?)\{\/\1\}|\{(b|i|s|u)\}([\s\S]*?)\{\/\4\}/
  let key = 0
  let guard = 0
  while (remaining.length && guard < 500) {
    guard++
    const m = remaining.match(regex)
    if (!m) { parts.push(remaining); break }
    const before = remaining.slice(0, m.index)
    if (before) parts.push(before)
    if (m[1]) {
      // highlight or color
      const type = m[1], colorName = m[2], inner = m[3]
      if (type === 'h') {
        parts.push(<mark key={key++} style={{ background: HIGHLIGHTS[colorName] || '#fef08a', color: '#1a1a1a', padding: '0 2px', borderRadius: 3 }}>{renderRichText(inner)}</mark>)
      } else {
        parts.push(<span key={key++} style={{ color: TEXTCOLORS[colorName] || '#dc2626', fontWeight: 600 }}>{renderRichText(inner)}</span>)
      }
      remaining = remaining.slice(m.index + m[0].length)
    } else {
      // b / i / s / u
      const style = m[4], inner = m[5]
      const styleMap = {
        b: { fontWeight: 800 }, i: { fontStyle: 'italic' },
        s: { textDecoration: 'line-through' }, u: { textDecoration: 'underline' },
      }
      parts.push(<span key={key++} style={styleMap[style]}>{renderRichText(inner)}</span>)
      remaining = remaining.slice(m.index + m[0].length)
    }
  }
  return parts
}

// Strip all markers, returning clean plain text (for previews).
export function stripMarkers(text) {
  if (!text) return ''
  return text
    .replace(/\{(h|c):\w+\}/g, '')
    .replace(/\{\/(h|c)\}/g, '')
    .replace(/\{[bisu]\}/g, '')
    .replace(/\{\/[bisu]\}/g, '')
}

// Article posts are stored as JSON blocks (text, drawing, voice, image...).
// This pulls out just the readable words for previews, so we never dump raw JSON.
export function previewText(content) {
  if (!content) return ''
  const raw = String(content)

  // Only attempt a parse if it actually looks like a block array
  if (raw.trim().startsWith('[')) {
    try {
      const blocks = JSON.parse(raw)
      if (Array.isArray(blocks)) {
        const words = blocks
          .filter((b) => b && typeof b === 'object')
          .map((b) => {
            if (b.type === 'text' || b.type === 'heading' || b.type === 'quote') return b.content || ''
            if (b.type === 'drawing') return '✏️ drawing'
            if (b.type === 'image') return '🖼 image'
            if (b.type === 'voice') return '🎙 voice note'
            return ''
          })
          .filter(Boolean)
          .join(' ')
        return stripMarkers(words)
      }
    } catch (e) {
      // not valid JSON — fall through and treat it as plain text
    }
  }

  return stripMarkers(raw)
}
