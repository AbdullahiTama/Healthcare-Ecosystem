import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, BadgeCheck, CalendarDays, Check, ChevronRight, Coins, Film, Link2, Lock, MapPin,
  MessageSquare, Play, Repeat2, Star, User, X,
} from 'lucide-react'
import { supabase } from './config/supabaseClient'
import { useAuth } from './providers/AuthContext'
import { theme } from './styles/theme'
import { useBreakpoint } from './hooks/useBreakpoint'
import { useHeaderIdentity } from './hooks/useHeaderIdentity'
import AppShell from './components/layout/AppShell.jsx'
import { StickySidebar, SidebarSection } from './components/layout/SidebarSection.jsx'
import BottomNav from './components/BottomNav.jsx'
import { notify } from './services/notify.js'
import { previewText } from './modules/social-feed/richText.jsx'
import { renderMarkdown } from './modules/social-feed/markdown.jsx'
import { subscribe, checkAccess, cancelAutoRenew, coinsToNaira } from './modules/subscriptions-monetization/subscriptions.js'
import {
  coinsForConsultation, fetchConsultationOffer, hasBookedConsultation,
  bookConsultationWithPaystackFallback, settleConsultationCardPayment,
} from './modules/subscriptions-monetization/consultations.js'
import FollowersSheet from './modules/social-feed/FollowersSheet.jsx'
import { fetchViewedStoryIds, markStoriesViewed } from './modules/social-feed/storyViews.js'
import { Card, CardSkeleton, ConfirmDialog, Empty, StarPicker, Stars, Toast, useToast } from './components/ui'
import VerifiedBadge from './components/VerifiedBadge.jsx'
import { PostTileGrid, isRepost, withoutRepostMark } from './modules/social-feed/postDisplay.jsx'
import StoryViewer from './modules/social-feed/components/StoryViewer.jsx'

function PublicProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [profile, setProfile] = useState(null)
  const [posts, setPosts] = useState([])
  const [followerCount, setFollowerCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [postCount, setPostCount] = useState(0)
  const [isFollowing, setIsFollowing] = useState(false)
  const [sheetKind, setSheetKind] = useState(null)
  const [loading, setLoading] = useState(true)

  // Stories for this profile
  const [userStories, setUserStories] = useState([])
  const [viewedStoryIds, setViewedStoryIds] = useState(() => new Set())
  const [viewerIndex, setViewerIndex] = useState(null)
  const [activeTab, setActiveTab] = useState('posts')
  const [playlists, setPlaylists] = useState([])
  const [userReviews, setUserReviews] = useState([])
  const [reviewers, setReviewers] = useState({})
  const [myRating, setMyRating] = useState(5)
  const [myComment, setMyComment] = useState('')
  const [postingReview, setPostingReview] = useState(false)
  const [subActive, setSubActive] = useState(false)
  const [subInfo, setSubInfo] = useState(null)
  const [subscribing, setSubscribing] = useState(false)
  const [consultOffer, setConsultOffer] = useState(null)
  const [consultBooked, setConsultBooked] = useState(false)
  const [confirmConsultOpen, setConfirmConsultOpen] = useState(false)
  const [bookingConsult, setBookingConsult] = useState(false)
  const [openPost, setOpenPost] = useState(null)
  const [confirmSubOpen, setConfirmSubOpen] = useState(false)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

  const visualThemes = {
    teal: 'linear-gradient(135deg, #0E6F5A, #0B4A3E)',
    sunset: 'linear-gradient(135deg, #f97316, #db2777)',
    ocean: 'linear-gradient(135deg, #0ea5e9, #1e3a8a)',
    purple: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
    forest: 'linear-gradient(135deg, #16a34a, #14532d)',
  }

  useEffect(() => {
    async function load() {
      setLoading(true)

      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, full_name, display_name, is_verified, verification_label, location, website, avatar_url, cover_url, subscription_price, bio, show_followers')
        .eq('id', id)
        .maybeSingle()

      if (!profileData) {
        setLoading(false)
        return
      }

      setProfile(profileData)
      // Notify the profile owner of the view (once per session to avoid spam)
      if (user && user.id !== id) {
        const seenKey = `pv_${user.id}_${id}`
        if (!sessionStorage.getItem(seenKey)) {
          sessionStorage.setItem(seenKey, '1')
          notify({ recipientId: id, actorId: user.id, type: 'profile_view', message: 'viewed your profile', link: `/u/${user.id}` })
        }
      }

      const [postData, followerData, followingData, storyData, playlistData] = await Promise.all([
        supabase.from('posts').select('id, content, created_at, post_type, theme, image_url').eq('user_id', id).order('created_at', { ascending: false }).limit(60),
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', id),
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', id),
        supabase.from('stories').select('id, title, body, image_url, bg_color, created_at, position, view_count').eq('user_id', id).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
        supabase.from('playlists').select('id, title, description, created_at').eq('owner_id', id).order('created_at', { ascending: false }),
      ])

      setPosts(postData.data || [])
      setFollowerCount(followerData.count || 0)
      setFollowingCount(followingData.count || 0)
      setPostCount(postData.data?.length || 0)
      setPlaylists(playlistData.data || [])

      // Rank the profile's stories the same way the feed rail does (Stories.jsx):
      // explicit position first (nulls last), then view count, then newest.
      const stories = (storyData.data || []).sort((a, b) => {
        const pa = a.position ?? Infinity
        const pb = b.position ?? Infinity
        if (pa !== pb) return pa - pb
        if ((b.view_count || 0) !== (a.view_count || 0)) return (b.view_count || 0) - (a.view_count || 0)
        return new Date(b.created_at) - new Date(a.created_at)
      })
      setUserStories(stories)

      // Which of this profile's stories the CURRENT viewer has already seen
      // (RLS scopes the query to the viewer's own story_views rows) — this is
      // what greys the ring out once every story has been watched.
      if (user && stories.length) {
        const seen = await fetchViewedStoryIds(supabase, stories.map((s) => s.id))
        setViewedStoryIds(seen)
      } else {
        setViewedStoryIds(new Set())
      }

      await loadUserReviews()
      await refreshAccess()

      const offer = await fetchConsultationOffer(id)
      setConsultOffer(offer)

      let booked = false
      if (user && user.id !== id) {
        booked = await hasBookedConsultation(user.id, id)

        // Resume a card booking that bounced back from Paystack: settle it
        // server-side (idempotent against the webhook), then refresh state.
        try {
          const pendingRaw = sessionStorage.getItem('cf_consult_pending')
          if (pendingRaw) {
            const pending = JSON.parse(pendingRaw)
            sessionStorage.removeItem('cf_consult_pending')
            if (pending.professionalId === id && pending.reference) {
              const settleRes = await settleConsultationCardPayment(user.id, id, pending.reference)
              if (settleRes.ok && !settleRes.alreadyProcessed && !settleRes.alreadyBooked) {
                booked = await hasBookedConsultation(user.id, id)
                notify({ recipientId: id, actorId: user.id, type: 'consultation', message: 'booked a consultation with you', link: `/u/${user.id}` })
                showToast('Consultation booked! The professional has been notified.', { type: 'success' })
              }
            }
          }
        } catch (e) { /* malformed pending marker — ignore */ }
      }
      setConsultBooked(booked)

      if (user) {
        const { data: followData } = await supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', id).maybeSingle()
        setIsFollowing(!!followData)
      }

      setLoading(false)
    }
    load()
  }, [id, user])

  async function refreshAccess() {
    if (!user || user.id === id) { setSubActive(false); return }
    const res = await checkAccess(user.id, id)
    setSubActive(!!res.active)
    setSubInfo(res.sub || null)
  }

  function handleSubscribe(priceCoins) {
    if (!user) { navigate('/login'); return }
    setConfirmSubOpen(true)
  }

  async function confirmSubscribe() {
    setConfirmSubOpen(false)
    const priceCoins = profile.subscription_price
    setSubscribing(true)
    const res = await subscribe(user.id, id, priceCoins)
    setSubscribing(false)
    if (res.insufficient) {
      showToast('Not enough CareCoins to subscribe. Top up your wallet to continue.', { type: 'warning' })
      return
    }
    if (res.error) { showToast('Could not subscribe: ' + res.error, { type: 'error' }); return }
    await refreshAccess()
    notify({ recipientId: id, actorId: user.id, type: 'gift', message: 'subscribed to your content \ud83d\udd13', link: `/u/${user.id}` })
    showToast('Subscribed! You can now read all their subscriber-only content.', { type: 'success' })
  }

  async function handleCancelAutoRenew() {
    await cancelAutoRenew(user.id, id)
    await refreshAccess()
    showToast("Auto-renew turned off. You'll keep access until your current period ends.", { type: 'info' })
  }

  function handleBookConsultation() {
    if (!user) { navigate('/login'); return }
    setConfirmConsultOpen(true)
  }

  async function confirmBookConsultation() {
    setConfirmConsultOpen(false)
    setBookingConsult(true)
    const res = await bookConsultationWithPaystackFallback(user.id, id, `${window.location.origin}/u/${id}`)
    if (res.paystackUrl) {
      sessionStorage.setItem('cf_consult_pending', JSON.stringify({ professionalId: id, reference: res.reference }))
      window.location.href = res.paystackUrl
      return
    }
    setBookingConsult(false)
    if (res.insufficient) {
      showToast('Not enough CareCoins to book. Top up your wallet to continue.', { type: 'warning', actionLabel: 'Top up', onAction: () => navigate('/wallet') })
      return
    }
    if (res.error) { showToast('Could not book: ' + res.error, { type: 'error' }); return }
    if (res.alreadyBooked) {
      setConsultBooked(true)
      showToast('You already have a booking with this professional.', { type: 'info' })
      return
    }
    if (res.ok) {
      setConsultBooked(true)
      notify({ recipientId: id, actorId: user.id, type: 'consultation', message: 'booked a consultation with you', link: `/u/${user.id}` })
      showToast('Consultation booked! The professional has been notified.', { type: 'success' })
    }
  }

  async function loadUserReviews() {
    const { data } = await supabase
      .from('user_reviews')
      .select('id, rating, comment, created_at, user_id')
      .eq('subject_id', id)
      .order('created_at', { ascending: false })
    const rv = data || []
    setUserReviews(rv)

    const userIds = [...new Set(rv.map((r) => r.user_id).filter(Boolean))]
    if (userIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, display_name, is_verified, specialty, verification_label')
        .in('id', userIds)
      const map = {}
      ;(profs || []).forEach((pr) => { map[pr.id] = pr })
      setReviewers(map)
    } else {
      setReviewers({})
    }
  }

  async function submitUserReview(e) {
    e.preventDefault()
    if (!user) { navigate('/login'); return }
    setPostingReview(true)
    const { error } = await supabase.from('user_reviews').insert({
      subject_id: id,
      user_id: user.id,
      rating: myRating,
      comment: myComment.trim() || null,
    })
    setPostingReview(false)
    if (error) { showToast('Could not post review: ' + error.message, { type: 'error' }); return }
    setMyRating(5)
    setMyComment('')
    loadUserReviews()
  }

  // Story viewer progress
  useEffect(() => {
    if (viewerIndex === null) return
    const st = userStories[viewerIndex]
    if (st) {
      supabase.rpc('increment_story_view', { story_id: st.id })
      // Watching a story marks it seen for this viewer (idempotent — the DB
      // dedupes on the composite key), so the profile ring greys out once
      // everything has been watched.
      markStoriesViewed(supabase, { storyIds: [st.id], userId: user?.id })
      setViewedStoryIds((prev) => {
        if (prev.has(st.id)) return prev
        const next = new Set(prev)
        next.add(st.id)
        return next
      })
    }
  }, [viewerIndex])

  function closeViewer() { setViewerIndex(null) }
  function navigateStory(next) {
    setViewerIndex(next === null || next < 0 || next >= userStories.length ? null : next)
  }
  // Chooser's "View Profile" — we're already on the profile, so dismiss the
  // popover and bring the profile content into view rather than doing nothing.
  function scrollToProfileContent() {
    const el = document.getElementById('profile-content')
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function toggleFollow() {
    if (!user) return
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', id)
      setIsFollowing(false)
      setFollowerCount((n) => n - 1)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: id })
      setIsFollowing(true)
      setFollowerCount((n) => n + 1)
    }
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  // Back to the feed — mobile only; on desktop the shell's nav is always
  // there, so a back link would be a second way to do the same thing.
  const backLink = (
    <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.8)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
      <ArrowLeft size={15} aria-hidden="true" /> Feed
    </Link>
  )

  // Structured loading, not a bare "Loading..." string — the page's shape is
  // known ahead of the data (MOTION.md → skeletons for structured content).
  if (loading) {
    const loadingContent = (
      <div style={{ maxWidth: isMobile ? 480 : undefined, margin: '0 auto', padding: isMobile ? '20px 16px 90px' : 0 }} role="status" aria-live="polite">
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading profile</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
    if (isMobile) return loadingContent
    return (
      <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/feed')}>
        {loadingContent}
      </AppShell>
    )
  }

  if (!profile) {
    const notFoundContent = (
      <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 90 } : { fontFamily: theme.fontFamily }}>
        {isMobile && (
          <div style={{ background: theme.navy, padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
            {backLink}
          </div>
        )}
        <Empty
          icon={<User size={44} color={theme.gray300} strokeWidth={1.5} />}
          message={
            <>
              <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>Profile not found</div>
              <div style={{ fontSize: 13, color: theme.gray500 }}>This account may have been deleted.</div>
            </>
          }
          action="Back to the feed"
          onAction={() => navigate('/feed')}
        />
        {isMobile && <BottomNav />}
      </div>
    )

    if (isMobile) return notFoundContent

    return (
      <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/feed')}>
        {notFoundContent}
      </AppShell>
    )
  }

  const displayName = profile.full_name || profile.display_name || 'CareFind User'
  const isOwnProfile = user?.id === id
  const hasStory = userStories.length > 0
  // The ring greys out once THIS viewer has watched every story — the
  // Instagram "all caught up" state. Own stories and logged-out visitors
  // always show the teal ring.
  const allSeen = !isOwnProfile && hasStory && userStories.every((s) => viewedStoryIds.has(s.id))
  const avgReviewRating = userReviews.length
    ? userReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / userReviews.length
    : 0

  // Primary action (Edit Profile / Follow + Subscribe) — identical content,
  // mobile positions it absolutely over the hero; desktop stacks it in the
  // sidebar card instead (LAYOUTS.md: "primary action lives in a fixed,
  // predictable place per template").
  const pillBtn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 40, padding: '8px 18px', borderRadius: theme.radius.full,
    fontSize: 13, fontWeight: 700, fontFamily: theme.fontFamily,
    textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
  }

  const actionButtons = (
    <div style={isMobile ? { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } : { display: 'flex', flexDirection: 'column', gap: 8 }}>
      {isOwnProfile ? (
        <Link to="/profile" style={{ ...pillBtn, border: `1px solid ${theme.gray200}`, background: '#fff', color: theme.navy }}>
          Edit profile
        </Link>
      ) : user ? (
        <>
          <button
            onClick={toggleFollow}
            aria-pressed={isFollowing}
            style={{
              ...pillBtn,
              background: isFollowing ? '#fff' : theme.tealDeep,
              color: isFollowing ? theme.navy : '#fff',
              border: `1px solid ${isFollowing ? theme.gray200 : 'transparent'}`,
            }}
          >
            {isFollowing ? <><Check size={15} strokeWidth={2.6} aria-hidden="true" /> Following</> : 'Follow'}
          </button>

          {!(profile?.subscription_price > 0) && profile?.is_verified && (
            <span style={{
              ...pillBtn, background: theme.bg, color: theme.gray400,
              border: `1px solid ${theme.gray200}`, fontSize: 12, cursor: 'default',
            }}>
              <Lock size={14} aria-hidden="true" /> Not accepting subscriptions
            </span>
          )}

          {profile?.subscription_price > 0 && (
            subActive ? (
              <button
                onClick={handleCancelAutoRenew}
                style={{ ...pillBtn, background: '#fff', color: theme.tealDeep, border: `1px solid ${theme.tealDeep}`, fontSize: 12.5, fontWeight: 800 }}
              >
                <Check size={15} strokeWidth={2.6} aria-hidden="true" /> Subscribed
              </button>
            ) : (
              <button
                onClick={() => handleSubscribe(profile.subscription_price)}
                disabled={subscribing}
                style={{ ...pillBtn, background: theme.navy, color: '#fff', border: 'none', fontSize: 12.5, fontWeight: 800 }}
              >
                {subscribing
                  ? 'Subscribing\u2026'
                  : <><Lock size={14} aria-hidden="true" /> Subscribe · {profile.subscription_price} CareCoins/mo</>}
              </button>
            )
          )}
        </>
      ) : (
        <Link to="/login" style={{ ...pillBtn, background: theme.tealDeep, color: '#fff', border: 'none' }}>
          Follow
        </Link>
      )}
    </div>
  )

  // Menu-item look for the story chooser, matching PostMenu's menu styling.
  const storyMenuItemStyle = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '9px 10px', borderRadius: theme.radius.sm, border: 'none',
    background: 'transparent', cursor: 'pointer', textAlign: 'left',
    fontSize: 13, fontWeight: 600, fontFamily: theme.fontFamily, color: theme.gray600,
  }

  // The avatar, wearing a teal ring when there's an unexpired story to open.
  // One definition, two sizes: large over the mobile cover, small in the
  // desktop sidebar card. Tapping the ring opens a two-option chooser (View
  // Stories / View Profile) instead of jumping straight into the viewer —
  // a story ring that is also the identity avatar shouldn't force playback.
  // With no stories the ring is plain identity chrome, not a button.
  function StoryAvatar({ size, fontSize, borderWidth = 3, style = {} }) {
    const [chooserOpen, setChooserOpen] = useState(false)
    const wrapRef = useRef(null)

    useEffect(() => {
      if (!chooserOpen) return
      function onDocClick(e) {
        if (!wrapRef.current?.contains(e.target)) setChooserOpen(false)
      }
      function onKeyDown(e) {
        if (e.key === 'Escape') {
          setChooserOpen(false)
          wrapRef.current?.querySelector('button')?.focus()
        }
      }
      document.addEventListener('mousedown', onDocClick)
      document.addEventListener('keydown', onKeyDown)
      return () => {
        document.removeEventListener('mousedown', onDocClick)
        document.removeEventListener('keydown', onKeyDown)
      }
    }, [chooserOpen])

    const ringPad = hasStory ? Math.round(size * 0.045) + 2 : 0
    const face = (
      <div style={{
        width: size - ringPad * 2, height: size - ringPad * 2, borderRadius: '50%',
        background: profile?.avatar_url ? `url(${profile.avatar_url}) center/cover` : theme.tealDeep,
        border: `${borderWidth}px solid #fff`, boxShadow: theme.elevation[2],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize, fontWeight: 800, boxSizing: 'border-box',
      }}>
        {!profile?.avatar_url && (displayName[0]?.toUpperCase() || '?')}
      </div>
    )

    const ringStyle = {
      width: size, height: size, borderRadius: '50%', padding: ringPad,
      background: hasStory ? (allSeen ? theme.gray300 : theme.tealDeep) : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: 'none', boxSizing: 'border-box',
    }

    if (!hasStory) return <div style={ringStyle}>{face}</div>

    return (
      <div ref={wrapRef} style={{ position: 'relative', ...style }}>
        <button
          type="button"
          onClick={() => setChooserOpen(true)}
          aria-label={`View ${displayName}'s story`}
          aria-haspopup="menu"
          aria-expanded={chooserOpen}
          style={{ ...ringStyle, cursor: 'pointer' }}
        >
          {face}
        </button>

        {chooserOpen && (
          <div
            role="menu"
            aria-label={`${displayName} options`}
            style={{
              position: 'absolute', top: size + 6, left: 0, zIndex: 30, minWidth: 184,
              background: theme.cardBg, border: `1px solid ${theme.gray200}`,
              borderRadius: theme.radius.md, boxShadow: theme.elevation[3],
              padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => { setChooserOpen(false); setViewerIndex(0) }}
              style={storyMenuItemStyle}
            >
              <Play size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> View Stories
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => { setChooserOpen(false); scrollToProfileContent() }}
              style={storyMenuItemStyle}
            >
              <User size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> View Profile
            </button>
          </div>
        )}
      </div>
    )
  }

  // Name, handle, credential, bio, links and the stat row — identical content
  // in the desktop sidebar card and the mobile hero, so it's built once.
  // `scale` only nudges type sizes: mobile has the full column width, the
  // desktop sidebar is 300px.
  function identityBlock(scale = 'sidebar') {
    const big = scale === 'hero'
    return (
      <>
        <h1 style={{ fontSize: big ? 20 : 17, fontWeight: 900, color: theme.navy, margin: '0 0 2px 0' }}>{displayName}</h1>
        {profile.display_name && (
          <p style={{ margin: '0 0 6px 0', fontSize: big ? 13 : 12.5, color: theme.gray400, fontWeight: 600 }}>@{profile.display_name}</p>
        )}
        {profile.is_verified && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 8,
            fontSize: big ? 11 : 10.5, fontWeight: 800, color: theme.tealDeep,
            background: theme.tealMist, padding: '3px 10px', borderRadius: theme.radius.full,
          }}>
            {/* The stored label usually already reads "Verified Doctor" —
                prefixing it printed "Verified Verified Doctor". */}
            <BadgeCheck size={13} aria-hidden="true" /> {profile.verification_label || profile.specialty || 'Verified'}
          </span>
        )}
        {profile.bio && (
          <p style={{ margin: big ? '10px 0 0 0' : '6px 0 0 0', fontSize: big ? 13.5 : 13, color: theme.textMid, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {profile.bio}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: big ? 'row' : 'column', flexWrap: 'wrap', gap: big ? 12 : 5, marginTop: 10, marginBottom: 12 }}>
          {profile.location && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: theme.gray500 }}>
              <MapPin size={13} aria-hidden="true" /> {profile.location}
            </span>
          )}
          {profile.website && (
            <a href={profile.website} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: theme.tealDeep, textDecoration: 'none' }}>
              <Link2 size={13} aria-hidden="true" /> {profile.website}
            </a>
          )}
        </div>

        <div style={{
          display: 'flex', gap: big ? 20 : 16, marginBottom: big ? 16 : 14,
          borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`,
          padding: big ? '12px 0' : '10px 0',
        }}>
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: big ? 16 : 15, color: theme.navy }}>{postCount}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: theme.gray400, fontWeight: 600 }}>Posts</p>
          </div>
          {profile.show_followers === false && !isOwnProfile ? (
            <div>
              <p style={{ margin: 0, fontWeight: 900, fontSize: big ? 16 : 15, color: theme.navy }}>—</p>
              <p style={{ margin: 0, fontSize: 10.5, color: theme.gray400, fontWeight: 600 }}>Followers</p>
            </div>
          ) : (
            <button
              onClick={() => setSheetKind('followers')}
              aria-label={`${followerCount} followers — view list`}
              style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: theme.fontFamily }}
            >
              <p style={{ margin: 0, fontWeight: 900, fontSize: big ? 16 : 15, color: theme.navy }}>{followerCount}</p>
              <p style={{ margin: 0, fontSize: 10.5, color: theme.gray400, fontWeight: 600 }}>Followers</p>
            </button>
          )}
          {profile.show_followers === false && !isOwnProfile ? (
            <div>
              <p style={{ margin: 0, fontWeight: 900, fontSize: big ? 16 : 15, color: theme.navy }}>—</p>
              <p style={{ margin: 0, fontSize: 10.5, color: theme.gray400, fontWeight: 600 }}>Following</p>
            </div>
          ) : (
            <button
              onClick={() => setSheetKind('following')}
              aria-label={`${followingCount} following — view list`}
              style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: theme.fontFamily }}
            >
              <p style={{ margin: 0, fontWeight: 900, fontSize: big ? 16 : 15, color: theme.navy }}>{followingCount}</p>
              <p style={{ margin: 0, fontSize: 10.5, color: theme.gray400, fontWeight: 600 }}>Following</p>
            </button>
          )}
          <button
            onClick={() => setActiveTab('reviews')}
            style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: theme.fontFamily }}
          >
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 900, fontSize: big ? 16 : 15, color: theme.navy }}>
              {avgReviewRating ? avgReviewRating.toFixed(1) : '\u2014'}
              <Star size={big ? 13 : 12} color={theme.warning} fill={theme.warning} aria-hidden="true" />
            </p>
            <p style={{ margin: 0, fontSize: 10.5, color: theme.gray400, fontWeight: 600 }}>{userReviews.length} review{userReviews.length !== 1 ? 's' : ''}</p>
          </button>
        </div>
      </>
    )
  }

  // Desktop only: the whole hero (cover, avatar, name, bio, stats, primary
  // action) becomes one persistent sidebar card, since the main column below
  // is a tabbed, potentially-long scroll (posts/reviews) — same pattern as
  // BusinessProfile/DrugProfile's sidebar split.
  const sidebarContent = (
    <StickySidebar width={300}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ height: 80, background: profile?.cover_url ? `url(${profile.cover_url}) center/cover` : theme.navy }} />
        <div style={{ padding: '0 16px 16px 16px' }}>
          <StoryAvatar size={68} fontSize={22} borderWidth={3} style={{ marginTop: -34, marginBottom: 10 }} />
          {identityBlock('sidebar')}
          {actionButtons}
        </div>
      </Card>
    </StickySidebar>
  )

  const bodyContent = (
    <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 90 } : { fontFamily: theme.fontFamily }}>
      {isMobile && (
        <div style={{ position: 'relative', marginBottom: 58 }}>
          <div style={{ height: 110, background: profile?.cover_url ? `url(${profile.cover_url}) center/cover` : theme.navy, position: 'relative' }}>
            <div style={{ position: 'absolute', top: 16, left: 16 }}>{backLink}</div>
          </div>
          <div style={{ position: 'absolute', bottom: -46, left: 16 }}>
            <StoryAvatar size={94} fontSize={28} borderWidth={4} />
            {hasStory && (
              <span style={{ display: 'block', textAlign: 'center', fontSize: 10, fontWeight: 800, color: theme.tealDeep, marginTop: 2 }}>
                Tap to view story
              </span>
            )}
          </div>
          <div style={{ position: 'absolute', bottom: -44, right: 16 }}>
            {actionButtons}
          </div>
        </div>
      )}

      <div id="profile-content" style={isMobile ? { padding: '0 16px 16px 16px' } : {}}>
        {isMobile && identityBlock('hero')}

        {/* Consultation offer — the professional's bookable service */}
        {!isOwnProfile && consultOffer && consultOffer.fee > 0 && (
          <div style={{ border: `1px solid ${theme.tealDeep}`, borderRadius: 16, padding: 14, background: theme.tealMist, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: theme.tealDeep, background: '#fff', padding: '4px 10px', borderRadius: theme.radius.full }}>
                <CalendarDays size={12} aria-hidden="true" /> {consultOffer.type} consultation
              </span>
            </div>
            <p style={{ margin: '0 0 4px 0', fontSize: 20, fontWeight: 900, color: theme.navy }}>
              ₦{Number(consultOffer.fee).toLocaleString()}
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.textLight }}> ≈ {coinsForConsultation(consultOffer.fee)} CareCoins</span>
            </p>
            {consultOffer.notes && <p style={{ margin: '0 0 12px 0', fontSize: 13, color: theme.textMid, lineHeight: 1.5 }}>{consultOffer.notes}</p>}
            {consultBooked ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fff', borderRadius: 12 }}>
                <Check size={16} color={theme.success} strokeWidth={3} aria-hidden="true" />
                <span style={{ fontSize: 13, fontWeight: 800, color: theme.navy }}>Consultation booked</span>
              </div>
            ) : (
              <button
                onClick={handleBookConsultation}
                disabled={bookingConsult}
                style={{
                  width: '100%', padding: 12, background: theme.tealDeep, color: '#fff',
                  border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14, fontFamily: theme.fontFamily, cursor: 'pointer',
                }}
              >
                {bookingConsult ? 'Booking…' : <><Coins size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} aria-hidden="true" />Book Consultation</>}
              </button>
            )}
          </div>
        )}

        {/* Story rail — a quick-access TikTok-style row, read-only mirror of
            the own-profile rail (Profile.jsx). One circle per story, ordered
            position → views → newest. Empty profiles render nothing. */}
        {userStories.length > 0 && (
          <div className="cf-hscroll" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, marginBottom: 12, WebkitOverflowScrolling: 'touch' }}>
            {userStories.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setViewerIndex(i)}
                aria-label={`View story${s.title ? `: ${s.title}` : ''}`}
                style={{ flexShrink: 0, width: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <div style={{ width: 58, height: 58, borderRadius: '50%', padding: 2, background: allSeen ? theme.gray300 : theme.tealDeep }}>
                  <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: s.image_url ? `url(${s.image_url}) center/cover` : (s.bg_color || theme.tealDeep), border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 800 }}>
                    {!s.image_url && (s.title?.[0]?.toUpperCase() || displayName[0]?.toUpperCase() || '?')}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: theme.textMid, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.title || 'Story'}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Content tabs */}
        <div role="group" aria-label="Profile sections" className="cf-hscroll" style={{ display: 'flex', borderBottom: `1px solid ${theme.gray200}`, marginBottom: 14, WebkitOverflowScrolling: 'touch' }}>
          {[['posts', 'Posts', MessageSquare], ['reposts', 'Reposts', Repeat2], ['playlists', 'Playlists', Film], ['reviews', 'Reviews', Star]].map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              aria-pressed={activeTab === key}
              style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap', minHeight: 44, padding: '10px 14px',
                background: 'none', border: 'none', fontFamily: theme.fontFamily,
                borderBottom: activeTab === key ? `2.5px solid ${theme.tealDeep}` : '2.5px solid transparent',
                color: activeTab === key ? theme.tealDeep : theme.gray500,
                fontWeight: activeTab === key ? 800 : 600, fontSize: 13, cursor: 'pointer',
              }}
            >
              <Icon size={15} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>

        {/* Playlists tab */}
        {activeTab === 'playlists' && (
          playlists.length === 0
            ? <Empty icon={<Film size={40} color={theme.gray300} strokeWidth={1.5} />} message="No playlists yet." />
            : playlists.map(pl => (
                <Link key={pl.id} to={`/playlist/${pl.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 12, marginBottom: 8, textDecoration: 'none' }}>
                  <div style={{ width: 44, height: 44, borderRadius: theme.radius.md, background: theme.tealMist, color: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Film size={21} aria-hidden="true" />
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.navy }}>{pl.title}</p>
                    {pl.description && <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.description}</p>}
                  </div>
                  <ChevronRight size={18} color={theme.gray400} aria-hidden="true" style={{ flexShrink: 0 }} />
                </Link>
              ))
        )}

        {/* Reviews tab — this person's aggregated review profile */}
        {activeTab === 'reviews' && (() => {
          const total = userReviews.length
          const avg = avgReviewRating
          const breakdown = [5, 4, 3, 2, 1].map((n) => ({
            star: n,
            count: userReviews.filter((r) => r.rating === n).length,
            pct: total ? Math.round((userReviews.filter((r) => r.rating === n).length / total) * 100) : 0,
          }))
          return (
            <div>
              {total > 0 && (
                <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 28, fontWeight: 900, color: theme.navy }}>{avg.toFixed(1)}</span>
                    <div>
                      <Stars value={avg} size={15} />
                      <p style={{ margin: 0, fontSize: 11.5, color: theme.textLight }}>{total} review{total !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  {breakdown.map((b) => (
                    <div key={b.star} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: theme.textMid, width: 26 }}>
                        {b.star}<Star size={11} color={theme.warning} fill={theme.warning} aria-hidden="true" />
                      </span>
                      <div style={{ flex: 1, height: 6, background: theme.bg, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${b.pct}%`, height: '100%', background: b.star >= 4 ? theme.success : b.star === 3 ? theme.warning : theme.alert, borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 11, color: theme.textLight, width: 24 }}>{b.count}</span>
                    </div>
                  ))}
                </div>
              )}

              {user && user.id !== id && (
                <form onSubmit={submitUserReview} style={{ border: `1px dashed ${theme.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>Leave a review</p>
                  <div style={{ marginBottom: 10 }}>
                    <StarPicker value={myRating} onChange={setMyRating} />
                  </div>
                  <textarea
                    value={myComment}
                    onChange={(e) => setMyComment(e.target.value)}
                    placeholder="Share your experience with this person…"
                    rows={3}
                    style={{ width: '100%', padding: 10, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'none' }}
                  />
                  <button type="submit" disabled={postingReview} style={{ marginTop: 10, width: '100%', padding: 11, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
                    {postingReview ? 'Posting…' : 'Post Review'}
                  </button>
                </form>
              )}

              {total === 0 && (
                <Empty icon={<Star size={40} color={theme.gray300} strokeWidth={1.5} />} message="No reviews yet." />
              )}

              {userReviews.map((r) => {
                const who = reviewers[r.user_id]
                const whoName = who?.full_name || who?.display_name || 'CareFind user'
                return (
                  <div key={r.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 13, background: theme.cardBg, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Link to={`/u/${r.user_id}`} style={{ fontSize: 13, fontWeight: 800, color: theme.navy, textDecoration: 'none' }}>
                        {whoName}
                        {<VerifiedBadge profile={who} size={14} style={{ marginLeft: 4 }} />}
                      </Link>
                      <Stars value={r.rating || 0} size={13} />
                    </div>
                    {r.comment && <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid, lineHeight: 1.5 }}>{r.comment}</p>}
                    <p style={{ margin: '4px 0 0 0', fontSize: 10.5, color: theme.textLight }}>{new Date(r.created_at).toLocaleDateString()}</p>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* Posts / Reposts grid */}
        {activeTab !== 'playlists' && activeTab !== 'reviews' && (() => {
          const list = activeTab === 'reposts' ? posts.filter(isRepost) : posts.filter((p) => !isRepost(p))
          if (list.length === 0) {
            return (
              <Empty
                icon={activeTab === 'reposts'
                  ? <Repeat2 size={40} color={theme.gray300} strokeWidth={1.5} />
                  : <MessageSquare size={40} color={theme.gray300} strokeWidth={1.5} />}
                message={activeTab === 'reposts' ? 'No reposts yet.' : 'No posts yet.'}
              />
            )
          }
          return <PostTileGrid posts={list} onOpen={setOpenPost} isMobile={isMobile} />
        })()}
      </div>

      {/* Expanded post */}
      {openPost && (
        <div onClick={() => setOpenPost(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 440, maxHeight: '80vh', overflowY: 'auto', padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setOpenPost(null)} aria-label="Close" style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: theme.gray400, cursor: 'pointer' }}><X size={20} aria-hidden="true" /></button>
            </div>
            {openPost.image_url && <img src={openPost.image_url} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: 12, display: 'block' }} />}
            {openPost.post_type === 'visual' && !openPost.image_url && (
              <div style={{ background: visualThemes[openPost.theme] || visualThemes.teal, padding: 22, borderRadius: 12, marginBottom: 12 }}>
                <p style={{ color: '#fff', fontSize: 16, fontWeight: 800, textAlign: 'center', margin: 0, whiteSpace: 'pre-wrap' }}>{openPost.content}</p>
              </div>
            )}
            {openPost.post_type !== 'visual' && <div style={{ margin: 0, fontSize: 15, color: theme.navy, lineHeight: 1.55 }}>{renderMarkdown(previewText(withoutRepostMark(openPost.content)))}</div>}
            <p style={{ margin: '12px 0 0 0', fontSize: 11, color: theme.textLight }}>{openPost.created_at ? timeAgo(openPost.created_at) : ''}</p>
          </div>
        </div>
      )}

      {/* Story viewer */}
      {viewerIndex !== null && userStories[viewerIndex] && (
        <StoryViewer
          stories={userStories}
          index={viewerIndex}
          onNavigate={navigateStory}
          onClose={closeViewer}
          renderHeader={(s) => (
            <>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14 }}>
                {displayName[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 800 }}>{displayName}</p>
                <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{timeAgo(s.created_at)}</p>
              </div>
            </>
          )}
        />
      )}

      <ConfirmDialog
        show={confirmConsultOpen}
        onClose={() => setConfirmConsultOpen(false)}
        onConfirm={confirmBookConsultation}
        title="Book this consultation?"
        consequence={`You'll be charged ${coinsForConsultation(consultOffer?.fee)} CareCoin${coinsForConsultation(consultOffer?.fee) === 1 ? '' : 's'} (₦${Number(consultOffer?.fee || 0).toLocaleString()}) from your CareCoins wallet for a ${consultOffer?.type || 'text'} consultation with ${displayName}. Paid directly by card if your wallet balance is low.`}
        confirmLabel="Book & Pay"
        danger={false}
      />
      <ConfirmDialog
        show={confirmSubOpen}
        onClose={() => setConfirmSubOpen(false)}
        onConfirm={confirmSubscribe}
        title="Subscribe to this creator?"
        consequence={`You'll be charged ${profile?.subscription_price} CareCoin${profile?.subscription_price === 1 ? '' : 's'} (₦${coinsToNaira(profile?.subscription_price || 0).toLocaleString()}) per month for access to their subscriber-only content. This renews automatically from your CareCoins wallet. You can turn off auto-renew anytime.`}
        confirmLabel="Subscribe"
        danger={false}
      />
      {sheetKind && (
        <FollowersSheet
          profileId={id}
          kind={sheetKind}
          count={sheetKind === 'followers' ? followerCount : followingCount}
          onClose={() => setSheetKind(null)}
          onCountChange={(delta) => {
            if (sheetKind === 'followers') setFollowerCount((n) => Math.max(0, n + delta))
            else setFollowingCount((n) => Math.max(0, n + delta))
          }}
        />
      )}
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />

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
      onCompose={() => navigate('/feed')}
      rightSidebar={sidebarContent}
    >
      {bodyContent}
    </AppShell>
  )
}

export default PublicProfile
