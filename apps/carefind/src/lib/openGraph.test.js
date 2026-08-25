import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isCrawlerUserAgent, parseShareTarget, canonicalUrlFor, plainTextFromContent,
  titleFromContent, truncate, absoluteUrl, buildPostMeta, buildProfileMeta,
  buildNewsMeta, buildBusinessMeta, renderOgHtml, escapeHtmlAttribute,
  DEFAULT_DESCRIPTION, DEFAULT_TITLE, DESCRIPTION_LIMIT,
} from './openGraph.js'

const ORIGIN = 'https://carefind.app'
const POST_ID = '25410ee8-56dc-40de-93b9-fc82d5857be9'

// The URL a post now canonicalises to, regardless of which shape a crawler
// requested it by. By the time buildPostMeta/renderOgHtml run, og.js has
// already resolved the canonical via canonicalUrlFor — so this is what those
// "plumbing" tests below should thread through, matching real traffic.
const POST_CANONICAL = `${ORIGIN}/post/${POST_ID}`
// The legacy request shape — still shared in the wild, still previews, but
// must no longer be the thing that gets advertised as canonical.
const LEGACY_POST_URL = `${ORIGIN}/feed?post=${POST_ID}`

describe('isCrawlerUserAgent', () => {
  it('matches the crawlers named in the issue', () => {
    for (const ua of [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0 A',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0)',
      'Twitterbot/1.0',
    ]) {
      expect(isCrawlerUserAgent(ua)).toBe(true)
    }
  })

  it('matches the other common preview fetchers', () => {
    expect(isCrawlerUserAgent('Slackbot-LinkExpanding 1.0')).toBe(true)
    expect(isCrawlerUserAgent('TelegramBot (like TwitterBot)')).toBe(true)
    expect(isCrawlerUserAgent('Mozilla/5.0 (compatible; Discordbot/2.0)')).toBe(true)
    expect(isCrawlerUserAgent('facebookexternalhit/1.1 Facebot Twitterbot/1.0')).toBe(true)
  })

  // Search crawlers execute JavaScript and already index the real app.
  // Serving them the stub would replace every indexed page with the same thin
  // card, because a non-item route has nothing item-specific to say.
  it('does NOT match search crawlers — they must get the app, not the stub', () => {
    expect(isCrawlerUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(false)
    expect(isCrawlerUserAgent('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(false)
    expect(isCrawlerUserAgent('Mozilla/5.0 (Macintosh) AppleBot/0.1')).toBe(false)
  })

  it('does NOT match a real browser — a person must always get the app', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ]) {
      expect(isCrawlerUserAgent(ua)).toBe(false)
    }
  })

  it('is false for a missing user agent', () => {
    expect(isCrawlerUserAgent(undefined)).toBe(false)
    expect(isCrawlerUserAgent('')).toBe(false)
  })
})

describe('parseShareTarget', () => {
  it('reads a post id from the permalink', () => {
    expect(parseShareTarget(`/post/${POST_ID}`)).toEqual({ kind: 'post', id: POST_ID })
  })

  it('still reads a post id from the legacy ?post= URL — links already shared must keep previewing', () => {
    expect(parseShareTarget(`/feed?post=${POST_ID}`)).toEqual({ kind: 'post', id: POST_ID })
  })

  it('reads profile, news and business ids', () => {
    expect(parseShareTarget(`/u/${POST_ID}`)).toEqual({ kind: 'profile', id: POST_ID })
    expect(parseShareTarget(`/news/${POST_ID}`)).toEqual({ kind: 'news', id: POST_ID })
    expect(parseShareTarget(`/business/${POST_ID}`)).toEqual({ kind: 'business', id: POST_ID })
  })

  it('ignores other query parameters on the feed', () => {
    expect(parseShareTarget(`/feed?tab=video&post=${POST_ID}`)).toEqual({ kind: 'post', id: POST_ID })
  })

  it('returns null for a non-item page, so it falls back to site tags', () => {
    expect(parseShareTarget('/feed')).toBeNull()
    expect(parseShareTarget('/search')).toBeNull()
    expect(parseShareTarget('/')).toBeNull()
    expect(parseShareTarget('')).toBeNull()
  })

  it('rejects a permalink that is not a uuid rather than querying with it', () => {
    expect(parseShareTarget('/post/not-a-uuid')).toBeNull()
    expect(parseShareTarget('/post/')).toBeNull()
  })

  it('rejects anything that is not a uuid rather than querying with it', () => {
    expect(parseShareTarget('/u/../../etc/passwd')).toBeNull()
    expect(parseShareTarget('/feed?post=1 OR 1=1')).toBeNull()
    expect(parseShareTarget('/post/1 OR 1=1')).toBeNull()
    expect(parseShareTarget('/news/abc')).toBeNull()
  })
})

describe('canonicalUrlFor', () => {
  it('an old /feed?post= request advertises the NEW permalink as canonical — link equity consolidates on one URL', () => {
    // parseShareTarget takes a path+query, the way og.js's req.url arrives —
    // canonicalUrlFor's third argument is the already-computed request
    // canonical (origin + path), matching how the handler calls it.
    const target = parseShareTarget(`/feed?post=${POST_ID}`)
    expect(canonicalUrlFor(target, ORIGIN, LEGACY_POST_URL)).toBe(POST_CANONICAL)
  })

  it('a /post/:id request is already canonical — no-op', () => {
    const target = parseShareTarget(`/post/${POST_ID}`)
    expect(canonicalUrlFor(target, ORIGIN, POST_CANONICAL)).toBe(POST_CANONICAL)
  })

  it('leaves non-post kinds pointed at the request path — their URL shape is unchanged by this work', () => {
    const profileUrl = `${ORIGIN}/u/${POST_ID}`
    const target = parseShareTarget(`/u/${POST_ID}`)
    expect(canonicalUrlFor(target, ORIGIN, profileUrl)).toBe(profileUrl)
  })

  it('falls back to the request-path canonical for a non-item page (null target)', () => {
    expect(canonicalUrlFor(null, ORIGIN, `${ORIGIN}/search`)).toBe(`${ORIGIN}/search`)
  })

  it('degrades to a relative permalink when there is no origin', () => {
    const target = parseShareTarget(`/feed?post=${POST_ID}`)
    expect(canonicalUrlFor(target, '', `/feed?post=${POST_ID}`)).toBe(`/post/${POST_ID}`)
  })
})

describe('plainTextFromContent', () => {
  it('reads prose out of an article block array', () => {
    const body = JSON.stringify([
      { id: 'a', type: 'text', content: '**Movement Is Medicine**\n\nThere are medicines we take when we are sick.' },
    ])
    const text = plainTextFromContent(body)
    expect(text).toContain('Movement Is Medicine')
    expect(text).not.toContain('**')
  })

  it('strips highlight markup, including the malformed ==color| kind', () => {
    expect(plainTextFromContent('==#fde68a|highlighted== text')).toBe('highlighted text')
    expect(plainTextFromContent('==color|broken==color| text')).toBe('broken text')
  })

  it('skips drawing stroke data but keeps its caption', () => {
    const body = JSON.stringify([
      { id: 'a', type: 'text', content: 'Intro' },
      { id: 'b', type: 'drawing', caption: 'Figure 1', strokes: [{ points: [{ x: 1, y: 2 }] }] },
    ])
    const text = plainTextFromContent(body)
    expect(text).toContain('Intro')
    expect(text).toContain('Figure 1')
    expect(text).not.toContain('points')
  })

  it('drops the repost marker', () => {
    expect(plainTextFromContent('🔁 shared words')).toBe('shared words')
  })

  it('handles plain text, empty and null', () => {
    expect(plainTextFromContent('just text')).toBe('just text')
    expect(plainTextFromContent('')).toBe('')
    expect(plainTextFromContent(null)).toBe('')
    expect(plainTextFromContent('[not json')).toBe('[not json')
  })

  it('converts literal backslash-n escapes into readable line breaks, not raw "\\n"', () => {
    const body = JSON.stringify([
      { id: 'a', type: 'text', content: 'First line.\\nSecond line.\\n\\nThird line.' },
    ])
    const text = plainTextFromContent(body)
    expect(text).not.toContain('\\n')
    expect(text).toBe('First line. Second line. Third line.')
  })
})

describe('truncate', () => {
  it('leaves a short description alone', () => {
    expect(truncate('short')).toBe('short')
  })

  it('cuts long text on a word boundary within the limit', () => {
    const long = 'word '.repeat(100)
    const out = truncate(long)
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT + 1)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/wor…$/)
  })
})

describe('absoluteUrl', () => {
  it('leaves an already-absolute URL alone', () => {
    expect(absoluteUrl(ORIGIN, 'https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg')
  })

  it('makes a relative path absolute — crawlers ignore relative og:image', () => {
    expect(absoluteUrl(ORIGIN, '/img/x.jpg')).toBe('https://carefind.app/img/x.jpg')
  })

  it('is null when there is no image', () => {
    expect(absoluteUrl(ORIGIN, null)).toBeNull()
  })
})

describe('buildPostMeta', () => {
  const post = {
    id: POST_ID,
    content: JSON.stringify([{ id: 'a', type: 'text', content: 'Movement Is Medicine. There are medicines we take when we are sick.' }]),
    image_url: 'https://cdn.example/post.jpg',
  }

  it('describes the actual post, not the site', () => {
    const meta = buildPostMeta(post, { origin: ORIGIN, canonicalUrl: POST_CANONICAL, author: { full_name: 'Maryam Abdulazeez' } })
    expect(meta.title).toContain('Movement Is Medicine')
    expect(meta.description).toContain('medicines we take when we are sick')
    expect(meta.image).toBe('https://cdn.example/post.jpg')
    expect(meta.url).toBe(POST_CANONICAL)
    expect(meta.type).toBe('article')
    expect(meta.title).not.toBe(DEFAULT_TITLE)
    expect(meta.description).not.toBe(DEFAULT_DESCRIPTION)
  })

  it('never describes a subscriber-only post — a crawler is anonymous', () => {
    const meta = buildPostMeta({ ...post, subscriber_only: true }, { origin: ORIGIN, canonicalUrl: POST_CANONICAL })
    expect(meta.description).not.toContain('Movement')
    expect(meta.image).toBeNull()
    expect(meta.title).toMatch(/subscriber-only/i)
  })

  it('never describes a premium post either', () => {
    const meta = buildPostMeta({ ...post, is_premium: true }, { origin: ORIGIN, canonicalUrl: POST_CANONICAL })
    expect(meta.description).not.toContain('Movement')
  })

  it('falls back to site tags for a missing post', () => {
    expect(buildPostMeta(null, { canonicalUrl: POST_CANONICAL }).title).toBe(DEFAULT_TITLE)
  })
})

describe('buildProfileMeta', () => {
  it('names the person and their credential', () => {
    const meta = buildProfileMeta(
      { full_name: 'Ada Obi', specialty: 'Pharmacist', bio: 'Community pharmacist in Lagos.', avatar_url: '/a.jpg' },
      { origin: ORIGIN, canonicalUrl: `${ORIGIN}/u/${POST_ID}` }
    )
    expect(meta.title).toBe('Ada Obi — Pharmacist')
    expect(meta.description).toContain('Community pharmacist')
    expect(meta.image).toBe('https://carefind.app/a.jpg')
    expect(meta.type).toBe('profile')
  })
})

describe('buildNewsMeta', () => {
  it('describes an approved article', () => {
    const meta = buildNewsMeta(
      { headline: 'New malaria guidance', subtitle: 'What changed', status: 'approved', hero_image_url: '/h.jpg' },
      { origin: ORIGIN, canonicalUrl: `${ORIGIN}/news/${POST_ID}` }
    )
    expect(meta.title).toBe('New malaria guidance')
    expect(meta.description).toBe('What changed')
  })

  it('refuses to describe an article still awaiting moderation', () => {
    const meta = buildNewsMeta({ headline: 'Unapproved', status: 'pending' }, { canonicalUrl: 'x' })
    expect(meta.title).toBe(DEFAULT_TITLE)
    expect(meta.description).toBe(DEFAULT_DESCRIPTION)
  })
})

describe('buildBusinessMeta', () => {
  it('describes an active, listed business', () => {
    const meta = buildBusinessMeta(
      { name: 'HealthPlus Ikeja', business_type: 'Pharmacy', city: 'Ikeja', state: 'Lagos', status: 'active', visible_on_carefind: true, logo_url: '/l.png' },
      { origin: ORIGIN, canonicalUrl: `${ORIGIN}/business/${POST_ID}` }
    )
    expect(meta.title).toBe('HealthPlus Ikeja')
    expect(meta.description).toContain('Ikeja, Lagos')
    expect(meta.image).toBe('https://carefind.app/l.png')
  })

  it('does not describe a pending or hidden business', () => {
    expect(buildBusinessMeta({ name: 'X', status: 'pending' }, {}).title).toBe(DEFAULT_TITLE)
    expect(buildBusinessMeta({ name: 'X', status: 'active', visible_on_carefind: false }, {}).title).toBe(DEFAULT_TITLE)
  })
})

describe('renderOgHtml', () => {
  const meta = {
    title: 'Movement Is Medicine',
    description: 'There are medicines we take when we are sick.',
    image: 'https://cdn.example/post.jpg',
    url: POST_CANONICAL,
    type: 'article',
    authorName: 'Maryam Abdulazeez',
  }

  it('emits every tag the issue asks for', () => {
    const html = renderOgHtml(meta)
    expect(html).toContain('<meta property="og:title" content="Movement Is Medicine" />')
    expect(html).toContain('<meta property="og:description" content="There are medicines we take when we are sick." />')
    expect(html).toContain('<meta property="og:image" content="https://cdn.example/post.jpg" />')
    expect(html).toContain(`<meta property="og:url" content="${POST_CANONICAL}" />`)
    expect(html).toContain('<meta property="og:type" content="article" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(html).toContain('<meta name="twitter:title" content="Movement Is Medicine" />')
    expect(html).toContain('<meta name="twitter:description" content="There are medicines we take when we are sick." />')
    expect(html).toContain('<meta name="twitter:image" content="https://cdn.example/post.jpg" />')
  })

  it('uses the plain summary card when there is no image', () => {
    const html = renderOgHtml({ ...meta, image: null })
    expect(html).toContain('<meta name="twitter:card" content="summary" />')
    expect(html).not.toContain('og:image')
  })

  it('links to the real page but never meta-refreshes to it', () => {
    const html = renderOgHtml(meta)
    expect(html).toContain(`<a href="${POST_CANONICAL}">Open on CareFind</a>`)
    // A refresh here would target the same URL, which the edge rewrites
    // straight back to this handler — an infinite loop, not a fallback.
    expect(html).not.toContain('http-equiv="refresh"')
  })

  it('escapes content so a post cannot inject markup into the head', () => {
    const html = renderOgHtml({
      ...meta,
      title: 'Evil" /><script>alert(1)</script>',
      description: "It's <b>bold</b> & tricky",
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })

  it('escapes the five dangerous characters', () => {
    expect(escapeHtmlAttribute(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })
})

// ── The deployment contract ──────────────────────────────────────────────
// Two lists have to agree or the site breaks in one of two ways:
//   * a token in vercel.json that isCrawlerUserAgent does NOT recognise sends
//     a real visitor to the API router, which 404s instead of serving the app;
//   * a token here that vercel.json does not route never reaches the handler,
//     so that crawler silently keeps getting the generic card.
// The first is the dangerous one, so it is asserted directly rather than left
// to a deploy to discover.
describe('vercel.json crawler rewrite agrees with isCrawlerUserAgent', () => {
  // vitest's root is apps/carefind, where vercel.json lives.
  const vercelConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'))

  const crawlerRule = vercelConfig.rewrites.find((r) => r.has?.some((h) => h.key === 'user-agent'))

  it('has a user-agent-conditional rewrite pointing at the API router', () => {
    expect(crawlerRule).toBeTruthy()
    expect(crawlerRule.destination).toBe('/api/router')
  })

  it('keeps the SPA fallback AFTER the crawler rule, so humans still get the app', () => {
    const rules = vercelConfig.rewrites
    const crawlerIdx = rules.indexOf(crawlerRule)
    const spaIdx = rules.findIndex((r) => r.destination === '/index.html')
    expect(spaIdx).toBeGreaterThan(crawlerIdx)
    // and /api/* must still be matched before either of them
    expect(rules.findIndex((r) => r.source === '/api/(.*)')).toBeLessThan(crawlerIdx)
  })

  it('uses no inline (?i) flag — JavaScript RegExp cannot parse one', () => {
    const value = crawlerRule.has.find((h) => h.key === 'user-agent').value
    expect(value).not.toContain('(?i)')
    expect(() => new RegExp(value)).not.toThrow()
  })

  it('every token it routes is one the handler recognises', () => {
    const value = crawlerRule.has.find((h) => h.key === 'user-agent').value
    const tokens = value.replace(/^\.\*\(/, '').replace(/\)\.\*$/, '').split('|')
    expect(tokens.length).toBeGreaterThan(10)
    for (const token of tokens) {
      // Simulate a UA containing this token, as the rewrite would match it.
      expect(isCrawlerUserAgent(`Mozilla/5.0 (compatible; ${token}/1.0)`)).toBe(true)
    }
  })

  it('the rewrite regex itself matches real crawler user agents', () => {
    const value = crawlerRule.has.find((h) => h.key === 'user-agent').value
    const re = new RegExp(value)
    expect(re.test('facebookexternalhit/1.1')).toBe(true)
    expect(re.test('WhatsApp/2.23.20.0 A')).toBe(true)
    expect(re.test('LinkedInBot/1.0 (compatible; Mozilla/5.0)')).toBe(true)
    expect(re.test('Twitterbot/1.0')).toBe(true)
    expect(re.test('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile/15E148 Safari/604.1')).toBe(false)
    expect(re.test('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36')).toBe(false)
    // Search crawlers must reach the SPA fallback, not the OG handler.
    expect(re.test('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(false)
    expect(re.test('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(false)
  })
})

describe('titleFromContent (the card headline)', () => {
  it('takes the headline line, not the whole opening paragraph', () => {
    const body = JSON.stringify([{
      id: 'a', type: 'text',
      content: '**Movement Is Medicine: The Health Benefits We Keep Postponing**\n\nThere are medicines we take when we are sick. And then there is medicine we often neglect when we are well.',
    }])
    const title = titleFromContent(body)
    expect(title).toBe('Movement Is Medicine: The Health Benefits We Keep Postponing')
    expect(title).not.toContain('There are medicines')
  })

  it('falls back to the first sentence for a single-paragraph post', () => {
    expect(titleFromContent('Short one. Then another sentence follows here.'))
      .toBe('Short one. Then another sentence follows here.')
  })

  it('does not treat a very short first line as the whole headline', () => {
    expect(titleFromContent('Hi\nThe real point is in the second line of this post.'))
      .toContain('The real point')
  })

  it('truncates a very long headline', () => {
    const title = titleFromContent(`${'x'.repeat(300)}\n\nbody`)
    expect(title.length).toBeLessThanOrEqual(91)
    expect(title.endsWith('…')).toBe(true)
  })

  it('uses the fallback for empty content', () => {
    expect(titleFromContent('', 'Someone on CareFind')).toBe('Someone on CareFind')
    expect(titleFromContent(null)).toBe(DEFAULT_TITLE)
  })

  it('a title is never the same as its own description', () => {
    const body = JSON.stringify([{
      id: 'a', type: 'text',
      content: '**Seven Everyday Things That Could Be Damaging Your Kidneys**\n\nYour kidneys are working every minute to clean your blood and keep your body balanced.',
    }])
    const meta = buildPostMeta({ content: body }, { origin: ORIGIN, canonicalUrl: POST_CANONICAL })
    expect(meta.title).not.toBe(meta.description)
    expect(meta.description.startsWith(meta.title)).toBe(true)
  })
})
