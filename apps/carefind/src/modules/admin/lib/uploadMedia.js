import { supabase } from '../../../config/supabaseClient.js'

// One browser upload to a storage bucket. The legacy screens ignored a failed
// upload and created the story/promotion without its image; this returns the
// error so the caller can stop and tell the admin. Same client, bucket and path
// scheme as before: only the failure handling differs. `options.contentType`
// is passed to storage when given (the live trailer needs a video type); with
// none the call is the unchanged two-argument upload.
export async function uploadToBucket(bucket, file, prefix, options) {
  if (!file) return { ok: true, url: null }
  try {
    const ext = file.name.split('.').pop()
    const path = `${prefix}-${Date.now()}.${ext}`
    const store = supabase.storage.from(bucket)
    const { error } = options?.contentType
      ? await store.upload(path, file, { contentType: options.contentType })
      : await store.upload(path, file)
    if (error) return { ok: false, error: error.message }
    const { data } = store.getPublicUrl(path)
    return { ok: true, url: data.publicUrl }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
