import { supabase } from '../config/supabaseClient'
import { isPaymentType } from './notificationCatalog.js'

// Central helper to create an ACTIVITY notification (like, follow, reply…).
// recipientId: who receives it. actorId: who did the action. type: activity kind.
// Never notify yourself. Fails silently so it never blocks the main action.
//
// Two things this deliberately cannot do, because the database refuses them too
// (sql/20261009_notifications_structured.sql):
//   * write without an actor — an activity notification always says WHO did it;
//   * write a payment notification — those say "money moved" and are trusted
//     precisely because only the server, which verified the payment, writes them.
// Payment notices are created by the API (api/_lib/purchaseAnnouncements.js).
export async function notify({ recipientId, actorId, type, message, link = null, postId = null }) {
  try {
    if (!recipientId || !actorId) return
    if (isPaymentType(type)) return
    if (recipientId === actorId) return // don't notify your own actions
    await supabase.from('notifications').insert({
      recipient_id: recipientId,
      actor_id: actorId,
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
  comment_like: 'liked your comment',
  reply: 'replied to you',
  gift: 'sent you a gift',
  follow: 'started following you',
  profile_view: 'viewed your profile',
  repost: 'reposted your post',
  mention: 'mentioned you',
  live: 'is live now',
  consultation: 'booked a consultation with you',
  news_like: 'liked your article',
  news_comment: 'commented on your article',
  product_available: 'a product you wanted is now available',
}
