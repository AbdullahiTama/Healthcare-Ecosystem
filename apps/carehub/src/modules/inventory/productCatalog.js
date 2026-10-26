// Loading the product catalog for a business: the one place that decides what
// the app shows when the server answers, fails, or cannot be reached.
//
// Every screen that sells or counts stock (Inventory, POS, stock validation,
// CareFind listings) works on the whole catalog in memory, so it is loaded once
// per business and shared from BusinessDashboard. This module holds the rules;
// hooks/useProductCatalog.js holds the React state around them.
//
// Rules:
//   * Server rows win. They are the truth and replace any saved copy.
//   * The saved offline copy (localStorage) is used only when the server could
//     not give a trustworthy answer: offline, a failed request, or an EMPTY
//     answer while a non-empty copy exists. The last case is how an expired
//     session shows up (sbFetch falls back to the anon key and row security
//     returns nothing, see Session-Expiry-and-Anon-Fallback.md); showing an empty
//     shop would be wrong, so the copy is shown and flagged as possibly out of
//     date. When the server answers empty and there is no copy, the business
//     genuinely has no products yet.
//   * Whenever the copy is shown instead of server rows, the result says so
//     (`stale: true` with a reason), so the screen can tell the user.

export const CATALOG_STALE_REASONS = {
  offline: 'offline',
  failed: 'failed',
  unconfirmed: 'unconfirmed',
}

export function catalogCacheKey(businessId) {
  return 'products_' + businessId
}

/**
 * @param {object}   deps
 * @param {string}   deps.businessId
 * @param {Function} deps.fetchAll   (businessId, { onProgress }) => Promise<rows[]>
 * @param {Function} deps.readCache  (key) => rows[] | null
 * @param {boolean}  [deps.online=true]
 * @param {Function} [deps.onProgress] (loadedSoFar) => void
 * @returns {Promise<{ products: object[], source: 'server'|'cache'|'none', stale: boolean, reason: string|null, error: Error|null }>}
 */
export async function loadProductCatalog({ businessId, fetchAll, readCache, online = true, onProgress }) {
  // Read lazily: the copy can be megabytes of JSON, and a normal successful
  // load never needs it.
  let copy
  const savedCopy = () => {
    if (copy === undefined) {
      const cached = safeRead(readCache, catalogCacheKey(businessId))
      copy = Array.isArray(cached) && cached.length > 0 ? cached : null
    }
    return copy
  }

  if (!online) {
    const cached = savedCopy()
    if (cached) return { products: cached, source: 'cache', stale: true, reason: CATALOG_STALE_REASONS.offline, error: null }
    return { products: [], source: 'none', stale: false, reason: CATALOG_STALE_REASONS.offline, error: new Error('You are offline and there is no saved copy of your products on this device.') }
  }

  let rows
  try {
    rows = await fetchAll(businessId, { onProgress })
  } catch (error) {
    const cached = savedCopy()
    if (cached) return { products: cached, source: 'cache', stale: true, reason: CATALOG_STALE_REASONS.failed, error }
    return { products: [], source: 'none', stale: false, reason: CATALOG_STALE_REASONS.failed, error }
  }

  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0 && savedCopy()) {
    return { products: savedCopy(), source: 'cache', stale: true, reason: CATALOG_STALE_REASONS.unconfirmed, error: null }
  }
  return { products: list, source: 'server', stale: false, reason: null, error: null }
}

function safeRead(readCache, key) {
  try { return readCache(key) } catch { return null }
}
