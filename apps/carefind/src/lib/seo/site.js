// The canonical address search engines are told to use for every CareFind page (owner decision 2026-11-22:
// carefind.app). Set SITE_URL (server) / VITE_SITE_URL (app) to change it without a code change.
export const DEFAULT_SITE_URL = 'https://carefind.app'
export const SITE_NAME = 'CareFind'
export const COUNTRY = 'NG'
export const CURRENCY = 'NGN'

export function normaliseSiteUrl(value) {
  const v = String(value || '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v) ? v : DEFAULT_SITE_URL
}

// Server side: SITE_URL, else the default. (Not the request's host: preview deployments must not advertise
// themselves as canonical.)
export function serverSiteUrl(env = (typeof process !== 'undefined' ? process.env : {})) {
  return normaliseSiteUrl(env.SITE_URL || env.VITE_SITE_URL)
}

export function absolute(siteUrl, path = '/') {
  const p = String(path || '/')
  if (/^https?:\/\//i.test(p)) return p
  return siteUrl.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, '')
}
