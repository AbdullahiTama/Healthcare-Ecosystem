import { supabase } from '../../config/supabaseClient'

export const vendorRatingRepository = {
  async create(orderId, vendorBusinessId, customerId, ratings, comment) {
    const { data, error } = await supabase
      .from('vendor_ratings')
      .insert({
        order_id: orderId,
        vendor_business_id: vendorBusinessId,
        customer_id: customerId,
        fulfillment_speed: ratings.fulfillmentSpeed,
        packaging_quality: ratings.packagingQuality,
        accuracy: ratings.accuracy,
        overall_rating: ratings.overall,
        comment: comment || null
      })
      .select()
      .single()

    if (error) throw error
    return data
  },

  async getByOrder(orderId) {
    const { data, error } = await supabase
      .from('vendor_ratings')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle()

    if (error) throw error
    return data
  },

  async getByCustomer(customerId) {
    const { data, error } = await supabase
      .from('vendor_ratings')
      .select('*, shop_orders!inner(order_ref, created_at)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  },

  async getByVendor(vendorBusinessId) {
    const { data, error } = await supabase
      .from('vendor_ratings')
      .select('*, profiles:customer_id(full_name, display_name, avatar_url), shop_orders!inner(order_ref)')
      .eq('vendor_business_id', vendorBusinessId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  },

  async getVendorStats(vendorBusinessId) {
    const { data, error } = await supabase
      .rpc('get_vendor_rating_stats', { p_vendor_business_id: vendorBusinessId })

    if (error) throw error
    return data?.[0] || {
      total_ratings: 0,
      avg_overall: 0,
      avg_fulfillment_speed: 0,
      avg_packaging_quality: 0,
      avg_accuracy: 0
    }
  },

  async update(ratingId, ratings, comment) {
    const { data, error } = await supabase
      .from('vendor_ratings')
      .update({
        fulfillment_speed: ratings.fulfillmentSpeed,
        packaging_quality: ratings.packagingQuality,
        accuracy: ratings.accuracy,
        overall_rating: ratings.overall,
        comment: comment || null
      })
      .eq('id', ratingId)
      .select()
      .single()

    if (error) throw error
    return data
  }
}
