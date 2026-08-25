// The column set a post needs to render as a card.
//
// One definition, because there are two readers of it and they must not drift:
// Feed's own list queries, and usePostEngagement's repost-source resolution.
// A resolved repost source is rendered by exactly the same PostCard as a normal
// post (issues #6/#8), so it needs exactly the same columns — which is why the
// hook's copy of this string was byte-identical to Feed's. It was duplicated
// rather than imported only because Feed's constant was not exported, and the
// task that introduced it was scoped not to touch Feed.
export const POST_FEED_COLS = 'id, content, created_at, user_id, post_type, theme, image_url, rating, view_count, subscriber_only, audio_url, video_url, posted_as_type, posted_as_id, posted_as_name, posted_as_title, repost_of, repost_count'

// The same set minus repost_of/repost_count, which need the 20260813 reposts
// migration. Until that is applied those columns do not exist, so the feed and
// search fall back to this rather than erroring — the same graceful-degradation
// pattern as the search_vector fallback.
export const POST_FEED_COLS_FALLBACK = 'id, content, created_at, user_id, post_type, theme, image_url, rating, view_count, subscriber_only, audio_url, video_url, posted_as_type, posted_as_id, posted_as_name, posted_as_title'
