// Whether a product's price may be shown on CareFind. Dependency-free so the screens (via modules/utils/marketplace.js)
// and the server-rendered pages for search engines (src/lib/seo) apply exactly the same rule.

// Prescription-only and controlled medicines are never priced or sold on
// CareFind: they show as available, and the buyer asks the pharmacist. The
// database (carefind_products) already sends them without a price; this keeps
// the screens consistent even if a price ever arrives.
export function isRxRestricted(product) {
  return !!product && (product.rx_restricted === true
    || product.rx_status === 'prescription_only' || product.rx_status === 'controlled')
}

// A product shows its price only when it is not a prescription medicine, the
// seller has not turned the per-product price-visibility toggle off
// (show_price defaults to true), the owning business has not hidden all its
// prices on CareFind (show_prices defaults to true), and a price actually
// exists. Everything else renders noPriceLabel().
export function canShowPrice(product) {
  return product
    && !isRxRestricted(product)
    && product.show_price !== false
    && product.businesses?.show_prices !== false
    && product.price != null
}

// What a product shows in place of a price.
export function noPriceLabel(product) {
  return isRxRestricted(product) ? 'Available: ask the pharmacist' : 'Ask for price'
}
