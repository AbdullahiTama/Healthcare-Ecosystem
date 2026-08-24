import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../../config/supabaseClient'
import { buildInterestProfile } from './feedEngine'
import * as sel from './postSelectors.js'
import { insertRowResolvingConflict, writeRepost, undoRepost, REPOST_CONTENT } from './engagement'
import { unresolvedSourceIds, indexPosts } from './reposts.js'
import { validateArticleForPublish } from '../news-publishing/articleContent.js'
import { notify, NOTIF_MESSAGES } from '../../services/notify.js'
import { exportImage, exportVideo, canExportVideo, shareOrDownload } from '../../utils/voiceCard.js'
import { shareOrCopy, mediaToFile } from '../../utils/share.js'
import { toShareText } from '../../utils/formatShare.js'
import { loadActiveCreatorIds } from '../subscriptions-monetization/subscriptions.js'

// Merge-by-key for the array slices. `merge:false` replaces outright (a feed
// refetch must drop rows belonging to posts that fell out of the batch);
// `merge:true` appends only rows not already present, so hydrating the same
// post twice cannot double-count it.
function mergeRows(prev, next, key = 'id') {
  const seen = new Set((prev || []).map((r) => r[key]))
  return [...(prev || []), ...(next || []).filter((r) => !seen.has(r[key]))]
}

function applyRows(setter, next, { merge, key = 'id' }) {
  setter((prev) => (merge ? mergeRows(prev, next, key) : next))
}

// Map slices ({ [postId]: value }) merge by spreading; replacing drops keys
// for posts no longer in the batch, which is the point.
function applyMap(setter, next, { merge }) {
  setter((prev) => (merge ? { ...prev, ...next } : next))
}

// Same shape PostCard needs to render any post — a resolved repost source is
// rendered exactly like a normal card (issues #6/#8), so it needs the same
// columns. Mirrors Feed.jsx's (pre-existing, now-redundant) POST_FEED_COLS;
// duplicated rather than imported because Feed's constant isn't exported and
// this task's scope is "don't touch Feed's block", not "wire Feed and the
// hook together" — retiring Feed's copy is a follow-up (see hydrate below).
const REPOST_SOURCE_COLS = 'id, content, created_at, user_id, post_type, theme, image_url, rating, view_count, subscriber_only, audio_url, video_url, posted_as_type, posted_as_id, posted_as_name, posted_as_title, repost_of, repost_count'

// Owns everything that answers "what is this post's engagement context?" —
// the state, the reads that fill it, and the handlers that change it. Two
// consumers: the feed (many posts, overwrite) and PostPage (one post, merge).
//
// The six callbacks after `toast` are the seams where a handler needs
// something that lives only in its host page. Each defaults to a no-op, so a
// consumer that has no such state (PostPage) simply passes nothing and the
// handler behaves as if that step were absent:
//   logEngagement(postId)      — the host's staged-rollout experiment logging.
//                                The hook knows nothing about experiments.
//   onSharingChange(idOrNull)  — shareCard's in-progress marker; drives the
//                                card's disabled/spinner state.
//   onReportPost(postId)       — hands a post to the host's reason picker.
//   onEditingPostChange(null)  — closes the host's inline editor after a save.
//   reloadFeed()               — refetches the host's post list after an edit.
//   onPostDeleted()            — the aftermath of a delete: the feed reloads
//                                its list, a permalink page navigates away.
export function usePostEngagement({
  user,
  navigate,
  toast,
  logEngagement = () => {},
  onSharingChange = () => {},
  onReportPost = () => {},
  onEditingPostChange = () => {},
  reloadFeed = () => {},
  onPostDeleted = () => {},
}) {
  const [reactions, setReactions] = useState([])
  const [profiles, setProfiles] = useState({})
  const [follows, setFollows] = useState([])
  const [savedPosts, setSavedPosts] = useState([])
  const [repostedPosts, setRepostedPosts] = useState([])
  const [repostSources, setRepostSources] = useState({})
  const [giftStats, setGiftStats] = useState({})
  const [commentCounts, setCommentCounts] = useState({})
  const [shareCounts, setShareCounts] = useState({})
  const [saveCounts, setSaveCounts] = useState({})
  const [userSubscriptions, setUserSubscriptions] = useState([])
  const [unlockedCreators, setUnlockedCreators] = useState([])
  const [comments, setComments] = useState({})
  const [openComments, setOpenComments] = useState({})
  const [commentDrafts, setCommentDrafts] = useState({})
  const [editingComment, setEditingComment] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [reportedPosts, setReportedPosts] = useState([])
  const [posts, setPosts] = useState([])
  const [deletingId, setDeletingId] = useState(null)
  // id -> post, maintained by hydrate for every post it's ever given,
  // separate from `posts` (Feed's ranked DISPLAY list, written only by
  // Feed's loadFeed/toggleRepost). toggleLike/handleNotifyComment need "the
  // post this id points at" to notify its author; scanning `posts` for that
  // answers "is it on screen right now", which is empty on PostPage and
  // would wrongly stay empty even once posts is populated elsewhere for a
  // different purpose. Keeping this a separate identity cache means display
  // ordering and lookup-by-id never fight over the same array.
  const [postsById, setPostsById] = useState({})

  // Which creators this viewer has an active paid subscription to — gates
  // `isLocked` for subscriber-only/premium posts. Viewer-scoped, not
  // post-scoped, so this lives in its own effect rather than inside hydrate:
  // every consumer (Feed, PostPage, Task 6's PostModalRoute) needs the same
  // answer to "can THIS viewer read locked content" regardless of which
  // posts happen to be loaded. Previously only Feed populated this (its own
  // loadUnlocked, now removed), so every other consumer's unlockedCreators
  // stayed permanently empty and isLocked was permanently true — a paying
  // subscriber hit the paywall for content they'd already paid for.
  useEffect(() => {
    let cancelled = false
    if (!user) { setUnlockedCreators([]); return }
    loadActiveCreatorIds(user.id).then((ids) => { if (!cancelled) setUnlockedCreators(ids) })
    return () => { cancelled = true }
  }, [user])

  // Which repost sources hydrate has already resolved. A ref, not a read of
  // `repostSources` state: hydrate is a useCallback memoized on [user], so a
  // closure over `repostSources` would go stale the moment the first source
  // resolves (the callback is never recreated just because that state
  // changed) and every later hydrate would re-fetch every source it had
  // already found. Mirrors the toggleRepost in-flight ref below, same reason.
  const resolvedSourceIdsRef = useRef(new Set())

  // Fetches and stores the engagement context (reactions, profiles, comment/
  // share/save/gift counts, follows, the viewer's own signals) for the given
  // posts, and returns the pure signal set the ranker consumes. Generalises
  // enrichAndSetPosts (many posts, overwrite) and enrichSinglePost (one post,
  // merge) into a single body selected by `{ merge }`. Never ranks and never
  // calls setPosts — that stays the feed's job.
  const hydrate = useCallback(async (postData, { merge = false } = {}) => {
    const list = postData || []
    const postIds = list.map((p) => p.id)
    if (postIds.length === 0) {
      if (!merge) { setReactions([]); setProfiles({}); setCommentCounts({}) }
      return null
    }

    // Identity cache (see postsById above): every post this call is given,
    // keyed by id, added regardless of `merge` — an overwrite here would
    // drop the ability to notify about a post that scrolled out of the
    // feed's current display list but a reader still has open elsewhere.
    setPostsById((prev) => ({ ...prev, ...indexPosts(list) }))

    const { data: reactionData } = await supabase
      .from('post_reactions')
      .select('id, post_id, user_id')
      .in('post_id', postIds)
    applyRows(setReactions, reactionData || [], { merge })

    // This user's reposts of the loaded posts, so repost buttons light up
    // across both the feed and in-feed search.
    if (user) {
      const { data: repostData } = await supabase
        .from('post_reposts')
        .select('id, post_id')
        .eq('user_id', user.id)
        .in('post_id', postIds)
      applyRows(setRepostedPosts, repostData || [], { merge, key: 'post_id' })
    }

    // Gift totals for the whole page in one RPC; skipped (no state change) if
    // the RPC isn't available.
    let giftTotals = {}
    try {
      const { data: giftRows } = await supabase.rpc('post_gift_stats_batch', { p_post_ids: postIds })
      giftRows?.forEach((r) => { giftTotals[r.post_id] = { gift_count: r.gift_count, total_coins: r.total_coins } })
      applyMap(setGiftStats, giftTotals, { merge })
    } catch (e) {
      console.warn('gift stats unavailable:', e)
    }

    const userIds = [...new Set(list.map((p) => p.user_id))]
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, display_name, full_name, is_verified, verification_label, specialty, avatar_url, location, country')
      .in('id', userIds)

    const profileMap = {}
    ;(profileData || []).forEach((p) => { profileMap[p.id] = p })
    applyMap(setProfiles, profileMap, { merge })

    // Comment counts for all loaded posts (for ranking)
    const { data: commentRows } = await supabase
      .from('post_comments')
      .select('post_id, user_id')
      .in('post_id', postIds)
    const cCounts = {}
    ;(commentRows || []).forEach((row) => { cCounts[row.post_id] = (cCounts[row.post_id] || 0) + 1 })
    applyMap(setCommentCounts, cCounts, { merge })

    // Like counts per post
    const lCounts = {}
    ;(reactionData || []).forEach((r) => { lCounts[r.post_id] = (lCounts[r.post_id] || 0) + 1 })

    // Phase 6 engine inputs: share/save totals, posted-as facility rows and
    // the viewer's own engagement (follows, saves, subscriptions) — the raw
    // material for the affinity and implicit-interest signals. All fire
    // together; each table is query-1 for this batch.
    const postedAsIds = [...new Set(list.map((p) => p.posted_as_id).filter(Boolean))]
    const [shareRows, saveRows, bizRows, followRows, mySavedRows, mySubRows] = await Promise.all([
      supabase.from('post_shares').select('post_id').in('post_id', postIds),
      supabase.from('saved_posts').select('post_id').in('post_id', postIds),
      supabase.from('businesses')
        .select('id, business_type, status, city, state, location_label')
        .in('id', postedAsIds),
      supabase.from('follows').select('id, follower_id, following_id').in('following_id', userIds),
      user ? supabase.from('saved_posts').select('post_id').eq('user_id', user.id).in('post_id', postIds) : null,
      user ? supabase.from('user_subscriptions').select('professional_id').eq('subscriber_id', user.id).eq('status', 'active') : null,
    ])
    const sCounts = {}
    ;(shareRows?.data || []).forEach((r) => { sCounts[r.post_id] = (sCounts[r.post_id] || 0) + 1 })
    const saveCounts = {}
    ;(saveRows?.data || []).forEach((r) => { saveCounts[r.post_id] = (saveCounts[r.post_id] || 0) + 1 })
    applyMap(setShareCounts, sCounts, { merge })
    applyMap(setSaveCounts, saveCounts, { merge })
    const businessMap = {}
    ;(bizRows?.data || []).forEach((b) => { businessMap[b.id] = b })
    const followRowsArr = followRows?.data || []
    applyRows(setFollows, followRowsArr, { merge })
    applyRows(setSavedPosts, mySavedRows?.data || [], { merge, key: 'post_id' })
    // enrichSinglePost never touched user_subscriptions — it's page-level
    // state a single deep-linked post has no business overwriting. Preserve
    // that: only the overwrite path (merge:false, i.e. a real feed load)
    // sets it.
    if (!merge) {
      setUserSubscriptions((mySubRows?.data || []).map((s) => s.professional_id))
    }

    // The viewer's own signals (vs. the page-wide counts above).
    const viewerReactionIds = new Set((reactionData || []).filter((r) => r.user_id === user?.id).map((r) => r.post_id))
    const viewerCommentIds = new Set((commentRows || []).filter((c) => c.user_id === user?.id).map((c) => c.post_id))
    const viewerSaveIds = new Set((mySavedRows?.data || []).map((s) => s.post_id))
    const followedIds = new Set(followRowsArr.filter((f) => f.follower_id === user?.id).map((f) => f.following_id))

    const postMap = {}
    list.forEach((p) => { postMap[p.id] = p })
    const interest = buildInterestProfile({
      postMap,
      authorProfiles: profileMap,
      viewer: {
        reactedPostIds: viewerReactionIds,
        commentedPostIds: viewerCommentIds,
        savedPostIds: viewerSaveIds,
        followedProfileIds: followedIds,
        subscriptionProfileIds: new Set((mySubRows?.data || []).map((s) => s.professional_id)),
      },
    })

    // Reposts (issues #6/#8): resolve the source of any repost in THIS batch
    // whose source isn't already known, so the card can show the original
    // author's words under a "Reposted by" banner instead of falling through
    // to "no longer available". Feed used to be the only place this ran
    // (its own effect over `unresolvedSourceIds(engagement.state.posts)`);
    // centralising it here means every consumer — Feed, PostPage, and Task
    // 6's PostModalRoute — gets correct repost rendering without a third
    // (or second) copy of the fetch. Feed's own effect is left in place for
    // this round: it will simply find nothing left to fetch once this runs
    // first, so it's redundant but harmless — retiring it is a follow-up.
    //
    // Always merges into repostSources regardless of `merge`: unlike the
    // per-batch slices above, this is a pure resolved-source cache that only
    // grows, so a deep-linked single post must never clobber sources a full
    // feed load already resolved (and vice versa).
    const wantedSourceIds = unresolvedSourceIds(list).filter((sourceId) => !resolvedSourceIdsRef.current.has(sourceId))
    if (wantedSourceIds.length) {
      const { data: sourceRows } = await supabase
        .from('posts')
        .select(REPOST_SOURCE_COLS)
        .in('id', wantedSourceIds)
      // Marked attempted regardless of outcome — a source that's genuinely
      // gone (deleted, or RLS-hidden) must not be re-queried on every future
      // hydrate. `resolveSource` still correctly returns null for it: this
      // ref only guards the fetch, `repostSources` below only ever holds
      // rows that were actually found.
      wantedSourceIds.forEach((id) => resolvedSourceIdsRef.current.add(id))
      if (sourceRows?.length) {
        setRepostSources((prev) => ({ ...prev, ...indexPosts(sourceRows) }))
        // A source's author may not be loaded yet — without it the card
        // would credit "CareFind user" instead of the real writer.
        const missingAuthorIds = [...new Set(sourceRows.map((p) => p.user_id))]
          .filter((uid) => uid && !profileMap[uid] && !profiles[uid])
        if (missingAuthorIds.length) {
          const { data: extraProfiles } = await supabase
            .from('profiles')
            .select('id, display_name, full_name, is_verified, verification_label, specialty, avatar_url, location, country')
            .in('id', missingAuthorIds)
          if (extraProfiles?.length) {
            const extraMap = {}
            extraProfiles.forEach((p) => { extraMap[p.id] = p })
            setProfiles((prev) => ({ ...prev, ...extraMap }))
          }
        }
      }
    }

    // The engine context — every pure signal the ranking reads. Ranking
    // itself (and anything, like viewer region, that only ranking needs)
    // stays in Feed.jsx; hydrate stops here and returns the context.
    const context = {
      lCounts, cCounts, sCounts, saveCounts, giftStats: giftTotals,
      follows: followedIds, viewerReactionIds, viewerCommentIds, viewerSaveIds,
      profiles: profileMap, businesses: businessMap, interest,
    }

    return context
  }, [user])

  // Export a Voice Card so it can go out to WhatsApp Status, logo attached.
  // Tries video (card + voice) first; falls back to a PNG if the browser can't.
  async function shareCard(post) {
    onSharingChange(post.id)
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
          onSharingChange(null)
          if (result === 'downloaded') toast.show('Saved with your voice: post it to your WhatsApp Status.')
          return
        } catch (e) {
          // Video failed on this device: fall through to the image so the user still gets something
          console.warn('Video export failed, falling back to image:', e)
        }
      }

      const blob = await exportImage(opts)
      const result = await shareOrDownload(blob, 'carefind-card.png')
      onSharingChange(null)
      if (result === 'downloaded') {
        toast.show(post.audio_url
          ? "Saved as an image. This phone can't build the video: the voice still plays inside CareFind."
          : 'Saved: post it to your WhatsApp Status.')
      }
    } catch (e) {
      onSharingChange(null)
      toast.show('Could not prepare the card: ' + (e.message || 'unknown error'))
    }
  }

  // Editing runs through the same integrity gate as publishing.
  //
  // The gate deliberately compares the body the editor HANDED US against the
  // body we are about to write — that is, it catches content lost by our own
  // processing. It must NOT compare against the previously published version:
  // shortening an article is an ordinary edit, and an author cutting a
  // redundant paragraph would find every save rejected.
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
    onEditingPostChange(null)
    reloadFeed()
  }

  // Not one of the ten handlers Task 3 moved — it stayed behind in Feed.jsx
  // until Task 5 needed a second host. The write and the `deletingId` state
  // are identical for every host; only the aftermath differs, so that's the
  // one thing left injected. `.eq('user_id', user.id)` is the client-side
  // half of the ownership check — RLS is the other half — and must not be
  // simplified away.
  async function handleDeletePost(postId) {
    setDeletingId(postId)
    await supabase.from('posts').delete().eq('id', postId).eq('user_id', user.id)
    onPostDeleted()
    setDeletingId(null)
  }

  async function toggleLike(postId) {
    if (!user) return
    const existing = reactions.find((r) => r.post_id === postId && r.user_id === user.id)

    // Optimistic update: instant UI response. Both writes are reconciled
    // against the DB: the insert returns the real row (so an unlike has a
    // valid id to delete), a failed write rolls the UI back, and a fast
    // double-tap hitting the post_reactions_user_post_uniq index reads the
    // existing row instead of leaving a phantom temp id. Without this, a
    // silently failed insert made the like vanish on the next feed reload.
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

    // Swap the temp row for the real one so an unlike has a valid id to delete.
    setReactions((prev) => prev.map((r) => (r.id === tempReaction.id ? data : r)))

    logEngagement(postId)

    const post = postsById[postId]
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

  async function handleNotifyComment(postId) {
    const post = postsById[postId]
    if (post) notify({ recipientId: post.user_id, actorId: user.id, type: 'comment', message: 'commented on your post', link: '/feed', postId })
  }

  // Called when CommentThread successfully adds a comment or a reply. A top-
  // level comment notifies the post author; a reply additionally notifies the
  // author of the comment being replied to. Fire-and-forget either way.
  function handleCommentAdded({ postId, parentId }) {
    handleNotifyComment(postId)
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

  // Reporting is a two-step flow: the overflow menu opens a reason picker,
  // the picked reason writes the report. A `window.prompt` (what this used to
  // be) is unstyled, unlabelled and blocked outright in some mobile browsers,
  // so a moderation path can't depend on it: and the handler was never
  // wired to anything, so reporting was unreachable.
  function openReport(postId) {
    if (!user) { navigate('/login'); return }
    if (reportedPosts.includes(postId)) {
      toast.show('You already reported this post.')
      return
    }
    onReportPost(postId)
  }

  async function sharePost(post) {
    const author = profiles[post.user_id]?.display_name || profiles[post.user_id]?.full_name || ''
    const text = author ? `“${toShareText(post.content)}” — ${author} on CareFind` : toShareText(post.content)
    // Attach the post's media (image/video) to the share where the browser
    // supports it; the URL is still appended to the clipboard fallback so
    // WhatsApp recipients always get the media, never just the caption.
    const mediaUrl = post.image_url || post.video_url || null
    const file = mediaUrl ? await mediaToFile(mediaUrl) : null
    const result = await shareOrCopy({ title: 'CareFind', text, url: `${window.location.origin}/feed?post=${post.id}`, files: file ? [file] : undefined, mediaUrl })
    if (result === 'copied') toast.show('Post copied: paste it anywhere to share.', { type: 'success' })
    if (result === 'failed') toast.show("This browser won't let us share or copy from here.", { type: 'error' })

    // Best-effort share tracking so a post's share count is real rather than
    // vanished. One row per (post, user, platform): the post_shares unique
    // index makes repeat shares idempotent for signed-in users. Anonymous
    // shares are recorded without a user_id.
    if (result === 'shared' || result === 'copied') {
      logEngagement(post.id)
      try {
        await supabase.from('post_shares').insert({
          post_id: post.id,
          user_id: user ? user.id : null,
          platform: result === 'copied' ? 'copy' : 'web',
        })
        // Reflect the just-recorded share in the card's count so it doesn't
        // wait for the next feed reload to appear.
        setShareCounts((prev) => ({ ...prev, [post.id]: (prev[post.id] || 0) + 1 }))
      } catch (e) {
        // Tracking is never allowed to fail the share the user just did.
        console.warn('Share tracking write failed:', e)
      }
    }
  }

  async function toggleSave(postId) {
    if (!user) return
    const existing = savedPosts.find((s) => s.post_id === postId)

    // Optimistic update with the same reconciliation as toggleLike: the
    // insert returns the real row, failures roll back, and a double-tap
    // hitting saved_posts_user_post_uniq resolves to the existing row so the
    // save survives a reload.
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
      logEngagement(postId)
    }
  }

  // Classic repost: a 🔁-marked post in the reposter's feed PLUS a
  // post_reposts reference (writeRepost), so followers see the repost and the
  // source carries a real count. Undoing removes both (undoRepost). Optimistic
  // like the other toggles; if the feed-post write fails, the reference is
  // taken back too and the UI rolls to the pre-tap state.
  //
  // In-flight guard: a double-tap in one render tick would otherwise run the
  // whole async toggle twice. The DB index posts_user_repost_uniq already
  // collapses a duplicate 🔁 post to the existing row (writeRepost reconciles
  // 23505), but the guard stops the second write from being issued at all —
  // and stops an in-flight repost from being "undone" by a stale second tap.
  const repostInFlight = useRef(new Set())
  async function toggleRepost(post) {
    if (!user) return
    if (repostInFlight.current.has(post.id)) return
    repostInFlight.current.add(post.id)
    try {
      const existing = repostedPosts.find((r) => r.post_id === post.id)

      if (existing) {
        const repostPost = posts.find((p) => p.repost_of === post.id && p.user_id === user.id)
        setRepostedPosts((prev) => prev.filter((r) => r.id !== existing.id))
        if (repostPost) setPosts((prev) => prev.filter((p) => p.id !== repostPost.id))

        const { postsDelete, refDelete } = await undoRepost(supabase, { user, sourcePostId: post.id, repostRefId: existing.id })
        if (postsDelete?.error || refDelete?.error) {
          setRepostedPosts((prev) => [...prev, existing])
          if (repostPost) setPosts((prev) => [repostPost, ...prev])
          toast.show('Could not undo repost right now.', { type: 'error' })
        }
        return
      }

      // The optimistic row mirrors what writeRepost persists: a reference,
      // not a copy of the source's words (issues #6/#8).
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
      setPosts((prev) => [tempRepostPost, ...prev])

      const { ref, repostPost } = await writeRepost(supabase, { user, post })

      if (repostPost.error || !repostPost.data) {
        // Feed post failed: take the reference back so the source count doesn't
        // claim a repost that is not visible anywhere.
        if (ref?.data?.id && !ref.error) await supabase.from('post_reposts').delete().eq('id', ref.data.id)
        setRepostedPosts((prev) => prev.filter((r) => r.id !== tempRepostRef.id))
        setPosts((prev) => prev.filter((p) => p.id !== tempRepostPost.id))
        toast.show('Could not repost right now.', { type: 'error' })
        return
      }

      // Swap temp rows for the real ones so un-repost has valid ids to delete.
      setRepostedPosts((prev) => prev.map((r) => (r.id === tempRepostRef.id ? (ref?.data || r) : r)))
      setPosts((prev) => prev.map((p) => (p.id === tempRepostPost.id ? repostPost.data : p)))
      // The source stays available to the card even if it was not on this
      // page (e.g. reposted from the detail modal).
      setRepostSources((prev) => (prev[post.id] ? prev : { ...prev, [post.id]: post }))

      // Issue #7: 'repost' was in the notification vocabulary but nothing ever
      // emitted it, so an author was never told their post had been shared.
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

  const engagementProps = {
    profiles,
    comments, setComments,
    openComments,
    commentDrafts, setCommentDrafts,
    editingComment, setEditingComment,
    replyingTo, setReplyingTo,
    reportedPosts,
    formatCount: sel.formatCount,
    timeAgo: sel.timeAgo,
    likeCount: (id) => sel.likeCount(reactions, id),
    userHasLiked: (id) => sel.userHasLiked(reactions, id, user?.id),
    commentTotal: (id) => sel.commentTotal(comments, commentCounts, id),
    shareCount: (id) => sel.countFrom(shareCounts, id),
    saveCount: (id) => sel.countFrom(saveCounts, id),
    giftCount: (id) => (giftStats[id]?.gift_count) || 0,
    userHasReposted: (id) => sel.userHasReposted(repostedPosts, id, user?.id),
    isSaved: (id) => sel.isSaved(savedPosts, id),
    isFollowing: (authorId) => sel.isFollowing(follows, authorId, user?.id),
    isLocked: (post) => sel.isLocked(post, unlockedCreators, user?.id),
    resolveSource: (id) => sel.resolveSourceFrom(posts, repostSources, id),
    toggleLike,
    toggleComments,
    toggleRepost,
    toggleSave,
    toggleFollow,
    sharePost,
    shareCard,
    openReport,
    handleEditPost,
    handleDeletePost,
    handleCommentAdded,
  }

  return {
    hydrate,
    engagementProps,
    state: {
      posts, setPosts, postsById, reactions, setReactions, follows, setFollows,
      savedPosts, setSavedPosts, repostedPosts, setRepostedPosts,
      repostSources, setRepostSources, giftStats, setGiftStats,
      commentCounts, setCommentCounts, shareCounts, setShareCounts,
      saveCounts, setSaveCounts, userSubscriptions, setUserSubscriptions,
      unlockedCreators, setUnlockedCreators, openComments, setOpenComments,
      reportedPosts, setReportedPosts, profiles, setProfiles,
      // Normalises the asymmetry the Task 4 review flagged: every other
      // array/map slice above is reachable from `state`; these four were
      // reachable only via `engagementProps`. Left there too — Feed already
      // reads them from that side and this task must not churn Feed.
      comments, setComments, commentDrafts, setCommentDrafts,
      editingComment, setEditingComment, replyingTo, setReplyingTo,
      deletingId, setDeletingId,
    },
  }
}
