// announcePurchase — what happens AFTER money has moved and been recorded.
//
// One function every payment flow calls (top-up, consultation, subscription,
// booking; card or CareCoins), so the customer's in-app notification, the
// payee's notification and the receipt email are produced one way, with one
// wording (src/services/notificationCatalog.js), instead of being hand-built
// at each call site.
//
// Rules:
//   1. Settlement comes first and is never undone or delayed by this. The
//      function never throws; failures are logged and reported in the result.
//   2. Idempotent. The webhook and the Paystack redirect race each other on
//      every card payment, and a customer may reload the return page. The
//      buyer's notification row carries a dedupe_key under a unique index
//      (recipient_id, dedupe_key): the caller that inserts it owns the
//      announcement; a unique violation means someone already announced, so no
//      second email goes out. The email is therefore at-most-once — if the
//      provider is down the customer still has the in-app notification and
//      Paystack's own receipt, and we do not risk mailing them twice.
//   3. Payment notifications are written here, with the service role, and
//      nowhere else. Browsers are refused this type prefix by RLS.
//
// If the dedupe columns are missing (migration not yet applied) the insert
// fails with something other than a unique violation. We log it loudly and
// still send the email: the customer's confirmation matters more than the
// small chance of a duplicate while the migration is pending.

import { buildPurchaseAnnouncement } from '../../src/services/notificationCatalog.js'
import { renderEmail, sendEmail as defaultSendEmail, isValidEmail } from './email.js'

const UNIQUE_VIOLATION = '23505'

// Base URL for links inside emails. Deliberately NOT derived from the request's
// Host / X-Forwarded-Host headers: verify-booking-payment is unauthenticated,
// so a header-derived base would let a caller plant their own domain in a
// legitimate receipt that goes to someone else's inbox. Only server config is
// trusted — CAREFIND_APP_URL, else Vercel's own production-URL variable. With
// neither, the email simply has no button (the receipt itself is complete).
// `_req` is kept so call sites read the same as before.
export function appUrlFor(_req, env = process.env) {
  if (env.CAREFIND_APP_URL) return env.CAREFIND_APP_URL.replace(/\/+$/, '')
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/+$/, '')
  return ''
}

async function lookupUserEmail(supabase, userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    return data?.user?.email || null
  } catch {
    return null
  }
}

// When the subscriber's access now runs until — shown on the receipt. Null when
// it cannot be read; the catalog then says "30 days" rather than guessing a date.
export async function subscriptionExpiry(supabase, subscriberId, creatorId) {
  try {
    const { data } = await supabase
      .from('creator_subscriptions')
      .select('expires_at')
      .eq('subscriber_id', subscriberId)
      .eq('creator_id', creatorId)
      .maybeSingle()
    return data?.expires_at || null
  } catch {
    return null
  }
}

// Names make the messages read as sentences about people ("Ada booked a
// consultation with you") instead of "A patient". Best effort: a missing name
// falls back to neutral wording in the catalog, never to an error.
async function lookupNames(supabase, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return {}
  try {
    const { data } = await supabase.from('profiles').select('id, full_name, display_name').in('id', unique)
    return Object.fromEntries((data || []).map((p) => [p.id, p.full_name || p.display_name || null]))
  } catch {
    return {}
  }
}

// Returns 'inserted' | 'duplicate' | 'failed'.
async function insertNotification(supabase, n, logger) {
  try {
    const { error } = await supabase.from('notifications').insert({
      recipient_id: n.recipientId,
      actor_id: null,
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link,
      metadata: n.metadata,
      dedupe_key: n.dedupeKey,
      read: false,
    })
    if (!error) return 'inserted'
    if (error.code === UNIQUE_VIOLATION) return 'duplicate'
    logger.error('[purchase] notification insert failed', { type: n.type, code: error.code, message: error.message })
    return 'failed'
  } catch (err) {
    logger.error('[purchase] notification insert threw', { type: n.type, message: err?.message })
    return 'failed'
  }
}

/**
 * @param {'topup'|'consultation'|'subscription'|'booking'} kind
 * @param {object} facts  see buildPurchaseAnnouncement; amounts are integer kobo
 * @param {object} ctx
 * @param {object} ctx.supabase       service-role client
 * @param {string} [ctx.appUrl]       absolute base for links in the email
 * @param {string} [ctx.buyerEmail]   known address; otherwise looked up from the account
 * @returns {Promise<{ announced: boolean, duplicate?: boolean, emailed: boolean,
 *                     emailSkipped?: string, sellerNotified?: boolean, error?: string }>}
 */
export async function announcePurchase(kind, facts, {
  supabase, appUrl = '', buyerEmail, sendEmail = defaultSendEmail, logger = console, env = process.env,
}) {
  try {
    const names = await lookupNames(supabase, [facts.buyerId, facts.professionalId, facts.creatorId])
    const built = buildPurchaseAnnouncement(kind, {
      paidAt: new Date().toISOString(),
      buyerName: names[facts.buyerId],
      professionalName: names[facts.professionalId],
      creatorName: names[facts.creatorId],
      ...stripNil(facts),
    })

    // Buyer's in-app notification doubles as the idempotency record.
    let duplicate = false
    if (built.buyer) {
      duplicate = (await insertNotification(supabase, built.buyer, logger)) === 'duplicate'
    }

    let emailed = false
    let emailSkipped
    if (duplicate) {
      emailSkipped = 'already_announced'
    } else {
      const to = buyerEmail || (facts.buyerId ? await lookupUserEmail(supabase, facts.buyerId) : null)
      if (!isValidEmail(to)) {
        emailSkipped = 'no_email'
      } else {
        const { html, text } = renderEmail(built.email, { appUrl, supportEmail: env.SUPPORT_EMAIL || '' })
        const result = await sendEmail({ to, subject: built.email.subject, html, text }, { env, logger })
        emailed = !!result.sent
        if (!emailed) emailSkipped = result.skipped || 'send_failed'
      }
    }

    // The payee is told independently of the buyer's outcome: if a retry finds
    // the buyer already announced, the payee row either exists too (duplicate,
    // ignored) or was lost to a transient error and is now filled in.
    let sellerNotified = false
    if (built.seller) {
      sellerNotified = (await insertNotification(supabase, built.seller, logger)) === 'inserted'
    }

    return { announced: !duplicate, duplicate, emailed, emailSkipped, sellerNotified }
  } catch (err) {
    logger.error('[purchase] announcement failed', { kind, message: err?.message })
    return { announced: false, emailed: false, error: err?.message || 'announcement failed' }
  }
}

// Spread order matters: explicit facts win over looked-up defaults, but an
// explicit `undefined` must not erase a looked-up name.
function stripNil(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null))
}
