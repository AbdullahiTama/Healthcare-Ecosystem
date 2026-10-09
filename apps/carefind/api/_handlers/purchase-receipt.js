import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { announcePurchase, appUrlFor } from '../_lib/purchaseAnnouncements.js'
import { coinsForNaira } from '../../src/services/notificationCatalog.js'

// Confirmation for purchases the BROWSER settles itself.
//
// Card payments are settled by our own server (verify-* / webhook), which
// announces them there. CareCoin purchases of a consultation or a creator
// subscription are different: the browser calls the SECURITY DEFINER RPC
// (pay_professional_consultation / pay_creator_subscription) directly, so the
// server never sees them — and auto-renewal charges the wallet silently on the
// subscriber's next visit. After the RPC succeeds the browser asks this
// endpoint to confirm.
//
// Trust model — the client is told nothing and is believed about nothing:
//   * WHO is the caller comes from the verified JWT, never the body.
//   * WHAT was bought, and for how much, is read from the rows the RPC wrote
//     (the paid booking, the subscription); the body only names the other party.
//   * Calling it for something you did not buy finds no row (404).
//   * It is idempotent: announcePurchase dedupes on the purchase's own identity,
//     so replays, double-taps and a hostile loop all collapse to one notice and
//     one email — a caller can only ever trigger a receipt to themselves about
//     their own purchase, once.
//   * Old purchases are not re-announced (they are outside the recency window).
//
// POST { kind: 'consultation', professionalId }
// POST { kind: 'subscription', creatorId, renewal? }   (renewal is wording only)
// → 200 { announced, emailed }

const RECENT_CONSULTATION_MS = 30 * 60 * 1000
const MIN_FRESH_SUBSCRIPTION_MS = 25 * 24 * 60 * 60 * 1000 // a new 30-day period, with slack
const KOBO_PER_COIN = 20000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const shortHash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10)

export function createHandler({ getSupabase, verify = verifyUser, announce = announcePurchase, now = Date.now } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const supabase = getSupabase()
    const user = await verify(supabase, req)
    if (!user) return res.status(401).json({ error: 'Not signed in' })

    const { kind, professionalId, creatorId, renewal } = req.body || {}
    let facts

    if (kind === 'consultation') {
      if (!UUID_RE.test(professionalId || '')) return res.status(400).json({ error: 'Missing professional' })
      const { data: booking } = await supabase
        .from('professional_consultations')
        .select('id, fee, created_at')
        .eq('professional_id', professionalId)
        .eq('patient_id', user.id)
        .eq('status', 'paid')
        .maybeSingle()
      if (!booking) return res.status(404).json({ error: 'No booking found' })
      if (now() - Date.parse(booking.created_at) > RECENT_CONSULTATION_MS) {
        return res.status(200).json({ announced: false, reason: 'not_recent' })
      }
      const fee = Number(booking.fee) // naira
      facts = {
        buyerId: user.id,
        professionalId,
        amountKobo: Math.round(fee * 100),
        coins: coinsForNaira(fee),
        method: 'coins',
        reference: `cf_consult_coin_${booking.id.slice(0, 8)}`,
        dedupeId: booking.id,
        paidAt: booking.created_at,
      }
    } else if (kind === 'subscription') {
      if (!UUID_RE.test(creatorId || '')) return res.status(400).json({ error: 'Missing creator' })
      const { data: sub } = await supabase
        .from('creator_subscriptions')
        .select('price, expires_at')
        .eq('subscriber_id', user.id)
        .eq('creator_id', creatorId)
        .maybeSingle()
      if (!sub) return res.status(404).json({ error: 'No subscription found' })
      // One subscription row is extended on each renewal, so "this period" is
      // identified by its expiry. A row that does not run for ~30 more days was
      // not bought just now.
      if (Date.parse(sub.expires_at) - now() < MIN_FRESH_SUBSCRIPTION_MS) {
        return res.status(200).json({ announced: false, reason: 'not_recent' })
      }
      const coins = Number(sub.price)
      const period = `${user.id}:${creatorId}:${sub.expires_at}`
      facts = {
        buyerId: user.id,
        creatorId,
        coins,
        amountKobo: coins * KOBO_PER_COIN,
        method: 'coins',
        reference: `cf_sub_coin_${shortHash(period)}`,
        dedupeId: period,
        expiresAt: sub.expires_at,
        renewal: renewal === true,
      }
    } else {
      return res.status(400).json({ error: 'Unknown purchase' })
    }

    const result = await announce(kind, facts, {
      supabase, appUrl: appUrlFor(req), buyerEmail: user.email,
    })
    return res.status(200).json({ announced: !!result.announced, emailed: !!result.emailed })
  }
}

let client = null
export default createHandler({
  getSupabase: () => (client ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)),
})
