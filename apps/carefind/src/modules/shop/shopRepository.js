import { supabase } from '../../config/supabaseClient'

// Public Shop repository — reads Active ecommerce_products + products + ordered images
// Uses anon supabase client (public read RLS: is_active=true for services, status=Active for ecommerce)
export function createShopRepository(client = supabase) {
  return {
    async getActiveProducts({ segment, query, limit = 50 } = {}) {
      // segment filter is applied client-side after fetch for now (category vs segment mapping TBD)
      // Fetch Active ecommerce_products with joined product and business check
      const { data, error } = await client
        .from('ecommerce_products')
        .select('id,business_id,product_id,status,description,category,ecommerce_price_kobo,active_at, products(id,name,generic_name,price,stock,cat,category,price_unit,sale_type,emoji,image_url)')
        .eq('status', 'Active')
        .order('active_at', { ascending: false })
        .limit(limit)
      if (error) {
        // Table not yet migrated or RLS — return empty for graceful empty state
        if (String(error.message).includes('ecommerce_products') || String(error.code) === 'PGRST205') return []
        throw error
      }
      let rows = data || []
      // Filter out-of-stock and restricted (stock is in joined products)
      rows = rows.filter(r => {
        const p = r.products
        if (!p) return false
        if ((p.stock ?? 0) <= 0) return false
        return true
      })
      // Segment filter: if provided, filter by category or sale_type
      if (segment && segment !== 'all') {
        const seg = String(segment).toLowerCase()
        rows = rows.filter(r => {
          const cat = String(r.category || r.products?.category || r.products?.cat || '').toLowerCase()
          const saleType = String(r.products?.sale_type || '').toLowerCase()
          if (seg === 'retail') return cat.includes('medicine') || saleType === 'retail' || !cat
          if (seg === 'wholesale') return saleType === 'wholesale' || cat.includes('wholesale')
          if (seg === 'distributor') return saleType === 'distributor' || cat.includes('distributor')
          return true
        })
      }
      if (query) {
        const q = String(query).toLowerCase()
        rows = rows.filter(r => {
          const p = r.products
          return String(p.name).toLowerCase().includes(q) || String(p.generic_name || '').toLowerCase().includes(q) || String(r.category || '').toLowerCase().includes(q)
        })
      }
      return rows
    },

    async getProductDetail(productId) {
      // productId is ecommerce_products.id
      const { data, error } = await client
        .from('ecommerce_products')
        .select('id,business_id,product_id,status,description,category,ecommerce_price_kobo,attributes,active_at, products(id,name,generic_name,price,stock,cat,category,price_unit,sale_type,emoji,image_url,description)')
        .eq('id', productId)
        .eq('status', 'Active')
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      if ((data.products?.stock ?? 0) <= 0) return null
      // Fetch ordered images
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
