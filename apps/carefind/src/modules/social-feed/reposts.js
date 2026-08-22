// Resolving a repost to the post it points at (issues #6 and #8).
//
// A repost is a `posts` row with `repost_of` set and no content of its own.
// Every surface that shows one — the feed, the detail modal, the reposter's
// profile grid, a public profile — needs the same two facts: WHO reposted it
// (the row's own user_id) and WHAT was reposted (the row `repost_of` names).
// This module is the one place that turns the first into the second, so those
// surfaces cannot drift apart the way they did before.
//
// Legacy rows are part of the contract. Reposts written before this change
// copied `🔁 <source content>` into the row. The backfill in
// 20260822_reposts_reference_model.sql reduces those to the bare marker, but a
// client can still meet an un-backfilled row from a cached page, so
// `isRepost` recognises both shapes and `sourceOf` prefers a resolved source
// over anything stored on the row.

import { REPOST_MARK } from './postDisplay.jsx'

// Is this row a repost? `repost_of` is the real signal; the content marker is
// the pre-repost_of convention, kept so an old row is still recognised.
export function isRepostRow(post) {
  if (!post) return false
  if (post.repost_of) return true
  return String(post.content || '').startsWith(REPOST_MARK)
}

// Which source ids does this page of posts need resolved? Skips reposts whose
// source is already on the page, so the common case costs no extra query.
export function unresolvedSourceIds(posts) {
  const present = new Set((posts || []).map((p) => p && p.id).filter(Boolean))
  const wanted = new Set()
  for (const post of posts || []) {
    if (post?.repost_of && !present.has(post.repost_of)) wanted.add(post.repost_of)
  }
  return [...wanted]
}

// Build id -> post lookup from a page of posts plus any separately fetched
// source posts.
export function indexPosts(...groups) {
  const byId = {}
  for (const group of groups) {
    for (const post of group || []) {
      if (post && post.id) byId[post.id] = post
    }
  }
  return byId
}

// The post whose words, author and engagement a repost card should show.
// Returns null when the row is a repost whose source has not been resolved —
// callers must treat that as "not ready" rather than falling back to the
// repost row, because falling back is exactly how the reposter ended up
// credited as the author.
export function sourceOf(post, byId) {
  if (!post?.repost_of) return null
  return byId?.[post.repost_of] || null
}

// What a card should actually render: the source for a repost, the row itself
// otherwise. `repostedBy` is the reposting user's id when this is a repost.
//
// `pending` is true for a repost whose source is not resolved yet; a caller
// should render a placeholder rather than the bare 🔁 row.
export function resolveCard(post, byId) {
  if (!post?.repost_of) {
    return { post, source: post, repostedBy: null, pending: false }
  }
  const source = sourceOf(post, byId)
  return {
    post,
    source,
    repostedBy: post.user_id,
    pending: !source,
  }
}

// Legacy display salvage: an un-backfilled repost row still holds
// `🔁 <copied content>`. If its source cannot be resolved, this is the only
// thing left to show. Never used when a source resolves.
export function legacyContentOf(post) {
  const raw = String(post?.content || '')
  if (!raw.startsWith(REPOST_MARK)) return raw
  return raw.slice(REPOST_MARK.length).trim()
}
