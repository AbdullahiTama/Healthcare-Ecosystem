import { useEffect, useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { ensureProfile } from '../../services/ensureProfile.js'
import {
  Eye, FileText, Film, Gift, Heart, Lightbulb, MessageSquare, Play,
  Radio, Repeat2, Share2, X,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import GiftPanel from '../subscriptions-monetization/GiftPanel.jsx'
import SupportPrompt from '../../components/SupportPrompt.jsx'
import { Loading, Toast, useToast } from '../../components/ui'
import { shareOrCopy } from '../../utils/share.js'
import { toShareText } from '../../utils/formatShare.js'

function LiveShow() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [show, setShow] = useState(null)
  const [items, setItems] = useState([])
  const [comments, setComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [likeCount, setLikeCount] = useState(0)
  const [statsLoaded, setStatsLoaded] = useState(false)
  const [shareCount, setShareCount] = useState(0)
  const [giftTotal, setGiftTotal] = useState(0)
  const [topGifters, setTopGifters] = useState([])
  const [activity, setActivity] = useState([])
  const [viewCount, setViewCount] = useState(0)
  const [whoOpen, setWhoOpen] = useState(null) // 'likes' | 'gifts' | 'shares' | 'views' | null
  const [whoList, setWhoList] = useState([])
  const [now, setNow] = useState(Date.now())
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const [hearts, setHearts] = useState([])
  const [gifting, setGifting] = useState(false)
  const [reposted, setReposted] = useState(false)
  const pollRef = useRef(null)
  const heartId = useRef(0)

  function formatCount(n) {
    n = n || 0
    if (n < 1000) return `${n}`
    if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`.replace('.0k', 'k')
    return `${(n / 1000000).toFixed(1)}M`.replace('.0M', 'M')
  }

  const isHost = user && show && (user.id === show.host_id || user.id === show.guest_id)

  useEffect(() => {
    loadShow()
    // Poll every 4 seconds for new items + comments (the "live" feel)
    pollRef.current = setInterval(() => {
      loadItems()
      loadComments()
      loadStats()
    }, 4000)
    return () => clearInterval(pollRef.current)
  }, [id])

  async function loadStats() {
    const [likeRes, shareRes, giftRes, recentLikes, viewRes] = await Promise.all([
      supabase.from('live_reactions').select('id').eq('show_id', id),
      supabase.from('live_shares').select('id').eq('show_id', id),
      supabase.from('gifts').select('coins, sender_id, created_at, profiles:sender_id(full_name, display_name)').eq('post_id', id),
      supabase.from('live_reactions').select('created_at, profiles(full_name, display_name)').eq('show_id', id).order('created_at', { ascending: false }).limit(8),
      supabase.from('live_views').select('id').eq('show_id', id),
    ])
    // Real row counts (array length is reliable; head:true count can return null right after login)
    const likeN = (likeRes.data || []).length
    const shareN = (shareRes.data || []).length
    const viewN = (viewRes.data || []).length
    // Only update if we actually got data (don't overwrite a good number with 0 on a failed read)
    if (!likeRes.error) setLikeCount(c => Math.max(c, likeN))
    if (!shareRes.error) setShareCount(c => Math.max(c, shareN))
    if (!viewRes.error) setViewCount(c => Math.max(c, viewN))
    const gifts = giftRes.data || []
    setGiftTotal(gifts.reduce((sum, g) => sum + (g.coins || 0), 0))
    const byUser = {}
    gifts.forEach(g => {
      if (!g.sender_id) return
      const name = g.profiles?.full_name || g.profiles?.display_name || 'Someone'
      byUser[g.sender_id] = byUser[g.sender_id] || { name, total: 0 }
      byUser[g.sender_id].total += (g.coins || 0)
    })
    setTopGifters(Object.values(byUser).sort((a, b) => b.total - a.total).slice(0, 3))
    // Live activity feed: recent likers + gifters
    const acts = []
    ;(recentLikes.data || []).forEach(r => {
      acts.push({ type: 'like', name: r.profiles?.full_name || r.profiles?.display_name || 'Someone', at: r.created_at })
    })
    gifts.slice(-5).forEach(g => {
      acts.push({ type: 'gift', name: g.profiles?.full_name || g.profiles?.display_name || 'Someone', at: g.created_at, amount: g.coins })
    })
    acts.sort((a, b) => new Date(b.at) - new Date(a.at))
    setActivity(acts.slice(0, 6))
    if (!likeRes.error) setStatsLoaded(true)
  }

  async function loadLikes() { loadStats() }

  async function openWho(kind) {
    setWhoOpen(kind)
    setWhoList([])
    let data = []
    if (kind === 'likes') {
      const r = await supabase.from('live_reactions').select('user_id, created_at, profiles(id, full_name, display_name, is_verified, specialty, verification_label)').eq('show_id', id).order('created_at', { ascending: false }).limit(100)
      data = (r.data || []).map(x => ({ ...x.profiles, when: x.created_at }))
    } else if (kind === 'shares') {
      const r = await supabase.from('live_shares').select('user_id, created_at, profiles(id, full_name, display_name, is_verified, specialty, verification_label)').eq('show_id', id).order('created_at', { ascending: false }).limit(100)
      data = (r.data || []).map(x => ({ ...x.profiles, when: x.created_at }))
    } else if (kind === 'views') {
      const r = await supabase.from('live_views').select('user_id, created_at, profiles(id, full_name, display_name, is_verified, specialty, verification_label)').eq('show_id', id).order('created_at', { ascending: false }).limit(100)
      data = (r.data || []).map(x => ({ ...x.profiles, when: x.created_at }))
    } else if (kind === 'gifts') {
      const r = await supabase.from('gifts').select('sender_id, coins, created_at, profiles:sender_id(id, full_name, display_name, is_verified, specialty, verification_label)').eq('post_id', id).order('created_at', { ascending: false }).limit(100)
      data = (r.data || []).map(x => ({ ...x.profiles, amount: x.coins, when: x.created_at }))
    }
    // Filter out null profiles (guests/anon), keep unique
    setWhoList(data.filter(d => d && d.id))
  }

  function spawnHeart(xPercent) {
    const baseLeft = xPercent != null ? xPercent : (20 + Math.random() * 55)
    const emojis = ['❤️', '💚', '💛', '🧡', '💜', '💖', '💗']
    const burst = 3 + Math.floor(Math.random() * 3)
    for (let k = 0; k < burst; k++) {
      const hid = heartId.current++
      const left = Math.max(5, Math.min(90, baseLeft + (Math.random() * 40 - 20)))
      const emoji = emojis[Math.floor(Math.random() * emojis.length)]
      const size = 28 + Math.floor(Math.random() * 34)
      const drift = Math.floor(Math.random() * 80 - 40)
      const dur = 2.2 + Math.random() * 1.3
      const delay = k * 60
      setTimeout(() => {
        setHearts(prev => [...prev, { id: hid, left, emoji, size, drift, dur }])
        setTimeout(() => setHearts(prev => prev.filter(h => h.id !== hid)), dur * 1000)
      }, delay)
    }
  }

  async function tapLike() {
    spawnHeart()
    setLikeCount(c => c + 1)
    supabase.from('live_reactions').insert({ show_id: id, user_id: user?.id || null })
  }

  async function tapAnywhere(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    spawnHeart(Math.max(10, Math.min(85, xPct)))
    setLikeCount(c => c + 1)
    supabase.from('live_reactions').insert({ show_id: id, user_id: user?.id || null })
  }

  async function shareLive() {
    setShareCount(c => c + 1)
    supabase.from('live_shares').insert({ show_id: id, user_id: user?.id || null })
    const text = toShareText(show?.title ? `Watch ${show.title} live on CareFind` : 'Watch this live on CareFind')
    const result = await shareOrCopy({ title: show?.title || 'CareFind Live', text, url: window.location.href })
    if (result === 'copied') showToast('Live link copied! Share it anywhere.', { type: 'success' })
    else if (result === 'failed') showToast("This browser won't let us share or copy from here.", { type: 'error' })
  }

  async function repostLive() {
    if (!user) { window.location.href = '/login'; return }
    if (reposted) return
    setReposted(true)
    // Repost counts as a share too
    setShareCount(c => c + 1)
    supabase.from('live_shares').insert({ show_id: id, user_id: user.id })
    await ensureProfile(user)
    await supabase.from('posts').insert({
      user_id: user.id,
      content: `🔁 Reposted a live show: ${show?.title || 'CareFind Live'}\n${window.location.href}`,
      post_type: 'text',
    })
  }

  async function loadShow() {
    setLoading(true)
    const { data } = await supabase
      .from('live_shows')
      .select('*, host:profiles!live_shows_host_id_fkey(full_name, display_name, is_verified, specialty, verification_label), guest:profiles!live_shows_guest_id_fkey(full_name, display_name)')
      .eq('id', id)
      .maybeSingle()
    setShow(data || null)
    await loadItems()
    await loadComments()
    await loadStats()
    setLoading(false)
    // Count a view each time someone opens the show
    recordView()
  }

  async function recordView() {
    const { error } = await supabase.from('live_views').insert({ show_id: id, user_id: user?.id || null })
    if (error) {
      // View insert failure is non-critical — silently ignored
    } else {
      // Optimistically bump the visible count so the creator sees it immediately
      setViewCount(c => c + 1)
      loadStats()
    }
  }

  async function loadItems() {
    const { data } = await supabase
      .from('live_items')
      .select('id, kind, content, created_at, sender_id, profiles(full_name, display_name)')
      .eq('show_id', id)
      .order('created_at', { ascending: false })
    setItems(data || [])
  }

  async function loadComments() {
    const { data } = await supabase
      .from('live_comments')
      .select('id, content, hidden, created_at, user_id, profiles(full_name, display_name, is_verified, specialty, verification_label)')
      .eq('show_id', id)
      .order('created_at', { ascending: false })
      .limit(100)
    setComments(data || [])
  }

  async function postComment() {
    const text = commentDraft.trim()
    if (!text) return
    if (!user) { window.location.href = '/login'; return }
    setCommentDraft('')
    await supabase.from('live_comments').insert({ show_id: id, user_id: user.id, content: text })
    loadComments()
  }

  async function hideComment(cid) {
    await supabase.from('live_comments').update({ hidden: true }).eq('id', cid)
    loadComments()
  }

  function hostName() {
    return show?.host?.full_name || show?.host?.display_name || 'CareFind'
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`
    return `${Math.floor(diff / 86400)}d`
  }

  if (loading) return <Loading text="Loading live show…" />

  if (!show) {
    const notFoundContent = (
      <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' } : { fontFamily: theme.fontFamily }}>
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><Radio size={40} color={theme.gray300} strokeWidth={1.5} aria-hidden="true" /></div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 6px 0' }}>Live show not found</h3>
          <Link to="/" style={{ display: 'inline-block', marginTop: 16, padding: '10px 20px', background: theme.tealDeep, color: '#fff', borderRadius: 14, textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>Back to Feed</Link>
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

  const isLive = show.status === 'live'
  const visibleComments = comments.filter(c => !c.hidden || isHost)

  // Scheduled/upcoming show — show countdown + trailer
  if (show.status === 'scheduled') {
    const target = show.scheduled_at ? new Date(show.scheduled_at) : null
    const diff = target ? target - now : 0
    const days = Math.max(0, Math.floor(diff / 86400000))
    const hrs = Math.max(0, Math.floor((diff % 86400000) / 3600000))
    const mins = Math.max(0, Math.floor((diff % 3600000) / 60000))
    const secs = Math.max(0, Math.floor((diff % 60000) / 1000))
    return (
      <div style={{ fontFamily: theme.fontFamily, maxWidth: isMobile ? 480 : 640, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))', background: theme.navy, minHeight: '100vh', color: '#fff' }}>
        <div style={{ padding: '18px 16px' }}>
          <Link to="/" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Feed</Link>
        </div>
        <div style={{ textAlign: 'center', padding: '20px 20px 30px' }}>
          <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', marginBottom: 16 }}>⏳ UPCOMING LIVE</div>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 8px 0' }}>{show.title}</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', margin: '0 0 24px 0' }}>
            {target ? target.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
          </p>

          {/* Countdown */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
            {[['Days', days], ['Hrs', hrs], ['Min', mins], ['Sec', secs]].map(([label, val]) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: '14px 12px', minWidth: 62 }}>
                <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{String(val).padStart(2, '0')}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: 700 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Trailer */}
          {show.trailer_url && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}><Film size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />WATCH THE TRAILER</p>
              <video src={show.trailer_url} controls playsInline style={{ width: '100%', borderRadius: 14, display: 'block' }} />
            </div>
          )}

          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Come back at showtime. A red LIVE badge will appear when we go live.</p>
        </div>
        {isMobile && <BottomNav />}
      </div>
    )
  }

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))', background: '#fff' }
      : { fontFamily: theme.fontFamily, maxWidth: 700, margin: '0 auto', background: '#fff' }}>
      {/* Header */}
      <div style={{
        background: theme.navy, padding: '18px 16px 20px', color: '#fff',
        ...(isMobile ? { position: 'sticky', top: 0, zIndex: 10 } : { borderRadius: theme.radius.xl, marginBottom: 16 }),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          {isMobile
            ? <Link to="/" style={{ color: 'rgba(255,255,255,0.75)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Feed</Link>
            : <span />}
          {isLive ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#dc2626', padding: '4px 12px', borderRadius: 20 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />
              <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.05em' }}>LIVE</span>
            </div>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,0.2)', padding: '4px 12px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Play size={11} aria-hidden="true" /> REPLAY</span>
          )}
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 4px 0', lineHeight: 1.2 }}>{show.title || 'CareFind Live'}</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', margin: 0 }}>
          Hosted by {hostName()}{<VerifiedBadge profile={show.host} size={13} style={{ color: '#fff', marginLeft: 4 }} />}
          {show.guest && ` · with ${show.guest.full_name || show.guest.display_name}`}
        </p>
        {isLive && (
          <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={() => openWho('likes')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 13, fontWeight: 800, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Heart size={13} aria-hidden="true" /> {statsLoaded ? formatCount(likeCount) : '·'}</button>
            <button onClick={() => openWho('views')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 13, fontWeight: 800, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Eye size={13} aria-hidden="true" /> {statsLoaded ? formatCount(viewCount) : '·'}</button>
            <button onClick={() => openWho('shares')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 13, fontWeight: 800, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Share2 size={13} aria-hidden="true" /> {statsLoaded ? formatCount(shareCount) : '·'}</button>
            <button onClick={() => openWho('gifts')} style={{ background: 'none', border: 'none', color: '#fde68a', fontSize: 13, fontWeight: 800, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Gift size={13} aria-hidden="true" /> {statsLoaded ? formatCount(giftTotal) : '·'}</button>
          </div>
        )}
      </div>

      {/* Live activity feed */}
      {isLive && activity.length > 0 && (
        <div style={{ padding: '8px 16px', background: theme.tealMist, borderBottom: `1px solid ${theme.border}`, overflowX: 'auto', whiteSpace: 'nowrap' }}>
          {activity.map((a, i) => (
            <span key={i} style={{ fontSize: 11.5, fontWeight: 600, color: theme.navy, marginRight: 14 }}>
              {a.type === 'gift' ? <Gift size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> : <Heart size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} />} <strong>{a.name}</strong> {a.type === 'gift' ? `gifted${a.amount ? ' ' + a.amount : ''}` : 'liked'}
            </span>
          ))}
        </div>
      )}

      {/* Live items (the show content) */}
      <div onClick={isLive ? tapAnywhere : undefined} style={{ padding: '16px 16px 8px', cursor: isLive ? 'pointer' : 'default' }}>
        {items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 20px', color: theme.textLight }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><Radio size={30} color={theme.gray300} strokeWidth={1.5} aria-hidden="true" /></div>
            <p style={{ fontSize: 13, margin: 0 }}>{isLive ? 'The show is starting… stay tuned.' : 'This show has ended.'}</p>
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} style={{ marginBottom: 14, display: 'flex', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
              {(it.profiles?.full_name?.[0] || it.profiles?.display_name?.[0] || 'C').toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 4px 0', fontSize: 12, fontWeight: 800, color: theme.navy }}>
                {it.profiles?.full_name || it.profiles?.display_name || 'CareFind'}
                <span style={{ color: theme.textLight, fontWeight: 500, marginLeft: 6 }}>{timeAgo(it.created_at)}</span>
              </p>
              {it.kind === 'slide' ? (
                <div style={{ maxWidth: '100%' }}>
                  {(() => {
                    const [surl, num, total] = (it.content || '').split('|||')
                    return (
                      <div style={{ border: `2px solid ${theme.tealDeep}`, borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
                        <div style={{ background: theme.tealDeep, color: '#fff', padding: '5px 12px', fontSize: 11, fontWeight: 800, display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><FileText size={12} aria-hidden="true" /> SLIDE {num || '?'}{total ? ` / ${total}` : ''}</span>
                        </div>
                        <img src={surl} alt={`Slide ${num}`} style={{ width: '100%', display: 'block' }} />
                      </div>
                    )
                  })()}
                </div>
              ) : (
              <div style={{ background: theme.bg, borderRadius: 14, padding: (it.kind === 'image' || it.kind === 'video') ? 4 : '10px 14px', display: 'inline-block', maxWidth: '100%' }}>
                {it.kind === 'text' && <p style={{ margin: 0, fontSize: 14.5, color: theme.textDark, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{it.content}</p>}
                {it.kind === 'image' && <img src={it.content} alt="live" style={{ maxWidth: '100%', borderRadius: 11, display: 'block' }} />}
                {it.kind === 'voice' && (
                  <audio controls preload="metadata" playsInline src={it.content} style={{ height: 40, maxWidth: 240 }} />
                )}
                {it.kind === 'video' && (
                  <video controls playsInline preload="metadata" src={it.content} style={{ maxWidth: '100%', borderRadius: 11, display: 'block' }} />
                )}
              </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Floating hearts overlay */}
      <style>{`
        @keyframes floatUpBig {
          0% { transform: translateY(0) translateX(0) scale(0.4) rotate(0deg); opacity: 0; }
          12% { opacity: 1; transform: translateY(-30px) scale(1.3) rotate(-8deg); }
          50% { opacity: 1; }
          100% { transform: translateY(-340px) translateX(var(--drift)) scale(1) rotate(12deg); opacity: 0; }
        }
      `}</style>
      <div style={{ position: 'fixed', bottom: 120, left: 0, right: 0, maxWidth: 480, margin: '0 auto', height: 0, pointerEvents: 'none', zIndex: 500 }}>
        {hearts.map(h => (
          <span key={h.id} style={{
            position: 'absolute', bottom: 0, left: `${h.left}%`, fontSize: h.size,
            '--drift': `${h.drift}px`,
            animation: `floatUpBig ${h.dur}s ease-out forwards`,
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
          }}>{h.emoji}</span>
        ))}
      </div>

      {/* Live engagement bar */}
      {isLive && (
        <div style={{ borderTop: `1px solid ${theme.border}`, borderBottom: `8px solid ${theme.bg}` }}>
          {/* Top gifters */}
          {topGifters.length > 0 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '8px 8px 4px', flexWrap: 'wrap' }}>
              {topGifters.map((g, i) => (
                <span key={i} style={{ fontSize: 10.5, fontWeight: 700, color: theme.navy, background: theme.amberSoft, padding: '2px 8px', borderRadius: 12 }}>
                  <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: '50%', marginRight: 7,
                  background: [theme.warning, theme.gray400, '#b45309'][i], color: '#fff',
                  fontSize: 10, fontWeight: 900,
                }} aria-hidden="true">{i + 1}</span>{g.name} · {formatCount(g.total)}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '4px 8px 10px' }}>
            <button onClick={tapLike} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
              <Heart size={21} aria-hidden="true" />
              <span style={{ fontSize: 11, fontWeight: 700, color: theme.textMid }}>Like</span>
            </button>
            {(show.host_id || show.guest_id) && (
              <button onClick={() => user ? setGifting(true) : (window.location.href = '/login')} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                <Gift size={21} aria-hidden="true" />
                <span style={{ fontSize: 11, fontWeight: 700, color: theme.textMid }}>Gift</span>
              </button>
            )}
            <button onClick={shareLive} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
              <Share2 size={21} aria-hidden="true" />
              <span style={{ fontSize: 11, fontWeight: 700, color: theme.textMid }}>Share</span>
            </button>
            <button onClick={repostLive} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
              <Repeat2 size={21} aria-hidden="true" />
              <span style={{ fontSize: 11, fontWeight: 700, color: reposted ? theme.tealDeep : theme.textMid }}>{reposted ? 'Reposted' : 'Repost'}</span>
            </button>
          </div>
          <p style={{ margin: 0, textAlign: 'center', fontSize: 10, color: theme.textLight, paddingBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Lightbulb size={12} aria-hidden="true" /> Tap anywhere on the show above to send hearts</p>
        </div>
      )}

      {/* Comments section */}
      <div style={{ borderTop: `8px solid ${theme.bg}`, marginTop: 12, padding: '14px 16px' }}>
        <p style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 800, color: theme.navy, display: 'flex', alignItems: 'center', gap: 7 }}><MessageSquare size={14} aria-hidden="true" /> Live comments ({visibleComments.length})</p>

        {isLive && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') postComment() }}
              placeholder={user ? 'Add a live comment…' : 'Log in to comment'}
              disabled={!user}
              style={{ flex: 1, padding: 11, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 20, boxSizing: 'border-box' }}
            />
            <button onClick={postComment} style={{ padding: '0 18px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 20, fontWeight: 800, fontSize: 13 }}>Send</button>
          </div>
        )}

        {visibleComments.length === 0 && <p style={{ fontSize: 12.5, color: theme.textLight }}>No comments yet. Be the first!</p>}
        {visibleComments.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 10, marginBottom: 12, opacity: c.hidden ? 0.4 : 1 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: theme.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
              {(c.profiles?.full_name?.[0] || c.profiles?.display_name?.[0] || '?').toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 1px 0', fontSize: 12 }}>
                <strong style={{ color: theme.navy }}>{c.profiles?.full_name || c.profiles?.display_name || 'User'}</strong>
                {<VerifiedBadge profile={c.profiles} size={12} style={{ marginLeft: 4 }} />}
                <span style={{ color: theme.textLight, marginLeft: 6 }}>{timeAgo(c.created_at)}</span>
                {c.hidden && <span style={{ color: theme.alert, marginLeft: 6, fontWeight: 700 }}>(hidden)</span>}
              </p>
              <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid, lineHeight: 1.4 }}>{c.content}</p>
            </div>
            {isHost && !c.hidden && (
              <button onClick={() => hideComment(c.id)} title="Hide comment" style={{ background: 'none', border: 'none', color: theme.textLight, fontSize: 13, fontWeight: 700 }}>Hide</button>
            )}
          </div>
        ))}
      </div>

      {show.host_id && <SupportPrompt onGift={() => user ? setGifting(true) : (window.location.href = '/login')} creatorName={hostName()} />}

      {/* Who liked/gifted/shared/viewed modal */}
      {whoOpen && (
        <div onClick={() => setWhoOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '70vh', overflowY: 'auto', padding: 18, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.navy, textTransform: 'capitalize' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                {whoOpen === 'likes' ? <><Heart size={15} aria-hidden="true" /> Likes</>
                  : whoOpen === 'gifts' ? <><Gift size={15} aria-hidden="true" /> Gifters</>
                  : whoOpen === 'shares' ? <><Share2 size={15} aria-hidden="true" /> Shares</>
                  : <><Eye size={15} aria-hidden="true" /> Viewers</>}
              </span>
              </h3>
              <button onClick={() => setWhoOpen(null)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: theme.gray400 }}><X size={18} aria-hidden="true" /></button>
            </div>
            {whoList.length === 0 && <p style={{ fontSize: 13, color: theme.textLight }}>No named {whoOpen} yet. (Guests who aren't logged in aren't listed.)</p>}
            {whoList.map((p, i) => (
              <Link key={i} to={`/u/${p.id}`} onClick={() => setWhoOpen(null)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${theme.border}`, textDecoration: 'none' }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>
                  {(p.full_name?.[0] || p.display_name?.[0] || '?').toUpperCase()}
                </div>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: theme.navy }}>
                  {p.full_name || p.display_name || 'User'}{<VerifiedBadge profile={p} size={12} style={{ marginLeft: 4 }} />}
                </span>
                {whoOpen === 'gifts' && p.amount != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 800, color: theme.tealDeep }}><Gift size={12} aria-hidden="true" /> {p.amount}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {gifting && (
        <GiftPanel postId={show.id} recipientId={show.host_id || show.guest_id} onClose={() => { setGifting(false); loadStats() }} />
      )}
      {/* Gift recipient note: host, or a co-host guest if platform-hosted */}

      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />

      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
      {bodyContent}
    </AppShell>
  )
}

export default LiveShow
