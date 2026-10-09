import { supabase } from '../config/supabaseClient'

// After the browser settles a CareCoin purchase itself (a consultation booking,
// a creator subscription or its auto-renewal), ask the server to confirm it:
// the buyer gets an in-app notice and a receipt email, the professional/creator
// is told they were paid. Card payments never come through here — the server
// settles those and announces them itself.
//
// Best effort by design. The coins have already moved, so a receipt that fails
// must never look like a failed purchase: this never throws and nothing waits on
// it. The server decides what was bought from its own records, so the payload
// only names the other party (see api/_handlers/purchase-receipt.js).
//
// payload: { kind: 'consultation', professionalId }
//        | { kind: 'subscription', creatorId, renewal? }
export async function requestPurchaseReceipt(payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await fetch('/api/purchase-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
      // The page may navigate straight after a purchase; let the request finish.
      keepalive: true,
    })
  } catch {
    // swallowed on purpose — see above
  }
}
