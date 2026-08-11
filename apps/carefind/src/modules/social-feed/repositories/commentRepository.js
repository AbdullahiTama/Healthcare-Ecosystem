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
        profiles!user_id (
          id,
          display_name,
          full_name,
          is_verified,
          specialty,
          avatar_url
        )
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data || []
  },

  async addComment(postId, userId, content, parentId = null) {
    const payload = { post_id: postId, user_id: userId, content }
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
  }
}