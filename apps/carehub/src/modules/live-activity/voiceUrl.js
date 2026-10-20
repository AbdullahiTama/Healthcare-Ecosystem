// Voice notes live in the activity-voice storage bucket. These are the pure rules for
// where a recording goes and how a stored URL maps back to a file, so playback and
// upload can be tested without a network.
//
// They are written to work whether the bucket is still public (as today) or private
// (carehub_20261020_activity_voice_private): a stored URL is only ever used to find
// the file's path, and playback then asks for a signed link for that path.

export const VOICE_BUCKET = 'activity-voice'

// Stored values look like  <origin>/storage/v1/object/public/activity-voice/<path>
// (every existing note), or the sign/authenticated forms. Anything else is null.
export function voicePathFromUrl(url) {
  if (!url || typeof url !== 'string') return null
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/activity-voice\/([^?#]+)/)
  if (!m || !m[1]) return null
  try { return decodeURIComponent(m[1]) } catch (e) { return m[1] }
}

const EXT_BY_TYPE = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp4': 'mp4' }

// Where to put a recording and what to call its type. The path is
// '<company id>/<report id>-<suffix>.<ext>': the company folder is what the bucket's
// upload policy checks, and the suffix keeps a retry of the same report from colliding
// with a file whose first upload succeeded but whose response was lost.
// The content type is sent WITHOUT parameters ('audio/webm', not 'audio/webm;codecs=opus'):
// the bucket's allow-list matches the bare type.
export function voiceUploadInfo(blob, businessId, activityId, suffix) {
  if (!businessId || !activityId) throw new Error('A voice note needs a company and a report to be stored under.')
  const bare = String((blob && blob.type) || '').split(';')[0].trim().toLowerCase() || 'audio/mp4'
  const ext = EXT_BY_TYPE[bare] || 'mp4'
  return { path: businessId + '/' + activityId + '-' + suffix + '.' + ext, contentType: bare }
}
