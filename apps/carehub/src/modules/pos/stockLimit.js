// Stock limits at the POS: a cart line can never ask for more units than the product has on hand.
//
// Pure functions over the catalogue the till already holds (`products`, refreshed after every sale). The database
// deliberately never refuses a till sale for stock (carehub_20261224_sale_stock_ledger: "a sale is never lost", an
// offline sale must sync), and records a shortfall as "short by N" instead; so the till is where overselling is
// stopped. See docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md §1.

const isService = (p) => (p?.cat || p?.category) === 'Services'

// Units that can be sold now: services are not stocked (no limit); a negative stock (from before the ledger's floor)
// means none. Returns Infinity for "no limit".
export function availableStock(product) {
  if (!product || isService(product)) return Infinity
  const n = Math.floor(Number(product.stock))
  return Number.isFinite(n) ? Math.max(n, 0) : 0
}

// The quantity a line may have when `requested` units are asked for:
//   { qty, available, limited }  qty = min(requested, available); limited = the request was cut down.
// A request of 0 or less stays as asked (the caller removes the line).
export function limitQty(product, requested) {
  const want = Math.floor(Number(requested) || 0)
  const available = availableStock(product)
  if (want <= 0 || want <= available) return { qty: want, available, limited: false }
  return { qty: available, available, limited: true }
}

// Lines in the cart that ask for more than is on hand now (stock can fall after a line was added: another till sold
// it, or a held sale was resumed). The current stock is read from the catalogue, never from the copy stored on the
// line when it was added. Returns [{ id, name, qty, available }].
export function cartStockProblems(cart, productById) {
  const problems = []
  for (const line of cart || []) {
    const product = productById?.get(line.id) || line
    const available = availableStock(product)
    if (Number(line.qty) > available) problems.push({ id: line.id, name: line.name || product.name, qty: Number(line.qty), available })
  }
  return problems
}

// The message for a request that was cut down (or refused when nothing is left).
export function stockLimitMessage(name, available, requested) {
  if (available <= 0) return `${name} is out of stock.`
  const asked = requested != null ? ` You asked for ${requested}, so the quantity is set to ${available}.` : ` The sale already has all ${available}.`
  return `Only ${available} ${name} in stock.${asked}`
}

// The message for a cart that cannot be charged as it is.
export function cartStockMessage(problems) {
  if (!problems.length) return ''
  const list = problems.map((p) => `${p.name} (${p.qty} in sale, ${p.available} in stock)`).join('; ')
  return `Not enough stock for ${problems.length === 1 ? 'this item' : 'these items'}: ${list}. Reduce the quantity before charging.`
}
