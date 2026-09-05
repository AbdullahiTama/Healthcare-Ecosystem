import { supabase } from '../../../config/supabaseClient'

// PostgREST's code for "`.single()` did not get exactly one row", which is what
// getPostById throws when a post is gone AND when RLS hides it. Those two must
// stay indistinguishable to the reader — telling them apart would turn a
// permalink into an existence oracle for private posts — so callers collapse
// both into one "isn't available" message.
//
// A transport failure is a different thing: the row may be perfectly visible
// and the request simply never completed. It carries no PostgREST code, so a
// caller can tell it apart and offer a retry instead of declaring the post
// unavailable. Kept here rather than in a component because the code is this
// module's own error contract; nothing above it should have to know it.
const NO_SINGLE_ROW = 'PGRST116'

export function isPostMissingError(error) {
  return error?.code === NO_SINGLE_ROW
}

export const postRepository = {
  async getFeed(feedTab, limit = 20, offset = 0) {
    let query = supabase
      .from('posts')
      .select(`
        id,
        content,
        post_type,
        image_url,
        image_urls,
        audio_url,
        video_url,
        rating,
        is_premium,
        subscriber_only,
        preview_text,
        posting_as_business_id,
        posted_as_type,
        posted_as_id,
        posted_as_name,
        posted_as_title,
        live_session_id,
        view_count,
        theme,
        created_at,
        user_id,
        profiles!user_id (
          id,
          display_name,
          full_name,
          is_verified,
          verification_label,
          specialty,
          avatar_url
        )
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
    const { data, error } = await supabase
      .from('posts')
      .select(`
        *,
        profiles!user_id (
          id,
          display_name,
          full_name,
          is_verified,
          verification_label,
          specialty,
          avatar_url
        )
      `)
      .eq('id', postId)
      .single()
    if (error) throw error
    return data
  },

  async createPost(post) {
    const { data, error } = await supabase
      .from('posts')
      .insert(post)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async updatePost(postId, userId, updates) {
    const { data, error } = await supabase
      .from('posts')
      .update(updates)
      .eq('id', postId)
      .eq('user_id', userId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async deletePost(postId, userId) {
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', userId)
    if (error) throw error
  },

  async incrementViewCount(postId) {
    const { error } = await supabase.rpc('increment_post_view', { post_id: postId })
    if (error) throw error
  },

  async getReactions(postIds) {
    const { data, error } = await supabase
      .from('post_reactions')
      .select('id, post_id, user_id, reaction_type')
      .in('post_id', postIds)
    if (error) throw error
    return data || []
  },

  async addReaction(postId, userId, reactionType = 'like') {
    const { data, error } = await supabase
      .from('post_reactions')
      .insert({ post_id: postId, user_id: userId, reaction_type: reactionType })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async removeReaction(postId, userId) {
    const { error } = await supabase
      .from('post_reactions')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId)
    if (error) throw error
  },

  async getSavedPosts(userId) {
    const { data, error } = await supabase
      .from('saved_posts')
      .select('post_id')
      .eq('user_id', userId)
    if (error) throw error
    return (data || []).map(d => d.post_id)
  },

  async savePost(userId, postId) {
    const { data, error } = await supabase
      .from('saved_posts')
      .insert({ user_id: userId, post_id: postId })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async unsavePost(userId, postId) {
    const { error } = await supabase
      .from('saved_posts')
      .delete()
      .eq('user_id', userId)
      .eq('post_id', postId)
    if (error) throw error
  },

  async getCommentCounts(postIds) {
    const { data, error } = await supabase
      .from('post_comments')
      .select('post_id')
      .in('post_id', postIds)
    if (error) throw error
    const counts = {}
    ;(data || []).forEach(row => {
      counts[row.post_id] = (counts[row.post_id] || 0) + 1
    })
    return counts
  }
}