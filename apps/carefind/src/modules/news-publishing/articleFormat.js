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

// Render article markup to safe HTML. Content may come from a variety of
// legacy shapes (plain text, JSON block strings, or — in the worst case —
// null/object block content), so it is coerced to a string defensively.
// Never throws: a malformed block renders as an empty paragraph, it must not
// blank the page.
export function renderArticleHtml(content) {
  if (content == null) return '<p></p>'
  const text = typeof content === 'string' ? content : String(content)
  const paragraphs = text.split(/\n\s*\n/)
  return paragraphs
    .map((para) => {
      let safe = escapeHtml(para.trim())
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
      safe = safe.replace(/\n/g, '<br/>')
      return `<p>${safe}</p>`
    })
    .join('')
}
