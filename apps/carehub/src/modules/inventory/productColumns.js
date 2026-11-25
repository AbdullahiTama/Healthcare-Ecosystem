// How CareHub reads products without ever asking the database for cost_price directly (CODE_AUDIT A25).
//
// products.cost_price is closed to the API roles (carehub_20270203_cost_price_column_guard): `select=*`, or a write
// that reads the whole row back, is refused. Every products read names its columns from PRODUCT_COLUMNS, and costs come
// from product_costs() (carehub_20270202_cost_price_access), which returns them only to the Owner and roles allowed to
// see costs (canViewCostPrice) and {} to everyone else. So for staff without the permission `cost_price` is simply
// absent from the rows: nothing on screen or in browser storage can show it.
//
// A column added to products must be added here AND granted to the API roles (see the migration header).

export const PRODUCT_COLUMNS = [
  'id', 'business_id', 'name', 'generic_name', 'category', 'price', 'wholesale_price', 'stock', 'emoji', 'list_on_carefind', 'created_at',
  'barcode', 'reorder_level', 'owner_id', 'description', 'image_url', 'whatsapp', 'sale_type', 'min_purchase',
  'price_unit', 'seller_location', 'sales_unit', 'shelf', 'expiry', 'batch', 'show_price', 'latitude', 'longitude',
  'expiry_date', 'shelf_label', 'is_quarantined', 'tracking_mode', 'master_product_id', 'rx_status', 'price_source',
  'updated_at',
].join(',')

// { id: cost } for this business's products (all, or `ids`), or {} when the person may not see costs. A failed read is
// logged and gives {}: the products still load, without costs, rather than not at all.
export async function fetchProductCosts(request, businessId, ids = null) {
  if (!businessId) return {}
  try {
    const out = await request('rpc/product_costs', {
      method: 'POST',
      body: JSON.stringify({ p_business_id: businessId, p_product_ids: ids && ids.length ? ids : null }),
    })
    const map = Array.isArray(out) ? out[0] : out
    return map && typeof map === 'object' ? map : {}
  } catch (e) {
    console.error('[products] cost prices could not be loaded:', e?.message || e)
    return {}
  }
}

// Rows with cost_price set from `costs` where the person may see it; other rows are returned unchanged (no key).
export function withCosts(rows, costs) {
  if (!Array.isArray(rows) || !costs || Object.keys(costs).length === 0) return rows
  return rows.map((r) => (r && costs[r.id] != null ? { ...r, cost_price: Number(costs[r.id]) } : r))
}

// A write that sent cost_price: the database stored it, but cannot read it back; put it on the returned row so the
// screen keeps what was just typed. `sent` is one body or, for a bulk create, the list in the same order.
export function withSentCost(rows, sent) {
  if (!Array.isArray(rows)) return rows
  return rows.map((r, i) => {
    const body = Array.isArray(sent) ? sent[i] : sent
    return r && body && body.cost_price !== undefined ? { ...r, cost_price: body.cost_price } : r
  })
}

// The offline copy of the catalogue (browser storage) is per business, not per person, so it never holds costs.
export function withoutCosts(rows) {
  if (!Array.isArray(rows)) return rows
  return rows.map((r) => {
    if (!r || !('cost_price' in r)) return r
    const { cost_price: _cost, ...rest } = r
    return rest
  })
}
