import { useEffect, useState, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'

// CareFind Stories — platform story first, then verified users, then by views.
// Users with a completed profile can post their own (text + image, 24h).
function Stories() {
  const { user } = useAuth()
  const [stories, setStories] = useState([])
  const [viewerIndex, setViewerIndex] = useState(null)
  const [progress, setProgress] = useState(0)
  const [canPost, setCanPost] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [sTitle, setSTitle] = useState('')
  const [sBody, setSBody] = useState('')
  const [sBg, setSBg] = useState('#0f766e')
  const [sImage, setSImage] = useState(null)
  const [posting, setPosting] = useState(false)
  const [liveShow, setLiveShow] = useState(null)
  const [upcomingShow, setUpcomingShow] = useState(null)
  const timerRef = useRef(null)

  const STORY_DURATION = 6000

  useEffect(() => {
    loadStories()
    checkCanPost()
    loadLiveShow()
  }, [user])

  async function loadLiveShow() {
    const { data } = await supabase
      .from('live_shows')
      .select('id, title, host_id, profiles!live_shows_host_id_fkey(full_name, display_name)')
      .eq('status', 'live')
      .eq('is_platform', true)
      .order('started_at', { ascending: false })
      .limit(1)
    setLiveShow(data && data[0] ? data[0] : null)
    // Also load the next upcoming scheduled PLATFORM show
    const { data: up } = await supabase
      .from('live_shows')
      .select('id, title, scheduled_at')
      .eq('status', 'scheduled')
      .eq('is_platform', true)
      .order('scheduled_at', { ascending: true })
      .limit(1)
    setUpcomingShow(up && up[0] ? up[0] : null)
  }

  async function checkCanPost() {
    if (!user) { setCanPost(false); return }
    const { data } = await supabase
      .from('profiles')
      .select('full_name, display_name, phone')
      .eq('id', user.id)
      .maybeSingle()
    setCanPost(!!(data && data.full_name && data.display_name && data.phone))
  }

  async function loadStories() {
    const { data } = await supabase
      .from('stories')
      .select('id, title, body, image_url, bg_color, created_at, user_id, view_count, is_platform, profiles(full_name, display_name, is_verified)')
      .eq('is_platform', true)
      .gt('expires_at', new Date().toISOString())

    const list = data || []
    // Rank by views (desc), then newest
    list.sort((a, b) => {
      if ((b.view_count || 0) !== (a.view_count || 0)) return (b.view_count || 0) - (a.view_count || 0)
      return new Date(b.created_at) - new Date(a.created_at)
    })
    setStories(list)
  }

  useEffect(() => {
    if (viewerIndex === null) return
    setProgress(0)
    const st = stories[viewerIndex]
    if (st) supabase.rpc('increment_story_view', { story_id: st.id })
    const start = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, (elapsed / STORY_DURATION) * 100)
      setProgress(pct)
      if (pct >= 100) { clearInterval(timerRef.current); goNext() }
    }, 50)
    return () => clearInterval(timerRef.current)
  }, [viewerIndex])

  function closeViewer() { setViewerIndex(null); if (timerRef.current) clearInterval(timerRef.current) }
  function goNext() {
    setViewerIndex((prev) => (prev === null ? null : prev + 1 >= stories.length ? null : prev + 1))
  }
  function goPrev() {
    setViewerIndex((prev) => (prev === null ? null : prev - 1 < 0 ? 0 : prev - 1))
  }

  function storyLabel(s) {
    if (s.is_platform) return 'CareFind'
    return s.profiles?.full_name || s.profiles?.display_name || 'User'
  }
  function storyInitial(s) {
    if (s.is_platform) return 'C'
    return (s.profiles?.full_name?.[0] || s.profiles?.display_name?.[0] || '?').toUpperCase()
  }

  async function postStory() {
    if (!sTitle.trim() && !sBody.trim() && !sImage) return
    setPosting(true)
    let imageUrl = null
    if (sImage) {
      const ext = sImage.name.split('.').pop()
      const path = `user-${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('story-images').upload(path, sImage)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('story-images').getPublicUrl(path)
        imageUrl = urlData.publicUrl
      }
    }
    const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString()
    const { error } = await supabase.from('stories').insert({
      title: sTitle.trim() || null,
      body: sBody.trim() || null,
      image_url: imageUrl,
      bg_color: sBg,
      is_platform: false,
      user_id: user.id,
      expires_at: expiresAt,
    })
    if (!error) {
      setSTitle(''); setSBody(''); setSBg('#0f766e'); setSImage(null); setComposerOpen(false)
      loadStories()
    } else {
      alert('Could not post story: ' + error.message)
    }
    setPosting(false)
  }

  const hasStories = stories.length > 0
  if (!hasStories && !liveShow && !upcomingShow) return null

  function countdownLabel(dateStr) {
    const diff = new Date(dateStr) - Date.now()
    if (diff <= 0) return 'soon'
    const d = Math.floor(diff / 86400000)
    const h = Math.floor((diff % 86400000) / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  return (
    <>
      <style>{`@keyframes cf-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.6); } 50% { box-shadow: 0 0 0 6px rgba(220,38,38,0); } }`}</style>
      {/* Story row */}
      <div style={{
        display: 'flex', gap: 14, overflowX: 'auto', padding: '4px 2px 2px',
        marginTop: 16, marginBottom: 4, WebkitOverflowScrolling: 'touch',
      }}>
        {/* LIVE show indicator (first) */}
        {liveShow && (
          <a href={`/live-show/${liveShow.id}`} style={{ flexShrink: 0, textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 70 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', padding: 3, background: '#dc2626', position: 'relative', animation: 'cf-pulse 1.5s infinite' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: theme.tealGradient, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24, fontWeight: 900 }}>📡</div>
              <span style={{ position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)', background: '#dc2626', color: '#fff', fontSize: 8, fontWeight: 900, padding: '1px 6px', borderRadius: 8, letterSpacing: '0.05em' }}>LIVE</span>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#dc2626', maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Live now</span>
          </a>
        )}

        {/* UPCOMING scheduled show */}
        {upcomingShow && (
          <a href={`/live-show/${upcomingShow.id}`} style={{ flexShrink: 0, textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 70 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', padding: 3, background: theme.navy, position: 'relative' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: theme.tealGradient, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, fontWeight: 900 }}>⏳</div>
              <span style={{ position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)', background: theme.navy, color: '#fff', fontSize: 8, fontWeight: 900, padding: '1px 5px', borderRadius: 8, whiteSpace: 'nowrap' }}>{countdownLabel(upcomingShow.scheduled_at)}</span>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: theme.navy, maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Upcoming</span>
          </a>
        )}

        {/* Add-to-story button removed from feed — users post stories from their profile now */}
        {false && canPost && (
          <button
            onClick={() => setComposerOpen(true)}
            style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, cursor: 'pointer', width: 70 }}
          >
            <div style={{
              width: 64, height: 64, borderRadius: '50%', border: `2px dashed ${theme.tealDeep}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.tealDeep, fontSize: 28, fontWeight: 300,
            }}>+</div>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: theme.navy }}>Your story</span>
          </button>
        )}

        {stories.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setViewerIndex(i)}
            style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, cursor: 'pointer', width: 70 }}
          >
            <div style={{
              width: 64, height: 64, borderRadius: '50%', padding: 3,
              background: s.is_platform
                ? `linear-gradient(135deg, #f59e0b, ${theme.tealDeep})`
                : `linear-gradient(135deg, ${theme.tealBright}, ${theme.tealDeep})`,
            }}>
              <div style={{
                width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
                background: s.image_url ? `url(${s.image_url})` : (s.bg_color || theme.tealGradient),
                backgroundSize: 'cover', backgroundPosition: 'center',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #fff', color: '#fff', fontSize: 22, fontWeight: 900,
              }}>
                {!s.image_url && storyInitial(s)}
              </div>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: theme.navy, maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.is_platform ? '⭐ CareFind' : storyLabel(s)}
            </span>
          </button>
        ))}
      </div>

      {/* Full-screen viewer */}
      {viewerIndex !== null && stories[viewerIndex] && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 4, padding: '10px 10px 0' }}>
            {stories.map((_, i) => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, background: '#fff', width: i < viewerIndex ? '100%' : i === viewerIndex ? `${progress}%` : '0%', transition: i === viewerIndex ? 'width 0.05s linear' : 'none' }} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: stories[viewerIndex].is_platform ? 'linear-gradient(135deg,#f59e0b,#0f766e)' : theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14 }}>
              {storyInitial(stories[viewerIndex])}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 800 }}>
                {stories[viewerIndex].is_platform ? '⭐ CareFind' : storyLabel(stories[viewerIndex])}
              </p>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{timeAgo(stories[viewerIndex].created_at)}</p>
            </div>
            <button onClick={closeViewer} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 26, lineHeight: 1, padding: '0 6px' }}>✕</button>
          </div>

          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={goPrev} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '35%', zIndex: 2 }} />
            <div onClick={goNext} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '35%', zIndex: 2 }} />

            {stories[viewerIndex].image_url ? (
              <div style={{ width: '100%', height: '100%', background: `url(${stories[viewerIndex].image_url})`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', background: stories[viewerIndex].bg_color || theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, boxSizing: 'border-box' }}>
                <div style={{ textAlign: 'center', maxWidth: 340 }}>
                  {stories[viewerIndex].title && <h2 style={{ color: '#fff', fontSize: 26, fontWeight: 900, margin: '0 0 14px 0', lineHeight: 1.2 }}>{stories[viewerIndex].title}</h2>}
                  {stories[viewerIndex].body && <p style={{ color: 'rgba(255,255,255,0.92)', fontSize: 17, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{stories[viewerIndex].body}</p>}
                </div>
              </div>
            )}

            {stories[viewerIndex].image_url && (stories[viewerIndex].title || stories[viewerIndex].body) && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3, padding: '40px 20px 24px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}>
                {stories[viewerIndex].title && <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 900, margin: '0 0 6px 0' }}>{stories[viewerIndex].title}</h2>}
                {stories[viewerIndex].body && <p style={{ color: 'rgba(255,255,255,0.92)', fontSize: 14, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{stories[viewerIndex].body}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* User composer */}
      {composerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: 18, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.navy }}>Add to your story</h3>
              <button onClick={() => setComposerOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: theme.textLight }}>✕</button>
            </div>

            <input value={sTitle} onChange={(e) => setSTitle(e.target.value)} placeholder="Title (optional)" style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box', marginBottom: 8 }} />
            <textarea value={sBody} onChange={(e) => setSBody(e.target.value)} placeholder="What's on your mind?" rows={3} style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'none', marginBottom: 10 }} />

            <p style={{ margin: '0 0 6px 0', fontSize: 11.5, fontWeight: 700, color: theme.textMid }}>Background color</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {['#0f766e', '#0f172a', '#7c3aed', '#be123c', '#c2410c', '#0369a1'].map(c => (
                <button key={c} onClick={() => setSBg(c)} style={{ width: 32, height: 32, borderRadius: '50%', background: c, cursor: 'pointer', border: sBg === c ? '3px solid #000' : '2px solid #fff', boxShadow: '0 0 0 1px #ccc' }} />
              ))}
            </div>

            <label style={{ fontSize: 13, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', display: 'block', marginBottom: 12 }}>
              📷 {sImage ? sImage.name : 'Add an image (optional)'}
              <input type="file" accept="image/*" onChange={(e) => setSImage(e.target.files[0] || null)} style={{ display: 'none' }} />
            </label>

            <button onClick={postStory} disabled={posting} style={{ width: '100%', padding: 13, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 13, fontWeight: 800, fontSize: 14 }}>
              {posting ? 'Posting…' : 'Share to story'}
            </button>
            <p style={{ margin: '8px 0 0 0', fontSize: 11, color: theme.textLight, textAlign: 'center' }}>Your story disappears after 24 hours.</p>
          </div>
        </div>
      )}
    </>
  )
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default Stories
