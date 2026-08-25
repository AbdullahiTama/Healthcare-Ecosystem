import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import { theme } from '../../styles/theme'
import { ConfirmDialog, Modal, Toast, useToast } from '../../components/ui'
import { Flag } from 'lucide-react'
import { usePostEngagement } from './usePostEngagement.js'
import { postRepository } from './repositories'
import { REPORT_REASONS } from './postSelectors.js'
import { markPostsDirty } from './postSync.js'
import PostDetailModal from './PostDetailModal.jsx'
import GiftPanel from '../subscriptions-monetization/GiftPanel.jsx'

// The members of usePostEngagement's `engagementProps` that CANNOT make Feed's
// copy of a post stale — the only ones this overlay hands to PostCard
// unwrapped (see `wrapMutations` and the cardProps comment below).
//
// Two kinds, and nothing else belongs here:
//  - Pure readers. Every selector derives a number or a boolean from state
//    already held; several are called during PostCard's render, so wrapping
//    them would mark the overlay dirty just for drawing it.
//  - View-local state that no other surface shows: whether this overlay's
//    comment panel is open, the draft text in its comment box, which comment
//    it is editing, and which one it is replying to. Feed keeps its own.
//    `toggleComments` fetches, but a fetch is not a mutation.
//
// Adding a name here is a claim that Feed cannot be showing anything that
// member changes. Everything absent is treated as a mutation.
const READ_ONLY_ENGAGEMENT_MEMBERS = new Set([
  'formatCount', 'timeAgo', 'likeCount', 'userHasLiked', 'commentTotal',
  'shareCount', 'saveCount', 'giftCount', 'userHasReposted', 'isSaved',
  'isFollowing', 'isLocked', 'resolveSource',
  'toggleComments', 'setCommentDrafts', 'setEditingComment', 'setReplyingTo',
])

// A post rendered as an overlay above whatever page is underneath —
// /post/:id, opened from inside the feed. Mounted only by BackgroundRoutes'
// second <Routes> (no `location` prop, so it matches the real URL), which
// itself only renders while history state carries a `background` location.
// A cold load of the same URL has no background and renders PostPage instead.
//
// Third consumer of usePostEngagement (Feed, then PostPage, now this) — owns
// its own instance rather than reaching into the Feed mounted behind it,
// which is exactly what the Task 1-4 extraction made possible. `useLocation()`
// inside the Feed behind this modal still reads the BACKGROUND location
// (`/feed`), never `/post/:id` — see BackgroundRoutes.jsx.
//
// Owning a separate instance means NO mutation made in here — like, save,
// repost, follow, share, gift, report, edit, delete, or anything done to a
// comment — ever touches Feed's copy of the same post;
// dirtyRef + close()'s markPostsDirty() below is what tells Feed to reload
// once the overlay closes. See postSync.js for why that's a DOM event rather
// than router or React state.
//
// Deleted and RLS-hidden posts render identically on purpose, same reasoning
// as PostPage: distinguishing "removed" from "you can't see this" would leak
// whether a private post exists. getPostById throws (PGRST116) for both, so
// both land in the same catch here.
//
// PostCard renders a Gift button for every viewer and Edit/Delete/Report menu
// items depending on who's looking — passing no-ops here would leave those
// controls visible and dead, so every one of them is wired for real, same as
// PostPage.
export default function PostModalRoute() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar } = useHeaderIdentity(user)

  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  // Chrome this overlay owns (mirrors PostPage's / Feed's equivalents): which
  // post is mid-gift, mid-delete-confirm or mid-report, and the Voice-Card
  // export's in-progress marker.
  const [giftingPost, setGiftingPost] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [reportPostId, setReportPostId] = useState(null)
  const [reportingId, setReportingId] = useState(null)
  const [sharingId, setSharingId] = useState(null)
  const [editingPost, setEditingPost] = useState(null)

  // Whether any mutation happened during this overlay's lifetime — see
  // `wrapMutations` and cardProps below for how that is decided, and
  // submitReport / GiftPanel's onClose for the two the overlay owns itself.
  // The Feed mounted underneath owns none of this overlay's engagement state
  // (see the file comment above), so it has no way to know a card it's showing
  // just went stale — this is how it finds out. A ref, not state: it needs to
  // be readable from `close()` without triggering a re-render of its own, and
  // nothing here ever renders off it.
  const dirtyRef = useRef(false)
  function markDirty() { dirtyRef.current = true }

  // Re-exposes an engagement surface with every mutating member marking this
  // overlay dirty before it runs. Non-functions (state slices like `profiles`
  // or `comments`) and the read-only members above pass through untouched;
  // return values are preserved, so an awaited handler still resolves to what
  // the hook returned.
  function wrapMutations(props) {
    const wrapped = {}
    for (const [name, value] of Object.entries(props)) {
      wrapped[name] = typeof value === 'function' && !READ_ONLY_ENGAGEMENT_MEMBERS.has(name)
        ? (...args) => { markDirty(); return value(...args) }
        : value
    }
    return wrapped
  }

  // Closing this overlay is always `navigate(-1)`: it pops the history entry
  // that carried `state.background`, which reveals the page underneath at its
  // untouched location and scroll position. There is always a previous entry
  // to pop back to, because this component only mounts when one exists.
  //
  // If a mutation happened while the overlay was open, Feed's copy of the
  // post it's about to reveal is stale (worst case: deleted outright, see
  // postSync.js) — signal it to reload before popping back to it.
  function close() {
    if (dirtyRef.current) markPostsDirty()
    navigate(-1)
  }

  const engagement = usePostEngagement({
    user,
    navigate,
    toast,
    onSharingChange: setSharingId,
    onReportPost: setReportPostId,
    onEditingPostChange: setEditingPost,
    reloadFeed: () => refetchThisPost(),
    // The feed behind the overlay owns its own list and reload — this modal
    // has no list of its own, so a delete just closes it and reveals the
    // (briefly stale, until its next natural refresh) feed underneath, same
    // as the old deep-link modal's "missing post closes silently" behaviour.
    onPostDeleted: close,
  })

  // Fetch + hydrate, factored out so the initial load and a post-edit refresh
  // (reloadFeed above) share it rather than each reissuing the same
  // getPostById + hydrate pair. `merge: true` is load-bearing: the feed
  // behind this overlay has already hydrated its own posts, and an overwrite
  // would blank their counts.
  async function fetchAndHydrate() {
    const data = await postRepository.getPostById(id)
    if (!data) return null
    await engagement.hydrate([data], { merge: true })
    return data
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrorMsg('')
    fetchAndHydrate()
      .then((data) => {
        if (cancelled) return
        if (!data) { setErrorMsg("This post isn't available. It may have been removed, or you may not have access to it."); setLoading(false); return }
        setPost(data)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setErrorMsg("This post isn't available. It may have been removed, or you may not have access to it.")
        setLoading(false)
      })
    return () => { cancelled = true }
    // `user` is included so a viewer whose auth resolves just after this
    // overlay mounts gets their own signals (liked/saved/reposted) folded in
    // on the next run, same as PostPage and Feed's initial loads.
  }, [id, user])

  async function refetchThisPost() {
    try {
      const data = await fetchAndHydrate()
      if (data) setPost(data)
    } catch (e) {
      // The edit write already succeeded (handleEditPost only calls
      // reloadFeed after a clean save) — a refetch failing here shouldn't
      // strand the reader on a broken overlay, just leave the body stale.
      console.warn('Could not refresh the post after edit:', e)
    }
  }

  function authorName(p) {
    if (p.posted_as_type) return p.posted_as_name || 'Business'
    const prof = engagement.engagementProps.profiles[p.user_id]
    return prof?.full_name || prof?.display_name || 'CareFind user'
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

    // Reporting is one of the two mutations this overlay owns itself rather
    // than borrowing from the hook, so `wrapMutations` cannot see it: mark
    // dirty here, on success only. Feed renders the post's menu item as
    // "Reported" off the same `reportedPosts` list.
    markDirty()
    engagement.state.setReportedPosts((prev) => [...prev, postId])
    toast.show("Thanks: our team will review this post.", { type: 'success' })
  }

  // Everything the hook exposes to PostCard is wrapped to mark this overlay
  // dirty before it runs, EXCEPT the members named as read-only above. Wrapped
  // here rather than inside usePostEngagement: the hook's other consumers
  // (Feed, PostPage) have no host underneath to tell, so dirty tracking
  // belongs at this call site, not in shared code.
  //
  // Derived by exclusion, deliberately. This started as an allow-list of five
  // handler names and had already drifted by the time it was reviewed —
  // toggleFollow (which changes Feed's Following-tab MEMBERSHIP, not just a
  // count), sharePost, and every comment edit/delete arriving through
  // setComments were all reachable from in here and none of them marked
  // dirty. Naming five more would leave the same trap for the next handler
  // added to the hook, so the default is now "a hook member mutates", and a
  // new one is covered by construction. The two failure modes are not
  // symmetric: guessing wrong in this direction costs Feed one redundant
  // loadFeed on close, guessing wrong the other way leaves a reader looking
  // at a stale feed with no way to know.
  const cardProps = {
    ...wrapMutations(engagement.engagementProps),
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
  }

  return (
    <>
      <PostDetailModal
        show
        post={post}
        loading={loading}
        error={errorMsg}
        onClose={close}
        cardProps={cardProps}
      />

      {giftingPost && (
        <GiftPanel
          postId={giftingPost.postId}
          recipientId={giftingPost.authorId}
          onClose={() => {
            const { postId } = giftingPost
            // Gifting is the overlay's other own mutation (see submitReport),
            // invisible to `wrapMutations`. Marked here, synchronously and
            // unconditionally, rather than after the stats read below tells us
            // whether the count actually moved: the reader can close the
            // overlay before that read resolves, and close() samples dirtyRef
            // on the spot. Over-marking costs Feed one reload after a reader
            // opened the gift sheet and sent nothing.
            markDirty()
            setGiftingPost(null)
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
        onConfirm={() => {
          // The wrapped handler, not the raw one: it marks dirty before the
          // delete is even issued, which is what this path needs. Delete
          // reaches close() through handleDeletePost's own onPostDeleted
          // callback (`close` itself) rather than a tap on Close, and close()
          // samples dirtyRef synchronously — so it has to already be true by
          // the time the write resolves. PostCard never deletes directly; it
          // only opens this dialog (setConfirmDeleteId).
          cardProps.handleDeletePost(confirmDeleteId)
          setConfirmDeleteId(null)
        }}
        title="Delete this post?"
        consequence="This cannot be undone. The post, along with its likes and comments, will be permanently removed."
        confirmLabel="Delete"
      />

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

      <Toast msg={toast.msg} type={toast.type} />
    </>
  )
}
