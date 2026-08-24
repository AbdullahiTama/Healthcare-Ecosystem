// Pure derivations over engagement state. No React, no I/O, no Supabase.
// Every function takes the state it reads as its first argument, which is what
// makes them testable without a component and reusable by both the feed and a
// single-post page.

export function likeCount(reactions, postId) {
  return (reactions || []).filter((r) => r.post_id === postId).length
}

export function userHasLiked(reactions, postId, userId) {
  if (!userId) return false
  return (reactions || []).some((r) => r.post_id === postId && r.user_id === userId)
}

// Counts that arrive pre-aggregated as { [postId]: n }.
export function countFrom(map, postId) {
  return (map || {})[postId] || 0
}

// Prefer the thread we've actually loaded (it reflects a just-added or
// just-deleted comment); fall back to the count already fetched, so the
// number is right before the thread is ever opened. Moved verbatim from
// Feed.jsx:1488-1492 — `comments` and `commentCounts` are two different state
// slices, not one map, so this cannot be `countFrom`.
export function commentTotal(comments, commentCounts, postId) {
  const loaded = (comments || {})[postId]
  if (loaded) return loaded.length
  return (commentCounts || {})[postId] || 0
}

export function userHasReposted(repostedPosts, postId, userId) {
  if (!userId) return false
  return (repostedPosts || []).some((r) => r.post_id === postId)
}

export function isSaved(savedPosts, postId) {
  return (savedPosts || []).some((s) => s.post_id === postId)
}

// A follow row exists for many viewers; only the viewer's own row counts.
export function isFollowing(follows, authorId, userId) {
  if (!userId) return false
  return (follows || []).some((f) => f.follower_id === userId && f.following_id === authorId)
}

// Locked = subscriber-only (or legacy premium), not yours, not unlocked.
export function isLocked(post, unlockedCreators, userId) {
  if (!post) return false
  const locked = post.subscriber_only || post.post_type === 'premium'
  if (!locked) return false
  if (userId && post.user_id === userId) return false
  return !(unlockedCreators || []).includes(post.user_id)
}

// A repost carries no content of its own, so its source is either already on
// the loaded page or was fetched alongside it.
export function resolveSourceFrom(posts, repostSources, id) {
  return (posts || []).find((p) => p.id === id) || (repostSources || {})[id] || null
}

// Moved verbatim from Feed.jsx:1687-1700. These exact strings are already on
// screen across every feed card — do not "improve" the thresholds or wording
// here; that would be a UI change hiding inside a refactor.
export function formatCount(n) {
  n = n || 0
  if (n < 1000) return `${n}`
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`.replace('.0k', 'k')
  return `${(n / 1000000).toFixed(1)}M`.replace('.0M', 'M')
}

export function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
