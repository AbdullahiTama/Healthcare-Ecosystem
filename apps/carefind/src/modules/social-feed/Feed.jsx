import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Award, BadgeCheck, Bell, BookOpen, Bookmark, Building2, Camera, Check, ChevronRight,
  Clapperboard, Download, Eye, FileText, Film, Gift, Hand, Heart, HelpCircle, Image as ImageIcon,
  Lock, MapPin, MessageCircle, MessageSquare, Mic, Moon, Newspaper, Pen, Pencil, Pill as PillIcon,
  Plus, Radio, Repeat2, Search as SearchIcon, Share2, ShoppingCart, Sparkles, Sprout, Star,
  Stethoscope, Trash2, Trees, Unlock, Waves, X, Flag,
} from 'lucide-react'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { createViewRecorder } from './engagement'
import { usePostEngagement } from './usePostEngagement.js'
import { CREATE_PARAM, logCreateSelectorRendered } from './createSelector.js'
import { unresolvedSourceIds, indexPosts } from './reposts.js'
import { resolveExperiment, applyExperimentConfig, logExperimentEvent } from './distributionExperiments'
import {
  MEDICAL_BUSINESS_TYPES, DEFAULT_RANKING_CONFIG, DEFAULT_POOLS, normalizeRegion,
  rankForYou, rankByScore, rankNearby,
} from './feedEngine'
import BottomNav from '../../components/BottomNav.jsx'
import { theme } from '../../styles/theme'
import { wrapBold, wrapItalic, wrapHighlight, renderArticleHtml } from '../news-publishing/articleFormat'
import { validateArticleForPublish } from '../news-publishing/articleContent.js'
import { renderMarkdown } from './markdown.jsx'
import GiftPanel from '../subscriptions-monetization/GiftPanel.jsx'
import VisualCard from '../../utils/VisualCard.jsx'
import ArticleEditor from '../news-publishing/ArticleEditor.jsx'
import GoLive from './GoLive.jsx'
import UserGoLive from './UserGoLive.jsx'
import { notifyReview } from '../../services/reviewNotifications.js'
import { ensureProfile } from '../../services/ensureProfile.js'
import Logo from './Logo.jsx'
import VoiceRecorder from '../../components/VoiceRecorder.jsx'
import DrawingBoard from '../../components/DrawingBoard.jsx'
import { resizeImage } from '../../utils/imageResize.js'
import { coinsToNaira } from '../subscriptions-monetization/subscriptions.js'
import SupportPrompt from '../../components/SupportPrompt.jsx'
import Stories from './Stories.jsx'
import { getActiveIdentity } from '../../lib/activeIdentity'
import PostCard from './PostCard.jsx'
import VideoFeed from './VideoFeed.jsx'
import PostDetailModal from './PostDetailModal.jsx'
import { postRepository } from './repositories'
import { TealBtn, Avatar, Modal, ConfirmDialog, CardSkeleton, Empty, Toast, useToast } from '../../components/ui'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import AppShell from '../../components/layout/AppShell.jsx'
import RightSidebar from '../../components/layout/RightSidebar.jsx'

// #7 Feed search. Prefers the tsvector index; if the migration hasn't been
// applied yet (search_vector missing), it falls back to a substring scan so
// search degrades gracefully instead of erroring.
async function searchPosts(query, { limit = 30 } = {}) {
  const q = (query || '').trim()
  if (!q) return []
  const { data, error } = await supabase
    .from('posts')
    .select(POST_FEED_COLS)
    .textSearch('search_vector', q, { type: 'plain', config: 'english' })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!error && data) return data
  // Fallback for pre-migration databases (no search_vector and/or no repost
  // columns yet): substring scan over the older column set.
  const { data: fb } = await supabase
    .from('posts')
    .select(POST_FEED_COLS_FALLBACK)
    .or(`content.ilike.%${q}%,posted_as_name.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(limit)
  return fb || []
}

// The columns the feed reads. repost_of/repost_count need the 20260813
// reposts migration; until it's applied they don't exist, so loadFeed and
// searchPosts fall back to the older set (same graceful-degradation pattern
// as the search_vector fallback above) instead of breaking the feed.
const POST_FEED_COLS = 'id, content, created_at, user_id, post_type, theme, image_url, rating, view_count, subscriber_only, audio_url, video_url, posted_as_type, posted_as_id, posted_as_name, posted_as_title, repost_of, repost_count'
const POST_FEED_COLS_FALLBACK = 'id, content, created_at, user_id, post_type, theme, image_url, rating, view_count, subscriber_only, audio_url, video_url, posted_as_type, posted_as_id, posted_as_name, posted_as_title'

// Explicit view-event mechanism (engagement spec §7): each qualifying view
// writes a post_view_events row and the DB bumps posts.view_count via
// trigger. createViewRecorder counts a post once per app load — a re-render,
// StrictMode double-effect, tab switch or pull-to-refresh cannot inflate it,
// while a fresh page load (new session) still records a repeat view. The DB
// enforces the same dedup with a unique index, so even a missed client guard
// can't double-count.
const recordFeedView = createViewRecorder(supabase)

function Feed() {
  const { user } = useAuth()
  const [subscriberOnly, setSubscriberOnly] = useState(false)
  const [cardAudio, setCardAudio] = useState(null)
  const [myUsername, setMyUsername] = useState('')
  const navigate = useNavigate()
  const [showDraw, setShowDraw] = useState(false)
  const [feedTab, setFeedTab] = useState('foryou')
  // Guards the feed_config tab save until the saved value has been loaded,
  // so the mount-default 'foryou' never overwrites the stored preference.
  const feedConfigLoadedRef = useRef(false)
  // Phase 6 personalized feed: resolved ranking config (weights/diversity),
  // pool limits, the viewer's region tokens, and the medical-author sets the
  // Medical tab + ranking boosts rely on. All default to safe fallbacks so a
  // missing migration can never break the feed.
  const [rankConfig, setRankConfig] = useState({ weights: DEFAULT_RANKING_CONFIG.weights, diversity: DEFAULT_RANKING_CONFIG.diversity })
  const [poolsConfig, setPoolsConfig] = useState(DEFAULT_POOLS)
  const [myRegion, setMyRegion] = useState([])
  const [medicalContext, setMedicalContext] = useState({ verifiedIds: [], medicalBizIds: [] })
  // Phase 7 staged rollout: the reader's resolved experiment group (null when
  // nothing is staged, so the feed and metrics stay inert). The feed_view
  // guard logs one retention event per session per experiment.
  const [activeExperiment, setActiveExperiment] = useState(null)
  const feedViewLoggedRef = useRef({})
  const [platformLive, setPlatformLive] = useState(null)
  const [myAvatar, setMyAvatar] = useState(null)
  const [seriesList, setSeriesList] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [cardVideo, setCardVideo] = useState(null)        // uploaded URL
  const [cardVideoPreview, setCardVideoPreview] = useState(null)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [sharingId, setSharingId] = useState(null)
  const [reportingId, setReportingId] = useState(null)
  const [reportPostId, setReportPostId] = useState(null)
  const [giftingPost, setGiftingPost] = useState(null)
  const [composerOpen, setComposerOpen] = useState(false) // { postId, authorId }
  const [editingPost, setEditingPost] = useState(null) // { id, content }
  const [content, setContent] = useState('')
  const [postType, setPostType] = useState('text') // text, visual, question, review, article
  const [visualTheme, setVisualTheme] = useState('teal')
  const [postRating, setPostRating] = useState(5)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const articleTextareaRef = useRef(null)
  const composerRef = useRef(null)
  const [highlightColor, setHighlightColor] = useState('#fde68a')
  const [reviewTarget, setReviewTarget] = useState(null) // { type: 'business'|'product', id, name }
  const [reviewSearch, setReviewSearch] = useState('')
  const [reviewSearchResults, setReviewSearchResults] = useState([])
  const [reviewSearching, setReviewSearching] = useState(false)
  const [profileComplete, setProfileComplete] = useState(true)
  const [canGoLive, setCanGoLive] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [latestNews, setLatestNews] = useState([])
  const [unreadNotifs, setUnreadNotifs] = useState(0)
  const [showGoLive, setShowGoLive] = useState(false)
  const [liveSessions, setLiveSessions] = useState([])
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const toast = useToast()

  // Everything that answers "what is this post's engagement context?" — the
  // state, the reads that fill it and the handlers that change it — lives in
  // usePostEngagement. Feed keeps ranking, the composer, the tabs, experiments
  // and its own chrome.
  //
  // The five callbacks are the seams where a handler needs something that
  // lives only here. Each has a no-op default in the hook, so a missing one
  // fails silently rather than loudly: all five are required.
  const engagement = usePostEngagement({
    user,
    navigate,
    toast,
    // toggleLike / sharePost / toggleSave log a staged-rollout engagement
    // event. The hook knows nothing about experiments, so the guard and the
    // payload stay here, exactly as those handlers used to inline them.
    logEngagement: (postId) => {
      if (activeExperiment) {
        logExperimentEvent(supabase, {
          experimentKey: activeExperiment.key,
          variant: activeExperiment.variant,
          eventType: 'engage',
          postId,
        }).catch(() => {})
      }
    },
    // shareCard's in-progress marker: PostCard disables the Voice-Card
    // download button and swaps its label to "Preparing…" off this.
    onSharingChange: setSharingId,
    // openReport hands the post to the reason picker below.
    onReportPost: setReportPostId,
    // handleEditPost closes the inline editor and refetches after a save.
    onEditingPostChange: setEditingPost,
    reloadFeed: loadFeed,
    // handleDeletePost's aftermath: the feed reloads its list. PostPage (the
    // hook's other consumer) navigates away instead — there is no list there.
    onPostDeleted: loadFeed,
  })
  const openCommentsRef = useRef(engagement.state.openComments)

  // Detail modal (Item 12): one post rendered in full via the shared PostCard.
  // Opened by a clamped card's "See more" or by a deep link (?post=<id>). The
  // deep-linked post loads async, so loading/error states live alongside it.
  const [detailPost, setDetailPost] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  // Item 12 deep link: ?post=<id> opens that post on top of the normal feed.
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkPostId = searchParams.get('post')
  // Item 5 bottom-nav Videos entry lands on /feed?tab=video; applied on mount
  // and then cleared so it never fights the persisted tab preference.
  const tabParam = searchParams.get('tab')
  const urlTabAppliedRef = useRef(false)
  // Issue #2: any screen's create button navigates here with ?create=1. The
  // feed is the only screen that can open the selector, so it opens it on
  // arrival and strips the flag — a refresh or a Back tap must not re-open it.
  const createParam = searchParams.get(CREATE_PARAM)

  // #7 In-feed post search. feedResults is null when not searching, so the
  // feed renders the normal ranked list; otherwise it renders search hits.
  const [feedQuery, setFeedQuery] = useState('')
  const [feedResults, setFeedResults] = useState(null)
  const [feedSearching, setFeedSearching] = useState(false)

  // #6 "New posts" pill: a realtime INSERT on posts bumps this counter; the
  // pill shows how many unseen posts are waiting. Clicking refreshes + clears.
  const [newPostsCount, setNewPostsCount] = useState(0)
  // #10a Pull-to-refresh: engaged only while the feed is scrolled to the top.
  const PULL_THRESHOLD = 70
  const pullStartY = useRef(0)
  const [pullDistance, setPullDistance] = useState(0)
  const [pullRefreshing, setPullRefreshing] = useState(false)

  // The four things a reader can actually report. Free text was the old
  // behaviour and produced unmoderatable rows ("idk", ""), so the reasons are
  // now a closed set the moderation queue can group by.
  const REPORT_REASONS = [
    'Spam',
    'False medical information',
    'Harassment',
    'Inappropriate content',
  ]

  // One place that answers "whose post is this": the header, the follow
  // button's label and the overflow menu's label all have to agree.
  function authorName(post) {
    if (post.posted_as_type) return post.posted_as_name || 'Business'
    const p = engagement.state.profiles[post.user_id]
    return p?.full_name || p?.display_name || 'CareFind user'
  }

  const FEED_TABS = [
    ['foryou', 'For you'],
    ['following', 'Following'],
    ['nearby', 'Nearby'],
    ['medical', 'Medical'],
    ['question', 'Questions'],
    ['article', 'Articles'],
    ['visual', 'Voice'],
    ['review', 'Reviews'],
    ['series', 'Series'],
    ['video', 'Videos'],
  ]

  const themeLabels = {
    'teal-depth': 'Ocean',
    'navy-clinical': 'Sky',
    'midnight-teal': 'Night',
    'forest-wellness': 'Forest',
    'slate-pulse': 'Pulse',
  }
  const themeKeys = Object.keys(themeLabels)

  const postTypeLabels = {
    text: 'Text Post',
    visual: 'Voice card',
    video: 'Video',
    question: 'Question',
    review: 'Review',
    article: 'Article',
  }

  const blockedPhrases = ['spam', 'buy now', 'click here', 'whatsapp me', 'send money', 'wire transfer']

  function screenContent(text) {
    const lower = text.toLowerCase()
    return blockedPhrases.some((phrase) => lower.includes(phrase))
  }

  async function searchReviewTargets(q) {
    if (!q.trim()) return
    setReviewSearching(true)
    const [bizRes, prodRes] = await Promise.all([
      supabase.from('businesses').select('id, name, business_type').eq('visible_on_carefind', true).ilike('name', `%${q}%`).limit(4),
      supabase.from('products').select('id, name, emoji').eq('list_on_carefind', true).ilike('name', `%${q}%`).limit(4),
    ])
    const results = [
      ...(bizRes.data || []).map((b) => ({ type: 'business', id: b.id, name: b.name, sub: b.business_type })),
      // The row's type is carried by its leading lucide icon (ICONS.md), not
      // by a glyph pasted into the name string.
      ...(prodRes.data || []).map((p) => ({ type: 'product', id: p.id, name: p.name, sub: 'Medication' })),
    ]
    if (results.length === 0) {
      results.push({ type: 'unclaimed', id: null, name: q.trim(), sub: 'Not yet listed: review anyway' })
    }
    setReviewSearchResults(results)
    setReviewSearching(false)
  }

  async function checkProfileComplete() {
    if (!user) { setProfileComplete(true); setCanGoLive(false); return }
    const { data } = await supabase
      .from('profiles')
      .select('full_name, display_name, phone, is_verified, verification_label, avatar_url')
      .eq('id', user.id)
      .maybeSingle()
    const complete = !!(data && data.full_name && data.display_name && data.phone)
    setProfileComplete(complete)
    setMyUsername(data?.display_name || data?.full_name || '')
    setMyAvatar(data?.avatar_url || null)
    // Only verified businesses or professionals can go live
    setCanGoLive(!!(data && data.is_verified))
  }

  // The ranking half of the old enrichAndSetPosts. engagement.hydrate() does
  // the fetching and owns the state it fills; ranking stays here because it
  // depends on the feed's tab, its resolved config and the reader's staged
  // experiment — none of which the hook knows about.
  async function hydrateAndRank(postData) {
    const base = await engagement.hydrate(postData, { merge: false })
    // hydrate() returns null for an empty batch, having cleared the slices it
    // owns. The post list is the feed's, so the feed clears that one itself —
    // without this an empty search would leave the previous posts on screen.
    if (!base) {
      engagement.state.setPosts([])
      return
    }

    // hydrate() cannot supply either of these: `myRegion` is Feed state that
    // loadEngineConfig fills, and `now` is per-render. Drop them and nothing
    // crashes — rankNearby just loses its region signal and the recency weight
    // reads undefined, so the feed ranks worse, invisibly.
    const context = { ...base, viewerRegion: myRegion, now: Date.now() }

    // For You goes through the full pipeline (pools + diversity), with any
    // staged-rollout treatment overrides merged over the base config. Nearby
    // is a dedicated region view. Every other tab keeps the plain weighted
    // score — diversity caps must never hide posts a reader explicitly asked
    // for, and experiments never touch those explicit views.
    const byScore = rankByScore({ posts: postData, context, weights: rankConfig.weights })
    let ranked
    if (feedTab === 'foryou') {
      const effective = applyExperimentConfig({
        base: { weights: rankConfig.weights, diversity: rankConfig.diversity, pools: poolsConfig },
        experiment: activeExperiment,
      })
      ranked = rankForYou({
        posts: postData,
        context,
        weights: effective.weights,
        diversity: effective.diversity,
        pools: effective.pools,
      })
    } else if (feedTab === 'nearby') {
      ranked = rankNearby(byScore, context)
    } else {
      ranked = byScore
    }
    engagement.state.setPosts(ranked)
  }

  // Detail modal open/close. Both the See-more button and the deep link land
  // here so every surface opens the post through one path.
  function openPostDetail(post) {
    setDetailPost(post)
    setDetailLoading(false)
    setDetailError('')
  }

  function closePostDetail() {
    setDetailPost(null)
    setDetailLoading(false)
    setDetailError('')
  }

  // Clear the ?post= param after the deep-linked post has been resolved,
  // without navigating (mirrors BusinessProfile's ?reference= handling).
  function clearPostParam() {
    const next = new URLSearchParams(searchParams)
    next.delete('post')
    const qs = next.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    setSearchParams(next, { replace: true })
  }

  // Mirrors clearPostParam for the ?tab= landing param (Item 5).
  function clearTabParam() {
    const next = new URLSearchParams(searchParams)
    next.delete('tab')
    const qs = next.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    setSearchParams(next, { replace: true })
  }

  // Item 5: honor a ?tab=<key> landing param (bottom-nav Videos entry). Applied
  // once on mount, then dropped so a reload returns to the persisted tab.
  useEffect(() => {
    if (!tabParam || !FEED_TABS.some(([key]) => key === tabParam)) return
    urlTabAppliedRef.current = true
    setFeedTab(tabParam)
    clearTabParam()
  }, [])

  // Issue #2: honour ?create=1 from another screen's create button. Runs on
  // every change of the param (not just mount) so a second tap from the same
  // page re-opens the selector, and drops the flag once it has been consumed.
  useEffect(() => {
    if (createParam !== '1') return
    setCreateOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete(CREATE_PARAM)
    const qs = next.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    setSearchParams(next, { replace: true })
  }, [createParam])

  // The event that proves a create tap worked. Correlating "[create] tap" with
  // this in the logs is how a recurrence of issue #2 becomes visible: a tap
  // with no selector rendered after it is the regression.
  useEffect(() => {
    if (createOpen) logCreateSelectorRendered({ source: 'feed' })
  }, [createOpen])

  // Merge extra author profiles into the map without disturbing the ones the
  // feed already loaded. Used when a repost's source has an author who wrote
  // nothing else on this page.
  const PROFILE_CARD_COLS = 'id, display_name, full_name, is_verified, verification_label, specialty, avatar_url, location, country'
  async function loadProfilesFor(userIds) {
    if (!userIds?.length) return
    const { data } = await supabase.from('profiles').select(PROFILE_CARD_COLS).in('id', userIds)
    if (data?.length) engagement.state.setProfiles((prev) => ({ ...prev, ...indexPosts(data) }))
  }

  // Reposts (issues #6/#8): fetch the source of every repost on this page
  // that is not already loaded, so the card can show the original author's
  // words under a "Reposted by" banner instead of the reposter's name over a
  // copy. Runs whenever the loaded posts change; ids already fetched are
  // skipped, so scrolling does not refetch.
  useEffect(() => {
    const wanted = unresolvedSourceIds(engagement.state.posts).filter((id) => !engagement.state.repostSources[id])
    if (!wanted.length) return
    let cancelled = false
    supabase
      .from('posts')
      .select(POST_FEED_COLS)
      .in('id', wanted)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        engagement.state.setRepostSources((prev) => ({ ...prev, ...indexPosts(data) }))
        // The source's author may not be in `profiles` yet — without it the
        // card would credit "CareFind user" instead of the real writer.
        const missingAuthors = [...new Set(data.map((p) => p.user_id))].filter((id) => id && !engagement.state.profiles[id])
        if (missingAuthors.length) loadProfilesFor(missingAuthors)
      })
    return () => { cancelled = true }
  }, [engagement.state.posts])

  // Item 12 deep link: when the URL carries ?post=<id>, open that post in the
  // detail modal on top of the normal feed, then drop the param. A post
  // already in the loaded feed list is preferred (no refetch); otherwise it's
  // fetched + enriched through the same path the feed uses. Missing/deleted
  // posts close the modal silently — the feed itself is never disturbed.
  useEffect(() => {
    if (!deepLinkPostId) return
    let cancelled = false
    const existing = engagement.state.posts.find((p) => p.id === deepLinkPostId)
    const resolveTo = (post) => {
      if (cancelled) return
      openPostDetail(post)
      clearPostParam()
    }
    const fail = () => {
      if (cancelled) return
      closePostDetail()
      clearPostParam()
    }

    if (existing) {
      resolveTo(existing)
      return () => { cancelled = true }
    }

    setDetailLoading(true)
    postRepository
      .getPostById(deepLinkPostId)
      .then((data) => {
        if (cancelled) return
        if (!data) { fail(); return }
        // merge:true — a deep-linked post must light up the same counts the
        // feed cards show without ever clobbering the loaded feed. It is one
        // post, so nothing is ranked and the post list is left alone.
        return engagement.hydrate([data], { merge: true }).then(() => data)
      })
      .then((post) => { if (!cancelled && post) resolveTo(post) })
      .catch(() => { if (!cancelled) fail() })
    return () => { cancelled = true }
  }, [deepLinkPostId])

  // The feed loads in parallel with the deep-link fetch. If the deep-linked
  // post lands in the loaded list while the modal is still loading, swap to
  // that in-memory copy instead of the fetched one.
  useEffect(() => {
    if (!deepLinkPostId || !detailLoading) return
    const existing = engagement.state.posts.find((p) => p.id === deepLinkPostId)
    if (existing) { openPostDetail(existing); clearPostParam() }
  }, [engagement.state.posts, deepLinkPostId, detailLoading])

  async function loadFeed() {
    setLoading(true)
    setNewPostsCount(0)
    // Video / Medical tabs are dedicated server queries (real clips; medical
    // authors only), NOT slices of the shared latest-50 feed — a tab that
    // depends on a sparse column or an author-class filter could otherwise
    // look empty by chance, and Medical must never mix general content.
    let query = supabase
      .from('posts')
      .select(POST_FEED_COLS)
      .order('created_at', { ascending: false })
      .limit(50)
    if (feedTab === 'video') query = query.not('video_url', 'is', null)
    if (feedTab === 'medical') {
      const { verifiedIds, medicalBizIds } = medicalContext
      const ors = []
      if (verifiedIds.length) ors.push(`user_id.in.(${verifiedIds.join(',')})`)
      if (medicalBizIds.length) ors.push(`posted_as_id.in.(${medicalBizIds.join(',')})`)
      if (ors.length) query = query.or(ors.join(','))
      else query = query.eq('id', '00000000-0000-0000-0000-000000000000') // empty set
    }
    let { data: postData, error } = await query

    // Pre-20260813-reposts migration: the repost columns don't exist, so retry
    // with the older column set rather than breaking the whole feed.
    if (error) {
      let fbq = supabase
        .from('posts')
        .select(POST_FEED_COLS_FALLBACK)
        .order('created_at', { ascending: false })
        .limit(50)
      if (feedTab === 'video') fbq = fbq.not('video_url', 'is', null)
      if (feedTab === 'medical') {
        const { verifiedIds, medicalBizIds } = medicalContext
        const ors = []
        if (verifiedIds.length) ors.push(`user_id.in.(${verifiedIds.join(',')})`)
        if (medicalBizIds.length) ors.push(`posted_as_id.in.(${medicalBizIds.join(',')})`)
        if (ors.length) fbq = fbq.or(ors.join(','))
        else fbq = fbq.eq('id', '00000000-0000-0000-0000-000000000000')
      }
      const fb = await fbq
      postData = fb.data
      error = fb.error
    }

    if (error) {
      console.error('Feed load error:', error)
      engagement.state.setPosts([])
      setLoading(false)
      return
    }

    const postIds = (postData || []).map((p) => p.id)

    // hydrateAndRank fetches the engine context and ranks (For You: pools +
    // diversity; Nearby: region view; others: plain weighted score).
    // Read receipts then mark this batch read so the next refresh doesn't
    // treat the same 50 as new. Requires the 20260813 feed-persistence
    // migration; if it isn't applied the RPC degrades to a no-op.
    await hydrateAndRank(postData)
    if (user) {
      try {
        await supabase.rpc('read_posts_all', { p_post_ids: postIds })
      } catch (e) {
        console.warn('read_posts_all failed (migration not applied?):', e)
      }
    }

    // Record a view for each post shown — once per session, fire and forget.
    // record_post_view needs the 20260813 post_view_events migration; until
    // it's applied the RPC is missing and this degrades to a no-op (the old
    // increment_post_view kept counting every refresh, which is exactly the
    // inflation §7 forbids).
    ;(postData || []).forEach((p) => { recordFeedView.record(p.id) })

    setLoading(false)
  }

  useEffect(() => {
    loadFeed()
    checkProfileComplete()
    loadLatestNews()
    loadUnreadNotifs()
    loadPlatformLive()
    loadSeries()
    loadLiveSessions()
  }, [user])

  // Phase 6: load the personalized-feed config (weights, pools) and the
  // signals the engine needs that aren't part of the posts query — the
  // viewer's region (Nearby tab + location signal) and the current sets of
  // verified professionals and active medical facilities (Medical tab). The
  // 20260813_feed_engine migration makes the config real; without it every
  // read degrades to the built-in defaults and the feed still ranks.
  async function loadEngineConfig() {
    const { data: rows } = await supabase.from('feed_ranking_config').select('key, value')
    if (rows && rows.length) {
      const byKey = {}
      rows.forEach((r) => { byKey[r.key] = r.value })
      setRankConfig({
        weights: { ...DEFAULT_RANKING_CONFIG.weights, ...(byKey.weights || {}) },
        diversity: { ...DEFAULT_RANKING_CONFIG.diversity, ...(byKey.diversity || {}) },
      })
    }
    const { data: poolRows } = await supabase.from('candidate_generation_pools').select('pool, enabled, priority, limit_count')
    if (poolRows && poolRows.length) {
      const next = {}
      poolRows.forEach((r) => { next[r.pool] = { enabled: r.enabled !== false, priority: r.priority, limitCount: r.limit_count } })
      setPoolsConfig({ ...DEFAULT_POOLS, ...next })
    }
    if (user) {
      const { data: me } = await supabase.from('profiles').select('location, country').eq('id', user.id).maybeSingle()
      if (me) setMyRegion(normalizeRegion(`${me.location || ''} ${me.country || ''}`))
    }
    const [{ data: vp }, { data: mb }] = await Promise.all([
      supabase.from('profiles').select('id').eq('is_verified', true),
      supabase.from('businesses').select('id').in('business_type', MEDICAL_BUSINESS_TYPES).eq('status', 'active'),
    ])
    setMedicalContext({
      verifiedIds: (vp || []).map((r) => r.id),
      medicalBizIds: (mb || []).map((r) => r.id),
    })

    // Phase 7: resolve the reader's staged-rollout group (deterministic bucket
    // over user/session id). No experiment staged ⇒ null ⇒ the feed uses the
    // base config and logs no metrics. When the reader lands in the treatment
    // group the For You ranking must apply its config, so reload the current
    // feed once the group is known (experiments are off by default; this only
    // costs a refetch while one is actually staged).
    const { data: expRows } = await supabase
      .from('content_distribution_experiments')
      .select('key, label, enabled, rollout_pct, variant, config, start_at, end_at')
    setActiveExperiment(resolveExperiment({
      experiments: expRows || [],
      userId: user?.id || null,
      sessionId: recordFeedView.sessionId,
    }))
  }
  useEffect(() => { loadEngineConfig() }, [user])

  // Phase 7: the reader's experiment group is known only after loadEngineConfig
  // resolves it, and the ranking must apply the treatment's config from the
  // first treatment-group render. Reloading via an effect (rather than calling
  // loadFeed() inside loadEngineConfig) runs AFTER the state commits, so the
  // reload's closure sees the fresh activeExperiment. Experiments are off by
  // default — this only costs a refetch while one is actually staged.
  useEffect(() => {
    if (activeExperiment?.treatment) loadFeed()
  }, [activeExperiment])

  // Phase 7 retention signal: one feed_view per session per staged experiment,
  // tagged with the reader's variant — control included, which is what makes
  // the A/B comparison valid. A dedicated effect (not loadFeed) means control
  // users, who never trigger the treatment reload, still log theirs. Fire and
  // forget; the metric write can never fail the feed.
  useEffect(() => {
    if (activeExperiment && feedTab === 'foryou' && !feedViewLoggedRef.current[activeExperiment.key]) {
      feedViewLoggedRef.current[activeExperiment.key] = true
      logExperimentEvent(supabase, {
        experimentKey: activeExperiment.key,
        variant: activeExperiment.variant,
        eventType: 'feed_view',
      }).catch(() => {})
    }
  }, [activeExperiment, feedTab])

  // Persisted feed-tab preference (feed_config): load the stored tab once per
  // user, and only save after it has been applied so the mount default
  // 'foryou' never overwrites it. Requires the 20260813 feed-persistence
  // migration; without it the reads/writes fail silently and the tab just
  // isn't remembered across visits.
  useEffect(() => {
    if (!user) { feedConfigLoadedRef.current = true; return }
    if (urlTabAppliedRef.current) { feedConfigLoadedRef.current = true; return }
    supabase
      .from('feed_config')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'feed_tab')
      .maybeSingle()
      .then(({ data }) => {
        feedConfigLoadedRef.current = true
        const saved = data?.value
        if (saved && FEED_TABS.some(([key]) => key === saved)) setFeedTab(saved)
      })
      .catch(() => { feedConfigLoadedRef.current = true })
  }, [user])

  useEffect(() => {
    if (!user || !feedConfigLoadedRef.current) return
    supabase
      .from('feed_config')
      .upsert({ user_id: user.id, key: 'feed_tab', value: feedTab })
      .then(() => {})
      .catch(() => {})
  }, [user, feedTab])

  // Video / Nearby / Medical are dedicated server queries (real clips; region
  // view; medical authors only), not slices of the shared 50-post feed —
  // otherwise a tab that depends on a sparse column or an author-class filter
  // could look empty by chance. Entering any of them refetches its batch;
  // leaving them restores the normal feed so the other tabs never inherit the
  // filtered list.
  const prevTabRef = useRef(feedTab)
  useEffect(() => {
    const prev = prevTabRef.current
    prevTabRef.current = feedTab
    const dedicated = ['video', 'nearby', 'medical']
    if (dedicated.includes(feedTab) || dedicated.includes(prev)) loadFeed()
  }, [feedTab])

  // #7 In-feed search: debounced. While a query is present, feedResults is
  // non-null and the list renders search hits instead of the ranked feed.
  useEffect(() => {
    const q = feedQuery.trim()
    if (!q) {
      if (feedResults !== null) { setFeedResults(null); loadFeed() }
      return
    }
    const t = setTimeout(() => { runFeedSearch(q) }, 350)
    return () => clearTimeout(t)
  }, [feedQuery])

  async function runFeedSearch(q) {
    setFeedSearching(true)
    const data = await searchPosts(q)
    await hydrateAndRank(data)
    setFeedResults(data)
    setFeedSearching(false)
  }

  openCommentsRef.current = engagement.state.openComments

  useEffect(() => {
    const channel = supabase
      .channel('post-comments-realtime')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'post_comments' },
        (payload) => {
          const newComment = payload.new
          if (openCommentsRef.current[newComment.post_id]) {
            supabase
              .from('post_comments')
              .select('id, content, created_at, user_id, parent_id, mentions, profiles!user_id(id, display_name, full_name, is_verified, specialty, avatar_url), post_comment_likes(id, user_id)')
              .eq('id', newComment.id)
              .single()
              .then(({ data }) => {
                if (data) {
                  engagement.engagementProps.setComments(prev => {
                    const existing = prev[data.post_id] || []
                    if (existing.some(c => c.id === data.id)) return prev
                    return { ...prev, [data.post_id]: [...existing, data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) }
                  })
                }
              })
            engagement.state.setCommentCounts(prev => ({ ...prev, [newComment.post_id]: (prev[newComment.post_id] || 0) + 1 }))
          }
        }
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        () => { setNewPostsCount(c => c + 1) }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function loadLiveSessions() {
    const { data } = await supabase
      .from('live_sessions')
      .select('*, profiles(full_name, display_name, specialty)')
      .eq('status', 'live')
      .order('started_at', { ascending: false })
      .limit(5)
    setLiveSessions(data || [])
  }

  async function loadLatestNews() {
    const { data } = await supabase
      .from('news')
      .select('id, headline, hero_image_url, published_at')
      .eq('status', 'approved')
      .order('published_at', { ascending: false })
      .limit(6)
    setLatestNews(data || [])
  }

  // Short clip as the card backdrop. Kept small on purpose: data is expensive.
  async function handleCardVideo(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 12 * 1024 * 1024) {
      toast.show('That clip is too large. Please choose one under 12MB (about 15 seconds).')
      return
    }
    setUploadingVideo(true)
    const ext = file.name.split('.').pop() || 'mp4'
    const path = `card-${user.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('live-media')
      .upload(path, file, { contentType: file.type || 'video/mp4' })
    if (upErr) {
      setUploadingVideo(false)
      toast.show('Could not upload the clip: ' + upErr.message)
      return
    }
    const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
    setCardVideo(urlData.publicUrl)
    setCardVideoPreview(URL.createObjectURL(file))
    // A clip and a photo can't both be the backdrop
    setImageFile(null)
    setImagePreview(null)
    setUploadingVideo(false)
  }

  // The banner is for CareFind's own broadcasts only. A user going live
  // shows up in the stories rail and in notifications, not here.
  async function loadPlatformLive() {
    const { data } = await supabase
      .from('live_shows')
      .select('id, title')
      .eq('status', 'live')
      .eq('is_platform', true)
      .order('started_at', { ascending: false })
      .limit(1)
    setPlatformLive(data && data[0] ? data[0] : null)
  }

  async function loadSeries() {
    const { data } = await supabase
      .from('playlists')
      .select('id, title, description, owner_id, created_at')
      .order('created_at', { ascending: false })
      .limit(30)
    setSeriesList(data || [])
  }

  async function loadUnreadNotifs() {
    if (!user) { setUnreadNotifs(0); return }
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .eq('read', false)
    setUnreadNotifs(count || 0)
  }


  function handleImageSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  function clearImage() {
    setImageFile(null)
    setImagePreview(null)
  }

  async function handlePost(e) {
    e.preventDefault()
    if (!user) return
    if (postType === 'video') {
      if (!cardVideo) {
        toast.show('Choose a video before posting.')
        return
      }
    } else if (!content.trim()) {
      return
    }
    // Issue #4: an article body is a JSON block array, so validate and repair
    // it BEFORE anything irreversible happens (image upload, insert). The gate
    // refuses rather than persisting a body that lost a block or a paragraph,
    // and logs the published shape either way.
    let postContent = content.trim()
    if (postType === 'article') {
      const check = validateArticleForPublish(postContent)
      if (!check.ok) {
        toast.show(check.error, { type: 'error' })
        return
      }
      postContent = check.content
    }

    setPosting(true)

    let imageUrl = null

    if (imageFile) {
      setUploadingImage(true)

      // Shrink first: a full-size phone photo is often 5-8MB and the upload dies on it.
      const resized = await resizeImage(imageFile, 1400, 0.85)
      const filePath = `${user.id}-${Date.now()}.jpg`

      const { error: uploadError } = await supabase.storage
        .from('post-images')
        .upload(filePath, resized, { contentType: 'image/jpeg' })

      setUploadingImage(false)

      if (uploadError) {
        // Never post silently without the photo the user chose.
        setPosting(false)
        toast.show('Could not upload the photo: ' + uploadError.message)
        return
      }

      const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(filePath)
      imageUrl = urlData.publicUrl
    }

    if (screenContent(postContent)) {
      toast.show('Your post was flagged for review. Please remove any spam-like content and try again.')
      setPosting(false)
      return
    }

    const identity = getActiveIdentity()

    // fk_posts_user guard: ensure the poster has a profiles row first
    await ensureProfile(user)

    const { error } = await supabase.from('posts').insert({
      user_id: user.id,
      content: postContent,
      post_type: postType,
      subscriber_only: subscriberOnly,
      audio_url: postType === 'visual' ? cardAudio : null,
      video_url: postType === 'visual' || postType === 'video' ? cardVideo : null,
      theme: postType === 'visual' ? visualTheme : null,
      rating: postType === 'review' ? postRating : null,
      image_url: imageUrl,
      posted_as_type: identity ? identity.type : null,
      posted_as_id: identity ? (identity.type === 'business' ? identity.id : identity.staffId) : null,
      posted_as_name: identity ? (identity.type === 'business' ? identity.name : identity.businessName) : null,
      posted_as_title: identity && identity.type === 'staff' ? identity.publicTitle : null,
    })

    // If it's a review and a target is tagged, also write to the intelligence layer
    if (!error && postType === 'review' && reviewTarget) {
      if (reviewTarget.type === 'business') {
        const { error: reviewError } = await supabase.from('reviews').insert({
          business_id: reviewTarget.id,
          user_id: user.id,
          rating: postRating,
          comment: postContent,
        })
        // Issue #7: a review posted through the feed composer notified nobody
        // either — same gap as the business/product/profile review forms.
        if (!reviewError) {
          const sent = await notifyReview(supabase, {
            kind: 'business', actorId: user.id, businessId: reviewTarget.id, rating: postRating,
            link: `/business/${reviewTarget.id}`,
          })
          if (!sent.sent) console.warn('[review] no notification sent', sent.reason)
        }
      } else if (reviewTarget.type === 'product') {
        const { error: reviewError } = await supabase.from('product_reviews').insert({
          product_id: reviewTarget.id,
          user_id: user.id,
          rating: postRating,
          comment: postContent,
        })
        if (!reviewError) {
          const sent = await notifyReview(supabase, {
            kind: 'product', actorId: user.id, productId: reviewTarget.id, rating: postRating, link: '/feed',
          })
          if (!sent.sent) console.warn('[review] no notification sent', sent.reason)
        }
      } else if (reviewTarget.type === 'unclaimed') {
        await supabase.from('unclaimed_entities').insert({
          name: reviewTarget.name,
          entity_type: reviewTarget.entityType || 'business',
          submitted_by: user.id,
        })
      }
      setReviewTarget(null)
      setReviewSearch('')
      setReviewSearchResults([])
    }

    if (!error) {
      setContent('')
      setImageFile(null)
      setImagePreview(null)
      setPostRating(5)
      setSubscriberOnly(false)
      setCardAudio(null)
      setCardVideo(null)
      setCardVideoPreview(null)
      loadFeed()
    } else {
      console.error('Post error:', error)
      // Surface it: a silent failure just looks like a broken button on a phone.
      toast.show('Could not post: ' + (error.message || 'unknown error'))
    }
    setPosting(false)
  }

  function startPost(type) {
    setPostType(type)
    const el = document.getElementById('post-composer')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTimeout(() => el.querySelector('textarea')?.focus(), 400)
    }
  }

  const CREATE_OPTIONS = [
    { key: 'text',     Icon: MessageSquare, label: 'Post',          run: () => startPost('text') },
    { key: 'question', Icon: HelpCircle,    label: 'Question',      run: () => startPost('question') },
    { key: 'review',   Icon: Star,          label: 'Review',        run: () => startPost('review') },
    { key: 'video',    Icon: Clapperboard,  label: 'Video',         run: () => startPost('video') },
    { key: 'visual',   Icon: Mic,           label: 'Voice card',    run: () => startPost('visual') },
    { key: 'article',  Icon: FileText,      label: 'Article',       run: () => startPost('article') },
    { key: 'story',    Icon: BookOpen,      label: 'Story',         run: () => navigate('/profile') },
    { key: 'series',   Icon: Film,          label: 'Series',        run: () => navigate('/playlist/create'), pro: true },
    { key: 'product',  Icon: ShoppingCart,  label: 'Sell a product', run: () => navigate('/profile'), pro: true },
    { key: 'live',     Icon: Radio,         label: 'Go live',       run: () => setShowGoLive(true), pro: true, danger: true },
  ]

  // The tabs answer "what do you want to read?": they slice the same feed.
  const visiblePosts = engagement.state.posts.filter((p) => {
    if (feedTab === 'foryou') return true
    if (feedTab === 'following') {
      if (!user) return false
      return engagement.state.follows.some((f) => f.follower_id === user.id && f.following_id === p.user_id)
    }
    // Nearby and Medical are dedicated loadFeed queries — the posts state is
    // already exactly that tab's set, so nothing further is sliced out here.
    if (feedTab === 'nearby' || feedTab === 'medical') return true
    if (feedTab === 'video') return !!p.video_url
    return p.post_type === feedTab
  })

  // When searching, ignore the tab filter and show the raw search hits.
  const isSearching = feedResults !== null
  const displayPosts = isSearching ? engagement.state.posts : visiblePosts

  async function submitReport(reason) {
    const postId = reportPostId
    if (!user || !postId) return
    setReportingId(postId)

    const { error } = await supabase.from('reports').insert({
      reporter_id: user.id,
      post_id: postId,
      reason,
    })

    setReportingId(null)
    setReportPostId(null)

    if (error) {
      toast.show('Could not send the report: ' + (error.message || 'unknown error'), { type: 'error' })
      return
    }

    engagement.state.setReportedPosts((prev) => [...prev, postId])
    toast.show('Thanks: our team will review this post.', { type: 'success' })

    // Phase 7 spam signal, tagged with the reader's staged-rollout group.
    if (activeExperiment) {
      logExperimentEvent(supabase, {
        experimentKey: activeExperiment.key,
        variant: activeExperiment.variant,
        eventType: 'report',
        postId,
      }).catch(() => {})
    }
  }

  const { isMobile } = useBreakpoint()

  // #10a Pull-to-refresh. Only engages when the feed is scrolled to the very
  // top, so it never fights normal scrolling. Distance is damped (x0.5) and
  // capped so a long swipe can't yank the page.
  function pullStart(e) {
    if (pullRefreshing) return
    pullStartY.current = (window.scrollY || document.documentElement.scrollTop || 0) <= 0
      ? e.touches[0].clientY
      : 0
  }
  function pullMove(e) {
    if (pullRefreshing || !pullStartY.current) return
    const delta = e.touches[0].clientY - pullStartY.current
    if (delta > 0 && (window.scrollY || document.documentElement.scrollTop || 0) <= 0) {
      setPullDistance(Math.min(delta * 0.5, 90))
    }
  }
  function pullEnd() {
    if (pullRefreshing) return
    if (pullDistance > PULL_THRESHOLD) {
      setPullRefreshing(true)
      setPullDistance(0)
      loadFeed().finally(() => setPullRefreshing(false))
    } else {
      setPullDistance(0)
    }
    pullStartY.current = 0
  }

  // Desktop right sidebar's "Trending": derived from posts already loaded
  // by loadFeed() above, not a new query. No engagement data yet (e.g. right
  // after loadFeed's initial fetch, before reactions/commentCounts settle)
  // just means an empty/neutral sort, which is fine.
  const { likeCount } = engagement.engagementProps
  const trendingPosts = [...engagement.state.posts]
    .sort((a, b) => (likeCount(b.id) + (engagement.state.commentCounts[b.id] || 0)) - (likeCount(a.id) + (engagement.state.commentCounts[a.id] || 0)))
    .slice(0, 4)

  // Every prop PostCard needs besides `post`/`preview`. Shared verbatim by the
  // feed list and the detail modal so both surfaces render byte-identically
  // (same counts, same handlers, same comment thread state).
  //
  // The hook is spread FIRST and its members are never re-listed: every
  // selector, plus shareCard, handleEditPost and the other handlers, arrive in
  // engagementProps. A re-listed copy here would shadow the hook and go stale
  // the next time the hook changes. What follows the spread is Feed's own
  // chrome only — including `sharingId` and `editingPost`, which the hook
  // writes through its callbacks but Feed owns and renders.
  const cardProps = {
    ...engagement.engagementProps,
    user,
    navigate,
    authorName,
    onGift: (p) => setGiftingPost({ postId: p.id, authorId: p.user_id }),
    myUsername,
    myAvatar,
    sharingId,
    editingPost,
    setEditingPost,
    setConfirmDeleteId,
    onOpenDetail: openPostDetail,
  }

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', padding: 20, paddingBottom: 'calc(100px + env(safe-area-inset-bottom))' }
      : { fontFamily: theme.fontFamily }}>
      <style>{`
        .article-body p { margin: 0 0 14px 0; }
        .article-body p:last-child { margin-bottom: 0; }
        .article-body p:first-of-type::first-letter {
          font-size: 2.6em; font-weight: 800; float: left; line-height: 0.85;
          padding-right: 6px; padding-top: 4px; color: ${theme.tealDeep};
        }
        .article-body mark {
          background: ${theme.amberSoft}; color: ${theme.amberText}; padding: 1px 4px; border-radius: 4px;
        }
        .article-body strong { font-weight: 800; color: ${theme.navy}; }
      `}</style>
      {isMobile && (
        <div style={{
          background: theme.heroGradient, margin: '-20px -20px 0 -20px', padding: '14px 16px 2px',
          borderRadius: '0 0 24px 24px', color: '#fff',
        }}>
          {/* App bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <Logo size={30} />
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <div style={{ position: 'relative', width: '100%', maxWidth: 280 }}>
                <SearchIcon size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.45)', pointerEvents: 'none' }} />
                <input
                  placeholder="Search providers, pharmacies…"
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) { navigate(`/search?q=${encodeURIComponent(e.target.value.trim())}`) } }}
                  style={{
                    width: '100%', padding: '9px 12px 9px 34px', borderRadius: theme.radius.full, border: 'none',
                    background: 'rgba(255,255,255,0.14)', color: '#fff', fontSize: 13, outline: 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }} />
              </div>
            </div>

            <Link to="/notifications" style={{
              width: 34, height: 34, borderRadius: theme.radius.md, display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: 'rgba(255,255,255,0.1)', fontSize: 15,
              textDecoration: 'none', color: '#fff', position: 'relative',
            }}>
              <Bell size={18} aria-hidden="true" />
              {unreadNotifs > 0 && (
                <span style={{
                  position: 'absolute', top: 3, right: 3, minWidth: 15, height: 15, padding: '0 3px',
                  borderRadius: theme.radius.sm, background: theme.danger, color: '#fff', fontSize: 9, fontWeight: 900,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                  border: `1.5px solid ${theme.navy}`,
                }}>{unreadNotifs > 99 ? '99+' : unreadNotifs}</span>
              )}
            </Link>

            <Link to={user ? '/profile' : '/login'} style={{ textDecoration: 'none' }}>
              <Avatar name={myUsername} src={myAvatar} size={34} style={{ border: '2px solid rgba(255,255,255,0.28)' }} />
            </Link>
          </div>

          {/* What do you want to read? — pill tabs, like the feed headers in
              modern social apps: active tab lifts onto a white capsule. */}
          <div role="group" aria-label="Filter the feed" className="cf-hscroll" style={{ display: 'flex', gap: 6, padding: '2px 2px 12px', WebkitOverflowScrolling: 'touch' }}>
            {FEED_TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFeedTab(key)}
                style={{
                  flexShrink: 0, padding: '8px 14px', background: feedTab === key ? '#fff' : 'transparent',
                  border: 'none', borderRadius: theme.radius.full,
                  fontSize: 12.5, fontWeight: feedTab === key ? 800 : 700,
                  color: feedTab === key ? theme.navy : 'rgba(255,255,255,0.6)',
                  boxShadow: feedTab === key ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
                  whiteSpace: 'nowrap', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                  transition: `background ${theme.motion.fast} ${theme.motion.easeOut}, color ${theme.motion.fast} ${theme.motion.easeOut}`,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Desktop/tablet: same tabs, plain top-of-content bar instead of the
          mobile gradient hero (which is replaced by DesktopHeader/AppShell). */}
      {!isMobile && (
        <div role="group" aria-label="Filter the feed" className="cf-hscroll" style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${theme.gray200}`, marginBottom: 20 }}>
          {FEED_TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFeedTab(key)}
              style={{
                flexShrink: 0, padding: '0 0 13px', background: 'none', border: 'none',
                fontSize: 14, fontWeight: feedTab === key ? 800 : 600,
                color: feedTab === key ? theme.tealDeep : theme.textLight,
                borderBottom: feedTab === key ? `2.5px solid ${theme.tealDeep}` : '2.5px solid transparent',
                whiteSpace: 'nowrap', cursor: 'pointer', minHeight: 44,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Only when CareFind itself is on air */}
      {platformLive && (
        <Link to={`/live-show/${platformLive.id}`} style={{
          display: 'flex', alignItems: 'center', gap: 11, margin: '12px 0 0',
          padding: '12px 13px', borderRadius: 14, textDecoration: 'none',
          background: theme.dangerGradient,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: theme.radius.md, flexShrink: 0, fontSize: 17,
            background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Radio size={20} aria-hidden="true" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: '0 0 1px', fontSize: 12.5, fontWeight: 900, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 3px rgba(255,255,255,0.3)' }} />
              CareFind is live
            </p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {platformLive.title}
            </p>
          </div>
          <span style={{
            background: '#fff', color: theme.danger, fontSize: 11, fontWeight: 900,
            padding: '7px 13px', borderRadius: theme.radius.md, flexShrink: 0,
          }}>Watch</span>
        </Link>
      )}

      {/* #7 In-feed post search. Distinct from the provider/business search
          in the app bar: this filters the posts themselves. */}
      <div style={{ marginTop: 14, marginBottom: 2 }}>
        <div style={{ position: 'relative' }}>
          <SearchIcon size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: theme.gray400, pointerEvents: 'none' }} aria-hidden="true" />
          <input
            type="search"
            value={feedQuery}
            onChange={(e) => setFeedQuery(e.target.value)}
            placeholder="Search posts…"
            aria-label="Search posts"
            style={{ width: '100%', padding: '10px 36px 10px 36px', borderRadius: theme.radius.full, border: `1px solid ${theme.border}`, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', WebkitTapHighlightColor: 'transparent', transition: `border-color ${theme.motion.fast} ${theme.motion.easeOut}, box-shadow ${theme.motion.fast} ${theme.motion.easeOut}` }}
          />
          {feedQuery && (
            <button
              type="button"
              onClick={() => { setFeedQuery(''); setFeedResults(null); loadFeed() }}
              aria-label="Clear search"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: theme.gray400, cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        {isSearching && (
          <p style={{ margin: '8px 2px 0', fontSize: 11.5, color: theme.textLight }}>
            {feedSearching ? 'Searching…' : `${displayPosts.length} result${displayPosts.length === 1 ? '' : 's'} for “${feedQuery.trim()}”`}
          </p>
        )}
      </div>

      {/* Stories row */}
      <Stories />

      {/* News highlight strip: mobile only; on desktop this same latestNews
          data feeds RightSidebar's "Suggested articles" section instead. */}
      {isMobile && latestNews.length > 0 && (
        <div style={{ marginTop: 14, marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 900, color: theme.navy, letterSpacing: '0.02em' }}><Newspaper size={14} aria-hidden="true" /> Latest news</span>
            <Link to="/news" style={{ fontSize: 11.5, fontWeight: 700, color: theme.tealDeep, textDecoration: 'none' }}>See all →</Link>
          </div>
          <div className="cf-hscroll" style={{ display: 'flex', gap: 10, paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
            {latestNews.map((n) => (
              <Link key={n.id} to={`/news/${n.id}`} style={{ flexShrink: 0, width: 190, textDecoration: 'none', color: 'inherit' }}>
                <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden', background: theme.cardBg }}>
                  <div style={{
                    height: 100, background: n.hero_image_url ? `url(${n.hero_image_url})` : theme.navy,
                    backgroundSize: 'cover', backgroundPosition: 'center',
                    display: 'flex', alignItems: 'flex-start', padding: 8,
                  }}>
                    <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: '0.08em', color: '#fff', background: theme.tealDeep, padding: '2px 7px', borderRadius: 20, textTransform: 'uppercase' }}>News</span>
                  </div>
                  <div style={{ padding: '9px 10px 11px' }}>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: theme.navy, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {n.headline}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Complete-your-profile banner */}
      {user && !profileComplete && !bannerDismissed && (
        <Link to="/onboarding" style={{ textDecoration: 'none' }}>
          <div style={{
            marginTop: 16, background: theme.tealMist, border: `1px solid ${theme.tealDeep}`, borderRadius: 14,
            padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Hand size={20} color={theme.tealDeep} aria-hidden="true" />
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 1px 0', fontSize: 13, fontWeight: 800, color: theme.tealDeep }}>Complete your profile</p>
              <p style={{ margin: 0, fontSize: 11.5, color: theme.textMid }}>Add your name, username and phone to get the most out of CareFind</p>
            </div>
            <span style={{ color: theme.tealDeep, fontSize: 18, fontWeight: 800 }}>›</span>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBannerDismissed(true) }}
              aria-label="Dismiss"
              style={{ background: 'none', border: 'none', color: theme.gray400, padding: '0 2px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </Link>
      )}

      {/* Live-now strip: mobile only; RightSidebar covers this on desktop. */}
      {isMobile && liveSessions.length > 0 && (
        <div style={{ padding: '10px 16px 0' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: theme.danger, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px 0' }}><Radio size={12} aria-hidden="true" /> Live now</p>
          <div className="cf-hscroll" style={{ display: 'flex', gap: 10, paddingBottom: 4 }}>
            {liveSessions.map(s => (
              <a key={s.id} href={`/live/${s.id}`} style={{ textDecoration: 'none', flexShrink: 0, width: 140 }}>
                <div style={{ border: `2px solid ${theme.danger}`, borderRadius: 14, padding: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: theme.danger }} />
                    <span style={{ fontSize: 9, fontWeight: 800, color: theme.danger }}>LIVE</span>
                  </div>
                  <p style={{ margin: '0 0 3px', fontSize: 12, fontWeight: 700, color: theme.slate, lineHeight: 1.3 }}>{s.topic?.slice(0, 40)}</p>
                  <p style={{ margin: 0, fontSize: 10, color: theme.slateMuted }}>{s.profiles?.full_name || s.profiles?.display_name}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {user ? (
        <form ref={composerRef} id="post-composer" onSubmit={handlePost} style={{
          marginTop: 18, marginBottom: 16, background: theme.cardBg, border: `1px solid ${theme.border}`,
          borderRadius: theme.radius.lg, padding: theme.space[8], boxShadow: theme.elevation[1],
        }}>
          {(() => {
            const idn = getActiveIdentity()
            if (!idn) return null
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: theme.radius.md, background: theme.navy, marginBottom: 12 }}>
                {idn.type === 'staff' ? <Award size={16} aria-hidden="true" /> : <Building2 size={16} aria-hidden="true" />}
                <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#fff' }}>
                  Posting as {idn.type === 'staff' ? (idn.publicTitle || 'Rep') + ' · ' + idn.businessName : idn.name}
                </p>
              </div>
            )
          })()}

          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {Object.keys(postTypeLabels).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setPostType(t)}
                style={{
                  padding: '7px 13px', borderRadius: 14, border: postType === t ? 'none' : `1px solid ${theme.border}`,
                  fontSize: 11.5, fontWeight: 700,
                  background: postType === t ? theme.tealDeep : theme.bg,
                  color: postType === t ? '#fff' : theme.textMid,
                }}
              >
                {postTypeLabels[t]}
              </button>
            ))}
          </div>

          {/* Video post: the clip is the post. A fresh upload, or the current
              pick, is required before Post becomes available. */}
          {postType === 'video' && (
            <div style={{ marginBottom: 10 }}>
              {cardVideoPreview ? (
                <div>
                  <video src={cardVideoPreview} controls style={{ width: '100%', borderRadius: theme.radius.md, maxHeight: 320, background: '#000', display: 'block' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <label style={{ flex: 1, textAlign: 'center', padding: '9px 10px', borderRadius: 10, border: `1px solid ${theme.border}`, background: '#fff', fontSize: 12, fontWeight: 800, color: theme.navy, cursor: 'pointer' }}>
                      {uploadingVideo ? '…' : 'Change video'}
                      <input type="file" accept="video/*" onChange={handleCardVideo} style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }} />
                    </label>
                    <button
                      type="button"
                      onClick={() => { setCardVideo(null); setCardVideoPreview(null) }}
                      style={{ flex: 1, padding: '9px 10px', borderRadius: 10, border: `1px solid ${theme.alert}`, background: theme.dangerBg, color: theme.alert, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <label
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    padding: '20px 12px', border: `1.5px dashed ${theme.border}`, borderRadius: theme.radius.md,
                    cursor: 'pointer', background: theme.bg,
                  }}
                >
                  <Clapperboard size={26} color={theme.tealDeep} aria-hidden="true" />
                  <span style={{ fontSize: 13, fontWeight: 800, color: theme.navy }}>
                    {uploadingVideo ? 'Uploading…' : 'Choose a video'}
                  </span>
                  <span style={{ fontSize: 11, color: theme.textLight }}>Up to 12MB (about 15 seconds)</span>
                  <input type="file" accept="video/*" onChange={handleCardVideo} style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }} />
                </label>
              )}
            </div>
          )}

          {canGoLive && (
            <button
              type="button"
              onClick={() => setSubscriberOnly((v) => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 13px', borderRadius: theme.radius.md, marginBottom: 12, cursor: 'pointer',
                border: subscriberOnly ? 'none' : `1px solid ${theme.border}`,
                background: subscriberOnly ? theme.navy : theme.bg,
                color: subscriberOnly ? '#fff' : theme.textMid,
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {subscriberOnly ? <><Lock size={13} aria-hidden="true" /> Subscribers only</> : <><Unlock size={13} aria-hidden="true" /> Free for everyone</>}
                </span>
              </span>
              <span style={{
                fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 10,
                background: subscriberOnly ? 'rgba(255,255,255,0.18)' : '#fff',
                color: subscriberOnly ? '#fff' : theme.textLight,
                border: subscriberOnly ? 'none' : `1px solid ${theme.border}`,
              }}>
                {subscriberOnly ? 'LOCKED' : 'TAP TO LOCK'}
              </span>
            </button>
          )}

          {canGoLive && (
            <Link to="/playlist/create" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 13px', borderRadius: theme.radius.md, background: theme.navy, color: '#fff', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', marginBottom: 12 }}>
              <Film size={15} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 7 }} />Create a playlist (series)
            </Link>
          )}

          {postType === 'visual' && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {themeKeys.map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setVisualTheme(t)}
                  style={{
                    padding: '5px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                    border: visualTheme === t ? `2px solid ${theme.tealDeep}` : `1px solid ${theme.border}`,
                    background: visualTheme === t ? theme.tealDeep : theme.bg,
                    color: visualTheme === t ? '#fff' : theme.textMid, cursor: 'pointer',
                  }}
                >
                  {themeLabels[t]}
                </button>
              ))}
            </div>
          )}

          {/* Voice Card: background: photo or drawing */}
          {postType === 'visual' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <label
                style={{
                  flex: 1, textAlign: 'center', padding: '9px 10px', borderRadius: 10,
                  border: `1px solid ${theme.border}`, background: imagePreview ? theme.bg : '#fff',
                  fontSize: 12, fontWeight: 800, color: theme.navy, cursor: 'pointer',
                }}
              >
                <ImageIcon size={15} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{imagePreview ? 'Change photo' : 'Add photo'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files[0]
                    if (!f) return
                    setImageFile(f)
                    setImagePreview(URL.createObjectURL(f))
                  }}
                  style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}
                />
              </label>

              <button
                type="button"
                onClick={() => setShowDraw(true)}
                style={{
                  flex: 1, padding: '9px 10px', borderRadius: 10,
                  border: `1px solid ${theme.border}`, background: '#fff',
                  fontSize: 12, fontWeight: 800, color: theme.navy, cursor: 'pointer',
                }}
              >
                <Pen size={15} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Draw
              </button>

              <label
                style={{
                  flex: 1, textAlign: 'center', padding: '9px 10px', borderRadius: 10,
                  border: `1px solid ${theme.border}`, background: cardVideoPreview ? theme.bg : '#fff',
                  fontSize: 12, fontWeight: 800, color: theme.navy, cursor: 'pointer',
                }}
              >
                {uploadingVideo
                  ? '…'
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Film size={15} aria-hidden="true" /> {cardVideoPreview ? 'Change clip' : 'Clip'}</span>}
                <input type="file" accept="video/*" onChange={handleCardVideo} style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }} />
              </label>

              {(imagePreview || cardVideoPreview) && (
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null); setImagePreview(null)
                    setCardVideo(null); setCardVideoPreview(null)
                  }}
                  style={{
                    padding: '9px 12px', borderRadius: 10, border: `1px solid ${theme.alert}`,
                    background: theme.dangerBg, color: theme.alert, fontSize: 12, fontWeight: 800,
                    display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                  }}
                  aria-label="Remove clip"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {/* Voice Card: attach a recorded voice */}
          {postType === 'visual' && (
            <div style={{ border: `1px dashed ${theme.border}`, borderRadius: theme.radius.md, padding: 12, marginBottom: 10 }}>
              {cardAudio ? (
                <div>
                  <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: theme.tealDeep }}>
                    <Mic size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Voice attached
                  </p>
                  <audio src={cardAudio} controls style={{ width: '100%', height: 36 }} />
                  <button
                    type="button"
                    onClick={() => setCardAudio(null)}
                    style={{ marginTop: 8, background: 'none', border: 'none', color: theme.alert, fontSize: 12, fontWeight: 700 }}
                  >
                    Remove voice
                  </button>
                </div>
              ) : (
                <>
                  <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: theme.navy }}>
                    <Mic size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Add your voice <span style={{ fontWeight: 600, color: theme.textLight }}>(optional)</span>
                  </p>
                  <p style={{ margin: '0 0 10px 0', fontSize: 10.5, color: theme.textLight }}>
                    People can download this card with your voice and share it to WhatsApp Status: with your CareFind logo on it.
                  </p>
                  <VoiceRecorder hq showId={`card-${user?.id || 'anon'}`} onRecorded={(url) => setCardAudio(url)} />
                </>
              )}
            </div>
          )}

          {postType === 'review' && (
            <div style={{ marginBottom: 10 }}>
              {reviewTarget ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: reviewTarget.type === 'unclaimed' ? theme.warningBg : theme.tealMist, borderRadius: theme.radius.md, padding: '8px 12px' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: reviewTarget.type === 'unclaimed' ? theme.amberText : theme.tealDeep, flex: 1 }}>
                    {(reviewTarget.type === 'business' || reviewTarget.entityType === 'business')
                      ? <Building2 size={15} style={{ flexShrink: 0 }} aria-hidden="true" />
                      : <PillIcon size={15} style={{ flexShrink: 0 }} aria-hidden="true" />}
                    {reviewTarget.name}
                    {reviewTarget.type === 'unclaimed' && <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 4 }}>(unlisted)</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setReviewTarget(null); setReviewSearch(''); setReviewSearchResults([]) }}
                    aria-label="Clear tag"
                    style={{ background: 'none', border: 'none', color: theme.gray400, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={reviewSearch}
                      onChange={(e) => { setReviewSearch(e.target.value) }}
                      placeholder="Tag a business or medication..."
                      style={{ flex: 1, padding: 9, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10 }}
                    />
                    <button
                      type="button"
                      onClick={() => searchReviewTargets(reviewSearch)}
                      style={{ padding: '8px 12px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700 }}
                    >
                      {reviewSearching ? '...' : 'Find'}
                    </button>
                  </div>
                  {reviewSearchResults.length > 0 && (
                    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 10, marginTop: 4, overflow: 'hidden' }}>
                    {reviewSearchResults.map((r) => (
                        r.type === 'unclaimed' ? (
                          <div key="unclaimed" style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.border}`, background: theme.amberSoft }}>
                            <p style={{ margin: '0 0 6px 0', fontSize: 12.5, color: theme.amberText, fontWeight: 700 }}>
                              "{r.name}" not found on CareFind: review anyway?
                            </p>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => { setReviewTarget({ ...r, entityType: 'business' }); setReviewSearchResults([]) }}
                                style={{ flex: 1, padding: '6px 10px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: theme.radius.sm, fontSize: 12, fontWeight: 700 }}
                              >
                                <Building2 size={14} aria-hidden="true" /> It's a business
                              </button>
                              <button
                                type="button"
                                onClick={() => { setReviewTarget({ ...r, entityType: 'product' }); setReviewSearchResults([]) }}
                                style={{ flex: 1, padding: '6px 10px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: theme.radius.sm, fontSize: 12, fontWeight: 700 }}
                              >
                                <PillIcon size={14} aria-hidden="true" /> It's a medication
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            key={r.id}
                            onClick={() => { setReviewTarget(r); setReviewSearchResults([]) }}
                            style={{ width: '100%', padding: '9px 12px', background: '#fff', border: 'none', borderBottom: `1px solid ${theme.border}`, textAlign: 'left', fontSize: 13 }}
                          >
                            <span style={{ fontWeight: 700, color: theme.navy }}>{r.name}</span>
                            <span style={{ color: theme.textLight, fontSize: 11, marginLeft: 6 }}>{r.sub}</span>
                          </button>
                        )
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {postType === 'review' && (
            <div style={{ marginBottom: 10 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setPostRating(n)}
                  style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: n <= postRating ? theme.starAmber : theme.gray300 }}
                >
                  <Star size={24} color={n <= postRating ? theme.starAmber : theme.gray300} fill={n <= postRating ? theme.starAmber : 'none'} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          {postType === 'visual' ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden' }}>
                <VisualCard templateKey={visualTheme} content={content} preview={true} hasVoice={!!cardAudio} imageUrl={imagePreview} videoUrl={cardVideoPreview} username={myUsername} />
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Type your message here..."
                  rows={3}
                  style={{
                    position: 'absolute', inset: 0, background: 'transparent', border: 'none',
                    color: 'rgba(255,255,255,0)', caretColor: '#fff', fontSize: 15.5, fontWeight: 800,
                    padding: '14px 16px 50px', resize: 'none', fontFamily: 'inherit', outline: 'none',
                    width: '100%', zIndex: 10, lineHeight: 1.45,
                  }}
                />
              </div>
              <p style={{ fontSize: 11, color: theme.slateMuted, marginTop: 6, textAlign: 'center' }}>
                Tap the card and type: your text appears live on the card
              </p>
            </div>
          ) : (
            <>
              {postType === 'article' ? (
                <ArticleEditor
                  value={content}
                  onChange={(val) => setContent(val)}
                />
              ) : (
                <textarea
                  ref={postType === 'article' ? articleTextareaRef : null}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={
                    postType === 'question' ? 'Ask your question...' :
                    postType === 'review' ? 'Share your experience with this product or service...' :
                    postType === 'video' ? 'Add a caption for your video...' :
                    'Share a health tip, ask a question...'
                  }
                  rows={3}
                  style={{ width: '100%', padding: 10, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, fontFamily: 'inherit' }}
                />
              )}
            </>
          )}

          {postType !== 'visual' && imagePreview && (
            <div style={{ marginTop: 10, position: 'relative', display: 'inline-block' }}>
              <img src={imagePreview} alt="Selected photo preview" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: theme.radius.md, display: 'block' }} />
              <button
                type="button"
                onClick={clearImage}
                aria-label="Remove photo"
                style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(15,23,42,0.75)', color: '#fff', border: 'none', borderRadius: '50%', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Composer footer: the secondary attach action sits left, the one
              primary action sits right: the same "one primary action, fixed
              position" rule the form patterns use (SCREEN_PATTERNS.md 8). */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            marginTop: 14, paddingTop: 12, borderTop: `1px solid ${theme.border}`,
          }}>
            {postType !== 'visual' && !imagePreview ? (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 40, fontSize: 13, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer' }}>
                <Camera size={17} aria-hidden="true" /> Add a photo
                <input type="file" accept="image/*" onChange={handleImageSelect} style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }} />
              </label>
            ) : <span />}

            <TealBtn type="submit" disabled={posting || uploadingImage || (postType === 'video' ? !cardVideo : !content.trim())} style={{ minWidth: 108, flexShrink: 0 }}>
              {posting ? (uploadingImage ? 'Uploading photo…' : 'Posting…') : 'Post'}
            </TealBtn>
          </div>
        </form>
      ) : (
        <p style={{ color: theme.textLight, fontSize: 14, marginBottom: 20 }}>
          <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 600 }}>Log in</Link> to post and join the conversation.
        </p>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}
      {!loading && feedTab !== 'series' && !isSearching && visiblePosts.length === 0 && (
        <Empty
          icon={feedTab === 'video'
            ? <Film size={44} color={theme.gray300} strokeWidth={1.5} />
            : feedTab === 'medical'
              ? <Stethoscope size={44} color={theme.gray300} strokeWidth={1.5} />
              : feedTab === 'nearby'
                ? <MapPin size={44} color={theme.gray300} strokeWidth={1.5} />
                : <Sprout size={44} color={theme.gray300} strokeWidth={1.5} />}
          message={
            <>
              <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>
                {feedTab === 'following' ? 'Nothing from people you follow'
                  : feedTab === 'video' ? 'No videos yet'
                  : feedTab === 'medical' ? 'No medical posts yet'
                  : feedTab === 'nearby' ? 'No posts near you yet'
                  : 'Nothing here yet'}
              </div>
              <div style={{ fontSize: 13, color: theme.textLight }}>
                {feedTab === 'foryou' ? 'Be the first to share something with the community'
                  : feedTab === 'following' ? 'Follow a few people and their posts land here'
                  : feedTab === 'video' ? 'Voice cards with a clip show up here'
                  : feedTab === 'medical' ? 'Posts from verified professionals and approved facilities appear here'
                  : feedTab === 'nearby' ? (myRegion.length ? 'New posts from your area will appear here' : 'Set your location on your profile to see posts near you')
                  : 'Tap + to make the first one'}
              </div>
            </>
          }
        />
      )}

      {!loading && isSearching && displayPosts.length === 0 && (
        <Empty
          icon={<SearchIcon size={44} color={theme.gray300} strokeWidth={1.5} />}
          message={
            <>
              <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>
                No posts match “{feedQuery.trim()}”
              </div>
              <div style={{ fontSize: 13, color: theme.textLight }}>
                Try a different word, or clear the search to see the full feed.
              </div>
            </>
          }
        />
      )}

      {feedTab === 'series' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {seriesList.length === 0 && (
            <p style={{ textAlign: 'center', fontSize: 13, color: theme.textLight, padding: '28px 0' }}>
              No series yet.
            </p>
          )}
          {seriesList.map((pl) => (
            <Link key={pl.id} to={`/playlist/${pl.id}`} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
              border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, background: theme.cardBg,
              textDecoration: 'none',
            }}>
              <div style={{
                width: 46, height: 46, borderRadius: theme.radius.md, flexShrink: 0, fontSize: 21,
                background: theme.navy, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><Film size={22} aria-hidden="true" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.navy }}>{pl.title}</p>
                {pl.description && (
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pl.description}
                  </p>
                )}
              </div>
              <span style={{ color: theme.textLight }}>›</span>
            </Link>
          ))}
        </div>
      )}

      {/* #6 "New posts" pill — sticky, centred above the list. Clicking it
          scrolls to top and refreshes the feed (which clears the counter). */}
      {newPostsCount > 0 && !loading && (
        <div style={{ display: 'flex', justifyContent: 'center', position: 'sticky', top: 8, zIndex: 5, marginBottom: -4 }}>
          <button
            onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); loadFeed() }}
            style={{
              background: theme.tealDeep, color: '#fff', border: 'none', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 800, padding: '9px 16px', borderRadius: theme.radius.full,
              boxShadow: theme.elevation[2], display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <ChevronRight size={15} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true" />
            {newPostsCount} new {newPostsCount === 1 ? 'post' : 'posts'}
          </button>
        </div>
      )}

      {/* #10a Pull-to-refresh affordance: a small tag that follows the pull
          distance, then a spinner state while refreshing. */}
      <div style={{ position: 'sticky', top: 0, height: 0, zIndex: 4, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
        {pullRefreshing ? (
          <span style={{ transform: 'translateY(6px)', background: theme.navy, color: '#fff', fontSize: 11, fontWeight: 800, padding: '6px 12px', borderRadius: theme.radius.full, boxShadow: theme.elevation[2] }}>Refreshing…</span>
        ) : pullDistance > 4 ? (
          <span style={{ transform: `translateY(${pullDistance - 34}px)`, background: theme.navy, color: '#fff', fontSize: 11, fontWeight: 800, padding: '6px 12px', borderRadius: theme.radius.full, opacity: pullDistance / 90, whiteSpace: 'nowrap' }}>
            {pullDistance > PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        ) : null}
      </div>

      <div
style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        onTouchStart={pullStart}
        onTouchMove={pullMove}
        onTouchEnd={pullEnd}
      >
        {/* AC-14 disambiguation: the Medical tab is professional-only, never a
            mixed slice of general content. The query itself is server-filtered
            (loadFeed .or(user_id in verified, posted_as_id in medical biz)); the
            banner makes the rule explicit to the reader. */}
        {feedTab === 'medical' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: theme.tealMist, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md }}>
            <Stethoscope size={15} color={theme.tealDeep} aria-hidden="true" />
            <span style={{ fontSize: 12, fontWeight: 700, color: theme.navy }}>
              Medical professionals only — posts from verified professionals and approved facilities. General posts are never mixed in here.
            </span>
          </div>
        )}
        {feedTab === 'video' ? (
          <VideoFeed
            posts={displayPosts}
            cardProps={cardProps}
            authorName={(p) => authorName(p)}
            isMobile={isMobile}
          />
        ) : feedTab !== 'series' ? (
          displayPosts.map((post) => (
            <PostCard key={post.id} {...cardProps} post={post} />
          ))
        ) : null}
      </div>
      <Modal show={createOpen} onClose={() => setCreateOpen(false)} title="Create" sheet>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }}>
          {CREATE_OPTIONS.map((opt) => {
            const locked = opt.pro && !canGoLive
            const OptIcon = opt.Icon
            return (
              <button
                key={opt.key}
                type="button"
                aria-label={locked ? `${opt.label} — verified accounts only` : opt.label}
                onClick={() => {
                  setCreateOpen(false)
                  if (locked) { navigate('/verify'); return }
                  opt.run()
                }}
                style={{
                  position: 'relative', border: `1px solid ${opt.danger ? theme.alertLight : theme.border}`,
                  borderRadius: 14, padding: '13px 6px 10px', textAlign: 'center',
                  background: opt.danger ? theme.dangerBg : '#fff',
                  opacity: locked ? 0.55 : 1, cursor: 'pointer',
                }}
              >
                <span style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 6, color: opt.danger ? theme.alert : theme.tealDeep,
                }}>
                  <OptIcon size={21} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span style={{
                  fontSize: 10.5, fontWeight: opt.danger ? 900 : 700,
                  color: opt.danger ? theme.alert : theme.textMid,
                }}>{opt.label}</span>
                {opt.pro && (
                  <span style={{
                    position: 'absolute', top: 7, right: 8, fontSize: 9,
                    fontWeight: 900, color: theme.tealDeep,
                  }}><BadgeCheck size={12} aria-hidden="true" /></span>
                )}
              </button>
            )
          })}
        </div>

        {!canGoLive && (
          <p style={{ margin: '12px 2px 0', fontSize: 10.5, color: theme.textLight, textAlign: 'center' }}>
            <BadgeCheck size={12} aria-hidden="true" /> Verified only ·{' '}
            <Link to="/verify" style={{ color: theme.tealDeep, fontWeight: 800, textDecoration: 'none' }}>
              Get verified
            </Link>
          </p>
        )}
      </Modal>

      {showDraw && (
        <DrawingBoard
          onCancel={() => setShowDraw(false)}
          onSave={(blob) => {
            if (blob) {
              // A drawing is just an image: same pipeline as a photo
              const file = new File([blob], `drawing-${Date.now()}.png`, { type: 'image/png' })
              setImageFile(file)
              setImagePreview(URL.createObjectURL(blob))
            }
            setShowDraw(false)
          }}
        />
      )}

      {showGoLive && <UserGoLive onClose={() => setShowGoLive(false)} />}
      <SupportPrompt creatorName="CareFind creators" />
      {isMobile && <BottomNav onCompose={() => setCreateOpen(true)} />}
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

      {/* Report reasons: a closed set, one tap each. */}
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

      {/* Item 12 detail modal: full content for one post. Opened by "See
          more" on a clamped card or by a ?post=<id> deep link; the deep-link
          post loads async (loading/error states handled inside the modal). */}
      <PostDetailModal
        show={!!detailPost || detailLoading}
        post={detailPost}
        loading={detailLoading}
        error={detailError}
        onClose={closePostDetail}
        cardProps={cardProps}
      />

      <Toast msg={toast.msg} type={toast.type} />
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell
      user={user}
      myUsername={myUsername}
      myAvatar={myAvatar}
      unreadNotifs={unreadNotifs}
      onCompose={() => setCreateOpen(true)}
      rightSidebar={<RightSidebar trending={trendingPosts} news={latestNews} live={liveSessions} platformLive={platformLive} />}
    >
      {bodyContent}
    </AppShell>
  )
}

export default Feed
