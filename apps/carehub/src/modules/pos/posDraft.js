// The sale being rung up at the till, as one value that survives leaving the
// POS page.
//
// Why: the cart lived only in React state, so it was gone whenever the POS
// unmounted — moving to another screen (the app's routes remount on every
// navigation), the app reloading itself onto a new build at the next change of
// screen (BuildUpdateWatcher), or a phone's browser discarding the backgrounded
// tab while the cashier checked Wi-Fi or Bluetooth settings. POS.jsx keeps
// this value with hooks/usePersistentDraft, scoped to the location and the
// staff member, so it is restored exactly as it was.
//
// What it holds: everything typed for the sale that is not yet recorded —
// the cart, the customer, discount, payment inputs, the hold note, and which
// held sale is open for editing (so a restored edit is saved back onto THAT
// held sale, never held again as a second copy). Nothing here is money that
// changed hands: a sale exists only once it is charged and recorded.
//
// Kept small on purpose: the picked customer is stored as id and name only
// (no phone or other details), and the held sale as id, number and note.

export function blankPosDraft() {
  return {
    cart: [],
    client: 'Walk-in',
    pickedClient: null,
    method: 'Cash',
    cash: '',
    disc: '',
    discPct: false,
    splitAmounts: { Cash: '', Transfer: '', POS: '' },
    creditAmountPaid: '',
    creditMethod: 'Cash',
    holdNote: '',
    resumedSale: null,
  }
}

// Nothing worth keeping: no products and no held sale open. A typed customer
// name or cash amount alone is not a sale in progress.
export function isPosDraftEmpty(d) {
  return !d || ((!Array.isArray(d.cart) || d.cart.length === 0) && !d.resumedSale)
}

// The held sale open in the cart, reduced to what the till uses.
export function heldSaleRef(sale) {
  if (!sale || sale.id == null) return null
  return { id: sale.id, txn_no: sale.txn_no || '', notes: sale.notes || '' }
}

// The picked customer, reduced to what the till uses.
export function customerRef(c) {
  if (!c || c.id == null) return null
  return { id: c.id, full_name: c.full_name || '' }
}

const PAYMENT_METHODS = ['Cash', 'Transfer', 'POS', 'Split', 'Credit']
const DEPOSIT_METHODS = ['Cash', 'Transfer', 'POS']
const str = (v, fallback = '') => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback)

// A cart line is usable only with a product id, a whole quantity of at least
// one and a price that is a non-negative number. Anything else (a draft
// written by an older version, edited by hand, or cut short by a full storage
// quota) is dropped rather than shown as a line that would break the totals.
function cleanLine(line) {
  if (!line || typeof line !== 'object' || line.id == null) return null
  const qty = Number(line.qty)
  const price = Number(line.price)
  if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(price) || price < 0) return null
  return { ...line, qty, price }
}

// Whatever came back from storage, as a draft the page can render. Unknown or
// malformed fields fall back to the blank value field by field, so one bad
// field never costs the cashier the whole cart.
export function normalizePosDraft(value) {
  const blank = blankPosDraft()
  if (!value || typeof value !== 'object') return blank
  const split = value.splitAmounts && typeof value.splitAmounts === 'object' ? value.splitAmounts : {}
  return {
    cart: Array.isArray(value.cart) ? value.cart.map(cleanLine).filter(Boolean) : [],
    client: str(value.client, blank.client),
    pickedClient: customerRef(value.pickedClient),
    method: PAYMENT_METHODS.includes(value.method) ? value.method : blank.method,
    cash: str(value.cash),
    disc: str(value.disc),
    discPct: value.discPct === true,
    splitAmounts: { Cash: str(split.Cash), Transfer: str(split.Transfer), POS: str(split.POS) },
    creditAmountPaid: str(value.creditAmountPaid),
    creditMethod: DEPOSIT_METHODS.includes(value.creditMethod) ? value.creditMethod : blank.creditMethod,
    holdNote: str(value.holdNote),
    resumedSale: heldSaleRef(value.resumedSale),
  }
}

// The storage key: one draft per location (each location is its own business
// row with its own products) and per staff member, so on a shared till one
// person's unfinished sale is never shown to, or charged by, someone else.
// Owners have no staff row, hence 'owner'. null (no business yet) keeps the
// draft in memory only.
export function posDraftKey(businessId, staffId) {
  return businessId ? 'pos_' + businessId + '_' + (staffId || 'owner') : null
}
