import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../../config/supabaseClient'
import { useAuth } from '../../../providers/AuthContext'
import { ensureProfile } from '../../../services/ensureProfile.js'
import { notify } from '../../../services/notify.js'
import { getActiveIdentity } from '../../../lib/activeIdentity'
import { theme } from '../../../styles/theme'
import { Camera, X, Mic, HelpCircle, FileText, BookOpen, Star, Image as ImageIcon, Pen, Search } from 'lucide-react'
import { Avatar, TealBtn, GhostBtn, Pill } from '../../../components/ui'
import { useToast } from '../../../components/ui'
import { extractMentions } from '../mentions.js'

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

// Healthcare professional categories that can be tagged in posts.
// Tagging @Pharmacist notifies all verified pharmacists on the platform.
const PROFESSION_CATEGORIES = [
  { id: '_cat_doctor', name: 'Doctors', keyword: 'doctor' },
  { id: '_cat_nurse', name: 'Nurses', keyword: 'nurse' },
  { id: '_cat_pharmacist', name: 'Pharmacists', keyword: 'pharmacist' },
  { id: '_cat_dentist', name: 'Dentists', keyword: 'dentist' },
  { id: '_cat_dermatologist', name: 'Dermatologists', keyword: 'dermatologist' },
  { id: '_cat_physiotherapist', name: 'Physiotherapists', keyword: 'physiotherapist' },
  { id: '_cat_lab scientist', name: 'Lab Scientists', keyword: 'lab scientist' },
  { id: '_cat_radiographer', name: 'Radiographers', keyword: 'radiographer' },
  { id: '_cat_midwife', name: 'Midwives', keyword: 'midwife' },
  { id: '_cat_optometrist', name: 'Optometrists', keyword: 'optometrist' },
]

// Search profiles by name for @mention autocomplete. Returns up to 6 results.
async function searchMentionUsers(query) {
  if (!query || query.length < 1) return []
  const q = query.toLowerCase()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, display_name, avatar_url, is_verified')
    .or(`display_name.ilike.%${q}%,full_name.ilike.%${q}%`)
    .limit(6)
  return data || []
}

// Resolve professional category mentions to user IDs.
// Returns an array of user IDs for all verified professionals in the category.
async function resolveCategoryMention(categoryId) {
  const cat = PROFESSION_CATEGORIES.find(c => c.id === categoryId)
  if (!cat) return []
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_verified', true)
    .ilike('specialty', `%${cat.keyword}%`)
    .limit(200)
  return (data || []).map(p => p.id)
}

export function PostComposer({ onClose, onPosted, myUsername, myAvatar }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [content, setContent] = useState('')
  const [postType, setPostType] = useState('text')
  const [visualTheme, setVisualTheme] = useState('teal-depth')
  const [postRating, setPostRating] = useState(5)
  // INVARIANT: draft state — imageFile/imagePreview remain local until explicit Post; no effect auto-publishes.
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [posting, setPosting] = useState(false)
  const composerRef = useRef(null)

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState(null) // null = closed, string = active query
  const [mentionResults, setMentionResults] = useState([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0)
  const mentionQueryRef = useRef(null)

  // Detect @mention trigger and search as the user types
  const handleContentChange = useCallback((e) => {
    const val = e.target.value
    setContent(val)

    // Detect the last @mention token: cursor must be right after the token
    const cursorPos = e.target.selectionStart
    const textBeforeCursor = val.slice(0, cursorPos)
    const mentionMatch = textBeforeCursor.match(/@([A-Za-z0-9_.-]*)$/)

    if (mentionMatch) {
      const query = mentionMatch[1]
      setMentionQuery(query)
      setSelectedMentionIdx(0)
    } else {
      setMentionQuery(null)
    }
  }, [])

  // Fetch matching users + categories when mentionQuery changes
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionResults([])
      return
    }
    let cancelled = false
    setMentionLoading(true)

    const timer = setTimeout(async () => {
      const q = mentionQuery.toLowerCase()
      const [users, categories] = await Promise.all([
        searchMentionUsers(mentionQuery),
        Promise.resolve(
          PROFESSION_CATEGORIES.filter(c =>
            c.keyword.includes(q) || c.name.toLowerCase().includes(q)
          ).slice(0, 3)
        ),
      ])
      if (cancelled) return
      // Combine: categories first, then users
      const results = [
        ...categories.map(c => ({ ...c, type: 'category' })),
        ...users.filter(u => u.id !== user?.id).map(u => ({ ...u, type: 'user' })),
      ]
      setMentionResults(results)
      setMentionLoading(false)
      mentionQueryRef.current = { query: mentionQuery, len: mentionMatch?.[0]?.length || 0 }
    }, 200)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [mentionQuery, user?.id])

  // Insert a selected mention into the textarea
  const insertMention = useCallback((item) => {
    const textarea = composerRef.current
    if (!textarea) return
    const cursorPos = textarea.selectionStart
    const textBefore = content.slice(0, cursorPos)
    const textAfter = content.slice(cursorPos)
    // Replace the @query with the mention token
    const beforeMention = textBefore.replace(/@([A-Za-z0-9_.-]*)$/, '')
    const mentionText = item.type === 'category' ? `@${item.name} ` : `@${item.display_name || item.name} `
    const newText = beforeMention + mentionText + textAfter
    setContent(newText)
    setMentionQuery(null)
    setMentionResults([])
    // Re-focus textarea and place cursor after the mention
    setTimeout(() => {
      textarea.focus()
      const newCursorPos = beforeMention.length + mentionText.length
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }, [content])

  // Keyboard navigation in the mention dropdown
  const handleMentionKeyDown = useCallback((e) => {
    if (mentionQuery === null || mentionResults.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedMentionIdx(i => Math.min(i + 1, mentionResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedMentionIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insertMention(mentionResults[selectedMentionIdx])
    } else if (e.key === 'Escape') {
      setMentionQuery(null)
    }
  }, [mentionQuery, mentionResults, selectedMentionIdx, insertMention])

  // INVARIANT: image selection only sets draft state — never inserts into posts.
  // Publish only via createPost's single supabase insert, gated by `posting`.
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

  // INVARIANT (spec-carefind-drawing-auto-publish-fix): createPost is the ONLY caller of posts.insert.
  // No effect watches imageFile/content to auto-publish. posting flag is the idempotency guard.
  const createPost = useCallback(async () => {
    if (!user) return
    if (posting) return
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
      const profileOk = await ensureProfile(user)
      if (!profileOk) {
        toast.show('Could not create post: profile setup incomplete', { type: 'error' })
        return
      }
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

      // Send mention notifications (best-effort, never blocks the post)
      try {
        const mentionedNames = extractMentionDisplayNames(content)
        if (mentionedNames.length > 0) {
          // Resolve user mentions
          for (const name of mentionedNames) {
            const lowerName = name.toLowerCase()
            // Check if it's a professional category
            const cat = PROFESSION_CATEGORIES.find(c => c.name.toLowerCase() === lowerName)
            if (cat) {
              const userIds = await resolveCategoryMention(cat.id)
              for (const uid of userIds) {
                notify({ recipientId: uid, actorId: user.id, type: 'mention', message: `mentioned ${cat.name} in a post`, link: `/post/${data.id}`, postId: data.id })
              }
            } else {
              // Individual user mention
              const { data: profiles } = await supabase
                .from('profiles')
                .select('id')
                .or(`display_name.ilike.${name},full_name.ilike.${name}`)
                .limit(5)
              for (const p of (profiles || [])) {
                notify({ recipientId: p.id, actorId: user.id, type: 'mention', message: 'mentioned you in a post', link: `/post/${data.id}`, postId: data.id })
              }
            }
          }
        }
      } catch (e) {
        console.warn('Mention notifications failed:', e)
      }

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
      toast.show('Could not post: ' + (e.message || 'please try again'), { type: 'error' })
    } finally {
      setPosting(false)
    }
  }, [user, content, postType, visualTheme, postRating, imageFile, imagePreview, posting, toast, onClose, onPosted, removeImage])

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

          <div style={{ position: 'relative' }}>
            <textarea
              ref={composerRef}
              value={content}
              onChange={handleContentChange}
              onKeyDown={handleMentionKeyDown}
              placeholder={postType === 'visual' ? 'Add a caption...' : postType === 'question' ? 'Ask a question...' : postType === 'article' ? 'Write your article...' : postType === 'review' ? 'Share your experience...' : "What's on your mind? Use @ to mention someone"}
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

            {/* @mention autocomplete dropdown */}
            {mentionQuery !== null && mentionResults.length > 0 && (
              <div
                style={{
                  position: 'absolute', left: 0, right: 0, bottom: '100%',
                  background: theme.cardBg, border: `1px solid ${theme.border}`,
                  borderRadius: 12, boxShadow: theme.elevation[3],
                  maxHeight: 240, overflowY: 'auto', zIndex: 50,
                  marginBottom: 4,
                }}
              >
                {mentionResults.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => insertMention(item)}
                    onMouseEnter={() => setSelectedMentionIdx(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px', border: 'none',
                      background: idx === selectedMentionIdx ? theme.tealMist : 'transparent',
                      cursor: 'pointer', textAlign: 'left',
                      fontFamily: theme.fontFamily,
                    }}
                  >
                    {item.type === 'category' ? (
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%',
                        background: theme.navy, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 800,
                        flexShrink: 0,
                      }}>
                        {item.name[0]}
                      </div>
                    ) : (
                      <Avatar name={item.display_name || item.full_name} src={item.avatar_url} size={34} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.type === 'category' ? item.name : (item.full_name || item.display_name)}
                      </div>
                      <div style={{ fontSize: 11, color: theme.textLight }}>
                        {item.type === 'category' ? 'Tag all professionals' : (item.display_name ? `@${item.display_name}` : '')}
                      </div>
                    </div>
                    {item.type === 'category' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: theme.tealDeep, background: theme.tealMist, padding: '3px 8px', borderRadius: 8 }}>Category</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
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

// Extract display names of mentioned users from post content for notification.
// Matches @username and @Category Name patterns.
function extractMentionDisplayNames(text) {
  if (!text) return []
  const seen = new Set()
  const out = []
  // Match @ followed by a word (user) or multiple words (category)
  const re = /(?:^|[\s])@([A-Za-z][A-Za-z0-9_.-]*(?: [A-Za-z0-9_.-]+)*)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim()
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase())
      out.push(name)
    }
  }
  return out
}
