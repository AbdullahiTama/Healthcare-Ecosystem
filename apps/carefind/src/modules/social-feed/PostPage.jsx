import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Flag } from 'lucide-react'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import { theme } from '../../styles/theme'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { CardSkeleton, ConfirmDialog, Empty, Modal, Toast, useToast } from '../../components/ui'
import { usePostEngagement } from './usePostEngagement.js'
import { postRepository } from './repositories'
import { REPORT_REASONS } from './postSelectors.js'
import PostCard from './PostCard.jsx'
import GiftPanel from '../subscriptions-monetization/GiftPanel.jsx'

// A post at its own URL — /post/:id. Second consumer of usePostEngagement;
// the feed is the first. That's what makes the Task 2-4 extraction a real
// seam rather than a wrapper around Feed's internals.
//
// Deleted and RLS-hidden posts render identically on purpose: distinguishing
// "removed" from "you can't see this" would leak whether a private post
// exists. getPostById throws (PGRST116) when RLS hides a row and also when
// the row is genuinely gone, so both land in the same catch.
//
// PostCard renders a Gift button for every viewer and Edit/Delete/Report menu
// items depending on who's looking — passing no-ops here would leave those
// controls visible and dead. Every one of them is wired for real.
export default function PostPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)

  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const headingRef = useRef(null)
  const hasFocusedRef = useRef(false)

  // Chrome this page owns (mirrors Feed's equivalents so the two surfaces
  // behave identically): which post is mid-gift, mid-delete-confirm or
  // mid-report, and the Voice-Card export's in-progress marker.
  const [giftingPost, setGiftingPost] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [reportPostId, setReportPostId] = useState(null)
  const [reportingId, setReportingId] = useState(null)
  const [sharingId, setSharingId] = useState(null)
  const [editingPost, setEditingPost] = useState(null)

  const engagement = usePostEngagement({
    user,
    navigate,
    toast,
    onSharingChange: setSharingId,
    onReportPost: setReportPostId,
    // handleEditPost closes the inline editor and refetches after a save.
    // There is no feed list here, so "refetch" means "re-fetch this post".
    onEditingPostChange: setEditingPost,
    reloadFeed: () => refetchThisPost(),
    // handleDeletePost's aftermath on the feed is a list reload; here there
    // is no list to reload — the post the reader was looking at is gone, so
    // the only sane place to land them is the feed itself.
    onPostDeleted: () => navigate('/feed'),
  })

  // Fetch + hydrate, factored into one function so the initial load and a
  // post-edit refresh (reloadFeed above) share it rather than each reissuing
  // the same getPostById + hydrate pair.
  async function fetchAndHydrate() {
    const data = await postRepository.getPostById(id)
    if (!data) return null
    await engagement.hydrate([data], { merge: true })
    return data
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    fetchAndHydrate()
      .then((data) => {
        if (cancelled) return
        if (!data) { setNotFound(true); setLoading(false); return }
        setPost(data)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setNotFound(true); setLoading(false) } })
    return () => { cancelled = true }
    // `user` is included so a viewer whose auth resolves just after this
    // page mounts gets their own signals (liked/saved/reposted) folded in on
    // the next run, the same way Feed's initial load depends on [user].
  }, [id, user])

  async function refetchThisPost() {
    try {
      const data = await fetchAndHydrate()
      if (data) setPost(data)
    } catch (e) {
      // The edit write already succeeded (handleEditPost only calls
      // reloadFeed after a clean save) — a refetch failing here shouldn't
      // strand the reader on a broken page, just leave the body stale.
      console.warn('Could not refresh the post after edit:', e)
    }
  }

  // A reader arriving from a shared link should land on the post, not the
  // nav — but only once. Without the ref, every later re-hydrate (e.g. the
  // refetch after an edit save) would steal focus back from wherever the
  // reader's own interaction left it.
  useEffect(() => {
    if (post && !hasFocusedRef.current) {
      headingRef.current?.focus()
      hasFocusedRef.current = true
    }
  }, [post])

  // The permalink IS the conversation view: open comments as soon as the
  // post is known, reusing the hook's own open+fetch rather than
  // reimplementing it.
  useEffect(() => {
    if (post && !engagement.state.openComments[post.id]) {
      engagement.engagementProps.toggleComments(post.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id])

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
  }

  const innerContent = (
    <>
      {loading && (
        <div role="status" aria-live="polite">
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Loading post
          </span>
          <CardSkeleton />
        </div>
      )}

      {!loading && notFound && (
        <Empty
          message={
            <>
              <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>
                This post isn't available
              </div>
              <div style={{ fontSize: 13, color: theme.gray500 }}>
                It may have been removed, or you may not have access to it.
              </div>
            </>
          }
          action="Go to feed"
          onAction={() => navigate('/feed')}
        />
      )}

      {!loading && !notFound && post && (
        <>
          {/* Visually hidden: PostCard already renders the author header
              visibly, so a second visible title would duplicate it. This
              still gives screen readers and focus management a real
              landmark heading. */}
          <h1
            ref={headingRef}
            tabIndex={-1}
            style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
          >
            Post by {authorName(post)}
          </h1>
          <PostCard {...cardProps} post={post} preview={false} />
        </>
      )}
    </>
  )

  const modals = (
    <>
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

      {/* Report reasons: a closed set, one tap each — same wording as Feed. */}
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

  if (isMobile) {
    return (
      <>
        <main
          role="main"
          style={{
            fontFamily: theme.fontFamily,
            maxWidth: 480,
            margin: '0 auto',
            padding: '12px 16px calc(90px + env(safe-area-inset-bottom))',
          }}
        >
          {innerContent}
        </main>
        <BottomNav />
        {modals}
      </>
    )
  }

  // Desktop/tablet: AppShell supplies the page's one <main> landmark, so the
  // content here is a plain column, not a second <main> nested inside it.
  // No right sidebar — like Notifications.jsx, this is a single-item detail
  // page, not the feed, and RightSidebar has nothing of its own to show.
  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
      <div style={{ fontFamily: theme.fontFamily, maxWidth: 640, margin: '0 auto' }}>
        {innerContent}
      </div>
      {modals}
    </AppShell>
  )
}
