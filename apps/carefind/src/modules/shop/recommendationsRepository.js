import { supabase } from '../../config/supabaseClient'

export const recommendationsRepository = {
  /**
   * Track when a user views a product
   */
  async trackView(productId, userId = null, sessionId = null) {
    try {
      await supabase.rpc('track_product_view', {
        p_product_id: productId,
        p_user_id: userId,
        p_session_id: sessionId
      })
    } catch (error) {
      console.error('Failed to track product view:', error)
    }
  },

  /**
   * Track purchase patterns after order completion
   */
  async trackPurchasePattern(orderId) {
    try {
      await supabase.rpc('track_purchase_pattern', {
        p_order_id: orderId
      })
    } catch (error) {
      console.error('Failed to track purchase pattern:', error)
    }
  },

  /**
   * Get product recommendations
   */
  async getRecommendations(productId, limit = 6, userId = null) {
    try {
      const { data, error } = await supabase.rpc('get_product_recommendations', {
        p_product_id: productId,
        p_limit: limit,
        p_user_id: userId
      })

      if (error) {
        console.error('Failed to get recommendations:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Failed to get recommendations:', error)
      return []
    }
  },

  /**
   * Auto-generate recommendations based on category
   */
  async autoGenerateRecommendations(productId) {
    try {
      await supabase.rpc('auto_generate_recommendations', {
        p_product_id: productId
      })
    } catch (error) {
      console.error('Failed to auto-generate recommendations:', error)
    }
  },

  /**
   * Manually add a product relationship (admin only)
   */
  async addRelationship(productId, relatedProductId, relationshipType, strength = 1.0) {
    try {
      const { error } = await supabase
        .from('shop_product_relationships')
        .upsert({
          product_id: productId,
          related_product_id: relatedProductId,
          relationship_type: relationshipType,
          strength: strength,
          is_manual: true
        }, {
          onConflict: 'product_id,related_product_id,relationship_type'
        })

      if (error) {
        console.error('Failed to add relationship:', error)
        return false
      }

      return true
    } catch (error) {
      console.error('Failed to add relationship:', error)
      return false
    }
  },

  /**
   * Remove a product relationship (admin only)
   */
  async removeRelationship(productId, relatedProductId, relationshipType) {
    try {
      const { error } = await supabase
        .from('shop_product_relationships')
        .delete()
        .eq('product_id', productId)
        .eq('related_product_id', relatedProductId)
        .eq('relationship_type', relationshipType)

      if (error) {
        console.error('Failed to remove relationship:', error)
        return false
      }

      return true
    } catch (error) {
      console.error('Failed to remove relationship:', error)
      return false
    }
  },

  /**
   * Get all relationships for a product (admin only)
   */
  async getRelationships(productId) {
    try {
      const { data, error } = await supabase
        .from('shop_product_relationships')
        .select(`
          *,
          related_product:ecommerce_products!shop_product_relationships_related_product_id_fkey (
            id,
            category,
            products (
              id,
              name,
              price
            )
          )
        `)
        .eq('product_id', productId)
        .order('strength', { ascending: false })

      if (error) {
        console.error('Failed to get relationships:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Failed to get relationships:', error)
      return []
    }
  }
}
