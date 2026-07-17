import { supabase } from './lib/supabaseClient'

// Central helper to create a notification for any platform activity.
// recipientId: who receives it. actorId: who did the action. type: activity kind.
// Never notify yourself. Fails silently so it never blocks the main action.
export async function notify({ recipientId, actorId, type, message, link = null, postId = null }) {
  try {
    if (!recipientId) return
    if (recipientId === actorId) return // don't notify your own actions
    await supabase.from('notifications').insert({
      recipient_id: recipientId,
      actor_id: actorId || null,
      type,
      message,
      link,
      post_id: postId,
      read: false,
    })
  } catch (e) {
    // silent — notifications should never break the underlying action
  }
}

// Default human-readable messages per type (actor name is prepended by the UI).
export const NOTIF_MESSAGES = {
  like: 'liked your post',
  comment: 'commented on your post',
  reply: 'replied to you',
  gift: 'sent you a gift 🎁',
  follow: 'started following you',
  profile_view: 'viewed your profile',
  repost: 'reposted your post',
  mention: 'mentioned you',
  live: 'is live now 📡',
  news_like: 'liked your article',
  news_comment: 'commented on your article',
  product_available: 'a product you wanted is now available',
}
