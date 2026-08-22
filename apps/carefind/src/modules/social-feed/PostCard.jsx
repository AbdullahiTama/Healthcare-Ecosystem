import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Award, BadgeCheck, Bookmark, Building2, Check, ChevronRight, Download, Eye,
  Flag, Gift, Heart, Lock, MessageCircle, Pencil, Plus, Repeat2, Share2, Star,
  Trash2,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { renderMarkdown } from './markdown.jsx'
import VisualCard from '../../utils/VisualCard.jsx'
import VideoPlayer from '../../components/VideoPlayer.jsx'
import ArticleEditor from '../news-publishing/ArticleEditor.jsx'
import { canExportVideo } from '../../utils/voiceCard.js'
import PostMenu from './PostMenu.jsx'
import { CommentThread } from './components/CommentThread.jsx'
import { Card, Pill, TealBtn, GhostBtn } from '../../components/ui'

// One pill per post, never two. `text` posts deliberately have no pill:
// labelling the default kind adds noise without adding information. Kept here
// (moved out of Feed) because it is pure card presentation.
const POST_KIND = {
  question: 'Question',
  article: 'Article',
  visual: 'Voice',
  review: 'Review',
  video: 'Video',
}

const POST_KIND_TONE = {
  question: 'amber',
  article: 'blue',
  visual: 'teal',
  review: 'purple',
  video: 'red',
}

// The single renderer for every surface that shows a full feed post: the feed
// list (preview mode), the detail modal (full mode) and any future surface.
// Preview mode clamps the text/article body to ~5 lines and reveals "See more"
// only when the content genuinely overflows (measured after mount) — a short
// post never gets a dead button. Locked/subscriber-only posts keep their
// teaser + gate and never get a See-more.
//
// The prop surface mirrors exactly what the inline feed card in Feed.jsx
// consumed: every count helper, toggle handler and piece of comment state the
// engagement bar + inline comment thread need. The class names (cf-eng-*) and
// inline styles are byte-identical to the original card so styling is
// unchanged.
export default function PostCard({
  post,
  preview = true,
  isLocked,
  user,
  navigate,
  profiles,
  authorName,
  formatCount,
  timeAgo,
  likeCount,
  userHasLiked,
  commentTotal,
  shareCount,
  saveCount,
  giftCount,
  userHasReposted,
  isSaved,
  isFollowing,
  toggleLike,
  toggleComments,
  toggleRepost,
  toggleSave,
  toggleFollow,
  sharePost,
  shareCard,
  openReport,
  onGift,
  handleEditPost,
  handleCommentAdded,
  openComments,
  comments,
  setComments,
  editingComment,
  setEditingComment,
  replyingTo,
  setReplyingTo,
  commentDrafts,
  setCommentDrafts,
  myUsername,
  myAvatar,
  reportedPosts,
  sharingId,
  editingPost,
  setEditingPost,
  setConfirmDeleteId,
  onOpenDetail,
  // Repost support (issues #6/#8). `resolveSource(id)` returns the post a
  // repost points at, or null if it is not loaded. `isRepostBody` marks the
  // inner render of a source post inside a repost banner, so the banner is
  // drawn exactly once and a repost-of-a-repost cannot recurse.
  resolveSource,
  isRepostBody = false,
}) {
  // Every hook is declared BEFORE the repost early return below. React
  // requires an unchanging hook order per component instance, and an instance
  // can be reused across a repost/non-repost post swap (PostDetailModal
  // renders an unkeyed PostCard whose `post` changes while it stays mounted) —
  // hooks placed after the return would throw "Rendered more hooks than
  // during the previous render" in exactly that case.
  const bodyRef = useRef(null)
  const [bodyOverflow, setBodyOverflow] = useState(false)
  useEffect(() => {
    const el = bodyRef.current
    setBodyOverflow(!!el && el.scrollHeight > el.clientHeight)
  }, [post.content, post.post_type, preview])

  // ── Reposts (issues #6/#8) ────────────────────────────────────────────
  // A repost row holds no words of its own: `repost_of` names the post it
  // points at. Render the SOURCE — its author, its content, its post type —
  // under a "Reposted by" banner, the way X and every other platform does it,
  // so the reposter is never mistaken for the writer. Because the inner card
  // is the source post, every engagement handler below (like, comment, gift,
  // view) already targets the original rather than the copy.
  const repostSource = post.repost_of && resolveSource ? resolveSource(post.repost_of) : null
  if (post.repost_of && !isRepostBody) {
    const reposterName = authorName(post)
    return (
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          padding: '0 4px 6px', fontSize: 12, fontWeight: 700, color: theme.gray500,
        }}>
          <Repeat2 size={14} color={theme.gray400} aria-hidden="true" />
          <span>
            Reposted by{' '}
            <Link to={`/u/${post.user_id}`} style={{ color: theme.gray600, textDecoration: 'none', fontWeight: 800 }}>
              {reposterName}
            </Link>
          </span>
          {user && post.user_id === user.id && (
            <button
              type="button"
              onClick={() => toggleRepost(repostSource || { id: post.repost_of })}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 800, color: theme.tealDeep, cursor: 'pointer', fontFamily: theme.fontFamily }}
            >
              Undo repost
            </button>
          )}
        </div>
        {repostSource ? (
          <PostCard
            {...{
              preview, isLocked, user, navigate, profiles, authorName, formatCount, timeAgo,
              likeCount, userHasLiked, commentTotal, shareCount, saveCount, giftCount,
              userHasReposted, isSaved, isFollowing, toggleLike, toggleComments, toggleRepost,
              toggleSave, toggleFollow, sharePost, shareCard, openReport, onGift, handleEditPost,
              handleCommentAdded, openComments, comments, setComments, editingComment,
              setEditingComment, replyingTo, setReplyingTo, commentDrafts, setCommentDrafts,
              myUsername, myAvatar, reportedPosts, sharingId, editingPost, setEditingPost,
              setConfirmDeleteId, onOpenDetail, resolveSource,
            }}
            post={repostSource}
            isRepostBody
          />
        ) : (
          // The source has not been resolved (or was deleted). Show that
          // honestly rather than falling back to the repost row, which is
          // exactly how the reposter got credited as the author.
          <Card style={{ padding: theme.space[8], borderRadius: theme.radius.xl }}>
            <p style={{ margin: 0, fontSize: 13, color: theme.gray500 }}>
              This post is no longer available.
            </p>
          </Card>
        )}
      </div>
    )
  }

  const locked = isLocked ? isLocked(post) : false

  // Preview clamp: `bodyRef`/`bodyOverflow` are declared with the other hooks
  // at the top of the component. The clamp div is rendered only in preview
  // mode, so the ref stays null in the detail modal and See-more never
  // appears there.
  const clampStyle = {
    display: '-webkit-box',
    WebkitLineClamp: 5,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }

  return (
    <Card style={{ padding: post.post_type === 'visual' || post.post_type === 'video' ? 0 : theme.space[8], overflow: 'hidden', borderRadius: theme.radius.xl }}>
      {/* Card header: identity left, one kind pill + overflow menu right.
          Identity reads name → verified badge → handle → credential →
          time, i.e. "who is this, and can I trust them" before anything
          else (Design Principle 12: trust is a design output). */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 11,
        padding: post.post_type === 'visual' || post.post_type === 'video' ? '14px 16px 0 16px' : 0,
        marginBottom: post.post_type === 'visual' || post.post_type === 'video' ? 0 : 10,
      }}>
        <Link
          to={`/u/${post.user_id}`}
          aria-label={`${authorName(post)}'s profile`}
          style={{ position: 'relative', flexShrink: 0, textDecoration: 'none', display: 'block' }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 42, height: 42, borderRadius: post.posted_as_type ? theme.radius.md : '50%',
              background: post.posted_as_type
                ? theme.navy
                : (profiles[post.user_id]?.avatar_url
                    ? `url(${profiles[post.user_id].avatar_url}) center/cover`
                    : theme.tealDeep),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 15, fontWeight: 800,
            }}
          >
            {post.posted_as_type
              ? (post.posted_as_type === 'staff' ? <Award size={19} /> : <Building2 size={19} />)
              : (!profiles[post.user_id]?.avatar_url &&
                  (profiles[post.user_id]?.full_name?.[0] || profiles[post.user_id]?.display_name?.[0] || '?').toUpperCase())}
          </div>

          {/* Follow badge sitting on the avatar (TikTok-style) */}
          {user && post.user_id !== user.id && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFollow(post.user_id) }}
              aria-label={isFollowing(post.user_id) ? `Unfollow ${authorName(post)}` : `Follow ${authorName(post)}`}
              style={{
                position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
                width: 21, height: 21, borderRadius: '50%', padding: 0, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                background: isFollowing(post.user_id) ? '#fff' : theme.tealDeep,
                border: isFollowing(post.user_id) ? `2px solid ${theme.tealDeep}` : '2px solid #fff',
                color: isFollowing(post.user_id) ? theme.tealDeep : '#fff',
                boxShadow: isFollowing(post.user_id) ? 'none' : theme.elevation[2],
              }}
            >
              {isFollowing(post.user_id) ? <Check size={12} strokeWidth={3} /> : <Plus size={13} strokeWidth={3} />}
            </button>
          )}
        </Link>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <Link to={`/u/${post.user_id}`} style={{ textDecoration: 'none' }}>
              <span style={{ fontSize: 14.5, fontWeight: 800, color: theme.navy }}>{authorName(post)}</span>
            </Link>
            {!post.posted_as_type && profiles[post.user_id]?.is_verified && (
              <BadgeCheck size={15} color={theme.tealDeep} style={{ flexShrink: 0 }} role="img" aria-label="Verified" />
            )}
            {!post.posted_as_type && profiles[post.user_id]?.display_name && (
              <span style={{ fontSize: 12.5, color: theme.gray400, fontWeight: 600 }}>
                @{profiles[post.user_id].display_name}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
            {post.posted_as_type ? (
              <span style={{ fontSize: 11.5, color: theme.tealDeep, fontWeight: 700 }}>
                {post.posted_as_type === 'staff' && post.posted_as_title ? post.posted_as_title : 'Business'}
                {' · posted by '}
                {profiles[post.user_id]?.full_name || profiles[post.user_id]?.display_name || 'team member'}
              </span>
            ) : (
              profiles[post.user_id]?.is_verified && (profiles[post.user_id]?.specialty || profiles[post.user_id]?.verification_label) && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700,
                  color: theme.tealDeep, background: theme.tealMist,
                  padding: '2px 8px', borderRadius: theme.radius.full,
                }}>
                  <BadgeCheck size={12} aria-hidden="true" /> {profiles[post.user_id]?.specialty || profiles[post.user_id]?.verification_label}
                </span>
              )
            )}
            <span style={{ fontSize: 11.5, color: theme.gray400, fontWeight: 600 }}>
              <time dateTime={post.created_at}>{timeAgo(post.created_at)}</time>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {POST_KIND[post.post_type] && <Pill label={POST_KIND[post.post_type]} type={POST_KIND_TONE[post.post_type]} />}
          <PostMenu
            label={`Options for ${authorName(post)}'s post`}
            items={user && post.user_id === user.id
              ? [
                  { key: 'edit', label: 'Edit post', Icon: Pencil, onSelect: () => setEditingPost({ id: post.id, content: post.content }) },
                  { key: 'delete', label: 'Delete post', Icon: Trash2, danger: true, onSelect: () => setConfirmDeleteId(post.id) },
                ]
              : [
                  { key: 'save', label: isSaved(post.id) ? 'Remove from saved' : 'Save post', Icon: Bookmark, onSelect: () => (user ? toggleSave(post.id) : navigate('/login')) },
                  { key: 'report', label: reportedPosts.includes(post.id) ? 'Reported' : 'Report post', Icon: Flag, danger: true, onSelect: () => openReport(post.id) },
                ]}
          />
        </div>
      </div>

      {/* Edit post mode */}
      {editingPost?.id === post.id && (
        <div style={{ margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Issue #4: an article's content is a JSON array of blocks. Editing
              it through a plain 3-row textarea showed the author raw JSON, and
              saving whatever they typed collapsed the whole article into one
              text block — every later block, and every drawing, gone. Article
              posts get the real block editor; everything else keeps the plain
              textarea, which is correct for them. */}
          {post.post_type === 'article' || post.post_type === 'premium' ? (
            <div style={{ border: `1px solid ${theme.tealDeep}`, borderRadius: theme.radius.md, padding: 10 }}>
              <ArticleEditor
                value={editingPost.content}
                onChange={(val) => setEditingPost((prev) => (prev ? { ...prev, content: val } : prev))}
              />
            </div>
          ) : (
            <textarea
              value={editingPost.content}
              onChange={(e) => setEditingPost({ ...editingPost, content: e.target.value })}
              rows={3}
              aria-label="Edit post"
              style={{ width: '100%', padding: 10, fontSize: 14, border: `1px solid ${theme.tealDeep}`, borderRadius: theme.radius.md, fontFamily: 'inherit' }}
            />
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <TealBtn onClick={() => handleEditPost(post.id, editingPost.content, post.post_type)} style={{ flex: 1 }}>Save</TealBtn>
            <GhostBtn onClick={() => setEditingPost(null)} style={{ flex: 1 }}>Cancel</GhostBtn>
          </div>
        </div>
      )}

      {locked ? (
        <div style={{ margin: '8px 0 10px 0' }}>
          {/* Teaser: the opening of the post, fading into nothing. Rendered
              through the same markdown renderer as open posts so formatting
              shows instead of literal ** asterisks. */}
          <div style={{ position: 'relative', maxHeight: 110, overflow: 'hidden' }}>
            <div style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, color: theme.textMid, lineHeight: 1.5 }}>
              {renderMarkdown(String(post.content || '').slice(0, 220))}
            </div>
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
            <p style={{ margin: '0 0 6px 0', display: 'flex', justifyContent: 'center', color: theme.tealDeep }}><Lock size={22} aria-hidden="true" /></p>
            <p style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>
              Subscriber-only content
            </p>
            <p style={{ margin: '0 0 12px 0', fontSize: 12.5, color: theme.textLight }}>
              Subscribe to {profiles[post.user_id]?.full_name || profiles[post.user_id]?.display_name || 'this creator'} to read the rest.
            </p>
            <Link
              to={`/u/${post.user_id}`}
              style={{
                display: 'inline-block', padding: '10px 22px', background: theme.tealDeep,
                color: '#fff', borderRadius: theme.radius.md, fontWeight: 800, fontSize: 13, textDecoration: 'none',
              }}
            >
              Subscribe to read
            </Link>
          </div>
        </div>
      ) : post.post_type === 'video' ? (
        <div>
          <div style={{ borderRadius: theme.radius.md, overflow: 'hidden' }}>
            <VideoPlayer
              src={post.video_url}
              poster={post.image_url}
              ariaLabel={`Video by ${authorName(post)}`}
              style={{ aspectRatio: '9/16', maxHeight: 460 }}
            />
          </div>
          {post.content && (
            <div style={{ margin: '10px 16px 0' }}>
              <p style={{ margin: 0, fontSize: 14, color: theme.textMid, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {renderMarkdown(post.content)}
              </p>
            </div>
          )}
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
              borderRadius: theme.radius.md, fontWeight: 800, fontSize: 12.5, cursor: 'pointer',
            }}
          >
            {sharingId === post.id
              ? 'Preparing…'
              : post.audio_url && canExportVideo()
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Download size={15} aria-hidden="true" /> Download with voice · share to status</span>
                : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Download size={15} aria-hidden="true" /> Download card · share to status</span>}
          </button>
        </div>
      ) : (
        <>
          {post.post_type === 'review' && post.rating && (
            <p style={{ margin: '8px 0 6px 0', display: 'flex', gap: 1 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} size={15} color={theme.starAmber} fill={n <= post.rating ? theme.starAmber : 'none'} aria-hidden="true" />
              ))}
            </p>
          )}
          {post.post_type === 'article' || post.post_type === 'premium' ? (
            <div style={{ margin: '10px 0 12px 0' }}>
              {preview ? (
                <div ref={bodyRef} style={clampStyle}>
                  <ArticleEditor value={post.content} readOnly />
                </div>
              ) : (
                <ArticleEditor value={post.content} readOnly />
              )}
            </div>
          ) : (
            <div style={{ margin: '8px 0 10px 0', fontSize: 14, color: theme.textMid, lineHeight: 1.5 }}>
              {preview ? (
                <div ref={bodyRef} style={clampStyle}>
                  {renderMarkdown(post.content)}
                </div>
              ) : (
                renderMarkdown(post.content)
              )}
            </div>
          )}

          {preview && bodyOverflow && (
            <button
              type="button"
              onClick={() => onOpenDetail && onOpenDetail(post)}
              aria-label={`Read the full post by ${authorName(post)}`}
              style={{
                background: 'none', border: 'none', padding: 0, margin: '0 0 10px 0',
                color: theme.tealDeep, fontWeight: 800, fontSize: 13, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: theme.fontFamily,
              }}
            >
              See more <ChevronRight size={14} style={{ transform: 'rotate(90deg)' }} aria-hidden="true" />
            </button>
          )}

          {post.image_url && post.post_type !== 'visual' && (
            <img src={post.image_url} alt="post" style={{ width: '100%', borderRadius: theme.radius.md, marginBottom: 8 }} />
          )}
        </>
      )}
      {/* Engagement bar. Reading actions (react, reply, pass on) group
          left; keeping and supporting group right: the same left/right
          split on every card, so the target a user reaches for never
          moves. Views are a read-only fact, so they're text, not a
          button that does nothing when pressed. The icons were
          hand-drawn SVG copies of lucide glyphs with hardcoded colours
          and no labels; the row's CSS lives in global.css. */}
      <div className="cf-eng-row" style={{
        borderTop: `1px solid ${theme.border}`, marginTop: 10, paddingTop: 4,
        marginLeft: post.post_type === 'visual' || post.post_type === 'video' ? 16 : 0,
        marginRight: post.post_type === 'visual' || post.post_type === 'video' ? 16 : 0,
        marginBottom: post.post_type === 'visual' || post.post_type === 'video' ? 16 : 0,
      }}>
        <div className="cf-eng-group">
          {/* Like */}
          <button
            className="cf-eng-item"
            onClick={() => (user ? toggleLike(post.id) : navigate('/login'))}
            aria-pressed={userHasLiked(post.id)}
            aria-label={userHasLiked(post.id) ? 'Unlike this post' : 'Like this post'}
            style={{ color: userHasLiked(post.id) ? theme.danger : theme.gray500 }}
          >
            <Heart size={18} aria-hidden="true" fill={userHasLiked(post.id) ? theme.danger : 'none'} />
            {likeCount(post.id) > 0 && (
              <span>{formatCount(likeCount(post.id))} {likeCount(post.id) === 1 ? 'like' : 'likes'}</span>
            )}
          </button>

          {/* Comment */}
          <button
            className="cf-eng-item"
            onClick={() => toggleComments(post.id)}
            aria-expanded={!!openComments[post.id]}
            aria-label={`Comments on ${authorName(post)}'s post`}
            style={{ color: theme.gray500 }}
          >
            <MessageCircle size={18} aria-hidden="true" />
            <span>{commentTotal(post.id) > 0 ? formatCount(commentTotal(post.id)) : 'Comment'}</span>
          </button>

          {/* Share */}
          <button className="cf-eng-item" onClick={() => sharePost(post)} aria-label="Share this post" style={{ color: theme.gray500 }}>
            <Share2 size={18} aria-hidden="true" />
            <span>{shareCount(post.id) > 0 ? formatCount(shareCount(post.id)) : 'Share'}</span>
          </button>

          {/* Repost: hidden on reposts themselves — a repost of a
              repost would fan out the same content twice. */}
          {!post.repost_of && (
            <button
              className="cf-eng-item"
              onClick={() => (user ? toggleRepost(post) : navigate('/login'))}
              aria-pressed={userHasReposted(post.id)}
              aria-label={userHasReposted(post.id) ? 'Undo repost' : 'Repost this post'}
              style={{ color: userHasReposted(post.id) ? theme.tealDeep : theme.gray500 }}
            >
              <Repeat2 size={18} aria-hidden="true" />
              {post.repost_count > 0 && (
                <span>{formatCount(post.repost_count)} {post.repost_count === 1 ? 'repost' : 'reposts'}</span>
              )}
            </button>
          )}
        </div>

        <div className="cf-eng-group">
          {post.view_count > 0 && (
            <span className="cf-eng-meta" style={{ color: theme.gray400 }}>
              <Eye size={15} aria-hidden="true" /> {formatCount(post.view_count)}
            </span>
          )}

          {/* Gift */}
          <button
            className="cf-eng-item"
            aria-label={`Send a gift to ${authorName(post)}`}
            onClick={() => (user ? onGift(post) : navigate('/login'))}
            style={{ color: theme.tealDeep }}
          >
            <Gift size={18} aria-hidden="true" />
            {giftCount(post.id) > 0 && (
              <span>{formatCount(giftCount(post.id))}</span>
            )}
          </button>

          {/* Save */}
          <button
            className="cf-eng-item"
            onClick={() => (user ? toggleSave(post.id) : navigate('/login'))}
            aria-pressed={isSaved(post.id)}
            aria-label={isSaved(post.id) ? 'Remove from saved' : 'Save this post'}
            style={{ color: isSaved(post.id) ? theme.tealDeep : theme.gray500 }}
          >
            <Bookmark size={18} aria-hidden="true" fill={isSaved(post.id) ? theme.tealDeep : 'none'} />
            {saveCount(post.id) > 0 && (
              <span>{formatCount(saveCount(post.id))}</span>
            )}
          </button>
        </div>
      </div>

      {openComments[post.id] && (
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
        />
      )}
    </Card>
  )
}