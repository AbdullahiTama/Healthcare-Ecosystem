// Lightweight formatting helpers for Article posts.
// Supports **bold**, *italic*, and ==color|highlight== markup via toolbar buttons.

export function wrapSelection(textareaRef, text, setText, before, after) {
  const el = textareaRef.current
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  const selected = text.slice(start, end)
  const pre = text.slice(0, start)
  const post = text.slice(end)

  const inner = selected || 'text'
  const wrapped = `${before}${inner}${after}`
  setText(pre + wrapped + post)
}

export function wrapBold(textareaRef, text, setText) {
  wrapSelection(textareaRef, text, setText, '**', '**')
}

export function wrapItalic(textareaRef, text, setText) {
  wrapSelection(textareaRef, text, setText, '*', '*')
}

export function wrapHighlight(textareaRef, text, setText, colorHex) {
  wrapSelection(textareaRef, text, setText, `==${colorHex}|`, '==')
}

// Legacy bracket-marker vocabulary, shared with renderMarkdown (text posts,
// comments, feed) and renderRichText so the same highlight/colour markup
// renders identically everywhere. Articles used to only understand the `==`
// dialect; this keeps content portable between post types.
const HIGHLIGHTS = { yellow: '#fef08a', green: '#bbf7d0', pink: '#fbcfe8', blue: '#bfdbfe' }
const TEXTCOLORS = { red: '#dc2626', blue: '#2563eb', green: '#16a34a' }

const HEADING_SIZES = [22, 19, 17, 15.5, 14.5, 13.5]

// ── Highlight markup contract ────────────────────────────────────────────
// Canonical:  ==#RRGGBB|highlighted text==   (opener carries the colour)
// Also valid: ==highlighted text==           (default <mark>, no colour)
//
// The article editor's colour buttons used to wrap the selection with the
// LITERAL string "==color|" on *both* sides, so applying colour produced
// `==color|your text==color|` — visible garbage in the body instead of
// coloured text, and content that no longer round-trips through the editor.
// Real examples are in production (posts.content, e.g. the 2026-08-21 wound
// article). These two helpers are the repair: MALFORMED_HIGHLIGHT recognises
// the shape, stripMalformedHighlights removes it non-destructively (the
// wrapped words are kept, only the marker characters go), and
// findMalformedHighlights is the save-time validation gate.
//
// The pattern is deliberately narrow — an opener `==` followed by a bare
// identifier and a `|` that is NOT a valid hex colour. `==#fde68a|` and a
// plain `==highlight==` are both left alone.
const MALFORMED_HIGHLIGHT = /==(?!#[0-9a-fA-F]{3,8}\|)([A-Za-z_][A-Za-z0-9_-]*)\|/g

// Every malformed marker found, as { token, index }. Empty array means clean.
export function findMalformedHighlights(content) {
  if (content == null) return []
  const text = typeof content === 'string' ? content : String(content)
  const found = []
  for (const match of text.matchAll(MALFORMED_HIGHLIGHT)) {
    found.push({ token: match[0], index: match.index })
  }
  return found
}

// Remove malformed colour markers, keeping the text they wrapped. Used both
// when loading an already-corrupted article for editing (so it can be edited
// and reposted again) and before persisting, so a stray token can never be
// written back.
export function stripMalformedHighlights(content) {
  if (content == null) return ''
  const text = typeof content === 'string' ? content : String(content)
  return text.replace(MALFORMED_HIGHLIGHT, '')
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function rgbToHex(r, g, b) {
  const toHex = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function parseStyleMap(style) {
  const map = {}
  if (!style) return map
  style.split(';').forEach((part) => {
    const [rawProp, ...rest] = part.split(':')
    if (!rawProp || rest.length === 0) return
    const prop = rawProp.trim().toLowerCase()
    const val = rest.join(':').trim()
    if (prop) map[prop] = val
  })
  return map
}

function extractHexFromValue(val) {
  if (!val) return null
  const hexMatch = val.match(/#[0-9a-fA-F]{3,8}/)
  if (hexMatch) return hexMatch[0]
  const rgbMatch = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgbMatch) return rgbToHex(rgbMatch[1], rgbMatch[2], rgbMatch[3])
  return null
}

function applyInlineFormatting(safe) {
  // Legacy bracket markers (kept for parity with renderMarkdown so the
  // same body renders the same way as a text post). Applied before the
  // `==`/`**` rules so their inner text can still pick up other styling.
  safe = safe.replace(/\{h:(\w+)\}([\s\S]*?)\{\/h\}/g, (_, c, t) => `<mark style="background:${HIGHLIGHTS[c] || '#fef08a'};color:#1a1a1a;padding:0 2px;border-radius:3px;">${t}</mark>`)
  safe = safe.replace(/\{c:(\w+)\}([\s\S]*?)\{\/c\}/g, (_, c, t) => `<span style="color:${TEXTCOLORS[c] || '#dc2626'};font-weight:600;">${t}</span>`)
  safe = safe.replace(/\{b\}([\s\S]*?)\{\/b\}/g, '<strong>$1</strong>')
  safe = safe.replace(/\{i\}([\s\S]*?)\{\/i\}/g, '<em>$1</em>')
  safe = safe.replace(/\{s\}([\s\S]*?)\{\/s\}/g, '<span style="text-decoration:line-through;">$1</span>')
  safe = safe.replace(/\{u\}([\s\S]*?)\{\/u\}/g, '<span style="text-decoration:underline;">$1</span>')
  safe = safe.replace(/==(#[0-9a-fA-F]{3,8})\|(.+?)==/g, '<mark style="background:$1;color:#1f2937;padding:1px 4px;border-radius:4px;">$2</mark>')
  safe = safe.replace(/==(.+?)==/g, '<mark>$1</mark>')
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>')
  return safe
}

// Render article markup to safe HTML. Content may come from a variety of
// legacy shapes (plain text, JSON block strings, or — in the worst case —
// null/object block content), so it is coerced to a string defensively.
// Never throws: a malformed block renders as an empty paragraph, it must not
// blank the page.
export function renderArticleHtml(content) {
  if (content == null) return '<p></p>'
  const text = typeof content === 'string' ? content : String(content)
  if (!text.trim()) return '<p></p>'
  const lines = text.split(/\r?\n/)
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '') {
      i++
      continue
    }
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      let inner = escapeHtml(h[2])
      inner = applyInlineFormatting(inner)
      const size = HEADING_SIZES[level - 1]
      out.push(`<h${level} style="font-size:${size}px;font-weight:800;color:#0f172a;margin:6px 0 4px;">${inner}</h${level}>`)
      i++
      continue
    }
    // Collect paragraph lines (consecutive non-blank, non-heading lines)
    const paraLines = []
    while (i < lines.length) {
      const t = lines[i].trim()
      if (t === '') break
      if (/^(#{1,6})\s+/.test(t)) break
      paraLines.push(lines[i])
      i++
    }
    const paraText = paraLines.join('\n')
    let safe = escapeHtml(paraText.trim())
    safe = applyInlineFormatting(safe)
    safe = safe.replace(/\n/g, '<br/>')
    out.push(`<p>${safe}</p>`)
  }
  return out.join('')
}

// ── HTML → article markers (inverse of renderArticleHtml) ──────────────────
// Converts DOM HTML produced by contentEditable back to the marker dialect
// stored in the database. Restricted to the tags renderArticleHtml emits:
// <p>, <br>, <strong>, <em>, <mark>. Everything else is flattened to text.
export function htmlToArticleMarkers(html) {
  if (html == null) return ''
  const text = typeof html === 'string' ? html : String(html)
  if (!text.trim()) return ''

  const container = document.createElement('div')
  container.innerHTML = text

  function processInline(node) {
    if (node.nodeType === 3) return node.textContent
    if (node.nodeType !== 1) return ''

    const tag = node.tagName
    const inner = Array.from(node.childNodes).map(processInline).join('')

    if (tag === 'STRONG' || tag === 'B') return inner.startsWith('**') && inner.endsWith('**') ? inner : `**${inner.replace(/^\*+|\*+$/g, '')}**`
    if (tag === 'EM' || tag === 'I') return inner.startsWith('*') && inner.endsWith('*') && !inner.startsWith('**') ? inner : `*${inner.replace(/^\*+|\*+$/g, '')}*`
    if (tag === 'U') return `{u}${inner}{/u}`
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') return `{s}${inner}{/s}`
    if (tag === 'MARK' || tag === 'SPAN') {
      const style = node.getAttribute('style') || ''
      const styleMap = parseStyleMap(style)
      // Background highlight (canonical ==#hex|...== or legacy {h:})
      const bgVal = styleMap['background'] || styleMap['background-color']
      if (bgVal) {
        const bgHex = extractHexFromValue(bgVal)
        if (bgHex) {
          // Distinguish legacy bracket highlight by its distinctive padding
          const isBracket = style.includes('padding:0 2px') || style.includes('padding: 0 2px')
          if (isBracket) {
            const hlEntry = Object.entries(HIGHLIGHTS).find(([, v]) => v.toLowerCase() === bgHex.toLowerCase())
            if (hlEntry) return `{h:${hlEntry[0]}}${inner}{/h}`
          }
          return `==${bgHex}|${inner}==`
        }
      }
      // <mark> without background style -> plain highlight
      if (tag === 'MARK') return `==${inner}==`
      // Text colour
      const colorVal = styleMap['color']
      if (colorVal) {
        const colorHex = extractHexFromValue(colorVal)
        if (colorHex) {
          // Only treat as text colour if there was no background (already handled)
          const tcEntry = Object.entries(TEXTCOLORS).find(([, v]) => v.toLowerCase() === colorHex.toLowerCase())
          if (tcEntry) return `{c:${tcEntry[0]}}${inner}{/c}`
          return `==${colorHex}|${inner}==`
        }
      }
      // Text decoration inside span (underline / line-through)
      const deco = styleMap['text-decoration'] || style
      if (deco && /underline/.test(deco)) return `{u}${inner}{/u}`
      if (deco && /line-through/.test(deco)) return `{s}${inner}{/s}`
      // <span> without recognised style: flatten to inner text
      return inner
    }
    if (tag === 'BR') return '\n'
    if (tag === 'A') {
      // For now flatten links to inner text; could preserve as [text](href) but article posts don't use links
      return inner
    }
    // Headings handled at block level, but if they appear inline, treat as heading marker
    if (/^H[1-6]$/.test(tag)) {
      const level = parseInt(tag[1], 10)
      return `${'#'.repeat(level)} ${inner}`
    }
    // <span> and other inline tags: flatten to inner text
    return inner
  }

  const blocks = []
  let inlineBuffer = ''
  function flushInline() {
    if (inlineBuffer && inlineBuffer.trim()) {
      blocks.push(inlineBuffer.trim())
      inlineBuffer = ''
    } else if (inlineBuffer) {
      inlineBuffer = ''
    }
  }
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === 3) {
      inlineBuffer += child.textContent
    } else if (child.nodeType === 1) {
      const tag = child.tagName
      if (/^H[1-6]$/.test(tag)) {
        flushInline()
        const level = parseInt(tag[1], 10)
        const content = Array.from(child.childNodes).map(processInline).join('')
        if (content.trim()) blocks.push(`${'#'.repeat(level)} ${content.trim()}`)
      } else if (tag === 'P' || tag === 'DIV') {
        flushInline()
        // Div may be a heading rendered as div (legacy) — detect heading style
        const style = child.getAttribute('style') || ''
        const isHeadingDiv = /font-weight:\s*800/.test(style) && /font-size:\s*\d+/.test(style) && /color:\s*#0f172a/.test(style)
        if (isHeadingDiv && child.textContent.trim()) {
          // Try to infer level from font-size
          const sizeMatch = style.match(/font-size:\s*([0-9.]+)px/)
          let level = 1
          if (sizeMatch) {
            const sz = parseFloat(sizeMatch[1])
            const idx = HEADING_SIZES.findIndex(s => Math.abs(s - sz) < 0.1)
            if (idx >= 0) level = idx + 1
          }
          const content = Array.from(child.childNodes).map(processInline).join('')
          if (content.trim()) blocks.push(`${'#'.repeat(level)} ${content.trim()}`)
        } else {
          const content = Array.from(child.childNodes).map(processInline).join('')
          if (content.trim()) blocks.push(content)
        }
      } else if (tag === 'BR') {
        inlineBuffer += '\n'
      } else {
        // Inline element at top level (MARK, SPAN, B, I, U, S, etc.)
        inlineBuffer += processInline(child)
      }
    }
  }
  flushInline()

  // Fallback for case where container has only text but flush didn't trigger (should already be handled)
  if (blocks.length === 0) {
    const directText = Array.from(container.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent)
      .join('')
    if (directText.trim()) blocks.push(directText.trim())
  }

  return blocks.join('\n\n')
}
