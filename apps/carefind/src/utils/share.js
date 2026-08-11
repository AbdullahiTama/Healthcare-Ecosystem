// Sharing, with the fallback every desktop browser needs.
//
// `navigator.share` exists on phones and on very few desktop browsers. A
// share button wired straight to it is a button that silently does nothing
// for a large share of users, so this falls back to the clipboard and tells
// the caller which path was taken — the caller is expected to confirm
// "copied" to the user, since a clipboard write has no visible effect.
//
// Returns: 'shared' | 'copied' | 'dismissed' | 'failed'
export async function shareOrCopy({ title, text, url }) {
  const target = url || window.location.href

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: target })
      return 'shared'
    } catch (e) {
      // The user closing the share sheet is not a failure to report.
      if (e?.name === 'AbortError') return 'dismissed'
    }
  }

  try {
    await navigator.clipboard.writeText(text ? `${text}\n\n${target}` : target)
    return 'copied'
  } catch {
    return 'failed'
  }
}
