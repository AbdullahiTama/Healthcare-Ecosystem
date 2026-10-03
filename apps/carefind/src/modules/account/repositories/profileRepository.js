import { supabase } from '../../../config/supabaseClient'

export function createProfileRepository({ client }) {
  return {
    async getProfileById(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('id, display_name, full_name, avatar_url, cover_url, phone, email, is_verified, verification_label, specialty, subscription_price, location, country')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async getProfilePublic(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('display_name, avatar_url, is_verified, verification_label')
        .eq('id', userId)
        .single()
      if (error) throw error
      return data
    },

    async getProfileLocation(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('location')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async upsertProfile(profile) {
      const { error } = await client
        .from('profiles')
        .upsert(profile)
      if (error) throw error
    },

    async updateProfile(userId, updates) {
      const { error } = await client
        .from('profiles')
        .update(updates)
        .eq('id', userId)
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

    async getMyPosts(userId) {
      const { data, error } = await client
        .from('posts')
        .select('id, content, created_at, post_type')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getMyPostCount(userId) {
      const { data, error } = await client
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      if (error) throw error
      return data?.length ?? 0
    },

    async getMyReviews(userId) {
      const { data, error } = await client
        .from('reviews')
        .select('id, rating, comment, created_at, business_id, businesses(name)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getSavedPostCount(userId) {
      const { data, error } = await client
        .from('saved_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      if (error) throw error
      return data?.length ?? 0
    },

    async getFollowerCount(userId) {
      const { data, error } = await client
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', userId)
      if (error) throw error
      return data?.length ?? 0
    },

    async getFollowingCount(userId) {
      const { data, error } = await client
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', userId)
      if (error) throw error
      return data?.length ?? 0
    },

    async getCommentCount(userId) {
      const { data, error } = await client
        .from('post_comments')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      if (error) throw error
      return data?.length ?? 0
    },

    async getVerificationRequest(userId) {
      const { data, error } = await client
        .from('verification_requests')
        .select('status')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async submitVerificationRequest(payload) {
      const { error } = await client
        .from('verification_requests')
        .insert(payload)
      if (error) throw error
    },

    async getMyBusinesses(userId) {
      const { data, error } = await client
        .from('businesses')
        .select('id, name, business_type, cover_url, visible_on_carefind')
        .eq('owner_id', userId)
      if (error) throw error
      return data || []
    },

    async getBusinessesByIds(ids) {
      if (!ids.length) return []
      const { data, error } = await client
        .from('businesses')
        .select('id, name')
        .in('id', ids)
      if (error) throw error
      return data || []
    },

    async markNotificationsRead(userId) {
      const { error } = await client
        .from('notifications')
        .update({ read: true })
        .eq('recipient_id', userId)
        .eq('read', false)
      if (error) throw error
    },

    async createStory(payload) {
      const { error } = await client
        .from('stories')
        .insert(payload)
      if (error) throw error
    },

    async incrementStoryView(storyId) {
      await client.rpc('increment_story_view', { story_id: storyId }).then(() => {}).catch(() => {})
    },

    async updateLiveShow(showId, hostId, updates) {
      const { error } = await client
        .from('live_shows')
        .update(updates)
        .eq('id', showId)
        .eq('host_id', hostId)
        .eq('status', 'scheduled')
      if (error) throw error
    },

    async cancelLiveShow(showId, hostId) {
      const { error } = await client
        .from('live_shows')
        .delete()
        .eq('id', showId)
        .eq('host_id', hostId)
        .eq('status', 'scheduled')
      if (error) throw error
    },

    async cancelLiveShowFallback(showId, hostId) {
      const { error } = await client
        .from('live_shows')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', showId)
        .eq('host_id', hostId)
        .eq('status', 'scheduled')
      if (error) throw error
    },

    async reportPost(userId, postId, reason) {
      const { error } = await client
        .from('reports')
        .insert({ reporter_id: userId, post_id: postId, reason })
      if (error) throw error
    },

    async insertProduct(row) {
      const { error } = await client
        .from('products')
        .insert(row)
      if (error) throw error
    },
  }
}

export const profileRepository = createProfileRepository({ client: supabase })
