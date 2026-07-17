import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import BottomNav from './BottomNav.jsx'
import { theme } from './lib/theme'
import { wrapBold, wrapItalic, wrapHighlight, renderArticleHtml } from './lib/articleFormat'
import GiftPanel from './GiftPanel.jsx'
import VisualCard from './VisualCard.jsx'
import ArticleEditor from './ArticleEditor.jsx'
import GoLive from './GoLive.jsx'
import UserGoLive from './UserGoLive.jsx'
import { notify } from './notify.js'
import Logo from './Logo.jsx'
import VoiceRecorder from './VoiceRecorder.jsx'
import { exportImage, exportVideo, canExportVideo, shareOrDownload } from './voiceCard.js'
import DrawingBoard from './DrawingBoard.jsx'
import { resizeImage } from './imageResize.js'
import { loadActiveCreatorIds, coinsToNaira } from './subscriptions.js'
import SupportPrompt from './SupportPrompt.jsx'
import Stories from './Stories.jsx'
import { getActiveIdentity } from './lib/activeIdentity'
import { useRef } from 'react'

function Feed() {
  const { user } = useAuth()
  const [posts, setPosts] = useState([])
  const [reactions, setReactions] = useState([])
  const [profiles, setProfiles] = useState({})
  const [follows, setFollows] = useState([])
  const [subscriberOnly, setSubscriberOnly] = useState(false)
  const [cardAudio, setCardAudio] = useState(null)
  const [myUsername, setMyUsername] = useState('')
  const navigate = useNavigate()
  const [showDraw, setShowDraw] = useState(false)
  const [feedTab, setFeedTab] = useState('foryou')
  const [platformLive, setPlatformLive] = useState(null)
  const [myAvatar, setMyAvatar] = useState(null)
  const [seriesList, setSeriesList] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [cardVideo, setCardVideo] = useState(null)        // uploaded URL
  const [cardVideoPreview, setCardVideoPreview] = useState(null)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [sharingId, setSharingId] = useState(null)
  const [unlockedCreators, setUnlockedCreators] = useState([])
  const [savedPosts, setSavedPosts] = useState([])
  const [userSubscriptions, setUserSubscriptions] = useState([])
  const [reportedPosts, setReportedPosts] = useState([])
  const [reportingId, setReportingId] = useState(null)
  const [giftingPost, setGiftingPost] = useState(null)
  const [composerOpen, setComposerOpen] = useState(false) // { postId, authorId }
  const [editingPost, setEditingPost] = useState(null) // { id, content }
  const [editingComment, setEditingComment] = useState(null) // { id, content, post_id }
  const [deletingId, setDeletingId] = useState(null)
  const [comments, setComments] = useState({})
  const [openComments, setOpenComments] = useState({})
  const [commentDrafts, setCommentDrafts] = useState({})
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
  const [commentCounts, setCommentCounts] = useState({})
  const [latestNews, setLatestNews] = useState([])
  const [unreadNotifs, setUnreadNotifs] = useState(0)
  const [showGoLive, setShowGoLive] = useState(false)
  const [liveSessions, setLiveSessions] = useState([])

  const POST_KIND = {
    question: 'Question',
    article: 'Article',
    visual: 'Voice',
    review: 'Review',
  }

  const FEED_TABS = [
    ['foryou', 'For you'],
    ['following', 'Following'],
    ['question', 'Questions'],
    ['article', 'Articles'],
    ['visual', 'Voice'],
    ['review', 'Reviews'],
    ['series', 'Series'],
  ]

  const themeLabels = {
    'teal-depth': '🌊 Ocean',
    'navy-clinical': '✨ Sky',
    'midnight-teal': '🌃 Night',
    'forest-wellness': '🌿 Forest',
    'slate-pulse': '❤️ Pulse',
  }
  const themeKeys = Object.keys(themeLabels)

  const postTypeLabels = {
    text: 'Text Post',
    visual: '🎤 Voice Card',
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
      ...(prodRes.data || []).map((p) => ({ type: 'product', id: p.id, name: `${p.emoji || '💊'} ${p.name}`, sub: 'Medication' })),
    ]
    if (results.length === 0) {
      results.push({ type: 'unclaimed', id: null, name: q.trim(), sub: 'Not yet listed — review anyway' })
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

  async function loadFeed() {
    setLoading(true)
    const { data: postData, error } = await supabase
      .from('posts')
      .select('id, content, created_at, user_id, post_type, theme, image_url, rating, view_count, subscriber_only, audio_url, video_url, posted_as_type, posted_as_id, posted_as_name, posted_as_title')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Feed load error:', error)
      setPosts([])
      setLoading(false)
      return
    }

    const postIds = (postData || []).map((p) => p.id)

    if (postIds.length > 0) {
      const { data: reactionData } = await supabase
        .from('post_reactions')
        .select('id, post_id, user_id')
        .in('post_id', postIds)
      setReactions(reactionData || [])

      const userIds = [...new Set((postData || []).map((p) => p.user_id))]
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, display_name, full_name, is_verified, verification_label, specialty, avatar_url')
        .in('id', userIds)

      const profileMap = {}
      ;(profileData || []).forEach((p) => { profileMap[p.id] = p })
      setProfiles(profileMap)

      // Comment counts for all loaded posts (for ranking)
      const { data: commentRows } = await supabase
        .from('post_comments')
        .select('post_id')
        .in('post_id', postIds)
      const cCounts = {}
      ;(commentRows || []).forEach((row) => { cCounts[row.post_id] = (cCounts[row.post_id] || 0) + 1 })
      setCommentCounts(cCounts)

      // Like counts per post
      const lCounts = {}
      ;(reactionData || []).forEach((r) => { lCounts[r.post_id] = (lCounts[r.post_id] || 0) + 1 })

      // Score & rank: favor popular, strong verified boost, gentle recency
      const scored = (postData || []).map((p) => {
        const likes = lCounts[p.id] || 0
        const comments = cCounts[p.id] || 0
        const verified = profileMap[p.user_id]?.is_verified ? 1 : 0
        const ageHours = (Date.now() - new Date(p.created_at)) / 3600000
        let recency = 0
        if (ageHours < 1) recency = 15
        else if (ageHours < 6) recency = 10
        else if (ageHours < 24) recency = 6
        else if (ageHours < 72) recency = 3
        else if (ageHours < 168) recency = 1
        const score = (likes * 3) + (comments * 5) + (verified * 25) + recency
        return { ...p, _score: score }
      })
      scored.sort((a, b) => b._score - a._score || new Date(b.created_at) - new Date(a.created_at))
      setPosts(scored)

      // Count a view for each post shown (fire and forget)
      scored.forEach((p) => { supabase.rpc('increment_post_view', { post_id: p.id }) })

      const { data: followData } = await supabase
        .from('follows')
        .select('id, follower_id, following_id')
        .in('following_id', userIds)
      setFollows(followData || [])

      if (user) {
        const { data: savedData } = await supabase
          .from('saved_posts')
          .select('id, post_id')
          .eq('user_id', user.id)
          .in('post_id', postIds)
        setSavedPosts(savedData || [])

        const { data: subData } = await supabase
          .from('user_subscriptions')
          .select('professional_id')
          .eq('subscriber_id', user.id)
          .eq('status', 'active')
        setUserSubscriptions((subData || []).map(s => s.professional_id))
      } else {
        setSavedPosts([])
        setUserSubscriptions([])
      }
    } else {
      setPosts([])
      setReactions([])
      setProfiles({})
      setFollows([])
      setSavedPosts([])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadFeed()
    checkProfileComplete()
    loadLatestNews()
    loadUnreadNotifs()
    loadUnlocked()
    loadPlatformLive()
    loadSeries()
    loadLiveSessions()
  }, [user])

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

  // A post is locked if it's subscriber-only, isn't yours, and you haven't subscribed.
  function isLocked(post) {
    // Legacy "premium" posts are treated as subscriber-only too, so nothing is lost.
    const locked = post.subscriber_only || post.post_type === 'premium'
    if (!locked) return false
    if (user && post.user_id === user.id) return false
    return !unlockedCreators.includes(post.user_id)
  }

  // Short clip as the card backdrop. Kept small on purpose — data is expensive.
  async function handleCardVideo(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 12 * 1024 * 1024) {
      alert('That clip is too large. Please choose one under 12MB (about 15 seconds).')
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
      alert('Could not upload the clip: ' + upErr.message)
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

  // Export a Voice Card so it can go out to WhatsApp Status, logo attached.
  // Tries video (card + voice) first; falls back to a PNG if the browser can't.
  async function shareCard(post) {
    setSharingId(post.id)
    const handle = profiles[post.user_id]?.display_name || profiles[post.user_id]?.full_name || ''
    const opts = {
      text: post.content,
      theme: post.theme,
      hasVoice: !!post.audio_url,
      imageUrl: post.image_url,
      videoUrl: post.video_url,
      username: handle,
    }

    try {
      if (post.audio_url && canExportVideo()) {
        try {
          const { blob, ext } = await exportVideo({
            text: post.content,
            theme: post.theme,
            audioUrl: post.audio_url,
            imageUrl: post.image_url,
            videoUrl: post.video_url,
            username: handle,
          })
          const result = await shareOrDownload(blob, `carefind-card.${ext}`)
          setSharingId(null)
          if (result === 'downloaded') alert('Saved with your voice — post it to your WhatsApp Status.')
          return
        } catch (e) {
          // Video failed on this device — fall through to the image so the user still gets something
          console.warn('Video export failed, falling back to image:', e)
        }
      }

      const blob = await exportImage(opts)
      const result = await shareOrDownload(blob, 'carefind-card.png')
      setSharingId(null)
      if (result === 'downloaded') {
        alert(post.audio_url
          ? "Saved as an image. This phone can't build the video — the voice still plays inside CareFind."
          : 'Saved — post it to your WhatsApp Status.')
      }
    } catch (e) {
      setSharingId(null)
      alert('Could not prepare the card: ' + (e.message || 'unknown error'))
    }
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

  async function loadUnlocked() {
    if (!user) { setUnlockedCreators([]); return }
    const ids = await loadActiveCreatorIds(user.id)
    setUnlockedCreators(ids)
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
    if (!content.trim() || !user) return
    setPosting(true)

    let imageUrl = null

    if (imageFile) {
      setUploadingImage(true)

      // Shrink first — a full-size phone photo is often 5-8MB and the upload dies on it.
      const resized = await resizeImage(imageFile, 1400, 0.85)
      const filePath = `${user.id}-${Date.now()}.jpg`

      const { error: uploadError } = await supabase.storage
        .from('post-images')
        .upload(filePath, resized, { contentType: 'image/jpeg' })

      setUploadingImage(false)

      if (uploadError) {
        // Never post silently without the photo the user chose.
        setPosting(false)
        alert('Could not upload the photo: ' + uploadError.message)
        return
      }

      const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(filePath)
      imageUrl = urlData.publicUrl
    }

    if (screenContent(content.trim())) {
      alert('Your post was flagged for review. Please remove any spam-like content and try again.')
      setPosting(false)
      return
    }

    const identity = getActiveIdentity()

    const { error } = await supabase.from('posts').insert({
      user_id: user.id,
      content: content.trim(),
      post_type: postType,
      subscriber_only: subscriberOnly,
      audio_url: postType === 'visual' ? cardAudio : null,
      video_url: postType === 'visual' ? cardVideo : null,
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
        await supabase.from('reviews').insert({
          business_id: reviewTarget.id,
          user_id: user.id,
          rating: postRating,
          comment: content.trim(),
        })
      } else if (reviewTarget.type === 'product') {
        await supabase.from('product_reviews').insert({
          product_id: reviewTarget.id,
          user_id: user.id,
          rating: postRating,
          comment: content.trim(),
        })
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
      // Surface it — a silent failure just looks like a broken button on a phone.
      alert('Could not post: ' + (error.message || 'unknown error'))
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
    { key: 'text',     icon: '💬', label: 'Post',          run: () => startPost('text') },
    { key: 'question', icon: '❓', label: 'Question',      run: () => startPost('question') },
    { key: 'review',   icon: '⭐', label: 'Review',        run: () => startPost('review') },
    { key: 'visual',   icon: '🎤', label: 'Voice card',    run: () => startPost('visual') },
    { key: 'article',  icon: '📄', label: 'Article',       run: () => startPost('article') },
    { key: 'story',    icon: '📖', label: 'Story',         run: () => navigate('/profile') },
    { key: 'series',   icon: '🎬', label: 'Series',        run: () => navigate('/playlist/create'), pro: true },
    { key: 'product',  icon: '🛒', label: 'Sell a product', run: () => navigate('/profile'), pro: true },
    { key: 'live',     icon: '📡', label: 'Go live',       run: () => setShowGoLive(true), pro: true, danger: true },
  ]

  // The tabs answer "what do you want to read?" — they slice the same feed.
  const visiblePosts = posts.filter((p) => {
    if (feedTab === 'foryou') return true
    if (feedTab === 'following') {
      if (!user) return false
      return follows.some((f) => f.follower_id === user.id && f.following_id === p.user_id)
    }
    return p.post_type === feedTab
  })

  function likeCount(postId) {
    return reactions.filter((r) => r.post_id === postId).length
  }

  function userHasLiked(postId) {
    if (!user) return false
    return reactions.some((r) => r.post_id === postId && r.user_id === user.id)
  }

  async function handleEditPost(postId, newContent) {
    if (!newContent.trim()) return
    await supabase.from('posts').update({ content: newContent.trim() }).eq('id', postId).eq('user_id', user.id)
    setEditingPost(null)
    loadFeed()
  }

  async function handleDeletePost(postId) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    setDeletingId(postId)
    await supabase.from('posts').delete().eq('id', postId).eq('user_id', user.id)
    loadFeed()
    setDeletingId(null)
  }

  async function handleEditComment(commentId, postId, newContent) {
    if (!newContent.trim()) return
    await supabase.from('post_comments').update({ content: newContent.trim() }).eq('id', commentId).eq('user_id', user.id)
    setEditingComment(null)
    const { data } = await supabase
      .from('post_comments')
      .select('id, content, created_at, user_id, profiles(id, display_name, full_name, is_verified, specialty)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    setComments((prev) => ({ ...prev, [postId]: data || [] }))
  }

  async function handleDeleteComment(commentId, postId) {
    await supabase.from('post_comments').delete().eq('id', commentId).eq('user_id', user.id)
    setComments((prev) => ({ ...prev, [postId]: (prev[postId] || []).filter((c) => c.id !== commentId) }))
  }

  async function toggleLike(postId) {
    if (!user) return
    const existing = reactions.find((r) => r.post_id === postId && r.user_id === user.id)

    // Optimistic update — instant UI response
    if (existing) {
      setReactions((prev) => prev.filter((r) => r.id !== existing.id))
      supabase.from('post_reactions').delete().eq('id', existing.id)
    } else {
      const tempReaction = { id: `temp_${Date.now()}`, post_id: postId, user_id: user.id, reaction_type: 'like' }
      setReactions((prev) => [...prev, tempReaction])
      supabase.from('post_reactions').insert({ post_id: postId, user_id: user.id, reaction_type: 'like' })
      // Notify the post author
      const post = posts.find((p) => p.id === postId)
      if (post) notify({ recipientId: post.user_id, actorId: user.id, type: 'like', message: 'liked your post', link: '/', postId })
    }
  }

  async function toggleComments(postId) {
    const isOpen = !openComments[postId]
    setOpenComments({ ...openComments, [postId]: isOpen })

    if (isOpen && !comments[postId]) {
      const { data } = await supabase
        .from('post_comments')
        .select('id, content, created_at, user_id')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
      setComments({ ...comments, [postId]: data || [] })
    }
  }

  async function handleAddComment(postId) {
    const text = (commentDrafts[postId] || '').trim()
    if (!text || !user) return

    const { error } = await supabase.from('post_comments').insert({
      post_id: postId,
      user_id: user.id,
      content: text,
    })

    if (!error) {
      setCommentDrafts({ ...commentDrafts, [postId]: '' })
      // Notify the post author
      const post = posts.find((p) => p.id === postId)
      if (post) notify({ recipientId: post.user_id, actorId: user.id, type: 'comment', message: 'commented on your post', link: '/', postId })
      const { data } = await supabase
        .from('post_comments')
        .select('id, content, created_at, user_id')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
      setComments({ ...comments, [postId]: data || [] })
    }
  }

  function isFollowing(authorId) {
    if (!user) return false
    return follows.some((f) => f.follower_id === user.id && f.following_id === authorId)
  }

  async function toggleFollow(authorId) {
    if (!user || authorId === user.id) return
    const existing = follows.find((f) => f.follower_id === user.id && f.following_id === authorId)

    if (existing) {
      // Optimistic: drop it from local state right away
      setFollows((prev) => prev.filter((f) => f.id !== existing.id))
      const { error } = await supabase.from('follows').delete().eq('id', existing.id)
      if (error) setFollows((prev) => [...prev, existing]) // put it back if it failed
    } else {
      // Optimistic: show as followed immediately
      const temp = { id: `temp_${Date.now()}`, follower_id: user.id, following_id: authorId }
      setFollows((prev) => [...prev, temp])
      const { data, error } = await supabase
        .from('follows')
        .insert({ follower_id: user.id, following_id: authorId })
        .select()
        .maybeSingle()
      if (error) {
        setFollows((prev) => prev.filter((f) => f.id !== temp.id)) // roll back
        return
      }
      // Swap the temp row for the real one so a later unfollow has a valid id
      if (data) setFollows((prev) => prev.map((f) => (f.id === temp.id ? data : f)))
      notify({ recipientId: authorId, actorId: user.id, type: 'follow', message: 'started following you', link: `/u/${user.id}` })
    }
  }

  async function handleReport(postId) {
    if (!user) return
    if (reportedPosts.includes(postId)) return
    setReportingId(postId)

    const reason = prompt('Why are you reporting this post?\n\n1. Spam\n2. False medical information\n3. Harassment\n4. Inappropriate content\n\nType the reason:')
    if (!reason) {
      setReportingId(null)
      return
    }

    await supabase.from('reports').insert({
      reporter_id: user.id,
      post_id: postId,
      reason: reason,
    })

    setReportedPosts((prev) => [...prev, postId])
    setReportingId(null)
  }

  function isSaved(postId) {
    return savedPosts.some((s) => s.post_id === postId)
  }

  async function toggleSave(postId) {
    if (!user) return
    const existing = savedPosts.find((s) => s.post_id === postId)

    if (existing) {
      setSavedPosts((prev) => prev.filter((s) => s.post_id !== postId))
      supabase.from('saved_posts').delete().eq('id', existing.id)
    } else {
      const temp = { id: `temp_${Date.now()}`, post_id: postId, user_id: user.id }
      setSavedPosts((prev) => [...prev, temp])
      supabase.from('saved_posts').insert({ user_id: user.id, post_id: postId })
    }
  }

  function formatCount(n) {
    n = n || 0
    if (n < 1000) return `${n}`
    if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`.replace('.0k', 'k')
    return `${(n / 1000000).toFixed(1)}M`.replace('.0M', 'M')
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto', padding: 20, paddingBottom: 90 }}>
      <style>{`
        .article-body p { margin: 0 0 14px 0; }
        .article-body p:last-child { margin-bottom: 0; }
        .article-body p:first-of-type::first-letter {
          font-size: 2.6em; font-weight: 800; float: left; line-height: 0.85;
          padding-right: 6px; padding-top: 4px; color: ${theme.tealDeep};
        }
        .article-body mark {
          background: #fef9c3; color: #713f12; padding: 1px 4px; border-radius: 4px;
        }
        .article-body strong { font-weight: 800; color: ${theme.navy}; }
      `}</style>
      <div style={{
        background: theme.heroGradient, margin: '-20px -20px 0 -20px', padding: '14px 16px 0',
        borderRadius: '0 0 22px 22px', color: '#fff',
      }}>
        {/* App bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
          <div style={{ marginRight: 'auto' }}><Logo size={30} /></div>

          <Link to="/search" style={{
            width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontSize: 15, textDecoration: 'none',
          }}>🔍</Link>

          <Link to="/notifications" style={{
            width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontSize: 15,
            textDecoration: 'none', position: 'relative',
          }}>
            🔔
            {unreadNotifs > 0 && (
              <span style={{
                position: 'absolute', top: 3, right: 3, minWidth: 15, height: 15, padding: '0 3px',
                borderRadius: 8, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                border: `1.5px solid ${theme.navy}`,
              }}>{unreadNotifs > 99 ? '99+' : unreadNotifs}</span>
            )}
          </Link>

          <Link to={user ? '/profile' : '/login'} style={{ textDecoration: 'none' }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: myAvatar ? `url(${myAvatar}) center/cover` : theme.tealGradient,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 800, fontSize: 13, border: '2px solid rgba(255,255,255,0.28)',
            }}>
              {!myAvatar && (myUsername ? myUsername[0].toUpperCase() : '?')}
            </div>
          </Link>
        </div>

        {/* What do you want to read? */}
        <div style={{ display: 'flex', gap: 20, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {FEED_TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFeedTab(key)}
              style={{
                flexShrink: 0, padding: '0 0 11px', background: 'none', border: 'none',
                fontSize: 13.5, fontWeight: feedTab === key ? 800 : 700,
                color: feedTab === key ? '#fff' : 'rgba(255,255,255,0.45)',
                borderBottom: feedTab === key ? `2.5px solid ${theme.tealBright}` : '2.5px solid transparent',
                whiteSpace: 'nowrap', cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Only when CareFind itself is on air */}
      {platformLive && (
        <Link to={`/live-show/${platformLive.id}`} style={{
          display: 'flex', alignItems: 'center', gap: 11, margin: '12px 0 0',
          padding: '12px 13px', borderRadius: 14, textDecoration: 'none',
          background: 'linear-gradient(135deg, #7F1D1D, #B91C1C)',
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11, flexShrink: 0, fontSize: 17,
            background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>📡</div>
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
            background: '#fff', color: '#B91C1C', fontSize: 11, fontWeight: 900,
            padding: '7px 13px', borderRadius: 9, flexShrink: 0,
          }}>Watch</span>
        </Link>
      )}

      {/* Stories row */}
      <Stories />

      {/* News highlight strip */}
      {latestNews.length > 0 && (
        <div style={{ marginTop: 14, marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: theme.navy, letterSpacing: '0.02em' }}>📰 Latest News</span>
            <Link to="/news" style={{ fontSize: 11.5, fontWeight: 700, color: theme.tealDeep, textDecoration: 'none' }}>See all →</Link>
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
            {latestNews.map((n) => (
              <Link key={n.id} to="/news" style={{ flexShrink: 0, width: 190, textDecoration: 'none', color: 'inherit' }}>
                <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden', background: theme.cardBg }}>
                  <div style={{
                    height: 100, background: n.hero_image_url ? `url(${n.hero_image_url})` : theme.heroGradient,
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
            marginTop: 16, background: '#ecfdf5', border: `1px solid ${theme.tealBright}`, borderRadius: 14,
            padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 20 }}>👋</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 1px 0', fontSize: 13, fontWeight: 800, color: theme.tealDeep }}>Complete your profile</p>
              <p style={{ margin: 0, fontSize: 11.5, color: theme.textMid }}>Add your name, username and phone to get the most out of CareFind</p>
            </div>
            <span style={{ color: theme.tealDeep, fontSize: 18, fontWeight: 800 }}>›</span>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBannerDismissed(true) }}
              style={{ background: 'none', border: 'none', color: theme.textLight, fontSize: 16, padding: '0 2px' }}
            >
              ✕
            </button>
          </div>
        </Link>
      )}

      {liveSessions.length > 0 && (
        <div style={{ padding: '10px 16px 0' }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px 0' }}>🔴 Live Now</p>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {liveSessions.map(s => (
              <a key={s.id} href={`/live/${s.id}`} style={{ textDecoration: 'none', flexShrink: 0, width: 140 }}>
                <div style={{ border: '2px solid #dc2626', borderRadius: 14, padding: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626' }} />
                    <span style={{ fontSize: 9, fontWeight: 800, color: '#dc2626' }}>LIVE</span>
                  </div>
                  <p style={{ margin: '0 0 3px', fontSize: 12, fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>{s.topic?.slice(0, 40)}</p>
                  <p style={{ margin: 0, fontSize: 10, color: '#94a3b8' }}>{s.profiles?.full_name || s.profiles?.display_name}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {user ? (
        <form ref={composerRef} id="post-composer" onSubmit={handlePost} style={{
          marginTop: 18, marginBottom: 16, background: theme.cardBg, border: `1px solid ${theme.border}`,
          borderRadius: 18, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}>
          {(() => {
            const idn = getActiveIdentity()
            if (!idn) return null
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, background: theme.navy, marginBottom: 12 }}>
                <span style={{ fontSize: 16 }}>{idn.type === 'staff' ? '🎖️' : '🏢'}</span>
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
                  background: postType === t ? theme.tealGradient : theme.bg,
                  color: postType === t ? '#fff' : theme.textMid,
                }}
              >
                {postTypeLabels[t]}
              </button>
            ))}
          </div>

          {canGoLive && (
            <button
              type="button"
              onClick={() => setSubscriberOnly((v) => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 13px', borderRadius: 12, marginBottom: 12, cursor: 'pointer',
                border: subscriberOnly ? 'none' : `1px solid ${theme.border}`,
                background: subscriberOnly ? theme.navy : theme.bg,
                color: subscriberOnly ? '#fff' : theme.textMid,
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>
                {subscriberOnly ? '🔒 Subscribers only' : '🔓 Free for everyone'}
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
            <Link to="/playlist/create" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 13px', borderRadius: 12, background: theme.navy, color: '#fff', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', marginBottom: 12 }}>
              🎬 Create a Playlist (series)
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

          {/* Voice Card — background: photo or drawing */}
          {postType === 'visual' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <label
                style={{
                  flex: 1, textAlign: 'center', padding: '9px 10px', borderRadius: 10,
                  border: `1px solid ${theme.border}`, background: imagePreview ? theme.bg : '#fff',
                  fontSize: 12, fontWeight: 800, color: theme.navy, cursor: 'pointer',
                }}
              >
                🖼 {imagePreview ? 'Change photo' : 'Add photo'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files[0]
                    if (!f) return
                    setImageFile(f)
                    setImagePreview(URL.createObjectURL(f))
                  }}
                  style={{ display: 'none' }}
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
                ✏️ Draw
              </button>

              <label
                style={{
                  flex: 1, textAlign: 'center', padding: '9px 10px', borderRadius: 10,
                  border: `1px solid ${theme.border}`, background: cardVideoPreview ? theme.bg : '#fff',
                  fontSize: 12, fontWeight: 800, color: theme.navy, cursor: 'pointer',
                }}
              >
                {uploadingVideo ? '⏳ …' : cardVideoPreview ? '🎬 Change clip' : '🎬 Clip'}
                <input type="file" accept="video/*" onChange={handleCardVideo} style={{ display: 'none' }} />
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
                    background: '#fef2f2', color: theme.alert, fontSize: 12, fontWeight: 800,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Voice Card — attach a recorded voice */}
          {postType === 'visual' && (
            <div style={{ border: `1px dashed ${theme.border}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
              {cardAudio ? (
                <div>
                  <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: theme.tealDeep }}>
                    🎤 Voice attached
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
                    🎤 Add your voice <span style={{ fontWeight: 600, color: theme.textLight }}>(optional)</span>
                  </p>
                  <p style={{ margin: '0 0 10px 0', fontSize: 10.5, color: theme.textLight }}>
                    People can download this card with your voice and share it to WhatsApp Status — with your CareFind logo on it.
                  </p>
                  <VoiceRecorder hq showId={`card-${user?.id || 'anon'}`} onRecorded={(url) => setCardAudio(url)} />
                </>
              )}
            </div>
          )}

          {postType === 'review' && (
            <div style={{ marginBottom: 10 }}>
              {reviewTarget ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: reviewTarget.type === 'unclaimed' ? '#fef9c3' : '#ecfdf5', borderRadius: 12, padding: '8px 12px' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: reviewTarget.type === 'unclaimed' ? '#a16207' : theme.tealDeep, flex: 1 }}>
                    {reviewTarget.type === 'business' ? '🏥' : reviewTarget.type === 'product' ? '💊' : reviewTarget.entityType === 'business' ? '🏥' : '💊'} {reviewTarget.name}
                    {reviewTarget.type === 'unclaimed' && <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 4 }}>(unlisted)</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setReviewTarget(null); setReviewSearch(''); setReviewSearchResults([]) }}
                    style={{ background: 'none', border: 'none', color: theme.textLight, fontSize: 16 }}
                  >
                    ✕
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
                          <div key="unclaimed" style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.border}`, background: '#fef9c3' }}>
                            <p style={{ margin: '0 0 6px 0', fontSize: 12.5, color: '#a16207', fontWeight: 700 }}>
                              "{r.name}" not found on CareFind — review anyway?
                            </p>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => { setReviewTarget({ ...r, entityType: 'business' }); setReviewSearchResults([]) }}
                                style={{ flex: 1, padding: '6px 10px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700 }}
                              >
                                🏥 It's a business
                              </button>
                              <button
                                type="button"
                                onClick={() => { setReviewTarget({ ...r, entityType: 'product' }); setReviewSearchResults([]) }}
                                style={{ flex: 1, padding: '6px 10px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700 }}
                              >
                                💊 It's a medication
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
                  style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: n <= postRating ? '#f5b301' : '#ccc' }}
                >
                  ★
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
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, textAlign: 'center' }}>
                Tap the card and type — your text appears live on the card
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
                    'Share a health tip, ask a question...'
                  }
                  rows={3}
                  style={{ width: '100%', padding: 10, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, fontFamily: 'inherit' }}
                />
              )}
            </>
          )}

          {postType !== 'visual' && (
            <div style={{ marginTop: 8 }}>
              {imagePreview ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={imagePreview} alt="preview" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8 }} />
                  <button
                    type="button"
                    onClick={clearImage}
                    style={{ position: 'absolute', top: 4, right: 4, background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: 22, height: 22, fontSize: 12 }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <label style={{ fontSize: 13, color: '#0f766e', fontWeight: 600, cursor: 'pointer' }}>
                  📷 Add a photo
                  <input type="file" accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} />
                </label>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={posting || !content.trim() || uploadingImage}
            style={{
              marginTop: 12, padding: '10px 20px', background: theme.tealGradient, color: '#fff', border: 'none',
              borderRadius: 12, fontWeight: 800, fontSize: 13, boxShadow: '0 3px 8px rgba(15,118,110,0.25)',
            }}
          >
            {posting ? (uploadingImage ? 'Uploading photo...' : 'Posting...') : 'Post'}
          </button>
        </form>
      ) : (
        <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>
          <Link to="/login" style={{ color: '#0f766e', fontWeight: 600 }}>Log in</Link> to post and join the conversation.
        </p>
      )}

      {loading && <p>Loading feed...</p>}
      {!loading && feedTab !== 'series' && visiblePosts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: '#ecfdf5', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 14px auto',
          }}>
            🌱
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>
            {feedTab === 'following' ? 'Nothing from people you follow' : 'Nothing here yet'}
          </h3>
          <p style={{ fontSize: 13, color: theme.textLight, margin: 0 }}>
            {feedTab === 'foryou' ? 'Be the first to share something with the community'
              : feedTab === 'following' ? 'Follow a few people and their posts land here'
              : 'Tap + to make the first one'}
          </p>
        </div>
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
              border: `1px solid ${theme.border}`, borderRadius: 16, background: theme.cardBg,
              textDecoration: 'none',
            }}>
              <div style={{
                width: 46, height: 46, borderRadius: 12, flexShrink: 0, fontSize: 21,
                background: theme.heroGradient, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>🎬</div>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {feedTab !== 'series' && visiblePosts.map((post) => (
          <div key={post.id} style={{
            border: `1px solid ${theme.border}`, borderRadius: 18, padding: post.post_type === 'visual' ? 0 : 16,
            overflow: 'hidden', background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: post.post_type === 'visual' ? '12px 14px 0 14px' : 0, marginBottom: post.post_type === 'visual' ? 0 : 8 }}>
              <Link to={`/u/${post.user_id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                <div style={{ position: 'relative', flexShrink: 0, marginBottom: user && post.user_id !== user.id ? 4 : 0 }}>
                  <div
                    style={{
                      width: 38, height: 38, borderRadius: post.posted_as_type ? 10 : '50%',
                      background: post.posted_as_type
                        ? theme.navy
                        : (profiles[post.user_id]?.avatar_url
                            ? `url(${profiles[post.user_id].avatar_url}) center/cover`
                            : theme.tealGradient),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 14, fontWeight: 800,
                    }}
                  >
                    {post.posted_as_type
                      ? (post.posted_as_type === 'staff' ? '🎖️' : '🏢')
                      : (!profiles[post.user_id]?.avatar_url &&
                          (profiles[post.user_id]?.full_name?.[0] || profiles[post.user_id]?.display_name?.[0] || '?').toUpperCase())}
                  </div>

                  {/* Follow badge sitting on the avatar (TikTok-style) */}
                  {user && post.user_id !== user.id && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFollow(post.user_id) }}
                      aria-label={isFollowing(post.user_id) ? 'Following' : 'Follow'}
                      style={{
                        position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)',
                        width: 22, height: 22, borderRadius: '50%', padding: 0, lineHeight: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                        background: isFollowing(post.user_id) ? '#fff' : theme.navy,
                        border: isFollowing(post.user_id) ? `2px solid ${theme.tealDeep}` : '2px solid #fff',
                        color: isFollowing(post.user_id) ? theme.tealDeep : '#fff',
                        fontSize: isFollowing(post.user_id) ? 11 : 16,
                        fontWeight: 900,
                        boxShadow: isFollowing(post.user_id) ? 'none' : '0 2px 7px rgba(15,23,42,0.5)',
                      }}
                    >
                      {isFollowing(post.user_id) ? '✓' : '+'}
                    </button>
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: theme.navy }}>
                      {post.posted_as_type ? post.posted_as_name : (profiles[post.user_id]?.full_name || profiles[post.user_id]?.display_name || 'User')}
                    </span>
                    {!post.posted_as_type && profiles[post.user_id]?.is_verified && (
                      <span style={{
                        width: 14, height: 14, borderRadius: '50%', background: theme.tealDeep, color: '#fff',
                        fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
                      }}>✓</span>
                    )}
                  </div>
                  {post.posted_as_type ? (
                    <span style={{ fontSize: 11.5, color: theme.tealDeep, fontWeight: 700, display: 'block' }}>
                      {post.posted_as_type === 'staff' && post.posted_as_title ? post.posted_as_title : 'Business'}
                      {' · posted by '}
                      {profiles[post.user_id]?.full_name || profiles[post.user_id]?.display_name || 'team member'}
                    </span>
                  ) : (
                    <>
                      {profiles[post.user_id]?.display_name && (
                        <span style={{ fontSize: 11.5, color: theme.textLight, fontWeight: 600, display: 'block' }}>
                          @{profiles[post.user_id].display_name}
                        </span>
                      )}
                      {profiles[post.user_id]?.is_verified && (profiles[post.user_id]?.specialty || profiles[post.user_id]?.verification_label) && (
                        <span style={{ fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>
                          ✓ {profiles[post.user_id]?.specialty || profiles[post.user_id]?.verification_label}
                        </span>
                      )}
                    </>
                  )}
                  <span style={{ fontSize: 11, color: theme.textLight, fontWeight: 600, display: 'block' }}>{timeAgo(post.created_at)}</span>
                </div>
              </Link>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {post.post_type !== 'text' && post.post_type !== 'visual' && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20,
                    textTransform: 'uppercase', letterSpacing: '0.03em',
                    background: post.post_type === 'question' ? '#fef3c7' : post.post_type === 'review' ? '#fef9c3' : '#e0f2fe',
                    color: post.post_type === 'question' ? theme.warning : post.post_type === 'review' ? '#a16207' : '#0369a1',
                  }}>
                    {post.post_type}
                  </span>
                )}
                {POST_KIND[post.post_type] && (
                  <span style={{
                    marginLeft: 'auto', fontSize: 9, fontWeight: 900, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: theme.tealDeep, background: '#ECFDF5',
                    padding: '3px 8px', borderRadius: 7, flexShrink: 0,
                  }}>
                    {POST_KIND[post.post_type]}
                  </span>
                )}
                {user && post.user_id === user.id && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => setEditingPost({ id: post.id, content: post.content })}
                      style={{ background: 'none', border: 'none', fontSize: 12, color: theme.textLight, cursor: 'pointer', padding: '2px 6px' }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDeletePost(post.id)}
                      disabled={deletingId === post.id}
                      style={{ background: 'none', border: 'none', fontSize: 12, color: theme.alert, cursor: 'pointer', padding: '2px 6px' }}
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Edit post mode */}
            {editingPost?.id === post.id && (
              <div style={{ margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  value={editingPost.content}
                  onChange={(e) => setEditingPost({ ...editingPost, content: e.target.value })}
                  rows={3}
                  style={{ width: '100%', padding: 10, fontSize: 14, border: `1px solid ${theme.tealDeep}`, borderRadius: 12, fontFamily: 'inherit' }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleEditPost(post.id, editingPost.content)} style={{ flex: 1, padding: '8px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>Save</button>
                  <button onClick={() => setEditingPost(null)} style={{ flex: 1, padding: '8px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 13 }}>Cancel</button>
                </div>
              </div>
            )}

            {isLocked(post) ? (
              <div style={{ margin: '8px 0 10px 0' }}>
                {/* Teaser: the opening of the post, fading into nothing */}
                <div style={{ position: 'relative', maxHeight: 110, overflow: 'hidden' }}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, color: theme.textMid, lineHeight: 1.5 }}>
                    {String(post.content || '').slice(0, 220)}
                  </p>
                  <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0, height: 70,
                    background: 'linear-gradient(to bottom, rgba(255,255,255,0), #fff)',
                  }} />
                </div>

                {/* The gate */}
                <div style={{
                  border: `1px solid ${theme.border}`, borderRadius: 14,
                  padding: 16, textAlign: 'center', background: theme.bg, marginTop: 4,
                }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: 20 }}>🔒</p>
                  <p style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>
                    Subscriber-only content
                  </p>
                  <p style={{ margin: '0 0 12px 0', fontSize: 12.5, color: theme.textLight }}>
                    Subscribe to {profiles[post.user_id]?.full_name || profiles[post.user_id]?.display_name || 'this creator'} to read the rest.
                  </p>
                  <Link
                    to={`/u/${post.user_id}`}
                    style={{
                      display: 'inline-block', padding: '10px 22px', background: theme.tealGradient,
                      color: '#fff', borderRadius: 12, fontWeight: 800, fontSize: 13, textDecoration: 'none',
                    }}
                  >
                    Subscribe to read
                  </Link>
                </div>
              </div>
            ) : post.post_type === 'visual' ? (
              <div>
                <VisualCard templateKey={post.theme} content={post.content} hasVoice={!!post.audio_url} imageUrl={post.image_url} videoUrl={post.video_url} username={profiles[post.user_id]?.display_name || profiles[post.user_id]?.full_name || ''} />

                {post.audio_url && (
                  <audio
                    src={post.audio_url}
                    controls
                    preload="none"
                    style={{ width: '100%', height: 38, marginTop: 8 }}
                  />
                )}

                <button
                  type="button"
                  onClick={() => shareCard(post)}
                  disabled={sharingId === post.id}
                  style={{
                    width: '100%', marginTop: 8, padding: '10px 12px',
                    background: theme.navy, color: '#fff', border: 'none',
                    borderRadius: 12, fontWeight: 800, fontSize: 12.5, cursor: 'pointer',
                  }}
                >
                  {sharingId === post.id
                    ? 'Preparing…'
                    : post.audio_url && canExportVideo()
                      ? '⬇️ Download with voice · share to status'
                      : '⬇️ Download card · share to status'}
                </button>
              </div>
            ) : (
              <>
                {post.post_type === 'review' && post.rating && (
                  <p style={{ margin: '8px 0 6px 0', color: theme.warning, fontSize: 14 }}>
                    {'★'.repeat(post.rating)}{'☆'.repeat(5 - post.rating)}
                  </p>
                )}
                {post.post_type === 'article' || post.post_type === 'premium' ? (

                  <div style={{ margin: '10px 0 12px 0' }}>
                    <ArticleEditor value={post.content} readOnly />
                  </div>
                ) : (
                  <p style={{ margin: '8px 0 10px 0', whiteSpace: 'pre-wrap', fontSize: 14, color: theme.textMid, lineHeight: 1.5 }}>{post.content}</p>
                )}
                {post.image_url && post.post_type !== 'visual' && (
                  <img src={post.image_url} alt="post" style={{ width: '100%', borderRadius: 12, marginBottom: 8 }} />
                )}
              </>
            )}
            <div style={{
              padding: post.post_type === 'visual' ? '6px 16px 0 16px' : '4px 0 0 0',
              display: 'flex', gap: 12, alignItems: 'center',
            }}>
              {likeCount(post.id) > 0 && (
                <span style={{ fontSize: 12, color: theme.textLight, fontWeight: 600 }}>
                  ❤️ {formatCount(likeCount(post.id))} {likeCount(post.id) === 1 ? 'like' : 'likes'}
                </span>
              )}
              {comments[post.id] && comments[post.id].length > 0 && (
                <span style={{ fontSize: 12, color: theme.textLight, fontWeight: 600 }}>
                  💬 {comments[post.id].length}
                </span>
              )}
            </div>
            <style>{`
              .eng-row { display: flex; align-items: center; justify-content: space-between; }
              .eng-item { background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 10px 2px; -webkit-tap-highlight-color: transparent; transition: transform 0.08s; }
              .eng-item:active { transform: scale(0.88); }
              .eng-item span { font-size: 13px; font-weight: 600; }
            `}</style>
            <div className="eng-row" style={{
              borderTop: `1px solid ${theme.border}`, marginTop: 8,
              marginLeft: post.post_type === 'visual' ? 16 : 0, marginRight: post.post_type === 'visual' ? 16 : 0,
              marginBottom: post.post_type === 'visual' ? 16 : 0,
              paddingTop: 4,
            }}>
              {/* Comment */}
              <button className="eng-item" onClick={() => toggleComments(post.id)}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#536471" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span style={{ color: '#536471' }}>{comments[post.id]?.length ? formatCount(comments[post.id].length) : ''}</span>
              </button>

              {/* Repost / Share look */}
              <button className="eng-item" onClick={() => {
                if (navigator.share) navigator.share({ title: 'CareFind', text: post.content, url: window.location.href })
              }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#536471" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
                <span style={{ color: '#536471' }}></span>
              </button>

              {/* Like */}
              <button className="eng-item" onClick={() => toggleLike(post.id)}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill={userHasLiked(post.id) ? '#f91880' : 'none'} stroke={userHasLiked(post.id) ? '#f91880' : '#536471'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
                <span style={{ color: userHasLiked(post.id) ? '#f91880' : '#536471' }}>{likeCount(post.id) ? formatCount(likeCount(post.id)) : ''}</span>
              </button>

              {/* Views */}
              <button className="eng-item" style={{ cursor: 'default' }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#536471" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="10"/>
                </svg>
                <span style={{ color: '#536471' }}>{formatCount(post.view_count)}</span>
              </button>

              {/* Save */}
              <button className="eng-item" onClick={() => toggleSave(post.id)}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill={isSaved(post.id) ? theme.tealDeep : 'none'} stroke={isSaved(post.id) ? theme.tealDeep : '#536471'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                <span style={{ color: '#536471' }}></span>
              </button>

              {/* Gift */}
              <button className="eng-item" onClick={() => {
                user ? setGiftingPost({ postId: post.id, authorId: post.user_id }) : window.location.href = '/login'
              }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={theme.tealDeep} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 12 20 22 4 22 4 12"/>
                  <rect x="2" y="7" width="20" height="5"/>
                  <line x1="12" y1="22" x2="12" y2="7"/>
                  <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
                  <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
                </svg>
                <span style={{ color: theme.tealDeep }}></span>
              </button>
            </div>

            {openComments[post.id] && (
              <div style={{ paddingTop: 10, borderTop: `1px solid ${theme.border}`, paddingLeft: post.post_type === 'visual' ? 14 : 0, paddingRight: post.post_type === 'visual' ? 14 : 0, paddingBottom: post.post_type === 'visual' ? 14 : 0 }}>
                {(comments[post.id] || []).map((c) => (
                  <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-start' }}>
                    <Link to={`/u/${c.user_id}`} style={{ textDecoration: 'none', flexShrink: 0 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: theme.tealGradient,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 11, fontWeight: 800,
                      }}>
                        {(c.profiles?.full_name || c.profiles?.display_name || '?')[0]?.toUpperCase()}
                      </div>
                    </Link>
                    <div style={{ flex: 1, background: theme.bg, borderRadius: 12, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Link to={`/u/${c.user_id}`} style={{ textDecoration: 'none' }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: theme.navy }}>
                              {c.profiles?.full_name || c.profiles?.display_name || 'CareFind User'}
                            </span>
                          </Link>
                          {c.profiles?.is_verified && (
                            <span style={{ fontSize: 9, fontWeight: 800, color: theme.tealDeep }}>
                              ✓ {c.profiles?.specialty || ''}
                            </span>
                          )}
                        </div>
                        {user && c.user_id === user.id && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => setEditingComment({ id: c.id, content: c.content, post_id: post.id })} style={{ background: 'none', border: 'none', fontSize: 11, cursor: 'pointer', color: theme.textLight }}>✏️</button>
                            <button onClick={() => handleDeleteComment(c.id, post.id)} style={{ background: 'none', border: 'none', fontSize: 11, cursor: 'pointer', color: theme.alert }}>🗑️</button>
                          </div>
                        )}
                      </div>
                      {editingComment?.id === c.id ? (
                        <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
                          <input
                            value={editingComment.content}
                            onChange={(e) => setEditingComment({ ...editingComment, content: e.target.value })}
                            style={{ flex: 1, padding: '5px 8px', fontSize: 12, border: `1px solid ${theme.tealDeep}`, borderRadius: 8 }}
                          />
                          <button onClick={() => handleEditComment(c.id, post.id, editingComment.content)} style={{ padding: '5px 10px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Save</button>
                          <button onClick={() => setEditingComment(null)} style={{ padding: '5px 8px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 11 }}>✕</button>
                        </div>
                      ) : (
                        <p style={{ margin: 0, fontSize: 13, color: theme.textMid, lineHeight: 1.4 }}>{c.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {user ? (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', background: theme.tealGradient,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800, flexShrink: 0,
                    }}>
                      {user.email?.[0]?.toUpperCase()}
                    </div>
                    <input
                      type="text"
                      value={commentDrafts[post.id] || ''}
                      onChange={(e) => setCommentDrafts({ ...commentDrafts, [post.id]: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddComment(post.id)}
                      placeholder="Add a comment..."
                      style={{ flex: 1, padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 20, outline: 'none' }}
                    />
                    <button
                      onClick={() => handleAddComment(post.id)}
                      style={{ padding: '7px 12px', background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 700 }}
                    >
                      Post
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: theme.textLight }}>
                    <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log in</Link> to comment.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {createOpen && (
        <div
          onClick={() => setCreateOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', maxWidth: 480,
              padding: '16px 16px 20px', boxSizing: 'border-box',
            }}
          >
            <div style={{ width: 38, height: 4, borderRadius: 2, background: theme.border, margin: '0 auto 14px' }} />
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 900, color: theme.navy }}>Create</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }}>
              {CREATE_OPTIONS.map((opt) => {
                const locked = opt.pro && !canGoLive
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setCreateOpen(false)
                      if (locked) { navigate('/verify'); return }
                      opt.run()
                    }}
                    style={{
                      position: 'relative', border: `1px solid ${opt.danger ? '#FCA5A5' : theme.border}`,
                      borderRadius: 14, padding: '13px 6px 10px', textAlign: 'center',
                      background: opt.danger ? '#FEF2F2' : '#fff',
                      opacity: locked ? 0.55 : 1, cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 21, marginBottom: 6 }}>{opt.icon}</span>
                    <span style={{
                      fontSize: 10.5, fontWeight: opt.danger ? 900 : 700,
                      color: opt.danger ? theme.alert : theme.textMid,
                    }}>{opt.label}</span>
                    {opt.pro && (
                      <span style={{
                        position: 'absolute', top: 7, right: 8, fontSize: 9,
                        fontWeight: 900, color: theme.tealDeep,
                      }}>✓</span>
                    )}
                  </button>
                )
              })}
            </div>

            {!canGoLive && (
              <p style={{ margin: '12px 2px 0', fontSize: 10.5, color: theme.textLight, textAlign: 'center' }}>
                ✓ Verified only ·{' '}
                <Link to="/verify" style={{ color: theme.tealDeep, fontWeight: 800, textDecoration: 'none' }}>
                  Get verified
                </Link>
              </p>
            )}
          </div>
        </div>
      )}

      {showDraw && (
        <DrawingBoard
          onCancel={() => setShowDraw(false)}
          onSave={(blob) => {
            if (blob) {
              // A drawing is just an image — same pipeline as a photo
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
      <BottomNav onCompose={() => setCreateOpen(true)} />
      {giftingPost && (
        <GiftPanel
          postId={giftingPost.postId}
          recipientId={giftingPost.authorId}
          onClose={() => setGiftingPost(null)}
        />
      )}
    </div>
  )
}

export default Feed
