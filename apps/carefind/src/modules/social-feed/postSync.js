// A minimal signal from the /post/:id overlay (PostModalRoute) to the Feed
// mounted underneath it.
//
// Task 6 gave the overlay its own usePostEngagement instance (deliberately —
// see PostModalRoute.jsx), which means a mutation made *inside* the overlay
// (edit, delete, like, comment, save, repost) never touches Feed's own copy
// of that post. Hoisting a single shared engagement instance above both
// surfaces is the architecturally correct fix for that; it needs its own
// design and review and is deliberately deferred. This is the smallest thing
// that keeps the two surfaces from visibly diverging in the meantime: the
// overlay marks itself dirty on a mutation, and on close — if dirty —
// dispatches this event so Feed can reload.
//
// A DOM event on `window`, not React state or router history state:
// PostModalRoute and Feed are siblings under BackgroundRoutes with no shared
// parent to hold this in, and `navigate(-1)` (the close mechanism) has no way
// to attach a payload to the history entry it pops back to. This mirrors the
// existing `identity-changed` event in lib/activeIdentity.js, and needs no
// payload of its own — Feed's reaction is always the same full loadFeed().
export const POSTS_DIRTY_EVENT = 'carefind:posts-dirty'

export function markPostsDirty() {
  window.dispatchEvent(new Event(POSTS_DIRTY_EVENT))
}
