import { supabase } from '../config/supabaseClient'

// Central helper to create a notification for any platform activity.
// recipientId: who receives it. actorId: who did the action. type: activity kind.
// Never notify yourself.
//
// A failed notification still never blocks the underlying action — but it is
// no longer INVISIBLE (issue #7, step 4). It used to swallow every error into
// an empty catch, and it ignored the insert's own `error` entirely, so a
// notification rejected by RLS or a constraint looked exactly like a
// successful one. Returns { ok, reason } and logs anything that went wrong, so
// "no notification arrived" can be diagnosed instead of guessed at.
export async function notify({ recipientId, actorId, type, message, link = null, postId = null }) {
  if (!recipientId) return { ok: false, reason: 'no recipient' }
  if (recipientId === actorId) return { ok: false, reason: 'self' } // don't notify your own actions

  try {
    const { error } = await supabase.from('notifications').insert({
      recipient_id: recipientId,
      actor_id: actorId || null,
      type,
      message,
      link,
      post_id: postId,
      read: false,
    })
    if (error) {
      console.error('[notify] insert failed', { type, recipientId, message: error.message, code: error.code })
      return { ok: false, reason: error.message }
    }
    return { ok: true }
  } catch (e) {
    console.error('[notify] threw', { type, recipientId, error: e?.message })
    return { ok: false, reason: e?.message || 'unknown' }
  }
}

// Default human-readable messages per type (actor name is prepended by the UI).
export const NOTIF_MESSAGES = {
  like: 'liked your post',
  comment: 'commented on your post',
  comment_like: 'liked your comment',
  reply: 'replied to you',
  gift: 'sent you a gift',
  follow: 'started following you',
  profile_view: 'viewed your profile',
  repost: 'reposted your post',
  // Reviews carry their star rating in the message, so the default here is
  // only a fallback — see services/reviewNotifications.js.
  review: 'left you a review',
  mention: 'mentioned you',
  live: 'is live now',
  consultation: 'booked a consultation with you',
  news_like: 'liked your article',
  news_comment: 'commented on your article',
  product_available: 'a product you wanted is now available',
}
