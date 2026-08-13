// Followers / following list reads for profiles.
//
// The live `follows` table has no created_at on databases that predate the
// 20260813_follows_created_at.sql migration, and an ORDER BY on a missing
// column makes PostgREST fail the entire query — which surfaced as the
// permanent "Could not load this list. Please try again." error on Profile →
// Followers/Following. The read therefore orders by created_at (newest first)
// when the column exists and falls back to the same query unordered when it
// doesn't. RLS is untouched: the follows SELECT policy and the caller's
// show_followers privacy filtering still apply to whatever comes back.

export const FOLLOW_SELECT = {
  followers: 'follower_id, follower:follower_id(id, full_name, display_name, is_verified, avatar_url, show_followers)',
  following: 'following_id, following:following_id(id, full_name, display_name, is_verified, avatar_url, show_followers)',
}

export async function fetchFollowList({ supabase, profileId, kind }) {
  const isFollowers = kind === 'followers'
  const cols = isFollowers ? FOLLOW_SELECT.followers : FOLLOW_SELECT.following
  const key = isFollowers ? 'following_id' : 'follower_id'

  const ordered = await supabase
    .from('follows')
    .select(cols)
    .eq(key, profileId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (!ordered.error) return { data: ordered.data, error: null }

  const fallback = await supabase
    .from('follows')
    .select(cols)
    .eq(key, profileId)
    .limit(200)

  return { data: fallback.data, error: fallback.error }
}
