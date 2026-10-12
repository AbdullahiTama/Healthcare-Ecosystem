import { supabase } from '../../../config/supabaseClient.js'

// One browser upload to a storage bucket. The legacy screens ignored a failed
// upload and created the story/promotion without its image; this returns the
// error so the caller can stop and tell the admin. Same client, bucket and path
// scheme as before: only the failure handling differs.
export async function uploadToBucket(bucket, file, prefix) {
  if (!file) return { ok: true, url: null }
  try {
    const ext = file.name.split('.').pop()
    const path = `${prefix}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(bucket).upload(path, file)
    if (error) return { ok: false, error: error.message }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return { ok: true, url: data.publicUrl }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
