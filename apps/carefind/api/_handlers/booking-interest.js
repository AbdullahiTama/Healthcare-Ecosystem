import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Best-effort booking interest notification for disabled booking.
// Mirrors booking.js notifyBusiness but exposed as a public endpoint so
// facility cards / disabled BookingCard can notify the owner without
// opening the booking form. Never blocks the UI — failures are swallowed
// and the client always gets a success (the UI already showed the toast).

// In-memory throttle per (ip, business) to prevent a single viewer
// tapping repeatedly from flooding the owner's inbox. Mirrors the
// sessionStorage throttle in contactLeads.js but server-side as a safety
// net for programmatic callers. Window is 30s.
const throttle = new Map()

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body || {}
  const businessId = body.business_id || body.businessId
  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ error: 'business_id is required' })
  }

  // Basic UUID format guard (avoids hitting DB with junk)
  if (!/^[0-9a-fA-F-]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(businessId)) {
    return res.status(400).json({ error: 'Invalid business_id' })
  }

  // Throttle: one interest per ip/business per 30s
  try {
    const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['x-forwarded-host'] || 'anon').toString().split(',')[0].trim()
    const key = `${ip}:${businessId}`
    const now = Date.now()
    const last = throttle.get(key)
    if (last && now - last < 30_000) {
      return res.status(200).json({ success: true, throttled: true })
    }
    throttle.set(key, now)
    // Prevent unbounded growth
    if (throttle.size > 1000) {
      const cutoff = now - 60_000
      for (const [k, v] of throttle.entries()) {
        if (v < cutoff) throttle.delete(k)
      }
    }
  } catch (e) {
    // Throttle must never block the notification
  }

  // Verify business exists and is still listable; if not, still return 200
  // to avoid leaking enumeration, but don't create a notification.
  try {
    const { data: business } = await supabase
      .from('businesses')
      .select('id, status, visible_on_carefind')
      .eq('id', businessId)
      .maybeSingle()
    if (!business) {
      return res.status(404).json({ error: 'Business not found' })
    }
    // Only notify for active, visible businesses; otherwise silently succeed
    // so the UI toast still shows without an inbox orphan.
    if (business.status !== 'active' || business.visible_on_carefind === false) {
      return res.status(200).json({ success: true })
    }
  } catch (e) {
    // If verification fails, proceed to insert anyway (best-effort)
  }

  try {
    await supabase.from('staff_notifications').insert({
      business_id: businessId,
      staff_id: null,
      is_owner: true,
      kind: 'booking_interest',
      title: 'Booking interest',
      body: 'A visitor tried to book an appointment while bookings are disabled on CareFind.',
      link: '/dashboard/appointments',
      read_at: null,
    })
  } catch (e) {
    // Swallow — the booking UI must never be blocked by a notification failure.
    console.warn('[booking-interest] insert failed', e?.message || e)
  }

  return res.status(201).json({ success: true })
}
