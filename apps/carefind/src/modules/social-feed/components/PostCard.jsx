import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../config/supabaseClient'
import { useAuth } from '../../../providers/AuthContext'
import { notify } from '../../../services/notify.js'
import { formatCount } from '../../../modules/utils/formatters'
import { theme } from '../../../styles/theme'
import { Avatar, TealBtn, Pill } from '../../../components/ui'
import {
  Heart, MessageCircle, Share2, Bookmark, Gift, Flag, Eye, BadgeCheck,
  Pencil, Trash2, X, ChevronRight
} from 'lucide-react'

export function PostCard({ post, user, profiles, reactions, commentCount, onLike, onSave, onShare, onReport, onGift, onDelete, onEdit, isSaved, userHasLiked, likeCount, authorName, isOwnPost }) {
  const [showMenu, setShowMenu] = useState(false)
  const [showGift, setShowGift] = useState(false)
  const [isReporting, setIsReporting] = useState(false)

  const handleLike = () => onLike?.(post.id)
  const handleSave = () => user ? onSave?.(post.id) : navigate('/login')
  const handleShare = () => onShare?.(post)
  const handleGift = () => user ? (setShowGift(true), onGift?.({ postId: post.id, authorId: post.user_id })) : navigate('/login')
  const handleReport = (reason) => {
    onReport?.(post.id, reason)
    setIsReporting(false)
  }

  return (
    <div style={{ background: theme.cardBg, borderRadius: 16, boxShadow: theme.elevation[1], overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <Link to={`/u/${post.user_id}`} style={{ textDecoration: 'none' }}>
          <Avatar name={authorName(post)} src={profiles[post.user_id]?.avatar_url} size={36} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link to={`/u/${post.user_id}`} style={{ textDecoration: 'none', fontWeight: 700, color: theme.navy }}>
              {authorName(post)}
            </Link>
            {profiles[post.user_id]?.is_verified && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: theme.tealDeep }}>
                <BadgeCheck size={12} /> {profiles[post.user_id]?.specialty || ''}
              </span>
            )}
            {post.post_type && post.post_type !== 'text' && (
              <Pill color={theme[`${post.post_type === 'visual' ? 'tealDeep' : post.post_type === 'question' ? 'amber' : post.post_type === 'article' ? 'blue' : 'purple'}`]}>
                {post.post_type.charAt(0).toUpperCase() + post.post_type.slice(1)}
              </Pill>
            )}
          </div>
          <div style={{ fontSize: 12, color: theme.textLight }}>
            {new Date(post.created_at).toLocaleString()}
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowMenu(!showMenu)} aria-label="Post menu" style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', color: theme.textLight }}>
            <ChevronRight size={20} />
          </button>
          {showMenu && (
            <div style={{ position: 'absolute', right: 0, top: '100%', background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 8, boxShadow: theme.elevation[2], zIndex: 10, minWidth: 180 }}>
              {isOwnPost && (
                <>
                  <button onClick={() => onEdit?.(post)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: theme.navy }}>Edit</button>
                  <button onClick={() => onDelete?.(post.id)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: theme.alert }}>Delete</button>
                  <div style={{ borderTop: `1px solid ${theme.border}` }} />
                </>
              )}
              <button onClick={() => setIsReporting(true)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: theme.textMid }}>Report</button>
            </div>
          )}
        </div>
      </div>

      {post.image_url && (
        <img src={post.image_url} alt="" style={{ width: '100%', height: 'auto', maxHeight: 500, objectFit: 'cover' }} />
      )}

      <div style={{ padding: 12 }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: theme.navy, whiteSpace: 'pre-wrap' }}>{post.content}</p>
      </div>

      <div style={{ borderTop: `1px solid ${theme.border}`, padding: '8px 12px', display: 'flex', gap: 8 }}>
        <button onClick={handleLike} aria-pressed={userHasLiked(post.id)} aria-label={userHasLiked(post.id) ? 'Unlike' : 'Like'} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: userHasLiked(post.id) ? theme.danger : theme.gray500, padding: '6px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          <Heart size={18} fill={userHasLiked(post.id) ? theme.danger : 'none'} />
          <span>{likeCount(post.id) > 0 ? formatCount(likeCount(post.id)) : ''}</span>
        </button>

        <button onClick={() => {}} aria-label="Comments" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: theme.gray500, padding: '6px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          <MessageCircle size={18} />
          <span>{commentCount(post.id) > 0 ? formatCount(commentCount(post.id)) : 'Comment'}</span>
        </button>

        <button onClick={handleShare} aria-label="Share" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: theme.gray500, padding: '6px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          <Share2 size={18} />
          <span>Share</span>
        </button>

        <div style={{ flex: 1 }} />

        {post.view_count > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: theme.gray400, fontSize: 12 }}>
            <Eye size={14} /> {formatCount(post.view_count)}
          </span>
        )}

        <button onClick={handleGift} aria-label="Gift" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: theme.tealDeep, padding: '6px 10px', borderRadius: 8 }}>
          <Gift size={18} />
        </button>

        <button onClick={handleSave} aria-pressed={isSaved(post.id)} aria-label={isSaved(post.id) ? 'Unsave' : 'Save'} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: isSaved(post.id) ? theme.tealDeep : theme.gray500, padding: '6px 10px', borderRadius: 8 }}>
          <Bookmark size={18} fill={isSaved(post.id) ? theme.tealDeep : 'none'} />
        </button>
      </div>
    </div>
  )
}