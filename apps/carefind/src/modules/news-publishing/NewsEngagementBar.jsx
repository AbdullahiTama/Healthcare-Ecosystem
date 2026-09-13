import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../config/supabaseClient'
import { notify } from '../../services/notify.js'
import { Bookmark, Heart, MessageCircle, Share2 } from 'lucide-react'
import { theme } from '../../styles/theme'
import { shareOrCopy } from '../../utils/share.js'

function NewsEngagementBar({ article, user, compact, onNavigate }) {
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(article.like_count || 0)
  const [commentCount, setCommentCount] = useState(article.comment_count || 0)
  const [saved, setSaved] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!user) return
      const [reactRes, saveRes] = await Promise.all([
        supabase.from('news_reactions').select('id').eq('news_id', article.id).eq('user_id', user.id).maybeSingle(),
        supabase.from('saved_news').select('id').eq('news_id', article.id).eq('user_id', user.id).maybeSingle(),
      ])
      if (!cancelled) {
        setLiked(!!reactRes.data)
        setSaved(!!saveRes.data)
      }
    }
    load()
    return () => { cancelled = true }
  }, [article.id, user])

  async function toggleLike(e) {
    e.stopPropagation()
    e.preventDefault()
    if (!user) { window.location.href = '/login'; return }
    if (busy) return
    setBusy(true)
    const wasLiked = liked
    setLiked(!wasLiked)
    setLikeCount(c => wasLiked ? Math.max(0, c - 1) : c + 1)
    if (wasLiked) {
      const { error } = await supabase.from('news_reactions').delete().eq('news_id', article.id).eq('user_id', user.id)
      if (error) { setLiked(false); setLikeCount(c => c + 1) }
    } else {
      const { error } = await supabase.from('news_reactions').insert({ news_id: article.id, user_id: user.id })
      if (error) {
        setLiked(false); setLikeCount(c => Math.max(0, c - 1))
      } else if (article.author_id && article.author_id !== user.id) {
        notify({ recipientId: article.author_id, actorId: user.id, type: 'news_like', message: 'liked your article', link: `/news/${article.id}`, postId: article.id })
      }
    }
    setBusy(false)
  }

  function handleComment(e) {
    e.stopPropagation()
    e.preventDefault()
    window.location.href = `/news/${article.id}?comments=true`
  }

  async function handleShare(e) {
    e.stopPropagation()
    e.preventDefault()
    const text = article.subtitle ? `${article.headline} — ${article.subtitle}` : article.headline
    const result = await shareOrCopy({
      title: article.headline,
      text,
      url: `${window.location.origin}/news/${article.id}`,
    })
    if (result === 'copied') setShareMsg('Link copied')
    else if (result === 'failed') setShareMsg('Could not share')
    if (result === 'copied' || result === 'failed') setTimeout(() => setShareMsg(''), 3000)
  }

  async function toggleSave(e) {
    e.stopPropagation()
    e.preventDefault()
    if (!user) { window.location.href = '/login'; return }
    if (busy) return
    setBusy(true)
    const wasSaved = saved
    setSaved(!wasSaved)
    if (wasSaved) {
      const { error } = await supabase.from('saved_news').delete().eq('news_id', article.id).eq('user_id', user.id)
      if (error) setSaved(true)
    } else {
      const { error } = await supabase.from('saved_news').insert({ news_id: article.id, user_id: user.id })
      if (error) setSaved(false)
    }
    setBusy(false)
  }

  function fmt(n) {
    n = n || 0
    if (n < 1000) return `${n}`
    if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`.replace('.0k', 'k')
    return `${(n / 1000000).toFixed(1)}M`.replace('.0M', 'M')
  }

  const iconSize = compact ? 15 : 18
  const minHeight = compact ? 32 : 40
  const padding = compact ? '4px 6px' : '8px 10px'

  return (
    <div
      className="cf-eng-row"
      onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
      style={{ padding: compact ? '2px 0' : '4px 0', marginTop: compact ? 4 : 8 }}
    >
      <div className="cf-eng-group">
        <button
          className="cf-eng-item"
          onClick={toggleLike}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike this article' : 'Like this article'}
          style={{ color: liked ? theme.danger : theme.gray500, minHeight, padding }}
        >
          <Heart size={iconSize} aria-hidden="true" fill={liked ? theme.danger : 'none'} />
          {!compact && likeCount > 0 && <span>{fmt(likeCount)}</span>}
        </button>

        <button
          className="cf-eng-item"
          onClick={handleComment}
          aria-label="Comments on this article"
          style={{ color: theme.gray500, minHeight, padding }}
        >
          <MessageCircle size={iconSize} aria-hidden="true" />
          {!compact && commentCount > 0 && <span>{fmt(commentCount)}</span>}
        </button>

        <button
          className="cf-eng-item"
          onClick={handleShare}
          aria-label="Share this article"
          style={{ color: theme.gray500, minHeight, padding }}
        >
          <Share2 size={iconSize} aria-hidden="true" />
          {!compact && <span>Share</span>}
        </button>
      </div>

      <div className="cf-eng-group">
        {shareMsg && (
          <span style={{ fontSize: 11, color: theme.gray500, fontWeight: 600, marginRight: 4 }}>{shareMsg}</span>
        )}
        <button
          className="cf-eng-item"
          onClick={toggleSave}
          aria-pressed={saved}
          aria-label={saved ? 'Remove from saved' : 'Save this article'}
          style={{ color: saved ? theme.tealDeep : theme.gray500, minHeight, padding }}
        >
          <Bookmark size={iconSize} aria-hidden="true" fill={saved ? theme.tealDeep : 'none'} />
        </button>
      </div>
    </div>
  )
}

export default NewsEngagementBar
