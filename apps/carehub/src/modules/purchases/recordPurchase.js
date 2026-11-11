// Recording one purchase: the purchase record, inventory replenishment through
// the stock ledger, and the "we owe" debt raised by any shortfall.
//
// Used by the Record Purchase form and by the bulk upload (purchaseImport.js),
// so a purchase from a spreadsheet is recorded exactly like one typed in.
// Validation belongs to the caller (formLineProblems, buildImportPlan): this
// service assumes the form's started lines are saveable.
//
// Each aggregate is owned by its module's repository (purchases, products,
// debts); they are passed in so tests can bind in-memory adapters.

import { purchaseRepository } from './repositories'
import { productRepository } from '../inventory/repositories'
import { debtRepository } from '../debts/repositories'
import { todayDate } from '../../lib/utils'
import { findDuplicate } from '../../lib/productMatches'
import { purchaseExpirySummary } from './expirySummary'
import { isBlankItem, findProductByBarcode, groupLinesByProduct } from './lineItems'
import { purchaseItemsFromForm } from './purchaseInvoice'

// Margin applied to newly created products from a purchase so they are
// immediately sellable. Existing products keep their own selling price.
export const NEW_PRODUCT_MARKUP = 1.5

const DEFAULT_REPOS = { purchaseRepository, productRepository, debtRepository }

// The catalogue product a line restocks: the one it was linked to, else an
// exact (normalised) name match. Never a fuzzy match.
export function resolveExistingProduct(inventory, line) {
  return (line.productId && (inventory || []).find(p => p.id === line.productId)) || findDuplicate(inventory || [], line.name, '', null)
}

// Totals as the purchase record stores them. Overpaying a supplier never
// stores a negative balance.
export function purchaseFigures(form) {
  const lines = (form.items || []).filter(i => !isBlankItem(i))
  const total = lines.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0)
  const paid = parseFloat(form.amountPaid) || 0
  return { lines, total, paid, balance: Math.max(0, total - paid), qty: lines.reduce((s, i) => s + Number(i.qty), 0) }
}

/**
 * Records `form` ({ supplier, supplyDate, dueDate, amountPaid, notes, items }).
 * Throws only when the purchase record itself could not be saved (nothing was
 * recorded). After that, stock and debt problems are reported, not thrown, so a
 * caller never retries a purchase that already exists.
 *
 * Returns { purchaseId, total, paid, balance, created, updated, syncFailed,
 * changedRows, debtFailed, newProductsAutoPriced }.
 */
export async function recordPurchase({ businessId, form, inventory = [], canReprice = false, repos = DEFAULT_REPOS }) {
  const { purchaseRepository: purchases, productRepository: products, debtRepository: debts } = repos
  const { lines, total, paid, balance, qty } = purchaseFigures(form)
  if (!lines.length) throw new Error('A purchase needs at least one item.')
  const productNames = lines.map(i => String(i.name).trim())
  const supplier = String(form.supplier || '').trim()
  const supplyDate = form.supplyDate || todayDate()
  const { expiry, batch } = purchaseExpirySummary(lines)

  const purchase = await purchases.create(businessId, {
    supplier_name: supplier,
    product_name: productNames.join(', '),
    quantity: qty,
    cost_price: qty > 0 ? total / qty : 0,
    total_cost: total,
    amount_paid: paid,
    balance,
    supply_date: supplyDate,
    due_date: form.dueDate || '',
    status: paid >= total ? 'paid' : 'pending',
    notes: form.notes || '',
    expiry,
    batch,
    // Each line's quantity and price, for the invoice view.
    items: purchaseItemsFromForm(lines),
  })
  const purchaseId = (Array.isArray(purchase) ? purchase[0] : purchase)?.id || ''

  // INVENTORY SYNC, through the stock ledger. Lines are grouped by product so a
  // new product is created once and its cost and price written once; then
  // every line is received on its own through receive_stock (one ledger
  // movement and batch per line), keyed by purchase + line so a retried
  // request can never add the stock twice.
  let created = 0
  let updated = 0
  const syncFailed = []
  const changedRows = []
  const keyBase = purchaseId || ('unsaved-' + Date.now().toString(36))
  for (const group of groupLinesByProduct(lines, l => resolveExistingProduct(inventory, l))) {
    const { existing, name, cost, sell, cat, barcode, lines: groupLines } = group
    // A barcode entered on the line is saved onto a product that has none,
    // unless another product already uses it (validation blocks that).
    const owner = barcode ? findProductByBarcode(inventory, barcode) : null
    const newBarcode = barcode && !owner ? barcode : null
    let row = null
    try {
      if (existing) {
        // A changed selling price is an explicit repricing intent, honoured
        // only for roles allowed to edit prices (the same rule as Inventory).
        const updates = { cost_price: cost }
        if (canReprice && sell && sell !== Number(existing.price)) updates.price = sell
        if (newBarcode && !String(existing.barcode || '').trim()) updates.barcode = newBarcode
        row = (await products.update(existing.id, businessId, updates)) || { id: existing.id, ...updates }
        updated++
      } else {
        // Created empty, then received like any other line, so the units are
        // journalled as this purchase rather than as opening stock.
        const createdRow = await products.create(businessId, {
          name,
          category: cat,
          price: sell || Math.ceil(cost * NEW_PRODUCT_MARKUP),
          cost_price: cost,
          stock: 0,
          reorder_level: 5,
          list_on_carefind: true,
          ...(newBarcode ? { barcode: newBarcode } : {}),
        })
        row = Array.isArray(createdRow) ? createdRow[0] : createdRow
        if (!row?.id) throw new Error('the product could not be created')
        created++
      }
    } catch (e) {
      syncFailed.push(name)
      console.error('[purchases] inventory sync failed for:', name, e?.message)
      continue
    }
    let stock = null
    for (const line of groupLines) {
      try {
        const result = await products.receiveStock(businessId, row.id, line.qty, {
          movementType: 'purchase_receipt',
          idempotencyKey: 'purchase:' + keyBase + ':' + line.id,
          sourceType: 'purchase',
          sourceId: purchaseId || null,
          sourceLineId: line.id,
          reason: 'Purchase from ' + supplier,
          batchNumber: line.batch,
          expiryDate: line.expiry,
          dateReceived: supplyDate,
          supplier,
        })
        if (result?.stock != null) stock = result.stock
      } catch (e) {
        syncFailed.push(name + (e?.code ? ' (' + e.message + ')' : ''))
        console.error('[purchases] stock receipt failed for:', name, e?.message)
      }
    }
    changedRows.push({ ...row, ...(stock != null ? { stock } : {}) })
  }

  // A balance raises a "We owe" debt. The purchase already exists, so a failure
  // here is reported (the debt can be added in Debts) rather than thrown.
  let debtFailed = false
  if (balance > 0) {
    try {
      await debts.recordUnderpayment({
        businessId,
        direction: 'we_owe',
        partyName: supplier,
        amount: total,
        amountPaid: paid,
        dueDate: form.dueDate || '',
        description: 'Purchase: ' + (productNames[0] || 'Stock') + (productNames.length > 1 ? ' +' + (productNames.length - 1) + ' more' : '') + ': Due: ' + (form.dueDate || 'Not set'),
        source: 'purchase',
        sourceRef: purchaseId,
      })
    } catch (e) {
      debtFailed = true
      console.error('[purchases] debt for the balance could not be recorded:', purchaseId, e?.message)
    }
  }

  return {
    purchaseId, total, paid, balance, created, updated, syncFailed, changedRows, debtFailed,
    newProductsAutoPriced: created > 0 && !lines.some(i => !i.productId && Number(i.sell) > 0),
  }
}
