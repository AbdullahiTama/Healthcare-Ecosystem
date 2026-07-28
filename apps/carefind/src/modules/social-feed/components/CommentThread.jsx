import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../config/supabaseClient'
import { useAuth } from '../../../providers/AuthContext'
import { notify } from '../../../services/notify.js'
import { commentRepository } from '../repositories'
import { Avatar, TealBtn } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import { Pencil, Trash2, X, BadgeCheck } from 'lucide-react'

function getCommentName(comment) {
  return comment.profiles?.full_name || comment.profiles?.display_name || 'CareFind User'
}

export function CommentThread({ postId, user, comments, onCommentsChange, editingComment, setEditingComment, replyingTo, setReplyingTo, commentDrafts, setCommentDrafts, myUsername, myAvatar }) {
  const [isLoading, setIsLoading] = useState(false)

  const handleAddComment = useCallback(async (parentId, overrideText) => {
    const text = overrideText || (commentDrafts[postId] || '').trim()
    if (!text || !user) return

    setIsLoading(true)
    try {
      const newComment = await commentRepository.addComment(postId, user.id, text, parentId)
      if (newComment) {
        setCommentDrafts(prev => {
          const cleared = { ...prev, [postId]: '' }
          if (parentId) {
            const replyKey = Object.keys(cleared).find(k => k.startsWith(`${postId}_reply_`))
            if (replyKey) delete cleared[replyKey]
          }
          return cleared
        })
        setReplyingTo(null)

        const fresh = await commentRepository.getComments(postId)
        onCommentsChange(fresh)
      }
    } finally {
      setIsLoading(false)
    }
  }, [postId, user, commentDrafts, onCommentsChange, setCommentDrafts, setReplyingTo])

  const handleEditComment = useCallback(async (commentId, newContent) => {
    if (!newContent.trim()) return
    setIsLoading(true)
    try {
      await commentRepository.updateComment(commentId, user.id, newContent.trim())
      setEditingComment(null)
const fresh = await commentRepository.getComments(postId)
      onCommentsChange(fresh)
    } finally {
      setIsLoading(false)
    }
  }, [postId, user, onCommentsChange])

  const handleDeleteComment = useCallback(async (commentId) => {
    setIsLoading(true)
    try {
      await commentRepository.deleteComment(commentId, user.id)
      onCommentsChange(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId))
    } finally {
      setIsLoading(false)

  const allComments = Array.isArray(comments) ? comments : []
  const topLevel = allComments.filter(c => !c.parent_id)
  const replies = allComments.filter(c => c.parent_id)
  const repliesByParent = {}
  replies.forEach(r => {
    if (!repliesByParent[r.parent_id]) repliesByParent[r.parent_id] = []
    repliesByParent[r.parent_id].push(r)
  })

  function renderComment(comment, depth) {
    const childReplies = repliesByParent[comment.id] || []
    const parentComment = allComments.find(c => c.id === comment.parent_id)
    const parentName = parentComment ? getCommentName(parentComment) : 'unknown'

    return (
      <div key={comment.id} style={{
        marginLeft: depth * 20,
        marginBottom: 10,
        borderLeft: depth > 0 ? `2px solid ${depth === 1 ? `${theme.tealDeep}22` : depth === 2 ? `${theme.tealDeep}33` : `${theme.tealDeep}44`}` : 'none',
        paddingLeft: depth > 0 ? 10 : 0,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0 }}>
            <Link to={`/u/${comment.user_id}`} style={{ textDecoration: 'none' }}>
              <Avatar name={getCommentName(comment)} src={comment.profiles?.avatar_url} size={depth > 0 ? 26 : 30} />
            </Link>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              background: depth > 0 ? `${theme.tealDeep}08` : theme.bg,
              borderRadius: 12,
              padding: depth > 0 ? '6px 10px' : '8px 10px',
              border: depth > 0 ? `1px solid ${theme.border}` : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Link to={`/u/${comment.user_id}`} style={{ textDecoration: 'none' }}>
                    <span style={{ fontSize: depth > 0 ? 11 : 12, fontWeight: 800, color: theme.navy }}>
                      {getCommentName(comment)}
                    </span>
                  </Link>
                  {comment.profiles?.is_verified && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 800, color: theme.tealDeep }}>
                      <BadgeCheck size={11} /> {comment.profiles?.specialty || ''}
                    </span>
                  )}
                </div>
                {user && comment.user_id === user.id && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setEditingComment({ id: comment.id, content: comment.content, post_id: postId })} aria-label="Edit comment" style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textLight, display: 'flex', alignItems: 'center', padding: 2 }}><Pencil size={13} /></button>
                    <button onClick={() => handleDeleteComment(comment.id)} aria-label="Delete comment" style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.alert, display: 'flex', alignItems: 'center', padding: 2 }}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
              {editingComment?.id === comment.id ? (
                <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
                  <input
                    value={editingComment.content}
                    onChange={e => setEditingComment({ ...editingComment, content: e.target.value })}
                    style={{ flex: 1, padding: '5px 8px', fontSize: 12, border: `1px solid ${theme.tealDeep}`, borderRadius: 8 }}
                  />
                  <button onClick={() => handleEditComment(comment.id, editingComment.content)} style={{ padding: '5px 10px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Save</button>
                  <button onClick={() => setEditingComment(null)} aria-label="Cancel edit" style={{ padding: '5px 8px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', cursor: 'pointer' }}><X size={13} /></button>
                </div>
              ) : (
                <div>
                  {depth > 0 && (
                    <span style={{ fontSize: 10.5, color: theme.textLight, fontWeight: 600 }}>
                      @{parentName}
                    </span>
                  )}
                  <p style={{ margin: depth > 0 ? '0 0 2px' : 0, fontSize: 13, color: theme.textMid, lineHeight: 1.4 }}>{comment.content}</p>
                </div>
              )}
            </div>
            {user && (
              <button
                onClick={() => setReplyingTo(replyingTo?.commentId === comment.id && replyingTo?.postId === postId ? null : { commentId: comment.id, postId: postId })}
                style={{ background: 'none', border: 'none', fontSize: 11, fontWeight: 700, color: theme.textLight, cursor: 'pointer', padding: '4px 4px 0' }}
              >
                Reply
              </button>
            )}
            {replyingTo?.commentId === comment.id && replyingTo?.postId === postId && (
              <div style={{ marginTop: 6, marginLeft: 4 }}>
                <div style={{ fontSize: 10.5, color: theme.textLight, fontWeight: 600, marginBottom: 4 }}>
                  Replying to <span style={{ color: theme.tealDeep }}>@{getCommentName(comment)}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={commentDrafts[`${postId}_reply_${comment.id}`] || ''}
                    onChange={e => setCommentDrafts(prev => ({ ...prev, [`${postId}_reply_${comment.id}`]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { const txt = commentDrafts[`${postId}_reply_${comment.id}`] || ''; if (txt.trim()) handleAddComment(comment.id, txt) } }}
                    placeholder="Write a reply..."
                    style={{ flex: 1, padding: '6px 10px', fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 16, outline: 'none' }}
                  />
                  <button onClick={() => { const txt = commentDrafts[`${postId}_reply_${comment.id}`] || ''; if (txt.trim()) handleAddComment(comment.id, txt) }} style={{ padding: '6px 12px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Reply</button>
                </div>
              </div>
            )}
            {childReplies.map(r => renderComment(r, depth + 1))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 10, borderTop: `1px solid ${theme.border}` }}>
      {topLevel.map(c => renderComment(c, 0))}

      {user ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          <Avatar name={myUsername || user.email} src={myAvatar} size={28} />
          <input
            type="text"
            value={commentDrafts[postId] || ''}
            onChange={e => setCommentDrafts(prev => ({ ...prev, [postId]: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handleAddComment(null, e.target.value)}
            placeholder="Add a comment"
            style={{ flex: 1, padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 20, outline: 'none' }}
          />
          <TealBtn onClick={() => handleAddComment(null)} style={{ padding: '10px 16px', borderRadius: 20, fontSize: 12 }} disabled={isLoading}>
            {isLoading ? 'Posting...' : 'Post'}
          </TealBtn>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: theme.textLight }}>
          <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log in</Link> to comment.
        </p>
      )}
    </div>
  )
}