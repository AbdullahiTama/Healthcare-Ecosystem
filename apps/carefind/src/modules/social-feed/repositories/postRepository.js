import { supabase } from '../../../config/supabaseClient'

const NO_SINGLE_ROW = 'PGRST116'

export function isPostMissingError(error) {
  return error?.code === NO_SINGLE_ROW
}

export function createPostRepository({ client = supabase } = {}) {
  return {
    async getFeed(feedTab, limit = 20, offset = 0) {
      let query = client
        .from('posts')
        .select(`
          id, content, post_type, image_url, image_urls, audio_url, video_url,
          rating, is_premium, subscriber_only, preview_text,
          posting_as_business_id, posted_as_type, posted_as_id, posted_as_name,
          posted_as_title, live_session_id, view_count, theme, created_at, user_id,
          profiles!user_id (id, display_name, full_name, is_verified, verification_label, specialty, avatar_url)
        `)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (feedTab !== 'foryou') {
        query = query.eq('post_type', feedTab)
      }

      const { data, error } = await query
      if (error) throw error
      return data || []
    },

    async getPostById(postId) {
      const { data, error } = await client
        .from('posts')
        .select(`*, profiles!user_id (id, display_name, full_name, is_verified, verification_label, specialty, avatar_url)`)
        .eq('id', postId)
        .single()
      if (error) throw error
      return data
    },

    async createPost(post) {
      const { data, error } = await client.from('posts').insert(post).select().single()
      if (error) throw error
      return data
    },

    async updatePost(postId, userId, updates) {
      const { data, error } = await client
        .from('posts').update(updates).eq('id', postId).eq('user_id', userId).select().single()
      if (error) throw error
      return data
    },

    async deletePost(postId, userId) {
      const { data, error } = await client
        .from('posts')
        .delete()
        .eq('id', postId)
        .eq('user_id', userId)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Post was not deleted. It may no longer exist or you may not have permission.')
      return data[0]
    },

    async incrementViewCount(postId) {
      const { error } = await client.rpc('increment_post_view', { post_id: postId })
      if (error) throw error
    },

    async getReactions(postIds) {
      const { data, error } = await client
        .from('post_reactions').select('id, post_id, user_id, reaction_type').in('post_id', postIds)
      if (error) throw error
      return data || []
    },

    async addReaction(postId, userId, reactionType = 'like') {
      const { data, error } = await client
        .from('post_reactions')
        .insert({ post_id: postId, user_id: userId, reaction_type: reactionType })
        .select().single()
      if (error) throw error
      return data
    },

    async removeReaction(postId, userId) {
      const { error } = await client
        .from('post_reactions').delete().eq('post_id', postId).eq('user_id', userId)
      if (error) throw error
    },

    async getSavedPosts(userId) {
      const { data, error } = await client
        .from('saved_posts').select('post_id').eq('user_id', userId)
      if (error) throw error
      return (data || []).map(d => d.post_id)
    },

    async savePost(userId, postId) {
      const { data, error } = await client
        .from('saved_posts').insert({ user_id: userId, post_id: postId }).select().single()
      if (error) throw error
      return data
    },

    async unsavePost(userId, postId) {
      const { error } = await client
        .from('saved_posts').delete().eq('user_id', userId).eq('post_id', postId)
      if (error) throw error
    },

    async getCommentCounts(postIds) {
      const { data, error } = await client
        .from('post_comments').select('post_id').in('post_id', postIds)
      if (error) throw error
      const counts = {}
      ;(data || []).forEach(row => {
        counts[row.post_id] = (counts[row.post_id] || 0) + 1
      })
      return counts
    },

    async searchBusinesses(query, limit = 4) {
      const { data, error } = await client
        .from('businesses').select('id, name, business_type')
        .eq('visible_on_carefind', true)
        .ilike('name', `%${query}%`)
        .limit(limit)
      if (error) throw error
      return data || []
    },

    async searchProducts(query, limit = 4) {
      const { data, error } = await client
        .from('products').select('id, name, emoji')
        .eq('list_on_carefind', true)
        .ilike('name', `%${query}%`)
        .limit(limit)
      if (error) throw error
      return data || []
    },

    async getFeedRankingConfig() {
      const { data, error } = await client
        .from('feed_ranking_config').select('key, value')
      if (error) throw error
      return data || []
    },

    async getCandidatePools() {
      const { data, error } = await client
        .from('candidate_generation_pools').select('pool, enabled, priority, limit_count')
      if (error) throw error
      return data || []
    },

    async getProfileLocation(userId) {
      const { data, error } = await client
        .from('profiles').select('location, country').eq('id', userId).maybeSingle()
      if (error) throw error
      return data
    },

    async getProfileById(userId) {
      const { data, error } = await client
        .from('profiles').select('full_name, display_name, phone, is_verified, verification_label, avatar_url')
        .eq('id', userId).maybeSingle()
      if (error) throw error
      return data || null
    },

    async getVerifiedProfessionalIds() {
      const { data, error } = await client
        .from('profiles').select('id').eq('is_verified', true)
      if (error) throw error
      return (data || []).map(r => r.id)
    },

    async getMedicalBusinessIds(medicalTypes) {
      const { data, error } = await client
        .from('businesses').select('id')
        .in('business_type', medicalTypes)
        .eq('status', 'active')
      if (error) throw error
      return (data || []).map(r => r.id)
    },

    async getExperiments() {
      const { data, error } = await client
        .from('content_distribution_experiments')
        .select('key, label, enabled, rollout_pct, variant, config, start_at, end_at')
      if (error) throw error
      return data || []
    },

    async reportPost(postId, userId, reason, description) {
      const { error } = await client
        .from('reports').insert({ entity_type: 'post', entity_id: postId, user_id: userId, reason, description })
      if (error) throw error
    },

    async insertReview(payload) {
      const { error } = await client.from('reviews').insert(payload)
      if (error) throw error
    },

    async insertProductReview(payload) {
      const { error } = await client.from('product_reviews').insert(payload)
      if (error) throw error
    },

    async insertUnclaimedEntity(payload) {
      await client.from('unclaimed_entities').insert(payload)
    },

    async getFeedConfig(userId) {
      const { data, error } = await client
        .from('feed_config')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'feed_tab')
        .maybeSingle()
      if (error) throw error
      return data || null
    },

    async upsertFeedConfig(userId, value) {
      const { error } = await client
        .from('feed_config')
        .upsert({ user_id: userId, key: 'feed_tab', value })
      if (error) throw error
    },

    async getLiveSessions() {
      const { data, error } = await client
        .from('live_sessions')
        .select('*, profiles(full_name, display_name, specialty)')
        .eq('status', 'live')
        .order('started_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data || []
    },

    async getLatestNews() {
      const { data, error } = await client
        .from('news')
        .select('id, headline, hero_image_url, published_at')
        .eq('status', 'approved')
        .order('published_at', { ascending: false })
        .limit(6)
      if (error) throw error
      return data || []
    },

    async getPlatformLive() {
      const { data, error } = await client
        .from('live_shows')
        .select('id, title')
        .eq('status', 'live')
        .eq('is_platform', true)
        .order('started_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return data && data[0] ? data[0] : null
    },

    async getSeriesList() {
      const { data, error } = await client
        .from('playlists')
        .select('id, title, description, owner_id, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data || []
    },

    async createLiveSession(payload) {
      const { data, error } = await client.from('live_sessions').insert(payload).select().maybeSingle()
      if (error) throw error
      return data
    },

    async createLiveShow(payload) {
      const { data, error } = await client.from('live_shows').insert(payload).select().maybeSingle()
      if (error) throw error
      return data
    },

    async addLiveParticipant(payload) {
      const { error } = await client.from('live_participants').insert(payload)
      if (error) throw error
    },

    async insertNotification(payload) {
      const { error } = await client.from('notifications').insert(payload)
      if (error) throw error
    },

    async getUnreadNotificationCount(userId) {
      const { count, error } = await client
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId)
        .eq('read', false)
      if (error) throw error
      return count || 0
    },
  }
}

export const postRepository = createPostRepository()
