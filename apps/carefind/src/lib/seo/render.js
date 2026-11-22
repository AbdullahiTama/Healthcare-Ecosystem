// HTML for a page model (lib/seo/pages.js). Every value is escaped; JSON-LD is serialised with "<" escaped so a
// stored "</script>" cannot end the block. Light, fast markup: no scripts, a little inline CSS, real links.
import { SITE_NAME } from './site.js'

export function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
export const jsonLdScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`

const NAV = [['/', 'Home'], ['/search', 'Search medicines'], ['/business-directory', 'Pharmacies and providers'], ['/news', 'Health news'], ['/about', 'About']]

export function renderPage(page, { siteUrl } = {}) {
  const head = [
    `<title>${esc(page.title)}${page.title && !String(page.title).includes(SITE_NAME) ? ` | ${SITE_NAME}` : ''}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<meta name="robots" content="${esc(page.robots)}" />`,
    page.canonical && `<link rel="canonical" href="${esc(page.canonical)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="${esc(page.ogType || 'website')}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    page.canonical && `<meta property="og:url" content="${esc(page.canonical)}" />`,
    `<meta property="og:locale" content="en_NG" />`,
    page.image && `<meta property="og:image" content="${esc(page.image)}" />`,
    `<meta name="twitter:card" content="${page.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    page.published && `<meta property="article:published_time" content="${esc(page.published)}" />`,
    page.authorName && `<meta property="article:author" content="${esc(page.authorName)}" />`,
    ...(page.jsonLd || []).map(jsonLdScript),
  ].filter(Boolean).join('\n')

  const crumbs = (page.breadcrumbs || []).length > 1
    ? `<nav aria-label="Breadcrumb"><ol class="crumbs">${page.breadcrumbs.map((c, i) => i === page.breadcrumbs.length - 1 ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${esc(c.path)}">${esc(c.name)}</a></li>`).join('')}</ol></nav>`
    : ''
  const facts = (page.facts || []).length
    ? `<dl class="facts">${page.facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${f.href ? `<a href="${esc(f.href)}" rel="nofollow">${esc(f.value)}</a>` : esc(f.value)}</dd>`).join('')}</dl>`
    : ''
  const sections = (page.sections || []).map((s) => [
    '<section>',
    s.heading ? `<h2>${esc(s.heading)}</h2>` : '',
    ...(s.paragraphs || []).map((p) => `<p>${esc(p)}</p>`),
    (s.items || []).length ? `<ul>${s.items.map((it) => `<li>${it.href ? `<a href="${esc(it.href)}">${esc(it.text)}</a>` : esc(it.text)}${it.meta ? ` <span class="meta">${esc(it.meta)}</span>` : ''}</li>`).join('')}</ul>` : '',
    '</section>',
  ].join('')).join('\n')

  return `<!doctype html>
<html lang="en-NG">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${head}
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;color:#182722;line-height:1.55}header,main,footer{max-width:960px;margin:0 auto;padding:12px 16px}header nav a,footer a{margin-right:14px;color:#0E6F5A}h1{font-size:1.7rem;margin:.4em 0}.intro{color:#5B6B63}.crumbs{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px;font-size:.9rem}.crumbs li+li:before{content:"›";margin-right:6px}.facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px}.facts dt{font-weight:700}.meta{color:#5B6B63;font-size:.92em}ul{padding-left:18px}a{color:#0E6F5A}</style>
</head>
<body>
<header><a href="/"><strong>${SITE_NAME}</strong></a><nav aria-label="Main">${NAV.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join('')}</nav></header>
<main>
${crumbs}
<h1>${esc(page.h1)}</h1>
${page.intro ? `<p class="intro">${esc(page.intro)}</p>` : ''}
${facts}
${sections}
<p><a href="${esc(page.canonical || '/')}">Open on ${SITE_NAME}</a></p>
</main>
<footer><a href="/business-directory">Directory</a><a href="/news">News</a><a href="/search">Search</a><a href="/about">About ${SITE_NAME}</a>${siteUrl ? `<a href="${esc(siteUrl)}/sitemap.xml">Sitemap</a>` : ''}</footer>
</body>
</html>`
}
