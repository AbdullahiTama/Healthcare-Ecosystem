import { supabase } from '../../../config/supabaseClient'

export function createBusinessRepository({ client = supabase } = {}) {
  return {
    async listBusinesses({ searchQuery, page, pageSize, columns }) {
      const offset = page * pageSize
      let query = client
        .from('businesses')
        .select(columns, { count: 'exact' })
      if (searchQuery) {
        query = query.ilike('name', `%${searchQuery}%`)
      }
      const { data, error, count } = await query
        .range(offset, offset + pageSize - 1)
        .order('created_at', { ascending: false })
      if (error) throw error
      return { data: data || [], count }
    },

    async listAllBusinesses({ searchQuery, columns }) {
      let query = client
        .from('businesses')
        .select(columns)
        .order('created_at', { ascending: false })
      if (searchQuery) {
        query = query.ilike('name', `%${searchQuery}%`)
      }
      const { data, error } = await query
      if (error) throw error
      return data || []
    },

    async getEcommerceProducts(businessId) {
      const { data, error } = await client
        .from('ecommerce_products')
        .select('id,business_id,name,price,units_sold,is_live,status,ecommerce_price_kobo,description,category,product_id,created_at')
        .eq('business_id', businessId)
      if (error) throw error
      return data || []
    },

    async suspendBusiness(id) {
      const { error } = await client
        .from('businesses')
        .update({ status: 'suspended' })
        .eq('id', id)
        .eq('status', 'active')
      if (error) throw error
    },

    async revokeBusiness(id) {
      const { error } = await client
        .from('businesses')
        .update({ status: 'revoked' })
        .eq('id', id)
      if (error) throw error
    },

    async softDeleteBusiness(id) {
      const now = new Date().toISOString()
      const { error } = await client
        .from('businesses')
        .update({ deleted_at: now })
        .eq('id', id)
      if (error) throw error
    },

    async hardDeleteBusiness(id) {
      const { error } = await client
        .from('businesses')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
  }
}

export const businessRepository = createBusinessRepository()
