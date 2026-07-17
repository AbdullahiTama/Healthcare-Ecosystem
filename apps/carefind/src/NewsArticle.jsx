import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'
import ArticleEditor from './ArticleEditor.jsx'
import GiftPanel from './GiftPanel.jsx'
import SupportPrompt from './SupportPrompt.jsx'

function NewsArticle() {
  const { id } = useParams()
  const { user } = useAuth()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState([])
  const [likes, setLikes] = useState([])
  const [saved, setSaved] = useState(false)
  const [comments, setComments] = useState([])
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [gifting, setGifting] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('news')
        .select('id, headline, subtitle, body, hero_image_url, published_at, created_at, status, author_id, view_count, profiles(full_name, display_name, verification_label, is_verified)')
        .eq('id', id)
        .maybeSingle()
      setArticle(data || null)
      if (data) supabase.rpc('increment_news_view', { news_id: data.id })

      // A few more approved stories to show at the bottom
      const { data: moreData } = await supabase
        .from('news')
        .select('id, headline, hero_image_url, published_at, created_at')
        .eq('status', 'approved')
        .neq('id', id)
        .order('published_at', { ascending: false })
        .limit(4)
      setMore(moreData || [])
      setLoading(false)
      window.scrollTo(0, 0)

      // Engagement data
      loadEngagement()
    }
    load()
  }, [id])

  async function loadEngagement() {
    const [likeRes, commentRes] = await Promise.all([
      supabase.from('news_reactions').select('id, user_id').eq('news_id', id),
      supabase.from('news_comments').select('id, content, created_at, user_id, profiles(full_name, display_name, is_verified)').eq('news_id', id).order('created_at', { ascending: true }),
    ])
    setLikes(likeRes.data || [])
    setComments(commentRes.data || [])
    if (user) {
      const { data: sv } = await supabase.from('saved_news').select('id').eq('news_id', id).eq('user_id', user.id).maybeSingle()
      setSaved(!!sv)
    }
  }

  const likeCount = likes.length
  const userLiked = user && likes.some(l => l.user_id === user.id)

  async function toggleLike() {
    if (!user) { window.location.href = '/login'; return }
    if (userLiked) {
      setLikes(prev => prev.filter(l => l.user_id !== user.id))
      await supabase.from('news_reactions').delete().eq('news_id', id).eq('user_id', user.id)
    } else {
      setLikes(prev => [...prev, { id: `t${Date.now()}`, user_id: user.id }])
      await supabase.from('news_reactions').insert({ news_id: id, user_id: user.id })
    }
  }

  async function toggleSave() {
    if (!user) { window.location.href = '/login'; return }
    if (saved) {
      setSaved(false)
      await supabase.from('saved_news').delete().eq('news_id', id).eq('user_id', user.id)
    } else {
      setSaved(true)
      await supabase.from('saved_news').insert({ news_id: id, user_id: user.id })
    }
  }

  async function addComment() {
    const text = commentDraft.trim()
    if (!text || !user) { if (!user) window.location.href = '/login'; return }
    const { error } = await supabase.from('news_comments').insert({ news_id: id, user_id: user.id, content: text })
    if (!error) {
      setCommentDraft('')
      const { data } = await supabase.from('news_comments').select('id, content, created_at, user_id, profiles(full_name, display_name, is_verified)').eq('news_id', id).order('created_at', { ascending: true })
      setComments(data || [])
    }
  }

  async function deleteComment(cid) {
    await supabase.from('news_comments').delete().eq('id', cid).eq('user_id', user.id)
    setComments(prev => prev.filter(c => c.id !== cid))
  }

  function timeAgoShort(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`
    return `${Math.floor(diff / 86400)}d`
  }

  function formatCount(n) {
    n = n || 0
    if (n < 1000) return `${n}`
    if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`.replace('.0k', 'k')
    return `${(n / 1000000).toFixed(1)}M`.replace('.0M', 'M')
  }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  function authorName(a) {
    return a?.profiles?.full_name || a?.profiles?.display_name || 'CareFind Contributor'
  }

  if (loading) return <div style={{ padding: 20, fontFamily: 'system-ui' }}>Loading…</div>

  if (!article || article.status !== 'approved') {
    return (
      <div style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 38, marginBottom: 12 }}>📰</div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 6px 0' }}>Article not available</h3>
          <p style={{ fontSize: 13, color: theme.textLight }}>This story may have been removed or is still under review.</p>
          <Link to="/news" style={{ display: 'inline-block', marginTop: 16, padding: '10px 20px', background: theme.tealGradient, color: '#fff', borderRadius: 14, textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>Back to News</Link>
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90, background: '#fff' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${theme.border}`, fontFamily: 'system-ui' }}>
        <Link to="/news" style={{ fontSize: 13, fontWeight: 700, color: theme.textMid, textDecoration: 'none' }}>← News</Link>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: theme.tealDeep, textTransform: 'uppercase' }}>CareFind Health News</span>
        <button
          onClick={() => { if (navigator.share) navigator.share({ title: article.headline, url: window.location.href }) }}
          style={{ background: 'none', border: 'none', fontSize: 16, color: theme.textMid }}
        >↗</button>
      </div>

      <div style={{ padding: '20px 18px 0' }}>
        {/* Kicker */}
        <p style={{ margin: '0 0 10px 0', fontFamily: 'system-ui', fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: theme.tealDeep, textTransform: 'uppercase' }}>Health</p>

        {/* Headline */}
        <h1 style={{ margin: '0 0 12px 0', fontSize: 29, fontWeight: 900, color: theme.navy, lineHeight: 1.12, letterSpacing: '-0.02em' }}>
          {article.headline}
        </h1>

        {/* Subtitle */}
        {article.subtitle && (
          <p style={{ margin: '0 0 16px 0', fontSize: 17, color: theme.textMid, lineHeight: 1.45, fontStyle: 'italic' }}>
            {article.subtitle}
          </p>
        )}

        {/* Byline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`, marginBottom: 18, fontFamily: 'system-ui' }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 15 }}>
            {(authorName(article)[0] || 'C').toUpperCase()}
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: theme.navy }}>
              By {authorName(article)}
              {article.profiles?.is_verified && <span style={{ color: theme.tealDeep, marginLeft: 4 }}>✓</span>}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>
              {article.profiles?.verification_label ? `${article.profiles.verification_label} · ` : ''}{formatDate(article.published_at || article.created_at)} · 👁 {formatCount(article.view_count)}
            </p>
          </div>
        </div>
      </div>

      {/* Hero image */}
      {article.hero_image_url && (
        <figure style={{ margin: '0 0 20px 0' }}>
          <img src={article.hero_image_url} alt={article.headline} style={{ width: '100%', display: 'block' }} />
        </figure>
      )}

      {/* Body */}
      <div style={{ padding: '0 18px' }}>
        <div style={{ fontSize: 17, lineHeight: 1.7, color: '#1f2937' }}>
          <ArticleEditor value={article.body} readOnly />
        </div>
      </div>

      {/* End mark */}
      <div style={{ textAlign: 'center', padding: '24px 0 8px' }}>
        <span style={{ fontSize: 18, color: theme.tealDeep, fontWeight: 900 }}>■</span>
      </div>

      {/* Engagement bar (X-style inline) */}
      <style>{`
        .neng { display: flex; align-items: center; justify-content: space-between; padding: 10px 18px; border-top: 1px solid ${theme.border}; border-bottom: 1px solid ${theme.border}; margin: 8px 0; }
        .neng-item { background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 6px 2px; -webkit-tap-highlight-color: transparent; transition: transform 0.08s; font-family: system-ui; }
        .neng-item:active { transform: scale(0.88); }
        .neng-item span { font-size: 13px; font-weight: 600; }
      `}</style>
      <div className="neng">
        {/* Comment */}
        <button className="neng-item" onClick={() => setCommentsOpen(!commentsOpen)}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#536471" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span style={{ color: '#536471' }}>{comments.length ? formatCount(comments.length) : ''}</span>
        </button>
        {/* Share */}
        <button className="neng-item" onClick={() => { if (navigator.share) navigator.share({ title: article.headline, url: window.location.href }) }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#536471" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        </button>
        {/* Like */}
        <button className="neng-item" onClick={toggleLike}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill={userLiked ? '#f91880' : 'none'} stroke={userLiked ? '#f91880' : '#536471'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span style={{ color: userLiked ? '#f91880' : '#536471' }}>{likeCount ? formatCount(likeCount) : ''}</span>
        </button>
        {/* Views */}
        <button className="neng-item" style={{ cursor: 'default' }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#536471" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="10"/></svg>
          <span style={{ color: '#536471' }}>{formatCount(article.view_count)}</span>
        </button>
        {/* Save */}
        <button className="neng-item" onClick={toggleSave}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill={saved ? theme.tealDeep : 'none'} stroke={saved ? theme.tealDeep : '#536471'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
        {/* Gift */}
        <button className="neng-item" onClick={() => user ? setGifting(true) : window.location.href = '/login'}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={theme.tealDeep} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
        </button>
      </div>

      {/* Comments section */}
      {commentsOpen && (
        <div style={{ padding: '4px 18px 8px', fontFamily: 'system-ui' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>Comments ({comments.length})</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addComment() }} placeholder={user ? 'Add a comment…' : 'Log in to comment'} disabled={!user} style={{ flex: 1, padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 20, boxSizing: 'border-box' }} />
            <button onClick={addComment} style={{ padding: '0 16px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 20, fontWeight: 800, fontSize: 13 }}>Post</button>
          </div>
          {comments.length === 0 && <p style={{ fontSize: 12.5, color: theme.textLight }}>Be the first to comment.</p>}
          {comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                {(c.profiles?.full_name?.[0] || c.profiles?.display_name?.[0] || '?').toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px 0', fontSize: 12.5 }}>
                  <strong style={{ color: theme.navy }}>{c.profiles?.full_name || c.profiles?.display_name || 'User'}</strong>
                  {c.profiles?.is_verified && <span style={{ color: theme.tealDeep, marginLeft: 3 }}>✓</span>}
                  <span style={{ color: theme.textLight, marginLeft: 6, fontWeight: 500 }}>{timeAgoShort(c.created_at)}</span>
                </p>
                <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid, lineHeight: 1.4 }}>{c.content}</p>
              </div>
              {user && c.user_id === user.id && (
                <button onClick={() => deleteComment(c.id)} style={{ background: 'none', border: 'none', color: theme.textLight, fontSize: 15 }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Gift panel */}
      {gifting && (
        <GiftPanel postId={article.id} recipientId={article.author_id} onClose={() => setGifting(false)} />
      )}

      {article.author_id && <SupportPrompt onGift={() => user ? setGifting(true) : (window.location.href = '/login')} creatorName="this article" />}

      {/* More news */}
      {more.length > 0 && (
        <div style={{ borderTop: `8px solid ${theme.bg}`, marginTop: 12, padding: '16px 18px' }}>
          <p style={{ margin: '0 0 12px 0', fontFamily: 'system-ui', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: theme.tealDeep, textTransform: 'uppercase' }}>More from CareFind News</p>
          {more.map((m) => (
            <Link key={m.id} to={`/news/${m.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12, padding: '10px 0', borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 800, color: theme.navy, lineHeight: 1.25 }}>{m.headline}</h4>
                <p style={{ margin: 0, fontFamily: 'system-ui', fontSize: 11, color: theme.textLight }}>{formatDate(m.published_at || m.created_at)}</p>
              </div>
              {m.hero_image_url && (
                <div style={{ width: 74, height: 74, borderRadius: 6, flexShrink: 0, background: `url(${m.hero_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              )}
            </Link>
          ))}
        </div>
      )}

      <BottomNav />
    </div>
  )
}

export default NewsArticle
