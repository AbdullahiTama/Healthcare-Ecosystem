// Rules shared by every screen that records a payment against a balance
// (POS credit sales, Purchases). The database enforces the same rules in
// record_sale_payment / record_purchase_payment; checking here only saves a
// round trip and gives the message next to the field.

// Validates an amount typed for a payment against what is still owed. Returns
// { amount } (rounded to kobo) or { error } with a sentence for the user.
export function validatePaymentAmount(input, balance) {
  const text = String(input ?? '').trim().replace(/,/g, '')
  if (!text) return { error: 'Enter the amount received.' }
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) return { error: 'Enter an amount greater than zero.' }
  const amount = Math.round(value * 100) / 100
  const owed = Math.round((Number(balance) || 0) * 100) / 100
  if (amount > owed) return { error: `That is more than the balance of ${owed.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.` }
  return { amount }
}
