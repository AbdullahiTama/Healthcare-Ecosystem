import { useState, useCallback, useRef } from 'react'
import { supabase } from '../../../config/supabaseClient'
import { useAuth } from '../../../providers/AuthContext'
import { getActiveIdentity } from '../../../lib/activeIdentity'
import { useToast } from '../../../components/ui'

export function usePostComposer() {
  const { user } = useAuth()
  const toast = useToast()
  const [content, setContent] = useState('')
  const [postType, setPostType] = useState('text')
  const [visualTheme, setVisualTheme] = useState('teal')
  const [postRating, setPostRating] = useState(5)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [posting, setPosting] = useState(false)
  const articleTextareaRef = useRef(null)
  const composerRef = useRef(null)

  const createPost = useCallback(async () => {
    if (!user) return
    if (!content.trim() && postType === 'text') {
      toast.show('Write something first', { type: 'warning' })
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
        ...(postType === 'question' ? {} : {}),
        ...(postType === 'review' ? { rating: postRating } : {}),
        ...(postType === 'article' ? {} : {}),
        ...(activeIdentity?.type === 'business' ? { posting_as_business_id: activeIdentity.id } : {}),
        ...(activeIdentity?.type === 'staff' ? { posted_as_type: 'staff', posted_as_id: activeIdentity.staffId, posted_as_name: activeIdentity.fullName, posted_as_title: activeIdentity.publicTitle } : {})
      }

      const { data, error } = await supabase
        .from('posts')
        .insert(postData)
        .select()
        .single()

      if (error) throw error

      setContent('')
      setPostType('text')
      setVisualTheme('teal')
      setPostRating(5)
      setImageFile(null)
      setImagePreview(null)
      toast.show('Post created!', { type: 'success' })
      return data
    } catch (e) {
      console.error('Create post error:', e)
      toast.show('Failed to create post', { type: 'error' })
    } finally {
      setPosting(false)
    }
  }, [user, content, postType, visualTheme, postRating, imageFile, imagePreview, toast])

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

  return {
    content,
    setContent,
    postType,
    setPostType,
    visualTheme,
    setVisualTheme,
    postRating,
    setPostRating,
    imageFile,
    imagePreview,
    uploadingImage,
    setUploadingImage,
    posting,
    articleTextareaRef,
    composerRef,
    createPost,
    handleImageSelect,
    removeImage
  }
}