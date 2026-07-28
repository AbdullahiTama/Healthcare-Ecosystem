import { useState, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../../config/supabaseClient'
import { useAuth } from '../../../providers/AuthContext'
import { notify } from '../../../services/notify.js'
import { getActiveIdentity } from '../../../lib/activeIdentity'
import { theme } from '../../../styles/theme'
import { Camera, X, Mic, HelpCircle, FileText, BookOpen, Star, Image as ImageIcon, Pen } from 'lucide-react'
import { Avatar, TealBtn, GhostBtn, Pill } from '../../../components/ui'
import { useToast } from '../../../components/ui'

const POST_TYPES = [
  { key: 'text', icon: Pen, label: 'Post' },
  { key: 'visual', icon: ImageIcon, label: 'Voice Card' },
  { key: 'question', icon: HelpCircle, label: 'Question' },
  { key: 'review', icon: Star, label: 'Review' },
  { key: 'article', icon: FileText, label: 'Article' },
]

const THEME_LABELS = {
  'teal-depth': { icon: '🌊', label: 'Ocean' },
  'navy-clinical': { icon: '✨', label: 'Sky' },
  'midnight-teal': { icon: '🌙', label: 'Night' },
  'forest-wellness': { icon: '🌲', label: 'Forest' },
  'slate-pulse': { icon: '💓', label: 'Pulse' },
}
const THEME_KEYS = Object.keys(THEME_LABELS)

export function PostComposer({ onClose, onPosted, myUsername, myAvatar }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [content, setContent] = useState('')
  const [postType, setPostType] = useState('text')
  const [visualTheme, setVisualTheme] = useState('teal-depth')
  const [postRating, setPostRating] = useState(5)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [posting, setPosting] = useState(false)
  const composerRef = useRef(null)

  const handleImageSelect = useCallback((file) => {
    if (!file.type.startsWith('image/')) {
      toast.show('Please select an image', { type: 'warning' })
      return
    }
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }, [toast])

  const removeImage = useCallback(() => {
    setImageFile(null)
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(null)
  }, [imagePreview])

  const createPost = useCallback(async () => {
    if (!user) return
    if (!content.trim() && postType === 'text') {
      toast.show('Write something first', { type: 'warning' })
      return
    }
    if (postType === 'visual' && !imageFile) {
      toast.show('Add an image for Voice Card posts', { type: 'warning' })
      return
    }

    setPosting(true)
    try {
      const activeIdentity = getActiveIdentity()

      const postData = {
        user_id: user.id,
        content: content.trim(),
        post_type: postType,
        theme: visualTheme,
        ...(postType === 'visual' && imageFile ? { image_url: imagePreview } : {}),
        ...(postType === 'review' ? { rating: postRating } : {}),
        ...(activeIdentity?.type === 'business' ? { posting_as_business_id: activeIdentity.id } : {}),
        ...(activeIdentity?.type === 'staff' ? { posted_as_type: 'staff', posted_as_id: activeIdentity.staffId, posted_as_name: activeIdentity.fullName, posted_as_title: activeIdentity.publicTitle } : {}),
      }

      const { data, error } = await supabase
        .from('posts')
        .insert(postData)
        .select()
        .single()

      if (error) throw error

      setContent('')
      setPostType('text')
      setVisualTheme('teal-depth')
      setPostRating(5)
      removeImage()
      toast.show('Post created!', { type: 'success' })
      onPosted?.(data)
      onClose?.()
    } catch (e) {
      console.error('Create post error:', e)
      toast.show('Failed to create post', { type: 'error' })
    } finally {
      setPosting(false)
    }
  }, [user, content, postType, visualTheme, postRating, imageFile, imagePreview, toast, onClose, onPosted, removeImage])

  return (
    <div style={{ background: theme.cardBg, borderRadius: 16, boxShadow: theme.elevation[1], padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <Avatar name={myUsername || user?.email} src={myAvatar} size={40} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {POST_TYPES.map(type => (
              <button
                key={type.key}
                onClick={() => setPostType(type.key)}
                style={{
                  padding: '8px 12px',
                  border: `1px solid ${postType === type.key ? theme.tealDeep : theme.border}`,
                  borderRadius: 8,
                  background: postType === type.key ? `${theme.tealDeep}10` : '#fff',
                  color: postType === type.key ? theme.tealDeep : theme.textMid,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <type.icon size={14} />
                <span>{type.label}</span>
              </button>
            ))}
          </div>

          {postType === 'visual' && (
            <div style={{ marginBottom: 12 }}>
              {imagePreview ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', borderRadius: 12, maxHeight: 300 }} />
                  <button onClick={removeImage} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label style={{ display: 'block', border: `2px dashed ${theme.border}`, borderRadius: 12, padding: 24, textAlign: 'center', cursor: 'pointer', color: theme.textLight }}>
                  <input type="file" accept="image/*" onChange={e => e.target.files[0] && handleImageSelect(e.target.files[0])} style={{ display: 'none' }} />
                  <Camera size={24} style={{ margin: '0 auto 8px', color: theme.textLight }} />
                  <div>Click or drag to add image</div>
                </label>
              )}
            </div>
          )}

          {postType === 'review' && (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: theme.textMid }}>Rating:</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    onClick={() => setPostRating(star)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, color: star <= postRating ? '#F59E0B' : theme.gray300 }}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          )}

          {postType === 'visual' && (
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {THEME_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => setVisualTheme(key)}
                  style={{
                    padding: '6px 12px',
                    border: `2px solid ${visualTheme === key ? theme.tealDeep : theme.border}`,
                    borderRadius: 20,
                    background: visualTheme === key ? `${theme.tealDeep}10` : '#fff',
                    color: visualTheme === key ? theme.tealDeep : theme.textMid,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>{THEME_LABELS[key].icon}</span>
                  <span>{THEME_LABELS[key].label}</span>
                </button>
              ))}
            </div>
          )}

          <textarea
            ref={composerRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={postType === 'visual' ? 'Add a caption...' : postType === 'question' ? 'Ask a question...' : postType === 'article' ? 'Write your article...' : postType === 'review' ? 'Share your experience...' : 'What\'s on your mind?'}
            style={{
              width: '100%',
              minHeight: postType === 'article' ? 200 : 100,
              padding: 12,
              fontSize: 14,
              fontFamily: 'inherit',
              border: `1px solid ${theme.border}`,
              borderRadius: 12,
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            rows={postType === 'article' ? 15 : 5}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <GhostBtn onClick={onClose} disabled={posting}>Cancel</GhostBtn>
        <TealBtn onClick={createPost} disabled={posting} style={{ padding: '10px 24px' }}>
          {posting ? 'Posting...' : 'Post'}
        </TealBtn>
      </div>
    </div>
  )
}