import { supabase } from '../../../config/supabaseClient'
import { rankProducts } from '../../../lib/nearbyRanking.js'
import { productCoords } from '../../utils/marketplace.js'

const PRODUCT_SEARCH_LIMIT = 100
const PRODUCT_SEARCH_COLUMNS = 'id, name, emoji, price, show_price, rx_restricted, stock, category, generic_name, whatsapp, image_url, sale_type, price_unit, min_purchase, seller_location, latitude, longitude, business_id, owner_id, list_on_carefind, created_at, businesses(name, city, state, whatsapp, phone, latitude, longitude, lat, lng, show_prices)'
// PostgREST / Postgres: the function does not exist (migration not applied yet).
const MISSING_FUNCTION_CODES = ['PGRST202', '42883']
// The fallback query builds a PostgREST or() filter: characters with meaning there are dropped from the search text.
const filterSafe = (q) => String(q || '').replace(/[,()"\\*%:]/g, ' ').replace(/\s+/g, ' ').trim()

// Public product reads go through carefind_products (carehub_20261221): it lists every product on CareFind, and
// sends prescription-only and controlled medicines without a price (rx_restricted).
export function createHealthcareRepository({ client = supabase } = {}) {
  return {
    async searchProductsByName(decodedName) {
      const { data, error } = await client
        .from('carefind_products')
        .select('id, name, generic_name, price, show_price, rx_restricted, stock, emoji, image_url, description, whatsapp, sale_type, price_unit, min_purchase, seller_location, latitude, longitude, owner_id, business_id, businesses(id, name, city, state, whatsapp, visible_on_carefind, latitude, longitude, lat, lng, phone, show_prices)')
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
        .from('carefind_products')
        .select('id, name, emoji, price, show_price, rx_restricted, latitude, longitude, business_id, list_on_carefind, businesses(name, latitude, longitude, lat, lng, show_prices)')
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

    // Products search, nearby pharmacies first (CODE_AUDIT A51): search_carefind_products (carefind_20270207) ranks
    // EVERY match by match strength, availability and distance from `userCoords`, and returns the best 100 ids; the
    // rows are then read from carefind_products in that order, each with `distance_m` (metres, or null).
    // Until that function exists the previous query is used and the same rule (lib/nearbyRanking.js) is applied to the
    // rows it returns.
    async searchProducts(q, saleType, userCoords = null) {
      const sale = saleType && saleType !== 'all' ? saleType : null
      const located = userCoords && Number.isFinite(Number(userCoords.lat)) && Number.isFinite(Number(userCoords.lng))
      const { data: ranked, error: rankError } = await client.rpc('search_carefind_products', {
        p_query: q || null,
        p_lat: located ? Number(userCoords.lat) : null,
        p_lng: located ? Number(userCoords.lng) : null,
        p_sale_type: sale,
        p_limit: PRODUCT_SEARCH_LIMIT,
      })
      if (!rankError) {
        const order = (ranked || []).filter((r) => r && r.id)
        if (order.length === 0) return []
        const { data, error } = await client.from('carefind_products').select(PRODUCT_SEARCH_COLUMNS).in('id', order.map((r) => r.id))
        if (error) throw error
        const byId = new Map((data || []).map((row) => [row.id, row]))
        return order.filter((r) => byId.has(r.id)).map((r) => ({ ...byId.get(r.id), distance_m: r.distance_m ?? null }))
      }
      if (!MISSING_FUNCTION_CODES.includes(String(rankError.code))) throw rankError
      console.warn('[search] search_carefind_products is not installed yet (carefind_20270207); ranking in the browser')

      let pq = client.from('carefind_products').select(PRODUCT_SEARCH_COLUMNS)
      const term = filterSafe(q)
      if (term) pq = pq.or(`name.ilike.%${term}%,generic_name.ilike.%${term}%,category.ilike.%${term}%`)
      if (sale) pq = pq.eq('sale_type', sale)
      pq = pq.order('created_at', { ascending: false }).limit(PRODUCT_SEARCH_LIMIT)
      const { data, error } = await pq
      if (error) throw error
      return rankProducts(data || [], {
        query: term,
        userCoords: located ? userCoords : null,
        pick: (r) => ({ name: r.name, genericName: r.generic_name, category: r.category, stock: r.stock, coords: productCoords(r), createdAt: r.created_at }),
      })
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
