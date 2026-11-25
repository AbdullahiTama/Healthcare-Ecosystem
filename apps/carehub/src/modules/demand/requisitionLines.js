// Requisition lines (Demand › Requisitions): which lines are saved, what they cost, and what is shown when no cost
// was entered. Pure, so the rules are pinned by requisitionLines.test.js.
//
// The unit cost is optional (pharmacy feedback, 2026-11-25): a requisition often goes to the supplier before the
// price is known. A line needs only a product name. A cost that is entered must be a number of 0 or more; a blank
// cost is saved as no cost (create_requisition stores null for ''), counts nothing in the total and prints as "Not set".

import { parseOptionalPrice } from '../../lib/productPricing'

export const NO_COST = 'Not set'

// The unit cost of a line: a number, null when not entered, NaN when it is not a number.
export const lineCost = (line) => parseOptionalPrice(line?.cost)

// Lines with a product name: the ones saved.
export const savedLines = (items) => (items || []).filter(i => String(i?.product_name || '').trim())

// Names of the lines whose cost is not a number (the save is refused until fixed).
export const badCostLines = (items) => savedLines(items).filter(i => Number.isNaN(lineCost(i))).map(i => String(i.product_name).trim())

// What a line costs in all (quantity x unit cost), or null when it has no cost.
export function lineTotal(line, parseQty) {
  const c = lineCost(line)
  return c == null || Number.isNaN(c) ? null : parseQty(line.quantity) * c
}

// The total of the lines that have a cost, and how many lines have none.
export function requisitionTotal(items, parseQty) {
  let total = 0
  let missing = 0
  for (const i of savedLines(items)) {
    const t = lineTotal(i, parseQty)
    if (t == null) missing++
    else total += t
  }
  return { total, missing }
}

// The line as create_requisition takes it: the cost a number, or '' when none (stored as null).
export function toSavedLine(i) {
  const c = lineCost(i)
  return { product_name: String(i.product_name).trim(), quantity: i.quantity || '', cost: c == null || Number.isNaN(c) ? '' : c, unit: i.unit || 'unit' }
}
