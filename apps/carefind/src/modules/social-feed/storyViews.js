// Story seen/unseen tracking (Phase 5).
//
// The story_views table (20260813_story_views.sql) records which stories the
// CURRENT user has watched. RLS scopes reads and writes to the viewer's own
// rows, so fetchViewedStoryIds can never leak another user's viewing history.
// markStoriesViewed writes through an insert .. on conflict do nothing, which
// turns a fast double-watch into a no-op instead of a 23505 error — exactly
// the same tolerance pattern the engagement helpers use.

// Return a Set of story ids this viewer has already seen (stories that don't
// exist yet are simply skipped). Returns an empty Set on any error.
export async function fetchViewedStoryIds(supabase, storyIds) {
  if (!storyIds || storyIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('story_views')
    .select('story_id')
    .in('story_id', storyIds)
  if (error || !data) return new Set()
  return new Set(data.map((r) => r.story_id))
}

// Mark one or more stories as seen by this viewer. storyIds may be empty (the
// viewer has no session) in which case nothing is written. Errors are ignored
// here — missing a "seen" write must never crash the story viewer.
export async function markStoriesViewed(supabase, { storyIds, userId }) {
  if (!storyIds || storyIds.length === 0) return null
  if (!userId) return null
  const rows = storyIds.map((story_id) => ({ story_id, user_id: userId }))
  const { data, error } = await supabase
    .from('story_views')
    .upsert(rows, { onConflict: 'story_id,user_id', ignoreDuplicates: true })
  if (error) {
    // A 23505 race (two inserts for the same pair) is a success in spirit —
    // the row is there. Any other failure just means "not seen, retry later".
    if (error.code !== '23505') return null
  }
  return { data, error: error?.code === '23505' ? null : error }
}
