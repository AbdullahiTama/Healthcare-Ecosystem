import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../config/supabaseClient'
import { useAuth } from '../../../providers/AuthContext'
import { notify } from '../../../services/notify.js'
import { commentRepository } from '../repositories'
import { renderMarkdown } from '../markdown.jsx'
import { extractMentions } from '../mentions.js'
import { Avatar, TealBtn } from '../../../components/ui'
import VerifiedBadge from '../../../components/VerifiedBadge.jsx'
import { theme } from '../../../styles/theme'
import { Heart, Pencil, Trash2, X } from 'lucide-react'

function getCommentName(comment) {
  return comment.profiles?.full_name || comment.profiles?.display_name || 'CareFind User'
}

// A multi-line comment box that grows with its content (issue #6). CareFind
// comments used to be a single-line <input>, which silently truncated anything
// longer than one visual line and gave authors no way to write a paragraph.
// This wraps naturally, has no word/character limit, and sends on Enter while
// Shift+Enter inserts a newline — the same affordance the reply box had.
function AutoTextarea({ value, onChange, onSend, placeholder, ariaLabel, rows = 1 }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          const text = value.trim()
          if (text) onSend(text)
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={rows}
      style={{
        flex: 1, padding: '8px 12px', fontSize: 13, lineHeight: 1.45,
        border: `1px solid ${theme.border}`, borderRadius: 20, outline: 'none',
        resize: 'none', fontFamily: 'inherit', maxHeight: 180, overflowY: 'auto',
        boxSizing: 'border-box',
      }}
    />
  )
}

// Build the @username -> user id map used to link mentions in a comment body.
function mentionsMap(comment) {
  const map = {}
  ;(comment.mentions || []).forEach(m => { map[String(m.username).toLowerCase()] = m.user_id })
  return map
}

export function CommentThread({ postId, user, comments, onCommentsChange, editingComment, setEditingComment, replyingTo, setReplyingTo, commentDrafts, setCommentDrafts, myUsername, myAvatar, onCommentAdded }) {
  const [isLoading, setIsLoading] = useState(false)

  const handleAddComment = useCallback(async (parentId, overrideText) => {
    const text = overrideText || (commentDrafts[postId] || '').trim()
    if (!text || !user) return

    setIsLoading(true)
    try {
      const usernames = extractMentions(text)
      const mentions = usernames.length ? await commentRepository.resolveMentions(usernames) : []
      const newComment = await commentRepository.addComment(postId, user.id, text, parentId, mentions)
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
        // Tell the parent a comment (or reply) landed so it can notify the
        // post author (and, for a reply, the comment author). Fire-and-forget.
        if (onCommentAdded) onCommentAdded({ postId, parentId })
        // Notify everyone mentioned (@username) in the comment. Fire-and-forget;
        // notify() already skips notifying yourself.
        mentions.forEach(m => {
          if (m.user_id !== user.id) {
            notify({ recipientId: m.user_id, actorId: user.id, type: 'mention', message: 'mentioned you in a comment', link: '/feed', postId })
          }
        })
      }
    } finally {
      setIsLoading(false)
    }
  }, [postId, user, commentDrafts, onCommentsChange, setCommentDrafts, setReplyingTo, onCommentAdded])

  const handleToggleCommentLike = useCallback(async (comment) => {
    if (!user) return
    const likedByMe = (comment.post_comment_likes || []).some(l => l.user_id === user.id)
    try {
      if (likedByMe) {
        await commentRepository.removeCommentLike(comment.id, user.id)
      } else {
        await commentRepository.addCommentLike(comment.id, user.id)
        // Notify the comment author that their comment was liked. Fire-and-forget.
        if (comment.user_id !== user.id) {
          notify({ recipientId: comment.user_id, actorId: user.id, type: 'comment_like', message: 'liked your comment', link: '/feed', postId })
        }
      }
      const fresh = await commentRepository.getComments(postId)
      onCommentsChange(fresh)
    } catch (e) {
      notify('Could not update like right now.', { type: 'error' })
    }
  }, [postId, user, onCommentsChange])

  const handleEditComment = useCallback(async (commentId, newContent) => {
    if (!newContent.trim()) return
    setIsLoading(true)
    try {
      await commentRepository.updateComment(commentId, user.id, newContent.trim())
      setEditingComment(null)
      const fresh = await commentRepository.getComments(postId)
      onCommentsChange(fresh)
    } catch (e) {
      notify('Could not save edit — comment may have been removed', { type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }, [postId, user, onCommentsChange])

  const handleDeleteComment = useCallback(async (commentId) => {
    setIsLoading(true)
    try {
      await commentRepository.deleteComment(commentId, user.id)
      const fresh = await commentRepository.getComments(postId)
      onCommentsChange(fresh)
    } finally {
      setIsLoading(false)
    }
  }, [postId, onCommentsChange])

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
                    <VerifiedBadge profile={comment.profiles} size={11} style={{ fontSize: 9, fontWeight: 800 }} />
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
                  <div style={{ margin: depth > 0 ? '0 0 2px' : 0, fontSize: 13, color: theme.textMid, lineHeight: 1.4 }}>{renderMarkdown(comment.content, { mentions: mentionsMap(comment) })}</div>
                </div>
              )}
            </div>
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px 0 0' }}>
                <button
                  onClick={() => handleToggleCommentLike(comment)}
                  aria-label={(comment.post_comment_likes || []).some(l => l.user_id === user.id) ? 'Unlike this comment' : 'Like this comment'}
                  style={{ background: 'none', border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '4px 4px 0', display: 'inline-flex', alignItems: 'center', gap: 4, color: (comment.post_comment_likes || []).some(l => l.user_id === user.id) ? theme.alert : theme.textLight }}
                >
                  <Heart size={11} fill={(comment.post_comment_likes || []).some(l => l.user_id === user.id) ? theme.alert : 'none'} />
                  {(comment.post_comment_likes || []).length > 0 && <span>{comment.post_comment_likes.length}</span>}
                </button>
                <button
                  onClick={() => setReplyingTo(replyingTo?.commentId === comment.id && replyingTo?.postId === postId ? null : { commentId: comment.id, postId: postId })}
                  style={{ background: 'none', border: 'none', fontSize: 11, fontWeight: 700, color: theme.textLight, cursor: 'pointer', padding: '4px 4px 0' }}
                >
                  Reply
                </button>
              </div>
            )}
            {replyingTo?.commentId === comment.id && replyingTo?.postId === postId && (
              <div style={{ marginTop: 6, marginLeft: 4 }}>
                <div style={{ fontSize: 10.5, color: theme.textLight, fontWeight: 600, marginBottom: 4 }}>
                  Replying to <span style={{ color: theme.tealDeep }}>@{getCommentName(comment)}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  <AutoTextarea
                    value={commentDrafts[`${postId}_reply_${comment.id}`] || ''}
                    onChange={(v) => setCommentDrafts(prev => ({ ...prev, [`${postId}_reply_${comment.id}`]: v }))}
                    onSend={(txt) => handleAddComment(comment.id, txt)}
                    placeholder="Write a reply..." ariaLabel="Write a reply"
                  />
                  <button onClick={() => { const txt = commentDrafts[`${postId}_reply_${comment.id}`] || ''; if (txt.trim()) handleAddComment(comment.id, txt) }} style={{ padding: '6px 12px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Reply</button>
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
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'flex-end' }}>
          <Avatar name={myUsername || user.email} src={myAvatar} size={28} />
          <AutoTextarea
            value={commentDrafts[postId] || ''}
            onChange={(v) => setCommentDrafts(prev => ({ ...prev, [postId]: v }))}
            onSend={() => handleAddComment(null)}
            placeholder="Add a comment" ariaLabel="Add a comment"
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