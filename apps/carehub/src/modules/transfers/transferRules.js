// Pure helpers for the Stock Transfers screen: how a transfer reads from one
// location's point of view, and checks on what the user typed.

export const STATUS = {
  in_transit: { label: 'In transit', pill: 'amber' },
  received: { label: 'Received', pill: 'green' },
  cancelled: { label: 'Cancelled', pill: 'gray' },
}

export const locationName = (loc) => loc?.branch_name || (!loc?.parent_business_id ? 'Main Location' : loc?.name) || 'Another location'

// 'in' when this location receives the transfer, 'out' when it sent it.
export const directionFor = (transfer, locationId) => (transfer?.to_branch_id === locationId ? 'in' : 'out')

export function totals(transfer) {
  const lines = transfer?.stock_transfer_lines || []
  const sent = lines.reduce((s, l) => s + (Number(l.qty_sent) || 0), 0)
  const received = lines.reduce((s, l) => s + (l.qty_received == null ? 0 : Number(l.qty_received)), 0)
  return { items: lines.length, sent, received, shortfall: transfer?.status === 'received' ? sent - received : 0 }
}

// The lines of a new transfer: every item needs a whole quantity between 1 and what is in stock.
export function checkSendLines(lines) {
  if (!lines.length) return 'Add at least one item.'
  for (const l of lines) {
    const q = Number(l.qty)
    if (!Number.isInteger(q) || q <= 0) return `Enter a whole quantity for ${l.name}.`
    if (q > (Number(l.stock) || 0)) return `Only ${l.stock} of ${l.name} in stock here.`
  }
  return null
}

// What arrived, from the receiving form: [{ line_id, qty_received }] for the lines that are short, or an error.
export function checkReceived(lines, received) {
  const out = []
  for (const l of lines) {
    const raw = received[l.id]
    if (raw === undefined || raw === '' || Number(raw) === l.qty_sent) continue
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0 || n > l.qty_sent) return { error: `Received for ${l.product_name} must be a whole number from 0 to ${l.qty_sent}.` }
    out.push({ line_id: l.id, qty_received: n })
  }
  return { lines: out }
}

// The database's refusal, as a sentence for the person.
export function transferError(e) {
  const m = String(e?.message || e || '').replace(/^Supabase error \(\d+\):\s*/, '')
  if (/^[A-Z][^{}<>_"`]{3,200}[.!]$/.test(m)) return m
  return 'Could not complete this. Please try again.'
}
