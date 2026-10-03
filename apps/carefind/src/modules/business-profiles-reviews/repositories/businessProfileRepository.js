import { supabase } from '../../../config/supabaseClient'

export function createBusinessProfileRepository({ client = supabase } = {}) {
  return {
    async getBusinessById(id) {
      const { data, error } = await client
        .from('businesses')
        .select('id, name, address, city, state, business_type, whatsapp, phone, website, hours, maps_link, cover_url, logo_url, description, booking_enabled, booking_type, booking_slots, status, visible_on_carefind, latitude, longitude, lat, lng, online_consultation_fee, physical_consultation_fee')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async getBusinessProducts(businessId) {
      const { data, error } = await client
        .from('products')
        .select('id, name, generic_name, price, show_price, stock, emoji, image_url, price_unit, sale_type, min_purchase, list_on_carefind, latitude, longitude, businesses(show_prices, latitude, longitude, lat, lng)')
        .eq('business_id', businessId)
      if (error) throw error
      return data || []
    },

    async getBusinessServices(businessId) {
      const { data, error } = await client
        .from('business_services')
        .select('id, name, price_kobo, duration_minutes, is_active')
        .eq('business_id', businessId)
        .eq('is_active', true)
      if (error) throw error
      return (data || []).filter((s) => s.is_active !== false)
    },

    async getBusinessReviews(businessId) {
      const { data, error } = await client
        .from('reviews')
        .select('id, rating, comment, created_at, user_id')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getReviewerProfiles(userIds) {
      if (!userIds.length) return {}
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, display_name, is_verified, specialty, verification_label')
        .in('id', userIds)
      if (error) throw error
      const map = {}
      ;(data || []).forEach((pr) => { map[pr.id] = pr })
      return map
    },

    async createReview(businessId, userId, rating, comment) {
      const { error } = await client
        .from('reviews')
        .insert({ business_id: businessId, user_id: userId, rating, comment })
      if (error) throw error
    },

    async getServiceAvailability(businessId, serviceId, date) {
      const { data, error } = await client
        .from('service_availability')
        .select('id,date,time,start_time,end_time,status,is_booked')
        .eq('business_id', businessId)
        .eq('service_id', serviceId)
        .eq('date', date)
      if (error) throw error
      return data || []
    },
  }
}

export const businessProfileRepository = createBusinessProfileRepository()
