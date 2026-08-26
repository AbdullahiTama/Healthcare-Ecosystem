// Crawler prerender for shared CareFind links (issue #1).
//
// CareFind is a Vite SPA: one static index.html carrying site-wide meta, with
// the real content filled in by JavaScript afterwards. Link-preview crawlers
// read only the first response and never run JS, so every shared URL produced
// the same generic "CareFind" card regardless of which post it pointed at.
//
// vercel.json rewrites requests whose User-Agent matches a known preview
// crawler to /api/router, which hands them here (see api/router.js). Everyone
// else gets the SPA exactly as before — the rewrite is conditional on the
// header, so no human request path changes.
//
// AUTHORISATION. This handler deliberately uses the PUBLIC anon key, not the
// service-role key the rest of api/_handlers uses. A crawler is anonymous, so
// its preview must be bound by exactly the RLS a logged-out visitor gets. With
// the anon key that is enforced by the database rather than by remembering to
// write the right filter here; the per-kind builders in src/lib/openGraph.js
// then apply the product rules on top (paid posts and unapproved news are
// acknowledged but never described).
//
// FAILURE MODE. Anything unexpected — no key configured, a network error, an
// unparseable URL — falls back to the site-wide tags and HTTP 200. A crawler
// that receives a 500 caches the failure, and a bad preview is better than no
// page at all.

import {
  parseShareTarget, buildPostMeta, buildProfileMeta, buildNewsMeta,
  buildBusinessMeta, defaultMeta, renderOgHtml,
} from '../../src/lib/openGraph.js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
// Public key only — see AUTHORISATION above. Never the service-role key.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

function originOf(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return host ? `${proto}://${host}` : ''
}

// One PostgREST read with the anon key. Returns the first row or null; never
// throws, so a preview can always be produced.
async function selectOne(table, columns, filters) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  const params = new URLSearchParams({ select: columns, limit: '1', ...filters })
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) && rows.length ? rows[0] : null
  } catch {
    return null
  }
}

async function metaFor(target, context) {
  switch (target.kind) {
    case 'post': {
      const post = await selectOne(
        'posts',
        'id,content,image_url,image_urls,subscriber_only,is_premium,post_type,user_id,repost_of',
        { id: `eq.${target.id}` }
      )
      if (!post) return defaultMeta(context.canonicalUrl)

      // A repost carries no words of its own (issues #6/#8) — preview the post
      // it points at, credited to whoever actually wrote it.
      const subject = post.repost_of
        ? (await selectOne('posts', 'id,content,image_url,image_urls,subscriber_only,is_premium,post_type,user_id', { id: `eq.${post.repost_of}` })) || post
        : post

      const author = subject.user_id
        ? await selectOne('profiles', 'id,full_name,display_name', { id: `eq.${subject.user_id}` })
        : null
      return buildPostMeta(subject, { ...context, author })
    }
    case 'profile': {
      const profile = await selectOne(
        'profiles',
        'id,full_name,display_name,bio,avatar_url,specialty,verification_label,is_verified',
        { id: `eq.${target.id}` }
      )
      return buildProfileMeta(profile, context)
    }
    case 'news': {
      const article = await selectOne(
        'news',
        'id,headline,subtitle,body,hero_image_url,status',
        { id: `eq.${target.id}` }
      )
      return buildNewsMeta(article, context)
    }
    case 'business': {
      const business = await selectOne(
        'businesses',
        'id,name,business_type,city,state,description,logo_url,cover_url,status,visible_on_carefind',
        { id: `eq.${target.id}` }
      )
      return buildBusinessMeta(business, context)
    }
    default:
      return defaultMeta(context.canonicalUrl)
  }
}

export default async function handler(req, res) {
  const origin = originOf(req)
  const path = req.url || '/'
  const canonicalUrl = origin ? `${origin}${path}` : path

  let meta
  try {
    const target = parseShareTarget(path)
    meta = target
      ? await metaFor(target, { origin, canonicalUrl })
      : defaultMeta(canonicalUrl)
  } catch (err) {
    console.error('[og] falling back to site tags', { path, error: err?.message })
    meta = defaultMeta(canonicalUrl)
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Let the CDN hold a preview briefly so a burst of crawlers on one shared
  // link does not become a burst of database reads, while an edited post still
  // gets a fresh card soon after. Facebook and WhatsApp cache per URL on their
  // own side regardless, so a deploy still needs a re-scrape to take effect.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600')
  return res.status(200).send(renderOgHtml(meta))
}
