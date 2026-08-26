// The post-engagement layer: every piece of state and every handler it takes
// to like, comment on, share, gift, save, repost, report, edit or delete a
// post, plus the derived count helpers PostCard renders.
//
// WHY THIS EXISTS (issues #3/#4). All of this used to live inside Feed.jsx,
// which meant only the feed could render a full-featured PostCard. A profile
// showing the same posts had to fall back to a bare tile grid with no
// interactions and no way for creators to manage their own work. The logic is
// surface-independent — "toggle this user's like on this post" is the same
// question everywhere — so it now lives here once, and any surface (feed,
// profile, future collections) hands it its own post list lookups.
//
// CONTRACT. The hook owns interaction STATE ONLY. It deliberately knows
// nothing about where posts come from: the caller supplies
//   getPostById(id)      — lookup into ITS loaded posts (notifications)
//   getProfileName(id)   — display name for share credit
// and two optional integration points:
//   onEngage(postId)     — feed analytics/experiment signal (Feed passes its
//                          staged-rollout logger; other surfaces omit it)
//   onPostMutated()      — called after an edit/delete lands (Feed reloads
//                          the feed; a profile reloads its grid)
//   repostList           — the optimistic 🔁 post is a FEED-LIST row as well
//                          as a reference. Feed wires these to its posts
//                          state; surfaces without a feed list omit them and
//                          only the reference side of a repost happens.
//
// Behaviour is moved verbatim from Feed.jsx — optimistic updates with DB
// reconciliation, idempotent double-taps, notifications — not rewritten.

import { useRef, useState } from 'react'
import { supabase } from '../../config/supabaseClient'
import { insertRowResolvingConflict, writeRepost, undoRepost, REPOST_CONTENT } from './engagement'
import { notify, NOTIF_MESSAGES } from '../../services/notify.js'
import { validateArticleForPublish } from '../news-publishing/articleContent.js'
import { shareOrCopy, mediaToFile } from '../../utils/share.js'
import { toShareText } from '../../utils/formatShare.js'

// Pure presentation helpers, shared by every PostCard surface.
export function formatCount(n) {
  n = n || 0
  if (n < 1000) return `${n}`
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`.replace('.0k', 'k')
  return `${(n / 1000000).toFixed(1)}M`.replace('.0M', 'M')
}

export function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function usePostEngagement({
  user,
  navigate,
  toast,
  getPostById = () => null,
  getProfileName = () => '',
  onEngage,
  onPostMutated,
  repostList,
}) {
  // ── Engagement rows ─────────────────────────────────────────────────────
  // Loaders fill these (setLoaders.* below); the actions below maintain them.
  const [reactions, setReactions] = useState([])
  const [follows, setFollows] = useState([])
  const [savedPosts, setSavedPosts] = useState([])
  const [repostedPosts, setRepostedPosts] = useState([])
  const [commentCounts, setCommentCounts] = useState({})
  const [shareCounts, setShareCounts] = useState({})
  const [saveCounts, setSaveCounts] = useState({})
  const [giftStats, setGiftStats] = useState({})
  // Resolved source posts for reposts whose source was not on the loaded page.
  const [repostSources, setRepostSources] = useState({})

  // ── Comment-thread UI state (per post id) ───────────────────────────────
  const [comments, setComments] = useState({})
  const [openComments, setOpenComments] = useState({})
  const [commentDrafts, setCommentDrafts] = useState({})
  const [editingComment, setEditingComment] = useState(null) // { id, content, post_id }
  const [replyingTo, setReplyingTo] = useState(null) // { commentId, postId }

  // ── Authoring / moderation state ────────────────────────────────────────
  const [editingPost, setEditingPost] = useState(null) // { id, content }
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [sharingId, setSharingId] = useState(null)
  const [reportedPosts, setReportedPosts] = useState([])
  const [reportingId, setReportingId] = useState(null)
  const [reportPostId, setReportPostId] = useState(null)

  // In-flight guard: a double-tap in one render tick would otherwise run the
  // whole async repost toggle twice.
  const repostInFlight = useRef(new Set())

  function engage(postId) {
    if (onEngage) onEngage(postId)
  }

  // ── Derived counts / predicates ─────────────────────────────────────────
  function likeCount(postId) {
    return reactions.filter((r) => r.post_id === postId).length
  }

  function userHasLiked(postId) {
    if (!user) return false
    return reactions.some((r) => r.post_id === postId && r.user_id === user.id)
  }

  // Prefer the thread we've actually loaded (it reflects a just-added or
  // just-deleted comment); fall back to the count the loader fetched, so the
  // number is right before the thread is ever opened.
  function commentTotal(postId) {
    const loaded = comments[postId]
    if (loaded) return loaded.length
    return commentCounts[postId] || 0
  }

  function shareCount(postId) {
    return shareCounts[postId] || 0
  }

  function saveCount(postId) {
    return saveCounts[postId] || 0
  }

  function giftCount(postId) {
    return giftStats[postId]?.gift_count || 0
  }

  function userHasReposted(postId) {
    if (!user) return false
    return repostedPosts.some((r) => r.post_id === postId)
  }

  function isSaved(postId) {
    return savedPosts.some((s) => s.post_id === postId)
  }

  function isFollowing(authorId) {
    if (!user) return false
    return follows.some((f) => f.follower_id === user.id && f.following_id === authorId)
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  async function toggleLike(postId) {
    if (!user) return
    const existing = reactions.find((r) => r.post_id === postId && r.user_id === user.id)

    // Optimistic update: instant UI response. Both writes are reconciled
    // against the DB: the insert returns the real row (so an unlike has a
    // valid id to delete), a failed write rolls the UI back, and a fast
    // double-tap hitting the post_reactions_user_post_uniq index reads the
    // existing row instead of leaving a phantom temp id.
    if (existing) {
      setReactions((prev) => prev.filter((r) => r.id !== existing.id))
      const { error } = await supabase.from('post_reactions').delete().eq('id', existing.id)
      if (error) {
        setReactions((prev) => [...prev, existing])
        toast.show('Could not unlike right now.', { type: 'error' })
      }
      return
    }

    const tempReaction = { id: `temp_${Date.now()}`, post_id: postId, user_id: user.id, reaction_type: 'like' }
    setReactions((prev) => [...prev, tempReaction])
    const { data, error } = await insertRowResolvingConflict(
      supabase,
      'post_reactions',
      { post_id: postId, user_id: user.id, reaction_type: 'like' },
      ['post_id', 'user_id'],
    )

    if (error) {
      setReactions((prev) => prev.filter((r) => r.id !== tempReaction.id))
      toast.show('Could not like right now.', { type: 'error' })
      return
    }

    setReactions((prev) => prev.map((r) => (r.id === tempReaction.id ? data : r)))
    engage(postId)

    const post = getPostById(postId)
    if (post) notify({ recipientId: post.user_id, actorId: user.id, type: 'like', message: 'liked your post', link: '/', postId })
  }

  async function toggleComments(postId) {
    setOpenComments(prev => ({ ...prev, [postId]: !prev[postId] }))

    if (!openComments[postId] && !comments[postId]) {
      const { data } = await supabase
        .from('post_comments')
        .select('id, content, created_at, user_id, parent_id, mentions, profiles!user_id(id, display_name, full_name, is_verified, specialty, avatar_url), post_comment_likes(id, user_id)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
      setComments(prev => ({ ...prev, [postId]: data || [] }))
    }
  }

  // Called when CommentThread successfully adds a comment or a reply. A top-
  // level comment notifies the post author; a reply additionally notifies the
  // author of the comment being replied to. Fire-and-forget either way.
  function handleCommentAdded({ postId, parentId }) {
    const post = getPostById(postId)
    if (post) notify({ recipientId: post.user_id, actorId: user.id, type: 'comment', message: 'commented on your post', link: '/feed', postId })
    if (parentId) {
      const parent = (comments[postId] || []).find((c) => c.id === parentId)
      if (parent && parent.user_id !== user.id) {
        notify({ recipientId: parent.user_id, actorId: user.id, type: 'reply', message: 'replied to your comment', link: '/feed', postId })
      }
    }
  }

  async function toggleFollow(authorId) {
    if (!user || authorId === user.id) return
    const existing = follows.find((f) => f.follower_id === user.id && f.following_id === authorId)

    if (existing) {
      setFollows((prev) => prev.filter((f) => f.id !== existing.id))
      const { error } = await supabase.from('follows').delete().eq('id', existing.id)
      if (error) setFollows((prev) => [...prev, existing]) // put it back if it failed
    } else {
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
      if (data) setFollows((prev) => prev.map((f) => (f.id === temp.id ? data : f)))
      notify({ recipientId: authorId, actorId: user.id, type: 'follow', message: 'started following you', link: `/u/${user.id}` })
    }
  }

  // Reporting is a two-step flow: the overflow menu opens a reason picker,
  // the picked reason writes the report.
  function openReport(postId) {
    if (!user) { navigate('/login'); return }
    if (reportedPosts.includes(postId)) {
      toast.show('You already reported this post.')
      return
    }
    setReportPostId(postId)
  }

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

    setReportedPosts((prev) => [...prev, postId])
    toast.show('Thanks: our team will review this post.', { type: 'success' })

    // Phase 7 spam signal — the caller tags it with its rollout group.
    engage(postId)
  }

  async function sharePost(post) {
    const author = getProfileName(post.user_id)
    const text = author ? `“${toShareText(post.content)}” — ${author} on CareFind` : toShareText(post.content)
    const mediaUrl = post.image_url || post.video_url || null
    const file = mediaUrl ? await mediaToFile(mediaUrl) : null
    const result = await shareOrCopy({ title: 'CareFind', text, url: `${window.location.origin}/feed?post=${post.id}`, files: file ? [file] : undefined, mediaUrl })
    if (result === 'copied') toast.show('Post copied: paste it anywhere to share.', { type: 'success' })
    if (result === 'failed') toast.show("This browser won't let us share or copy from here.", { type: 'error' })

    if (result === 'shared' || result === 'copied') {
      engage(post.id)
      try {
        await supabase.from('post_shares').insert({
          post_id: post.id,
          user_id: user ? user.id : null,
          platform: result === 'copied' ? 'copy' : 'web',
        })
        setShareCounts((prev) => ({ ...prev, [post.id]: (prev[post.id] || 0) + 1 }))
      } catch (e) {
        console.warn('Share tracking write failed:', e)
      }
    }
  }

  async function toggleSave(postId) {
    if (!user) return
    const existing = savedPosts.find((s) => s.post_id === postId)

    // Optimistic update with the same reconciliation as toggleLike: the
    // insert returns the real row, failures roll back, and a double-tap
    // hitting saved_posts_user_post_uniq resolves to the existing row.
    if (existing) {
      setSavedPosts((prev) => prev.filter((s) => s.post_id !== postId))
      setSaveCounts((prev) => ({ ...prev, [postId]: Math.max((prev[postId] || 0) - 1, 0) }))
      const { error } = await supabase.from('saved_posts').delete().eq('id', existing.id)
      if (error) {
        setSavedPosts((prev) => [...prev, existing])
        setSaveCounts((prev) => ({ ...prev, [postId]: (prev[postId] || 0) + 1 }))
        toast.show('Could not unsave right now.', { type: 'error' })
      }
      return
    }

    const temp = { id: `temp_${Date.now()}`, post_id: postId, user_id: user.id }
    setSavedPosts((prev) => [...prev, temp])
    setSaveCounts((prev) => ({ ...prev, [postId]: (prev[postId] || 0) + 1 }))
    const { data, error } = await insertRowResolvingConflict(
      supabase,
      'saved_posts',
      { user_id: user.id, post_id: postId },
      ['post_id', 'user_id'],
    )

    if (error) {
      setSavedPosts((prev) => prev.filter((s) => s.id !== temp.id))
      setSaveCounts((prev) => ({ ...prev, [postId]: Math.max((prev[postId] || 0) - 1, 0) }))
      toast.show('Could not save right now.', { type: 'error' })
    } else {
      setSavedPosts((prev) => prev.map((s) => (s.id === temp.id ? data : s)))
      engage(postId)
    }
  }

  // Classic repost: a 🔁-marked post in the reposter's feed PLUS a
  // post_reposts reference (writeRepost), so followers see the repost and the
  // source carries a real count. Undoing removes both (undoRepost).
  async function toggleRepost(post) {
    if (!user) return
    if (repostInFlight.current.has(post.id)) return
    repostInFlight.current.add(post.id)
    try {
      const existing = repostedPosts.find((r) => r.post_id === post.id)

      if (existing) {
        const repostPost = repostList?.findBySource?.(post.id) || null
        setRepostedPosts((prev) => prev.filter((r) => r.id !== existing.id))
        if (repostPost) repostList.onRemoved(repostPost.id)

        const { postsDelete, refDelete } = await undoRepost(supabase, { user, sourcePostId: post.id, repostRefId: existing.id })
        if (postsDelete?.error || refDelete?.error) {
          setRepostedPosts((prev) => [...prev, existing])
          if (repostPost) repostList.onRestored(repostPost)
          toast.show('Could not undo repost right now.', { type: 'error' })
        }
        return
      }

      // The optimistic row mirrors what writeRepost persists: a reference,
      // not a copy of the source's words.
      const tempRepostPost = {
        id: `temp_repost_${Date.now()}`,
        user_id: user.id,
        content: REPOST_CONTENT,
        post_type: 'text',
        subscriber_only: post.subscriber_only || false,
        is_premium: post.is_premium || false,
        repost_of: post.id,
        created_at: new Date().toISOString(),
        view_count: 0,
      }
      const tempRepostRef = { id: `temp_ref_${Date.now()}`, post_id: post.id, user_id: user.id }
      setRepostedPosts((prev) => [...prev, tempRepostRef])
      if (repostList) repostList.onAdded(tempRepostPost)

      const { ref, repostPost } = await writeRepost(supabase, { user, post })

      if (repostPost.error || !repostPost.data) {
        // Feed post failed: take the reference back so the source count doesn't
        // claim a repost that is not visible anywhere.
        if (ref?.data?.id && !ref.error) await supabase.from('post_reposts').delete().eq('id', ref.data.id)
        setRepostedPosts((prev) => prev.filter((r) => r.id !== tempRepostRef.id))
        if (repostList) repostList.onRemoved(tempRepostPost.id)
        toast.show('Could not repost right now.', { type: 'error' })
        return
      }

      setRepostedPosts((prev) => prev.map((r) => (r.id === tempRepostRef.id ? (ref?.data || r) : r)))
      if (repostList) repostList.onConfirmed(tempRepostPost.id, repostPost.data)
      // The source stays available to the card even if it was not on the page.
      setRepostSources((prev) => (prev[post.id] ? prev : { ...prev, [post.id]: post }))

      notify({
        recipientId: post.user_id,
        actorId: user.id,
        type: 'repost',
        message: NOTIF_MESSAGES.repost,
        link: `/feed?post=${post.id}`,
        postId: post.id,
      })
    } finally {
      repostInFlight.current.delete(post.id)
    }
  }

  // Editing runs through the same integrity gate as publishing. The gate
  // compares the body the editor HANDED US against the body we are about to
  // write — it catches content lost by our own processing, never the
  // previously published version.
  async function handleEditPost(postId, newContent, postType) {
    if (!newContent || !newContent.trim()) return
    let content = newContent.trim()

    if (postType === 'article' || postType === 'premium') {
      const check = validateArticleForPublish(content)
      if (!check.ok) { toast.show(check.error, { type: 'error' }); return }
      content = check.content
    }

    const { error } = await supabase.from('posts').update({ content }).eq('id', postId).eq('user_id', user.id)
    if (error) {
      toast.show('Could not save the edit: ' + (error.message || 'unknown error'), { type: 'error' })
      return
    }
    setEditingPost(null)
    if (onPostMutated) onPostMutated()
  }

  async function handleDeletePost(postId) {
    await supabase.from('posts').delete().eq('id', postId).eq('user_id', user.id)
    if (onPostMutated) onPostMutated()
  }

  return {
    // State the surface's loader fills.
    setLoader: {
      setReactions, setFollows, setSavedPosts, setRepostedPosts,
      setCommentCounts, setShareCounts, setSaveCounts, setGiftStats,
    },
    // Repost-source cache + lookup for resolveSource implementations.
    repostSources, setRepostSources,
    // Everything PostCard consumes.
    comments, setComments,
    openComments, commentDrafts, setCommentDrafts,
    editingComment, setEditingComment,
    replyingTo, setReplyingTo,
    editingPost, setEditingPost,
    confirmDeleteId, setConfirmDeleteId,
    sharingId, reportedPosts, reportPostId, reportingId, setReportPostId,
    likeCount, userHasLiked, commentTotal, shareCount, saveCount, giftCount,
    userHasReposted, isSaved, isFollowing,
    toggleLike, toggleComments, handleCommentAdded, toggleFollow,
    openReport, submitReport, sharePost, toggleSave, toggleRepost,
    handleEditPost, handleDeletePost,
  }
}
