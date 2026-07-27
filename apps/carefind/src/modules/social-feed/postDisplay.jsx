import { FileText, Gem, HelpCircle, MessageSquare, Mic, Star } from 'lucide-react'
import { theme } from '../../styles/theme'
import { previewText } from './richText.jsx'

// Shared vocabulary for showing someone's posts as a grid of tiles — used by
// both the public profile (`/u/:id`) and the owner's own profile. These were
// two divergent copies of the same code, which is how the two screens ended
// up with different type icons for the same post types.

// Reposts are stored with a leading 🔁 in `posts.content`. That's a data
// convention, not an icon, so it stays — but only these helpers know about it.
export const REPOST_MARK = '🔁'
export const isRepost = (post) => (post?.content || '').startsWith(REPOST_MARK)
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
  const KindIcon = POST_KIND_ICON[post.post_type] || MessageSquare
  const preview = previewText(withoutRepostMark(post.content))

  return (
    <button
      onClick={() => onOpen(post)}
      aria-label={`Open post: ${preview.slice(0, 60)}`}
      style={{ textAlign: 'left', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
    >
      <div style={{
        border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, overflow: 'hidden',
        background: theme.cardBg, height: 156, display: 'flex', flexDirection: 'column',
      }}>
        {post.image_url ? (
          <div style={{ height: 84, background: `url(${post.image_url}) center/cover` }} />
        ) : (
          <div style={{
            height: 84, background: theme.tealMist, color: theme.tealDeep,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <KindIcon size={26} strokeWidth={1.8} aria-hidden="true" />
          </div>
        )}
        <div style={{ padding: '9px 11px', flex: 1, overflow: 'hidden' }}>
          {post.post_type && post.post_type !== 'text' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 800,
              color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              <KindIcon size={11} aria-hidden="true" /> {post.post_type}
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
