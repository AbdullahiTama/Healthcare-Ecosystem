// Sharing, with the fallback every desktop browser needs.
//
// `navigator.share` exists on phones and on very few desktop browsers. A
// share button wired straight to it is a button that silently does nothing
// for a large share of users, so this falls back to the clipboard and tells
// the caller which path was taken — the caller is expected to confirm
// "copied" to the user, since a clipboard write has no visible effect.
//
// Media posts (visual/image/video) can pass `files` — real File objects —
// which are handed to the Web Share API on capable browsers so WhatsApp and
// friends receive the actual image/video. Where the Web Share API is missing
// or rejects the files, the caller-supplied `mediaUrl` is appended to the
// clipboard text so the recipient still gets the media as a link.
//
// Returns: 'shared' | 'copied' | 'dismissed' | 'failed'
//
// Fetch a media URL into a File object for the Web Share API. The filename is
// derived from the URL so the recipient sees a sensible name. Returns null on
// any failure (CORS, missing response) so a media attach is always best-effort
// and never blocks the text share.
export async function mediaToFile(url) {
  if (!url) return null
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    const clean = String(url).split(/[?#]/)[0]
    const name = clean.split('/').pop() || 'carefind-media'
    const type = blob.type || (name.match(/\.(png|jpe?g|gif|webp)$/i) ? 'image/' + name.split('.').pop().toLowerCase() : 'application/octet-stream')
    return new File([blob], name, { type })
  } catch {
    return null
  }
}
export async function shareOrCopy({ title, text, url, files, mediaUrl }) {
  const target = url || window.location.href

  if (navigator.share) {
    const payload = { title, text, url: target }
    const hasFiles = Array.isArray(files) && files.length > 0
    // Web Share with files needs an explicit canShare guard — some browsers
    // expose share() but throw on a files payload. When files can't be shared
    // we skip the share entirely so the media link lands on the clipboard
    // instead of being silently dropped.
    const filesShareable = !hasFiles
      || (typeof navigator.canShare === 'function' && navigator.canShare({ files }))
    if (filesShareable) {
      if (hasFiles) payload.files = files
      try {
        await navigator.share(payload)
        return 'shared'
      } catch (e) {
        // The user closing the share sheet is not a failure to report.
        if (e?.name === 'AbortError') return 'dismissed'
      }
    }
  }

  try {
    const mediaLine = mediaUrl ? `\n\n${mediaUrl}` : ''
    await navigator.clipboard.writeText(text ? `${text}\n\n${target}${mediaLine}` : `${target}${mediaLine}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}
