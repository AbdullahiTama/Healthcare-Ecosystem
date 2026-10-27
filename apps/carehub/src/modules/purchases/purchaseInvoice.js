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
export function purchaseItemsFromForm(validItems) {
  return (validItems || []).map((i) => ({
    name: String(i.name || '').trim(),
    qty: num(i.qty),
    cost: num(i.cost),
    sell: num(i.sell) > 0 ? num(i.sell) : null,
    batch: i.batch ? String(i.batch).trim() : null,
    expiry: i.expiry || null,
    cat: i.cat || null,
  }))
}

// { lines: [{ name, qty, cost, total, sell, batch, expiry }], itemised }.
// itemised is false for an older purchase shown from its summary columns.
export function purchaseLines(purchase) {
  let items = purchase?.items
  if (typeof items === 'string') {
    try { items = JSON.parse(items) } catch { items = null }
  }
  if (Array.isArray(items) && items.length > 0) {
    return {
      itemised: true,
      lines: items.map((i) => ({
        name: i.name || 'Item',
        qty: num(i.qty),
        cost: num(i.cost),
        total: Math.round(num(i.qty) * num(i.cost) * 100) / 100,
        sell: i.sell != null && num(i.sell) > 0 ? num(i.sell) : null,
        batch: i.batch || null,
        expiry: i.expiry || null,
      })),
    }
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
