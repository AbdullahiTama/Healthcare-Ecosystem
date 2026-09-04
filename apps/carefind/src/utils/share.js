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
// or rejects the files, the clipboard fallback copies only the post URL —
// the OG tags on that URL already carry the image for link previews.
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
    const hasFiles = Array.isArray(files) && files.length > 0
    const filesShareable = !hasFiles
      || (typeof navigator.canShare === 'function' && navigator.canShare({ files }))
    const payload = { title, text, url: target }
    // Include files only when the browser confirms it can share them. When
    // files are present but not shareable we still share url+text so the
    // preview card deep-links to the canonical /post/:id (I/O matrix: omit
    // files but still share url).
    if (hasFiles && filesShareable) payload.files = files
    try {
      await navigator.share(payload)
      return 'shared'
    } catch (e) {
      // The user closing the share sheet is not a failure to report.
      if (e?.name === 'AbortError') return 'dismissed'
    }
  }

  try {
    // The post URL already carries og:image tags so WhatsApp/Telegram/etc.
    // render the image inside the link preview card. Appending the raw
    // mediaUrl as a second line caused two separate previews (image + link)
    // when pasted into WhatsApp — the image and text appeared split, so we
    // never append mediaUrl. URL is first so the preview appears without
    // scrolling (deep-link preview card: image/title tappable to /post/:id).
    await navigator.clipboard.writeText(text ? `${target}\n\n${text}` : `${target}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}
