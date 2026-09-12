import { supabase } from '../../config/supabaseClient'

export async function validatePromoCode(code, userId, orderKobo, segment = null) {
  try {
    const { data, error } = await supabase.rpc('validate_promo_code', {
      p_code: code,
      p_user_id: userId,
      p_order_kobo: orderKobo,
      p_segment: segment
    })

    if (error) {
      console.error('Promo code validation error:', error)
      return { valid: false, error: 'Failed to validate promo code' }
    }

    return data
  } catch (err) {
    console.error('Promo code validation exception:', err)
    return { valid: false, error: 'Failed to validate promo code' }
  }
}

export async function applyPromoCodeToOrder(orderId, promoCodeId, discountKobo) {
  try {
    const { error } = await supabase.rpc('apply_promo_code_to_order', {
      p_order_id: orderId,
      p_promo_code_id: promoCodeId,
      p_discount_kobo: discountKobo
    })

    if (error) {
      console.error('Apply promo code error:', error)
      return { success: false, error: 'Failed to apply promo code' }
    }

    return { success: true }
  } catch (err) {
    console.error('Apply promo code exception:', err)
    return { success: false, error: 'Failed to apply promo code' }
  }
}
