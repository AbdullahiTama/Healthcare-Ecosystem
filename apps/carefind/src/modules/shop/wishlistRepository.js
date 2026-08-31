// Wishlist — localStorage + React context, anonymous-friendly, premium standard
const KEY = 'carefind_wishlist'
export function createWishlistRepository() {
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
  function save(ids) { localStorage.setItem(KEY, JSON.stringify(ids)) }
  return {
    getAll() { return load() },
    has(id) { return load().includes(id) },
    toggle(id) { const cur = load(); const next = cur.includes(id) ? cur.filter(x=>x!==id) : [...cur, id]; save(next); return next },
    clear() { save([]); return [] }
  }
}
export const wishlistRepository = createWishlistRepository()
