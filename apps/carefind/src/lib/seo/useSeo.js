// The page's own title, description, canonical URL and robots directive, set in the document head while the page is
// shown. CareFind's index.html is served for every URL, so without this every page carried the homepage's title and
// a canonical pointing at the homepage, telling search engines every pharmacy, medicine and article was a duplicate
// of the homepage. Search engines that do not run JavaScript get server-rendered pages instead (api/_handlers/seo.js);
// this keeps the app consistent with them for those that do, and for people (tab titles, bookmarks, shares).
import { useEffect } from 'react'
import { normaliseSiteUrl, absolute, SITE_NAME } from './site.js'

const siteUrl = () => normaliseSiteUrl(import.meta.env?.VITE_SITE_URL)
const DEFAULT_TITLE = 'CareFind — Connecting people to better healthcare'

function setTag(selector, create, attr, value) {
  let el = document.head.querySelector(selector)
  if (value == null) { if (el) el.remove(); return }
  if (!el) { el = create(); document.head.appendChild(el) }
  el.setAttribute(attr, value)
}
const meta = (name, prop = false) => () => { const m = document.createElement('meta'); m.setAttribute(prop ? 'property' : 'name', name); return m }

// `ready`: the page has its data (until then the head is left alone, so a crawler rendering the page never sees a
// half-filled one). `path`: the canonical path, e.g. businessPath(biz).
export function useSeo({ title, description, path, robots = 'index, follow', ready = true } = {}) {
  useEffect(() => {
    if (!ready || typeof document === 'undefined') return undefined
    const previousTitle = document.title
    const full = title ? (String(title).includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`) : DEFAULT_TITLE
    document.title = full
    const canonical = path ? absolute(siteUrl(), path) : null
    setTag('link[rel="canonical"]', () => { const l = document.createElement('link'); l.rel = 'canonical'; return l }, 'href', canonical)
    setTag('meta[name="description"]', meta('description'), 'content', description || null)
    setTag('meta[name="robots"]', meta('robots'), 'content', robots)
    setTag('meta[property="og:title"]', meta('og:title', true), 'content', full)
    setTag('meta[property="og:url"]', meta('og:url', true), 'content', canonical)
    if (description) setTag('meta[property="og:description"]', meta('og:description', true), 'content', description)
    return () => {
      document.title = previousTitle || DEFAULT_TITLE
      // Leave no page's canonical or noindex behind on the next page.
      setTag('link[rel="canonical"]', null, 'href', null)
      setTag('meta[name="robots"]', meta('robots'), 'content', 'index, follow')
    }
  }, [title, description, path, robots, ready])
}

// A page model from lib/seo/pages.js (the same one the crawler page is built from), so the app's head and the
// crawler page always agree. Null page or not ready: the head is left alone.
export function useSeoPage(page, ready = true) {
  let path = null
  try { path = page?.canonical ? new URL(page.canonical).pathname : null } catch { path = null }
  useSeo({ title: page?.title, description: page?.description, path, robots: page?.robots, ready: ready && !!page })
}
export const appSiteUrl = siteUrl
