import { useState, useCallback } from 'react'
import { supabase } from '../../config/supabaseClient'
import { buildInterestProfile } from './feedEngine'
import * as sel from './postSelectors.js'

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

// Owns everything that answers "what is this post's engagement context?" —
// the state, the reads that fill it, and the handlers that change it. Two
// consumers: the feed (many posts, overwrite) and PostPage (one post, merge).
export function usePostEngagement({ user, navigate, toast }) {
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
  }

  return {
    hydrate,
    engagementProps,
    state: {
      posts, setPosts, reactions, setReactions, follows, setFollows,
      savedPosts, setSavedPosts, repostedPosts, setRepostedPosts,
      repostSources, setRepostSources, giftStats, setGiftStats,
      commentCounts, setCommentCounts, shareCounts, setShareCounts,
      saveCounts, setSaveCounts, userSubscriptions, setUserSubscriptions,
      unlockedCreators, setUnlockedCreators, openComments, setOpenComments,
      reportedPosts, setReportedPosts, profiles, setProfiles,
    },
  }
}
