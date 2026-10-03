import { supabase } from '../../config/supabaseClient'

export const trackingRepository = {
  /**
   * Generate a public tracking token for an order
   */
  async generateTrackingToken(orderId) {
    try {
      const { data, error } = await supabase.rpc('generate_tracking_token', {
        p_order_id: orderId
      })

      if (error) {
        console.error('Failed to generate tracking token:', error)
        return null
      }

      return data
    } catch (error) {
      console.error('Failed to generate tracking token:', error)
      return null
    }
  },

  /**
   * Get tracking information by public token
   */
  async getTrackingByToken(token) {
    try {
      const { data, error } = await supabase.rpc('get_tracking_by_token', {
        p_token: token
      })

      if (error) {
        console.error('Failed to get tracking info:', error)
        return null
      }

      return data
    } catch (error) {
      console.error('Failed to get tracking info:', error)
      return null
    }
  },

  /**
   * Add a tracking event (vendor only)
   */
  async addTrackingEvent(orderId, status, notes = null, location = null) {
    try {
      const { error } = await supabase.rpc('add_tracking_event', {
        p_order_id: orderId,
        p_status: status,
        p_notes: notes,
        p_location: location
      })

      if (error) {
        console.error('Failed to add tracking event:', error)
        return false
      }

      return true
    } catch (error) {
      console.error('Failed to add tracking event:', error)
      return false
    }
  },

  /**
   * Get tracking events for an order
   */
  async getTrackingEvents(orderId) {
    try {
      const { data, error } = await supabase
        .from('shop_order_tracking_events')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to get tracking events:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Failed to get tracking events:', error)
      return []
    }
  },

  /**
   * Calculate delivery fee based on distance
   */
  async calculateDeliveryFee(distanceKm, zoneType = 'standard') {
    try {
      const { data, error } = await supabase.rpc('calculate_delivery_fee', {
        p_distance_km: distanceKm,
        p_zone_type: zoneType
      })

      if (error) {
        console.error('Failed to calculate delivery fee:', error)
        return null
      }

      return data
    } catch (error) {
      console.error('Failed to calculate delivery fee:', error)
      return null
    }
  },

  /**
   * Get delivery zones
   */
  async getDeliveryZones() {
    try {
      const { data, error } = await supabase
        .from('shop_delivery_zones')
        .select('*')
        .eq('is_active', true)
        .order('min_distance_km', { ascending: true })

      if (error) {
        console.error('Failed to get delivery zones:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Failed to get delivery zones:', error)
      return []
    }
  },

  /**
   * Get pickup stations
   */
  async getPickupStations() {
    try {
      const { data, error } = await supabase
        .from('shop_pickup_stations')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (error) {
        console.error('Failed to get pickup stations:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Failed to get pickup stations:', error)
      return []
    }
  }
}
