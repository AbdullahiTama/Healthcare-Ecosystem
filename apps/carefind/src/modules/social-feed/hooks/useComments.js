import { useState, useCallback } from 'react'
import { supabase } from '../../../config/supabaseClient'
import { useAuth } from '../../../providers/AuthContext'
import { notify } from '../../../services/notify.js'

export function useComments(postId) {
  const { user } = useAuth()
  const [comments, setComments] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [commentDrafts, setCommentDrafts] = useState({})
  const [editingComment, setEditingComment] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [commentCount, setCommentCount] = useState(0)

  const loadComments = useCallback(async () => {
    if (!postId) return
    setLoading(true)
    try {
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
      setComments(data || [])
      setCommentCount(data?.length || 0)
    } catch (e) {
      console.error('Load comments error:', e)
    } finally {
      setLoading(false)
    }
  }, [postId])

  const toggleComments = useCallback(() => {
    const willOpen = !open
    setOpen(willOpen)
    if (willOpen && comments.length === 0) {
      loadComments()
    }
  }, [open, comments.length, loadComments])

  const addComment = useCallback(async (parentId = null, overrideText = null) => {
    if (!user) return
    const text = overrideText || (commentDrafts[postId] || '').trim()
    if (!text) return

    try {
      const payload = { post_id: postId, user_id: user.id, content: text }
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

      setComments(prev => [...prev, data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)))
      setCommentCount(prev => prev + 1)

      setCommentDrafts(prev => {
        const cleared = { ...prev, [postId]: '' }
        if (parentId) {
          const replyKey = Object.keys(cleared).find(k => k.startsWith(`${postId}_reply_`))
          if (replyKey) delete cleared[replyKey]
        }
        return cleared
      })
      setReplyingTo(null)

      if (parentId) {
        const parentComment = comments.find(c => c.id === parentId)
        if (parentComment && parentComment.user_id !== user.id) {
          notify({ recipientId: parentComment.user_id, actorId: user.id, type: 'reply', message: 'replied to you', link: '/', postId })
        }
      } else {
        // For top-level comments, we'd need the post - could be passed in
      }

      return data
    } catch (e) {
      console.error('Add comment error:', e)
    }
  }, [postId, user, commentDrafts, comments, notify])

  const updateComment = useCallback(async (commentId, content) => {
    if (!user) return
    try {
      const { error } = await supabase
        .from('post_comments')
        .update({ content: content.trim() })
        .eq('id', commentId)
        .eq('user_id', user.id)

      if (error) throw error

      setEditingComment(null)
      await loadComments()
    } catch (e) {
      console.error('Update comment error:', e)
    }
  }, [user, loadComments])

  const deleteComment = useCallback(async (commentId) => {
    if (!user) return
    try {
      const { error } = await supabase
        .from('post_comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', user.id)

      if (error) throw error

      setComments(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId))
      setCommentCount(prev => Math.max(0, prev - 1))
    } catch (e) {
      console.error('Delete comment error:', e)
    }
  }, [user])

  const setDraft = useCallback((key, value) => {
    setCommentDrafts(prev => ({ ...prev, [key]: value }))
  }, [])

  return {
    comments,
    open,
    loading,
    commentDrafts,
    editingComment,
    replyingTo,
    commentCount,
    toggleComments,
    addComment,
    updateComment,
    deleteComment,
    setEditingComment,
    setReplyingTo,
    setDraft,
    loadComments
  }
}