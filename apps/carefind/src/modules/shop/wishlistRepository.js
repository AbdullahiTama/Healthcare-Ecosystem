// Wishlist — localStorage (instant, anon) + shop_wishlist DB sync when logged-in (survives devices).
//
// localStorage is updated synchronously so the heart responds at once. The database mirror is written one product
// at a time (upsert / delete of that row, safe because shop_wishlist is keyed on user_id + ecommerce_product_id)
// and the writes run through a queue, so rapid toggles reach the database in the order they were made. The
// previous "delete everything, re-insert the current set" sync interleaved under rapid clicks: the second insert
// hit the primary key, failed silently and dropped products from the database.
import { supabase } from '../../config/supabaseClient'
const KEY = 'carefind_wishlist'
export function createWishlistRepository(client = supabase) {
  let queue = Promise.resolve()

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
  function save(ids) { localStorage.setItem(KEY, JSON.stringify(ids)) }

  // Run `task` after every earlier sync has finished. A failing task never breaks the queue or reaches the caller:
  // the local wishlist is already updated, so a failed sync is reported and the next sign-in hydration reconciles.
  function enqueue(label, task) {
    queue = queue.then(async () => {
      try {
        const { data: { user } } = await client.auth.getUser()
        if (!user) return
        const { error } = await task(user)
        if (error) console.warn(`[wishlist] ${label} failed:`, error.message)
      } catch (err) {
        console.warn(`[wishlist] ${label} failed:`, err?.message || err)
      }
    })
    return queue
  }

  async function loadFromDb() {
    try {
      const { data: { user } } = await client.auth.getUser()
      if (!user) return null
      const { data, error } = await client.from('shop_wishlist').select('ecommerce_product_id').eq('user_id', user.id)
      if (error) { console.warn('[wishlist] load failed:', error.message); return null }
      if (data) return data.map(r => r.ecommerce_product_id)
    } catch (err) {
      console.warn('[wishlist] load failed:', err?.message || err)
    }
    return null
  }

  return {
    getAll() { return load() },
    // Resolves once every queued database write has finished.
    flush() { return queue },
    async getAllAsync() {
      // Read the database only after this client's own pending writes landed, or the read can predate them.
      await queue
      const db = await loadFromDb()
      if (db) { save(db); return db }
      return load()
    },
    has(id) { return load().includes(id) },
    toggle(id) {
      const cur = load()
      const adding = !cur.includes(id)
      const next = adding ? [...cur, id] : cur.filter(x => x !== id)
      save(next)
      enqueue(adding ? 'add' : 'remove', (user) => adding
        ? client.from('shop_wishlist').upsert({ user_id: user.id, ecommerce_product_id: id }, { onConflict: 'user_id,ecommerce_product_id' })
        : client.from('shop_wishlist').delete().eq('user_id', user.id).eq('ecommerce_product_id', id))
      return next
    },
    async toggleAsync(id) { const next = this.toggle(id); return next },
    clear() {
      save([])
      enqueue('clear', (user) => client.from('shop_wishlist').delete().eq('user_id', user.id))
      return []
    },
  }
}
export const wishlistRepository = createWishlistRepository()
