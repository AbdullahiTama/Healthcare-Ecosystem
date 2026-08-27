import { useNavigate } from 'react-router-dom'
import { FileText, Gem, HelpCircle, MessageSquare, Mic, Repeat2, Star } from 'lucide-react'
import { theme } from '../../styles/theme'
import { previewText, stripMarkdown } from './richText.jsx'

// Shared vocabulary for showing someone's posts as a grid of tiles — used by
// both the public profile (`/u/:id`) and the owner's own profile. These were
// two divergent copies of the same code, which is how the two screens ended
// up with different type icons for the same post types.

// Reposts. `repost_of` is the real signal — a repost row references the post
// it points at and carries no words of its own (see reposts.js and issues
// #6/#8). The leading 🔁 in `posts.content` is the older convention, kept here
// so a row written before the reference model is still recognised. Profile
// queries MUST select `repost_of`: a query that omits it silently reclassifies
// every reference repost as an ordinary post, which is how reposts stopped
// appearing on the reposter's profile.
export const REPOST_MARK = '🔁'
export const isRepost = (post) => !!post?.repost_of || (post?.content || '').startsWith(REPOST_MARK)
export const withoutRepostMark = (content) => (content || '').replace(/^🔁\s*/, '')

// Post-kind icons, matching the feed composer's post-type vocabulary
// (SCREEN_PATTERNS.md 36).
export const POST_KIND_ICON = {
  question: HelpCircle,
  review: Star,
  article: FileText,
  premium: Gem,
  visual: Mic,
}

// One tile in a profile's post grid: image if there is one, otherwise a mist
// tile carrying the post-kind icon; kind label and a three-line preview below.
export function PostTile({ post, onOpen }) {
  const navigate = useNavigate()
  // A repost has no content of its own: show the SOURCE it points at, so the
  // reposter's grid shows what they actually shared rather than a bare 🔁
  // (issue #6). `post.source` is attached by the profile loader.
  const reposted = isRepost(post)
  const shown = (reposted && post.source) || post
  const KindIcon = POST_KIND_ICON[shown.post_type] || MessageSquare
  // Markdown syntax stripped first so tiles read "bold text", never "**bold**".
  const preview = previewText(stripMarkdown(withoutRepostMark(shown.content)))

  return (
    <button
      onClick={() => navigate(`/post/${shown.id}`)}
      aria-label={`Open ${reposted ? 'repost' : 'post'}: ${preview.slice(0, 60)}`}
      style={{ textAlign: 'left', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
    >
      <div style={{
        border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, overflow: 'hidden',
        background: theme.cardBg, height: 156, display: 'flex', flexDirection: 'column',
      }}>
        {shown.image_url ? (
          <div style={{ height: 84, background: `url(${shown.image_url}) center/cover` }} />
        ) : (
          <div style={{
            height: 84, background: theme.tealMist, color: theme.tealDeep,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <KindIcon size={26} strokeWidth={1.8} aria-hidden="true" />
          </div>
        )}
        <div style={{ padding: '9px 11px', flex: 1, overflow: 'hidden' }}>
          {/* A repost is labelled as one, never presented as the profile
              owner's own writing (issue #8). */}
          {reposted && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 800,
              color: theme.gray500, textTransform: 'uppercase', letterSpacing: '0.04em',
              marginRight: 6,
            }}>
              <Repeat2 size={11} aria-hidden="true" /> Repost
            </span>
          )}
          {shown.post_type && shown.post_type !== 'text' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 800,
              color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              <KindIcon size={11} aria-hidden="true" /> {shown.post_type}
            </span>
          )}
          <p style={{
            margin: '3px 0 0 0', fontSize: 11.5, color: theme.navy, lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {preview}
          </p>
        </div>
      </div>
    </button>
  )
}

// The grid the tiles sit in — two columns on a phone, as many as fit above it.
export function PostTileGrid({ posts, onOpen, isMobile }) {
  return (
    <div style={isMobile
      ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }
      : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
      {posts.map((post) => <PostTile key={post.id} post={post} onOpen={onOpen} />)}
    </div>
  )
}

// Issue #7 — every image a post carries, in order. image_urls is the
// canonical multi-image list; the legacy single image_url is the fallback
// so posts written before the column exist keep rendering.
export function imagesOf(post) {
  if (!post) return []
  const list = Array.isArray(post.image_urls)
    ? post.image_urls.filter((u) => typeof u === 'string' && u)
    : []
  if (list.length) return list
  return post.image_url ? [post.image_url] : []
}
