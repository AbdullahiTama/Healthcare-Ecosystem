import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { ensureProfile } from '../../services/ensureProfile.js'
import { BadgeCheck, Coins, Eraser, Gift, Heart, MessageSquare, Mic, Pen, Share2, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { ConfirmDialog, Loading, Toast, useToast } from '../../components/ui'

const GIFT_TIERS = [
  { emoji: '💊', label: 'Pill', coins: 1 },
  { emoji: '🩺', label: 'Stethoscope', coins: 5 },
  { emoji: '❤️', label: 'Heart', coins: 10 },
  { emoji: '⭐', label: 'Star', coins: 20 },
  { emoji: '🏆', label: 'Trophy', coins: 50 },
  { emoji: '👑', label: 'Crown', coins: 100 },
]

// ── Shared Drawing Board ──────────────────────
function LiveBoard({ sessionId, isHost, strokes, onStroke }) {
  const canvasRef = useRef(null)
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#0f172a')
  const [size, setSize] = useState(3)
  const [isDrawing, setIsDrawing] = useState(false)
  const lastPoint = useRef(null)
  const currentStroke = useRef([])

  const redraw = useCallback((allStrokes) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    allStrokes.forEach(stroke => {
      if (!stroke.points || stroke.points.length < 2) return
      ctx.beginPath()
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over'
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      stroke.points.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()
    })
    ctx.globalCompositeOperation = 'source-over'
  }, [])

  useEffect(() => { redraw(strokes) }, [strokes, redraw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.parentElement.offsetWidth
    canvas.width = w * dpr
    canvas.height = 260 * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = '260px'
    canvas.getContext('2d').scale(dpr, dpr)
    redraw(strokes)
  }, [])

  function getPoint(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = e.touches ? e.touches[0].clientX : e.clientX
    const cy = e.touches ? e.touches[0].clientY : e.clientY
    return { x: cx - rect.left, y: cy - rect.top }
  }

  function startDraw(e) {
    if (!isHost) return
    e.preventDefault(); e.stopPropagation()
    setIsDrawing(true)
    const pt = getPoint(e)
    lastPoint.current = pt
    currentStroke.current = [pt]
  }

  function draw(e) {
    if (!isDrawing || !isHost) return
    e.preventDefault(); e.stopPropagation()
    const pt = getPoint(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = tool === 'eraser' ? size * 4 : size
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
    lastPoint.current = pt
    currentStroke.current.push(pt)
  }

  function endDraw(e) {
    if (!isDrawing || !isHost) return
    e.stopPropagation()
    setIsDrawing(false)
    if (currentStroke.current.length < 2) return
    onStroke({ points: currentStroke.current, color, size: tool === 'eraser' ? size * 4 : size, eraser: tool === 'eraser' })
    currentStroke.current = []
  }

  function clearBoard() {
    onStroke({ clear: true })
    canvasRef.current.getContext('2d').clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
  }

  const COLORS = ['#0B4A3E', '#0E6F5A', '#dc2626', '#2563eb', '#7c3aed', '#f59e0b', '#ffffff']

  return (
    <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: `2px solid ${theme.tealBright}` }}>
      {isHost && (
        <div style={{ background: '#f8fafc', borderBottom: `1px solid ${theme.border}`, padding: '7px 10px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setTool('pen')} style={{ padding: '4px 9px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, background: tool === 'pen' ? theme.tealDeep : theme.bg, color: tool === 'pen' ? '#fff' : theme.textMid }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Pen size={12} aria-hidden="true" /> Pen</span></button>
          <button onClick={() => setTool('eraser')} style={{ padding: '4px 9px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, background: tool === 'eraser' ? '#fef2f2' : theme.bg, color: tool === 'eraser' ? theme.alert : theme.textMid }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Eraser size={12} aria-hidden="true" /> Erase</span></button>
          <div style={{ display: 'flex', gap: 3 }}>
            {[2,4,7,12].map(s => <button key={s} onClick={() => setSize(s)} style={{ width: s+12, height: s+12, borderRadius: '50%', background: size === s ? theme.tealDeep : '#e2e8f0', border: 'none' }} />)}
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {COLORS.map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: color === c ? '2px solid #333' : '1px solid #ccc' }} />)}
          </div>
          <button onClick={clearBoard} style={{ marginLeft: 'auto', padding: '4px 9px', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg, fontSize: 11, color: theme.textLight }}>Clear</button>
        </div>
      )}
      <div style={{ position: 'relative', background: '#fafafa', backgroundImage: 'linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)', backgroundSize: '100% 22px' }}>
        <canvas ref={canvasRef} style={{ display: 'block', touchAction: 'none', cursor: isHost ? (tool === 'eraser' ? 'cell' : 'crosshair') : 'default' }}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
        />
        {!isHost && strokes.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <p style={{ color: '#cbd5e1', fontSize: 13 }}>Waiting for host to draw...</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Voice Note Recorder ───────────────────────
function VoiceRecorder({ onSend, onError }) {
  const [recording, setRecording] = useState(false)
  const [audioURL, setAudioURL] = useState(null)
  const [duration, setDuration] = useState(0)
  const mediaRecorder = useRef(null)
  const chunks = useRef([])
  const timer = useRef(null)

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRecorder.current = new MediaRecorder(stream)
      chunks.current = []
      mediaRecorder.current.ondataavailable = e => chunks.current.push(e.data)
      mediaRecorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        setAudioURL(url)
        stream.getTracks().forEach(t => t.stop())
      }
      mediaRecorder.current.start()
      setRecording(true)
      setDuration(0)
      timer.current = setInterval(() => setDuration(d => d + 1), 1000)
    } catch { onError?.('Microphone access needed for voice notes') }
  }

  function stopRec() {
    mediaRecorder.current?.stop()
    clearInterval(timer.current)
    setRecording(false)
  }

  function sendVoice() {
    if (!audioURL) return
    onSend(audioURL)
    setAudioURL(null)
    setDuration(0)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {recording ? (
        <>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: theme.alert, animation: 'pulse 1s infinite' }} />
          <span style={{ fontSize: 12, color: theme.alert, fontWeight: 700 }}>{Math.floor(duration/60)}:{String(duration%60).padStart(2,'0')}</span>
          <button onClick={stopRec} style={{ padding: '6px 14px', background: theme.alert, color: '#fff', border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>⏹ Stop</button>
        </>
      ) : audioURL ? (
        <>
          <audio src={audioURL} controls style={{ height: 30, flex: 1 }} />
          <button onClick={sendVoice} style={{ padding: '6px 12px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>Send</button>
          <button onClick={() => setAudioURL(null)} style={{ padding: '6px 8px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 20, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }} aria-label="Discard recording"><X size={13} aria-hidden="true" /></button>
        </>
      ) : (
        <button onClick={startRec} style={{ padding: '6px 12px', background: theme.bg, border: `1px solid ${theme.border}`, color: theme.textMid, borderRadius: 20, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><Mic size={13} aria-hidden="true" /> Voice</button>
      )}
    </div>
  )
}

// ── Main Live Session ─────────────────────────
export default function LiveSession() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [session, setSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [strokes, setStrokes] = useState([])
  const [viewers, setViewers] = useState(0)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [giftPanel, setGiftPanel] = useState(false)
  const [giftAnim, setGiftAnim] = useState(null)
  const [likes, setLikes] = useState(0)
  const [liked, setLiked] = useState(false)
  const [likeAnim, setLikeAnim] = useState(false)
  const [wallet, setWallet] = useState(0)
  const [confirmEndOpen, setConfirmEndOpen] = useState(false)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  const chatEndRef = useRef(null)
  const channelRef = useRef(null)

  const isHost = session?.host_id === user?.id

  useEffect(() => {
    loadSession()
    if (user) loadWallet()
    return () => { channelRef.current?.unsubscribe() }
  }, [id, user])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadSession() {
    const { data } = await supabase.from('live_sessions').select('*, profiles(full_name, display_name, avatar_url, specialty, is_verified)').eq('id', id).single()
    if (!data) { navigate('/feed'); return }
    setSession(data)
    setStrokes(data.board_strokes || [])
    setLikes(data.likes || 0)
    setLoading(false)

    // Load existing messages
    const { data: msgs } = await supabase.from('live_messages').select('*, profiles(full_name, display_name, avatar_url)').eq('session_id', id).order('created_at').limit(100)
    setMessages(msgs || [])

    // Subscribe to realtime
    const channel = supabase.channel(`live:${id}`)
      .on('broadcast', { event: 'stroke' }, ({ payload }) => {
        if (payload.clear) { setStrokes([]); return }
        setStrokes(prev => [...prev, payload.stroke])
      })
      .on('broadcast', { event: 'like' }, ({ payload }) => {
        setLikes(payload.count)
        setLikeAnim(true)
        setTimeout(() => setLikeAnim(false), 600)
      })
      .on('broadcast', { event: 'gift' }, ({ payload }) => {
        setGiftAnim(payload)
        setTimeout(() => setGiftAnim(null), 3000)
      })
      .on('broadcast', { event: 'viewers' }, ({ payload }) => {
        setViewers(payload.count)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_messages', filter: `session_id=eq.${id}` }, async ({ new: msg }) => {
        const { data: full } = await supabase.from('live_messages').select('*, profiles(full_name, display_name, avatar_url)').eq('id', msg.id).single()
        if (full) setMessages(prev => [...prev, full])
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Announce presence
          channel.track({ user_id: user?.id, joined_at: Date.now() })
          channel.send({ type: 'broadcast', event: 'viewers', payload: { count: viewers + 1 } })
        }
      })

    channelRef.current = channel
  }

  async function loadWallet() {
    const { data } = await supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle()
    setWallet(data?.balance || 0)
  }

  async function sendMessage(text, type = 'text', audioUrl = null) {
    if (!user || (!text.trim() && !audioUrl)) return
    await supabase.from('live_messages').insert({
      session_id: id,
      user_id: user.id,
      content: text.trim() || '',
      type,
      audio_url: audioUrl,
    })
    setInput('')
  }

  async function sendGift(gift) {
    if (!user || wallet < gift.coins) { showToast('Not enough CareCoins', { type: 'warning' }); return }

    const { data: result, error } = await supabase.rpc('send_gift', {
      p_recipient: session.host_id,
      p_coins: gift.coins,
      p_gift_type: gift.label,
      p_gift_emoji: gift.emoji,
      p_live_session_id: id,
    })

    if (error || result !== 'ok') {
      showToast(result === 'insufficient' ? 'Not enough CareCoins' : 'Could not send gift: ' + (error?.message || result), { type: result === 'insufficient' ? 'warning' : 'error' })
      return
    }

    setWallet(w => w - gift.coins)

    // 6. Broadcast gift animation to all viewers
    channelRef.current?.send({
      type: 'broadcast', event: 'gift',
      payload: { emoji: gift.emoji, label: gift.label, coins: gift.coins, sender: user.email?.split('@')[0] }
    })

    // 7. Log in chat (will be wiped when live ends — that's fine)
    await sendMessage(`sent ${gift.emoji} ${gift.label} (${gift.coins} coins)`, 'gift')
    setGiftPanel(false)
  }

  function sendStroke(stroke) {
    // Update DB
    const newStrokes = stroke.clear ? [] : [...strokes, stroke]
    setStrokes(newStrokes)
    supabase.from('live_sessions').update({ board_strokes: newStrokes }).eq('id', id)
    // Broadcast
    channelRef.current?.send({ type: 'broadcast', event: 'stroke', payload: stroke.clear ? { clear: true } : { stroke } })
  }

  async function tapLike() {
    if (liked) return
    setLiked(true)
    setLikeAnim(true)
    setTimeout(() => setLikeAnim(false), 600)
    const newLikes = likes + 1
    setLikes(newLikes)
    await supabase.from('live_sessions').update({ likes: newLikes }).eq('id', id)
    channelRef.current?.send({ type: 'broadcast', event: 'like', payload: { count: newLikes } })
  }

  async function endSession() {
    setConfirmEndOpen(false)

    const duration = Math.floor((Date.now() - new Date(session.started_at)) / 60000)
    const totalGifts = messages.filter(m => m.type === 'gift').length

    // Mark ended
    await supabase.from('live_sessions').update({
      status: 'ended',
      ended_at: new Date().toISOString(),
      board_strokes: [], // wipe board immediately
    }).eq('id', id)

    // Delete all chat messages immediately
    await supabase.from('live_messages').delete().eq('session_id', id)

    // Save a lightweight summary post (auto-expires via expires_at)
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
    await ensureProfile(user)
    await supabase.from('posts').insert({
      user_id: user.id,
      content: `🔴 Live Session ended\n\n📌 Topic: ${session.topic}\n⏱️ Duration: ${duration} min\n🎁 Gifts received: ${totalGifts}\n👥 Peak viewers: ${viewers}${session.description ? '\n\n' + session.description : ''}`,
      post_type: 'text',
      expires_at: expiresAt,
    })

    navigate('/feed')
  }

  function shareSession() {
    if (navigator.share) navigator.share({ title: session?.topic, url: window.location.href })
    else { navigator.clipboard?.writeText(window.location.href); showToast('Link copied!', { type: 'success' }) }
  }

  if (loading) return <Loading text="Loading live session..." />

  const host = session?.profiles
  const hostName = host?.full_name || host?.display_name || 'Host'

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 80, background: '#f9fafb', minHeight: '100vh' }
      : { fontFamily: theme.fontFamily, maxWidth: 700, margin: '0 auto', background: '#f9fafb' }}>
      {/* Header */}
      <div style={{
        background: theme.navy, padding: '14px 16px 14px', color: '#fff',
        ...(isMobile ? { position: 'sticky', top: 0, zIndex: 50 } : { borderRadius: theme.radius.xl, marginBottom: 16 }),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          {isMobile && <Link to="/" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 18 }}>←</Link>}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: session.status === 'live' ? '#4ade80' : '#94a3b8', animation: session.status === 'live' ? 'pulse 1s infinite' : 'none' }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: session.status === 'live' ? '#4ade80' : 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{session.status === 'live' ? 'LIVE' : 'ENDED'}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>· {viewers} watching</span>
            </div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, lineHeight: 1.3 }}>{session.topic}</p>
          </div>
          {isHost && (
            <button onClick={() => setConfirmEndOpen(true)} style={{ padding: '5px 10px', background: theme.alert, color: '#fff', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>End</button>
          )}
        </div>

        {/* Host info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: host?.avatar_url ? `url(${host.avatar_url})` : theme.tealDeep, backgroundSize: 'cover', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
            {!host?.avatar_url && hostName[0]}
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{hostName}</span>
            {host?.is_verified && host?.specialty && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginLeft: 6 }}><BadgeCheck size={11} aria-label="Verified" style={{ verticalAlign: '-1px', marginRight: 3 }} /> {host.specialty}</span>}
          </div>
          {/* Like count */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-flex', transform: likeAnim ? 'scale(1.5)' : 'scale(1)', transition: 'transform 0.2s' }}><Heart size={13} aria-hidden="true" /></span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{likes}</span>
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 12px 0' }}>
        {/* Drawing Board */}
        <LiveBoard sessionId={id} isHost={isHost} strokes={strokes} onStroke={sendStroke} />

        {/* Gift animation overlay */}
        {giftAnim && (
          <div style={{ textAlign: 'center', padding: '10px 0', animation: 'fadeIn 0.3s' }}>
            <p style={{ margin: 0, fontSize: 32 }}>{giftAnim.emoji}</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 700, color: theme.tealDeep }}>{giftAnim.sender} sent {giftAnim.label}! ({giftAnim.coins} coins)</p>
          </div>
        )}

        {/* Action bar */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 0', alignItems: 'center' }}>
          <button onClick={tapLike} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px', background: liked ? '#fef2f2' : theme.bg, border: `1px solid ${liked ? '#fca5a5' : theme.border}`, borderRadius: 20, fontSize: 13, fontWeight: 700, color: liked ? theme.alert : theme.textMid }}>
            <Heart size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Like
          </button>
          <button onClick={() => setGiftPanel(!giftPanel)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px', background: theme.tealMist, border: `1px solid ${theme.tealDeep}`, borderRadius: 20, fontSize: 13, fontWeight: 700, color: theme.tealDeep }}>
            <Gift size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Gift
          </button>
          <button onClick={shareSession} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 20, fontSize: 13, fontWeight: 700, color: theme.textMid }}>
            <Share2 size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Share
          </button>
          {!isHost && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: theme.gray500 }}><Coins size={12} aria-hidden="true" /> {wallet} coins</span>}
        </div>

        {/* Gift panel */}
        {giftPanel && (
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 12, background: theme.cardBg, marginBottom: 10 }}>
            <p style={{ margin: '0 0 10px 0', fontWeight: 800, fontSize: 13, color: theme.navy, display: 'flex', alignItems: 'center', gap: 7 }}><Gift size={14} aria-hidden="true" /> Send a gift ({wallet} coins)</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {GIFT_TIERS.map(g => (
                <button key={g.label} onClick={() => sendGift(g)} disabled={wallet < g.coins}
                  style={{ padding: '10px 6px', borderRadius: 12, border: `1px solid ${theme.border}`, background: wallet >= g.coins ? theme.tealMist : theme.gray50, cursor: wallet >= g.coins ? 'pointer' : 'not-allowed', opacity: wallet < g.coins ? 0.5 : 1, textAlign: 'center' }}>
                  <p style={{ margin: '0 0 2px', fontSize: 22 }}>{g.emoji}</p>
                  <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 700, color: theme.navy }}>{g.label}</p>
                  <p style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: theme.tealDeep, fontWeight: 700 }}><Coins size={10} aria-hidden="true" /> {g.coins}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat */}
        <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, overflow: 'hidden', background: theme.cardBg, marginBottom: 10 }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between' }}>
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 13, color: theme.navy }}><MessageSquare size={14} aria-hidden="true" /> Live chat</p>
            <span style={{ fontSize: 11, color: theme.textLight }}>{messages.length} messages</span>
          </div>
          <div style={{ height: 220, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 && <p style={{ color: theme.textLight, fontSize: 13, textAlign: 'center', margin: 'auto' }}>No messages yet. Say hello.</p>}
            {messages.map(m => (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: m.type === 'gift' ? theme.warning : theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800, flexShrink: 0 }}>
                  {(m.profiles?.full_name || m.profiles?.display_name || '?')[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: m.user_id === session.host_id ? theme.tealDeep : theme.navy }}>
                    {m.profiles?.full_name || m.profiles?.display_name || 'Viewer'}
                    {m.user_id === session.host_id && <Mic size={11} aria-label="Host" style={{ verticalAlign: '-1px', marginLeft: 4 }} />}
                  </span>
                  {m.type === 'voice' && m.audio_url ? (
                    <audio src={m.audio_url} controls style={{ display: 'block', height: 28, marginTop: 3, width: '100%' }} />
                  ) : (
                    <p style={{ margin: '2px 0 0', fontSize: 13, color: m.type === 'gift' ? theme.tealDeep : theme.textMid, fontWeight: m.type === 'gift' ? 700 : 400 }}>{m.content}</p>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Message input */}
          {user && session.status === 'live' && (
            <div style={{ borderTop: `1px solid ${theme.border}`, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(input) } }}
                  placeholder="Say something..."
                  style={{ flex: 1, padding: '7px 12px', fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 20, outline: 'none' }}
                />
                <button onClick={() => sendMessage(input)} style={{ padding: '7px 14px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>Send</button>
              </div>
              <VoiceRecorder onSend={audioUrl => sendMessage('Voice note', 'voice', audioUrl)} onError={msg => showToast(msg, { type: 'error' })} />
            </div>
          )}
          {session.status === 'ended' && <p style={{ padding: '10px 12px', color: theme.textLight, fontSize: 12, textAlign: 'center' }}>This session has ended.</p>}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <ConfirmDialog
        show={confirmEndOpen}
        onClose={() => setConfirmEndOpen(false)}
        onConfirm={endSession}
        title="End this live session?"
        consequence="Everyone currently watching will be disconnected, the chat and drawing board will be cleared, and the session will be marked ended. You can't resume it."
        confirmLabel="End session"
      />
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />

      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/feed')}>
      {bodyContent}
    </AppShell>
  )
}
