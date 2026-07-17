import { supabase } from './lib/supabaseClient'

// 1 CareCoin = ₦200
export const NAIRA_PER_COIN = 200
// Cap: 12 coins = ₦2,400/month (just under the ₦2,500 ceiling)
export const MAX_PRICE_COINS = 12

export function coinsToNaira(coins) {
  return (Number(coins) || 0) * NAIRA_PER_COIN
}

// Does `viewerId` currently have access to `creatorId`'s locked content?
// If their subscription lapsed but auto-renew is on, this quietly charges
// the next month from their wallet — that's what makes it feel automatic.
// Returns { active, sub, renewed, insufficient }
export async function checkAccess(viewerId, creatorId) {
  if (!viewerId || !creatorId) return { active: false }
  if (viewerId === creatorId) return { active: true } // your own content

  const { data: sub } = await supabase
    .from('creator_subscriptions')
    .select('*')
    .eq('subscriber_id', viewerId)
    .eq('creator_id', creatorId)
    .maybeSingle()

  if (!sub) return { active: false }

  const stillValid = new Date(sub.expires_at) > new Date()
  if (stillValid) return { active: true, sub }

  // Lapsed. Auto-renew if they asked us to.
  if (sub.auto_renew) {
    const result = await subscribe(viewerId, creatorId, sub.price)
    if (result.ok) return { active: true, sub, renewed: true }
    if (result.insufficient) return { active: false, sub, insufficient: true }
  }

  return { active: false, sub }
}

// Charge the wallet and grant/extend 30 days. Atomic — handled in the DB.
// Returns { ok, insufficient, error }
export async function subscribe(subscriberId, creatorId, priceCoins) {
  if (!subscriberId || !creatorId) return { error: 'Missing user' }
  const price = Number(priceCoins) || 0
  if (price <= 0) return { error: 'Invalid price' }

  const { data, error } = await supabase.rpc('pay_creator_subscription', {
    p_subscriber: subscriberId,
    p_creator: creatorId,
    p_price: price,
  })

  if (error) return { error: error.message }
  if (data === 'insufficient') return { insufficient: true }
  if (data === 'ok') return { ok: true }
  return { error: 'Could not complete subscription' }
}

export async function cancelAutoRenew(subscriberId, creatorId) {
  const { error } = await supabase
    .from('creator_subscriptions')
    .update({ auto_renew: false })
    .eq('subscriber_id', subscriberId)
    .eq('creator_id', creatorId)
  return { ok: !error, error: error?.message }
}

// Every creator this viewer currently has access to — used by the feed
// so it doesn't have to check each post one at a time.
export async function loadActiveCreatorIds(viewerId) {
  if (!viewerId) return []
  const { data } = await supabase
    .from('creator_subscriptions')
    .select('creator_id, expires_at')
    .eq('subscriber_id', viewerId)
  return (data || [])
    .filter((s) => new Date(s.expires_at) > new Date())
    .map((s) => s.creator_id)
}
