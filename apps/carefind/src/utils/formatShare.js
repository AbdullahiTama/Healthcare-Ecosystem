// Turn arbitrary post/article content into clean, shareable text.
//
// Several post types store `content` as a JSON object (visual cards
// `{theme, text}`, reviews `{rating, text}`, playlists) rather than a plain
// string. Sharing those raw produced "raw JSON with internal field names"
// over WhatsApp/Clipboard. This extracts the human-readable field, then
// strips markdown emphasis/headings/link syntax so the shared text reads
// naturally instead of leaking `**`/`*`/`#` markers.

export function toShareText(input, { maxLen = 240 } = {}) {
  if (input == null) return ''
  let text = input

  // Unwrap JSON bodies (objects/arrays) into their readable text field.
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const obj = JSON.parse(trimmed)
        const picked =
          obj?.text ?? obj?.caption ?? obj?.description ?? obj?.title ?? obj?.message ?? ''
        if (picked) text = picked
      } catch {
        // Not JSON after all — fall through and clean the raw string.
      }
    }
  }
  if (typeof text !== 'string') text = String(text)

  const cleaned = text
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
    .replace(/\*(.+?)\*/g, '$1') // *italic*
    .replace(/__(.+?)__/g, '$1') // __bold__
    .replace(/_(.+?)_/g, '$1') // _italic_
    .replace(/`(.+?)`/g, '$1') // `code`
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
