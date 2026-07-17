import { useEffect, useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import VoiceRecorder from './VoiceRecorder.jsx'
import SlideUploader from './SlideUploader.jsx'
import VideoUploader from './VideoUploader.jsx'
import VideoRecorder from './VideoRecorder.jsx'

function LiveDashboard() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [show, setShow] = useState(null)
  const [participants, setParticipants] = useState([])
  const [items, setItems] = useState([])
  const [stats, setStats] = useState({ likes: 0, views: 0, shares: 0, gifts: 0 })
  const [comments, setComments] = useState([])
  const [draft, setDraft] = useState('')
  const [image, setImage] = useState(null)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef(null)

  const isHost = user && show && user.id === show.host_id
  const isParticipant = user && (isHost || participants.some(p => p.user_id === user.id))

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    load()
    pollRef.current = setInterval(() => { loadItems(); loadComments(); loadStats() }, 4000)
    return () => clearInterval(pollRef.current)
  }, [id, user])

  async function loadStats() {
    const [likeRes, shareRes, viewRes, giftRes] = await Promise.all([
      supabase.from('live_reactions').select('id', { count: 'exact', head: true }).eq('show_id', id),
      supabase.from('live_shares').select('id', { count: 'exact', head: true }).eq('show_id', id),
      supabase.from('live_views').select('id', { count: 'exact', head: true }).eq('show_id', id),
      supabase.from('gifts').select('coins').eq('post_id', id),
    ])
    setStats(prev => ({
      likes: Math.max(prev.likes, likeRes.count || 0),
      shares: Math.max(prev.shares, shareRes.count || 0),
      views: Math.max(prev.views, viewRes.count || 0),
      gifts: Math.max(prev.gifts, (giftRes.data || []).reduce((s, g) => s + (g.coins || 0), 0)),
    }))
  }

  function fmtCount(n) {
    n = n || 0
    if (n < 1000) return `${n}`
    if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`.replace('.0k', 'k')
    return `${(n / 1000000).toFixed(1)}M`.replace('.0M', 'M')
  }

  async function load() {
    setLoading(true)
    const { data: showData } = await supabase.from('live_shows').select('*').eq('id', id).maybeSingle()
    setShow(showData || null)
    const { data: parts } = await supabase
      .from('live_participants')
      .select('user_id, role, joined, profiles(full_name, display_name)')
      .eq('show_id', id)
    setParticipants(parts || [])
    // Mark self as joined
    if (user) {
      await supabase.from('live_participants').update({ joined: true }).eq('show_id', id).eq('user_id', user.id)
    }
    await loadItems()
    await loadComments()
    await loadStats()
    setLoading(false)
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
      .select('id, content, hidden, created_at, profiles(full_name, display_name)')
      .eq('show_id', id)
      .order('created_at', { ascending: false })
      .limit(60)
    setComments(data || [])
  }

  async function sendItem() {
    if (!draft.trim() && !image) return
    setSending(true)
    if (image) {
      const ext = image.name.split('.').pop()
      const path = `live-${id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('live-media').upload(path, image)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
        await supabase.from('live_items').insert({ show_id: id, sender_id: user.id, kind: 'image', content: urlData.publicUrl })
      }
      setImage(null)
    }
    if (draft.trim()) {
      await supabase.from('live_items').insert({ show_id: id, sender_id: user.id, kind: 'text', content: draft.trim() })
      setDraft('')
    }
    setSending(false)
    loadItems()
  }

  async function hideComment(cid) {
    await supabase.from('live_comments').update({ hidden: true }).eq('id', cid)
    loadComments()
  }

  async function sendVoice(url) {
    await supabase.from('live_items').insert({ show_id: id, sender_id: user.id, kind: 'voice', content: url })
    loadItems()
  }

  async function sendSlide(url, num, total) {
    await supabase.from('live_items').insert({ show_id: id, sender_id: user.id, kind: 'slide', content: `${url}|||${num}|||${total}` })
    loadItems()
  }

  async function sendVideo(url) {
    await supabase.from('live_items').insert({ show_id: id, sender_id: user.id, kind: 'video', content: url })
    loadItems()
  }

  async function endShow() {
    if (!window.confirm('End this live show for everyone?')) return
    await supabase.from('live_shows').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id)
    navigate('/')
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m`
    return `${Math.floor(diff / 3600)}h`
  }

  if (loading) return <div style={{ padding: 20, fontFamily: 'system-ui' }}>Loading dashboard…</div>

  if (!show) return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '0 auto', padding: 40, textAlign: 'center' }}>
      <p style={{ fontSize: 15, fontWeight: 800, color: theme.navy }}>Show not found</p>
      <Link to="/" style={{ color: theme.tealDeep, fontWeight: 700 }}>Back to Feed</Link>
    </div>
  )

  if (!isParticipant) return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '0 auto', padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 34, marginBottom: 10 }}>🔒</div>
      <p style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>Not a participant</p>
      <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 16px 0' }}>You weren't invited to host this show. You can watch it live instead.</p>
      <Link to={`/live-show/${id}`} style={{ display: 'inline-block', padding: '10px 20px', background: theme.tealGradient, color: '#fff', borderRadius: 14, textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>Watch the show</Link>
    </div>
  )

  const ended = show.status === 'ended'
  const scheduled = show.status === 'scheduled'

  async function startNow() {
    await supabase.from('live_shows').update({ status: 'live', started_at: new Date().toISOString() }).eq('id', id)
    load()
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 30, background: '#fff', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ background: theme.navy, padding: '16px', color: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ended ? '#94a3b8' : '#dc2626' }} />
            <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.05em' }}>{ended ? 'ENDED' : 'LIVE — CONTROL ROOM'}</span>
          </span>
          <Link to={`/live-show/${id}`} style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontWeight: 700 }}>View audience →</Link>
        </div>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{show.title || 'CareFind Live'}</p>
        <p style={{ margin: '2px 0 0 0', fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
          {participants.length} participant{participants.length !== 1 ? 's' : ''}
          {' · '}{participants.filter(p => p.joined).length} joined
        </p>
        <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>❤️ {fmtCount(stats.likes)}</span>
          <span style={{ fontSize: 13, fontWeight: 800 }}>👁 {fmtCount(stats.views)}</span>
          <span style={{ fontSize: 13, fontWeight: 800 }}>🔗 {fmtCount(stats.shares)}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#fde68a' }}>🎁 {fmtCount(stats.gifts)}</span>
        </div>
      </div>

      {scheduled && (
        <div style={{ margin: 14, padding: 16, background: theme.navy, borderRadius: 14, color: '#fff', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: 13, fontWeight: 800 }}>⏳ This show is scheduled</p>
          <p style={{ margin: '0 0 12px 0', fontSize: 11.5, color: 'rgba(255,255,255,0.7)' }}>Your audience sees a countdown. When you're ready, start it live.</p>
          <button onClick={startNow} style={{ padding: '11px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14 }}>📡 Start Live Now</button>
        </div>
      )}

      {!ended && !scheduled && (
        <>
          {/* Composer */}
          <div style={{ padding: 14, borderBottom: `1px solid ${theme.border}` }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type something to post live…"
              rows={2}
              style={{ width: '100%', padding: 11, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit', marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', flex: 1 }}>
                📷 {image ? image.name.slice(0, 20) : 'Add image'}
                <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files[0] || null)} style={{ display: 'none' }} />
              </label>
              <button onClick={sendItem} disabled={sending} style={{ padding: '10px 22px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14 }}>
                {sending ? 'Sending…' : '📡 Post Live'}
              </button>
            </div>
            <VoiceRecorder showId={id} onRecorded={sendVoice} />
            <SlideUploader showId={id} onPostSlide={sendSlide} />
            <VideoRecorder showId={id} onRecorded={sendVideo} />
            <VideoUploader showId={id} onUploaded={sendVideo} />
            <p style={{ margin: '4px 0 0 0', fontSize: 10.5, color: theme.textLight }}>Post text, images, or voice notes — they go live instantly.</p>
          </div>
        </>
      )}

      {/* Posted items so far */}
      <div style={{ padding: '12px 14px' }}>
        <p style={{ margin: '0 0 10px 0', fontSize: 11, fontWeight: 800, color: theme.textLight, textTransform: 'uppercase' }}>Posted to show ({items.length})</p>
        {items.length === 0 && <p style={{ fontSize: 12.5, color: theme.textLight }}>Nothing posted yet. Your first post goes live to the audience.</p>}
        {items.map((it) => (
          <div key={it.id} style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 11, flexShrink: 0 }}>
              {(it.profiles?.full_name?.[0] || it.profiles?.display_name?.[0] || '?').toUpperCase()}
            </div>
            <div style={{ flex: 1, background: theme.bg, borderRadius: 10, padding: it.kind === 'image' ? 4 : '8px 12px' }}>
              {it.kind === 'text' && <p style={{ margin: 0, fontSize: 13.5, color: theme.textDark, whiteSpace: 'pre-wrap' }}>{it.content}</p>}
              {it.kind === 'image' && <img src={it.content} alt="posted" style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }} />}
              {it.kind === 'voice' && <audio controls src={it.content} style={{ height: 36, maxWidth: 220 }} />}
              {it.kind === 'video' && <video controls playsInline src={it.content} style={{ maxWidth: 200, borderRadius: 8, display: 'block' }} />}
              {it.kind === 'slide' && <div><span style={{ fontSize: 10, fontWeight: 800, color: theme.tealDeep }}>📑 Slide {(it.content||'').split('|||')[1]}</span><img src={(it.content||'').split('|||')[0]} alt="slide" style={{ maxWidth: '100%', borderRadius: 8, display: 'block', marginTop: 3 }} /></div>}
            </div>
          </div>
        ))}
      </div>

      {/* Audience comments (moderation) */}
      <div style={{ borderTop: `8px solid ${theme.bg}`, padding: '12px 14px' }}>
        <p style={{ margin: '0 0 10px 0', fontSize: 11, fontWeight: 800, color: theme.textLight, textTransform: 'uppercase' }}>💬 Audience comments — respond or moderate</p>
        {comments.length === 0 && <p style={{ fontSize: 12.5, color: theme.textLight }}>No comments yet.</p>}
        {comments.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10, opacity: c.hidden ? 0.4 : 1 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 1px 0', fontSize: 11.5 }}>
                <strong style={{ color: theme.navy }}>{c.profiles?.full_name || c.profiles?.display_name || 'User'}</strong>
                <span style={{ color: theme.textLight, marginLeft: 6 }}>{timeAgo(c.created_at)}</span>
                {c.hidden && <span style={{ color: theme.alert, marginLeft: 6, fontWeight: 700 }}>(hidden)</span>}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>{c.content}</p>
            </div>
            {!c.hidden && (
              <button onClick={() => hideComment(c.id)} style={{ background: 'none', border: 'none', color: theme.alert, fontSize: 11, fontWeight: 700 }}>Hide</button>
            )}
          </div>
        ))}
      </div>

      {/* End show (host only) */}
      {isHost && !ended && (
        <div style={{ padding: 16 }}>
          <button onClick={endShow} style={{ width: '100%', padding: 13, background: '#fef2f2', color: theme.alert, border: `1px solid ${theme.alert}`, borderRadius: 12, fontWeight: 800, fontSize: 14 }}>
            ⏹ End Live Show
          </button>
        </div>
      )}
      {ended && (
        <div style={{ padding: 16, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: theme.textLight }}>This show has ended.</p>
          <Link to="/" style={{ color: theme.tealDeep, fontWeight: 700, fontSize: 13 }}>Back to Feed</Link>
        </div>
      )}
    </div>
  )
}

export default LiveDashboard
