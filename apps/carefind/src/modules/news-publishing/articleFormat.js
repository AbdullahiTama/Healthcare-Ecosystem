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
      safe = safe.replace(/==(#[0-9a-fA-F]{3,8})\|(.+?)==/g, '<mark style="background:$1;color:#1f2937;padding:1px 4px;border-radius:4px;">$2</mark>')
      safe = safe.replace(/==(.+?)==/g, '<mark>$1</mark>')
      safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>')
      safe = safe.replace(/\n/g, '<br/>')
      return `<p>${safe}</p>`
    })
    .join('')
}
