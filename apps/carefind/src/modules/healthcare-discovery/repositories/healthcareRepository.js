import { supabase } from '../../../config/supabaseClient'

export function createHealthcareRepository({ client = supabase } = {}) {
  return {
    async searchProductsByName(decodedName) {
      const { data, error } = await client
        .from('products')
        .select('id, name, generic_name, price, show_price, stock, emoji, image_url, description, whatsapp, sale_type, price_unit, min_purchase, seller_location, latitude, longitude, owner_id, business_id, businesses(id, name, city, state, whatsapp, visible_on_carefind, latitude, longitude, lat, lng, phone, show_prices)')
        .ilike('name', `%${decodedName}%`)
        .eq('list_on_carefind', true)
      if (error) throw error
      return data || []
    },

    async getReviewsByProductIds(productIds) {
      const { data, error } = await client
        .from('product_reviews')
        .select('id, rating, comment, created_at, product_id, user_id')
        .in('product_id', productIds)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getProfilesByIds(userIds) {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, display_name, is_verified, specialty, verification_label')
        .in('id', userIds)
      if (error) throw error
      return data || []
    },

    async insertProductReview(payload) {
      const { error } = await client.from('product_reviews').insert(payload)
      if (error) throw error
    },

    async getFeaturedPromotions() {
      const { data, error } = await client
        .from('promotions')
        .select('id, title, image_url, link_url, expires_at')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data || []
    },

    async getFeaturedProducts() {
      const { data, error } = await client
        .from('products')
        .select('id, name, emoji, price, show_price, latitude, longitude, business_id, list_on_carefind, businesses(name, latitude, longitude, lat, lng, show_prices)')
        .order('created_at', { ascending: false })
        .limit(14)
      if (error) throw error
      return data || []
    },

    buildBusinessesQuery(q, stateFilter) {
      let bq = client
        .from('businesses')
        .select('id, name, business_type, city, state, cover_url, booking_enabled, latitude, longitude, lat, lng')
        .eq('visible_on_carefind', true)
        .eq('status', 'active')
      if (q) bq = bq.or(`name.ilike.%${q}%,business_type.ilike.%${q}%,city.ilike.%${q}%,state.ilike.%${q}%`)
      if (stateFilter) bq = bq.ilike('state', `%${stateFilter}%`)
      return bq
    },

    async searchProducts(q, saleType) {
      let pq = client
        .from('products')
        .select('id, name, emoji, price, show_price, category, generic_name, whatsapp, image_url, sale_type, price_unit, min_purchase, seller_location, latitude, longitude, business_id, owner_id, list_on_carefind, created_at, businesses(name, city, state, whatsapp, phone, latitude, longitude, lat, lng, show_prices)')
      if (q) pq = pq.or(`name.ilike.%${q}%,generic_name.ilike.%${q}%,category.ilike.%${q}%`)
      if (saleType && saleType !== 'all') pq = pq.eq('sale_type', saleType)
      pq = pq.order('created_at', { ascending: false }).limit(100)
      const { data, error } = await pq
      if (error) throw error
      return data || []
    },

    async searchVerifiedProfiles(q, specialtyFilter, stateFilter) {
      let pf = client
        .from('profiles')
        .select('id, full_name, display_name, verification_label, specialty, location, is_verified, avatar_url')
        .eq('is_verified', true)
      if (q) pf = pf.or(`full_name.ilike.%${q}%,display_name.ilike.%${q}%`)
      if (specialtyFilter.trim()) pf = pf.ilike('specialty', `%${specialtyFilter}%`)
      if (stateFilter) pf = pf.ilike('location', `%${stateFilter}%`)
      const { data, error } = await pf.limit(40)
      if (error) throw error
      return data || []
    },

    async getActiveStoriesByUsers(userIds) {
      const { data, error } = await client
        .from('stories')
        .select('id, user_id, expires_at')
        .in('user_id', userIds)
        .gt('expires_at', new Date().toISOString())
      if (error) throw error
      return data || []
    },

    async getStoriesByUser(userId) {
      const { data, error } = await client
        .from('stories')
        .select('id, title, body, image_url, bg_color, created_at, user_id, view_count, is_platform, expires_at')
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async logSearch(payload) {
      const { error } = await client.from('search_logs').insert(payload)
      if (error) throw error
    },
  }
}

export const healthcareRepository = createHealthcareRepository()
