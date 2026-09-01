import { sbFetch } from '../../../services/supabase'

export function createStockValidationRepository(request = sbFetch) {
  return {
    async saveSession(businessId, session, items, userId) {
      const result = await request('rpc/save_stock_validation_session', {
        method: 'POST',
        body: JSON.stringify({
          p_business_id: businessId,
          p_user_id: userId,
          p_user_name: session.user_name,
          p_products_checked: session.products_checked,
          p_products_adjusted: session.products_adjusted,
          p_items: items,
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
