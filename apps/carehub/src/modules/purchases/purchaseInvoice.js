// A purchase as a supplier invoice: its lines, quantities and prices.
//
// Purchases saved since carehub_20261213 keep their lines in `items`. Older
// purchases kept only the product names joined together, the total quantity
// and the average unit cost, so their invoice is shown as one summary line.

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// The lines as Purchases.jsx saves them (one per item entered on the form).
// `id` is the line's stock-receipt key and `product_id` the product it stocks,
// so an edit can find exactly what each line added (carehub_20261229).
export function purchaseItemsFromForm(validItems) {
  return (validItems || []).map((i) => isAmountOnly(i) ? {
    // Recorded without a quantity (upload): its amount counts, it adds no stock (carehub_20270131).
    id: i.id || null,
    product_id: i.productId || null,
    name: String(i.name || '').trim(),
    qty: null,
    cost: null,
    amount: Math.round(num(i.amount) * 100) / 100,
    no_qty: true,
    sell: null,
    wholesale: null,
    batch: i.batch ? String(i.batch).trim() : null,
    expiry: i.expiry || null,
    barcode: String(i.barcode || '').trim() || null,
    cat: i.cat || null,
  } : ({
    id: i.id || null,
    product_id: i.productId || null,
    name: String(i.name || '').trim(),
    qty: num(i.qty),
    cost: num(i.cost),
    sell: num(i.sell) > 0 ? num(i.sell) : null,
    wholesale: num(i.wholesale) > 0 ? num(i.wholesale) : null,
    batch: i.batch ? String(i.batch).trim() : null,
    expiry: i.expiry || null,
    barcode: String(i.barcode || '').trim() || null,
    cat: i.cat || null,
  }))
}

// An amount-only line that is still without a quantity (entering one makes it a normal line again).
export const isAmountOnly = (i) => !!i?.noQty && !String(i.qty ?? '').trim()

// The edit form from a purchase and get_purchase_for_edit's lines. The amount
// paid is a string like every other field; dates are trimmed to 'YYYY-MM-DD'.
export function formFromPurchase(purchase, editItems) {
  const day = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : '')
  const str = (v) => (v == null || v === '' ? '' : String(v))
  return {
    supplier: String(purchase?.supplier_name || '').trim(),
    supplyDate: day(purchase?.supply_date) || day(purchase?.created_at),
    dueDate: day(purchase?.due_date),
    amountPaid: str(Number(purchase?.amount_paid) || 0),
    notes: purchase?.notes || '',
    items: (editItems || []).map((e) => ({
      id: e.id,
      productId: e.product_id || null,
      name: e.name || '',
      qty: e.no_qty ? '' : str(e.qty),
      cost: e.no_qty ? '' : str(e.cost),
      ...(e.no_qty ? { noQty: true, amount: str(e.amount) } : {}),
      sell: Number(e.sell) > 0 ? String(e.sell) : '',
      wholesale: Number(e.wholesale) > 0 ? String(e.wholesale) : '',
      batch: e.batch || '',
      expiry: day(e.expiry),
      barcode: e.barcode || '',
      cat: e.cat || 'Medicines',
    })),
  }
}

// What edit_purchase takes for each line. Blank lines are the caller's to drop.
export function editItemsFromForm(items) {
  return (items || []).map((i) => isAmountOnly(i) ? {
    id: i.id,
    product_id: i.productId || null,
    name: String(i.name || '').trim(),
    qty: null,
    cost: null,
    amount: Number(i.amount),
    no_qty: true,
    batch: String(i.batch || '').trim() || null,
    expiry: i.expiry || null,
    barcode: String(i.barcode || '').trim() || null,
    cat: i.cat || null,
  } : ({
    id: i.id,
    product_id: i.productId || null,
    name: String(i.name || '').trim(),
    qty: Number(i.qty),
    cost: Number(i.cost),
    sell: Number(i.sell) > 0 ? Number(i.sell) : null,
    batch: String(i.batch || '').trim() || null,
    expiry: i.expiry || null,
    barcode: String(i.barcode || '').trim() || null,
    cat: i.cat || null,
  }))
}

// { lines: [{ name, qty, cost, total, sell, wholesale, batch, expiry }], itemised }. `sell` is the retail price.
// itemised is false for an older purchase shown from its summary columns.
export function purchaseLines(purchase) {
  let items = purchase?.items
  if (typeof items === 'string') {
    try { items = JSON.parse(items) } catch { items = null }
  }
  // One line flagged `summary` is a purchase recorded before line items were
  // kept, which an edit has rewritten into items: still a summary.
  const isSummary = Array.isArray(items) && items.length === 1 && items[0]?.summary === true
  if (Array.isArray(items) && items.length > 0 && !isSummary) {
    return {
      itemised: true,
      lines: items.map((i) => ({
        name: i.name || 'Item',
        // An amount-only line has no quantity or unit cost (null), only its amount.
        qty: i.no_qty ? null : num(i.qty),
        cost: i.no_qty ? null : num(i.cost),
        total: i.no_qty ? Math.round(num(i.amount) * 100) / 100 : Math.round(num(i.qty) * num(i.cost) * 100) / 100,
        noQty: !!i.no_qty,
        sell: i.sell != null && num(i.sell) > 0 ? num(i.sell) : null,
        wholesale: i.wholesale != null && num(i.wholesale) > 0 ? num(i.wholesale) : null,
        batch: i.batch || null,
        expiry: i.expiry || null,
        barcode: i.barcode || null,
        cat: i.cat || null,
      })),
    }
  }
  if (isSummary) {
    const i = items[0]
    return { itemised: false, lines: [{ name: i.name || 'Items not recorded', qty: num(i.qty), cost: num(i.cost), total: num(purchase?.total_cost), sell: null, batch: i.batch || null, expiry: i.expiry || null, barcode: null }] }
  }
  return {
    itemised: false,
    lines: [{
      name: purchase?.product_name || 'Items not recorded',
      qty: num(purchase?.quantity),
      cost: num(purchase?.cost_price),
      total: num(purchase?.total_cost),
      sell: null,
      batch: purchase?.batch || null,
      expiry: purchase?.expiry || null,
    }],
  }
}
