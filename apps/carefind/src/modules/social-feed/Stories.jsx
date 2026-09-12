import { useEffect, useState } from 'react'
import { supabase } from '../../config/supabaseClient'
import { ensureProfile } from '../../services/ensureProfile.js'
import { useAuth } from '../../providers/AuthContext'
import { CalendarClock, Image as ImageIcon, Radio, Sparkles, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Toast, useToast } from '../../components/ui'
import StoryViewer from './components/StoryViewer.jsx'
import { fetchViewedStoryIds, markStoriesViewed } from './storyViews.js'

// CareFind Stories — platform story first, then verified users, then by views.
// Users with a completed profile can post their own (text + image, 24h).
function Stories() {
  const { user } = useAuth()
  const [stories, setStories] = useState([])
  const [viewedIds, setViewedIds] = useState(() => new Set())
  const [viewerIndex, setViewerIndex] = useState(null)
  const [loadingStories, setLoadingStories] = useState(true)
  const [canPost, setCanPost] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [sTitle, setSTitle] = useState('')
  const [sBody, setSBody] = useState('')
  const [sBg, setSBg] = useState('#0E6F5A')
  const [sImage, setSImage] = useState(null)
  const [posting, setPosting] = useState(false)
  const [liveShow, setLiveShow] = useState(null)
  const [upcomingShow, setUpcomingShow] = useState(null)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

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
    setLoadingStories(true)
    try {
      let followedIds = []
      if (user?.id) {
        const { data: followRows } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id)
        followedIds = (followRows || []).map((r) => r.following_id)
      }
      const ownId = user?.id
      const ids = [...new Set([...(followedIds || []), ...(ownId ? [ownId] : [])])]
      const nowIso = new Date().toISOString()

      let query = supabase
        .from('stories')
        .select('id, title, body, image_url, bg_color, created_at, user_id, view_count, is_platform, position, expires_at, profiles(full_name, display_name, is_verified, avatar_url)')
        .gt('expires_at', nowIso)

      if (ids.length) {
        const inList = ids.join(',')
        query = query.or(`is_platform.eq.true,user_id.in.(${inList})`)
      } else {
        query = query.eq('is_platform', true)
      }

      query = query.order('position', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
      const { data } = await query

      const list = data || []
      // Secondary ranking: position nulls last, then view_count desc, then newest (extra local sort keeps determinism)
      list.sort((a, b) => {
        const pa = a.position ?? Infinity
        const pb = b.position ?? Infinity
        if (pa !== pb) return pa - pb
        if ((b.view_count || 0) !== (a.view_count || 0)) return (b.view_count || 0) - (a.view_count || 0)
        return new Date(b.created_at) - new Date(a.created_at)
      })
      setStories(list)
      if (list.length && user?.id) {
        const seen = await fetchViewedStoryIds(supabase, list.map((s) => s.id))
        setViewedIds(seen)
      } else {
        setViewedIds(new Set())
      }
    } catch (e) {
      setStories([])
      setViewedIds(new Set())
    }
    setLoadingStories(false)
  }

  function handleViewStory(st) {
    if (!st) return
    // Centralized view counting: increment + mark seen (idempotent)
    supabase.rpc('increment_story_view', { story_id: st.id }).then(() => {}).catch(() => {})
    if (user?.id) {
      markStoriesViewed(supabase, { storyIds: [st.id], userId: user.id }).then(() => {}).catch(() => {})
      setViewedIds((prev) => {
        if (prev.has(st.id)) return prev
        const next = new Set(prev)
        next.add(st.id)
        return next
      })
      // Optimistic view_count bump
      setStories((prev) => prev.map((s) => (s.id === st.id ? { ...s, view_count: (s.view_count || 0) + 1 } : s)))
    }
  }

  function closeViewer() { setViewerIndex(null) }
  function navigateStory(next) {
    setViewerIndex(next === null || next < 0 || next >= stories.length ? null : next)
  }

  function storyLabel(s) {
    if (s.is_platform) return 'CareFind'
    return s.profiles?.full_name || s.profiles?.display_name || 'User'
  }
  function storyInitial(s) {
    if (s.is_platform) return 'C'
    return (s.profiles?.full_name?.[0] || s.profiles?.display_name?.[0] || '?').toUpperCase()
  }

  function storyRingForGroup(group) {
    const hasStory = group.stories.length > 0
    const isOwn = user?.id && group.key !== 'platform' && group.key === user.id
    const allSeen = !isOwn && hasStory && group.stories.every((s) => viewedIds.has(s.id))
    return { hasStory, allSeen }
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
    await ensureProfile(user)
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
      setSTitle(''); setSBody(''); setSBg('#0E6F5A'); setSImage(null); setComposerOpen(false)
      loadStories()
    } else {
      showToast('Could not post story: ' + error.message, { type: 'error' })
    }
    setPosting(false)
  }

  const hasStories = stories.length > 0
  if (loadingStories) return (
    <div className="cf-hscroll" style={{ display: 'flex', gap: 14, padding: '4px 2px 2px 16px', overflow: 'hidden' }}>
      {[1, 2, 3, 4].map(i => <div key={i} style={{ flexShrink: 0, width: 64, height: 64, borderRadius: '50%', background: theme.gray200, animation: 'cf-pulse 1.5s infinite' }} />)}
    </div>
  )
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

  // Group stories per user for avatar ring (one entry per user, not per story)
  const grouped = []
  const seenKeys = new Set()
  for (const s of stories) {
    const key = s.is_platform ? `platform-${s.id}` : s.user_id
    // For platform, each platform story is its own entry (may be multiple but rare); for user, dedupe
    const dedupKey = s.is_platform ? `platform-${s.id}` : s.user_id
    if (seenKeys.has(dedupKey)) continue
    seenKeys.add(dedupKey)
    const userStories = s.is_platform ? [s] : stories.filter((x) => !x.is_platform && x.user_id === s.user_id)
    grouped.push({ key: dedupKey, representative: s, stories: userStories })
  }

  return (
    <>
      <style>{`@keyframes cf-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.6); } 50% { box-shadow: 0 0 0 6px rgba(220,38,38,0); } }`}</style>
      {/* Story row */}
      <div className="cf-hscroll" style={{
        display: 'flex', alignItems: 'flex-start', gap: 14, padding: '4px 2px 2px',
        marginTop: 16, marginBottom: 4, WebkitOverflowScrolling: 'touch',
      }}>
        {/* LIVE show indicator (first) */}
        {liveShow && (
          <a href={`/live-show/${liveShow.id}`} style={{ flexShrink: 0, textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 70 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', padding: 3, background: '#dc2626', position: 'relative', animation: 'cf-pulse 1.5s infinite' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: theme.tealDeep, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', }}><Radio size={24} aria-hidden="true" /></div>
              <span style={{ position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)', background: '#dc2626', color: '#fff', fontSize: 8, fontWeight: 900, padding: '1px 6px', borderRadius: 8, letterSpacing: '0.05em' }}>LIVE</span>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#dc2626', maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Live now</span>
          </a>
        )}

        {/* UPCOMING scheduled show */}
        {upcomingShow && (
          <a href={`/live-show/${upcomingShow.id}`} style={{ flexShrink: 0, textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 70 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', padding: 3, background: theme.navy, position: 'relative' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: theme.tealDeep, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', }}><CalendarClock size={23} aria-hidden="true" /></div>
              <span style={{ position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)', background: theme.navy, color: '#fff', fontSize: 8, fontWeight: 900, padding: '1px 5px', borderRadius: 8, whiteSpace: 'nowrap' }}>{countdownLabel(upcomingShow.scheduled_at)}</span>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: theme.navy, maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Upcoming</span>
          </a>
        )}

        {canPost && (
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

        {grouped.map((g) => {
          const s = g.representative
          const { hasStory, allSeen } = storyRingForGroup(g)
          const ringBg = hasStory ? (allSeen ? theme.gray300 : theme.tealDeep) : 'transparent'
          const idx = stories.findIndex((x) => x.id === s.id)
          return (
            <button
              key={g.key}
              onClick={() => setViewerIndex(idx)}
              style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, cursor: 'pointer', width: 70 }}
            >
              <div style={{
                width: 64, height: 64, borderRadius: '50%', padding: 3,
                background: ringBg,
              }}>
                <div style={{
                  width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
                  background: s.image_url ? `url(${s.image_url})` : (s.bg_color || theme.tealDeep),
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px solid #fff', color: '#fff', fontSize: 22, fontWeight: 900,
                }}>
                  {!s.image_url && storyInitial(s)}
                </div>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: theme.navy, maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.is_platform && <Sparkles size={11} color={theme.warning} aria-hidden="true" style={{ flexShrink: 0 }} />}
                {storyLabel(s)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Full-screen viewer */}
      {viewerIndex !== null && stories[viewerIndex] && (
        <StoryViewer
          stories={stories}
          index={viewerIndex}
          onNavigate={navigateStory}
          onClose={closeViewer}
          onViewStory={handleViewStory}
          renderHeader={(s, { onClose }) => (
            <>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: s.is_platform ? theme.warning : theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14 }}>
                {storyInitial(s)}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 800 }}>
                  {s.is_platform && <Sparkles size={13} color={theme.warning} aria-hidden="true" />}
                  {storyLabel(s)}
                </p>
                <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{timeAgo(s.created_at)}</p>
              </div>
            </>
          )}
        />
      )}

      {/* User composer */}
      {composerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: 18, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.navy }}>Add to your story</h3>
              <button onClick={() => setComposerOpen(false)} aria-label="Close" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: theme.gray400, cursor: 'pointer' }}><X size={20} aria-hidden="true" /></button>
            </div>

            <input value={sTitle} onChange={(e) => setSTitle(e.target.value)} placeholder="Title (optional)" style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box', marginBottom: 8 }} />
            <textarea value={sBody} onChange={(e) => setSBody(e.target.value)} placeholder="What's on your mind?" rows={3} style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'none', marginBottom: 10 }} />

            <p style={{ margin: '0 0 6px 0', fontSize: 11.5, fontWeight: 700, color: theme.textMid }}>Background color</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {['#0E6F5A', '#0B4A3E', '#7c3aed', '#be123c', '#c2410c', '#0369a1'].map(c => (
                <button key={c} onClick={() => setSBg(c)} style={{ width: 32, height: 32, borderRadius: '50%', background: c, cursor: 'pointer', border: sBg === c ? '3px solid #000' : '2px solid #fff', boxShadow: '0 0 0 1px #ccc' }} />
              ))}
            </div>

            <label style={{ fontSize: 13, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', display: 'block', marginBottom: 12 }}>
              <ImageIcon size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 7 }} />{sImage ? sImage.name : 'Add an image (optional)'}
              <input type="file" accept="image/*" onChange={(e) => setSImage(e.target.files[0] || null)} style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }} />
            </label>

            <button onClick={postStory} disabled={posting} style={{ width: '100%', padding: 13, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 13, fontWeight: 800, fontSize: 14 }}>
              {posting ? 'Posting…' : 'Share to story'}
            </button>
            <p style={{ margin: '8px 0 0 0', fontSize: 11, color: theme.textLight, textAlign: 'center' }}>Your story disappears after 24 hours.</p>
          </div>
        </div>
      )}

      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
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
