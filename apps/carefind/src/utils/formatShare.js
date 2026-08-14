// Turn arbitrary post/article content into clean, shareable text.
//
// Several post types store `content` as a JSON object (visual cards
// `{theme, text}`, reviews `{rating, text}`, playlists) rather than a plain
// string. Article posts store it as a JSON array of blocks (`{type, content}`,
// e.g. text/heading/quote/drawing). Sharing those raw produced "raw JSON with
// internal field names" over WhatsApp/Clipboard. This extracts the
// human-readable text, then strips markdown emphasis/headings/link syntax and
// article highlight markers so the shared text reads naturally instead of
// leaking `**`/`*`/`#`/`==` markers.

// Pulls readable words out of an article-style block array (same vocabulary
// as `previewText` in richText.jsx). Never throws; a malformed block is skipped.
function blocksToText(blocks) {
  return blocks
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
}

export function toShareText(input, { maxLen = 240 } = {}) {
  if (input == null) return ''
  let text = input

  // Unwrap JSON bodies (objects/arrays) into their readable text field.
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const obj = JSON.parse(trimmed)
        if (Array.isArray(obj)) {
          text = blocksToText(obj)
        } else {
          const picked =
            obj?.text ?? obj?.caption ?? obj?.description ?? obj?.title ?? obj?.message ?? ''
          if (picked) text = picked
        }
      } catch {
        // Not JSON after all — fall through and clean the raw string.
      }
    }
  } else if (Array.isArray(input)) {
    text = blocksToText(input)
  }
  if (typeof text !== 'string') text = String(text)

  const cleaned = text
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
    .replace(/\*(.+?)\*/g, '$1') // *italic*
    .replace(/__(.+?)__/g, '$1') // __bold__
    .replace(/_(.+?)_/g, '$1') // _italic_
    .replace(/`(.+?)`/g, '$1') // `code`
    .replace(/==(#[0-9a-fA-F]{3,8})\|(.+?)==/g, '$2') // ==#hex|text== highlight
    .replace(/==(.+?)==/g, '$1') // ==text== highlight
    .replace(/^#+\s*/gm, '') // headings
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [label](url) -> label
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  if (maxLen && cleaned.length > maxLen) {
    return cleaned.slice(0, maxLen).replace(/\s+\S*$/, '') + '…'
  }
  return cleaned
}
