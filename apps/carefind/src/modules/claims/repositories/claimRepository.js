import { supabase } from '../../../config/supabaseClient'

export function createClaimRepository({ client = supabase } = {}) {
  return {
    async getApprovedClaimsForUser(userId) {
      const { data, error } = await client
        .from('business_claims')
        .select('business_id, businesses(id, name, business_type, visible_on_carefind)')
        .eq('user_id', userId)
        .eq('status', 'approved')
      if (error) throw error
      return data || []
    },

    async getClaimsForUser(userId) {
      const { data, error } = await client
        .from('business_claims')
        .select('id, business_id, status, businesses(name)')
        .eq('user_id', userId)
      if (error) throw error
      return data || []
    },

    async createClaim(userId, businessId) {
      const { error } = await client
        .from('business_claims')
        .insert({ user_id: userId, business_id: businessId })
      if (error) throw error
    },

    async searchBusinesses(query) {
      const { data, error } = await client
        .from('businesses')
        .select('id, name, address, city, state, business_type')
        .ilike('name', `%${query}%`)
      if (error) throw error
      return data || []
    },

    async getProductsForBusiness(businessId) {
      const { data, error } = await client
        .from('products')
        .select('id, name, price, show_price, stock, sale_type, min_purchase, price_unit, list_on_carefind')
        .eq('business_id', businessId)
      if (error) throw error
      return data || []
    },

    async getReviewsForBusiness(businessId) {
      const { data, error } = await client
        .from('reviews')
        .select('id, rating, comment, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async toggleBusinessVisibility(businessId, visible) {
      const { error } = await client
        .from('businesses')
        .update({ visible_on_carefind: visible })
        .eq('id', businessId)
      if (error) throw error
    },

    async toggleProductVisibility(productId, listed) {
      const { error } = await client
        .from('products')
        .update({ list_on_carefind: listed })
        .eq('id', productId)
      if (error) throw error
    },

    async togglePriceVisibility(productId, showPrice) {
      const { error } = await client
        .from('products')
        .update({ show_price: showPrice })
        .eq('id', productId)
      if (error) throw error
    },

    async updateProductPriceAndStock(productId, price, stock) {
      const { error } = await client
        .from('products')
        .update({ price, stock })
        .eq('id', productId)
      if (error) throw error
    },

    async findProductByName(businessId, name) {
      const { data, error } = await client
        .from('products')
        .select('id')
        .eq('business_id', businessId)
        .ilike('name', name)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async updateProductFromCsv(productId, price, stock) {
      const { error } = await client
        .from('products')
        .update({ price, stock, list_on_carefind: true })
        .eq('id', productId)
      if (error) throw error
    },

    async insertProductFromCsv(productData) {
      const { error } = await client
        .from('products')
        .insert(productData)
      if (error) throw error
    },
  }
}

export const claimRepository = createClaimRepository()
