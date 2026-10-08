import { supabase } from '../../../config/supabaseClient'

export function createShowRepository({ client }) {
  return {
    async getShowById(showId) {
      const { data, error } = await client
        .from('live_shows')
        .select('*, host:profiles!live_shows_host_id_fkey(id, full_name, display_name, avatar_url, is_verified, specialty, verification_label), guest:profiles!live_shows_guest_id_fkey(id, full_name, display_name, avatar_url, is_verified, specialty, verification_label)')
        .eq('id', showId)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async endShow(showId) {
      const { error } = await client
        .from('live_shows')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', showId)
      if (error) throw error
    },

    async startShow(showId) {
      const { error } = await client
        .from('live_shows')
        .update({ status: 'live', started_at: new Date().toISOString() })
        .eq('id', showId)
      if (error) throw error
    },

    async updateScheduledShow(showId, hostId, updates) {
      const { error } = await client
        .from('live_shows')
        .update(updates)
        .eq('id', showId)
        .eq('host_id', hostId)
        .eq('status', 'scheduled')
      if (error) throw error
    },

    async cancelScheduledShow(showId, hostId) {
      const { error } = await client
        .from('live_shows')
        .delete()
        .eq('id', showId)
        .eq('host_id', hostId)
        .eq('status', 'scheduled')
      if (error) throw error
    },

    async cancelScheduledShowFallback(showId, hostId) {
      const { error } = await client
        .from('live_shows')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', showId)
        .eq('host_id', hostId)
        .eq('status', 'scheduled')
      if (error) throw error
    },

    async getParticipants(showId) {
      const { data, error } = await client
        .from('live_participants')
        .select('user_id, role, joined, profiles(full_name, display_name)')
        .eq('show_id', showId)
      if (error) throw error
      return data || []
    },

    async markParticipantJoined(showId, userId) {
      const { error } = await client
        .from('live_participants')
        .update({ joined: true })
        .eq('show_id', showId)
        .eq('user_id', userId)
      if (error) throw error
    },

    async getReactionCount(showId) {
      const { data, error } = await client
        .from('live_reactions')
        .select('id', { count: 'exact', head: true })
        .eq('show_id', showId)
      if (error) throw error
      return data?.length ?? 0
    },

    async getReactionRows(showId) {
      const { data, error } = await client
        .from('live_reactions')
        .select('id')
        .eq('show_id', showId)
      if (error) throw error
      return data || []
    },

    async getRecentReactions(showId) {
      const { data, error } = await client
        .from('live_reactions')
        .select('created_at, profiles(full_name, display_name)')
        .eq('show_id', showId)
        .order('created_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data || []
    },

    async getWhoReactions(showId) {
      const { data, error } = await client
        .from('live_reactions')
        .select('user_id, created_at, profiles(id, full_name, display_name, is_verified, specialty, verification_label)')
        .eq('show_id', showId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data || []
    },

    async addReaction(showId, userId) {
      const { error } = await client
        .from('live_reactions')
        .insert({ show_id: showId, user_id: userId })
      if (error) throw error
    },

    async getShareCount(showId) {
      const { data, error } = await client
        .from('live_shares')
        .select('id')
        .eq('show_id', showId)
      if (error) throw error
      return data?.length ?? 0
    },

    async getWhoShares(showId) {
      const { data, error } = await client
        .from('live_shares')
        .select('user_id, created_at, profiles(id, full_name, display_name, is_verified, specialty, verification_label)')
        .eq('show_id', showId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data || []
    },

    async addShare(showId, userId) {
      const { error } = await client
        .from('live_shares')
        .insert({ show_id: showId, user_id: userId })
      if (error) throw error
    },

    async getViewCount(showId) {
      const { data, error } = await client
        .from('live_views')
        .select('id')
        .eq('show_id', showId)
      if (error) throw error
      return data?.length ?? 0
    },

    async getWhoViews(showId) {
      const { data, error } = await client
        .from('live_views')
        .select('user_id, created_at, profiles(id, full_name, display_name, is_verified, specialty, verification_label)')
        .eq('show_id', showId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data || []
    },

    async addView(showId, userId) {
      const { error } = await client
        .from('live_views')
        .insert({ show_id: showId, user_id: userId })
      if (error) throw error
    },

    async getGiftStats(showId) {
      const { data, error } = await client
        .from('gifts')
        .select('coins, sender_id, created_at, profiles:sender_id(full_name, display_name)')
        .eq('post_id', showId)
      if (error) throw error
      return data || []
    },

    async getWhoGifts(showId) {
      const { data, error } = await client
        .from('gifts')
        .select('sender_id, coins, created_at, profiles:sender_id(id, full_name, display_name, is_verified, specialty, verification_label)')
        .eq('post_id', showId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data || []
    },

    async getItems(showId) {
      const { data, error } = await client
        .from('live_items')
        .select('id, kind, content, created_at, sender_id, profiles(full_name, display_name)')
        .eq('show_id', showId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async addItem(showId, senderId, kind, content) {
      const { data, error } = await client
        .from('live_items')
        .insert({ show_id: showId, sender_id: senderId, kind, content })
        .select()
        .single()
      if (error) throw error
      return data
    },

    async getComments(showId, limit = 100) {
      const { data, error } = await client
        .from('live_comments')
        .select('id, content, hidden, created_at, user_id, profiles(full_name, display_name)')
        .eq('show_id', showId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },

    async getDashboardComments(showId, limit = 60) {
      const { data, error } = await client
        .from('live_comments')
        .select('id, content, hidden, created_at, profiles(full_name, display_name)')
        .eq('show_id', showId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    },

    async addComment(showId, userId, content) {
      const { error } = await client
        .from('live_comments')
        .insert({ show_id: showId, user_id: userId, content })
      if (error) throw error
    },

    async hideComment(commentId) {
      const { error } = await client
        .from('live_comments')
        .update({ hidden: true })
        .eq('id', commentId)
      if (error) throw error
    },
  }
}

export const showRepository = createShowRepository({ client: supabase })
