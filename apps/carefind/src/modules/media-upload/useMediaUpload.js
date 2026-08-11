import { supabase } from '../../config/supabaseClient'
import { useState, useCallback } from 'react'
import { useToast } from '../../components/ui'

const BUCKET = 'carefind-media'

export function useMediaUpload() {
  const toast = useToast()
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const uploadFile = useCallback(async (file, customPath = null, contentType = null) => {
    if (!file) return null
    
    setUploading(true)
    setProgress(0)
    
    try {
      const fileName = customPath || `${file.type.split('/')[0]}s/${Date.now()}-${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`
      
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: contentType || file.type,
        })
      
      if (error) throw error
      
      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(data.path)
      
      setProgress(100)
      return publicUrl
    } catch (e) {
      console.error('Upload error:', e)
      toast.show(`Upload failed: ${e.message}`, { type: 'error' })
      return null
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }, [toast])

  const uploadImage = useCallback(async (file) => {
    if (!file.type.startsWith('image/')) {
      toast.show('Please select an image file', { type: 'warning' })
      return null
    }
    return uploadFile(file, 'images')
  }, [uploadFile, toast])

  const uploadVideo = useCallback(async (file) => {
    if (!file.type.startsWith('video/')) {
      toast.show('Please select a video file', { type: 'warning' })
      return null
    }
    return uploadFile(file, 'videos')
  }, [uploadFile, toast])

  const uploadAudio = useCallback(async (file) => {
    if (!file.type.startsWith('audio/')) {
      toast.show('Please select an audio file', { type: 'warning' })
      return null
    }
    return uploadFile(file, 'audio')
  }, [uploadFile, toast])

  return {
    uploading,
    progress,
    uploadFile,
    uploadImage,
    uploadVideo,
    uploadAudio,
  }
}

export function useLocalPreview() {
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)

  const selectFile = useCallback((selectedFile) => {
    if (!selectedFile) return
    setFile(selectedFile)
    setPreview(URL.createObjectURL(selectedFile))
  }, [])

  const clear = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setFile(null)
  }, [preview])

  return {
    file,
    preview,
    selectFile,
    clear,
  }
}