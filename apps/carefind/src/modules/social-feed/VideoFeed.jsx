import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BadgeCheck, Bookmark, Eye, Gift, Heart, MessageCircle, Music, Plus, Repeat2, Share2,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import VideoPlayer from '../../components/VideoPlayer.jsx'
import { CommentThread } from './components/CommentThread.jsx'
import { renderMarkdown } from './markdown.jsx'
import StoryAvatar from '../../components/StoryAvatar.jsx'
import StoryViewer from './components/StoryViewer.jsx'
import { supabase } from '../../config/supabaseClient'
import { fetchViewedStoryIds, markStoriesViewed } from './storyViews.js'

// TikTok-style vertical video feed: full-bleed, one clip per view, swiped
// vertically. Each slide has a right-hand engagement rail (Like, Comment,
// Share, Repost, Gift, Save) and a bottom overlay with author + caption.
// The BottomNav overlays the feed on mobile — no space is reserved.

export default function VideoFeed({ posts, cardProps, authorName, isMobile, focusPostId }) {
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

  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef(null)
  const [storyMeta, setStoryMeta] = useState({ stories: [], viewedIds: new Set() })
  const [viewer, setViewer] = useState(null)
  const [captionExpanded, setCaptionExpanded] = useState({})

  // Scroll to the focused video when deep-linked from the main feed
  useEffect(() => {
    if (!focusPostId || !containerRef.current) return
    const idx = posts.findIndex((p) => p.id === focusPostId)
    if (idx < 0) return
    const slide = containerRef.current.querySelector(`[data-index="${idx}"]`)
    if (slide) {
      slide.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveIndex(idx)
    }
  }, [focusPostId, posts.length])

  // IntersectionObserver: track which slide is active for autoplay + unmute
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

  // Load story metadata for author avatars
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

  return (
    <div
      ref={containerRef}
      role="list"
      aria-label="Vertical video feed"
      style={{
        display: 'flex', flexDirection: 'column',
        scrollSnapType: isMobile ? 'y mandatory' : 'y mandatory',
        overflowY: isMobile ? 'auto' : 'visible',
        maxHeight: isMobile ? '100%' : undefined,
        WebkitOverflowScrolling: 'touch',
        gap: 0,
      }}
    >
      <style>{`
        .vf-slide { scroll-snap-align: start; scroll-snap-stop: always; }
        .vf-rail-btn { transition: transform 0.15s ease; }
        .vf-rail-btn:active { transform: scale(0.85); }
        .vf-caption { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
        .vf-caption.expanded { -webkit-line-clamp: unset !important; }
      `}</style>
      {posts.map((post, index) => {
        const isActive = index === activeIndex
        const followBtnVisible = user && post.user_id !== user.id
        const isExpanded = captionExpanded[post.id]
        const hasCaption = post.content && renderMarkdown(post.content)
        return (
          <div
            key={post.id}
            data-video-slide
            data-index={index}
            role="listitem"
            className="vf-slide"
            style={{
              position: 'relative',
              height: isMobile ? '100dvh' : 'min(80vh, 720px)',
              flexShrink: 0,
              overflow: 'hidden',
              background: '#000',
            }}
          >
            {/* Video — full bleed, centered object-fit */}
            <VideoPlayer
              src={post.video_url}
              poster={post.image_url}
              ariaLabel={`Video by ${authorName(post)}`}
              controls={false}
              autoUnmute={isActive}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />

            {/* Tap to play/pause (invisible overlay) */}
            {!isMobile && (
              <button
                type="button"
                aria-label="Play or pause video"
                onClick={() => {
                  const v = document.querySelector(`[data-index="${index}"] video`)
                  if (v) { if (v.paused) v.play().catch(() => {}); else v.pause() }
                }}
                style={{ position: 'absolute', inset: 0, background: 'none', border: 'none', cursor: 'pointer', zIndex: 1 }}
              />
            )}

            {/* Bottom gradient overlay */}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              height: '45%',
              background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)',
              pointerEvents: 'none',
            }} />

            {/* Author info + caption — bottom left */}
            <div style={{
              position: 'absolute', left: 12, right: 72, bottom: isMobile ? 80 : 24,
              color: '#fff', pointerEvents: 'auto',
            }}>
              {/* Author row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {!post.posted_as_type ? (
                  <Link to={`/u/${post.user_id}`} style={{ textDecoration: 'none', flexShrink: 0 }}>
                    <StoryAvatar
                      userId={post.user_id}
                      stories={storyMeta.stories}
                      viewedIds={storyMeta.viewedIds}
                      size={38}
                      src={profiles[post.user_id]?.avatar_url}
                      name={authorName(post)}
                      onClick={(e) => { e?.stopPropagation?.(); openStoryForUser(post.user_id) }}
                    />
                  </Link>
                ) : null}
                <Link to={`/u/${post.user_id}`} style={{ textDecoration: 'none', color: '#fff', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800, fontSize: 14 }}>
                    {authorName(post)}
                    {!post.posted_as_type && profiles[post.user_id]?.is_verified && (
                      <BadgeCheck size={14} color="#4cd9b8" style={{ flexShrink: 0 }} role="img" aria-label="Verified" />
                    )}
                  </div>
                </Link>
                {followBtnVisible && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFollow(post.user_id) }}
                    aria-label={isFollowing(post.user_id) ? `Unfollow ${authorName(post)}` : `Follow ${authorName(post)}`}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', color: '#fff',
                      display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0,
                    }}
                  >
                    {isFollowing(post.user_id)
                      ? <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '5px 10px' }}>Following</span>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 800, background: theme.tealDeep, borderRadius: 999, padding: '5px 10px' }}><Plus size={12} strokeWidth={3} aria-hidden="true" /> Follow</span>}
                  </button>
                )}
              </div>

              {/* Caption — expandable */}
              {hasCaption && (
                <button
                  type="button"
                  onClick={() => setCaptionExpanded(prev => ({ ...prev, [post.id]: !prev[post.id] }))}
                  className={`vf-caption ${isExpanded ? 'expanded' : ''}`}
                  aria-label={isExpanded ? 'Collapse caption' : 'Expand caption'}
                  style={{
                    display: 'block', textAlign: 'left', background: 'none', border: 'none',
                    padding: 0, cursor: 'pointer', color: '#fff',
                    fontSize: 13, lineHeight: 1.5, maxWidth: '100%',
                    WebkitLineClamp: isExpanded ? 'unset' : 2,
                    fontFamily: theme.fontFamily, width: '100%',
                  }}
                >
                  {renderMarkdown(post.content) || post.content}
                </button>
              )}

              {/* Music / source tag */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
                <Music size={12} aria-hidden="true" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                  {authorName(post)}
                </span>
              </div>
            </div>

            {/* Right engagement rail — TikTok-style */}
            <div style={{
              position: 'absolute', right: 8, bottom: isMobile ? 140 : 100,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
              color: '#fff', pointerEvents: 'auto',
            }}>
              {/* Profile picture (tappable → profile) */}
              {!post.posted_as_type && (
                <Link
                  to={`/u/${post.user_id}`}
                  style={{ position: 'relative', marginBottom: 4, textDecoration: 'none' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%', border: '2px solid #fff',
                    overflow: 'hidden', background: theme.gray200,
                  }}>
                    {profiles[post.user_id]?.avatar_url
                      ? <img src={profiles[post.user_id].avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.tealDeep, color: '#fff', fontWeight: 800, fontSize: 16 }}>{authorName(post)?.[0]?.toUpperCase() || '?'}</div>}
                  </div>
                  {!isFollowing(post.user_id) && user && post.user_id !== user.id && (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFollow(post.user_id) }}
                      aria-label={`Follow ${authorName(post)}`}
                      style={{
                        position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
                        width: 20, height: 20, borderRadius: '50%', background: theme.tealDeep,
                        border: '2px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', color: '#fff', padding: 0,
                      }}
                    >
                      <Plus size={11} strokeWidth={3} aria-hidden="true" />
                    </button>
                  )}
                </Link>
              )}

              {/* Like */}
              <button
                type="button"
                className="vf-rail-btn"
                onClick={() => user ? toggleLike(post.id) : navigate('/login')}
                aria-pressed={userHasLiked(post.id)}
                aria-label={userHasLiked(post.id) ? 'Unlike' : 'Like'}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}
              >
                <span style={{
                  width: 42, height: 42, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Heart size={26} fill={userHasLiked(post.id) ? theme.danger : 'none'} color={userHasLiked(post.id) ? theme.danger : '#fff'} aria-hidden="true" />
                </span>
                {likeCount(post.id) > 0 && <span style={{ fontSize: 11, fontWeight: 700 }}>{formatCount(likeCount(post.id))}</span>}
              </button>

              {/* Comment */}
              <button
                type="button"
                className="vf-rail-btn"
                onClick={() => toggleComments(post.id)}
                aria-label="Comments"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}
              >
                <span style={{
                  width: 42, height: 42, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <MessageCircle size={26} aria-hidden="true" />
                </span>
                {commentTotal(post.id) > 0 && <span style={{ fontSize: 11, fontWeight: 700 }}>{formatCount(commentTotal(post.id))}</span>}
              </button>

              {/* Share */}
              <button
                type="button"
                className="vf-rail-btn"
                onClick={() => sharePost(post)}
                aria-label="Share"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}
              >
                <span style={{
                  width: 42, height: 42, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Share2 size={24} aria-hidden="true" />
                </span>
                {shareCount(post.id) > 0 && <span style={{ fontSize: 11, fontWeight: 700 }}>{formatCount(shareCount(post.id))}</span>}
              </button>

              {/* Repost */}
              <button
                type="button"
                className="vf-rail-btn"
                onClick={() => user ? toggleRepost(post) : navigate('/login')}
                aria-label="Repost"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}
              >
                <span style={{
                  width: 42, height: 42, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Repeat2 size={24} fill={userHasReposted(post.id) ? theme.tealDeep : 'none'} color={userHasReposted(post.id) ? theme.tealDeep : '#fff'} aria-hidden="true" />
                </span>
                {post.repost_count > 0 && <span style={{ fontSize: 11, fontWeight: 700 }}>{formatCount(post.repost_count)}</span>}
              </button>

              {/* Gift */}
              <button
                type="button"
                className="vf-rail-btn"
                onClick={() => user ? onGift(post) : navigate('/login')}
                aria-label="Gift"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}
              >
                <span style={{
                  width: 42, height: 42, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Gift size={24} aria-hidden="true" />
                </span>
                {giftCount(post.id) > 0 && <span style={{ fontSize: 11, fontWeight: 700 }}>{formatCount(giftCount(post.id))}</span>}
              </button>

              {/* Save */}
              <button
                type="button"
                className="vf-rail-btn"
                onClick={() => user ? toggleSave(post.id) : navigate('/login')}
                aria-pressed={isSaved(post.id)}
                aria-label={isSaved(post.id) ? 'Remove from saved' : 'Save'}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}
              >
                <span style={{
                  width: 42, height: 42, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Bookmark size={24} fill={isSaved(post.id) ? theme.tealDeep : 'none'} color={isSaved(post.id) ? theme.tealDeep : '#fff'} aria-hidden="true" />
                </span>
                {saveCount(post.id) > 0 && <span style={{ fontSize: 11, fontWeight: 700 }}>{formatCount(saveCount(post.id))}</span>}
              </button>
            </div>

            {/* View count — top left */}
            {post.view_count > 0 && (
              <span style={{
                position: 'absolute', top: 12, left: 12,
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 12, fontWeight: 700, color: '#fff',
                background: 'rgba(0,0,0,0.45)', borderRadius: 999,
                padding: '4px 10px', backdropFilter: 'blur(4px)',
              }}>
                <Eye size={13} aria-hidden="true" /> {formatCount(post.view_count)}
              </span>
            )}

            {/* Inline comments panel */}
            {openComments[post.id] && (
              <div style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, top: '55%',
                background: theme.cardBg, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
                overflowY: 'auto', padding: '12px 14px', zIndex: 10,
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

            {/* Story viewer */}
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
