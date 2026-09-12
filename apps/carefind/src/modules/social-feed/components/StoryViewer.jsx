import { useEffect, useRef, useState } from 'react'
import { Eye, Gift, Heart, MessageCircle, Share2, X } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { renderMarkdown } from '../markdown.jsx'
import { supabase } from '../../../config/supabaseClient'
import { useAuth } from '../../../providers/AuthContext'
import { Toast, useToast } from '../../../components/ui'
import GiftPanel from '../../subscriptions-monetization/GiftPanel.jsx'

// Shared full-screen sequential story viewer used by the feed rail
// (Stories.jsx), the own-profile rail (Profile.jsx) and the public profile
// (PublicProfile.jsx). Owns the auto-advance timer, progress bars, tap zones
// and content layout so the same interaction works everywhere.
//
// Props:
//   stories       — the list of stories being watched (viewer shows stories[index])
//   index         — current story index; null/out-of-range renders nothing
//   onNavigate    — (nextIndex) => …; called on auto-advance and tap zones. The
//                   caller clamps: out of range means "close".
//   onClose       — () => …; called by the close button (and via onNavigate)
//   onViewStory   — (story) => …; fired once when a story starts displaying
//                   (view counting, seen marking)
//   renderHeader  — (story, helpers) => node; avatar + name block. helpers = { onClose }
const StoryViewer = ({ stories, index, onNavigate, onClose, onViewStory, renderHeader }) => {
  const { user } = useAuth() || { user: null }
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  const [progress, setProgress] = useState(0)
  const timerRef = useRef(null)

  const [viewersOpen, setViewersOpen] = useState(false)
  const [viewers, setViewers] = useState([])
  const [viewersLoading, setViewersLoading] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [userLiked, setUserLiked] = useState(false)
  const [commentCount, setCommentCount] = useState(0)
  const [comments, setComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [commentOpen, setCommentOpen] = useState(false)
  const [giftOpen, setGiftOpen] = useState(false)
  const [engError, setEngError] = useState('')

  const STORY_DURATION = 6000

  useEffect(() => {
    if (index === null) return
    setProgress(0)
    const st = stories[index]
    if (st && onViewStory) onViewStory(st)
    const start = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, (elapsed / STORY_DURATION) * 100)
      setProgress(pct)
      if (pct >= 100) {
        clearInterval(timerRef.current)
        onNavigate(index + 1)
      }
    }, 50)
    return () => clearInterval(timerRef.current)
  }, [index])

  const story = stories[index]
  const isExpired = story && story.expires_at && new Date(story.expires_at) <= new Date()
  const isOwner = story && user?.id && story.user_id === user.id

  // Load engagement for current story
  useEffect(() => {
    if (!story || isExpired) {
      setLikeCount(0); setUserLiked(false); setCommentCount(0); setComments([])
      return
    }
    let cancelled = false
    async function loadEng() {
      try {
        const [{ data: likeRows }, { data: commentRows }] = await Promise.all([
          supabase.from('story_reactions').select('id, user_id').eq('story_id', story.id),
          supabase.from('story_comments').select('id, content, created_at, user_id, parent_id, profiles(full_name, display_name, avatar_url)').eq('story_id', story.id).order('created_at', { ascending: true }),
        ])
        if (cancelled) return
        const likes = likeRows || []
        setLikeCount(likes.length)
        setUserLiked(user ? likes.some((r) => r.user_id === user.id) : false)
        const cmts = commentRows || []
        setComments(cmts)
        setCommentCount(cmts.length)
      } catch (e) {
        // Tables may not exist yet (pre-migration) — keep zeros
      }
    }
    loadEng()
    return () => { cancelled = true }
  }, [story?.id, user?.id, isExpired])

  if (index === null || !stories[index]) return null

  async function openViewers() {
    if (!isOwner) return
    setViewersOpen(true)
    setViewersLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_story_viewers', { p_story_id: story.id })
      if (error) {
        if (error.code === '42501') showToast('Only the owner can see who viewed', { type: 'error' })
        else showToast(error.message || 'Could not load viewers', { type: 'error' })
        setViewers([])
      } else {
        setViewers(data || [])
      }
    } catch (e) {
      setViewers([])
    }
    setViewersLoading(false)
  }

  async function handleLike() {
    if (!user) { showToast('Log in to like stories', { type: 'warning' }); return }
    if (isExpired) { showToast('This story has expired', { type: 'error' }); return }
    // RLS 42501 handling
    if (userLiked) {
      setUserLiked(false); setLikeCount((c) => Math.max(0, c - 1))
      const { error } = await supabase.from('story_reactions').delete().eq('story_id', story.id).eq('user_id', user.id)
      if (error) {
        setUserLiked(true); setLikeCount((c) => c + 1)
        if (error.code === '42501') showToast('Not allowed', { type: 'error' })
        else if (error.message?.toLowerCase().includes('expired')) showToast('This story has expired', { type: 'error' })
        else showToast(error.message || 'Could not unlike', { type: 'error' })
      }
    } else {
      setUserLiked(true); setLikeCount((c) => c + 1)
      const { error } = await supabase.from('story_reactions').insert({ story_id: story.id, user_id: user.id, type: 'like' })
      if (error) {
        setUserLiked(false); setLikeCount((c) => Math.max(0, c - 1))
        if (error.code === '42501') showToast('Not allowed', { type: 'error' })
        else if (error.code === '23505') { setUserLiked(true); setLikeCount((c) => c + 1) }
        else if (error.message?.toLowerCase().includes('expired')) showToast('This story has expired', { type: 'error' })
        else showToast(error.message || 'Could not like', { type: 'error' })
      }
    }
  }

  async function handleCommentPost() {
    const text = commentDraft.trim()
    if (!text) return
    if (!user) { showToast('Log in to comment', { type: 'warning' }); return }
    if (isExpired) { showToast('This story has expired', { type: 'error' }); return }
    const { data, error } = await supabase.from('story_comments').insert({ story_id: story.id, user_id: user.id, content: text }).select('id, content, created_at, user_id, profiles(full_name, display_name, avatar_url)').single()
    if (error) {
      if (error.code === '42501') showToast('Not allowed', { type: 'error' })
      else showToast(error.message || 'Could not post comment', { type: 'error' })
      return
    }
    setComments((prev) => [...prev, data])
    setCommentCount((c) => c + 1)
    setCommentDraft('')
  }

  async function handleShare() {
    if (isExpired) { showToast('This story has expired', { type: 'error' }); return }
    const url = `${window.location.origin}/story/${story.id}`
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url)
        showToast('Link copied', { type: 'success' })
      } else if (navigator.share) {
        await navigator.share({ title: 'CareFind Story', url })
      } else {
        showToast(url, { type: 'info' })
      }
      // Best-effort share count via story_reactions type=share? Ignore
    } catch (e) {
      showToast('Could not share', { type: 'error' })
    }
  }

  function handleGift() {
    if (isExpired) { showToast('This story has expired', { type: 'error' }); return }
    if (!user) { showToast('Log in to send a gift', { type: 'warning' }); return }
    setGiftOpen(true)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 4, padding: '10px 10px 0' }}>
        {stories.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3, background: '#fff', width: i < index ? '100%' : i === index ? `${progress}%` : '0%', transition: i === index ? 'width 0.05s linear' : 'none' }} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        {renderHeader && renderHeader(story, { onClose })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-live="polite" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#fff', fontSize: 12, fontWeight: 800, background: 'rgba(255,255,255,0.15)', padding: '5px 10px', borderRadius: 999 }}>
            <Eye size={14} aria-hidden="true" /> {story.view_count ?? 0}
          </span>
          {isOwner && (
            <button onClick={openViewers} aria-label="View who watched" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              Viewers
            </button>
          )}
        </div>
        <button onClick={onClose} aria-label="Close story" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={24} aria-hidden="true" /></button>
      </div>

      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => onNavigate(index - 1)} aria-label="Previous story" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '35%', zIndex: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} />
        <button onClick={() => onNavigate(index + 1)} aria-label="Next story" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '35%', zIndex: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} />

        {isExpired ? (
          <div style={{ width: '100%', height: '100%', background: theme.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, boxSizing: 'border-box', textAlign: 'center' }}>
            <div>
              <p style={{ color: '#fff', fontSize: 16, fontWeight: 800, margin: '0 0 6px 0' }}>Story expired</p>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, margin: 0 }}>This story is no longer available.</p>
            </div>
          </div>
        ) : story.image_url ? (
          <div style={{ width: '100%', height: '100%', background: `url(${story.image_url})`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: story.bg_color || theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, boxSizing: 'border-box' }}>
            <div style={{ textAlign: 'center', maxWidth: 340 }}>
              {story.title && <div role="heading" aria-level={2} style={{ color: '#fff', fontSize: 26, fontWeight: 900, margin: '0 0 14px 0', lineHeight: 1.2 }}>{renderMarkdown(story.title)}</div>}
              {story.body && <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 17, lineHeight: 1.5, margin: 0 }}>{renderMarkdown(story.body)}</div>}
            </div>
          </div>
        )}

        {story.image_url && (story.title || story.body) && !isExpired && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3, padding: '40px 20px 24px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}>
            {story.title && <div role="heading" aria-level={2} style={{ color: '#fff', fontSize: 20, fontWeight: 900, margin: '0 0 6px 0' }}>{renderMarkdown(story.title)}</div>}
            {story.body && <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 14, lineHeight: 1.5, margin: 0 }}>{renderMarkdown(story.body)}</div>}
          </div>
        )}
      </div>

      {/* Engagement bar */}
      <div className="cf-eng-row" aria-live="polite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '12px 10px', background: 'rgba(0,0,0,0.45)', borderTop: '1px solid rgba(255,255,255,0.15)', gap: 8 }}>
        <button className="cf-eng-item" onClick={handleLike} aria-pressed={userLiked} aria-label={userLiked ? 'Unlike story' : 'Like story'} style={{ color: userLiked ? theme.danger : '#fff', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          <Heart size={20} aria-hidden="true" fill={userLiked ? theme.danger : 'none'} /> <span>{likeCount > 0 ? likeCount : 'Like'}</span>
        </button>
        <button className="cf-eng-item" onClick={() => setCommentOpen((v) => !v)} aria-label="Comment on story" aria-expanded={commentOpen} style={{ color: '#fff', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          <MessageCircle size={20} aria-hidden="true" /> <span>{commentCount > 0 ? commentCount : 'Comment'}</span>
        </button>
        <button className="cf-eng-item" onClick={handleShare} aria-label="Share story" style={{ color: '#fff', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          <Share2 size={20} aria-hidden="true" /> Share
        </button>
        <button className="cf-eng-item" onClick={handleGift} aria-label="Send gift" style={{ color: '#fff', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          <Gift size={20} aria-hidden="true" /> Gift
        </button>
      </div>

      {commentOpen && (
        <div style={{ background: '#111', padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.15)', maxHeight: '40vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Add a comment…" aria-label="Add a comment" style={{ flex: 1, padding: '10px 12px', borderRadius: 20, border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: 13 }} />
            <button onClick={handleCommentPost} style={{ padding: '10px 16px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 20, fontWeight: 800, fontSize: 13 }}>Post</button>
          </div>
          {comments.length === 0 ? <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center', margin: 0 }}>No comments yet</p> : comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{(c.profiles?.full_name?.[0] || c.profiles?.display_name?.[0] || '?').toUpperCase()}</div>
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#fff' }}>{c.profiles?.full_name || c.profiles?.display_name || 'User'}</p>
                <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>{c.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewersOpen && (
        <div onClick={() => setViewersOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Viewers" style={{ background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 480, maxHeight: '60vh', display: 'flex', flexDirection: 'column', padding: '16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 10px', borderBottom: `1px solid ${theme.border}` }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: theme.navy }}>Viewers • {viewers.length}</h3>
              <button onClick={() => setViewersOpen(false)} aria-label="Close viewers" style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.gray400 }}><X size={20} aria-hidden="true" /></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '10px 16px 20px' }}>
              {viewersLoading ? <p style={{ textAlign: 'center', fontSize: 13, color: theme.textLight }}>Loading…</p> : viewers.length === 0 ? <p style={{ textAlign: 'center', fontSize: 13, color: theme.textLight }}>No views yet</p> : viewers.map((v) => (
                <div key={v.user_id || v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: v.avatar_url ? `url(${v.avatar_url}) center/cover` : theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13 }}>{!v.avatar_url && ((v.full_name?.[0] || v.display_name?.[0] || '?').toUpperCase())}</div>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: theme.navy }}>{v.full_name || v.display_name || 'User'}</p>
                    <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{v.viewed_at ? new Date(v.viewed_at).toLocaleString() : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {giftOpen && (
        <GiftPanel postId={null} recipientId={story.user_id} onClose={() => setGiftOpen(false)} />
      )}

      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )
}

export default StoryViewer
