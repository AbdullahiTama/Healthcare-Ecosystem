// Proof photos live in the private activity-photos bucket. Unlike voice notes, the report stores the storage PATH
// (never a URL), so there is nothing public to leak and nothing to translate back: the path is what gets signed
// for viewing. Pure rules, so they are tested without a network.

export const PHOTO_BUCKET = 'activity-photos'
export const MAX_PHOTOS = 3

// '<company id>/<report id>-<position>-<suffix>.jpg'. The company folder is what the bucket's upload policy
// checks; the position keeps one report's photos apart; the suffix keeps a retry from colliding with a file
// whose first upload succeeded but whose response was lost. prepareProofPhoto always produces JPEG.
export function photoUploadInfo(businessId, activityId, index, suffix) {
  if (!businessId || !activityId) throw new Error('A photo needs a company and a report to be stored under.')
  return { path: businessId + '/' + activityId + '-' + index + '-' + suffix + '.jpg', contentType: 'image/jpeg' }
}
