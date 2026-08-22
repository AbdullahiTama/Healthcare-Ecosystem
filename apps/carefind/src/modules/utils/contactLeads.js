// Fire-and-forget contact-lead recording (issue #4: CareFind → CareHub loop).
//
// When a viewer taps WhatsApp/Call on a listing, the tap itself is the lead —
// but the WhatsApp deep link takes the viewer out of the app and the intent
// evaporates. This helper records that intent into `contact_leads` so the
// business owner can be told about it in CareHub.
//
// Contract:
//   - NEVER blocks, throws, or surfaces UI. The anchor's default navigation
//     (WhatsApp / tel) must proceed no matter what happens here.
//   - Throttled per (business, channel, product) in sessionStorage: one viewer
//     tapping around must not flood the owner's notification feed. The throttle
//     lives for the tab session — a return visit tomorrow is a fresh lead.
import { supabase } from '../../config/supabaseClient'

export function recordContactLead({ businessId, productId, productName, channel }) {
  try {
    if (!businessId || (channel !== 'whatsapp' && channel !== 'call')) return
    const key = 'carehub_lead_' + businessId + '_' + channel + '_' + (productId || 'biz')
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')

    supabase.auth.getSession()
      .then(({ data }) => {
        const viewerId = data?.session?.user?.id || null
        return supabase.from('contact_leads').insert({
          business_id: businessId,
          product_id: productId || null,
          product_name: productName || null,
          channel,
          viewer_id: viewerId,
        })
      })
      .then(() => {}, () => {})
  } catch (e) {
    // Deliberately silent — see contract above.
  }
}
