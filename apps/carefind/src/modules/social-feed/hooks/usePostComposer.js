import { useState, useCallback, useRef } from 'react'
import { supabase } from '../../../config/supabaseClient'
import { useAuth } from '../../../providers/AuthContext'
import { getActiveIdentity } from '../../../lib/activeIdentity'
import { useToast } from '../../../components/ui'
import { resizeImage } from '../../../utils/imageResize.js'
import { MAX_POST_IMAGES } from '../mediaLimits.js'

export function usePostComposer() {
  const { user } = useAuth()
  const toast = useToast()
  const [content, setContent] = useState('')
  const [postType, setPostType] = useState('text')
  const [visualTheme, setVisualTheme] = useState('teal')
  const [postRating, setPostRating] = useState(5)
  const [imageFiles, setImageFiles] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
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
    if (postType === 'visual' && imageFiles.length === 0) {
      toast.show('Add an image for Voice Card posts', { type: 'warning' })
      return
    }

    setPosting(true)
    try {
      const activeIdentity = getActiveIdentity()

      let imageUrls = []
      if (imageFiles.length) {
        setUploadingImage(true)
        try {
          for (const f of imageFiles) {
            const resized = await resizeImage(f, 1400, 0.85)
            const path = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
            const { error: upErr } = await supabase.storage.from('post-images').upload(path, resized, { contentType: 'image/jpeg' })
            if (upErr) throw upErr
            const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(path)
            imageUrls.push(urlData.publicUrl)
          }
        } catch (e) {
          setUploadingImage(false)
          throw new Error('Could not upload the photo: ' + (e.message || 'please try again'))
        }
        setUploadingImage(false)
      }

      const postData = {
        user_id: user.id,
        content: content.trim(),
        post_type: postType,
        theme: visualTheme,
        ...(imageUrls.length ? { image_url: imageUrls[0], image_urls: imageUrls } : {}),
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
      imagePreviews.forEach((u) => { try { URL.revokeObjectURL(u) } catch {} })
      setImageFiles([])
      setImagePreviews([])
      toast.show('Post created!', { type: 'success' })
      return data
    } catch (e) {
      console.error('Create post error:', e)
      toast.show('Failed to create post', { type: 'error' })
    } finally {
      setPosting(false)
    }
  }, [user, content, postType, visualTheme, postRating, imageFiles, toast])

  const handleImagesSelect = useCallback((files) => {
    const fileList = Array.from(files || [])
    const images = fileList.filter((f) => f.type?.startsWith('image/'))
    if (images.length !== fileList.length) {
      toast.show('Please select images', { type: 'warning' })
    }
    const remaining = MAX_POST_IMAGES - imageFiles.length
    if (remaining <= 0) {
      toast.show(`You can add up to ${MAX_POST_IMAGES} photos (${MAX_POST_IMAGES}/${MAX_POST_IMAGES})`, { type: 'warning' })
      return
    }
    if (images.length > remaining) {
      toast.show(`You can add up to ${MAX_POST_IMAGES} photos (${MAX_POST_IMAGES}/${MAX_POST_IMAGES})`, { type: 'warning' })
    }
    const toAdd = images.slice(0, remaining)
    if (!toAdd.length) return
    const newPreviews = toAdd.map((f) => URL.createObjectURL(f))
    setImageFiles((prev) => [...prev, ...toAdd])
    setImagePreviews((prev) => [...prev, ...newPreviews])
  }, [imageFiles.length, toast])

  const handleImageSelect = useCallback((file) => {
    if (file) handleImagesSelect([file])
  }, [handleImagesSelect])

  const removeImageAt = useCallback((idx) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== idx))
    setImagePreviews((prev) => {
      const url = prev[idx]
      if (url) try { URL.revokeObjectURL(url) } catch {}
      return prev.filter((_, i) => i !== idx)
    })
  }, [])

  const removeImage = useCallback(() => {
    imagePreviews.forEach((u) => { try { URL.revokeObjectURL(u) } catch {} })
    setImageFiles([])
    setImagePreviews([])
  }, [imagePreviews])

  return {
    content,
    setContent,
    postType,
    setPostType,
    visualTheme,
    setVisualTheme,
    postRating,
    setPostRating,
    imageFiles,
    setImageFiles,
    imagePreviews,
    setImagePreviews,
    // Back-compat single mirrors
    imageFile: imageFiles[0] || null,
    imagePreview: imagePreviews[0] || null,
    uploadingImage,
    setUploadingImage,
    posting,
    articleTextareaRef,
    composerRef,
    createPost,
    handleImagesSelect,
    handleImageSelect,
    removeImageAt,
    removeImage
  }
}