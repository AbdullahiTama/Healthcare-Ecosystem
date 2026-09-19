---
title: 'Fix external sharing to deep-link preview card to original post'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: '8d92f81f6c9be2cc5bc7adbfadd6e09cdbc78558'
review_loop_iteration: 0
context:
  - 'apps/carefind/src/utils/share.js'
  - 'apps/carefind/src/lib/openGraph.js'
  - 'apps/carefind/api/_handlers/og.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sharing a post to WhatsApp shows image/write-up but recipient must scroll to find URL; link should be a tappable preview card (image/title lead directly to original post) via proper OG/deep-link metadata.

**Approach:** Make share payload and OG metadata produce a clickable preview card where image/title/preview deep-link to `/post/:id` canonical URL, using Web Share `url` field when available and clipboard fallback with URL prominently placed, and verify crawler OG tags + `vercel.json` rewrite.

## Boundaries & Constraints

**Always:** Keep `/post/:id` canonical (legacy `/feed?post=` redirects), keep service-role crawler via `og.js` with anon RLS, keep `og:image` via `absoluteUrl` and `twitter:card` logic, keep `shareOrCopy` fallback to clipboard when Web Share unavailable.

**Ask First:** Changing `og:image` storage or bucket; adding URL shortener.

**Never:** Append raw `mediaUrl` to clipboard text (creates double preview); expose `subscriber_only` content in OG tags; use `http-equiv=refresh`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Web Share available | `navigator.share` exists, post with image | `navigator.share({title,text,url: canonical})` with `url` separate, preview card shows image/title linking to `/post/:id` | If `canShare` false for files, omit files but still share `url` |
| Clipboard fallback | Desktop, no `navigator.share` | Clipboard `url` is first line or prominent, followed by text, so preview appears without scroll; `og:image` provides image via link preview | No mediaUrl appended |
| No image post | Text-only post | `og:image` absent, `twitter:card=summary`, title still links to post | No broken image tag |
| Subscriber-only | Premium post | OG shows generic “Subscriber-only post” not content | No leak via anon RLS |
| Legacy URL shared | `/feed?post=<uuid>` | Canonical `/post/<uuid>` used for OG + share `url` | Redirect handled |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/utils/share.js:35-64` -- `shareOrCopy({title,text,url,files,mediaUrl})` — currently `clipboard.writeText(text ? `${text}\n\n${target}` : target)` puts URL at bottom; must make URL prominent (first line) and keep `mediaUrl` excluded, keep `navigator.share({title,text,url})` with separate `url`.
- `apps/carefind/src/utils/formatShare.js:28` -- `toShareText` truncation 240 chars stripping markdown/highlight; keep.
- `apps/carefind/src/modules/social-feed/usePostEngagement.js:551-559` -- `text="“${toShareText}” — ${author} on CareFind"` + `url: ${origin}/post/${id}`; ensure `url` is canonical via `canonicalUrlFor`.
- `apps/carefind/src/lib/openGraph.js:64-105,189-333` -- `parseShareTarget` strict UUID, `canonicalUrlFor` to `/post/:id`, `buildPostMeta` with `absoluteUrl` for `og:image`, `renderOgHtml` with `og:url`+`canonical`, `og:image`, `twitter:card` large vs summary, no refresh.
- `apps/carefind/api/_handlers/og.js:33-139` -- anon-key crawler, `originOf`, `selectOne`, `metaFor` repost→subject, fallback `defaultMeta`, `Cache-Control s-maxage 300`.
- `apps/carefind/vercel.json:1-17` -- rewrites `api/*` < crawler UA (`WhatsApp|...`) → `/api/router` < SPA fallback; ensure token list includes WhatsApp.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/utils/share.js` -- make share payload deep-link preview: keep `navigator.share({title,text,url: target})` with separate `url`; for clipboard fallback, write `${target}\n\n${text}` (URL first) or `${target}` alone when appropriate, never append `mediaUrl`; ensure files via `canShare` still work.
- [x] `apps/carefind/src/lib/openGraph.js` + `apps/carefind/api/_handlers/og.js` -- verify `buildPostMeta`/`renderOgHtml` emits `og:url` canonical, `og:image` via `absoluteUrl`, `og:title`/`og:description` from post content, `twitter:card` correct, and crawler rewrite covers WhatsApp; add test that image/title/preview link to canonical.
- [x] `apps/carefind/src/utils/share.test.js` + `apps/carefind/src/lib/openGraph.test.js` -- tests: `shareOrCopy` with `navigator.share` passes `url` separate, clipboard fallback is `${url}\n\n${text}` (or url first), no mediaUrl appended; `buildPostMeta` for post with image has `og:image` absolute, for subscriber-only generic; `parseShareTarget`/`canonicalUrlFor` still pass.

**Acceptance Criteria:**
- Given post shared to WhatsApp via Web Share, when recipient taps image/title/preview, then it opens exact `/post/:id` canonical URL
- Given clipboard fallback (desktop), when pasted, then preview card appears without scrolling to find URL (URL is first line or separate field)
- Given post with image, when crawler fetches, then `og:image` is absolute URL and `og:url` is canonical `/post/:id`
- Given subscriber-only post, when crawler fetches, then OG shows generic not leaked content

## Spec Change Log

## Design Notes

Keep `formatShare.js` 240-char truncation for `text`; deep-link URL is separate `url` field for Web Share, and first-line for clipboard. `og:image` via `live-media`/`post-images` public URL; no extra bucket. `vercel.json` crawler UA must include `WhatsApp` (already).

## Verification

**Commands:**
- `npm test -- src/utils/share.test.js src/lib/openGraph.test.js` -- expected: share url separate, clipboard url first, no mediaUrl, OG canonical/image/escaping pass, vercel.json contract pass
- `npm run build` (apps/carefind) -- expected: vite build clean

## Suggested Review Order

**Share payload — URL becomes tappable preview**

- Clipboard fallback URL first, Web Share separate `url` field, never append `mediaUrl`
  [`share.js:35`](../../apps/carefind/src/utils/share.js#L35)

- `toShareText` truncation and markdown strip kept
  [`formatShare.js:28`](../../apps/carefind/src/utils/formatShare.js#L28)

**OG deep-link — crawler renders card**

- `og:url` canonical `/post/:id`, `og:image` absolute, `twitter:card` large/summary
  [`openGraph.js:189`](../../apps/carefind/src/lib/openGraph.js#L189)

- Anon-key crawler with `Cache-Control s-maxage 300`, no refresh
  [`og.js:33`](../../apps/carefind/api/_handlers/og.js#L33)

- `vercel.json` WhatsApp crawler rewrite before SPA fallback
  [`vercel.json:1`](../../apps/carefind/vercel.json#L1)

**Tests**

- Share url separate + clipboard url-first + OG canonical/image
  [`share.test.js:62`](../../apps/carefind/src/utils/share.test.js#L62)
