// The money arithmetic the Finance screens already did, moved verbatim so it can be
// tested. Nothing here is new maths: each helper reproduces what the legacy tab computed,
// including its quirks (the top-up total ignores status; coins convert at a fixed 200).

export const topupTotal = (transactions) =>
  transactions.filter(t => t.type === 'topup').reduce((s, t) => s + (t.naira_amount || 0), 0) / 100

export const countByType = (transactions, type) => transactions.filter(t => t.type === type).length

export const nairaFromCoins = (amount) => amount * 200

export const maskAccount = (number) => {
  const s = number == null ? '' : String(number)
  return s.length >= 4 ? `••••${s.slice(-4)}` : '—'
}

// A withdrawal is in flight while its coins are reserved and Paystack has not settled the transfer.
export const isInFlight = (w) => w.status === 'reserved' || w.status === 'processing'
