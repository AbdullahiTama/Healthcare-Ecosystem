import { supabase } from '../../config/supabaseClient'

// Public Shop repository — reads Active ecommerce_products + products + ordered images
// Uses anon supabase client (RLS public read: status=Active + approved vendor + in-stock + not restricted)
export function createShopRepository(client = supabase) {
  return {
    async getActiveProducts({ segment, query, limit = 50 } = {}) {
      const { data, error } = await client
        .from('ecommerce_products')
        .select('id,business_id,product_id,status,description,category,ecommerce_price_kobo,active_at,prescription_required,warnings,restrictions,is_restricted, products(id,name,generic_name,price,stock,category,price_unit,sale_type,emoji,image_url)')
        .eq('status', 'Active')
        .eq('is_restricted', false)
        .order('active_at', { ascending: false })
        .limit(limit)
      if (error) {
        if (String(error.message).includes('ecommerce_products') || String(error.code) === 'PGRST205') return []
        throw error
      }
      let rows = data || []
      // RLS already enforces Approved vendor + stock>0, but keep defensive client filter for stale data
      rows = rows.filter(r => {
        const p = r.products
        if (!p) return false
        if (r.is_restricted) return false
        if ((p.stock ?? 0) <= 0) return false
        return true
      })
      // Segment filter — server-accurate by sale_type; retail is default for untagged legacy rows
      if (segment && segment !== 'all') {
        const seg = String(segment).toLowerCase()
        rows = rows.filter(r => {
          const saleType = String(r.products?.sale_type || '').toLowerCase()
          // If product has no sale_type, treat as retail (Spec B25: Retail = single pieces)
          if (!saleType) return seg === 'retail'
          return saleType === seg
        })
      }
      if (query) {
        const q = String(query).toLowerCase()
        rows = rows.filter(r => {
          const p = r.products
          return String(p.name).toLowerCase().includes(q) || String(p.generic_name || '').toLowerCase().includes(q) || String(r.category || '').toLowerCase().includes(q)
        })
      }
      // Attach primary ecommerce image per product for catalog thumbnails (Spec A4.3/A5.3)
      // Batch fetch first image per ecommerce_product_id
      try {
        if (rows.length > 0) {
          const ids = rows.map(r => r.id)
          const { data: imgs } = await client
            .from('ecommerce_product_images')
            .select('ecommerce_product_id,url,position')
            .in('ecommerce_product_id', ids)
            .order('position', { ascending: true })
          const firstByEcom = new Map()
          ;(imgs || []).forEach(img => {
            if (!firstByEcom.has(img.ecommerce_product_id)) firstByEcom.set(img.ecommerce_product_id, img.url)
          })
          rows = rows.map(r => ({ ...r, primary_image_url: firstByEcom.get(r.id) || null }))
        }
      } catch {}
      return rows
    },

    async getProductDetail(productId) {
      const { data, error } = await client
        .from('ecommerce_products')
        .select('id,business_id,product_id,status,description,category,ecommerce_price_kobo,attributes,active_at,prescription_required,warnings,restrictions,is_restricted, products(id,name,generic_name,price,stock,category,price_unit,sale_type,emoji,image_url,description)')
        .eq('id', productId)
        .eq('status', 'Active')
        .eq('is_restricted', false)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      if (data.is_restricted) return null
      if ((data.products?.stock ?? 0) <= 0) return null
      const { data: images, error: imgErr } = await client
        .from('ecommerce_product_images')
        .select('id,url,position')
        .eq('ecommerce_product_id', productId)
        .order('position', { ascending: true })
      if (imgErr) throw imgErr
      return { ...data, images: images || [] }
    },

    async getProductImages(ecommerceProductId) {
      const { data, error } = await client
        .from('ecommerce_product_images')
        .select('id,url,position')
        .eq('ecommerce_product_id', ecommerceProductId)
        .order('position', { ascending: true })
      if (error) {
        if (String(error.message).includes('ecommerce_product_images')) return []
        throw error
      }
      return data || []
    }
  }
}

export const shopRepository = createShopRepository()
