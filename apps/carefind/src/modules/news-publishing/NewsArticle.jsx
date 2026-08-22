import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { notify } from '../../services/notify.js'
import { ArrowLeft, Bookmark, Eye, Gift, Heart, MessageCircle, Newspaper, Repeat2, Share2, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { mediaToFile, shareOrCopy } from '../../utils/share.js'
import { toShareText } from '../../utils/formatShare.js'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import { StickySidebar, SidebarSection } from '../../components/layout/SidebarSection.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import ArticleEditor from './ArticleEditor.jsx'
import GiftPanel from '../subscriptions-monetization/GiftPanel.jsx'
import SupportPrompt from '../../components/SupportPrompt.jsx'
import { Loading, Toast, useToast } from '../../components/ui'
import { renderMarkdown } from '../social-feed/markdown.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'

function NewsArticle() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const toast = useToast()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState([])
  const [likes, setLikes] = useState([])
  const [saved, setSaved] = useState(false)
  const [reposts, setReposts] = useState([])
  const [comments, setComments] = useState([])
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [gifting, setGifting] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const { data, error: readErr } = await supabase
          .from('news')
          .select('id, headline, subtitle, body, hero_image_url, published_at, created_at, status, author_id, view_count, profiles!news_author_id_fkey(full_name, display_name, verification_label, is_verified)')
          .eq('id', id)
          .maybeSingle()
        if (cancelled) return
        if (readErr) throw readErr
        setArticle(data || null)
        // Fire-and-forget view counter — never let it block or blank the page.
        if (data) supabase.rpc('increment_news_view', { news_id: data.id }).then(() => {}).catch(() => {})

        // A few more approved stories to show at the bottom
        const { data: moreData, error: moreErr } = await supabase
          .from('news')
          .select('id, headline, hero_image_url, published_at, created_at')
          .eq('status', 'approved')
          .neq('id', id)
          .order('published_at', { ascending: false })
          .limit(4)
        if (moreErr) throw moreErr
        if (!cancelled) setMore(moreData || [])
        setLoading(false)
        window.scrollTo(0, 0)

        // Engagement data
        loadEngagement()
      } catch (e) {
        console.error('News article load failed:', e)
        if (!cancelled) { setError(true); setLoading(false) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, retryKey])

  async function loadEngagement() {
    const [likeRes, commentRes, repostRes] = await Promise.all([
      supabase.from('news_reactions').select('id, user_id').eq('news_id', id),
      supabase.from('news_comments').select('id, content, created_at, user_id, profiles(full_name, display_name, is_verified, specialty, verification_label)').eq('news_id', id).order('created_at', { ascending: true }),
      supabase.from('news_reposts').select('id, user_id').eq('news_id', id),
    ])
    setLikes(likeRes.data || [])
    setComments(commentRes.data || [])
    setReposts(repostRes.data || [])
    if (user) {
      const { data: sv } = await supabase.from('saved_news').select('id').eq('news_id', id).eq('user_id', user.id).maybeSingle()
      setSaved(!!sv)
    }
  }

  const likeCount = likes.length
  const userLiked = user && likes.some(l => l.user_id === user.id)
  const repostCount = reposts.length
  const userReposted = user && reposts.some(r => r.user_id === user.id)

  // Same fallback as the feed's share (utils/share.js): Web Share where it
  // exists, clipboard everywhere else, and the user is told which happened.
  // The article's hero image is attached to the share where the browser
  // supports it (mirrors Feed.jsx's sharePost); the URL is still appended to
  // the clipboard fallback so recipients always get the media. Best-effort:
  // a failed media fetch leaves the text share intact.
  async function shareArticle() {
    const text = article.subtitle ? `${article.headline} — ${toShareText(article.subtitle)}` : article.headline
    const mediaUrl = article.hero_image_url || null
    const file = mediaUrl ? await mediaToFile(mediaUrl) : null
    const result = await shareOrCopy({ title: article.headline, text, url: `${window.location.origin}/news/${article.id}`, files: file ? [file] : undefined, mediaUrl })
    if (result === 'copied') setShareMsg('Link copied — paste it anywhere to share.')
    if (result === 'failed') setShareMsg("This browser won't let us share or copy from here.")
    if (result === 'copied' || result === 'failed') setTimeout(() => setShareMsg(''), 4000)
  }

  async function toggleLike() {
    if (!user) { window.location.href = '/login'; return }
    if (userLiked) {
      setLikes(prev => prev.filter(l => l.user_id !== user.id))
      await supabase.from('news_reactions').delete().eq('news_id', id).eq('user_id', user.id)
    } else {
      setLikes(prev => [...prev, { id: `t${Date.now()}`, user_id: user.id }])
      await supabase.from('news_reactions').insert({ news_id: id, user_id: user.id })
      // Tell the author someone liked their article (never fires for self-likes).
      notify({ recipientId: article.author_id, actorId: user.id, type: 'news_like', message: 'liked your article', link: `/news/${article.id}`, postId: article.id })
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

  // Self-contained news repost (20260816_news_reposts.sql). Unlike the feed's
  // classic repost there is no 🔁 feed-post half — news lives in its own table
  // and UI, so the reference row + count are the whole feature. Optimistic
  // like the like/save toggles; the insert returns the real row so undo has a
  // valid id to delete. The unique constraint news_reposts_news_user_uniq
  // makes a double-tap idempotent at the DB level.
  async function toggleRepost() {
    if (!user) { navigate('/login'); return }
    const existing = reposts.find(r => r.user_id === user.id)
    if (existing) {
      setReposts(prev => prev.filter(r => r.user_id !== user.id))
      const { error } = await supabase.from('news_reposts').delete().eq('id', existing.id)
      if (error) {
        setReposts(prev => [...prev, existing])
        toast.show('Could not undo repost right now.', { type: 'error' })
        return
      }
      toast.show('Repost removed', { type: 'info' })
    } else {
      const temp = { id: `temp_${Date.now()}`, user_id: user.id }
      setReposts(prev => [...prev, temp])
      const { data, error } = await supabase.from('news_reposts').insert({ news_id: id, user_id: user.id }).select().maybeSingle()
      if (error || !data) {
        setReposts(prev => prev.filter(r => r.id !== temp.id))
        toast.show('Could not repost right now.', { type: 'error' })
        return
      }
      setReposts(prev => prev.map(r => (r.id === temp.id ? data : r)))
      toast.show('Reposted', { type: 'success' })
    }
  }

  async function addComment() {
    const text = commentDraft.trim()
    if (!text || !user) { if (!user) window.location.href = '/login'; return }
    const { error } = await supabase.from('news_comments').insert({ news_id: id, user_id: user.id, content: text })
    if (!error) {
      setCommentDraft('')
      const { data } = await supabase.from('news_comments').select('id, content, created_at, user_id, profiles(full_name, display_name, is_verified, specialty, verification_label)').eq('news_id', id).order('created_at', { ascending: true })
      setComments(data || [])
      // Tell the author someone commented on their article (never self-notifies).
      notify({ recipientId: article.author_id, actorId: user.id, type: 'news_comment', message: 'commented on your article', link: `/news/${article.id}`, postId: article.id })
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

  if (loading) return <Loading />

  if (error) {
    const errContent = (
      <div style={{ fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 6px 0' }}>Couldn't open this article</h3>
        <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 16px 0' }}>Something went wrong while loading it. Please try again.</p>
        <button onClick={() => setRetryKey(k => k + 1)} style={{ padding: '10px 20px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 14, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Retry</button>
      </div>
    )
    if (isMobile) return errContent
    return (
      <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
        {errContent}
      </AppShell>
    )
  }

  if (!article || article.status !== 'approved') {
    const notFoundContent = (
      <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' } : { fontFamily: theme.fontFamily }}>
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><Newspaper size={40} color={theme.gray300} strokeWidth={1.5} aria-hidden="true" /></div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 6px 0' }}>Article not available</h3>
          <p style={{ fontSize: 13, color: theme.textLight }}>This story may have been removed or is still under review.</p>
          <Link to="/news" style={{ display: 'inline-block', marginTop: 16, padding: '10px 20px', background: theme.tealDeep, color: '#fff', borderRadius: 14, textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>Back to News</Link>
        </div>
        {isMobile && <BottomNav />}
      </div>
    )

    if (isMobile) return notFoundContent

    return (
      <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
        {notFoundContent}
      </AppShell>
    )
  }

  const sidebarContent = more.length > 0 && (
    <StickySidebar>
      <SidebarSection title="More from CareFind News">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {more.map((m) => (
            <Link key={m.id} to={`/news/${m.id}`} style={{ display: 'flex', gap: 10, textDecoration: 'none', alignItems: 'center' }}>
              <div style={{
                width: 48, height: 48, borderRadius: theme.radius.sm, flexShrink: 0,
                background: m.hero_image_url ? `url(${m.hero_image_url}) center/cover` : theme.navy,
              }} />
              <div>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: theme.navy, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.headline}</p>
                <p style={{ margin: '2px 0 0 0', fontSize: 10.5, color: theme.textLight, fontFamily: theme.fontFamily }}>{formatDate(m.published_at || m.created_at)}</p>
              </div>
            </Link>
          ))}
        </div>
      </SidebarSection>
    </StickySidebar>
  )

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontDisplay, maxWidth: 480, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))', background: '#fff' }
      : { fontFamily: theme.fontDisplay, maxWidth: 700, margin: '0 auto', background: '#fff' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${theme.border}`, fontFamily: theme.fontFamily }}>
        {isMobile
          ? (
            <Link to="/news" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, color: theme.textMid, textDecoration: 'none' }}>
              <ArrowLeft size={15} aria-hidden="true" /> News
            </Link>
          )
          : <span />}
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: theme.tealDeep, textTransform: 'uppercase' }}>CareFind Health News</span>
        <button
          onClick={shareArticle}
          aria-label="Share this article"
          style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: theme.gray500, cursor: 'pointer' }}
        >
          <Share2 size={17} aria-hidden="true" />
        </button>
      </div>

      <div style={{ padding: '20px 18px 0' }}>
        {/* Kicker */}
        <p style={{ margin: '0 0 10px 0', fontFamily: theme.fontFamily, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: theme.tealDeep, textTransform: 'uppercase' }}>Health</p>

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`, marginBottom: 18, fontFamily: theme.fontFamily }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 15 }}>
            {(authorName(article)[0] || 'C').toUpperCase()}
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: theme.navy }}>
              By {authorName(article)}
              {<VerifiedBadge profile={article.profiles} size={14} style={{ marginLeft: 4 }} />}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>
              {formatDate(article.published_at || article.created_at)}
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
          {article.body ? (
            <ArticleEditor value={article.body} readOnly />
          ) : (
            <p style={{ color: theme.textLight, fontStyle: 'italic' }}>No article content is available yet.</p>
          )}
        </div>
      </div>

      {/* End mark */}
      <div style={{ textAlign: 'center', padding: '24px 0 8px' }}>
        <span style={{ fontSize: 18, color: theme.tealDeep, fontWeight: 900 }}>■</span>
      </div>

      {/* Engagement bar — same shape, order and classes as the feed's post
          card (SCREEN_PATTERNS.md 36): reading actions left, keeping and
          supporting right. The icons used to be hand-drawn SVG copies of
          lucide glyphs with hardcoded colours and no labels. */}
      <div className="cf-eng-row" style={{ padding: '4px 18px', borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`, margin: '8px 0' }}>
        <div className="cf-eng-group">
          <button
            className="cf-eng-item"
            onClick={toggleLike}
            aria-pressed={userLiked}
            aria-label={userLiked ? 'Unlike this article' : 'Like this article'}
            style={{ color: userLiked ? theme.danger : theme.gray500 }}
          >
            <Heart size={18} aria-hidden="true" fill={userLiked ? theme.danger : 'none'} />
            {likeCount > 0 && <span>{formatCount(likeCount)} {likeCount === 1 ? 'like' : 'likes'}</span>}
          </button>

          <button
            className="cf-eng-item"
            onClick={() => setCommentsOpen(!commentsOpen)}
            aria-expanded={commentsOpen}
            aria-label="Comments on this article"
            style={{ color: theme.gray500 }}
          >
            <MessageCircle size={18} aria-hidden="true" />
            <span>{comments.length ? formatCount(comments.length) : 'Comment'}</span>
          </button>

          <button className="cf-eng-item" onClick={shareArticle} aria-label="Share this article" style={{ color: theme.gray500 }}>
            <Share2 size={18} aria-hidden="true" />
            <span>Share</span>
          </button>

          <button
            className="cf-eng-item"
            onClick={() => (user ? toggleRepost() : navigate('/login'))}
            aria-pressed={userReposted}
            aria-label={userReposted ? 'Undo repost' : 'Repost this article'}
            style={{ color: userReposted ? theme.tealDeep : theme.gray500 }}
          >
            <Repeat2 size={18} aria-hidden="true" />
            {repostCount > 0 && (
              <span>{formatCount(repostCount)} {repostCount === 1 ? 'repost' : 'reposts'}</span>
            )}
          </button>
        </div>

        <div className="cf-eng-group">
          {article.view_count > 0 && (
            <span className="cf-eng-meta" style={{ color: theme.gray400 }}>
              <Eye size={15} aria-hidden="true" /> {formatCount(article.view_count)}
            </span>
          )}

          <button
            className="cf-eng-item"
            onClick={() => (user ? setGifting(true) : navigate('/login'))}
            aria-label="Send a gift to the author"
            style={{ color: theme.tealDeep }}
          >
            <Gift size={18} aria-hidden="true" />
          </button>

          <button
            className="cf-eng-item"
            onClick={toggleSave}
            aria-pressed={saved}
            aria-label={saved ? 'Remove from saved' : 'Save this article'}
            style={{ color: saved ? theme.tealDeep : theme.gray500 }}
          >
            <Bookmark size={18} aria-hidden="true" fill={saved ? theme.tealDeep : 'none'} />
          </button>
        </div>
      </div>

      {shareMsg && (
        <p role="status" aria-live="polite" style={{ margin: '0 18px 8px', fontSize: 12.5, color: theme.gray500, fontFamily: theme.fontFamily }}>
          {shareMsg}
        </p>
      )}

      <Toast msg={toast.msg} type={toast.type} />

      {/* Comments section */}
      {commentsOpen && (
        <div style={{ padding: '4px 18px 8px', fontFamily: theme.fontFamily }}>
          <p style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>Comments ({comments.length})</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addComment() }} placeholder={user ? 'Add a comment…' : 'Log in to comment'} disabled={!user} style={{ flex: 1, padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 20, boxSizing: 'border-box' }} />
            <button onClick={addComment} style={{ padding: '0 16px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 20, fontWeight: 800, fontSize: 13 }}>Post</button>
          </div>
          {comments.length === 0 && <p style={{ fontSize: 12.5, color: theme.textLight }}>Be the first to comment.</p>}
          {comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                {(c.profiles?.full_name?.[0] || c.profiles?.display_name?.[0] || '?').toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px 0', fontSize: 12.5 }}>
                  <strong style={{ color: theme.navy }}>{c.profiles?.full_name || c.profiles?.display_name || 'User'}</strong>
                  {<VerifiedBadge profile={c.profiles} size={12} style={{ marginLeft: 3 }} />}
                  <span style={{ color: theme.textLight, marginLeft: 6, fontWeight: 500 }}>{timeAgoShort(c.created_at)}</span>
                </p>
                <div style={{ margin: 0, fontSize: 13.5, color: theme.textMid, lineHeight: 1.4 }}>{renderMarkdown(c.content)}</div>
              </div>
              {user && c.user_id === user.id && (
                <button onClick={() => deleteComment(c.id)} aria-label="Delete comment" style={{ background: 'none', border: 'none', color: theme.gray400, display: 'flex', alignItems: 'center', padding: 4, cursor: 'pointer' }}><X size={14} aria-hidden="true" /></button>
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

      {/* More news (mobile inline; desktop shows this in the sidebar instead) */}
      {isMobile && more.length > 0 && (
        <div style={{ borderTop: `8px solid ${theme.bg}`, marginTop: 12, padding: '16px 18px' }}>
          <p style={{ margin: '0 0 12px 0', fontFamily: theme.fontFamily, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: theme.tealDeep, textTransform: 'uppercase' }}>More from CareFind News</p>
          {more.map((m) => (
            <Link key={m.id} to={`/news/${m.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12, padding: '10px 0', borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 800, color: theme.navy, lineHeight: 1.25 }}>{m.headline}</h4>
                <p style={{ margin: 0, fontFamily: theme.fontFamily, fontSize: 11, color: theme.textLight }}>{formatDate(m.published_at || m.created_at)}</p>
              </div>
              {m.hero_image_url && (
                <div style={{ width: 74, height: 74, borderRadius: 6, flexShrink: 0, background: `url(${m.hero_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              )}
            </Link>
          ))}
        </div>
      )}

      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell
      user={user}
      myUsername={myUsername}
      myAvatar={myAvatar}
      unreadNotifs={unreadNotifs}
      rightSidebar={sidebarContent}
    >
      {bodyContent}
    </AppShell>
  )
}

export default NewsArticle
