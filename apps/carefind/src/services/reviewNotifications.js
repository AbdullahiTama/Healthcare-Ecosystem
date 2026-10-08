// Notifications for reviews (issue #7).
//
// The report was "receiving a 5-star review produced no notification". That is
// not a delivery failure — nothing was ever emitted. Auditing every activity
// against the notification vocabulary in services/notify.js:
//
//   type              emitted from                            status
//   ────────────────  ──────────────────────────────────────  ─────────
//   like              Feed.jsx, useFeed.js                    working
//   comment / reply   Feed.jsx                                working
//   comment_like      CommentThread.jsx                       working
//   mention           CommentThread.jsx                       working
//   follow            Feed.jsx                                working
//   gift              GiftPanel.jsx                           working
//   profile_view      PublicProfile.jsx                       working
//   consultation      PublicProfile.jsx                       working
//   news_like         NewsArticle.jsx                         working
//   news_comment      NewsArticle.jsx                         working
//   live              UserGoLive.jsx                          working
//   repost            —                                       MISSING
//   review            —                                       MISSING (no type)
//   product_available —                                       unused
//
// `repost` had a message defined and no emitter; reviews had neither. Reposts
// are fixed in Feed.jsx's toggleRepost. The three review surfaces are fixed
// through this module, which exists because each of them has a DIFFERENT
// recipient and none of them is the row's own user_id:
//
//   user_reviews     → the person reviewed        (subject_id)
//   reviews          → whoever claimed the business (business_claims.user_id)
//   product_reviews  → the listing's owner        (products.owner_id)
//
// Getting that recipient wrong is the other failure mode the issue names ("or
// may emit one with the wrong recipient ID, causing it to silently miss the
// right user"), so recipient resolution is separated out and tested.

import { notify } from './notify.js'

export const REVIEW_MESSAGES = {
  user: (rating) => `left you a ${rating}-star review`,
  business: (rating) => `left a ${rating}-star review on your business`,
  product: (rating) => `left a ${rating}-star review on your product`,
}

// Who should hear about a review of a business? Businesses are not profiles,
// so the notification goes to the user whose claim on it was approved.
//
// This MUST go through the RPC, not a direct read. `business_claims`' SELECT
// policy is `is_platform_admin() OR user_id = auth.uid() OR business_id IN
// (current_business_ids())` — a reviewer is none of those for a business they
// do not own, so a direct read returns zero rows and the notification is
// silently skipped. Proven by impersonating a real non-claimant: the direct
// read returned 0 while `business_claim_owner()` returns the right uuid
// (20260822_business_claim_owner.sql).
export async function resolveBusinessOwner(supabase, businessId) {
  if (!businessId) return null
  const { data, error } = await supabase.rpc('business_claim_owner', { p_business_id: businessId })
  if (error) {
    console.error('[review] could not resolve business owner', { businessId, message: error.message })
    return null
  }
  return data || null
}

// Who owns a product listing? A CareFind seller sets products.owner_id; a
// CareHub-sourced listing has none, and there is nobody to notify.
export async function resolveProductOwner(supabase, productId) {
  if (!productId) return null
  const { data } = await supabase
    .from('products')
    .select('owner_id')
    .eq('id', productId)
    .maybeSingle()
  return data?.owner_id || null
}

// Emit the notification for one review. `kind` is 'user' | 'business' |
// 'product'. Resolution failures are reported by returning a reason rather
// than throwing — a review must still post if its notification cannot be
// addressed — but they are never invisible: the caller logs the reason.
export async function notifyReview(supabase, { kind, actorId, rating, subjectId, businessId, productId, link }) {
  let recipientId = null

  if (kind === 'user') recipientId = subjectId
  else if (kind === 'business') recipientId = await resolveBusinessOwner(supabase, businessId)
  else if (kind === 'product') recipientId = await resolveProductOwner(supabase, productId)
  else return { sent: false, reason: `unknown review kind: ${kind}` }

  if (!recipientId) return { sent: false, reason: 'no recipient for this review' }
  if (recipientId === actorId) return { sent: false, reason: 'self-review' }

  const message = (REVIEW_MESSAGES[kind] || REVIEW_MESSAGES.user)(rating)
  const result = await notify({ recipientId, actorId, type: 'review', message, link })
  return { sent: result?.ok !== false, recipientId, message, reason: result?.reason }
}
