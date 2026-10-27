import { debtRepository as defaultDebts } from './repositories'
import { purchaseRepository as defaultPurchases } from '../purchases/repositories'

// "Mark paid" on the Debts page, for every debt that is not a credit sale.
// (A credit-sale debt is settled in Debts.jsx through the POS ledger's
// record_sale_payment, after asking how the customer paid.)
//
// A debt raised by a purchase mirrors that purchase. Settling only the debt
// (as this page used to) left the purchase still owing, with nothing in its
// payment history. So a purchase debt is settled by paying the purchase's
// remaining balance through record_purchase_payment, which moves the
// purchase, the debt and the history together. Any other debt, or one whose
// purchase is gone or already paid, is simply marked paid.
//
// Returns { via: 'purchase' | 'debt' }.
export async function settleDebt(debt, businessId, {
  staffName = null,
  debts = defaultDebts,
  purchases = defaultPurchases,
} = {}) {
  if (debt.source === 'purchase' && debt.source_ref) {
    const purchase = await purchases.getById(debt.source_ref, businessId)
    if (purchase && Number(purchase.balance) > 0) {
      await purchases.recordPayment(purchase.id, { amount: Number(purchase.balance), method: 'Other', note: 'Settled from the Debts page', staffName })
      await markDebtPaidIfStillOpen(debt, businessId, debts)
      return { via: 'purchase' }
    }
  }
  await debts.update(debt.id, businessId, { amount_paid: debt.amount, balance: 0, status: 'paid' })
  return { via: 'debt' }
}

// The payment function moves the debt by the amount paid; if the two had
// drifted apart before history existed, close the debt anyway.
async function markDebtPaidIfStillOpen(debt, businessId, debts) {
  const open = await debts.findOpenBySource(debt.source, debt.source_ref, businessId)
  if (open && open.id === debt.id) {
    await debts.update(debt.id, businessId, { amount_paid: open.amount, balance: 0, status: 'paid' })
  }
}
