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
// Owning a separate instance means a mutation in here (edit, delete, like,
// comment, save, repost) never touches Feed's copy of the same post —
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

  // Whether any mutation happened during this overlay's lifetime (edit,
  // delete, like, comment, save, repost). Feed mounted underneath owns none
  // of this overlay's engagement state (see the file comment above), so it
  // has no way to know a card it's showing just went stale — this is how it
  // finds out. A ref, not state: it needs to be readable from `close()`
  // without triggering a re-render of its own, and nothing here ever renders
  // off it.
  const dirtyRef = useRef(false)
  function markDirty() { dirtyRef.current = true }

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

    engagement.state.setReportedPosts((prev) => [...prev, postId])
    toast.show("Thanks: our team will review this post.", { type: 'success' })
  }

  // Mutations PostCard can fire straight into the hook (like/save/repost/edit/
  // comment) — the ones Finding 20 calls out as needing to reach Feed. Wrapped
  // here, not inside usePostEngagement itself: the hook's other consumers
  // (Feed, PostPage) have no "host underneath" to tell, so the dirty tracking
  // belongs at this call site, not in shared code. Delete goes through
  // ConfirmDialog's onConfirm below instead of this object, since PostCard
  // only ever opens the confirm dialog (setConfirmDeleteId), never deletes
  // directly.
  const { toggleLike, toggleSave, toggleRepost, handleEditPost, handleCommentAdded, ...restEngagementProps } = engagement.engagementProps
  const cardProps = {
    ...restEngagementProps,
    toggleLike: (...args) => { markDirty(); return toggleLike(...args) },
    toggleSave: (...args) => { markDirty(); return toggleSave(...args) },
    toggleRepost: (...args) => { markDirty(); return toggleRepost(...args) },
    handleEditPost: (...args) => { markDirty(); return handleEditPost(...args) },
    handleCommentAdded: (...args) => { markDirty(); return handleCommentAdded(...args) },
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
          // Marked before the delete resolves, not inside handleDeletePost's
          // onPostDeleted callback (which is `close` itself): close() reads
          // dirtyRef synchronously, so it must already be true by the time
          // that callback runs.
          markDirty()
          engagement.engagementProps.handleDeletePost(confirmDeleteId)
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
