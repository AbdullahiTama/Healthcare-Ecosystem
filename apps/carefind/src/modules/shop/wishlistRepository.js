// Wishlist — localStorage (instant, anon) + shop_wishlist DB sync when logged-in (survives devices)
import { supabase } from '../../config/supabaseClient'
const KEY = 'carefind_wishlist'
export function createWishlistRepository(client = supabase) {
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
  function save(ids) { localStorage.setItem(KEY, JSON.stringify(ids)) }
  async function syncToDb(ids) {
    try {
      const { data: { user } } = await client.auth.getUser()
      if (!user) return
      // Upsert: clear then re-insert current set (idempotent)
      await client.from('shop_wishlist').delete().eq('user_id', user.id)
      if (ids.length) {
        const rows = ids.map(eid => ({ user_id: user.id, ecommerce_product_id: eid }))
        await client.from('shop_wishlist').insert(rows)
      }
    } catch {}
  }
  async function loadFromDb() {
    try {
      const { data: { user } } = await client.auth.getUser()
      if (!user) return null
      const { data } = await client.from('shop_wishlist').select('ecommerce_product_id').eq('user_id', user.id)
      if (data) return data.map(r=> r.ecommerce_product_id)
    } catch {}
    return null
  }
  return {
    getAll() { return load() },
    async getAllAsync() {
      const db = await loadFromDb()
      if (db) { save(db); return db }
      return load()
    },
    has(id) { return load().includes(id) },
    toggle(id) { const cur = load(); const next = cur.includes(id) ? cur.filter(x=>x!==id) : [...cur, id]; save(next); syncToDb(next); return next },
    async toggleAsync(id) { const next = this.toggle(id); return next },
    clear() { save([]); syncToDb([]); return [] }
  }
}
export const wishlistRepository = createWishlistRepository()
