// Inventory summary maths — the single definition of every figure the
// Inventory KPI row shows. Previously these were five separate filter/reduce
// passes inlined in Inventory.jsx (and duplicated in hooks/useInventory.js);
// keeping them here makes the money figures unit-testable and means the
// profit/margin rules live in one place.
//
// Services are excluded from all stock money: they carry a sentinel stock of
// 999 and no cost price, so counting them would make stock value meaningless.
// This matches how the rest of the module treats them.

export const isStockItem = (p) => (p.cat || p.category) !== 'Services'

export function computeInventoryStats(products = []) {
  const lowStock = []
  const outOfStock = []
  let stockValue = 0
  let costValue = 0
  let missingCost = 0
  let onCareFind = 0

  for (const p of products) {
    if (p.list_on_carefind !== false && p.stock > 0) onCareFind++
    if (!isStockItem(p)) continue

    const stock = p.stock || 0
    if (stock <= 0) {
      outOfStock.push(p)
    } else {
      if (stock <= (p.reorder_level || 5)) lowStock.push(p)
      // A product held in stock with no cost price contributes its full
      // selling value to profit, which overstates it — surface the count so
      // the owner knows the figure is optimistic rather than wrong.
      if (!(p.cost_price > 0)) missingCost++
    }

    stockValue += (p.price || 0) * stock
    costValue += (p.cost_price || 0) * stock
  }

  // Profit is the margin still to be earned on stock currently on the shelf,
  // not realised profit — that comes from sales (see the Reports module).
  const profit = stockValue - costValue
  // Margin is expressed against selling value (the same basis as the per-product
  // margin column), so it stays comparable row-to-row. Undefined with no stock.
  const margin = stockValue > 0 ? (profit / stockValue) * 100 : null

  return { lowStock, outOfStock, stockValue, costValue, profit, margin, missingCost, onCareFind }
}
