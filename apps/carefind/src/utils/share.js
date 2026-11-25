import { normaliseSiteUrl } from '../lib/seo/site.js'
import { postPath, newsPath } from '../lib/seo/slugs.js'
import { titleFromContent } from '../lib/openGraph.js'

// Sharing a CareFind link, with the fallback every desktop browser needs.
//
// `navigator.share` exists on phones and on very few desktop browsers. A share button wired straight to it is a button
// that silently does nothing for a large share of users, so this falls back to the clipboard and tells the caller
// which path was taken: the caller is expected to confirm "copied" to the user, since a clipboard write has no visible
// effect.
//
// LINKS, NEVER FILES (CODE_AUDIT A51, feedback 2026-11-25). A shared post, article or video is its CareFind link: the
// recipient taps it and lands on the original post, and WhatsApp, LinkedIn, Telegram and the rest draw a preview card
// (thumbnail, title, description) from the link's own tags (api/_handlers/og.js, served to preview crawlers). Handing
// the media file to the share sheet instead (as this module used to) sent WhatsApp the raw video or image with no way
// back to the post. A `files` or `mediaUrl` argument from an older caller is ignored on purpose.
// (The voice-note card in utils/voiceCard.js is a different, explicit "save as video for WhatsApp Status" export.)
//
// Returns: 'shared' | 'copied' | 'dismissed' | 'failed'
export async function shareOrCopy({ title, text, url }) {
  const target = url || window.location.href

  if (navigator.share) {
    try {
      // Title, text and the link only: never a file (see LINKS, NEVER FILES above).
      await navigator.share({ title, text, url: target })
      return 'shared'
    } catch (e) {
      // The user closing the share sheet is not a failure to report.
      if (e?.name === 'AbortError') return 'dismissed'
    }
  }

  try {
    // The post URL already carries og:image tags so WhatsApp/Telegram/etc.
    // render the image inside the link preview card. Appending the raw
    // mediaUrl as a second line caused two separate previews (image + link)
    // when pasted into WhatsApp — the image and text appeared split, so we
    // never append mediaUrl. URL is first so the preview appears without
    // scrolling (deep-link preview card: image/title tappable to /post/:id).
    await navigator.clipboard.writeText(text ? `${target}\n\n${text}` : `${target}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}

// The link to share for a post or a news article: the readable canonical URL (/post/<title-slug>-<id>,
// /news/<headline-slug>-<id>), the same one the sitemap and the preview card use, on the public site address. Old
// /post/<id> links keep working (the id is read from the end of the path).
export function postShareUrl(post) {
  return siteOrigin() + postPath(post, titleFromContent(post?.content, 'Article on CareFind'))
}
export function newsShareUrl(article) {
  return siteOrigin() + newsPath(article)
}
const siteOrigin = () => normaliseSiteUrl(import.meta.env?.VITE_SITE_URL)
