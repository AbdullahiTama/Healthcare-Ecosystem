import { supabase } from '../../../config/supabaseClient'

export function createNewsRepository({ client = supabase } = {}) {
  return {
    async markNewsSeen(userId) {
      const { error } = await client
        .from('profiles')
        .update({ news_last_seen: new Date().toISOString() })
        .eq('id', userId)
      if (error) throw error
    },

    async getApprovedNews() {
      const { data, error } = await client
        .from('news')
        .select('id, headline, subtitle, hero_image_url, published_at, created_at, status, author_id, profiles!news_author_id_fkey(full_name, display_name)')
        .eq('status', 'approved')
        .order('published_at', { ascending: false })
        .limit(40)
      if (error) throw error
      return data || []
    },

    async getPendingNewsByAuthor(authorId) {
      const { data, error } = await client
        .from('news')
        .select('id, headline, status, created_at')
        .eq('author_id', authorId)
        .neq('status', 'approved')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getArticleById(id) {
      const { data, error } = await client
        .from('news')
        .select('id, headline, subtitle, body, hero_image_url, published_at, created_at, status, author_id, view_count, profiles!news_author_id_fkey(full_name, display_name, verification_label, is_verified)')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data || null
    },

    async getMoreApprovedNews(excludeId) {
      const { data, error } = await client
        .from('news')
        .select('id, headline, hero_image_url, published_at, created_at')
        .eq('status', 'approved')
        .neq('id', excludeId)
        .order('published_at', { ascending: false })
        .limit(4)
      if (error) throw error
      return data || []
    },

    async insertArticle(article) {
      const { error } = await client.from('news').insert(article)
      if (error) throw error
    },

    async getReactionsByNewsId(newsId) {
      const { data, error } = await client
        .from('news_reactions')
        .select('id, user_id')
        .eq('news_id', newsId)
      if (error) throw error
      return data || []
    },

    async getReactionForUser(newsId, userId) {
      const { data, error } = await client
        .from('news_reactions')
        .select('id')
        .eq('news_id', newsId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data || null
    },

    async addReaction(newsId, userId) {
      const { error } = await client
        .from('news_reactions')
        .insert({ news_id: newsId, user_id: userId })
      if (error) throw error
    },

    async removeReaction(newsId, userId) {
      const { error } = await client
        .from('news_reactions')
        .delete()
        .eq('news_id', newsId)
        .eq('user_id', userId)
      if (error) throw error
    },

    async getCommentsByNewsId(newsId) {
      const { data, error } = await client
        .from('news_comments')
        .select('id, content, created_at, user_id, profiles(full_name, display_name, is_verified, specialty, verification_label)')
        .eq('news_id', newsId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },

    async addComment(newsId, userId, content) {
      const { error } = await client
        .from('news_comments')
        .insert({ news_id: newsId, user_id: userId, content })
      if (error) throw error
    },

    async deleteComment(commentId, userId) {
      const { error } = await client
        .from('news_comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', userId)
      if (error) throw error
    },

    async getRepostsByNewsId(newsId) {
      const { data, error } = await client
        .from('news_reposts')
        .select('id, user_id')
        .eq('news_id', newsId)
      if (error) throw error
      return data || []
    },

    async addRepost(newsId, userId) {
      const { data, error } = await client
        .from('news_reposts')
        .insert({ news_id: newsId, user_id: userId })
        .select()
        .maybeSingle()
      if (error) throw error
      return data || null
    },

    async removeRepost(repostId) {
      const { error } = await client
        .from('news_reposts')
        .delete()
        .eq('id', repostId)
      if (error) throw error
    },

    async getSavedNewsForUser(newsId, userId) {
      const { data, error } = await client
        .from('saved_news')
        .select('id')
        .eq('news_id', newsId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data || null
    },

    async addSavedNews(newsId, userId) {
      const { error } = await client
        .from('saved_news')
        .insert({ news_id: newsId, user_id: userId })
      if (error) throw error
    },

    async removeSavedNews(newsId, userId) {
      const { error } = await client
        .from('saved_news')
        .delete()
        .eq('news_id', newsId)
        .eq('user_id', userId)
      if (error) throw error
    },

    async getPendingNews() {
      const { data, error } = await client
        .from('news')
        .select('id, created_at, author_id')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  }
}

export const newsRepository = createNewsRepository()
