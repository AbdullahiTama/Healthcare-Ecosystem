import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import {
  Award, BadgeCheck, BookOpen, Bookmark, Building2, CalendarClock, Camera,
  Check, ChevronDown, ChevronRight, ChevronUp, Coins, Film, Flag, Link2, Lock, MapPin, Menu,
  MessageSquare, Repeat2,
  Pencil, Plus, Radio, ShoppingCart, Star, Stethoscope, Trash2, Wallet as WalletIcon, X,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { stripMarkers, previewText } from '../social-feed/richText.jsx'
import { renderMarkdown } from '../social-feed/markdown.jsx'
import ProductUpload from './ProductUpload.jsx'
import FollowersSheet from '../social-feed/FollowersSheet.jsx'
import { resizeImage } from '../../utils/imageResize.js'
import { MAX_PRICE_COINS, coinsToNaira } from '../subscriptions-monetization/subscriptions.js'
import { getActiveBusiness, setActiveBusiness, clearActiveBusiness, getActiveStaffIdentity, setActiveStaffIdentity, clearActiveStaffIdentity, getActiveIdentity } from '../../lib/activeIdentity'
import { Card, CardSkeleton, Empty, Modal, ConfirmDialog, Stars, Toast, useToast } from '../../components/ui'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import { isRepost } from '../social-feed/postDisplay.jsx'
import PostCard from '../social-feed/PostCard.jsx'
import GiftPanel from '../subscriptions-monetization/GiftPanel.jsx'
import { usePostEngagement } from '../social-feed/usePostEngagement'
import { formatCount } from '../social-feed/postSelectors'
import StoryViewer from '../social-feed/components/StoryViewer.jsx'

function Profile() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [profile, setProfile] = useState(null)
  const [ownedBusinesses, setOwnedBusinesses] = useState([])
  const [approvedClaims, setApprovedClaims] = useState([])
  const [postCount, setPostCount] = useState(0)
  const [followerCount, setFollowerCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [walletBalance, setWalletBalance] = useState(0)
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [location, setLocation] = useState('')
  const [bio, setBio] = useState('')
  const [website, setWebsite] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [subPrice, setSubPrice] = useState(0)
  const [savingPrice, setSavingPrice] = useState(false)
  const [activeBiz, setActiveBiz] = useState(getActiveBusiness())
  const [activeStaff, setActiveStaff] = useState(getActiveStaffIdentity())
  const [activeTab, setActiveTab] = useState('posts')
  const [myPosts, setMyPosts] = useState([])
  const [savedPosts, setSavedPosts] = useState([])
  const [myPlaylists, setMyPlaylists] = useState([])
  const [myReviews, setMyReviews] = useState([])
  const [reviewers, setReviewers] = useState({})
  const [tabLoading, setTabLoading] = useState(false)
  // Authors of the posts this profile has reposted, so a repost can name and
  // link the person who actually wrote it (issue #8).
  const [sourceAuthors, setSourceAuthors] = useState({})
  // Issues #3/#4: every post on this profile renders through the SAME
  // full-featured PostCard the feed uses — like, comment, share, gift, save,
  // and (on your own posts) Edit/Delete — driven by the same engagement layer,
  // not a degraded tile grid.
  const [unlockedCreators, setUnlockedCreators] = useState([])
  const [giftingPost, setGiftingPost] = useState(null) // { postId, authorId }
  // The four things a reader can report (same closed set as the feed).
  const REPORT_REASONS = ['Spam', 'False medical information', 'Harassment', 'Inappropriate content']
  const [menuOpen, setMenuOpen] = useState(false)
  const [myStories, setMyStories] = useState([])
  const [myShows, setMyShows] = useState([])
  const [now, setNow] = useState(Date.now())
  // Manage scheduled live: edit/reschedule/cancel lifecycle (spec-carefind-scheduled-live-manageable)
  const [editingShow, setEditingShow] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editScheduledAt, setEditScheduledAt] = useState('')
  const [editTrailerFile, setEditTrailerFile] = useState(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [cancelConfirmId, setCancelConfirmId] = useState(null)
  const [cancellingId, setCancellingId] = useState(null)
  const [storyComposer, setStoryComposer] = useState(false)
  const [sTitle, setSTitle] = useState('')
  const [sBody, setSBody] = useState('')
  const [sBg, setSBg] = useState('#0E6F5A')
  const [sImage, setSImage] = useState(null)
  const [postingStory, setPostingStory] = useState(false)
  // Sequential story viewer over myStories (Phase 5): progress bars + tap
  // zones instead of the old one-story-at-a-time viewer.
  const [viewerIndex, setViewerIndex] = useState(null)
  const [productUpload, setProductUpload] = useState(false)
  const [sheetKind, setSheetKind] = useState(null)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

  // Issues #3/#4 — the feed's shared engagement layer (main's usePostEngagement)
  // drives every PostCard on this profile. The index also contains the SOURCES
  // of reposts, so an interaction on a reposted article targets the original.
  const postIndex = []
  {
    const seen = new Set()
    for (const p of [...savedPosts, ...myPosts]) {
      if (p && !seen.has(p.id)) { seen.add(p.id); postIndex.push(p) }
      if (p?.source && !seen.has(p.source.id)) { seen.add(p.source.id); postIndex.push(p.source) }
    }
  }
  const postKey = postIndex.map((p) => p.id).join(',')
  const [sharingId, setSharingId] = useState(null)
  const [reportPostId, setReportPostId] = useState(null)
  const [reportingId, setReportingId] = useState(null)
  const [editingPost, setEditingPost] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const engagement = usePostEngagement({
    user,
    navigate,
    toast: { show: showToast },
    logEngagement: () => {},
    onSharingChange: setSharingId,
    onReportPost: setReportPostId,
    onEditingPostChange: setEditingPost,
    reloadFeed: () => { loadMyPosts(); loadSavedPosts() },
    onPostDeleted: () => { loadMyPosts(); loadSavedPosts() },
  })
  async function submitReport(reason) {
    const postId = reportPostId
    if (!user || !postId) return
    setReportingId(postId)
    const { error } = await supabase.from('reports').insert({ reporter_id: user.id, post_id: postId, reason })
    setReportingId(null)
    setReportPostId(null)
    if (error) {
      showToast('Could not send the report: ' + (error.message || 'unknown error'), { type: 'error' })
      return
    }
    showToast('Thanks: our team will review this post.', { type: 'success' })
  }
  // Counts, likes, saves, follows for these posts live in the hook's slices;
  // hydrate fills them whenever the loaded set changes.
  useEffect(() => {
    if (!postKey || !user) return undefined
    engagement.hydrate(postIndex).catch(() => {})
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postKey])
  function authorName(post) {
    if (post.posted_as_type) return post.posted_as_name || 'Business'
    const profiles = { ...sourceAuthors, ...engagement.state.profiles }
    const p = profiles[post.user_id]
    return p?.full_name || p?.display_name || 'CareFind user'
  }
  // Every prop PostCard needs besides `post`/`preview`. engagementProps carries
  // the counts, toggles, isLocked and resolveSource; the profile adds its own
  // chrome (gift/report/delete/detail modals) and overrides resolveSource so a
  // repost resolves against THIS page's index, not the feed's list.
  const cardProps = {
    ...engagement.engagementProps,
    user,
    navigate,
    authorName,
    myUsername,
    myAvatar,
    sharingId,
    editingPost,
    setEditingPost,
    setConfirmDeleteId,
    onGift: (p) => setGiftingPost({ postId: p.id, authorId: p.user_id }),
    // See more now expands inline in PostCard; tapping the post navigates to /post/:id
    onOpenDetail: (p) => navigate(`/post/${p.id}`),
    resolveSource: (id) => postIndex.find((p) => p.id === id) || null,
  }


  useEffect(() => {
    if (!user) { navigate('/login'); return }
    loadProfile()
    loadMyPosts()
    loadSavedPosts()
    loadMyPlaylists()
    loadMyReviews()
    loadMyStories()
    loadMyShows()
    loadApprovedClaims()
  }, [user])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  async function loadApprovedClaims() {
    if (!user) return
    const { data: claims, error } = await supabase
      .from('staff_claims')
      .select('id, staff_id, status, staff:staff_id(id, full_name, public_title, business_id)')
      .eq('user_id', user.id)
      .eq('status', 'approved')

    if (error) {
      console.error('Approved claims load error:', error)
      setApprovedClaims([])
      return
    }

    const list = claims || []
    const bizIds = [...new Set(list.map((c) => c.staff?.business_id).filter(Boolean))]
    let bizMap = {}
    if (bizIds.length > 0) {
      const { data: bizzes } = await supabase.from('businesses').select('id, name').in('id', bizIds)
      ;(bizzes || []).forEach((b) => { bizMap[b.id] = b.name })
    }

    setApprovedClaims(list.map((c) => ({
      ...c,
      businessName: c.staff?.business_id ? (bizMap[c.staff.business_id] || 'Company') : 'Company',
    })))
  }

  // Issue #6: this query used to omit `repost_of`, so every reference repost
  // looked like an ordinary post to isRepost() and the Reposts tab was always
  // empty while the Posts tab showed a bare 🔁 row. It now selects repost_of
  // AND resolves each source, so a reposted article appears on the reposting
  // user's own profile showing the original author's words, labelled as a
  // repost (issue #8).
  async function loadMyPosts() {
    if (!user) return
    const { data } = await supabase
      .from('posts')
      .select('id, content, created_at, post_type, image_url, image_urls, repost_of, user_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(60)
    setMyPosts(await withRepostSources(data || []))
  }

  // Attach `source` to every repost in a list, and remember who wrote each
  // source so the original author can be named and linked (issue #8).
  async function withRepostSources(list) {
    const ids = [...new Set(list.filter((p) => p.repost_of).map((p) => p.repost_of))]
    if (!ids.length) return list
    const { data: sources } = await supabase
      .from('posts')
      .select('id, content, created_at, post_type, image_url, image_urls, user_id')
      .in('id', ids)
    const byId = {}
    ;(sources || []).forEach((s) => { byId[s.id] = s })

    const authorIds = [...new Set((sources || []).map((s) => s.user_id).filter(Boolean))]
    if (authorIds.length) {
      const { data: authors } = await supabase
        .from('profiles')
        .select('id, display_name, full_name, is_verified')
        .in('id', authorIds)
      if (authors?.length) {
        setSourceAuthors((prev) => {
          const next = { ...prev }
          authors.forEach((a) => { next[a.id] = a })
          return next
        })
      }
    }

    return list.map((p) => (p.repost_of ? { ...p, source: byId[p.repost_of] || null } : p))
  }

  async function loadSavedPosts() {
    if (!user) return
    const { data } = await supabase
      .from('saved_posts')
      .select('post_id, posts(id, content, created_at, post_type, image_url, image_urls, repost_of, user_id)')
      .eq('user_id', user.id)
      .limit(60)
    setSavedPosts(await withRepostSources((data || []).map(s => s.posts).filter(Boolean)))
  }

  async function loadMyPlaylists() {
    if (!user) return
    const { data } = await supabase
      .from('playlists')
      .select('id, title, description, created_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
    setMyPlaylists(data || [])
  }

  async function loadMyReviews() {
    if (!user) return
    const { data } = await supabase
      .from('user_reviews')
      .select('id, rating, comment, created_at, user_id')
      .eq('subject_id', user.id)
      .order('created_at', { ascending: false })
    const rv = data || []
    setMyReviews(rv)

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

  async function loadMyStories() {
    if (!user) return
    const { data } = await supabase
      .from('stories')
      .select('id, title, body, image_url, bg_color, created_at, position, view_count')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    const sorted = (data || []).sort((a, b) => {
      const pa = a.position ?? Infinity
      const pb = b.position ?? Infinity
      if (pa !== pb) return pa - pb
      if ((b.view_count || 0) !== (a.view_count || 0)) return (b.view_count || 0) - (a.view_count || 0)
      return new Date(b.created_at) - new Date(a.created_at)
    })
    setMyStories(sorted)
  }

  // Sequential story viewer: progress bar, auto-advance, tap zones. Mirrors
  // the PublicProfile viewer so the same interaction works everywhere.
  useEffect(() => {
    if (viewerIndex === null) return
    const st = myStories[viewerIndex]
    if (st) supabase.rpc('increment_story_view', { story_id: st.id }).then(() => {}).catch(() => {})
  }, [viewerIndex])

  function closeStoryViewer() {
    setViewerIndex(null)
  }
  function navigateMyStory(next) {
    setViewerIndex(next === null || next < 0 || next >= myStories.length ? null : next)
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  async function loadMyShows() {
    if (!user) return
    const { data } = await supabase
      .from('live_shows')
      .select('id, title, status, scheduled_at, trailer_url, host_id')
      .eq('host_id', user.id)
      .in('status', ['live', 'scheduled', 'ended'])
      .order('scheduled_at', { ascending: true })
    setMyShows(data || [])
  }

  function toLocalDatetimeValue(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function openEditShow(s) {
    setEditError('')
    setEditTitle(s.title || '')
    setEditScheduledAt(toLocalDatetimeValue(s.scheduled_at))
    setEditTrailerFile(null)
    setEditingShow(s)
  }

  async function uploadEditTrailer() {
    if (!editTrailerFile) return null
    const ext = editTrailerFile.name.split('.').pop() || 'mp4'
    const path = `trailer-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('live-media').upload(path, editTrailerFile, { contentType: editTrailerFile.type || 'video/mp4' })
    if (upErr) return null
    const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
    return urlData.publicUrl
  }

  async function saveEditedShow() {
    if (!editingShow) return
    if (!editTitle.trim()) { setEditError('Give your show a title.'); return }
    if (!editScheduledAt) { setEditError('Pick a date & time.'); return }
    const newDate = new Date(editScheduledAt)
    if (isNaN(newDate.getTime())) { setEditError('Invalid date.'); return }
    if (newDate.getTime() <= Date.now() + 5 * 60 * 1000) { setEditError('Pick a time at least 5 minutes in the future.'); return }
    if (editingShow.status !== 'scheduled') { setEditError('Only scheduled shows can be edited.'); return }
    setEditSaving(true); setEditError('')
    let trailerUrl = editingShow.trailer_url || null
    if (editTrailerFile) {
      const uploaded = await uploadEditTrailer()
      if (uploaded) trailerUrl = uploaded
    }
    const patch = { title: editTitle.trim(), scheduled_at: newDate.toISOString() }
    if (trailerUrl !== editingShow.trailer_url) patch.trailer_url = trailerUrl
    const { error } = await supabase.from('live_shows').update(patch).eq('id', editingShow.id).eq('host_id', user.id).eq('status', 'scheduled')
    setEditSaving(false)
    if (error) {
      setEditError(error.message || 'Could not save.')
      if (error.code === '42501') showToast('You can only edit your own scheduled shows.', { type: 'error' })
      return
    }
    setEditingShow(null)
    showToast('Show updated.', { type: 'success' })
    loadMyShows()
  }

  async function confirmCancelShow() {
    if (!cancelConfirmId) return
    setCancellingId(cancelConfirmId)
    const targetId = cancelConfirmId
    const { error: delErr } = await supabase.from('live_shows').delete().eq('id', targetId).eq('host_id', user.id).eq('status', 'scheduled')
    if (delErr) {
      const { error: updErr } = await supabase.from('live_shows').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', targetId).eq('host_id', user.id).eq('status', 'scheduled')
      if (updErr) {
        showToast('Could not cancel: ' + (updErr.message || delErr.message), { type: 'error' })
        setCancellingId(null)
        return
      }
    }
    setCancelConfirmId(null)
    setCancellingId(null)
    showToast('Scheduled show cancelled.', { type: 'success' })
    loadMyShows()
  }

  const nowDate = new Date(now)
  const liveShows = myShows.filter((s) => s.status === 'live')
  const upcomingShows = myShows.filter((s) => s.status === 'scheduled' && s.scheduled_at && new Date(s.scheduled_at) > nowDate)
  const pastShows = myShows.filter((s) => s.status === 'ended' || (s.status === 'scheduled' && s.scheduled_at && new Date(s.scheduled_at) <= nowDate))

  async function postStory() {
    if (!sTitle.trim() && !sBody.trim() && !sImage) return
    setPostingStory(true)
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
      title: sTitle.trim() || null, body: sBody.trim() || null,
      image_url: imageUrl, bg_color: sBg, is_platform: false,
      user_id: user.id, expires_at: expiresAt,
    })
    setPostingStory(false)
    if (!error) {
      setSTitle(''); setSBody(''); setSBg('#0E6F5A'); setSImage(null); setStoryComposer(false)
      loadMyStories()
    } else {
      showToast('Could not post story: ' + error.message, { type: 'error' })
    }
  }

  async function loadProfile() {
    setLoading(true)
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, full_name, display_name, is_verified, verification_label, location, website, cover_url, avatar_url, subscription_price, bio')
      .eq('id', user.id)
      .maybeSingle()

    if (profileData) {
      setProfile(profileData)
      setFullName(profileData.full_name || '')
      setDisplayName(profileData.display_name || '')
      setLocation(profileData.location || '')
      setSubPrice(profileData.subscription_price || 0)
      setBio(profileData.bio || '')
      setWebsite(profileData.website || '')
    }

    const [bizRes, postRes, followerRes, followingRes, walletRes] = await Promise.all([
      supabase.from('businesses').select('id, name, business_type, cover_url, visible_on_carefind').eq('owner_id', user.id),
      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', user.id),
      supabase.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', user.id),
      supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle(),
    ])

    setOwnedBusinesses(bizRes.data || [])
    setPostCount(postRes.count || 0)
    setFollowerCount(followerRes.count || 0)
    setFollowingCount(followingRes.count || 0)
    setWalletBalance(walletRes.data?.balance || 0)
    setLoading(false)
  }

  async function saveProfile() {
    setSaving(true)
    await supabase.from('profiles').update({
      full_name: fullName.trim(),
      display_name: displayName.trim(),
      location: location.trim() || null,
      website: website.trim() || null,
      bio: bio.trim() || null,
    }).eq('id', user.id)
    setEditing(false)
    setSaving(false)
    loadProfile()
  }

  async function handleCoverUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploadingCover(true)
    // Shrink before upload: covers are wide, so allow a bigger max
    const resized = await resizeImage(file, 1400, 0.82)
    const path = `cover-${user.id}-${Date.now()}.jpg`
    const { error: upErr } = await supabase.storage
      .from('covers')
      .upload(path, resized, { contentType: 'image/jpeg' })
    if (!upErr) {
      const { data: urlData } = supabase.storage.from('covers').getPublicUrl(path)
      await supabase.from('profiles').update({ cover_url: urlData.publicUrl }).eq('id', user.id)
      loadProfile()
    } else {
      showToast('Could not upload cover: ' + upErr.message, { type: 'error' })
    }
    setUploadingCover(false)
  }

  async function savePrice() {
    const price = Math.max(0, Math.min(MAX_PRICE_COINS, Number(subPrice) || 0))
    setSavingPrice(true)
    const { error } = await supabase.from('profiles').update({ subscription_price: price }).eq('id', user.id)
    setSavingPrice(false)
    if (error) { showToast('Could not save price: ' + error.message, { type: 'error' }); return }
    loadProfile()
    showToast(price > 0
      ? `Subscriptions on at ${price} CareCoin${price === 1 ? '' : 's'} (₦${coinsToNaira(price).toLocaleString()}) per month.`
      : 'Subscriptions turned off.', { type: 'success' })
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploadingAvatar(true)
    // Avatars display small: 600px is plenty and keeps the upload tiny
    const resized = await resizeImage(file, 600, 0.85)
    const path = `avatar-${user.id}-${Date.now()}.jpg`
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, resized, { contentType: 'image/jpeg' })
    if (!upErr) {
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      await supabase.from('profiles').update({ avatar_url: urlData.publicUrl }).eq('id', user.id)
      loadProfile()
    } else {
      showToast('Could not upload photo: ' + upErr.message, { type: 'error' })
    }
    setUploadingAvatar(false)
  }

  function switchToBusiness(biz) {
    setActiveBusiness(biz)
    setActiveBiz({ id: biz.id, name: biz.name })
    setActiveStaff(null)
  }

  function switchToStaff(claim) {
    const identity = {
      staffId: claim.staff_id,
      fullName: claim.staff?.full_name,
      publicTitle: claim.staff?.public_title,
      businessId: claim.staff?.business_id,
      businessName: claim.businessName,
    }
    setActiveStaffIdentity(identity)
    setActiveStaff(identity)
    setActiveBiz(null)
  }

  function switchToPersonal() {
    clearActiveBusiness()
    clearActiveStaffIdentity()
    setActiveBiz(null)
    setActiveStaff(null)
  }

  async function handleSignOut() {
    clearActiveBusiness()
    clearActiveStaffIdentity()
    await signOut()
    navigate('/login')
  }

  if (loading) {
    const loadingContent = (
      <div role="status" aria-live="polite" style={{ maxWidth: isMobile ? 480 : 640, margin: '0 auto', padding: isMobile ? '20px 16px 90px' : 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading your profile</span>
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )
    if (isMobile) return loadingContent
    return (
      <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
        {loadingContent}
      </AppShell>
    )
  }

  const displayLabel = profile?.full_name || profile?.display_name || 'CareFind User'
  const hasAnyIdentity = ownedBusinesses.length > 0 || approvedClaims.length > 0
  const avgMyRating = myReviews.length
    ? myReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / myReviews.length
    : 0

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' }
      : { fontFamily: theme.fontFamily, maxWidth: 640, margin: '0 auto' }}>
      {/* Posting-as banner */}
      {(activeBiz || activeStaff) && (
        <div style={{ background: theme.navy, color: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          {activeStaff ? <Award size={17} aria-hidden="true" /> : <Building2 size={17} aria-hidden="true" />}
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800 }}>
              Posting as {activeStaff ? (activeStaff.publicTitle || 'Rep') + ' · ' + activeStaff.businessName : activeBiz.name}
            </p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.6)' }}>Your posts, comments & news use this identity</p>
          </div>
          <button onClick={switchToPersonal} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 16, padding: '6px 12px', fontSize: 11, fontWeight: 800 }}>
            Switch back
          </button>
        </div>
      )}

      {/* Cover */}
      <div style={{ position: 'relative', marginBottom: 55 }}>
        <div style={{ height: 120, background: profile?.cover_url ? `url(${profile.cover_url})` : theme.navy, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative' }}>
          <label style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(0,0,0,0.4)', color: '#fff', borderRadius: 16, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {uploadingCover ? 'Uploading…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Camera size={13} aria-hidden="true" /> Cover</span>}
            <input type="file" accept="image/*" onChange={handleCoverUpload} style={{ display: 'none' }} />
          </label>
        </div>
        <div style={{ position: 'absolute', bottom: -46, left: 16 }}>
          <div style={{ position: 'relative', width: 88, height: 88 }}>
            {myStories.length > 0 ? (
              <button
                type="button"
                onClick={() => setViewerIndex(0)}
                aria-label="View your story"
                style={{
                  width: 88, height: 88, borderRadius: '50%', padding: 3,
                  background: theme.tealDeep, border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', boxSizing: 'border-box',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
                }}
              >
                <div style={{
                  width: 82, height: 82, borderRadius: '50%',
                  background: profile?.avatar_url ? `url(${profile.avatar_url}) center/cover` : theme.tealDeep,
                  border: '3px solid #fff', boxSizing: 'border-box',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 30, fontWeight: 800,
                }}>
                  {!profile?.avatar_url && (displayLabel[0]?.toUpperCase() || '?')}
                </div>
              </button>
            ) : (
              <div style={{
                width: 88, height: 88, borderRadius: '50%',
                background: profile?.avatar_url ? `url(${profile.avatar_url}) center/cover` : theme.tealDeep,
                border: '4px solid #fff', boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 30, fontWeight: 800,
              }}>
                {!profile?.avatar_url && (displayLabel[0]?.toUpperCase() || '?')}
              </div>
            )}

            {/* Change photo */}
            <label style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 30, height: 30, borderRadius: '50%',
              background: theme.navy, border: '2px solid #fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            }}>
              {uploadingAvatar ? '…' : <Camera size={14} color="#fff" aria-hidden="true" />}
              <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Change profile photo</span>
              <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
            </label>
          </div>
          {myStories.length > 0 && (
            <span style={{ display: 'block', textAlign: 'center', fontSize: 10, fontWeight: 800, color: theme.tealDeep, marginTop: 2 }}>
              Tap to view story
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Name + edit */}
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" style={{ padding: 11, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10 }} />
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Username" style={{ padding: 11, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10 }} />
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" style={{ padding: 11, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10 }} />
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 160))}
              placeholder="Bio: tell people who you are"
              rows={3}
              style={{ padding: 11, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10, fontFamily: 'inherit', resize: 'none' }}
            />
            <p style={{ margin: '-4px 0 0 0', fontSize: 10.5, color: theme.textLight, textAlign: 'right' }}>{bio.length}/160</p>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website" style={{ padding: 11, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveProfile} disabled={saving} style={{ flex: 1, padding: 11, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13 }}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => setEditing(false)} style={{ flex: 1, padding: 11, background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 900, color: theme.navy, margin: '0 0 2px 0' }}>{displayLabel}</h1>
                {profile?.display_name && <p style={{ margin: '0 0 4px 0', fontSize: 13, color: theme.textLight }}>@{profile.display_name}</p>}
                {profile?.is_verified && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 11, fontWeight: 800, color: theme.tealDeep,
                    background: theme.tealMist, padding: '3px 10px', borderRadius: theme.radius.full,
                  }}>
                    {/* The stored label usually already reads "Verified Doctor" : 
                        prefixing it printed "Verified Verified Doctor". */}
                    <BadgeCheck size={13} aria-hidden="true" /> {profile.verification_label || profile.specialty || 'Verified'}
                  </span>
                )}
              </div>
              <button onClick={() => setEditing(true)} style={{ border: `1px solid ${theme.border}`, background: '#fff', color: theme.navy, borderRadius: 20, padding: '6px 16px', fontSize: 13, fontWeight: 700 }}>Edit</button>
            </div>
            {profile?.bio && (
              <p style={{ margin: '10px 0 0 0', fontSize: 13.5, color: theme.textMid, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {profile.bio}
              </p>
            )}
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              {profile?.location && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: theme.gray500 }}>
                  <MapPin size={13} aria-hidden="true" /> {profile.location}
                </span>
              )}
              {profile?.website && (
                <a href={profile.website} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: theme.tealDeep, textDecoration: 'none' }}>
                  <Link2 size={13} aria-hidden="true" /> {profile.website}
                </a>
              )}
            </div>
          </div>
        )}

        {/* WhatsApp-style: story ring lives on avatar. This row now holds
            only the Add-story action and live/upcoming shows — not story
            circles. Tapping the avatar (with ring) opens the sequential viewer. */}
        {/* Live & Upcoming row — expired scheduled are filtered out of Upcoming (spec) */}
        {(liveShows.length > 0 || upcomingShows.length > 0) ? (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, marginBottom: 12 }}>
          <button onClick={() => setStoryComposer(true)} aria-label="Add to story" style={{ flexShrink: 0, width: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer' }}>
            <div style={{ width: 58, height: 58, borderRadius: '50%', background: theme.bg, border: `2px dashed ${theme.tealDeep}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.tealDeep }}><Plus size={24} aria-hidden="true" /></div>
            <span style={{ fontSize: 10, fontWeight: 700, color: theme.textMid }}>Add story</span>
          </button>

          {liveShows.map((s) => (
            <Link key={s.id} to={`/live-show/${s.id}`} style={{ flexShrink: 0, width: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
              <div style={{ width: 58, height: 58, borderRadius: '50%', padding: 2, background: '#dc2626' }}>
                <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: theme.navy, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><Radio size={20} aria-hidden="true" /></div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#dc2626' }}>● LIVE</span>
            </Link>
          ))}

          {upcomingShows.map((s) => {
            const diff = s.scheduled_at ? new Date(s.scheduled_at) - now : 0
            const d = Math.max(0, Math.floor(diff / 86400000))
            const h = Math.max(0, Math.floor((diff % 86400000) / 3600000))
            const m = Math.max(0, Math.floor((diff % 3600000) / 60000))
            const label = diff <= 0 ? 'soon' : d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
            return (
              <Link key={s.id} to={`/live-show/${s.id}`} style={{ flexShrink: 0, width: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                <div style={{ width: 58, height: 58, borderRadius: '50%', padding: 2, background: theme.navy, position: 'relative' }}>
                  <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: theme.tealDeep, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><CalendarClock size={20} aria-hidden="true" /></div>
                  <span style={{ position: 'absolute', bottom: -3, left: '50%', transform: 'translateX(-50%)', background: theme.navy, color: '#fff', fontSize: 8, fontWeight: 900, padding: '1px 5px', borderRadius: 8, whiteSpace: 'nowrap' }}>{label}</span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, color: theme.navy }}>Upcoming</span>
              </Link>
            )
          })}
        </div>
        ) : myShows.length === 0 ? (
          <div style={{ display: 'flex', gap: 10, paddingBottom: 6, marginBottom: 12 }}>
            <button onClick={() => setStoryComposer(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 20, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, color: theme.tealDeep, cursor: 'pointer' }}>
              <Plus size={16} aria-hidden="true" /> Add to story
            </button>
            {myStories.length > 0 && (
              <span style={{ fontSize: 11, color: theme.textLight, alignSelf: 'center' }}>Tap your photo to view {myStories.length} stor{myStories.length === 1 ? 'y' : 'ies'}</span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, paddingBottom: 6, marginBottom: 12, alignItems: 'center' }}>
            <button onClick={() => setStoryComposer(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 20, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, color: theme.tealDeep, cursor: 'pointer' }}>
              <Plus size={16} aria-hidden="true" /> Add to story
            </button>
            <span style={{ fontSize: 11, color: theme.textLight }}>No upcoming lives</span>
          </div>
        )}

        {/* Manage upcoming scheduled shows — edit / reschedule / cancel */}
        {upcomingShows.length > 0 && (
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, marginBottom: 12, background: theme.cardBg }}>
            <p style={{ margin: '0 0 10px 0', fontSize: 11, fontWeight: 800, color: theme.navy, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Upcoming lives — manage</p>
            {upcomingShows.map((s) => {
              const target = s.scheduled_at ? new Date(s.scheduled_at) : null
              const when = target ? target.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short' }) : ''
              return (
                <div key={s.id} data-testid={`upcoming-manage-${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || 'Untitled live'}</p>
                    <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: theme.textLight }}>{when}</p>
                  </div>
                  <Link to={`/live-dashboard/${s.id}`} style={{ fontSize: 12, fontWeight: 700, color: theme.tealDeep, textDecoration: 'none' }}>View</Link>
                  <button onClick={() => openEditShow(s)} aria-label={`Edit ${s.title || 'show'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: `1px solid ${theme.border}`, background: '#fff', borderRadius: 20, fontSize: 12, fontWeight: 700, color: theme.navy, cursor: 'pointer' }}><Pencil size={12} aria-hidden="true" /> Edit</button>
                  <button onClick={() => setCancelConfirmId(s.id)} aria-label={`Cancel ${s.title || 'show'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: theme.dangerBg || '#fef2f2', color: theme.alert || '#dc2626', border: `1px solid ${theme.alert || '#dc2626'}`, borderRadius: 20, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}><Trash2 size={12} aria-hidden="true" /> Cancel</button>
                </div>
              )
            })}
          </div>
        )}

        {/* Past / Ended — expired scheduled_at no longer in Upcoming */}
        {pastShows.length > 0 && (
          <div data-testid="past-shows-section" style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, marginBottom: 12, background: theme.bg }}>
            <p style={{ margin: '0 0 8px 0', fontSize: 11, fontWeight: 800, color: theme.textLight, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Past / Ended</p>
            {pastShows.map((s) => {
              const when = s.scheduled_at ? new Date(s.scheduled_at).toLocaleDateString() : ''
              const label = s.status === 'ended' ? 'Ended' : (s.scheduled_at && new Date(s.scheduled_at) <= nowDate ? 'Expired' : s.status)
              return (
                <div key={s.id} data-testid={`past-show-${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: theme.gray300 || '#ccc', flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ flex: 1, fontSize: 12.5, color: theme.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || 'Untitled'} · {when} · {label}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'flex', gap: 20, borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`, padding: '12px 0', marginBottom: 16 }}>
          <div><p style={{ margin: 0, fontWeight: 900, fontSize: 16, color: theme.navy }}>{postCount}</p><p style={{ margin: 0, fontSize: 11, color: theme.textLight, fontWeight: 600 }}>Posts</p></div>
          <button onClick={() => setSheetKind('followers')} aria-label={`${followerCount} followers: view list`} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 16, color: theme.navy }}>{followerCount}</p><p style={{ margin: 0, fontSize: 11, color: theme.textLight, fontWeight: 600 }}>Followers</p>
          </button>
          <button onClick={() => setSheetKind('following')} aria-label={`${followingCount} following: view list`} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 16, color: theme.navy }}>{followingCount}</p><p style={{ margin: 0, fontSize: 11, color: theme.textLight, fontWeight: 600 }}>Following</p>
          </button>
          <button onClick={() => setActiveTab('reviews')} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 900, fontSize: 16, color: theme.navy }}>
              {avgMyRating ? avgMyRating.toFixed(1) : ': '}
              <Star size={13} color={theme.warning} fill={theme.warning} aria-hidden="true" />
            </p>
            <p style={{ margin: 0, fontSize: 11, color: theme.textLight, fontWeight: 600 }}>{myReviews.length} review{myReviews.length !== 1 ? 's' : ''}</p>
          </button>
        </div>

        {/* Account menu toggle */}
        <button onClick={() => setMenuOpen(m => !m)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 12, marginBottom: 14, cursor: 'pointer' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 800, color: theme.navy }}>
            <Menu size={16} aria-hidden="true" /> Account, wallet &amp; businesses
          </span>
          {menuOpen
            ? <ChevronUp size={16} color={theme.gray400} aria-hidden="true" />
            : <ChevronDown size={16} color={theme.gray400} aria-hidden="true" />}
        </button>

        {menuOpen && (<>
        {/* Wallet */}
        <Link to="/wallet" style={{ textDecoration: 'none' }}>
          <div style={{ background: theme.navy, borderRadius: 16, padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: '0 0 2px 0', fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>CareCoins Balance</p>
              <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 22, fontWeight: 900, color: '#fff' }}>
                <Coins size={20} aria-hidden="true" /> {walletBalance}
              </p>
            </div>
            <ChevronRight size={20} color="#fff" aria-hidden="true" />
          </div>
        </Link>

        {/* Paid subscriptions (verified only) */}
        {profile?.is_verified && (
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 14, marginBottom: 16 }}>
            <p style={{ margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: theme.navy }}>
              <Lock size={14} aria-hidden="true" /> Paid subscriptions
            </p>
            <p style={{ margin: '0 0 10px 0', fontSize: 11.5, color: theme.textLight }}>
              Set a monthly price and people can subscribe to unlock your subscriber-only posts. Set 0 to turn it off.
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {[0, 1, 2, 3, 5, 8, 12].map((c) => (
                <button
                  key={c}
                  onClick={() => setSubPrice(c)}
                  style={{
                    padding: '7px 11px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 800,
                    background: subPrice === c ? theme.tealDeep : theme.bg,
                    color: subPrice === c ? '#fff' : theme.textMid,
                  }}
                >
                  {c === 0 ? 'Off' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Coins size={12} aria-hidden="true" /> {c}</span>}
                </button>
              ))}
            </div>
            <p style={{ margin: '0 0 10px 0', fontSize: 12, fontWeight: 700, color: theme.tealDeep }}>
              {subPrice > 0
                ? `Subscribers pay ${subPrice} CareCoin${subPrice === 1 ? '' : 's'} (₦${coinsToNaira(subPrice).toLocaleString()}) per month`
                : 'Subscriptions are off'}
            </p>
            <button
              onClick={savePrice}
              disabled={savingPrice}
              style={{ width: '100%', padding: 11, background: theme.navy, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13 }}
            >
              {savingPrice ? 'Saving…' : 'Save subscription price'}
            </button>
          </div>
        )}

        {/* Sell on MedMarket: verified sellers, or anyone with an approved
            position at a company (listings are tagged with that company) */}
        {(profile?.is_verified || approvedClaims.length > 0 || ownedBusinesses.length > 0) ? (
          <button onClick={() => setProductUpload(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 12, marginBottom: 16, cursor: 'pointer' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 800 }}>
              <ShoppingCart size={16} aria-hidden="true" /> Add a product to MedMarket
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ) : (
          <div style={{ border: `1px dashed ${theme.border}`, borderRadius: 12, padding: 14, marginBottom: 16, background: theme.bg }}>
            <p style={{ margin: '0 0 4px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>Want to sell on MedMarket?</p>
            <p style={{ margin: '0 0 8px 0', fontSize: 11.5, color: theme.textLight, lineHeight: 1.5 }}>
              Verified sellers can list up to 20 products free. You can also sell under a company by getting an approved position there.
            </p>
            <Link to="/verify" style={{ fontSize: 12, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none' }}>Get verified →</Link>
          </div>
        )}

        {/* My Businesses + Post-as switcher */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>My Businesses & Positions</p>
            <Link to="/business-dashboard" style={{ fontSize: 12, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none' }}>Manage →</Link>
          </div>

          {!hasAnyIdentity && (
            <div style={{ border: `1px dashed ${theme.border}`, borderRadius: 14, padding: 16, textAlign: 'center' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: 13, color: theme.textLight }}>You don't manage any businesses or positions yet.</p>
              <Link to="/claim-business" style={{ fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none', display: 'block', marginBottom: 6 }}>Claim a business →</Link>
              <Link to="/claim-staff-position" style={{ fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none', display: 'block' }}>Claim your position at a company →</Link>
            </div>
          )}

          {/* Personal identity option */}
          {hasAnyIdentity && (
            <div
              onClick={switchToPersonal}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, border: `1px solid ${!activeBiz && !activeStaff ? theme.tealDeep : theme.border}`, background: !activeBiz && !activeStaff ? theme.tealMist : theme.cardBg, marginBottom: 8, cursor: 'pointer' }}
            >
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15 }}>
                {displayLabel[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: theme.navy }}>{displayLabel} <span style={{ fontSize: 11, color: theme.textLight, fontWeight: 600 }}>(you)</span></p>
                <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>Personal account</p>
              </div>
              {!activeBiz && !activeStaff && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, color: theme.tealDeep }}><Check size={13} strokeWidth={3} aria-hidden="true" /> Active</span>}
            </div>
          )}

          {/* Business identity options */}
          {ownedBusinesses.map((b) => {
            const isActive = activeBiz?.id === b.id
            return (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, border: `1px solid ${isActive ? theme.tealDeep : theme.border}`, background: isActive ? theme.tealMist : theme.cardBg, marginBottom: 8 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: b.cover_url ? `url(${b.cover_url})` : theme.navy, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>
                  {!b.cover_url && (b.name?.[0]?.toUpperCase() || <Building2 size={18} aria-hidden="true" />)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: theme.textLight, textTransform: 'capitalize' }}>{b.business_type}</p>
                </div>
                {isActive ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, color: theme.tealDeep }}><Check size={13} strokeWidth={3} aria-hidden="true" /> Active</span>
                ) : (
                  <button onClick={() => switchToBusiness(b)} style={{ background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 16, padding: '6px 12px', fontSize: 11, fontWeight: 800 }}>
                    Post as
                  </button>
                )}
              </div>
            )
          })}

          {/* Approved staff position options */}
          {approvedClaims.map((c) => {
            const isActive = activeStaff?.staffId === c.staff_id
            const title = c.staff?.public_title || 'Team Member'
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, border: `1px solid ${isActive ? theme.tealDeep : theme.border}`, background: isActive ? theme.tealMist : theme.cardBg, marginBottom: 8 }}>
                <div style={{ width: 40, height: 40, borderRadius: theme.radius.md, background: theme.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                  <Award size={19} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
                  <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{c.businessName}</p>
                </div>
                {isActive ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, color: theme.tealDeep }}><Check size={13} strokeWidth={3} aria-hidden="true" /> Active</span>
                ) : (
                  <button onClick={() => switchToStaff(c)} style={{ background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 16, padding: '6px 12px', fontSize: 11, fontWeight: 800 }}>
                    Post as
                  </button>
                )}
              </div>
            )
          })}
        </div>
        </>)}

        {/* Content tabs */}
        <div role="group" aria-label="Profile sections" className="cf-hscroll" style={{ display: 'flex', borderBottom: `1px solid ${theme.gray200}`, marginBottom: 14, WebkitOverflowScrolling: 'touch' }}>
          {[
            ['posts', 'Posts', MessageSquare],
            ['reposts', 'Reposts', Repeat2],
            ['saved', 'Saved', Bookmark],
            ['playlists', 'Playlists', Film],
            ['reviews', 'Reviews', Star],
          ].map(([key, label, Icon]) => (
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
          <div style={{ marginBottom: 16 }}>
            {profile?.is_verified && (
              <Link to="/playlist/create" style={{ display: 'block', textAlign: 'center', padding: 12, background: theme.tealDeep, color: '#fff', borderRadius: 12, fontWeight: 800, fontSize: 13, textDecoration: 'none', marginBottom: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Film size={15} aria-hidden="true" /> Create a playlist</span>
              </Link>
            )}
            {myPlaylists.length === 0 ? (
              <p style={{ textAlign: 'center', fontSize: 13, color: theme.textLight, padding: '20px 0' }}>{profile?.is_verified ? 'No playlists yet. Create your first series!' : 'No playlists yet.'}</p>
            ) : (
              myPlaylists.map(pl => (
                <Link key={pl.id} to={`/playlist/${pl.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 12, marginBottom: 8, textDecoration: 'none' }}>
                  <div style={{ width: 44, height: 44, borderRadius: theme.radius.md, background: theme.tealMist, color: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Film size={21} aria-hidden="true" /></div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.navy }}>{pl.title}</p>
                    {pl.description && <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.description}</p>}
                  </div>
                  <ChevronRight size={18} color={theme.gray400} aria-hidden="true" />
                </Link>
              ))
            )}
          </div>
        )}

        {/* Reviews tab: what people say about you (read-only) */}
        {activeTab === 'reviews' && (() => {
          const total = myReviews.length
          const avg = avgMyRating
          const breakdown = [5, 4, 3, 2, 1].map((n) => ({
            star: n,
            count: myReviews.filter((r) => r.rating === n).length,
            pct: total ? Math.round((myReviews.filter((r) => r.rating === n).length / total) * 100) : 0,
          }))
          return (
            <div style={{ marginBottom: 16 }}>
              {total > 0 && (
                <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 28, fontWeight: 900, color: theme.navy }}>{avg.toFixed(1)}</span>
                    <div>
                      <Stars value={avg} size={15} />
                      <p style={{ margin: 0, fontSize: 11.5, color: theme.textLight }}>{total} review{total !== 1 ? 's' : ''} about you</p>
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

              {total === 0 && <p style={{ textAlign: 'center', fontSize: 13, color: theme.textLight, padding: '24px 0' }}>No one has reviewed you yet.</p>}

              {myReviews.map((r) => {
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

        {/* Content grid */}
        {activeTab !== 'playlists' && activeTab !== 'reviews' && (() => {
          const list = activeTab === 'saved'
            ? savedPosts
            : activeTab === 'reposts'
              ? myPosts.filter(isRepost)
              : myPosts.filter((p) => !isRepost(p))

          if (list.length === 0) {
            const emptyCopy = {
              saved: 'Nothing saved yet.',
              reposts: 'No reposts yet.',
              posts: 'You have not posted yet.',
            }[activeTab] || 'Nothing here yet.'
            return (
              <Empty
                icon={activeTab === 'saved'
                  ? <Bookmark size={40} color={theme.gray300} strokeWidth={1.5} />
                  : activeTab === 'reposts'
                    ? <Repeat2 size={40} color={theme.gray300} strokeWidth={1.5} />
                    : <MessageSquare size={40} color={theme.gray300} strokeWidth={1.5} />}
                message={emptyCopy}
              />
            )
          }

          return (
            // Issues #3/#4: full PostCards, not tiles — every interaction the
            // feed offers works here too, including Edit/Delete on your own
            // posts via each card's overflow menu.
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              {list.map((p) => (
                <PostCard key={p.id} post={p} preview {...cardProps} />
              ))}
            </div>
          )
        })()}

        {menuOpen && (<>
        {/* Links */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
          <Link to="/saved" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 4px', textDecoration: 'none', color: theme.navy, borderBottom: `1px solid ${theme.border}` }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
              <Bookmark size={17} color={theme.gray500} aria-hidden="true" /> Saved posts
            </span>
            <ChevronRight size={17} color={theme.gray400} aria-hidden="true" />
          </Link>
          {!profile?.is_verified && (
            <Link to="/verify" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 4px', textDecoration: 'none', color: theme.navy, borderBottom: `1px solid ${theme.border}` }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
                <Stethoscope size={17} color={theme.gray500} aria-hidden="true" /> Get verified
              </span>
              <ChevronRight size={17} color={theme.gray400} aria-hidden="true" />
            </Link>
          )}
          <Link to="/earn" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 4px', textDecoration: 'none', color: theme.navy, borderBottom: `1px solid ${theme.border}` }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
              <WalletIcon size={17} color={theme.gray500} aria-hidden="true" /> Earn on CareFind
            </span>
            <ChevronRight size={17} color={theme.gray400} aria-hidden="true" />
          </Link>
        </div>
        </>)}

        <button onClick={handleSignOut} style={{ width: '100%', padding: 13, background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
          Sign Out
        </button>
      </div>

      {/* Issues #3/#4 — gifting, reporting and deletion use the same
          components the feed uses. */}

      {giftingPost && (
        <GiftPanel
          postId={giftingPost.postId}
          recipientId={giftingPost.authorId}
          onClose={() => {
            const { postId } = giftingPost
            setGiftingPost(null)
            // Reflect a just-sent gift in the card's count.
            supabase
              .rpc('post_gift_stats', { p_post_id: postId })
              .then(({ data }) => {
                if (data?.gift_count != null) {
                  engagement.state.setGiftStats((prev) => ({ ...prev, [postId]: { gift_count: data.gift_count, total_coins: data.total_coins } }))
                }
              })
              .catch(() => {})
          }}
        />
      )}

      <ConfirmDialog
        show={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => { engagement.engagementProps.handleDeletePost(confirmDeleteId); setConfirmDeleteId(null) }}
        title="Delete this post?"
        consequence="This cannot be undone. The post, along with its likes and comments, will be permanently removed."
        confirmLabel="Delete"
      />

      {/* Report reasons: a closed set, one tap each (same as the feed). */}
      <Modal show={!!reportPostId} onClose={() => setReportPostId(null)} title="Report this post" sheet={isMobile}>
        <p style={{ margin: '0 0 14px 0', fontSize: 13, color: theme.gray600, lineHeight: 1.6 }}>
          Tell us what's wrong with it. Our moderation team reviews every report: the author isn't told who reported them.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {REPORT_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => submitReport(reason)}
              disabled={!!reportingId}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44,
                padding: '11px 14px', borderRadius: theme.radius.md,
                border: `1px solid ${theme.gray200}`, background: '#fff',
                fontSize: 13, fontWeight: 700, color: theme.navy, fontFamily: theme.fontFamily,
                cursor: reportingId ? 'wait' : 'pointer', textAlign: 'left',
              }}
            >
              <Flag size={16} color={theme.gray400} aria-hidden="true" />
              {reason}
            </button>
          ))}
        </div>
      </Modal>

      {/* Story composer */}
      {storyComposer && (
        <div onClick={() => setStoryComposer(false)} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: 20, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.navy }}>Add to your story</h3>
              <button onClick={() => setStoryComposer(false)} aria-label="Close" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: theme.gray400, cursor: 'pointer' }}><X size={20} aria-hidden="true" /></button>
            </div>
            <div style={{ background: sBg, borderRadius: 14, padding: 20, marginBottom: 12, minHeight: 90 }}>
              <input value={sTitle} onChange={(e) => setSTitle(e.target.value)} placeholder="Story title…" style={{ width: '100%', background: 'none', border: 'none', color: '#fff', fontSize: 17, fontWeight: 800, outline: 'none', marginBottom: 6, boxSizing: 'border-box' }} />
              <textarea value={sBody} onChange={(e) => setSBody(e.target.value)} placeholder="Say something…" rows={2} style={{ width: '100%', background: 'none', border: 'none', color: '#fff', fontSize: 14, outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {['#0E6F5A', '#155A4B', '#be185d', '#0369a1', '#166534', '#b45309'].map(c => (
                <button key={c} onClick={() => setSBg(c)} style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: sBg === c ? '3px solid #333' : 'none' }} />
              ))}
            </div>
            <label style={{ display: 'block', fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', marginBottom: 12 }}>
              <Camera size={15} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 7 }} />{sImage ? sImage.name.slice(0, 24) : 'Add a photo (optional)'}
              <input type="file" accept="image/*" onChange={(e) => setSImage(e.target.files[0] || null)} style={{ display: 'none' }} />
            </label>
            <button onClick={postStory} disabled={postingStory} style={{ width: '100%', padding: 13, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14 }}>
              {postingStory ? 'Posting…' : 'Post story'}
            </button>
          </div>
        </div>
      )}

      {/* Story viewer — sequential playback with progress bars (Phase 5) */}
      {viewerIndex !== null && myStories[viewerIndex] && (
        <StoryViewer
          stories={myStories}
          index={viewerIndex}
          onNavigate={navigateMyStory}
          onClose={closeStoryViewer}
          renderHeader={(s) => (
            <>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14 }}>
                {(s.title?.[0] || (displayLabel?.[0] ?? '?')).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 800 }}>{displayLabel}</p>
                <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{timeAgo(s.created_at)}</p>
              </div>
            </>
          )}
        />
      )}

      {productUpload && (
        <ProductUpload
          businesses={ownedBusinesses}
          claimBusinesses={approvedClaims.map((c) => ({ id: c.staff?.business_id, name: c.businessName })).filter((b) => b.id)}
          onClose={() => setProductUpload(false)}
          onAdded={() => { loadProfile() }}
        />
      )}

      {sheetKind && (
        <FollowersSheet
          profileId={user.id}
          kind={sheetKind}
          count={sheetKind === 'followers' ? followerCount : followingCount}
          onClose={() => setSheetKind(null)}
          onCountChange={(delta) => {
            if (sheetKind === 'followers') setFollowerCount((n) => Math.max(0, n + delta))
            else setFollowingCount((n) => Math.max(0, n + delta))
          }}
        />
      )}

      {/* Edit scheduled live modal */}
      {editingShow && (
        <div onClick={() => setEditingShow(null)} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: 20, boxSizing: 'border-box', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.navy }}>Edit scheduled live</h3>
              <button onClick={() => setEditingShow(null)} aria-label="Close" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: theme.gray400, cursor: 'pointer' }}><X size={20} aria-hidden="true" /></button>
            </div>
            {editError && <p role="alert" style={{ margin: '0 0 10px 0', fontSize: 12.5, color: theme.alert, fontWeight: 600 }}>{editError}</p>}
            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: theme.textMid, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Title</label>
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Show title" style={{ width: '100%', padding: '11px 12px', fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10, boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: theme.textMid, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date & time</label>
            <input type="datetime-local" value={editScheduledAt} onChange={(e) => setEditScheduledAt(e.target.value)} style={{ width: '100%', padding: '11px 12px', fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10, boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' }} />
            <p style={{ margin: '-8px 0 12px 0', fontSize: 10.5, color: theme.textLight }}>Must be at least 5 minutes in the future.</p>
            <label style={{ display: 'block', fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', marginBottom: 16 }}>
              🎬 {editTrailerFile ? editTrailerFile.name.slice(0, 26) : (editingShow.trailer_url ? 'Change trailer video' : 'Add trailer video (optional)')}
              <input type="file" accept="video/*" onChange={(e) => setEditTrailerFile(e.target.files[0] || null)} style={{ display: 'none' }} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveEditedShow} disabled={editSaving} style={{ flex: 1, padding: 12, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14 }}>{editSaving ? 'Saving…' : 'Save changes'}</button>
              <button onClick={() => setEditingShow(null)} style={{ flex: 1, padding: 12, background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 14 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        show={!!cancelConfirmId}
        onClose={() => setCancelConfirmId(null)}
        onConfirm={confirmCancelShow}
        title="Cancel this scheduled live?"
        consequence="It will disappear from Upcoming immediately and be moved to Past/Ended. This cannot be undone."
        confirmLabel={cancellingId ? 'Cancelling…' : 'Cancel show'}
      />

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

export default Profile
