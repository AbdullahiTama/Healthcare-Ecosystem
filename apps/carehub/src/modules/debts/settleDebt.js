import { debtRepository as defaultDebts } from './repositories'
import { saleRepository as defaultSales } from '../pos/repositories'
import { purchaseRepository as defaultPurchases } from '../purchases/repositories'

// "Mark paid" on the Debts page.
//
// A debt raised by a credit sale or a purchase mirrors that record. Settling
// only the debt (as this page used to) left the sale or purchase still owing,
// with nothing in its payment history. So a linked debt is settled by paying
// the linked record's remaining balance through its payment function
// (record_sale_payment / record_purchase_payment), which moves the record, the
// debt and the history together. A manual debt is simply marked paid.
//
// Returns { via: 'sale' | 'purchase' | 'debt' }.
export async function settleDebt(debt, businessId, {
  staffName = null,
  debts = defaultDebts,
  sales = defaultSales,
  purchases = defaultPurchases,
} = {}) {
  const note = 'Settled from the Debts page'
  if (debt.source === 'credit_sale' && debt.source_ref) {
    const sale = await sales.getById(businessId, debt.source_ref)
    if (sale && Number(sale.balance) > 0) {
      await sales.recordPayment(sale.id, { amount: Number(sale.balance), method: 'Other', note, staffName })
      await markDebtPaidIfStillOpen(debt, businessId, debts)
      return { via: 'sale' }
    }
  }
  if (debt.source === 'purchase' && debt.source_ref) {
    const purchase = await purchases.getById(debt.source_ref, businessId)
    if (purchase && Number(purchase.balance) > 0) {
      await purchases.recordPayment(purchase.id, { amount: Number(purchase.balance), method: 'Other', note, staffName })
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
