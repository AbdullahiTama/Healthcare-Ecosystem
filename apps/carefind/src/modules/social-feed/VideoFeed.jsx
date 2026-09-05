import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BadgeCheck, Bookmark, Eye, Gift, Heart, MessageCircle, Plus, Repeat2, Share2,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import VideoPlayer from '../../components/VideoPlayer.jsx'
import { CommentThread } from './components/CommentThread.jsx'
import { renderMarkdown } from './markdown.jsx'
import StoryAvatar from '../../components/StoryAvatar.jsx'
import StoryViewer from './components/StoryViewer.jsx'
import { supabase } from '../../config/supabaseClient'
import { fetchViewedStoryIds, markStoriesViewed } from './storyViews.js'

// The Videos tab's dedicated feed: one full-height clip per view, swiped
// vertically like Reels/TikTok. Each slide carries a right-hand action rail
// (react, comment, share, gift, save -- the same actions as a PostCard, wired
// through the same cardProps the mixed feed passes down) and a bottom overlay
// with the author, caption and engagement counts.
//
// Autoplay is handled by VideoPlayer's own IntersectionObserver: a clip only
// decodes while it is on screen. Slides snap (scroll-snap) so a swipe lands
// on the next clip instead of a half-open position. Empty/loading/error
// states live in the Feed (this component only renders the clips it is given).

export default function VideoFeed({ posts, cardProps, authorName, isMobile }) {
  const {
    user, navigate, profiles, formatCount,
    likeCount, userHasLiked, toggleLike,
    commentTotal, toggleComments,
    shareCount, sharePost,
    saveCount, isSaved, toggleSave,
    giftCount, onGift,
    userHasReposted, toggleRepost,
    openComments, comments, setComments,
    editingComment, setEditingComment,
    replyingTo, setReplyingTo,
    commentDrafts, setCommentDrafts,
    myUsername, myAvatar,
    handleCommentAdded,
    toggleFollow, isFollowing,
    onOpenDetail,
  } = cardProps

  const railRefs = useRef({})

  // Keep one active clip decodable at a time (battery + scroll perf): pause
  // every video except the one currently in the viewport. VideoPlayer already
  // pauses when a video leaves the screen, so this only needs to guard the
  // brief moment two slides straddle the edge while snapping.
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef(null)
  const [storyMeta, setStoryMeta] = useState({ stories: [], viewedIds: new Set() })
  const [viewer, setViewer] = useState(null)

  useEffect(() => {
    const root = containerRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.dataset.index || 0)
            setActiveIndex(idx)
          }
        })
      },
      { root, threshold: 0.6 },
    )
    root.querySelectorAll('[data-video-slide]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [posts.length])

  useEffect(() => {
    let cancelled = false
    async function loadStoryMeta() {
      const ids = [...new Set(posts.map((p) => p.user_id).filter(Boolean))]
      if (!ids.length) { setStoryMeta({ stories: [], viewedIds: new Set() }); return }
      const { data: rows } = await supabase.from('stories').select('id, user_id, expires_at').in('user_id', ids).gt('expires_at', new Date().toISOString())
      const stories = rows || []
      let viewedIds = new Set()
      if (stories.length && user?.id) viewedIds = await fetchViewedStoryIds(supabase, stories.map((s) => s.id))
      if (!cancelled) setStoryMeta({ stories, viewedIds })
    }
    loadStoryMeta()
    return () => { cancelled = true }
  }, [posts.map((p) => p.user_id).join(','), user?.id])

  async function openStoryForUser(uid) {
    const { data } = await supabase.from('stories').select('id, title, body, image_url, bg_color, created_at, user_id, view_count, is_platform, expires_at').eq('user_id', uid).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
    const list = data || []
    if (!list.length) return
    setViewer({ stories: list, index: 0, userId: uid })
  }
  function handleViewStory(st) {
    supabase.rpc('increment_story_view', { story_id: st.id }).catch(() => {})
    if (user?.id) {
      markStoriesViewed(supabase, { storyIds: [st.id], userId: user.id }).catch(() => {})
      setStoryMeta((prev) => {
        if (prev.viewedIds.has(st.id)) return prev
        const next = new Set(prev.viewedIds); next.add(st.id); return { ...prev, viewedIds: next }
      })
    }
  }

  const slideHeight = isMobile ? 'calc(100dvh - 210px)' : 'min(70vh, 640px)'

  return (
    <div
      ref={containerRef}
      role="list"
      aria-label="Vertical video feed"
      style={{
        display: 'flex', flexDirection: 'column', gap: 14,
        scrollSnapType: isMobile ? 'y proximity' : 'y mandatory',
        overflowY: isMobile ? 'auto' : 'visible',
        maxHeight: isMobile ? '100%' : undefined,
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {posts.map((post, index) => {
        const isActive = index === activeIndex
        const followBtnVisible = user && post.user_id !== user.id
        return (
          <div
            key={post.id}
            data-video-slide
            data-index={index}
            role="listitem"
            style={{
              position: 'relative', height: slideHeight, flexShrink: 0,
              borderRadius: theme.radius.lg, overflow: 'hidden', background: '#000',
              scrollSnapAlign: 'start', scrollSnapStop: 'always',
            }}
          >
            <VideoPlayer
              src={post.video_url}
              poster={post.image_url}
              ariaLabel={`Video by ${authorName(post)}`}
              controls
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            />

            {/* Bottom gradient + author/caption overlay */}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, padding: '56px 14px 12px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))',
              color: '#fff', display: 'flex', alignItems: 'flex-end', gap: 8,
            }}>
              {!post.posted_as_type ? (
                <StoryAvatar userId={post.user_id} stories={storyMeta.stories} viewedIds={storyMeta.viewedIds} size={34} src={profiles[post.user_id]?.avatar_url} name={authorName(post)} onClick={() => openStoryForUser(post.user_id)} />
              ) : null}
              <Link to={`/u/${post.user_id}`} style={{ textDecoration: 'none', color: '#fff' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800, fontSize: 13.5 }}>
                  {authorName(post)}
                  {!post.posted_as_type && profiles[post.user_id]?.is_verified && (
                    <BadgeCheck size={14} color="#4cd9b8" style={{ flexShrink: 0 }} role="img" aria-label="Verified" />
                  )}
                </span>
              </Link>
              {followBtnVisible && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); toggleFollow(post.user_id) }}
                  aria-label={isFollowing(post.user_id) ? `Unfollow ${authorName(post)}` : `Follow ${authorName(post)}`}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#fff',
                    display: 'flex', alignItems: 'center', padding: 0,
                  }}
                >
                  {isFollowing(post.user_id)
                    ? <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '5px 10px' }}>Following</span>
                    : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 800, background: theme.tealDeep, borderRadius: 999, padding: '5px 10px' }}><Plus size={12} strokeWidth={3} aria-hidden="true" /> Follow</span>}
                </button>
              )}
            </div>

            {/* Caption */}
            {post.content && (
              <button
                type="button"
                onClick={() => onOpenDetail(post)}
                aria-label={`Read the full post by ${authorName(post)}`}
                style={{
                  position: 'absolute', left: 12, right: 72, bottom: 52,
                  textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#fff',
                  fontSize: 12.5, lineHeight: 1.45,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  fontFamily: theme.fontFamily,
                }}
                >
                  {renderMarkdown(post.content) || post.content}
                </button>
            )}

            {/* Right action rail */}
            <div style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
              color: '#fff',
            }}>
              {(() => {
                const buttons = [
                  {
                    label: userHasLiked(post.id) ? 'Unlike' : 'Like',
                    active: userHasLiked(post.id),
                    activeColor: theme.danger,
                    Icon: Heart,
                    count: likeCount(post.id),
                    onClick: () => (user ? toggleLike(post.id) : navigate('/login')),
                  },
                  {
                    label: 'Comments',
                    active: false,
                    Icon: MessageCircle,
                    count: commentTotal(post.id),
                    onClick: () => toggleComments(post.id),
                  },
                  {
                    label: 'Share',
                    active: false,
                    Icon: Share2,
                    count: shareCount(post.id),
                    onClick: () => sharePost(post),
                  },
                  {
                    label: 'Repost',
                    active: userHasReposted(post.id),
                    activeColor: theme.tealDeep,
                    Icon: Repeat2,
                    count: post.repost_count,
                    onClick: () => (user ? toggleRepost(post) : navigate('/login')),
                  },
                  {
                    label: 'Gift',
                    active: false,
                    activeColor: theme.tealDeep,
                    Icon: Gift,
                    count: giftCount(post.id),
                    onClick: () => (user ? onGift(post) : navigate('/login')),
                  },
                  {
                    label: isSaved(post.id) ? 'Remove from saved' : 'Save',
                    active: isSaved(post.id),
                    activeColor: theme.tealDeep,
                    Icon: Bookmark,
                    count: saveCount(post.id),
                    onClick: () => (user ? toggleSave(post.id) : navigate('/login')),
                  },
                ]
                return buttons.map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    onClick={b.onClick}
                    aria-pressed={b.active}
                    aria-label={b.label}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                      background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0,
                    }}
                  >
                    <span style={{
                      width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.35)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <b.Icon
                        size={20}
                        fill={b.active ? b.activeColor : 'none'}
                        color={b.active ? b.activeColor : '#fff'}
                        aria-hidden="true"
                      />
                    </span>
                    {b.count > 0 && (
                      <span style={{ fontSize: 10.5, fontWeight: 800 }}>{formatCount(b.count)}</span>
                    )}
                  </button>
                ))
              })()}
            </div>

            {post.view_count > 0 && (
              <span style={{
                position: 'absolute', top: 10, left: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.9)', background: 'rgba(0,0,0,0.35)',
                borderRadius: 999, padding: '4px 9px',
              }}>
                <Eye size={13} aria-hidden="true" /> {formatCount(post.view_count)}
              </span>
            )}

            {/* Inline comments, mirroring PostCard's thread */}
            {openComments[post.id] && (
              <div style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, top: '55%',
                background: theme.cardBg, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
                overflowY: 'auto', padding: '12px 14px',
              }}>
                <CommentThread
                  postId={post.id}
                  user={user}
                  comments={comments[post.id] || []}
                  onCommentsChange={(updated) => setComments(prev => ({ ...prev, [post.id]: updated }))}
                  editingComment={editingComment}
                  setEditingComment={setEditingComment}
                  replyingTo={replyingTo}
                  setReplyingTo={setReplyingTo}
                  commentDrafts={commentDrafts}
                  setCommentDrafts={setCommentDrafts}
                  myUsername={myUsername}
                  myAvatar={myAvatar}
                  onCommentAdded={handleCommentAdded}
                  stories={storyMeta.stories}
                  viewedIds={storyMeta.viewedIds}
                  onStoryClick={openStoryForUser}
                />
              </div>
            )}
            {viewer && (
              <StoryViewer stories={viewer.stories} index={viewer.index} onNavigate={(n) => setViewer((prev) => n === null || n < 0 || n >= prev.stories.length ? null : { ...prev, index: n })} onClose={() => setViewer(null)} onViewStory={handleViewStory} renderHeader={(s) => (
                <>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14 }}>{authorName({ user_id: viewer.userId })?.[0]?.toUpperCase() || '?'}</div>
                  <div style={{ flex: 1 }}><p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 800 }}>{authorName({ user_id: viewer.userId })}</p><p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{new Date(s.created_at).toLocaleDateString()}</p></div>
                </>
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

