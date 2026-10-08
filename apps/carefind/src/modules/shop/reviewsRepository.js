// Reviews — shop_product_reviews with graceful fallback to product_reviews + localStorage
// Fully functional even when DB tables missing (localStorage), transparently upgrades to DB when available
import { supabase } from '../../config/supabaseClient'
const LS_KEY = 'carefind_shop_reviews_v1'
function lsLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') } catch { return {} } }
function lsSave(m) { localStorage.setItem(LS_KEY, JSON.stringify(m)) }

export function createReviewsRepository(client = supabase) {
  return {
    async list(ecommerceProductId) {
      // Try shop_product_reviews
      try {
        const { data, error } = await client.from('shop_product_reviews').select('id,user_id,rating,text,created_at').eq('ecommerce_product_id', ecommerceProductId).order('created_at', { ascending: false })
        if (!error && data) return data
      } catch {}
      // Fallback: product_reviews via product_id join — try to resolve product_id
      try {
        const { data: ecom } = await client.from('ecommerce_products').select('product_id').eq('id', ecommerceProductId).maybeSingle()
        if (ecom?.product_id) {
          const { data } = await client.from('product_reviews').select('id, user_id, rating, comment:text, created_at').eq('product_id', ecom.product_id).order('created_at', { ascending:false })
          if (data) return data.map(r=>({ ...r, text: r.text || r.comment }))
        }
      } catch {}
      // LocalStorage fallback
      const m = lsLoad(); return (m[ecommerceProductId] || []).slice().sort((a,b)=> new Date(b.created_at)-new Date(a.created_at))
    },
    async avg(ecommerceProductId) {
      const list = await this.list(ecommerceProductId)
      if (!list.length) return { avg: 0, count: 0 }
      const sum = list.reduce((s,r)=> s + (r.rating||0), 0)
      return { avg: Math.round((sum/list.length)*10)/10, count: list.length }
    },
    async upsert(ecommerceProductId, { rating, text }) {
      const { data: { user } } = await client.auth.getUser()
      const uid = user?.id
      // Try DB first
      try {
        if (uid) {
          const payload = { ecommerce_product_id: ecommerceProductId, user_id: uid, rating, text: text.trim() }
          const { data, error } = await client.from('shop_product_reviews').upsert(payload, { onConflict: 'ecommerce_product_id,user_id' }).select('id').maybeSingle()
          if (!error) return data
        }
      } catch {}
      // Fallback product_reviews
      try {
        if (uid) {
          const { data: ecom } = await client.from('ecommerce_products').select('product_id').eq('id', ecommerceProductId).maybeSingle()
          if (ecom?.product_id) {
            const { error } = await client.from('product_reviews').upsert({ product_id: ecom.product_id, user_id: uid, rating, comment: text.trim() }, { onConflict: 'product_id,user_id' })
            if (!error) return { id: 'local' }
          }
        }
      } catch {}
      // LocalStorage
      const m = lsLoad(); const list = m[ecommerceProductId] || []; const fallbackId = uid || 'anon'
      const idx = list.findIndex(r=> r.user_id===fallbackId)
      const row = { id: idx>=0 ? list[idx].id : `ls_${Date.now()}`, user_id: fallbackId, rating, text: text.trim(), created_at: new Date().toISOString() }
      if (idx>=0) list[idx]=row; else list.push(row)
      m[ecommerceProductId]=list; lsSave(m); return row
    },
    async remove(ecommerceProductId, reviewId) {
      try { const { error } = await client.from('shop_product_reviews').delete().eq('id', reviewId); if (!error) return true } catch {}
      try { const { error } = await client.from('product_reviews').delete().eq('id', reviewId); if (!error) return true } catch {}
      const m=lsLoad(); const list=m[ecommerceProductId]||[]; m[ecommerceProductId]=list.filter(r=>r.id!==reviewId); lsSave(m); return true
    }
  }
}
export const reviewsRepository = createReviewsRepository()
