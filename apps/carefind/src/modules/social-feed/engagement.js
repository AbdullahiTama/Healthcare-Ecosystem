// Reconciliation and repost persistence for the social feed.
//
// The like/save/repost toggles are optimistic: a temp row is painted into
// state instantly and swapped for the real row once the DB confirms. The
// unique indexes installed by 20260813_post_engagement_uniqueness.sql turn a
// fast double-tap into a unique violation instead of a duplicate row, so an
// insert that returns 23505 is resolved by reading the existing row back. The
// UI ends up consistent with the DB either way, and a like/save/repost never
// silently vanishes on the next feed reload.

// Insert one self-scoped row and return the real row whether it was newly
// created or already present.
//   insertRowResolvingConflict(supabase, 'post_reactions', { post_id, user_id, reaction_type: 'like' }, ['post_id', 'user_id'])
// Returns { data } on success (data is the row, in both the fresh-insert and
// already-existed cases) or { data: null, error } on any other failure.
export async function insertRowResolvingConflict(supabase, table, row, conflictColumns) {
  const { data, error } = await supabase.from(table).insert(row).select().maybeSingle()
  if (!error) return { data, error: null }
  if (error.code !== '23505') return { data: null, error }

  const match = {}
  conflictColumns.forEach((c) => { match[c] = row[c] })
  const { data: existing, error: readError } = await supabase.from(table).select().match(match).maybeSingle()
  if (readError || !existing) return { data: null, error }
  return { data: existing, error: null }
}

// Classic repost, in two parts that stay consistent as a unit:
//   1. post_reposts reference (post_id = source, user_id = reposter) — the
//      machine-readable record the Reposts tab and repost_count use. Written
//      through insertRowResolvingConflict so a double-tap resolves to the
//      existing reference instead of erroring.
//   2. A real 🔁-marked posts row in the reposter's feed whose repost_of
//      points at the source, so followers see the repost exactly as the
//      legacy content-marker convention renders it (postDisplay.jsx).
// The subscriber_only/is_premium flags are carried across so a repost of a
// locked post stays locked for everyone who wasn't already entitled.
// Returns { ref, repostPost } where each is the { data, error } of its write.
//
// The feed-post half is also sent through insertRowResolvingConflict (on
// ['user_id', 'repost_of']): posts_user_repost_uniq
// (20260813_reposts_unique_per_user.sql) makes one 🔁 feed post per
// (user, source) a DB guarantee, so a second write in the same render tick —
// or from a stale tab — hits 23505 and resolves to the existing post instead
// of publishing a twin. Feed.jsx toggleRepost also guards in-flight, so the
// DB index is the authority and the client just avoids the wasted write.
export async function writeRepost(supabase, { user, post }) {
  const repostContent = `🔁 ${post.content || ''}`.replace(/\s+/g, ' ').trim()
  const ref = await insertRowResolvingConflict(supabase, 'post_reposts', { post_id: post.id, user_id: user.id }, ['post_id', 'user_id'])
  const repostPost = await insertRowResolvingConflict(supabase, 'posts', {
    user_id: user.id,
    content: repostContent,
    post_type: 'text',
    image_url: post.image_url || null,
    subscriber_only: post.subscriber_only || false,
    is_premium: post.is_premium || false,
    repost_of: post.id,
  }, ['user_id', 'repost_of'])
  return { ref, repostPost }
}

// Undo a repost: remove the reposter's 🔁 post (found by repost_of) and the
// post_reposts reference. Returns { postsDelete, refDelete } write results.
export async function undoRepost(supabase, { user, sourcePostId, repostRefId }) {
  const found = await supabase
    .from('posts')
    .select('id')
    .eq('repost_of', sourcePostId)
    .eq('user_id', user.id)
    .maybeSingle()

  const postsDelete = found?.data?.id
    ? await supabase.from('posts').delete().eq('id', found.data.id)
    : null
  const refDelete = repostRefId
    ? await supabase.from('post_reposts').delete().eq('id', repostRefId)
    : null
  return { postsDelete, refDelete }
}

// Session-scoped view recording (engagement spec §7). A qualifying view is
// one event in post_view_events (written by the record_post_view SECURITY
// DEFINER RPC, which derives viewer_id from auth.uid() and lets the DB dedupe
// on (post, session, viewer)); posts.view_count is then bumped by trigger.
// The recorder counts a post once per session — re-renders, StrictMode
// double-effects, tab switches and pull-to-refresh can't inflate the count,
// while a fresh recorder (new app load, new session id) records repeat views.
// The DB unique index is the real guard; this Set only avoids the wasted RPC.
export function createViewRecorder(supabase) {
  const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const fired = new Set()

  return {
    sessionId,
    // Record a view for one post. Returns true the first time in this
    // session, false on any later call for the same post.
    record(postId) {
      if (fired.has(postId)) return false
      fired.add(postId)
      supabase.rpc('record_post_view', { p_post_id: postId, p_session_id: sessionId }).then(() => {}).catch(() => {})
      return true
    },
    has(postId) {
      return fired.has(postId)
    },
  }
}
