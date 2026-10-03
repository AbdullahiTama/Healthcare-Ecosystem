import { supabase } from '../../../config/supabaseClient'

export function createSessionRepository({ client }) {
  return {
    async getSessionById(sessionId) {
      const { data, error } = await client
        .from('live_sessions')
        .select('*, profiles(full_name, display_name, avatar_url, specialty, verification_label, is_verified)')
        .eq('id', sessionId)
        .single()
      if (error) throw error
      return data
    },

    async updateSession(sessionId, updates) {
      const { error } = await client
        .from('live_sessions')
        .update(updates)
        .eq('id', sessionId)
      if (error) throw error
    },

    async endSession(sessionId) {
      const { error } = await client
        .from('live_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString(), board_strokes: [] })
        .eq('id', sessionId)
      if (error) throw error
    },

    async getMessages(sessionId, limit = 100) {
      const { data, error } = await client
        .from('live_messages')
        .select('*, profiles(full_name, display_name, avatar_url)')
        .eq('session_id', sessionId)
        .order('created_at')
        .limit(limit)
      if (error) throw error
      return data || []
    },

    async addMessage(sessionId, userId, content, type = 'text', audioUrl = null) {
      const { error } = await client
        .from('live_messages')
        .insert({ session_id: sessionId, user_id: userId, content, type, audio_url: audioUrl })
      if (error) throw error
    },

    async deleteMessages(sessionId) {
      const { error } = await client
        .from('live_messages')
        .delete()
        .eq('session_id', sessionId)
      if (error) throw error
    },

    async getWalletBalance(userId) {
      const { data, error } = await client
        .from('wallets')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data?.balance ?? 0
    },

    async createSummaryPost(userId, content, expiresAt) {
      const { error } = await client
        .from('posts')
        .insert({ user_id: userId, content, post_type: 'text', expires_at: expiresAt })
      if (error) throw error
    },

    async sendGift(recipientId, coins, giftType, giftEmoji, sessionId) {
      const { data, error } = await client
        .rpc('send_gift', {
          p_recipient: recipientId,
          p_coins: coins,
          p_gift_type: giftType,
          p_gift_emoji: giftEmoji,
          p_live_session_id: sessionId,
        })
      if (error) throw error
      return data
    },
  }
}

export const sessionRepository = createSessionRepository({ client: supabase })
