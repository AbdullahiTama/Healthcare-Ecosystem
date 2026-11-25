// Retail and wholesale prices in the POS cart (docs/architecture/Wholesale-and-Retail-Prices.md). Pure, so the rules
// are pinned by priceTiers.test.js; POS.jsx only calls them.
//
// Each cart line carries `price_tier` ('retail' | 'wholesale'): the catalogue price it was charged at. The sale's
// price mode decides the tier of lines as they are added; a line whose product has both prices can be switched on its
// own. A product with one price is always sold at that price, whatever the mode. The tier travels in the sale's items
// JSON, so receipts and reports can say which price was charged; the database's price guard accepts either catalogue
// price (carehub_20270205_wholesale_retail_prices).

import { priceFor, hasBothPrices, wholesalePrice } from '../../lib/productPricing'

// A new cart line for `product`, priced for `mode`.
export function newCartLine(product, mode = 'retail') {
  const { tier, price } = priceFor(product, mode)
  return { ...product, qty: 1, price, price_tier: tier }
}

// The catalogue price a line stands for (its tier's price on the current product, else on the line itself): the
// baseline a one-off price override is compared with and falls back to.
export function catalogPriceOf(line, product) {
  return priceFor(product || line, line?.price_tier || 'retail').price
}

// Whether the line's price was typed over its catalogue price (a one-off override). Overridden lines are never
// repriced by a mode change.
export const isOverridden = (line, product) => Number(line?.price) !== catalogPriceOf(line, product)

// The line switched to `tier`, at that tier's catalogue price. Unchanged when the product does not have that price.
export function withTier(line, tier, product) {
  const p = product || line
  const next = priceFor(p, tier)
  if (next.tier !== tier) return line
  return { ...line, price: next.price, price_tier: tier }
}

// The cart after the sale's mode changes: lines whose product has both prices, and whose price was not typed over,
// move to the mode's price. `productById` is a Map of the current catalogue.
export function applyPriceMode(cart, mode, productById) {
  return (cart || []).map(line => {
    const product = productById?.get(line.id) || line
    if (!hasBothPrices(product) || line.price_tier === mode || isOverridden(line, product)) return line
    return withTier(line, mode, product)
  })
}

// Whether the retail / wholesale switch is worth showing: some product in the catalogue has a wholesale price.
export const catalogHasWholesale = (products) => (products || []).some(p => wholesalePrice(p) != null)
