import { supabase } from '../../../config/supabaseClient'

export const commentRepository = {
  async getComments(postId) {
    const { data, error } = await supabase
      .from('post_comments')
      .select(`
        id,
        content,
        created_at,
        user_id,
        parent_id,
        mentions,
        profiles!user_id (
          id,
          display_name,
          full_name,
          is_verified,
          specialty,
          avatar_url
        ),
        post_comment_likes (
          id,
          user_id
        )
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data || []
  },

  async addComment(postId, userId, content, parentId = null, mentions = []) {
    const payload = { post_id: postId, user_id: userId, content, mentions }
    if (parentId) payload.parent_id = parentId

    const { data, error } = await supabase
      .from('post_comments')
      .insert(payload)
      .select(`
        id,
        content,
        created_at,
        user_id,
        parent_id,
        mentions,
        profiles!user_id (
          id,
          display_name,
          full_name,
          is_verified,
          specialty,
          avatar_url
        )
      `)
      .single()
    if (error) throw error
    return data
  },

  async updateComment(commentId, userId, content) {
    const { data, error } = await supabase
      .from('post_comments')
      .update({ content: content.trim() })
      .eq('id', commentId)
      .eq('user_id', userId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async deleteComment(commentId, userId) {
    const { error } = await supabase
      .from('post_comments')
      .delete()
      .eq('id', commentId)
      .eq('user_id', userId)
    if (error) throw error
  },

  // Resolve @username tokens (display_name, case-insensitive) to user ids.
  // Returns [{ username, user_id }] for the mentions that match a profile.
  async resolveMentions(usernames) {
    if (!usernames || usernames.length === 0) return []
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name')
      .or(usernames.map(u => `display_name.ilike.${u}`).join(','))
    if (error) throw error
    return (data || []).map(p => ({ username: p.display_name, user_id: p.id }))
  },

  async addCommentLike(commentId, userId) {
    const { data, error } = await supabase
      .from('post_comment_likes')
      .insert({ comment_id: commentId, user_id: userId })
      .select('id, comment_id, user_id')
      .maybeSingle()
    if (error) throw error
    return data
  },

  async removeCommentLike(commentId, userId) {
    const { error } = await supabase
      .from('post_comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', userId)
    if (error) throw error
  }
}