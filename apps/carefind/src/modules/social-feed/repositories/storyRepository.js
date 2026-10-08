import { supabase } from '../../../config/supabaseClient'

export function createStoryRepository({ client = supabase } = {}) {
  return {
    async getActiveStoriesByUsers(userIds) {
      if (!userIds || userIds.length === 0) return []
      const { data, error } = await client
        .from('stories')
        .select('id, user_id, expires_at')
        .in('user_id', userIds)
        .gt('expires_at', new Date().toISOString())
      if (error) throw error
      return data || []
    },

    async getStoriesByUser(userId) {
      const { data, error } = await client
        .from('stories')
        .select('id, title, body, image_url, bg_color, created_at, user_id, view_count, is_platform, expires_at')
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async createStory(payload) {
      const { error } = await client.from('stories').insert(payload)
      if (error) throw error
    },

    async getStoryReactions(storyId) {
      const { data, error } = await client
        .from('story_reactions').select('id, user_id').eq('story_id', storyId)
      if (error) throw error
      return data || []
    },

    async addStoryReaction(storyId, userId) {
      const { error } = await client
        .from('story_reactions').insert({ story_id: storyId, user_id: userId, type: 'like' })
      if (error) throw error
    },

    async removeStoryReaction(storyId, userId) {
      const { error } = await client
        .from('story_reactions').delete().eq('story_id', storyId).eq('user_id', userId)
      if (error) throw error
    },

    async getStoryComments(storyId) {
      const { data, error } = await client
        .from('story_comments')
        .select('id, content, created_at, user_id, parent_id, profiles(full_name, display_name, avatar_url)')
        .eq('story_id', storyId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },

    async addStoryComment(storyId, userId, content) {
      const { data, error } = await client
        .from('story_comments')
        .insert({ story_id: storyId, user_id: userId, content })
        .select('id, content, created_at, user_id, profiles(full_name, display_name, avatar_url)')
        .single()
      if (error) throw error
      return data
    },
  }
}

export const storyRepository = createStoryRepository()
