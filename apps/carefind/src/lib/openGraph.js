// Per-item link-preview metadata for shared CareFind URLs (issue #1).
//
// THE PROBLEM. CareFind is a Vite SPA: one static index.html with site-wide
// meta ("CareFind" / "Discover healthcare providers, medicines, and services
// near you") and a client that fills the page in afterwards. Link-preview
// crawlers — WhatsApp, iMessage, LinkedIn, Facebook, Slack, X — read the raw
// HTML of the first response and never run JavaScript, so every shared URL
// produces the same generic card no matter which post it points at. Fetching
// https://carefind.app/feed?post=<id> shows exactly that.
//
// THE APPROACH. There is no SSR to add tags to, and rebuilding the app on a
// framework that has one is not proportionate to a metadata bug. Instead the
// Vercel edge rewrites crawler user-agents (and only those) to the existing
// API function, which answers with a small HTML document carrying real tags
// for that item. Human visitors are untouched and still get the SPA.
//
// This module is the pure half — user-agent matching, URL parsing, meta
// building and HTML rendering — so all of it is testable without a network or
// a deployment. api/_handlers/og.js supplies the data and the response.
//
// SECURITY. A crawler is anonymous and cannot authenticate, so a preview must
// never reveal more than a logged-out visitor already sees. Paid and pending
// content is therefore reduced to generic tags rather than described:
// subscriber-only and premium posts, unapproved news. `buildPostMeta` enforces
// that here rather than trusting each caller to remember.

export const SITE_NAME = 'CareFind'
export const DEFAULT_TITLE = 'CareFind'
export const DEFAULT_DESCRIPTION = 'CareFind - Discover healthcare providers, medicines, and services near you'

// Preview description length. Below ~150 characters the card looks empty; past
// ~200 every major platform truncates it anyway.
export const DESCRIPTION_LIMIT = 200

// LINK-PREVIEW crawlers only — the ones that read og:/twitter: tags to build a
// share card and do not execute JavaScript. Matched case-insensitively against
// the User-Agent. Deliberately a fixed list rather than a "looks like a bot"
// guess: serving different HTML to a real browser is how an SPA breaks for one
// user and nobody can reproduce it.
//
// SEARCH crawlers are deliberately ABSENT (Googlebot, bingbot, Applebot).
// They render JavaScript, so they already index the real app — and serving
// them this stub instead would replace every indexed page with the same thin
// card, since a non-item route has nothing item-specific to say. Adding a
// search crawler here would be an SEO regression, not an improvement.
export const CRAWLER_PATTERNS = [
  'facebookexternalhit', 'facebookcatalog', 'facebot', 'meta-externalagent',
  'whatsapp', 'linkedinbot', 'twitterbot', 'slackbot', 'slack-imgproxy',
  'telegrambot', 'discordbot', 'pinterest', 'redditbot', 'skypeuripreview',
  'embedly', 'iframely', 'quora link preview', 'vkshare',
]

export function isCrawlerUserAgent(userAgent) {
  if (!userAgent) return false
  const ua = String(userAgent).toLowerCase()
  return CRAWLER_PATTERNS.some((pattern) => ua.includes(pattern))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Which shareable item does this URL point at? Returns { kind, id } or null
// for anything that is not an item page (the crawler then gets site defaults).
// Accepts a path+query string, e.g. '/feed?post=<uuid>'.
export function parseShareTarget(rawUrl) {
  if (!rawUrl) return null
  let path = String(rawUrl)
  let query = ''
  const q = path.indexOf('?')
  if (q >= 0) { query = path.slice(q + 1); path = path.slice(0, q) }
  const segments = path.split('/').filter(Boolean)
  const params = new URLSearchParams(query)

  if (segments[0] === 'feed') {
    const postId = params.get('post')
    return UUID.test(postId || '') ? { kind: 'post', id: postId } : null
  }
  if (segments[0] === 'u' && segments[1]) {
    return UUID.test(segments[1]) ? { kind: 'profile', id: segments[1] } : null
  }
  if (segments[0] === 'news' && segments[1]) {
    return UUID.test(segments[1]) ? { kind: 'news', id: segments[1] } : null
  }
  if (segments[0] === 'business' && segments[1]) {
    return UUID.test(segments[1]) ? { kind: 'business', id: segments[1] } : null
  }
  return null
}

// Article bodies are a JSON array of blocks; ordinary posts are plain text.
// Either way a preview needs readable prose, with the markup stripped — a card
// reading "**Movement Is Medicine**" looks broken.
// Prose with the markup removed, but line structure PRESERVED. Titles are
// taken from the first line, so collapsing paragraphs here would make every
// card's title the opening of its own description.
function strippedText(content) {
  if (content == null) return ''
  let text = String(content)
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    try {
      const blocks = JSON.parse(trimmed)
      if (Array.isArray(blocks)) {
        text = blocks
          .map((b) => {
            if (!b || typeof b !== 'object') return ''
            if (b.type === 'drawing') return String(b.caption || '')
            return typeof b.content === 'string' ? b.content : ''
          })
          .filter(Boolean)
          .join('\n\n')
      }
    } catch {
      // Malformed JSON (e.g. raw newlines inside a block): best-effort extract
      // each block's text so we never print the raw array.
      const recovered = (trimmed.match(/"content"\s*:\s*"([\s\S]*?)"/g) || [])
        .map((m) => m.replace(/^"content"\s*:\s*"/, '').replace(/"\s*$/, ''))
        .join('\n\n')
      if (recovered.trim()) text = recovered
      // otherwise fall through and use it as prose
    }
  }
  return text
    .replace(/\\n/g, '\n')                    // literal "\n" escapes from stored content → real line breaks
    .replace(/==#?[0-9a-zA-Z_-]*\|/g, '')   // highlight openers, valid or malformed
    .replace(/==/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^🔁\s*/, '')
}

export function plainTextFromContent(content) {
  return strippedText(content).replace(/\s+/g, ' ').trim()
}

// The card's title: the post's own opening line, the way a reader would read
// it as a headline. Most CareFind articles open with a bold heading on its own
// line, so the line break is the strongest signal available; a post written as
// one paragraph falls back to its first sentence. Never returns an empty
// string — a card with no title shows a bare URL.
export function titleFromContent(content, fallback = DEFAULT_TITLE) {
  const structured = strippedText(content)
  if (!structured.trim()) return fallback
  const firstLine = structured
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || ''
  const candidate = firstLine.length > 20
    ? firstLine
    : (structured.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] || firstLine)
  return truncate(candidate.replace(/\s+/g, ' ').trim(), 90) || fallback
}

export function truncate(text, limit = DESCRIPTION_LIMIT) {
  const clean = String(text || '').trim()
  if (clean.length <= limit) return clean
  // Cut on a word boundary so the preview does not end mid-word.
  const cut = clean.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

// Crawlers require an absolute og:image; a relative path yields no image at all.
export function absoluteUrl(origin, maybeUrl) {
  if (!maybeUrl) return null
  const url = String(maybeUrl)
  if (/^https?:\/\//i.test(url)) return url
  if (!origin) return null
  return `${origin.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
}

export function defaultMeta(canonicalUrl) {
  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    image: null,
    url: canonicalUrl || null,
    type: 'website',
  }
}

// ── Per-kind builders ────────────────────────────────────────────────────
// Each takes the row the handler fetched plus { origin, canonicalUrl } and
// returns a meta object. A missing or non-public row returns site defaults —
// never a half-filled card, and never anything a logged-out visitor could not
// already see.

export function buildPostMeta(post, { origin, canonicalUrl, author } = {}) {
  if (!post) return defaultMeta(canonicalUrl)

  // Paid content: acknowledge the post exists, describe nothing. A crawler is
  // anonymous, so anything put here is readable by anyone with the link.
  if (post.subscriber_only || post.is_premium) {
    return {
      ...defaultMeta(canonicalUrl),
      title: 'Subscriber-only post on CareFind',
      description: 'Subscribe to this creator on CareFind to read the full post.',
      type: 'article',
    }
  }

  const authorName = author?.full_name || author?.display_name || null
  const body = plainTextFromContent(post.content)
  // Issue #7: a multi-image post previews with its first photo.
  const previewImage = Array.isArray(post.image_urls) && post.image_urls.length
    ? post.image_urls[0]
    : post.image_url
  return {
    title: titleFromContent(post.content, authorName ? `${authorName} on CareFind` : DEFAULT_TITLE),
    description: truncate(body) || DEFAULT_DESCRIPTION,
    image: absoluteUrl(origin, previewImage),
    url: canonicalUrl,
    type: 'article',
    authorName,
  }
}

export function buildProfileMeta(profile, { origin, canonicalUrl } = {}) {
  if (!profile) return defaultMeta(canonicalUrl)
  const name = profile.full_name || profile.display_name || 'CareFind member'
  const credential = profile.specialty || profile.verification_label
  return {
    title: credential ? `${name} — ${credential}` : name,
    description: truncate(profile.bio || `${name} on CareFind.${credential ? ` ${credential}.` : ''}`),
    image: absoluteUrl(origin, profile.avatar_url),
    url: canonicalUrl,
    type: 'profile',
  }
}

export function buildNewsMeta(article, { origin, canonicalUrl } = {}) {
  // Only approved articles are public; a pending one must not be described.
  if (!article || article.status !== 'approved') return defaultMeta(canonicalUrl)
  return {
    title: article.headline || DEFAULT_TITLE,
    description: truncate(article.subtitle || plainTextFromContent(article.body)) || DEFAULT_DESCRIPTION,
    image: absoluteUrl(origin, article.hero_image_url),
    url: canonicalUrl,
    type: 'article',
  }
}

export function buildBusinessMeta(business, { origin, canonicalUrl } = {}) {
  if (!business || business.status !== 'active' || business.visible_on_carefind === false) {
    return defaultMeta(canonicalUrl)
  }
  const place = [business.city, business.state].filter(Boolean).join(', ')
  const kind = business.business_type ? `${business.business_type}` : 'Healthcare provider'
  return {
    title: business.name || DEFAULT_TITLE,
    description: truncate(business.description || `${kind}${place ? ` in ${place}` : ''} on CareFind.`),
    image: absoluteUrl(origin, business.cover_url || business.logo_url),
    url: canonicalUrl,
    type: 'website',
  }
}

// ── Rendering ────────────────────────────────────────────────────────────

export function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// The document a crawler receives. It is not the app: it carries the tags and
// a human-readable fallback with a link to the real page.
//
// It carries NO meta-refresh. An earlier version had one, reasoning that a
// person who somehow landed here should be forwarded — but the only way to
// land here is with a crawler User-Agent, and the refresh target is the same
// URL, which the edge would rewrite straight back to this handler. That is an
// infinite refresh, not a fallback. A plain link cannot loop.
export function renderOgHtml(meta) {
  const e = escapeHtmlAttribute
  const tags = [
    `<title>${e(meta.title)}</title>`,
    `<meta name="description" content="${e(meta.description)}" />`,
    `<meta property="og:site_name" content="${e(SITE_NAME)}" />`,
    `<meta property="og:type" content="${e(meta.type || 'website')}" />`,
    `<meta property="og:title" content="${e(meta.title)}" />`,
    `<meta property="og:description" content="${e(meta.description)}" />`,
  ]
  if (meta.url) {
    tags.push(`<meta property="og:url" content="${e(meta.url)}" />`)
    tags.push(`<link rel="canonical" href="${e(meta.url)}" />`)
  }
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${e(meta.image)}" />`)
    tags.push(`<meta property="og:image:alt" content="${e(meta.title)}" />`)
    // summary_large_image makes the image part of the same clickable card as
    // the title and description, which is the behaviour the issue asks for.
    tags.push(`<meta name="twitter:card" content="summary_large_image" />`)
    tags.push(`<meta name="twitter:image" content="${e(meta.image)}" />`)
  } else {
    tags.push(`<meta name="twitter:card" content="summary" />`)
  }
  tags.push(`<meta name="twitter:title" content="${e(meta.title)}" />`)
  tags.push(`<meta name="twitter:description" content="${e(meta.description)}" />`)
  if (meta.authorName) {
    tags.push(`<meta property="article:author" content="${e(meta.authorName)}" />`)
  }

  const target = meta.url || '/'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${tags.join('\n')}
</head>
<body>
<h1>${e(meta.title)}</h1>
<p>${e(meta.description)}</p>
<p><a href="${e(target)}">Open on CareFind</a></p>
</body>
</html>`
}
