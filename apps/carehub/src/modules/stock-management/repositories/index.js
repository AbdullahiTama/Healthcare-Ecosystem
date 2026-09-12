import { sbFetch } from '../../../services/supabase'

export function createStockValidationRepository(request = sbFetch) {
  return {
    async saveSession(businessId, session, items, userId) {
      if (!businessId) throw new Error('Missing business — businessId is required')
      if (!Array.isArray(items)) throw new Error('p_items must be an array')
      // Ensure integer payloads — phone +/- and laptop typed+Enter must produce identical JSON
      const sanitized = items.map(it => {
        const copy = { ...it }
        if (copy.previous_stock != null) copy.previous_stock = Math.max(0, parseInt(copy.previous_stock, 10) || 0)
        if (copy.adjustment_qty != null) {
          const parsed = parseInt(copy.adjustment_qty, 10)
          const n = Number.isNaN(parsed) ? 0 : parsed
          copy.adjustment_qty = Math.max(0, Math.min(n, 10000))
        }
        if (copy.new_stock != null) {
          // Ensure int; keep negative value intact so client guard can be tested and DB guard can fire — do not clamp to 0 here
          const parsed = parseInt(copy.new_stock, 10)
          copy.new_stock = Number.isNaN(parsed) ? 0 : parsed
        }
        if (copy.unit_price != null) copy.unit_price = copy.unit_price
        // Normalize empty reason to null for DB consistency
        if ('reason' in copy) copy.reason = copy.reason || null
        // Ensure shelf_label null if empty
        if ('shelf_label' in copy) copy.shelf_label = copy.shelf_label || null
        // Normalize direction to strict enum only if present
        if ('adjustment_direction' in copy) {
          if (copy.adjustment_direction !== '+' && copy.adjustment_direction !== '-') copy.adjustment_direction = '+'
        }
        return copy
      })

      // Keep seam: single sbFetch call, error detail bubbling via thrown Supabase error
      const result = await request('rpc/save_stock_validation_session', {
        method: 'POST',
        body: JSON.stringify({
          p_business_id: businessId,
          p_user_id: userId,
          p_user_name: session.user_name,
          p_products_checked: session.products_checked,
          p_products_adjusted: session.products_adjusted,
          p_items: sanitized,
        }),
      })
      return { sessionId: result, itemsCount: items.length }
    },

    async getSessions(businessId) {
      return request(
        `stock_validation_sessions?business_id=eq.${businessId}&order=created_at.desc&select=*`
      )
    },

    async getSessionById(sessionId, businessId) {
      const sessionResult = await request(
        `stock_validation_sessions?id=eq.${sessionId}&business_id=eq.${businessId}&select=*`
      )
      const session = sessionResult[0]

      if (!session) return null

      const items = await request(
        `stock_validation_items?session_id=eq.${sessionId}&order=created_at.asc&select=*`
      )

      return { ...session, items }
    },
  }
}

export const stockValidationRepository = createStockValidationRepository()
