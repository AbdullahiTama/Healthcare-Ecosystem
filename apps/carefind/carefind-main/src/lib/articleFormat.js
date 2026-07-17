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

export function renderArticleHtml(content) {
  const paragraphs = content.split(/\n\s*\n/)
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
